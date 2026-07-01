"""One-off, read-only check: where do the MV-export sample objects actually
live? Verifies whether these are in base_pricing / base_pricing_restaurant vs
price_promo, to settle the dependency-walk root question.

Connects DIRECTLY to Postgres (not via the app). Reads creds from backend/.env
(CRACKERBARREL_DEV_*). Read-only: only SELECTs against catalog views.
Run: python check_mv_schema.py
"""
import os

from dotenv import load_dotenv
import psycopg
from psycopg.rows import dict_row

load_dotenv()  # repo .env (CRACKERBARREL_DEV/TEST)
load_dotenv("/Users/manasijvs/Downloads/db_creds.env")  # out-of-repo extra envs

HOST = "10.68.0.4"
PORT = 5432
ROLE = "mtp-dev"
TARGET_DBS = ["cb_dev", "cb_test"]

# The objects referenced by the MV-export samples / dependency-walk root.
OBJECT_NAMES = [
    "mv_rule_stores_hierarchy_agg_data",          # created in sample (base_pricing?)
    "mv_bp_product_group_attributes_aggregated",  # created in sample (base_pricing?)
    "mvw_wc_product_pg_promo_hierarchy",          # the hardcoded root (price_promo?)
]
SCHEMAS_OF_INTEREST = ["base_pricing", "base_pricing_restaurant", "price_promo"]


def check_db(user, pwd, dbname):
    print(f"\n{'='*70}\nDATABASE: {dbname}\n{'='*70}")
    try:
        conn = psycopg.connect(
            host=HOST, port=PORT, dbname=dbname, user=user, password=pwd,
            row_factory=dict_row, sslmode="prefer",
            options=f"-c role={ROLE}", connect_timeout=30,
        )
    except Exception as e:
        print(f"  ! could not connect: {e}")
        return
    conn.autocommit = True

    with conn.cursor() as cur:
        # 1) Where does each named object live, and what kind is it?
        print("\n-- located by name (matviews, then plain views) --")
        cur.execute(
            "SELECT schemaname, matviewname AS name FROM pg_matviews "
            "WHERE matviewname = ANY(%s) ORDER BY schemaname, name",
            (OBJECT_NAMES,),
        )
        mvs = cur.fetchall()
        for r in mvs:
            print(f"  MATERIALIZED VIEW  {r['schemaname']}.{r['name']}")
        cur.execute(
            "SELECT schemaname, viewname AS name FROM pg_views "
            "WHERE viewname = ANY(%s) ORDER BY schemaname, name",
            (OBJECT_NAMES,),
        )
        for r in cur.fetchall():
            print(f"  VIEW               {r['schemaname']}.{r['name']}")
        if not mvs:
            print("  (none of the named objects found as a matview)")

        # 2) What matviews exist in each schema of interest?
        for sch in SCHEMAS_OF_INTEREST:
            cur.execute(
                "SELECT matviewname FROM pg_matviews WHERE schemaname = %s "
                "ORDER BY matviewname",
                (sch,),
            )
            rows = cur.fetchall()
            print(f"\n-- matviews in schema '{sch}' ({len(rows)}) --")
            for r in rows:
                print(f"  {r['matviewname']}")
            if not rows:
                print("  (schema absent or has no matviews)")

    conn.close()


def main():
    user = os.environ["CRACKERBARREL_DEV_USERNAME"]
    pwd = os.environ["CRACKERBARREL_DEV_PASSWORD"]
    for db in TARGET_DBS:
        check_db(user, pwd, db)


if __name__ == "__main__":
    main()
