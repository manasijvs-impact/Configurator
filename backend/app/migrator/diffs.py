"""Diff engine for the Migrator (Step 3).

Computes SOURCE vs TARGET differences, mirroring db_validator.py's comparison
logic, and returns the `migration_diffs` JSON contract the frontend renders
(Step3Results.jsx). It deliberately reuses the Step 2 classification model
(static/dynamic + skip flags), so the same decisions you make in Step 2 — and
the same shared CSVs the notebook uses — drive what Step 3 checks:

- TABLES
    missing_in_target / missing_in_source : present on one side only
    schema_diff (all common tables; skip_schema_check honoured) : column add/
        drop or data_type change (db_validator STEP 4)
    data_diff (STATIC common tables; skip_data_check honoured)  : row-level
        differences, ignoring created_at/updated_at (db_validator STEP 5)
- FUNCTIONS / PROCEDURES
    missing_in_target / missing_in_source
    return_type_diff / body_diff (common keys; skip_body_check honoured)
        — body equality uses the notebook's comment-stripped, whitespace-
        collapsed canonical form (canonicalize_for_equality).

Read-only: this module never writes to the databases.
"""
import re
from collections import Counter, OrderedDict
from concurrent.futures import ThreadPoolExecutor

from psycopg import sql

from . import classification as cls

# Columns ignored in row-level data diffs (mirrors db_validator EXCLUDE_DATA_COLS).
EXCLUDE_DATA_COLS = {"created_at", "updated_at"}
# Cap how many example rows we serialise into a detail string (keeps payload sane).
MAX_DETAIL_ROWS = 50


# ── Column / row helpers (mirror db_validator.get_columns / get_all_rows) ──

def _bulk_columns(conn, schema):
    """{table_name: OrderedDict(col -> {data_type})} for the WHOLE schema in ONE
    query. Replaces the per-table information_schema lookups that made Step 3
    do hundreds of sequential round trips over VPN. Ordered by ordinal_position
    so the column order matches db_validator.get_all_rows."""
    out = {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = %s
            ORDER BY table_name, ordinal_position
            """,
            (schema,),
        )
        for r in cur.fetchall():
            out.setdefault(r["table_name"], OrderedDict())[r["column_name"]] = {
                "data_type": r["data_type"],
            }
    return out


def _fetch_rows(conn, schema, table, col_names):
    """All rows for `table` as string-normalised tuples, ordered by all columns.
    `col_names` (ordinal order) comes from the bulk column fetch, so we avoid an
    extra per-table information_schema round trip."""
    if not col_names:
        return []
    with conn.cursor() as cur:
        try:
            cols_ident = sql.SQL(", ").join(sql.Identifier(c) for c in col_names)
            query = sql.SQL("SELECT {cols} FROM {sch}.{tbl} ORDER BY {cols}").format(
                cols=cols_ident, sch=sql.Identifier(schema), tbl=sql.Identifier(table))
            cur.execute(query)
            return [tuple(r[c] for c in col_names) for r in cur.fetchall()]
        except Exception:
            conn.rollback()
            return []


def _row_to_strs(row):
    return tuple(str(v) if v is not None else "NULL" for v in row)


# ── Function metadata (mirror db_validator.get_functions, with body) ──

def _get_functions_full(conn, schema):
    """{(name, arg_signature): {kind, return_type, body}} for fns + procedures.

    arg_signature is the no-default argument list, identical to the Step 2
    classification key (cls._args_no_default)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.proname AS name,
                   pg_get_function_arguments(p.oid) AS args_str,
                   pg_get_function_result(p.oid)    AS return_type,
                   CASE p.prokind WHEN 'f' THEN 'function'
                                  WHEN 'p' THEN 'procedure'
                                  ELSE p.prokind::text END AS kind,
                   p.prosrc AS body
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = %s
              AND p.prokind IN ('f', 'p')
            ORDER BY p.proname, pg_get_function_arguments(p.oid)
            """,
            (schema,),
        )
        out = {}
        for r in cur.fetchall():
            key = (r["name"], cls._args_no_default(r["args_str"] or ""))
            out[key] = {
                "kind": r["kind"],
                "return_type": r["return_type"] or "",
                "body": r["body"] or "",
                "args_full": r["args_str"] or "",
            }
    return out


def _default_diffs(s_args_full, t_args_full, src_label, tgt_label):
    """Human-readable DEFAULT-value mismatches between two (common-key) arg
    lists. Mirrors db_validator STEP 4 (args_default_map comparison). For common
    keys the no-default struct is identical, so we compare each param's DEFAULT
    expression."""
    s_map = cls._args_default_map(s_args_full)
    t_map = cls._args_default_map(t_args_full)
    diffs = []
    for param_struct in s_map:
        sd, td = s_map.get(param_struct), t_map.get(param_struct)
        if (sd or "") != (td or ""):
            diffs.append(f"param `{param_struct}`: {src_label} DEFAULT={sd!r} "
                         f"vs {tgt_label} DEFAULT={td!r}")
    return diffs


# ── Body canonicalisation (mirror db_validator.canonicalize_for_equality) ──

def _strip_sql_comments(body):
    out, buf = [], []
    i, n = 0, len(body)
    in_sq = in_lc = in_bc = False
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
            out.append(c)
            if c == "'":
                if nxt == "'":
                    out.append(nxt)
                    i += 2
                    continue
                in_sq = False
            i += 1
        else:
            if c == "'":
                in_sq = True
                out.append(c)
                i += 1
            elif c == "-" and nxt == "-":
                in_lc = True
                i += 2
            elif c == "/" and nxt == "*":
                in_bc = True
                i += 2
            else:
                out.append(c)
                i += 1
    return "".join(out)


def _canonical(body):
    return re.sub(r"\s+", " ", _strip_sql_comments(body or "")).strip()


# ── Materialized views (mirror db_validator SECTION C) ──

def _get_matviews(conn, schema):
    """{matview_name: definition} via pg_matviews."""
    out = {}
    with conn.cursor() as cur:
        cur.execute(
            "SELECT matviewname, definition FROM pg_matviews "
            "WHERE schemaname = %s ORDER BY matviewname",
            (schema,),
        )
        for r in cur.fetchall():
            out[r["matviewname"]] = r["definition"] or ""
    return out


def _norm_mv_def(s):
    """Whitespace-tolerant matview definition compare (db_validator._norm_mv_def).
    Note: matviews are NOT comment-stripped — only whitespace is collapsed."""
    return re.sub(r"\s+", " ", s or "").strip()


# ── Table diff builders ──

def _schema_detail(sc_src, sc_tgt, src_label, tgt_label):
    """Plain-English column differences (mirrors db_validator STEP 4 output)."""
    lines = []
    for col in sorted(set(sc_src) | set(sc_tgt)):
        in_s, in_t = col in sc_src, col in sc_tgt
        if in_s and not in_t:
            lines.append(f"Column '{col}': EXISTS in {src_label} "
                         f"(data_type={sc_src[col]['data_type']}); MISSING in {tgt_label}.")
        elif in_t and not in_s:
            lines.append(f"Column '{col}': MISSING in {src_label}; EXISTS in {tgt_label} "
                         f"(data_type={sc_tgt[col]['data_type']}).")
        elif sc_src[col]["data_type"] != sc_tgt[col]["data_type"]:
            lines.append(f"Column '{col}': data_type {src_label}={sc_src[col]['data_type']} | "
                         f"{tgt_label}={sc_tgt[col]['data_type']}.")
    return lines


def _schema_column_diffs(sc_src, sc_tgt):
    """Structured per-column differences for the UI table. Each entry:
    {column, kind, source_type, target_type}; kind is one of
    'missing_in_target', 'missing_in_source', 'type_diff'."""
    out = []
    for col in sorted(set(sc_src) | set(sc_tgt)):
        in_s, in_t = col in sc_src, col in sc_tgt
        if in_s and not in_t:
            out.append({"column": col, "kind": "missing_in_target",
                        "source_type": sc_src[col]["data_type"], "target_type": None})
        elif in_t and not in_s:
            out.append({"column": col, "kind": "missing_in_source",
                        "source_type": None, "target_type": sc_tgt[col]["data_type"]})
        elif sc_src[col]["data_type"] != sc_tgt[col]["data_type"]:
            out.append({"column": col, "kind": "type_diff",
                        "source_type": sc_src[col]["data_type"],
                        "target_type": sc_tgt[col]["data_type"]})
    return out


# Friendly label columns: when one of these is present, its value is shown next
# to the primary key so a changed row reads e.g. "attribute_id 10 · line_group".
LABEL_COLS = ("attribute_name", "name", "key", "code", "label", "title")
# Cap how many array elements we serialise per added/removed list (payload sane).
MAX_LIST_ELEMS = 200


def _cell(v):
    """JSON-safe display value: None -> None, list -> list of strings, else str."""
    if v is None:
        return None
    if isinstance(v, (list, tuple)):
        return [_scalar(x) for x in v]
    return str(v)


def _scalar(v):
    return None if v is None else str(v)


def _pk_sort_key(k):
    """Sort PKs numerically when possible, else lexically; None last."""
    if k is None:
        return (2, 0, "")
    try:
        return (0, float(k), "")
    except (TypeError, ValueError):
        return (1, 0, str(k))


def _align(sc, s_rows, tc, t_rows, exclude_cols=None):
    """Align two row sets onto common columns (minus EXCLUDE_DATA_COLS and any
    per-table `exclude_cols`). Returns (col_names, s_rows, t_rows) or None when
    there's nothing to compare. The primary-key column (index 0) is never
    dropped, so a user-listed PK is ignored rather than breaking alignment."""
    if sc != tc:
        common = [c for c in sc if c in tc]
        if not common:
            return None
        s_idx = [sc.index(c) for c in common]
        t_idx = [tc.index(c) for c in common]
        s_rows = [tuple(r[i] for i in s_idx) for r in s_rows]
        t_rows = [tuple(r[i] for i in t_idx) for r in t_rows]
        col_names = common
    else:
        col_names = list(sc)

    drop = EXCLUDE_DATA_COLS | set(exclude_cols or ())
    keep = [i for i, c in enumerate(col_names) if i == 0 or c not in drop]
    if len(keep) < len(col_names):
        col_names = [col_names[i] for i in keep]
        s_rows = [tuple(r[i] for i in keep) for r in s_rows]
        t_rows = [tuple(r[i] for i in keep) for r in t_rows]
    return col_names, s_rows, t_rows


def _field_diff(col_names, li, srow, trow):
    """Per-column diff between two same-PK rows. Lists get element-level
    added/removed; scalars get a side-by-side value pair."""
    fields = []
    for i, c in enumerate(col_names):
        if i == 0:
            continue  # PK is identical by construction
        sv, tv = srow[i], trow[i]
        sv_list = isinstance(sv, (list, tuple))
        tv_list = isinstance(tv, (list, tuple))
        if sv_list or tv_list:
            s_items = [_scalar(x) for x in (sv or [])]
            t_items = [_scalar(x) for x in (tv or [])]
            if s_items == t_items:
                continue
            s_set, t_set = set(s_items), set(t_items)
            added = [x for x in s_items if x not in t_set]      # in source, not target
            removed = [x for x in t_items if x not in s_set]    # in target, not source
            field = {
                "column": c, "type": "list",
                "source_count": len(s_items), "target_count": len(t_items),
                "added": added[:MAX_LIST_ELEMS], "added_more": max(0, len(added) - MAX_LIST_ELEMS),
                "removed": removed[:MAX_LIST_ELEMS], "removed_more": max(0, len(removed) - MAX_LIST_ELEMS),
                "reorder_only": (not added and not removed),
            }
        else:
            if _scalar(sv) == _scalar(tv):
                continue
            field = {"column": c, "type": "scalar", "source": _scalar(sv), "target": _scalar(tv)}
        fields.append(field)
    return fields


def _row_brief(col_names, li, row):
    """Compact representation of a whole row for only-in-X listings."""
    return {
        "pk": _scalar(row[0]),
        "label": _scalar(row[li]) if li is not None else None,
        "row": {col_names[i]: _cell(row[i]) for i in range(len(col_names))},
    }


def _data_diff(sc, s_rows, tc, t_rows, src_label, tgt_label, exclude_cols=None):
    """Structured row-level data diff for one static table. Returns a dict with a
    legacy `detail` string plus a structured `data` object, or None when equal.

    The `data` object splits differences into three non-overlapping buckets keyed
    by primary key (first column): `changed` (same PK, differing fields),
    `only_in_source`, and `only_in_target`. This mirrors db_validator STEP 5 but
    removes the old triple-counting where a changed row also appeared as both an
    add and a remove."""
    aligned = _align(sc, s_rows, tc, t_rows, exclude_cols)
    if aligned is None:
        detail = (f"Row count: {src_label}={len(s_rows)}, {tgt_label}={len(t_rows)}\n"
                  "No common columns to compare (schema mismatch).")
        return {"detail": detail, "data": {
            "row_count": {"source": len(s_rows), "target": len(t_rows)},
            "schema_mismatch": True, "changed": [], "only_in_source": [], "only_in_target": []}}
    col_names, s_rows, t_rows = aligned
    if not col_names:
        return None

    li = next((col_names.index(c) for c in LABEL_COLS if c in col_names), None)

    # Drop rows that are byte-identical on both sides (multiset overlap).
    overlap = Counter(_row_to_strs(r) for r in s_rows) & Counter(_row_to_strs(r) for r in t_rows)
    def _remaining(rows):
        budget = overlap.copy()
        out = []
        for r in rows:
            k = _row_to_strs(r)
            if budget[k] > 0:
                budget[k] -= 1
            else:
                out.append(r)
        return out
    rem_src, rem_tgt = _remaining(s_rows), _remaining(t_rows)

    if not rem_src and not rem_tgt:
        return None

    # Group the remaining (differing) rows by primary key to pair up changes.
    src_by_pk, tgt_by_pk = {}, {}
    for r in rem_src:
        src_by_pk.setdefault(_scalar(r[0]), []).append(r)
    for r in rem_tgt:
        tgt_by_pk.setdefault(_scalar(r[0]), []).append(r)

    changed, only_src, only_tgt = [], [], []
    for pk in sorted(set(src_by_pk) | set(tgt_by_pk), key=_pk_sort_key):
        s_list, t_list = src_by_pk.get(pk, []), tgt_by_pk.get(pk, [])
        n = min(len(s_list), len(t_list))
        for idx in range(n):
            fields = _field_diff(col_names, li, s_list[idx], t_list[idx])
            if fields:
                changed.append({
                    "pk": pk,
                    "label": _scalar(s_list[idx][li]) if li is not None else None,
                    "fields": fields,
                })
        for r in s_list[n:]:
            only_src.append(_row_brief(col_names, li, r))
        for r in t_list[n:]:
            only_tgt.append(_row_brief(col_names, li, r))

    data = {
        "row_count": {"source": len(s_rows), "target": len(t_rows)},
        "pk_column": col_names[0],
        "label_column": col_names[li] if li is not None else None,
        "changed": changed,
        "only_in_source": only_src,
        "only_in_target": only_tgt,
        "schema_mismatch": False,
    }
    return {"detail": _data_detail_str(data, src_label, tgt_label), "data": data}


def _data_detail_str(data, src_label, tgt_label):
    """Plain-text rendering of the structured diff (downloadable report / fallback)."""
    rc = data["row_count"]
    lines = [f"Row count: {src_label}={rc['source']}, {tgt_label}={rc['target']}"]
    if data.get("schema_mismatch"):
        lines.append("No common columns to compare (schema mismatch).")
        return "\n".join(lines)
    if data["changed"]:
        lines.append(f"\nChanged rows ({len(data['changed'])}):")
        for ch in data["changed"][:MAX_DETAIL_ROWS]:
            head = f"  {data['pk_column']}={ch['pk']}" + (f" ({ch['label']})" if ch['label'] else "")
            lines.append(head)
            for fl in ch["fields"]:
                if fl["type"] == "list":
                    if fl.get("reorder_only"):
                        lines.append(f"    {fl['column']}: same elements, different order")
                    else:
                        lines.append(f"    {fl['column']}: +{len(fl['added'])} only in {src_label}, "
                                     f"-{len(fl['removed'])} only in {tgt_label}")
                else:
                    lines.append(f"    {fl['column']}: {src_label}={fl['source']!r} | {tgt_label}={fl['target']!r}")
    for bucket, label in (("only_in_source", src_label), ("only_in_target", tgt_label)):
        rows = data[bucket]
        if rows:
            lines.append(f"\nRows only in {label} ({len(rows)}):")
            for br in rows[:MAX_DETAIL_ROWS]:
                lines.append(f"  {data['pk_column']}={br['pk']}" + (f" ({br['label']})" if br['label'] else ""))
            if len(rows) > MAX_DETAIL_ROWS:
                lines.append(f"  ... and {len(rows) - MAX_DETAIL_ROWS} more")
    return "\n".join(lines)


# ── Public entry point ──

def compute_diffs(conns):
    """Build the full migration_diffs payload for Step 3."""
    src = conns.ensure_alive("source")
    tgt = conns.ensure_alive("target")
    s_schema, t_schema = conns.source_schema, conns.target_schema
    src_label, tgt_label = conns.source_env, conns.target_env

    # Reuse the Step 2 classification (static/dynamic + skip flags + presence).
    model = cls.build_model(conns)
    table_meta = {t["name"]: t for t in model["tables"]}
    fn_meta = {(fn["name"], fn["arg_signature"]): fn for fn in model["functions"]}

    src_tables = {t["name"] for t in model["tables"] if t["in_source"]}
    tgt_tables = {t["name"] for t in model["tables"] if t["in_target"]}
    common_tables = src_tables & tgt_tables

    diffs = []

    # 1) Missing tables.
    for name in sorted(src_tables - tgt_tables):
        diffs.append({
            "object_type": "table", "name": name, "category": "missing_in_target",
            "source_present": True, "target_present": False,
            "detail": f"Table {name} exists in {src_label} but is missing in {tgt_label}.",
        })
    for name in sorted(tgt_tables - src_tables):
        diffs.append({
            "object_type": "table", "name": name, "category": "missing_in_source",
            "source_present": False, "target_present": True,
            "detail": f"Table {name} exists in {tgt_label} but is missing in {src_label}.",
        })

    # Tables that actually need a row-level data check (static, common, not
    # skipped). Decided up front so each side fetches exactly the same set.
    data_tables = sorted(
        name for name in common_tables
        if table_meta.get(name, {}).get("classification") == "static"
        and not table_meta.get(name, {}).get("skip_data_check")
    )

    # Gather everything each side needs in ONE pass per connection, and run the
    # two sides in PARALLEL. We hold a single connection per side (queries on one
    # connection must be serial), so source||target is the available speed-up —
    # combined with bulk column fetching this turns hundreds of sequential VPN
    # round trips into a couple per side.
    def _gather(conn, schema):
        cols = _bulk_columns(conn, schema)            # 1 query: all columns
        fns = _get_functions_full(conn, schema)       # 1 query: all functions
        mvs = _get_matviews(conn, schema)             # 1 query: all matviews
        rows = {}                                     # 1 query per static table
        for name in data_tables:
            cnames = list(cols.get(name, OrderedDict()).keys())
            rows[name] = (cnames, _fetch_rows(conn, schema, name, cnames))
        return {"cols": cols, "fns": fns, "mvs": mvs, "rows": rows}

    with ThreadPoolExecutor(max_workers=2) as ex:
        fut_src = ex.submit(_gather, src, s_schema)
        fut_tgt = ex.submit(_gather, tgt, t_schema)
        src_data = fut_src.result()
        tgt_data = fut_tgt.result()

    # 2) Schema diffs (all common tables; skip_schema_check honoured).
    for name in sorted(common_tables):
        meta = table_meta.get(name, {})
        if meta.get("skip_schema_check"):
            continue
        sc_src = src_data["cols"].get(name, OrderedDict())
        sc_tgt = tgt_data["cols"].get(name, OrderedDict())
        col_lines = _schema_detail(sc_src, sc_tgt, src_label, tgt_label)
        if col_lines:
            diffs.append({
                "object_type": "table", "name": name, "category": "schema_diff",
                "source_present": True, "target_present": True,
                "detail": "\n".join(col_lines),
                "column_diffs": _schema_column_diffs(sc_src, sc_tgt),
            })

    # 3) Data diffs (STATIC common tables only; skip_data_check honoured).
    for name in data_tables:
        sc, s_rows = src_data["rows"][name]
        tc, t_rows = tgt_data["rows"][name]
        exclude_cols = table_meta.get(name, {}).get("data_exclude_columns") or []
        result = _data_diff(sc, s_rows, tc, t_rows, src_label, tgt_label, exclude_cols)
        if result:
            diffs.append({
                "object_type": "table", "name": name, "category": "data_diff",
                "source_present": True, "target_present": True,
                "detail": result["detail"],
                "data": result["data"],
                "excluded_columns": list(exclude_cols),
            })

    # 4) Functions / procedures (already gathered above). Mirrors db_validator
    # SECTION E: presence (name) -> parameter (overload variant) -> default-value
    # -> body -> return-type checks.
    src_fns = src_data["fns"]
    tgt_fns = tgt_data["fns"]
    src_names = {k[0] for k in src_fns}   # function names present on each side
    tgt_names = {k[0] for k in tgt_fns}
    all_keys = set(src_fns) | set(tgt_fns)

    def _overload_sigs(fns, nm):
        return sorted(k[1] for k in fns if k[0] == nm)

    def _param_overload(nm, this_arg, present_label, missing_label, other_fns, present_side):
        """Structured payload the frontend renders as a clean parameter
        comparison (one param per line, with the differing params highlighted).

        present_side ('source'|'target') tells the UI which column this exact
        overload belongs to, so it can always lay source out on the left and
        target on the right (consistent with the presence pills)."""
        this_params = cls._split_args(this_arg)
        this_set = set(this_params)
        others = []
        for s in _overload_sigs(other_fns, nm):
            params = cls._split_args(s)
            other_set = set(params)
            others.append({
                "arg_signature": s,
                "params": params,
                # Params this overload has that the present one does not, and
                # vice-versa — lets the UI highlight exactly what changed.
                "added_params": [p for p in params if p not in this_set],
                "removed_params": [p for p in this_params if p not in other_set],
            })
        return {
            "present_in": present_label,
            "missing_in": missing_label,
            "present_side": present_side,  # 'source' | 'target'
            "signature": this_arg,
            "signature_params": this_params,
            "other_overloads": others,
        }

    def _param_detail(nm, this_arg, present_label, missing_label, other_fns):
        """Readable multi-line fallback (also used in the exported CSV)."""
        lines = [
            f"Overload mismatch for '{nm}':",
            f"  - Present in {present_label}: ({this_arg or 'no parameters'})",
            f"  - Missing in {missing_label}",
            f"  {missing_label} has '{nm}' with:",
        ]
        for s in _overload_sigs(other_fns, nm):
            lines.append(f"      ({s or 'no parameters'})")
        return "\n".join(lines)

    for key in sorted(all_keys):
        name, arg = key
        in_s, in_t = key in src_fns, key in tgt_fns
        info = src_fns.get(key) or tgt_fns.get(key)
        otype = info["kind"]  # 'function' | 'procedure'

        # On one side only. db_validator distinguishes PRESENCE (the whole name
        # is absent) from PARAMETER (the name exists on both sides but this
        # overload signature does not) — so do we.
        if in_s and not in_t:
            if name in tgt_names:
                diffs.append({
                    "object_type": otype, "name": name, "arg_signature": arg,
                    "category": "param_diff", "source_present": True, "target_present": False,
                    "source_body": src_fns[key]["body"],
                    "param_overload": _param_overload(name, arg, src_label, tgt_label, tgt_fns, "source"),
                    "detail": _param_detail(name, arg, src_label, tgt_label, tgt_fns),
                })
            else:
                diffs.append({
                    "object_type": otype, "name": name, "arg_signature": arg,
                    "category": "missing_in_target", "source_present": True, "target_present": False,
                    "source_body": src_fns[key]["body"],
                    "detail": f"{otype.capitalize()} {name}({arg}) exists in {src_label} "
                              f"but is missing in {tgt_label}.",
                })
            continue
        if in_t and not in_s:
            if name in src_names:
                diffs.append({
                    "object_type": otype, "name": name, "arg_signature": arg,
                    "category": "param_diff", "source_present": False, "target_present": True,
                    "target_body": tgt_fns[key]["body"],
                    "param_overload": _param_overload(name, arg, tgt_label, src_label, src_fns, "target"),
                    "detail": _param_detail(name, arg, tgt_label, src_label, src_fns),
                })
            else:
                diffs.append({
                    "object_type": otype, "name": name, "arg_signature": arg,
                    "category": "missing_in_source", "source_present": False, "target_present": True,
                    "target_body": tgt_fns[key]["body"],
                    "detail": f"{otype.capitalize()} {name}({arg}) exists in {tgt_label} "
                              f"but is missing in {src_label}.",
                })
            continue

        # Common to both sides. Run default-value + return-type + body checks.
        # skip_body_check (Step 2) only suppresses the BODY comparison, exactly
        # as in the notebook — default/return checks still run.
        s, t = src_fns[key], tgt_fns[key]
        skip_body = bool(fn_meta.get(key, {}).get("skip_body_check"))
        default_diffs = _default_diffs(s["args_full"], t["args_full"], src_label, tgt_label)
        rt_differs = s["return_type"] != t["return_type"]
        body_differs = (not skip_body) and (_canonical(s["body"]) != _canonical(t["body"]))
        if not body_differs and not rt_differs and not default_diffs:
            continue

        # One row per function; category reflects the most significant change
        # (body > return type > default), detail lists every failing check.
        if body_differs:
            category = "body_diff"
        elif rt_differs:
            category = "return_type_diff"
        else:
            category = "default_diff"
        parts = []
        if rt_differs:
            parts.append(f"Return type differs: {src_label}={s['return_type']} | "
                         f"{tgt_label}={t['return_type']}.")
        if default_diffs:
            parts.append("Default values differ — " + " | ".join(default_diffs) + ".")
        if body_differs:
            parts.append(f"{otype.capitalize()} body differs between {src_label} and {tgt_label}.")

        diffs.append({
            "object_type": otype, "name": name, "arg_signature": arg,
            "category": category, "source_present": True, "target_present": True,
            "source_body": s["body"], "target_body": t["body"],
            "detail": " ".join(parts),
        })

    # 5) Materialized views (mirror db_validator SECTION C): presence + definition
    # diff only. No CSV/SQL export for matviews yet — format pending from Sushen.
    src_mvs = src_data["mvs"]
    tgt_mvs = tgt_data["mvs"]
    for name in sorted(set(src_mvs) | set(tgt_mvs)):
        in_s, in_t = name in src_mvs, name in tgt_mvs
        if in_s and not in_t:
            diffs.append({
                "object_type": "matview", "name": name, "category": "missing_in_target",
                "source_present": True, "target_present": False,
                "source_body": src_mvs[name],
                "detail": f"Materialized view {name} exists in {src_label} "
                          f"but is missing in {tgt_label}.",
            })
        elif in_t and not in_s:
            diffs.append({
                "object_type": "matview", "name": name, "category": "missing_in_source",
                "source_present": False, "target_present": True,
                "target_body": tgt_mvs[name],
                "detail": f"Materialized view {name} exists in {tgt_label} "
                          f"but is missing in {src_label}.",
            })
        elif _norm_mv_def(src_mvs[name]) != _norm_mv_def(tgt_mvs[name]):
            diffs.append({
                "object_type": "matview", "name": name, "category": "definition_diff",
                "source_present": True, "target_present": True,
                "source_body": src_mvs[name], "target_body": tgt_mvs[name],
                "detail": f"Materialized view definition differs between {src_label} and {tgt_label}.",
            })
        else:
            # Identical matview. Unlike tables/functions (diff-only), matviews are
            # ALWAYS listed with a status so the section always appears for the
            # selected envs — mirroring db_validator's matview status report.
            # 'identical' is excluded from the differences count and not exported.
            diffs.append({
                "object_type": "matview", "name": name, "category": "identical",
                "source_present": True, "target_present": True,
                "source_body": src_mvs[name], "target_body": tgt_mvs[name],
                "detail": f"Materialized view definition is identical in {src_label} and {tgt_label}.",
            })

    by_type = {}
    for d in diffs:
        by_type[d["object_type"]] = by_type.get(d["object_type"], 0) + 1

    # total_diffs counts every listed row so the UI's "All" pill matches what's
    # shown. 'identical' matviews are listed (for visibility) but the frontend
    # styles them distinctly and excludes them from export.
    return {
        "source": {"label": src_label, "schema": s_schema},
        "target": {"label": tgt_label, "schema": t_schema},
        "summary": {"total_diffs": len(diffs), "by_object_type": by_type},
        "diffs": diffs,
    }
