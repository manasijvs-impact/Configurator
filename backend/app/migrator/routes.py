"""Migrator API routes (added).

Mounted onto the existing FastAPI app via a single additive
`app.include_router(migrator_router)` line in main.py. All paths are namespaced
under /api/migrator so they never collide with the Configurator's routes.
"""
from concurrent.futures import ThreadPoolExecutor

import psycopg
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .connections import migrator_conns, ENVIRONMENTS
from . import classification as cls
from . import diffs as diff_engine
from . import export as export_engine
from . import inventory as inventory_engine
from . import ref_integrity as ref_integrity_engine

router = APIRouter(prefix="/api/migrator", tags=["migrator"])

# Default name prefixes excluded from discovery (mirrors db_validator
# EXCLUDE_PREFIXES). Used only when the UI doesn't supply its own.
DEFAULT_EXCLUDE_PREFIXES = ("temp_", "unlogged_", "bp_unlogged_")


def _parse_prefixes(raw: str):
    """Parse the UI 'Exclude prefixes' string (comma-separated) into a tuple."""
    if not raw:
        return DEFAULT_EXCLUDE_PREFIXES
    parts = tuple(p.strip() for p in raw.split(",") if p.strip())
    return parts or DEFAULT_EXCLUDE_PREFIXES


class MigratorConnectRequest(BaseModel):
    username: str
    password: str
    source_env: str
    target_env: str
    source_schema: str = "base_pricing"
    target_schema: str = "base_pricing"
    # Run-config knobs from Step 1 (mirror db_validator.py).
    threshold_table: str = "bp_template_attributes_mapping"
    exclude_prefixes: str = "temp_, unlogged_, bp_unlogged_"
    stale_days: int = 30


def _friendly_pg_error(e: Exception) -> str:
    msg = str(e)
    low = msg.lower()
    if "password authentication failed" in low:
        return "Authentication failed. Please check your username and password."
    if "could not connect" in low or "connection refused" in low or "timeout" in low:
        return ("Could not reach the database host. Are you on the VPN / internal "
                "network? (Migrator hosts are internal 10.x addresses.)")
    if "does not exist" in low:
        return "Database or role does not exist for the selected environment."
    return msg


@router.get("/envs")
def list_envs():
    """Env list for the Step 1 dropdowns (non-secret details only)."""
    return {
        "envs": [
            {"name": n, "label": f"{e['client']} · {e['tier']}",
             "host": e["host"], "db": e["db"], "role": e["role"]}
            for n, e in ENVIRONMENTS.items()
        ]
    }


@router.post("/connect")
def connect(req: MigratorConnectRequest):
    """Step 1: open persistent source + target connections."""
    try:
        result = migrator_conns.connect(
            username=req.username,
            password=req.password,
            source_env=req.source_env,
            target_env=req.target_env,
            source_schema=req.source_schema,
            target_schema=req.target_schema,
            threshold_table=req.threshold_table,
            exclude_prefixes=_parse_prefixes(req.exclude_prefixes),
            stale_days=req.stale_days,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (psycopg.OperationalError, psycopg.Error) as e:
        raise HTTPException(status_code=400, detail=_friendly_pg_error(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
def status():
    return migrator_conns.status()


@router.post("/disconnect")
def disconnect():
    migrator_conns.disconnect()
    return {"success": True, "message": "Disconnected"}


def _list_objects(conn, schema: str, exclude_prefixes=DEFAULT_EXCLUDE_PREFIXES) -> dict:
    """Discover tables + functions for a schema, mirroring db_validator.py.

    Tables: permanent (relpersistence='p'), regular ('r') + partitioned parents
    ('p'), excluding partition children and the exclude_prefixes names (driven by
    the Step 1 'Exclude prefixes' field). This is why temp/unlogged tables no
    longer appear (information_schema showed them).

    Functions/procedures: from pg_proc with prokind in ('f','p')."""
    with conn.cursor() as cur:
        # Tables — db_validator.get_tables()
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
        tables = [
            r["name"] for r in cur.fetchall()
            if not any(r["name"].startswith(p) for p in exclude_prefixes)
        ]
        # Functions + procedures — db_validator.get_functions()
        cur.execute(
            """
            SELECT p.proname AS name,
                   CASE p.prokind WHEN 'f' THEN 'FUNCTION'
                                  WHEN 'p' THEN 'PROCEDURE'
                                  ELSE p.prokind::text END AS kind
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = %s
              AND p.prokind IN ('f', 'p')
            ORDER BY p.proname
            """,
            (schema,),
        )
        functions = [{"name": r["name"], "kind": r["kind"]} for r in cur.fetchall()]
    return {"tables": tables, "functions": functions}


@router.get("/objects")
def objects():
    """Step 2: list tables + functions on both source and target."""
    if not migrator_conns.is_connected():
        raise HTTPException(status_code=409, detail="Not connected. Complete Step 1 first.")
    try:
        # Query both sides in parallel (each with its own schema) to roughly
        # halve the round-trip time.
        prefixes = migrator_conns.exclude_prefixes
        def fetch(which, schema):
            return _list_objects(migrator_conns.ensure_alive(which), schema, prefixes)
        with ThreadPoolExecutor(max_workers=2) as ex:
            fut_src = ex.submit(fetch, "source", migrator_conns.source_schema)
            fut_tgt = ex.submit(fetch, "target", migrator_conns.target_schema)
            src = fut_src.result()
            tgt = fut_tgt.result()
    except Exception as e:
        raise HTTPException(status_code=500, detail=_friendly_pg_error(e))
    return {
        "source_env": migrator_conns.source_env,
        "target_env": migrator_conns.target_env,
        "source_schema": migrator_conns.source_schema,
        "target_schema": migrator_conns.target_schema,
        "source": src,
        "target": tgt,
    }


@router.get("/classification")
def get_classification():
    """Step 2: discover tables/functions and merge with the persisted CSVs.

    Returns the effective classification (override or auto), skip flags, NEW
    detection, presence per side, and row counts — the interactive equivalent of
    db_validator.py's table/function classification CSVs."""
    if not migrator_conns.is_connected():
        raise HTTPException(status_code=409, detail="Not connected. Complete Step 1 first.")
    try:
        return cls.build_model(migrator_conns)
    except Exception as e:
        raise HTTPException(status_code=500, detail=_friendly_pg_error(e))


class ClassificationSaveRequest(BaseModel):
    tables: list = []
    functions: list = []


@router.post("/classification")
def save_classification(req: ClassificationSaveRequest):
    """Persist user edits (static/dynamic overrides + skip flags) to the shared
    notebook-format CSVs in ~/Downloads."""
    if not migrator_conns.is_connected():
        raise HTTPException(status_code=409, detail="Not connected. Complete Step 1 first.")
    try:
        model = cls.build_model(migrator_conns)
        model = cls.apply_edits(model, {"tables": req.tables, "functions": req.functions})
        cls.write_model(model)
        return model
    except Exception as e:
        raise HTTPException(status_code=500, detail=_friendly_pg_error(e))


@router.get("/table-columns")
def table_columns(table: str):
    """Ordered column names for one table — backs the Step 2 'exclude columns
    from data check' multiselect. Reads from the source schema (master), falling
    back to the target schema if the table only exists there."""
    if not migrator_conns.is_connected():
        raise HTTPException(status_code=409, detail="Not connected. Complete Step 1 first.")
    try:
        src = migrator_conns.ensure_alive("source")
        cols = cls.get_table_columns(src, migrator_conns.source_schema, table)
        if not cols:
            tgt = migrator_conns.ensure_alive("target")
            cols = cls.get_table_columns(tgt, migrator_conns.target_schema, table)
        return {"table": table, "columns": cols}
    except Exception as e:
        raise HTTPException(status_code=500, detail=_friendly_pg_error(e))


@router.get("/diffs")
def diffs():
    """Step 3: source vs target differences.

    Mirrors db_validator.py's comparison engine and reuses the Step 2
    classification (static/dynamic + skip flags) so the same decisions made in
    Step 2 / the shared CSVs drive what gets compared:
      - tables: missing, schema (columns), data (static only)
      - functions/procedures: missing, return type, body (canonical)
    """
    if not migrator_conns.is_connected():
        raise HTTPException(status_code=409, detail="Not connected. Complete Step 1 first.")
    try:
        return diff_engine.compute_diffs(migrator_conns)
    except Exception as e:
        raise HTTPException(status_code=500, detail=_friendly_pg_error(e))


class MigratorExportItem(BaseModel):
    object_type: str
    name: str
    arg_signature: str = ""
    category: str
    winner: str = "source"  # 'source' | 'target' — env whose version we keep


class MigratorExportRequest(BaseModel):
    items: list[MigratorExportItem] = []


@router.post("/export")
def export(req: MigratorExportRequest):
    """Step 3: generate Liquibase .sql changesets (tables, functions/procedures)
    and seed-data CSVs (static-table data diffs) from the chosen winners.

    Ports liquibase_export.py + data_export.py onto the live source/target
    connections. Read-only on the databases — returns file contents in the
    response; nothing is written to disk or applied. Matviews are deferred
    (format pending) and returned as notes."""
    if not migrator_conns.is_connected():
        raise HTTPException(status_code=409, detail="Not connected. Complete Step 1 first.")
    if not req.items:
        raise HTTPException(status_code=400, detail="No objects selected for export.")
    try:
        return export_engine.generate(migrator_conns, [i.model_dump() for i in req.items])
    except Exception as e:
        raise HTTPException(status_code=500, detail=_friendly_pg_error(e))


@router.get("/inventory")
def inventory():
    """Table + function inventory (db_validator Sections A & D). Refreshes the
    4 per-side inventory CSVs in ~/Downloads as a side effect and returns the
    merged source/target view with last-seen tracking."""
    if not migrator_conns.is_connected():
        raise HTTPException(status_code=409, detail="Not connected. Complete Step 1 first.")
    try:
        return inventory_engine.build_inventory(migrator_conns)
    except Exception as e:
        raise HTTPException(status_code=500, detail=_friendly_pg_error(e))


@router.get("/ref-integrity")
def ref_integrity():
    """Reference-integrity check (db_validator SECTION F, TARGET only). Parses
    every target function/procedure body and flags table references that cannot
    be resolved to a real object. Writes reference_integrity_*.csv + universe
    CSV to ~/Downloads and returns the structured summary + per-function rows."""
    if not migrator_conns.is_connected():
        raise HTTPException(status_code=409, detail="Not connected. Complete Step 1 first.")
    try:
        return ref_integrity_engine.build(migrator_conns)
    except Exception as e:
        raise HTTPException(status_code=500, detail=_friendly_pg_error(e))


@router.get("/activity")
def activity():
    """TEMPORARY diagnostic: is anything actively running / ingesting on the
    source & target databases right now? Reads pg_stat_activity (read-only).
    Source and target may share a cluster, so we query via the source link and
    filter by datname for both DBs. Remove later."""
    if not migrator_conns.is_connected():
        raise HTTPException(status_code=409, detail="Not connected. Complete Step 1 first.")
    try:
        conn = migrator_conns.ensure_alive("source")
        dbs = sorted({migrator_conns.source_env, migrator_conns.target_env})
        with conn.cursor() as cur:
            # Per-DB / per-state session counts.
            cur.execute(
                """
                SELECT datname, state, count(*) AS n
                FROM pg_stat_activity
                WHERE datname = ANY(%s)
                GROUP BY datname, state
                ORDER BY datname, state
                """,
                (dbs,),
            )
            by_state = [dict(r) for r in cur.fetchall()]

            # Active (running) statements — the real "is work happening" signal.
            cur.execute(
                """
                SELECT datname, pid, usename, state, wait_event_type, wait_event,
                       date_trunc('second', now() - query_start)::text AS running_for,
                       date_trunc('second', now() - xact_start)::text  AS xact_age,
                       left(regexp_replace(query, '\\s+', ' ', 'g'), 240) AS query
                FROM pg_stat_activity
                WHERE datname = ANY(%s)
                  AND pid <> pg_backend_pid()
                  AND state <> 'idle'
                ORDER BY query_start NULLS LAST
                """,
                (dbs,),
            )
            active = [dict(r) for r in cur.fetchall()]

        # Heuristic: which active statements look like data ingestion / writes.
        write_kw = ("insert", "update", "delete", "copy", "merge",
                    "truncate", "create table", "refresh materialized")
        for a in active:
            q = (a.get("query") or "").lstrip().lower()
            a["is_write"] = any(q.startswith(k) or k in q[:40] for k in write_kw)
        ingesting = [a for a in active if a["is_write"]]

        return {
            "databases_checked": dbs,
            "session_counts_by_state": by_state,
            "active_statements": active,
            "ingestion_detected": bool(ingesting),
            "ingestion_statements": ingesting,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=_friendly_pg_error(e))


@router.get("/fn-debug")
def fn_debug():
    """TEMPORARY diagnostic: compare the app's LIVE function discovery (per side
    + union) against the persisted function_classification CSV, to explain any
    count mismatch (e.g. app=203 vs CSV=208). Safe/read-only. Remove later."""
    import csv as _csv
    import os as _os
    if not migrator_conns.is_connected():
        raise HTTPException(status_code=409, detail="Not connected. Complete Step 1 first.")
    try:
        src = migrator_conns.ensure_alive("source")
        tgt = migrator_conns.ensure_alive("target")
        src_fns = cls._discover_functions(src, migrator_conns.source_schema)
        tgt_fns = cls._discover_functions(tgt, migrator_conns.target_schema)
        union = set(src_fns) | set(tgt_fns)

        _, fn_csv = cls.csv_paths(migrator_conns)
        csv_keys = set()
        if _os.path.exists(fn_csv):
            with open(fn_csv, "r", newline="", encoding="utf-8") as fh:
                for r in _csv.DictReader(fh):
                    csv_keys.add((r["function_name"], r["arg_signature"]))

        def _fmt(keys):
            return sorted(f"{n}({a})" for n, a in keys)

        return {
            "source_env": migrator_conns.source_env,
            "target_env": migrator_conns.target_env,
            "csv_path": fn_csv,
            "counts": {
                "source_live": len(src_fns),
                "target_live": len(tgt_fns),
                "union_live": len(union),
                "csv_rows": len(csv_keys),
            },
            "in_csv_not_live": _fmt(csv_keys - union),
            "in_live_not_csv": _fmt(union - csv_keys),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=_friendly_pg_error(e))
