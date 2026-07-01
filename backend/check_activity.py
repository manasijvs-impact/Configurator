"""One-off, read-only check: is anything actively running / ingesting on
cb_dev and cb_test right now? Connects DIRECTLY to Postgres (not via the app).

Reads credentials from backend/.env (CRACKERBARREL_DEV_*). Run: python check_activity.py
"""
import os

from dotenv import load_dotenv
import psycopg
from psycopg.rows import dict_row

load_dotenv()

# cb_dev and cb_test live on the same cluster, so one connection sees both.
HOST = "10.68.0.4"
PORT = 5432
LOGIN_DB = "cb_dev"          # any db on the cluster works for pg_stat_activity
ROLE = "mtp-dev"
TARGET_DBS = ["cb_dev", "cb_test"]

WRITE_KW = ("insert", "update", "delete", "copy", "merge",
            "truncate", "create table", "refresh materialized")


def main():
    user = os.environ["CRACKERBARREL_DEV_USERNAME"]
    pwd = os.environ["CRACKERBARREL_DEV_PASSWORD"]

    conn = psycopg.connect(
        host=HOST, port=PORT, dbname=LOGIN_DB, user=user, password=pwd,
        row_factory=dict_row, sslmode="prefer",
        options=f"-c role={ROLE}", connect_timeout=30,
    )
    conn.autocommit = True

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT datname, state, count(*) AS n
            FROM pg_stat_activity
            WHERE datname = ANY(%s)
            GROUP BY datname, state
            ORDER BY datname, state
            """,
            (TARGET_DBS,),
        )
        print("\n=== session counts by db/state ===")
        for r in cur.fetchall():
            print(f"  {r['datname']:10}  {str(r['state']):20}  {r['n']}")

        cur.execute(
            """
            SELECT datname, pid, usename, state, wait_event_type, wait_event,
                   date_trunc('second', now() - query_start)::text AS running_for,
                   date_trunc('second', now() - xact_start)::text  AS xact_age,
                   left(regexp_replace(query, '\\s+', ' ', 'g'), 200) AS query
            FROM pg_stat_activity
            WHERE datname = ANY(%s)
              AND pid <> pg_backend_pid()
              AND state <> 'idle'
            ORDER BY query_start NULLS LAST
            """,
            (TARGET_DBS,),
        )
        active = cur.fetchall()

    print(f"\n=== active (non-idle) statements: {len(active)} ===")
    ingesting = []
    for a in active:
        q = (a["query"] or "").lstrip().lower()
        is_write = any(q.startswith(k) or k in q[:40] for k in WRITE_KW)
        if is_write:
            ingesting.append(a)
        tag = "  <== WRITE/INGEST" if is_write else ""
        print(f"\n  db={a['datname']} pid={a['pid']} user={a['usename']} "
              f"state={a['state']} last_stmt_ago={a['running_for']} "
              f"txn_open_for={a['xact_age']} "
              f"wait={a['wait_event_type']}/{a['wait_event']}{tag}")
        print(f"    {a['query']}")

    print("\n=== verdict ===")
    if ingesting:
        print(f"  INGESTION/WRITE ACTIVITY DETECTED: {len(ingesting)} statement(s) "
              f"on {sorted({a['datname'] for a in ingesting})}")
    elif active:
        print("  Activity present, but no INSERT/UPDATE/COPY/etc. — looks read-only.")
    else:
        print("  No active statements on cb_dev or cb_test right now (idle).")

    conn.close()


if __name__ == "__main__":
    main()
