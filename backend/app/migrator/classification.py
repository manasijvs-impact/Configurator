"""Classification store for the Migrator (Step 2).

This is the interactive equivalent of hand-editing db_validator.py's
`table_classification_<schema>_<src>_vs_<tgt>.csv` (and the function variant).

- DISCOVERY comes from the live DBs (same pg_class / pg_proc queries the
  notebook uses), so newly-added tables/functions appear automatically.
- PERSISTENCE uses the SAME CSV files the notebook reads/writes, in the same
  ~/Downloads location and column format (Option A). So edits made in this UI
  and edits made in the notebook share one source of truth.

Effective classification mirrors the notebook exactly:
    auto           = 'static' if max(source_rows, target_rows) < threshold else 'dynamic'
    threshold      = max(rowcount(threshold_table) on each side), default 1000
    classification = classification_override  if the user pinned one, else auto
A table is NEW when it has no prior `created_at` in the CSV (first time seen).
"""
import csv
import os
import re
from datetime import datetime

from psycopg import sql

# Where the notebook writes its CSVs.
REPORT_DIR = os.path.expanduser("~/Downloads")

TABLE_CLASSIFICATION_FIELDS = [
    "table_name", "classification", "classification_override",
    "skip_data_check", "skip_schema_check", "data_check_exclude_columns",
    "source_rows", "target_rows", "created_at", "updated_at",
]

# Delimiter for the pipe-separated `data_check_exclude_columns` CSV cell — a
# per-table list of column names to ignore during the row-level data check
# (in addition to the global EXCLUDE_DATA_COLS). Pipe avoids clashing with the
# comma CSV separator. Hand-editable in the CSV and via the Step 2 UI.
EXCL_COLS_SEP = "|"


def parse_exclude_columns(raw):
    """'a|b| c ' -> ['a', 'b', 'c'] (trimmed, de-duped, order preserved)."""
    out, seen = [], set()
    for part in (raw or "").split(EXCL_COLS_SEP):
        c = part.strip()
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def join_exclude_columns(cols):
    """['a', 'b'] -> 'a|b' (inverse of parse_exclude_columns)."""
    return EXCL_COLS_SEP.join(parse_exclude_columns(EXCL_COLS_SEP.join(cols or [])))


FUNCTION_CLASSIFICATION_FIELDS = [
    "schema_name", "function_name", "arg_signature", "kind",
    "skip_body_check", "created_at", "updated_at",
]

# Curated master-static list (42 tables in base_pricing). A discovered table
# DEFAULTS to 'static' iff its name is in this set, otherwise 'dynamic'. This is
# only the starting default — a saved classification_override always wins.
# Mirrors STATIC_SEED in the frontend seeds.js / diff_viewer.html mockup.
STATIC_SEED = frozenset({
    "bp_app_status_master", "bp_actions", "bp_bucket_config", "bp_channel_config",
    "bp_channel_cost_logic_config", "bp_comparison_types", "bp_competitor_attributes_metadata",
    "bp_customer_segment_config", "bp_customer_segment_master", "bp_grouping_type_level",
    "bp_ongoing_strategy_action_status_transitions", "bp_price_bucket_details",
    "bp_product_attributes_metadata", "bp_product_hierarchy_level",
    "bp_product_store_attributes_metadata", "bp_reporting_attributes_metadata",
    "bp_rule_attributes_metadata", "bp_rule_types", "bp_scope_level", "bp_screen_hierarchies",
    "bp_store_attributes_metadata", "bp_store_hierarchy_level", "bp_strategy_status_level",
    "bp_sync_status", "bp_table_metadata", "bp_table_view_template_mapping",
    "bp_template_attributes_mapping", "bp_templates_metadata", "bp_validation",
    "bp_view_type_metadata", "bp_strategy_current_stage_level", "bp_notifier_config",
    "bp_upcoming_strategy_action_status_transitions", "bp_kpi_metrics_config",
    "bp_decision_dashboard_kpi_metrics", "bp_product_group_attributes_metadata",
    "bp_store_group_attributes_metadata", "bp_strategy_price_recommendation_attributes_metadata",
    "bp_suffixes_metadata", "bp_zone_attributes_metadata", "bp_forecast_kpi_meta",
    "bp_forecast_cal_config",
})


def _slugs(source_schema, target_schema, source_env, target_env):
    """Reproduce the notebook's filename slugs so we share the same files."""
    if source_schema == target_schema:
        schema_slug = source_schema.replace(".", "_")
    else:
        schema_slug = f"{source_schema}_vs_{target_schema}".replace(".", "_")
    compare_slug = f"{source_env}_vs_{target_env}".lower()
    return schema_slug, compare_slug


def csv_paths(conns):
    schema_slug, compare_slug = _slugs(
        conns.source_schema, conns.target_schema, conns.source_env, conns.target_env)
    table_csv = os.path.join(REPORT_DIR, f"table_classification_{schema_slug}_{compare_slug}.csv")
    fn_csv = os.path.join(REPORT_DIR, f"function_classification_{schema_slug}_{compare_slug}.csv")
    return table_csv, fn_csv


# ── Discovery (mirrors db_validator.get_tables / get_functions) ──

def _discover_tables(conn, schema, exclude_prefixes):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.relname AS name
            FROM pg_class c
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = %s
              AND c.relkind IN ('r', 'p')
              AND c.relispartition = false
              AND c.relpersistence = 'p'
            ORDER BY c.relname
            """,
            (schema,),
        )
        return [
            r["name"] for r in cur.fetchall()
            if not any(r["name"].startswith(p) for p in exclude_prefixes)
        ]


def get_table_columns(conn, schema, table):
    """Ordered column names for one table (for the Step 2 exclude-columns
    multiselect). Empty list if the table isn't found in this schema."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
            """,
            (schema, table),
        )
        return [r["column_name"] for r in cur.fetchall()]


def _row_estimates(conn, schema):
    """{table_name: estimated_rows} via pg_class.reltuples (fast, no scans)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.relname AS name, c.reltuples::bigint AS rows
            FROM pg_class c
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE n.nspname = %s
              AND c.relkind IN ('r', 'p')
              AND c.relispartition = false
              AND c.relpersistence = 'p'
            """,
            (schema,),
        )
        return {r["name"]: int(r["rows"]) for r in cur.fetchall()}


def _exact_count(conn, schema, table):
    """Exact COUNT(*) fallback for never-analyzed tables (reltuples < 0)."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                sql.SQL("SELECT count(*) AS n FROM {}.{}").format(
                    sql.Identifier(schema), sql.Identifier(table))
            )
            return int(cur.fetchone()["n"])
    except Exception:
        return -1


# ── Argument-signature helpers (mirror db_validator.py exactly) ──
# The notebook keys functions by (name, args_no_default): the argument list with
# any `DEFAULT ...` clauses stripped. This is what goes into the classification
# CSV's arg_signature column, so we must produce the identical string.

_DEFAULT_RE = re.compile(r"\s+DEFAULT\s+", re.IGNORECASE)


def _split_args(args_str):
    """Split a pg_get_function_arguments string by top-level commas."""
    if not args_str:
        return []
    parts, current, depth, in_quote = [], [], 0, False
    for c in args_str:
        if c == "'":
            in_quote = not in_quote
            current.append(c)
        elif not in_quote and c == "(":
            depth += 1; current.append(c)
        elif not in_quote and c == ")":
            depth -= 1; current.append(c)
        elif not in_quote and depth == 0 and c == ",":
            parts.append("".join(current).strip()); current = []
        else:
            current.append(c)
    if current:
        parts.append("".join(current).strip())
    return parts


def _args_no_default(args_str):
    out = []
    for p in _split_args(args_str):
        m = _DEFAULT_RE.search(p)
        out.append((p[:m.start()] if m else p).strip())
    return ", ".join(out)


def _extract_default(param):
    """Split one parameter into (struct_without_default, default_expr_or_None).
    Mirrors db_validator.py extract_default."""
    m = _DEFAULT_RE.search(param)
    if not m:
        return (param.strip(), None)
    return (param[:m.start()].strip(), param[m.end():].strip())


def _args_default_map(args_str):
    """{param_struct: default_expr_or_None} for one function's arg list.
    Mirrors db_validator.py args_default_map (used by the DEFAULT-value check)."""
    out = {}
    for p in _split_args(args_str):
        struct, default = _extract_default(p)
        out[struct] = default
    return out


def _discover_functions(conn, schema):
    """{(name, arg_signature): kind} for functions + procedures.

    arg_signature is the no-default argument list (matches db_validator.py's
    function classification CSV key)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.proname AS name,
                   pg_get_function_arguments(p.oid) AS args_str,
                   CASE p.prokind WHEN 'f' THEN 'function'
                                  WHEN 'p' THEN 'procedure'
                                  ELSE p.prokind::text END AS kind
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = %s
              AND p.prokind IN ('f', 'p')
            ORDER BY p.proname, pg_get_function_arguments(p.oid)
            """,
            (schema,),
        )
        return {(r["name"], _args_no_default(r["args_str"] or "")): r["kind"]
                for r in cur.fetchall()}


# ── CSV load helpers ──

def _load_table_csv(path):
    out = {}
    if os.path.exists(path):
        with open(path, "r", newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                out[row["table_name"]] = row
    return out


def _load_function_csv(path):
    out = {}
    if os.path.exists(path):
        with open(path, "r", newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                out[(row["function_name"], row["arg_signature"])] = row
    return out


# ── Build the merged model (discovery + persisted overrides) ──

def build_model(conns):
    """Discover both sides, merge with the persisted CSVs, return the model."""
    src = conns.ensure_alive("source")
    tgt = conns.ensure_alive("target")
    s_schema, t_schema = conns.source_schema, conns.target_schema
    prefixes = conns.exclude_prefixes
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    src_tables = set(_discover_tables(src, s_schema, prefixes))
    tgt_tables = set(_discover_tables(tgt, t_schema, prefixes))
    src_est = _row_estimates(src, s_schema)
    tgt_est = _row_estimates(tgt, t_schema)

    thr_tbl = conns.threshold_table

    table_csv, fn_csv = csv_paths(conns)
    existing_tc = _load_table_csv(table_csv)
    existing_fc = _load_function_csv(fn_csv)

    # Always include the full curated static list so the Static view shows all
    # 42, even if a seed table isn't present in the connected DBs (flagged
    # present=false). Discovered tables are added on top.
    tables = []
    for name in sorted(src_tables | tgt_tables | STATIC_SEED):
        in_src, in_tgt = name in src_tables, name in tgt_tables
        present = in_src or in_tgt
        # Row estimates via fast pg_class.reltuples only (no per-table COUNT(*),
        # which would be hundreds of round-trips). Kept for reference/export.
        u = src_est.get(name, -1) if in_src else -1
        p = tgt_est.get(name, -1) if in_tgt else -1

        # Default classification = curated master-static list (42). A saved
        # override always wins. (Row-count threshold is NOT used for the default.)
        auto = "static" if name in STATIC_SEED else "dynamic"

        prev = existing_tc.get(name, {})
        override = (prev.get("classification_override") or "").strip().lower()
        if override not in ("static", "dynamic"):
            override = ""
        classification = override or auto
        created_at = (prev.get("created_at") or "").strip()
        is_new = not created_at

        tables.append({
            "name": name,
            "classification": classification,
            "auto": auto,
            "override": override,
            "skip_data_check": (prev.get("skip_data_check") or "").strip().lower() == "yes",
            "skip_schema_check": (prev.get("skip_schema_check") or "").strip().lower() == "yes",
            "data_exclude_columns": parse_exclude_columns(prev.get("data_check_exclude_columns")),
            "source_rows": u if u >= 0 else None,
            "target_rows": p if p >= 0 else None,
            "in_source": in_src,
            "in_target": in_tgt,
            "present": present,
            "is_new": is_new,
            "created_at": created_at or now,
        })

    src_fns = _discover_functions(src, s_schema)
    tgt_fns = _discover_functions(tgt, t_schema)
    functions = []
    for key in sorted(set(src_fns) | set(tgt_fns)):
        name, arg = key
        kind = src_fns.get(key) or tgt_fns.get(key)
        prev = existing_fc.get(key, {})
        created_at = (prev.get("created_at") or "").strip()
        functions.append({
            "name": name,
            "arg_signature": arg,
            "kind": kind,
            "skip_body_check": (prev.get("skip_body_check") or "").strip().lower() == "yes",
            "in_source": key in src_fns,
            "in_target": key in tgt_fns,
            "is_new": not created_at,
            "created_at": created_at or now,
        })

    return {
        "source_env": conns.source_env,
        "target_env": conns.target_env,
        "source_schema": s_schema,
        "target_schema": t_schema,
        "threshold_table": thr_tbl,
        "static_seed_count": len(STATIC_SEED),
        "stale_days": conns.stale_days,
        "table_csv_path": table_csv,
        "function_csv_path": fn_csv,
        "tables": tables,
        "functions": functions,
    }


def apply_edits(model, edits):
    """Apply user toggles (override + skip flags) onto a freshly-built model."""
    t_edits = {e["name"]: e for e in (edits.get("tables") or [])}
    for t in model["tables"]:
        e = t_edits.get(t["name"])
        if e is None:
            continue
        override = (e.get("override") or "").strip().lower()
        if override not in ("static", "dynamic"):
            override = ""
        t["override"] = override
        t["classification"] = override or t["auto"]
        if "skip_data_check" in e:
            t["skip_data_check"] = bool(e["skip_data_check"])
        if "skip_schema_check" in e:
            t["skip_schema_check"] = bool(e["skip_schema_check"])
        if "data_exclude_columns" in e:
            t["data_exclude_columns"] = parse_exclude_columns(
                EXCL_COLS_SEP.join(e["data_exclude_columns"] or []))

    f_edits = {(e["name"], e.get("arg_signature", "")): e for e in (edits.get("functions") or [])}
    for fn in model["functions"]:
        e = f_edits.get((fn["name"], fn["arg_signature"]))
        if e is None:
            continue
        if "skip_body_check" in e:
            fn["skip_body_check"] = bool(e["skip_body_check"])
    return model


def write_model(model):
    """Persist the model to the notebook-format CSVs (shared source of truth)."""
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with open(model["table_csv_path"], "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=TABLE_CLASSIFICATION_FIELDS)
        w.writeheader()
        for t in model["tables"]:
            # Don't persist seed tables that aren't in either DB — keeps the
            # shared CSV identical to what the notebook would write (discovered
            # tables only). These are a UI-only display of the curated 42.
            if t.get("present") is False:
                continue
            w.writerow({
                "table_name": t["name"],
                "classification": t["classification"],
                "classification_override": t["override"],
                "skip_data_check": "yes" if t["skip_data_check"] else "",
                "skip_schema_check": "yes" if t["skip_schema_check"] else "",
                "data_check_exclude_columns": join_exclude_columns(t.get("data_exclude_columns")),
                "source_rows": t["source_rows"] if t["source_rows"] is not None else "N/A",
                "target_rows": t["target_rows"] if t["target_rows"] is not None else "N/A",
                "created_at": t["created_at"],
                "updated_at": now,
            })

    schema_label = (model["source_schema"] if model["source_schema"] == model["target_schema"]
                    else f"{model['source_schema']} -> {model['target_schema']}")
    with open(model["function_csv_path"], "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FUNCTION_CLASSIFICATION_FIELDS)
        w.writeheader()
        for fn in model["functions"]:
            w.writerow({
                "schema_name": schema_label,
                "function_name": fn["name"],
                "arg_signature": fn["arg_signature"],
                "kind": fn["kind"],
                "skip_body_check": "yes" if fn["skip_body_check"] else "",
                "created_at": fn["created_at"],
                "updated_at": now,
            })
    return model
