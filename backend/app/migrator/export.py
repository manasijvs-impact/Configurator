"""SQL/CSV export for the Migrator (Step 3 → "Generate SQL").

Ports the repo's reference exporters into the backend, adapted to our psycopg3
source/target connection pair:
  - liquibase_export.py  → tables (CREATE / ALTER) and functions/procedures
    (DROP + CREATE), as Liquibase-formatted .sql changesets.
  - data_export.py       → static-table DATA diffs as a per-table seed CSV
    snapshot of the WINNING environment.

For every selected diff the caller passes a WINNER (the env whose version we
keep). We read the winning object's definition/data from the winner connection
and generate the change that brings the OTHER (losing) env in line:
  - missing_in_target / missing_in_source → CREATE on the missing side.
  - schema_diff  → ALTER the losing table's columns to match the winner.
  - body_diff / return_type_diff (fn/proc) → DROP + CREATE from the winner body.
  - data_diff    → full seed CSV snapshot of the winner's rows.

Matviews are generated as the team's Liquibase DO-block changeset (recursive
dependency snapshot → DROP CASCADE → recreate → rebuild dependents), with the
dependency-walk root set to the exported MV's own schema.name.

Everything here is read-only against the databases — it only produces text.
"""
from psycopg.rows import tuple_row

from .connections import ENVIRONMENTS

DEFAULT_CONTEXT = "Release_1_0"
DEFAULT_LABELS = "liquibase_project_start"
DEFAULT_AUTHOR = "manasij.vs@impactanalytics.co"

# DBeaver-style serial shorthand (mirrors liquibase_export._SERIAL).
_SERIAL = {"int2": "serial2", "int4": "serial4", "int8": "serial8"}


# ── Liquibase changeset formatting (pure) ──

def build_header(author, changeset_id, schema, run_on_change=False):
    flags = "stripComments:false splitStatements:false"
    if run_on_change:
        flags += " runOnChange:true"
    return (
        "--liquibase formatted sql\n"
        f"--changeset {author}:{changeset_id} {flags} "
        f"context:{DEFAULT_CONTEXT} labels: {DEFAULT_LABELS}\n"
        f"--comment: changeset for {schema}.{changeset_id}\n"
    )


def export_routine(schema, name, kind, definition, author=DEFAULT_AUTHOR,
                   version=1, identity_args=None):
    """DROP + CREATE changeset for a function/procedure (runOnChange)."""
    kind = kind.upper()
    if kind not in ("FUNCTION", "PROCEDURE"):
        raise ValueError(f"kind must be FUNCTION or PROCEDURE, got {kind!r}")
    changeset_id = f"{name}_{version}"
    header = build_header(author, changeset_id, schema, run_on_change=True)
    body = definition.strip()
    if not body.endswith(";"):
        body = body + "\n;"
    drop_target = f"{schema}.{name}"
    if identity_args:
        drop_target += f"({identity_args})"
    return f"{header}\n\nDROP {kind} IF EXISTS {drop_target};\n\n{body}\n"


def diff_table_columns(src_cols, tgt_cols, allow_drop=False):
    """ALTER clauses to make the LOSER (tgt_cols) match the WINNER (src_cols)."""
    clauses = []
    for name, c in src_cols.items():
        if name not in tgt_cols:
            clause = f"ADD COLUMN {name} {c['data_type']}"
            if c.get("column_default"):
                clause += f" DEFAULT {c['column_default']}"
            if c.get("is_nullable") == "NO":
                clause += " NOT NULL"
            clauses.append(clause)
            continue
        t = tgt_cols[name]
        if c.get("data_type") != t.get("data_type"):
            clauses.append(f"ALTER COLUMN {name} TYPE {c['data_type']}")
        if c.get("column_default") != t.get("column_default"):
            if c.get("column_default"):
                clauses.append(f"ALTER COLUMN {name} SET DEFAULT {c['column_default']}")
            else:
                clauses.append(f"ALTER COLUMN {name} DROP DEFAULT")
        if c.get("is_nullable") != t.get("is_nullable"):
            if c.get("is_nullable") == "NO":
                clauses.append(f"ALTER COLUMN {name} SET NOT NULL")
            else:
                clauses.append(f"ALTER COLUMN {name} DROP NOT NULL")
    if allow_drop:
        for name in tgt_cols:
            if name not in src_cols:
                clauses.append(f"DROP COLUMN {name}")
    return clauses


def export_alter_table(schema, table, clauses, author=DEFAULT_AUTHOR):
    if not clauses:
        return None
    header = build_header(author, table, schema, run_on_change=False)
    stmts = "\n".join(f"ALTER TABLE {schema}.{table} {c};" for c in clauses)
    return f"{header}\n\n{stmts}\n"


# ── DB reads (psycopg3, tuple cursors so the ported SQL maps positionally) ──

def _tuple_cur(conn):
    return conn.cursor(row_factory=tuple_row)


def get_table_columns(conn, schema, table):
    """{col: {data_type, is_nullable, column_default}} (information_schema)."""
    with _tuple_cur(conn) as cur:
        cur.execute(
            """
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
            """,
            (schema, table),
        )
        return {
            name: {"data_type": dt, "is_nullable": nn, "column_default": dflt}
            for name, dt, nn, dflt in cur.fetchall()
        }


def _fmt_type(typname, typmod):
    if typname in ("numeric", "decimal") and typmod > 0:
        p = ((typmod - 4) >> 16) & 0xFFFF
        s = (typmod - 4) & 0xFFFF
        return f"numeric({p}, {s})"
    if typname in ("varchar", "bpchar") and typmod > 0:
        return f"{typname}({typmod - 4})"
    return typname


def _column_line(name, typname, typmod, default, notnull):
    if default and "nextval(" in default and typname in _SERIAL:
        typ = _SERIAL[typname]
        default = None
    else:
        typ = _fmt_type(typname, typmod)
    parts = [name, typ]
    if default:
        parts.append(f"DEFAULT {default}")
    parts.append("NOT NULL" if notnull else "NULL")
    return " ".join(parts)


def get_create_table_ddl(conn, read_schema, table, emit_schema=None):
    """Full CREATE TABLE DDL (DBeaver style) read from read_schema, emitted with
    emit_schema (defaults to read_schema)."""
    emit_schema = emit_schema or read_schema
    read_fq = f"{read_schema}.{table}"
    emit_fq = f"{emit_schema}.{table}"
    with _tuple_cur(conn) as cur:
        cur.execute(
            """
            SELECT a.attname, t.typname, a.atttypmod,
                   pg_get_expr(ad.adbin, ad.adrelid), a.attnotnull
            FROM pg_attribute a
            JOIN pg_type t ON t.oid = a.atttypid
            LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
            WHERE a.attrelid = %s::regclass AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY a.attnum
            """,
            (read_fq,),
        )
        body = [_column_line(*row) for row in cur.fetchall()]

        cur.execute(
            """
            SELECT c.conname, pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            WHERE c.conrelid = %s::regclass
            ORDER BY array_position(ARRAY['u','p','c','f'], c.contype::text), c.conname
            """,
            (read_fq,),
        )
        body += [f"CONSTRAINT {n} {d}" for n, d in cur.fetchall()]
        inner = ",\n".join(f"\t{line}" for line in body)

        cur.execute(
            """
            SELECT CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) END
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = %s AND c.relname = %s
            """,
            (read_schema, table),
        )
        part_row = cur.fetchone()
        part = part_row[0] if part_row else None
        tail = f"\n)\nPARTITION BY {part};" if part else "\n);"
        ddl = f"CREATE TABLE {emit_fq} (\n{inner}{tail}"

        cur.execute(
            """
            SELECT pg_get_indexdef(i.indexrelid)
            FROM pg_index i
            WHERE i.indrelid = %s::regclass
              AND NOT EXISTS (
                  SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
            ORDER BY i.indexrelid::regclass::text
            """,
            (read_fq,),
        )
        idx = [r[0] for r in cur.fetchall()]
    if idx:
        # Emit indexes against the emit schema.
        idx = [d.replace(f"{read_schema}.", f"{emit_schema}.", 1) for d in idx]
        ddl += "\n\n-- Create indexes\n" + "\n".join(f"{d};" for d in idx)
    return ddl


def _args_no_default(args_str):
    # Mirror cls._args_no_default without importing (avoid coupling): strip
    # DEFAULT clauses from a top-level-comma-split argument list.
    from . import classification as cls
    return cls._args_no_default(args_str or "")


def get_routine_overload(conn, schema, name, arg_signature):
    """Return the overload of schema.name matching `arg_signature` (the diff's
    no-default arg key), or None. Dict: kind, definition, identity_args."""
    with _tuple_cur(conn) as cur:
        cur.execute(
            """
            SELECT CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
                   pg_get_functiondef(p.oid),
                   pg_get_function_arguments(p.oid),
                   pg_get_function_identity_arguments(p.oid)
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = %s AND p.proname = %s
            ORDER BY p.oid
            """,
            (schema, name),
        )
        rows = cur.fetchall()
    overloads = [
        {"kind": kind, "definition": d,
         "arg_signature": _args_no_default(af), "identity_args": ia or ""}
        for kind, d, af, ia in rows
    ]
    if not overloads:
        return None
    for o in overloads:
        if o["arg_signature"] == (arg_signature or ""):
            return o
    return overloads[0]  # fall back to the sole/first overload


# ── Data-diff CSV snapshot (data_export.py port) ──

def _get_pk_columns(conn, schema, table):
    with _tuple_cur(conn) as cur:
        cur.execute(
            """
            SELECT a.attname
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = %s::regclass AND i.indisprimary
            ORDER BY array_position(i.indkey, a.attnum)
            """,
            (f"{schema}.{table}",),
        )
        return [r[0] for r in cur.fetchall()]


def _fmt_csv_value(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _csv_field(value):
    """QUOTE_MINIMAL-style: quote only when needed."""
    s = _fmt_csv_value(value)
    if any(ch in s for ch in (',', '"', '\n', '\r')):
        return '"' + s.replace('"', '""') + '"'
    return s


def export_table_data_csv(conn, schema, table):
    """Full seed-CSV snapshot of the winner's rows. Returns (csv_text, n_rows)."""
    pk = _get_pk_columns(conn, schema, table)
    with _tuple_cur(conn) as cur:
        order_sql = ", ".join(f'"{c}"' for c in pk) if pk else "1"
        cur.execute(f'SELECT * FROM "{schema}"."{table}" ORDER BY {order_sql}')
        columns = [d.name for d in cur.description]
        rows = cur.fetchall()
    lines = [",".join(columns)]
    for row in rows:
        lines.append(",".join(_csv_field(v) for v in row))
    return "\n".join(lines) + "\n", len(rows)


# ── Materialized view export (Liquibase DO-block) ──
#
# The big PL/pgSQL DO block is FIXED boilerplate copied verbatim from the team's
# reference samples. It recursively snapshots dependent views/matviews + their
# indexes, DROPs the MV CASCADE, recreates it, then rebuilds the snapshot.
# Only four things are injected (via sentinels): the dependency-walk ROOT
# (<<ROOT_NAME>>/<<ROOT_SCHEMA>>, which MUST be the exported MV's own
# schema.name — see devlog/Yash confirmation), the DROP target, and the
# CREATE...WITH DATA + index section (<<DEF_SECTION>>).

MV_LABELS = "liquibase_project_update"

_MV_DO_BLOCK = r'''do $$
    declare
        _index_build text;
        _index_builds text[];
        _build_view text;
        _build_views text[];
    begin   
        select 
          array_agg(
            concat(pindx.indexdef, ';')
          ) into _index_builds 
        from 
          (
            (
              select 
                dependent_schema, 
                dependent_table, 
                dependent_objecttype, 
                ROW_NUMBER() OVER() seq 
              from 
                (
                  WITH RECURSIVE view_deps AS (
                    SELECT 
                      DISTINCT dependent_ns.nspname :: text as dependent_schema, 
                      dependent_view.relname :: text as dependent_view, 
                      case dependent_view.relkind when 'r' then 'TABLE' when 'm' then 'MATERIALIZED_VIEW' when 'i' then 'INDEX' when 'S' then 'SEQUENCE' when 'v' then 'VIEW' when 'c' then 'TYPE' else dependent_view.relkind :: text end as dependent_ObjectType, 
                      source_ns.nspname :: text as source_schema, 
                      source_table.relname :: text as source_table 
                    FROM 
                      pg_depend 
                      JOIN pg_rewrite ON pg_depend.objid = pg_rewrite.oid 
                      JOIN pg_class as dependent_view ON pg_rewrite.ev_class = dependent_view.oid 
                      JOIN pg_class as source_table ON pg_depend.refobjid = source_table.oid 
                      JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_view.relnamespace 
                      JOIN pg_namespace source_ns ON source_ns.oid = source_table.relnamespace 
                    WHERE 
                      NOT (
                        dependent_ns.nspname = source_ns.nspname 
                        AND dependent_view.relname = source_table.relname
                      ) 
                      and source_table.relname = '<<ROOT_NAME>>'
                      and source_ns.nspname = '<<ROOT_SCHEMA>>'
                    UNION 
                    SELECT 
                      DISTINCT dependent_ns.nspname :: text as dependent_schema, 
                      dependent_view.relname :: text as dependent_view, 
                      case dependent_view.relkind when 'r' then 'TABLE' when 'm' then 'MATERIALIZED_VIEW' when 'i' then 'INDEX' when 'S' then 'SEQUENCE' when 'v' then 'VIEW' when 'c' then 'TYPE' else dependent_view.relkind :: text end as dependent_ObjectType, 
                      source_ns.nspname :: text as source_schema, 
                      source_table.relname :: text as source_table 
                    FROM 
                      pg_depend 
                      JOIN pg_rewrite ON pg_depend.objid = pg_rewrite.oid 
                      JOIN pg_class as dependent_view ON pg_rewrite.ev_class = dependent_view.oid 
                      JOIN pg_class as source_table ON pg_depend.refobjid = source_table.oid 
                      JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_view.relnamespace 
                      JOIN pg_namespace source_ns ON source_ns.oid = source_table.relnamespace 
                      INNER JOIN view_deps vd ON vd.dependent_schema = source_ns.nspname 
                      AND vd.dependent_view = source_table.relname 
                      AND NOT (
                        dependent_ns.nspname = vd.dependent_schema 
                        AND dependent_view.relname = vd.dependent_view
                      )
                  ) 
                  select 
                    dependent_schema, 
                    dependent_view as dependent_table, 
                    dependent_objecttype 
                  from 
                    view_deps 
                  where 
                    1 = 1
                ) x 
              where 
                dependent_schema not in('cache')
            ) dep 
            join pg_catalog.pg_indexes pindx on pindx.tablename = dep.dependent_table 
            and pindx.schemaname = dep.dependent_schema
          );
        for _build_view in 
        select 
          case when dep.dependent_objecttype = 'MATERIALIZED_VIEW' then 'CREATE MATERIALIZED VIEW ' || schemaname || '.' || viewname || ' as ' || definition when dep.dependent_objecttype = 'VIEW' then 'CREATE OR REPLACE VIEW ' || schemaname || '.' || viewname || ' as ' || definition end as view_definition 
        from 
          (
            select 
              schemaname schemaname, 
              pv.viewname viewname, 
              pv.viewowner viewowner, 
              pv.definition definition 
            from 
              pg_catalog.pg_views pv 
            union 
            select 
              pm.schemaname schemaname, 
              pm.matviewname viewname, 
              pm.matviewowner viewowner, 
              pm.definition definition 
            from 
              pg_catalog.pg_matviews pm
          ) x 
          join (
            select 
              dependent_schema, 
              dependent_table, 
              dependent_objecttype, 
              ROW_NUMBER() OVER() seq 
            from 
              (
                WITH RECURSIVE view_deps AS (
                  SELECT 
                    DISTINCT dependent_ns.nspname :: text as dependent_schema, 
                    dependent_view.relname :: text as dependent_view, 
                    case dependent_view.relkind when 'r' then 'TABLE' when 'm' then 'MATERIALIZED_VIEW' when 'i' then 'INDEX' when 'S' then 'SEQUENCE' when 'v' then 'VIEW' when 'c' then 'TYPE' else dependent_view.relkind :: text end as dependent_ObjectType, 
                    source_ns.nspname :: text as source_schema, 
                    source_table.relname :: text as source_table 
                  FROM 
                    pg_depend 
                    JOIN pg_rewrite ON pg_depend.objid = pg_rewrite.oid 
                    JOIN pg_class as dependent_view ON pg_rewrite.ev_class = dependent_view.oid 
                    JOIN pg_class as source_table ON pg_depend.refobjid = source_table.oid 
                    JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_view.relnamespace 
                    JOIN pg_namespace source_ns ON source_ns.oid = source_table.relnamespace 
                  WHERE 
                    NOT (
                      dependent_ns.nspname = source_ns.nspname 
                      AND dependent_view.relname = source_table.relname
                    ) 
                    and source_table.relname = '<<ROOT_NAME>>'
                    and source_ns.nspname = '<<ROOT_SCHEMA>>'
                  UNION 
                  SELECT 
                    DISTINCT dependent_ns.nspname :: text as dependent_schema, 
                    dependent_view.relname :: text as dependent_view, 
                    case dependent_view.relkind when 'r' then 'TABLE' when 'm' then 'MATERIALIZED_VIEW' when 'i' then 'INDEX' when 'S' then 'SEQUENCE' when 'v' then 'VIEW' when 'c' then 'TYPE' else dependent_view.relkind :: text end as dependent_ObjectType, 
                    source_ns.nspname :: text as source_schema, 
                    source_table.relname :: text as source_table 
                  FROM 
                    pg_depend 
                    JOIN pg_rewrite ON pg_depend.objid = pg_rewrite.oid 
                    JOIN pg_class as dependent_view ON pg_rewrite.ev_class = dependent_view.oid 
                    JOIN pg_class as source_table ON pg_depend.refobjid = source_table.oid 
                    JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_view.relnamespace 
                    JOIN pg_namespace source_ns ON source_ns.oid = source_table.relnamespace 
                    INNER JOIN view_deps vd ON vd.dependent_schema = source_ns.nspname 
                    AND vd.dependent_view = source_table.relname 
                    AND NOT (
                      dependent_ns.nspname = vd.dependent_schema 
                      AND dependent_view.relname = vd.dependent_view
                    )
                ) 
                select 
                  dependent_schema, 
                  dependent_view as dependent_table, 
                  dependent_objecttype 
                from 
                  view_deps 
                where 
                  1 = 1
              ) x 
            where 
              1 = 1 
              and (
                dependent_schema != 'cache' 
                or dependent_objecttype != 'MATERIALIZED_VIEW'
              )
          ) dep on x.schemaname = dep.dependent_schema 
          and x.viewname = dep.dependent_table 
        order by 
          dep.seq loop _build_views := array_append(_build_views, _build_view);
        end loop;
        
        -- delete from "cache".request_tracker;
        drop materialized view if exists <<DROP_TARGET>> cascade;
    
<<DEF_SECTION>>

 -------------------------------
        
        if cardinality(_build_views) > 0 THEN
            FOREACH _build_view in array _build_views loop
                execute _build_view;
            end loop;
        end if;
        
        if cardinality(_index_builds) > 0 THEN
            FOREACH _index_build in array _index_builds loop
                execute _index_build;
            end loop;
        end if;
    end;
$$;
'''


def build_mv_header(author, changeset_id):
    """Liquibase header matching the team's MV sample style (Abhishek's)."""
    return (
        "--liquibase formatted sql\n"
        f"--changeset {author}:{changeset_id} runOnChange:true "
        f"stripComments:false splitStatements:false context:{DEFAULT_CONTEXT} "
        f"labels:{MV_LABELS}\n"
        f"--comment: issue fix on {changeset_id}\n"
    )


def get_matview_definition(conn, schema, name):
    """The MV's SELECT body (no trailing ';'), or None if the MV is absent."""
    with _tuple_cur(conn) as cur:
        cur.execute(
            "SELECT definition FROM pg_matviews "
            "WHERE schemaname = %s AND matviewname = %s",
            (schema, name),
        )
        row = cur.fetchone()
    if not row:
        return None
    d = (row[0] or "").strip()
    if d.endswith(";"):
        d = d[:-1].rstrip()
    return d


def get_matview_indexes(conn, schema, name):
    """pg_get_indexdef-style CREATE INDEX statements (no trailing ';')."""
    with _tuple_cur(conn) as cur:
        cur.execute(
            "SELECT indexdef FROM pg_indexes "
            "WHERE schemaname = %s AND tablename = %s ORDER BY indexname",
            (schema, name),
        )
        return [r[0] for r in cur.fetchall()]


def build_matview_changeset(schema, name, definition, indexes,
                            author=DEFAULT_AUTHOR, version=1):
    """Full Liquibase MV changeset: header + the fixed DO block with the
    dependency-walk root, DROP target, CREATE...WITH DATA and indexes injected.
    `schema` is the schema the changeset targets (and the dependency root)."""
    changeset_id = f"{name}_{version}"
    header = build_mv_header(author, changeset_id)

    lines = [
        "        -- Put Def here -",
        "",
        f"        -- {schema}.{name} source",
        "",
        f"        CREATE MATERIALIZED VIEW {schema}.{name}",
        "        TABLESPACE pg_default",
        f"        AS {definition}",
        "        WITH DATA;",
    ]
    if indexes:
        lines += ["", "        -- View indexes:"]
        lines += [f"        {idx};" for idx in indexes]
    def_section = "\n".join(lines)

    block = (
        _MV_DO_BLOCK
        .replace("<<ROOT_NAME>>", name)
        .replace("<<ROOT_SCHEMA>>", schema)
        .replace("<<DROP_TARGET>>", f"{schema}.{name}")
        .replace("<<DEF_SECTION>>", def_section)
    )
    return f"{header}\n\n{block}"


# ── Orchestration ──

def _client_folder(env_name):
    """Repo client folder for an env (e.g. cb_prod → crackerbarrel)."""
    client = (ENVIRONMENTS.get(env_name, {}) or {}).get("client", "")
    return client.lower().replace(" ", "") or (env_name.split("_")[0] if env_name else "client")


def generate(conns, items):
    """Generate export artifacts for the selected diff `items`.

    Each item: {object_type, name, arg_signature, category, winner}.
    Returns {"files": [...], "notes": [...]}.
    """
    src = conns.ensure_alive("source")
    tgt = conns.ensure_alive("target")
    s_schema, t_schema = conns.source_schema, conns.target_schema
    src_env, tgt_env = conns.source_env, conns.target_env

    def sides(winner):
        if winner == "target":
            return (tgt, t_schema, tgt_env), (src, s_schema, src_env)
        return (src, s_schema, src_env), (tgt, t_schema, tgt_env)

    files, notes = [], []

    for it in items:
        otype = it.get("object_type")
        name = it.get("name")
        arg = it.get("arg_signature") or ""
        category = it.get("category")
        winner = it.get("winner") or "source"
        (w_conn, w_schema, w_env), (l_conn, l_schema, l_env) = sides(winner)

        try:
            if otype == "matview":
                definition = get_matview_definition(w_conn, w_schema, name)
                if definition is None:
                    notes.append(f"{name}: matview not found in winner {w_env}; skipped.")
                    continue
                indexes = get_matview_indexes(w_conn, w_schema, name)
                if w_schema != l_schema:
                    # Emit against the losing side's schema (re-point object refs).
                    definition = definition.replace(f"{w_schema}.", f"{l_schema}.")
                    indexes = [i.replace(f"{w_schema}.", f"{l_schema}.") for i in indexes]
                content = build_matview_changeset(l_schema, name, definition, indexes)
                files.append({
                    "name": f"{name}.sql", "language": "sql",
                    "action": "DROP + CREATE MATERIALIZED VIEW",
                    "winner_env": w_env, "target_env": l_env,
                    "content": content,
                })
                continue

            if otype in ("function", "procedure"):
                ov = get_routine_overload(w_conn, w_schema, name, arg)
                if not ov:
                    notes.append(f"{name}({arg}): not found in winner {w_env}; skipped.")
                    continue
                idargs = ov["identity_args"] if arg else None
                content = export_routine(
                    l_schema, name, ov["kind"], ov["definition"],
                    version=1, identity_args=idargs)
                files.append({
                    "name": f"{name}.sql", "language": "sql",
                    "action": f"DROP + CREATE {ov['kind']}",
                    "winner_env": w_env, "target_env": l_env,
                    "content": content,
                })
                continue

            if otype == "table":
                if category in ("missing_in_target", "missing_in_source"):
                    ddl = get_create_table_ddl(w_conn, w_schema, name, emit_schema=l_schema)
                    header = build_header(DEFAULT_AUTHOR, name, l_schema, run_on_change=False)
                    files.append({
                        "name": f"{name}.sql", "language": "sql",
                        "action": "CREATE TABLE", "winner_env": w_env, "target_env": l_env,
                        "content": f"{header}\n\n{ddl}\n",
                    })
                elif category == "schema_diff":
                    w_cols = get_table_columns(w_conn, w_schema, name)
                    l_cols = get_table_columns(l_conn, l_schema, name)
                    clauses = diff_table_columns(w_cols, l_cols)
                    content = export_alter_table(l_schema, name, clauses)
                    if content:
                        files.append({
                            "name": f"{name}.sql", "language": "sql",
                            "action": "ALTER TABLE", "winner_env": w_env, "target_env": l_env,
                            "content": content,
                        })
                    else:
                        notes.append(f"{name}: no column changes to apply (schemas already match).")
                elif category == "data_diff":
                    csv_text, n = export_table_data_csv(w_conn, w_schema, name)
                    client = _client_folder(w_env)
                    files.append({
                        "name": f"{client}/data/{w_schema}/{name}.csv", "language": "csv",
                        "action": f"DATA snapshot ({n} rows)", "winner_env": w_env, "target_env": l_env,
                        "content": csv_text,
                    })
                else:
                    notes.append(f"{name}: unsupported table category '{category}'.")
                continue

            notes.append(f"{name}: unsupported object_type '{otype}'.")
        except Exception as e:  # never fail the whole export for one object
            notes.append(f"{name}: export failed — {e}")

    return {"files": files, "notes": notes}
