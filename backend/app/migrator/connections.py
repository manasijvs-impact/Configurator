"""Migrator connection manager.

Holds TWO persistent PostgreSQL connections at once (source + target) — unlike
the Configurator's single shared `db` singleton. Uses psycopg v3 + dict_row to
match the existing backend stack.

Connections are opened in Step 1 with the user-entered credentials and kept
alive via libpq TCP keepalives plus an explicit `ensure_alive()` ping that
transparently reconnects if the server dropped the link (e.g. after a long
validation run). Credentials are held in memory only, solely so we can
reconnect; they are never persisted to disk.
"""
from concurrent.futures import ThreadPoolExecutor

import psycopg
from psycopg.rows import dict_row

# Non-secret env details. Mirrors the repo-root db_connections.py and the
# frontend src/migrator/envs.js. Keep these three in sync if envs change.
ENVIRONMENTS = {
    "cb_dev":       {"client": "Crackerbarrel", "tier": "Dev",  "host": "10.68.0.4",  "port": 5432, "db": "cb_dev",       "role": "mtp-dev"},
    "cb_test":      {"client": "Crackerbarrel", "tier": "Test", "host": "10.68.0.4",  "port": 5432, "db": "cb_test",      "role": "mtp-dev"},
    "cb_uat":       {"client": "Crackerbarrel", "tier": "Uat",  "host": "10.68.1.3",  "port": 5432, "db": "cb_uat",       "role": "mtp-uat-readonly"},
    "cb_prod":      {"client": "Crackerbarrel", "tier": "Prod", "host": "10.68.1.3",  "port": 5432, "db": "cb_prod",      "role": "mtp-readonly"},
    "leslies_dev":  {"client": "Leslies",       "tier": "Dev",  "host": "10.75.0.2",  "port": 5432, "db": "leslies_dev",  "role": "mtp-dev"},
    "leslies_test": {"client": "Leslies",       "tier": "Test", "host": "10.75.0.2",  "port": 5432, "db": "leslies_test", "role": "mtp-dev"},
    "leslies_uat":  {"client": "Leslies",       "tier": "Uat",  "host": "10.75.8.4",  "port": 5432, "db": "leslies_uat",  "role": "mtp-uat-readonly"},
    "leslies_prod": {"client": "Leslies",       "tier": "Prod", "host": "10.75.8.41", "port": 5432, "db": "leslies_prod", "role": "mtp-readonly"},
}


class MigratorConnections:
    """Manages a source + target connection pair for one active migration."""

    def __init__(self):
        self.source = None
        self.target = None
        self.source_env = None
        self.target_env = None
        # Per-side schemas: source and target may use different schema names.
        self.source_schema = "base_pricing"
        self.target_schema = "base_pricing"
        # Run config from Step 1 (mirrors db_validator.py knobs). exclude_prefixes
        # drives discovery today; threshold_table + stale_days are stored now and
        # consumed when the db_validator engine powers /diffs (see routes.py TODO).
        self.threshold_table = "bp_template_attributes_mapping"
        self.exclude_prefixes = ("temp_", "unlogged_", "bp_unlogged_")
        self.stale_days = 30
        self._username = None
        self._password = None

    def _open(self, env_name: str):
        """Open a single keepalive connection to the named env using the
        currently held credentials."""
        e = ENVIRONMENTS[env_name]
        role = (e.get("role") or "").split(",")[0].strip()
        conn = psycopg.connect(
            host=e["host"],
            port=e["port"],
            dbname=e["db"],
            user=self._username,
            password=self._password,
            row_factory=dict_row,
            sslmode="prefer",
            options=f"-c role={role}" if role else None,
            connect_timeout=30,
            # libpq TCP keepalives so the link survives idle periods during
            # long-running validation work.
            keepalives=1,
            keepalives_idle=30,
            keepalives_interval=10,
            keepalives_count=5,
        )
        conn.autocommit = True  # read-only usage; avoids idle-in-transaction
        return conn

    def connect(self, username: str, password: str, source_env: str,
                target_env: str, source_schema: str = "base_pricing",
                target_schema: str = "base_pricing", threshold_table: str = None,
                exclude_prefixes=None, stale_days: int = None) -> dict:
        """Open both connections. Raises ValueError on bad env names; lets
        psycopg errors propagate (caught by the route for a clean message)."""
        if source_env not in ENVIRONMENTS:
            raise ValueError(f"Unknown source env: {source_env}")
        if target_env not in ENVIRONMENTS:
            raise ValueError(f"Unknown target env: {target_env}")
        if source_env == target_env:
            raise ValueError("Source and target must be different environments")

        # Close anything previously open.
        self.disconnect()

        self._username = username
        self._password = password
        self.source_schema = source_schema or "base_pricing"
        self.target_schema = target_schema or "base_pricing"
        # Store run config (fall back to defaults when not provided).
        if threshold_table:
            self.threshold_table = threshold_table
        if exclude_prefixes is not None:
            self.exclude_prefixes = tuple(exclude_prefixes)
        if stale_days is not None:
            self.stale_days = stale_days

        # Open BOTH connections in parallel so total time ≈ the slower single
        # connect instead of the sum of both (noticeably faster over VPN).
        with ThreadPoolExecutor(max_workers=2) as ex:
            fut_src = ex.submit(self._open, source_env)
            fut_tgt = ex.submit(self._open, target_env)
            src = tgt = None
            err = None
            try:
                src = fut_src.result()
            except Exception as e:
                err = e
            try:
                tgt = fut_tgt.result()
            except Exception as e:
                err = err or e

        # If either side failed, close whatever opened and surface the error so
        # we never leave a half-open session.
        if err is not None:
            for c in (src, tgt):
                if c is not None:
                    try:
                        c.close()
                    except Exception:
                        pass
            raise err

        self.source = src
        self.source_env = source_env
        self.target = tgt
        self.target_env = target_env

        return {
            "success": True,
            "source_env": source_env,
            "target_env": target_env,
            "source_schema": self.source_schema,
            "target_schema": self.target_schema,
            "threshold_table": self.threshold_table,
            "exclude_prefixes": list(self.exclude_prefixes),
            "stale_days": self.stale_days,
        }

    def _conn_for(self, which: str):
        return self.source if which == "source" else self.target

    def _env_for(self, which: str):
        return self.source_env if which == "source" else self.target_env

    def ensure_alive(self, which: str):
        """Ping a connection; reconnect transparently if it was dropped.
        Returns a live connection or raises if reconnect fails."""
        conn = self._conn_for(which)
        env = self._env_for(which)
        if conn is None:
            raise Exception(f"{which} is not connected")
        try:
            if conn.closed:
                raise psycopg.OperationalError("connection closed")
            with conn.cursor() as cur:
                cur.execute("SELECT 1;")
                cur.fetchone()
            return conn
        except (psycopg.OperationalError, psycopg.InterfaceError):
            try:
                conn.close()
            except Exception:
                pass
            new = self._open(env)
            if which == "source":
                self.source = new
            else:
                self.target = new
            return new

    def is_connected(self) -> bool:
        return (
            self.source is not None and not self.source.closed
            and self.target is not None and not self.target.closed
        )

    def status(self) -> dict:
        def alive(conn):
            return conn is not None and not conn.closed
        return {
            "connected": self.is_connected(),
            "source_env": self.source_env,
            "target_env": self.target_env,
            "source_schema": self.source_schema if self.is_connected() else None,
            "target_schema": self.target_schema if self.is_connected() else None,
            "source_alive": alive(self.source),
            "target_alive": alive(self.target),
        }

    def disconnect(self):
        for attr in ("source", "target"):
            conn = getattr(self, attr)
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
            setattr(self, attr, None)
        self.source_env = None
        self.target_env = None
        self._username = None
        self._password = None
        self.source_schema = "base_pricing"
        self.target_schema = "base_pricing"
        self.threshold_table = "bp_template_attributes_mapping"
        self.exclude_prefixes = ("temp_", "unlogged_", "bp_unlogged_")
        self.stale_days = 30


# Single active migration session for now.
migrator_conns = MigratorConnections()
