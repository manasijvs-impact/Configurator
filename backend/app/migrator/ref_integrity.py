"""Reference-integrity check for the Migrator (db_validator.py SECTION F).

TARGET-ONLY static analysis: for every function/procedure in the target schema,
parse the body and flag table references that cannot be resolved to a real
object. Mirrors db_validator.py SECTION F verbatim — same universe construction,
same regexes, same false-positive guards, same flagging rules.

- Existing universe = permanent tables + unlogged tables (all user schemas,
  name-only) + pg_catalog / information_schema relation names. Materialized
  views are tracked separately (excluded from the universe; never flagged).
- Created universe = every CREATE [TEMP|TEMPORARY|UNLOGGED] TABLE found inside
  any function body (functions run sequentially in a session, so a temp/unlogged
  table created by one is visible to the next).
- Accessed = tables read/written via FROM / JOIN / INSERT INTO / UPDATE /
  DELETE FROM / TRUNCATE / MERGE INTO.
- Flagged = accessed - (existing union created).

Cross-schema references are validated by name (search_path behaviour) for
unqualified refs, and as strict (schema, name) pairs for qualified refs.

Read-only: this module never writes to the databases. It writes two CSV
artifacts to ~/Downloads for parity with the notebook.
"""
import csv
import os
import re
from datetime import datetime

from . import classification as cls
from . import diffs as diff_engine
from .connections import ENVIRONMENTS

# Mirrors db_validator MAX_DETAIL_LEN (CSV cell truncation limit).
MAX_DETAIL_LEN = 4000


def _truncate(text, limit=MAX_DETAIL_LEN):
    if not text:
        return ""
    return text if len(text) <= limit else text[:limit] + " [truncated]"


# ── Regex patterns (ported verbatim from db_validator SECTION F) ──
# Identifier must start with a letter or underscore (a proper SQL identifier).
_IDENT = r"[A-Za-z_]\w*"

_PERM_CREATE_RE = re.compile(
    rf"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:({_IDENT})\.)?({_IDENT})",
    re.IGNORECASE,
)
_TEMP_CREATE_RE = re.compile(
    rf"\bCREATE\s+(?:TEMP|TEMPORARY|UNLOGGED)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:({_IDENT})\.)?({_IDENT})",
    re.IGNORECASE,
)
# Access verbs followed by a table identifier (not a column list). Optional
# LATERAL/ONLY modifier between the verb and the table name is skipped.
_ACCESS_RE = re.compile(
    r"\b(?:FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|MERGE\s+INTO)"
    r"(?:\s+(?:LATERAL|ONLY))?"
    rf"\s+(?:({_IDENT})\.)?({_IDENT})",
    re.IGNORECASE,
)

# SQL keywords that may land in the captured slot but aren't tables.
_NON_TABLE_KEYWORDS = {
    "lateral", "only", "rows", "table", "values", "select", "with", "set",
    # Row-locking / cursor clauses that can follow UPDATE/SELECT verbs
    "skip", "locked", "nowait", "share", "key",
}

# PostgreSQL functions whose parentheses contain `FROM <expr>` for syntax
# reasons (not a table-access FROM): TRIM(LEADING ',' FROM col),
# EXTRACT(YEAR FROM dt), SUBSTRING(s FROM 2 FOR 5), OVERLAY(s PLACING x FROM 3).
_FROM_FN_NAMES = ("trim", "extract", "substring", "overlay", "position", "cast")
_FROM_FN_RE = re.compile(rf"\b(?:{'|'.join(_FROM_FN_NAMES)})\s*\(", re.IGNORECASE)

_DQ_OPEN_RE = re.compile(r"\$([A-Za-z_]\w*)?\$")

_CTE_START_RE = re.compile(r"\bWITH\s+(?:RECURSIVE\s+)?", re.IGNORECASE)
_CTE_NAME_RE = re.compile(r"(\w+)\s*(?:\([^)]*\))?\s+AS\s*\(", re.IGNORECASE)
_CTE_COMMA_RE = re.compile(r"\s*,\s*")

# DECLARE block parsing: capture local PL/pgSQL variable names so they don't get
# flagged as tables when they appear after keywords like FROM.
_DECLARE_BLOCK_RE = re.compile(r"\bDECLARE\b(.*?)\bBEGIN\b", re.IGNORECASE | re.DOTALL)
_DECL_NAME_RE = re.compile(
    r"(?:^|;)\s*([A-Za-z_]\w*)\s+(?:CONSTANT\s+)?[A-Za-z_]", re.IGNORECASE,
)


def _find_fn_arg_ranges(body):
    """For each TRIM/EXTRACT/SUBSTRING/OVERLAY/POSITION/CAST call, return the
    [start, end) range covering the inside of its parentheses (so access matches
    inside can be ignored)."""
    ranges = []
    n = len(body)
    for m in _FROM_FN_RE.finditer(body):
        start = m.end()  # position right after '('
        depth = 1
        i = start
        while i < n and depth > 0:
            c = body[i]
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
            i += 1
        ranges.append((start, i - 1))
    return ranges


def _pos_in_ranges(pos, ranges):
    for s, e in ranges:
        if s <= pos < e:
            return True
    return False


def _strip_for_regex(body):
    """Strip SQL line/block comments, single-quoted string literals, AND
    dollar-quoted strings ($$...$$ or $tag$...$tag$) so text inside strings
    (e.g. EXECUTE 'INSERT INTO foo ...' or sql := $q$ ... $q$) doesn't fool the
    access/create regexes."""
    out = []
    i, n = 0, len(body)
    in_sq = in_lc = in_bc = False
    dq_tag = None  # when not None, we are inside a dollar-quoted string
    while i < n:
        c = body[i]
        nxt = body[i + 1] if i + 1 < n else ""
        if in_lc:
            if c == "\n":
                in_lc = False
                out.append("\n")
            i += 1
        elif in_bc:
            if c == "*" and nxt == "/":
                in_bc = False
                i += 2
            else:
                if c == "\n":
                    out.append("\n")
                i += 1
        elif in_sq:
            if c == "'":
                if nxt == "'":
                    i += 2  # escaped quote, stay inside string
                    continue
                in_sq = False
                i += 1
            else:
                i += 1
        elif dq_tag is not None:
            if body.startswith(dq_tag, i):
                i += len(dq_tag)
                dq_tag = None
            else:
                if c == "\n":
                    out.append("\n")
                i += 1
        else:
            if c == "-" and nxt == "-":
                in_lc = True
                i += 2
            elif c == "/" and nxt == "*":
                in_bc = True
                i += 2
            elif c == "'":
                in_sq = True
                out.append("''")  # placeholder keeps tokens separated
                i += 1
            elif c == "$":
                m = _DQ_OPEN_RE.match(body, i)
                if m:
                    dq_tag = m.group(0)  # full opening tag, e.g. '$$' or '$q$'
                    out.append(" ")      # placeholder keeps tokens separated
                    i = m.end()
                else:
                    out.append(c)
                    i += 1
            else:
                out.append(c)
                i += 1
    return "".join(out)


def _extract_cte_names(body):
    """Find all CTE names defined via WITH [RECURSIVE] x AS (...), y AS (...)."""
    names = set()
    for m in _CTE_START_RE.finditer(body):
        pos = m.end()
        while True:
            nm = _CTE_NAME_RE.match(body, pos)
            if not nm:
                break
            names.add(nm.group(1))
            i = nm.end()
            depth = 1
            in_sq = False
            while i < len(body) and depth > 0:
                c = body[i]
                if c == "'":
                    in_sq = not in_sq
                elif not in_sq:
                    if c == "(":
                        depth += 1
                    elif c == ")":
                        depth -= 1
                i += 1
            cm = _CTE_COMMA_RE.match(body, i)
            if not cm:
                break
            pos = cm.end()
    return names


def _extract_declared_locals(body):
    """Return the set of variable names declared in any DECLARE...BEGIN block."""
    names = set()
    for m in _DECLARE_BLOCK_RE.finditer(body):
        block = m.group(1)
        for dm in _DECL_NAME_RE.finditer(block):
            nm = dm.group(1)
            if nm.lower() in {"begin", "end", "if", "then", "else", "return",
                              "loop", "for", "while", "case", "when"}:
                continue
            names.add(nm)
    return names


def _names_only(matches):
    """Return just the table names from regex matches, regardless of schema
    qualifier. The universe is name-only across all user schemas, so cross-schema
    references like `public.foo` are validated by name too."""
    return {name for _sch, name in matches}


# ── Universe construction (target connection) ──

def _build_universe(conn, target_schema):
    """Return all the universe sets needed for flagging, mirroring SECTION F
    Step 1."""
    with conn.cursor() as cur:
        # Permanent, non-partition-child tables across ALL user schemas (name-only).
        cur.execute(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid "
            "WHERE c.relkind IN ('r','p') AND c.relispartition = false "
            "AND c.relpersistence = 'p' "
            "AND n.nspname NOT IN ('pg_catalog','information_schema');"
        )
        existing_perm_tables = {r["relname"] for r in cur.fetchall()}

        # Permanent tables in the TARGET schema only (header count).
        cur.execute(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid "
            "WHERE c.relkind IN ('r','p') AND c.relispartition = false "
            "AND c.relpersistence = 'p' AND n.nspname = %s;",
            (target_schema,),
        )
        existing_perm_tables_target = {r["relname"] for r in cur.fetchall()}

        cur.execute(
            "SELECT matviewname FROM pg_matviews "
            "WHERE schemaname NOT IN ('pg_catalog','information_schema');"
        )
        existing_matviews = {r["matviewname"] for r in cur.fetchall()}

        # Unlogged tables across ALL schemas (valid reference targets).
        cur.execute(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid "
            "WHERE c.relkind IN ('r','p') AND c.relispartition = false "
            "AND c.relpersistence = 'u' "
            "AND n.nspname NOT IN ('pg_catalog','information_schema');"
        )
        existing_unlogged = {r["relname"] for r in cur.fetchall()}

        # System catalogs are on every session's implicit search_path.
        cur.execute(
            "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid "
            "WHERE n.nspname IN ('pg_catalog', 'information_schema');"
        )
        system_objects = {r["relname"] for r in cur.fetchall()}

        # Schema-qualified existing sets for STRICT matching of qualified refs.
        cur.execute(
            "SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid "
            "WHERE c.relkind IN ('r','p','v') AND c.relispartition = false "
            "AND (c.relpersistence IN ('p','u') "
            "     OR n.nspname IN ('pg_catalog','information_schema'));"
        )
        existing_qualified = {(r["nspname"], r["relname"]) for r in cur.fetchall()}

        cur.execute("SELECT schemaname, matviewname FROM pg_matviews;")
        existing_qualified_matviews = {(r["schemaname"], r["matviewname"]) for r in cur.fetchall()}

    existing_objects = existing_perm_tables | system_objects | existing_unlogged
    return {
        "existing_perm_tables": existing_perm_tables,
        "existing_perm_tables_target": existing_perm_tables_target,
        "existing_matviews": existing_matviews,
        "existing_unlogged": existing_unlogged,
        "system_objects": system_objects,
        "existing_qualified": existing_qualified,
        "existing_qualified_matviews": existing_qualified_matviews,
        "existing_objects": existing_objects,
    }


def _scan_function(meta):
    """Scan one function body. Returns {kind, created, accessed_bare,
    accessed_qualified}. Mirrors SECTION F Step 2."""
    raw_body = meta["body"] or ""
    body = _strip_for_regex(raw_body)

    # All CREATE TABLE variants (permanent + temp + unlogged) feed the universe.
    temp_matches = _TEMP_CREATE_RE.findall(body)
    body_for_perm = _TEMP_CREATE_RE.sub(" ", body)
    perm_matches = _PERM_CREATE_RE.findall(body_for_perm)
    # Also scan the RAW body for CREATE TEMP/UNLOGGED built via dynamic SQL inside
    # strings (e.g. EXECUTE format($q$ CREATE TEMP TABLE foo ... $q$)).
    dyn_temp_matches = _TEMP_CREATE_RE.findall(raw_body)
    created = (_names_only(temp_matches)
               | _names_only(perm_matches)
               | _names_only(dyn_temp_matches))

    cte_names = _extract_cte_names(body)
    declared_locals = _extract_declared_locals(body)
    fn_arg_ranges = _find_fn_arg_ranges(body)

    accessed_bare = set()
    accessed_qualified = set()
    for m in _ACCESS_RE.finditer(body):
        # Skip captures inside TRIM/EXTRACT/SUBSTRING/OVERLAY/POSITION/CAST args.
        if _pos_in_ranges(m.start(), fn_arg_ranges):
            continue
        # Skip `IS [NOT] DISTINCT FROM <x>` — FROM is part of the operator here.
        preceding = body[max(0, m.start() - 32):m.start()]
        if re.search(r"\bIS\s+(?:NOT\s+)?DISTINCT\s*$", preceding, re.IGNORECASE):
            continue
        sch, name = m.group(1), m.group(2)
        if name.lower() in _NON_TABLE_KEYWORDS:
            continue
        # Skip table-valued function calls: name(...) e.g. jsonb_array_elements(x)
        j = m.end()
        while j < len(body) and body[j] in " \t\r\n":
            j += 1
        if j < len(body) and body[j] == "(":
            continue
        if sch:
            accessed_qualified.add((sch, name))
        else:
            accessed_bare.add(name)

    accessed_bare -= cte_names
    accessed_bare -= declared_locals
    accessed_qualified = {(s, n) for (s, n) in accessed_qualified
                          if n not in cte_names and n not in declared_locals}

    return {
        "kind": meta["kind"],
        "created": created,
        "accessed_bare": accessed_bare,
        "accessed_qualified": accessed_qualified,
    }


def build(conns):
    """Run the reference-integrity check against the TARGET schema. Writes the
    two CSV artifacts to ~/Downloads and returns the structured result for the
    UI. Mirrors db_validator SECTION F end-to-end."""
    tgt = conns.ensure_alive("target")
    target_schema = conns.target_schema
    target_env = conns.target_env
    target_db = (ENVIRONMENTS.get(target_env, {}) or {}).get("db", target_env or "target")

    uni = _build_universe(tgt, target_schema)
    existing_objects = uni["existing_objects"]
    existing_matviews = uni["existing_matviews"]
    existing_qualified = uni["existing_qualified"]
    existing_qualified_matviews = uni["existing_qualified_matviews"]

    # Step 2: scan each target function body.
    tgt_fns = diff_engine._get_functions_full(tgt, target_schema)
    per_fn = {key: _scan_function(meta) for key, meta in tgt_fns.items()}

    # Step 3: build universe and flag.
    created_by_any = set()
    for info in per_fn.values():
        created_by_any |= info["created"]
    universe = existing_objects | created_by_any

    flagged_count = 0
    total_unresolved = 0
    rows = []
    for key in sorted(per_fn.keys()):
        info = per_fn[key]
        bare_unresolved = sorted((info["accessed_bare"] - universe) - existing_matviews)
        qual_unresolved_pairs = sorted(
            p for p in info["accessed_qualified"]
            if p not in existing_qualified
            and p not in existing_qualified_matviews
            and p[1] not in created_by_any
        )
        qual_unresolved = [f"{s}.{n}" for s, n in qual_unresolved_pairs]
        unresolved = bare_unresolved + qual_unresolved
        if unresolved:
            flagged_count += 1
            total_unresolved += len(unresolved)
        accessed_display = (sorted(info["accessed_bare"])
                            + [f"{s}.{n}" for s, n in sorted(info["accessed_qualified"])])
        rows.append({
            "function_name": key[0],
            "arg_signature": key[1],
            "kind": info["kind"],
            "missing_table_count": len(unresolved),
            "missing_tables": unresolved,
            "created_tables": sorted(info["created"]),
            "accessed_tables": accessed_display,
        })

    # Sort: flagged rows first, then alphabetical (mirrors the notebook).
    rows.sort(key=lambda r: (r["missing_table_count"] == 0, r["function_name"], r["arg_signature"]))

    ts_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path, universe_csv_path = _write_csvs(
        ts_str, target_db, target_schema, rows, uni, created_by_any)

    return {
        "target_env": target_env,
        "target_schema": target_schema,
        "summary": {
            "existing_tables": len(uni["existing_perm_tables"]),
            "existing_tables_target": len(uni["existing_perm_tables_target"]),
            "system_objects": len(uni["system_objects"]),
            "existing_objects": len(existing_objects),
            "materialized_views": len(existing_matviews),
            "unlogged_tables": len(uni["existing_unlogged"]),
            "functions_scanned": len(per_fn),
            "created_by_functions": len(created_by_any),
            # Deduplicated `existing_objects | created_by_any` set, EXCLUDING
            # matviews — verbatim parity with db_validator SECTION F
            # ("Universe size (existing + created)"). Intentionally NOT equal to
            # the universe CSV row count, which lists each source set separately
            # and appends matviews for inspection.
            "universe_size": len(universe),
            "flagged_functions": flagged_count,
            "total_unresolved": total_unresolved,
        },
        "rows": rows,
        "csv_path": csv_path,
        "universe_csv_path": universe_csv_path,
    }


def _write_csvs(ts_str, target_db, target_schema, rows, uni, created_by_any):
    """Write reference_integrity_*.csv + universe CSV to ~/Downloads — VERBATIM
    parity with db_validator SECTION F. The universe CSV lists each source set
    separately (permanent, system, unlogged, created), then appends matviews
    labelled "(excluded from universe)" for inspection only. Its row count is
    intentionally larger than the reported universe size (no cross-set dedup;
    matviews are extra rows)."""
    universe_csv_path = os.path.join(
        cls.REPORT_DIR,
        f"reference_integrity_universe_{target_db}_{target_schema}_{ts_str}.csv",
    )
    with open(universe_csv_path, "w", newline="", encoding="utf-8") as ufile:
        uw = csv.writer(ufile)
        uw.writerow(["object_name", "source"])
        for name in sorted(uni["existing_perm_tables"]):
            uw.writerow([name, "permanent_table"])
        for name in sorted(uni["system_objects"]):
            uw.writerow([name, "system_catalog"])
        for name in sorted(uni["existing_unlogged"]):
            uw.writerow([name, "unlogged_table"])
        for name in sorted(created_by_any):
            uw.writerow([name, "created_by_function (temp/unlogged/permanent)"])
        for name in sorted(uni["existing_matviews"]):
            uw.writerow([name, "materialized_view (excluded from universe)"])

    csv_path = os.path.join(
        cls.REPORT_DIR,
        f"reference_integrity_{target_db}_{target_schema}_{ts_str}.csv",
    )
    ref_fields = [
        "function_name", "arg_signature", "kind",
        "missing_table_count", "missing_tables",
        "created_tables", "accessed_tables",
    ]
    with open(csv_path, "w", newline="", encoding="utf-8") as cfile:
        w = csv.DictWriter(cfile, fieldnames=ref_fields)
        w.writeheader()
        for r in rows:
            w.writerow({
                "function_name": r["function_name"],
                "arg_signature": r["arg_signature"],
                "kind": r["kind"],
                "missing_table_count": r["missing_table_count"],
                "missing_tables": _truncate(", ".join(r["missing_tables"])),
                "created_tables": _truncate(", ".join(r["created_tables"])),
                "accessed_tables": _truncate(", ".join(r["accessed_tables"])),
            })
    return csv_path, universe_csv_path
