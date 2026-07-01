"""Table + Function inventory for the Migrator.

Ports db_validator.py Section A (table inventory) and Section D (function
inventory): a per-side historical log, distinct from the Step 2 classification
store. For each side it maintains a CSV in ~/Downloads (same filenames/format as
the notebook), refreshed every run:

  - SOURCE CSV — master list discovered on the source DB. New rows get
    created=updated=today; existing rows get updated=today; rows absent from
    source whose `updated` is older than STALE_DAYS are dropped (30-day cleanup).
  - TARGET CSV — synced to SOURCE as the master list (source-only keys added
    with blank `updated`; target-only keys removed). `updated=today` is stamped
    only for objects ACTUALLY present in the target DB, so a missing object
    keeps its last-seen date frozen ("never seen" when blank).

Static/dynamic for tables is taken from the app's existing classification model
(classification.build_model → STATIC_SEED + saved overrides), giving one source
of truth across the app. Functions have no static/dynamic (just `kind`).

Refreshing the CSVs is a side effect of GET /inventory, matching the notebook.
"""
import csv
import os
from datetime import datetime, timedelta

from . import classification as cls

REPORT_DIR = cls.REPORT_DIR

INVENTORY_FIELDS = ["schema_name", "table_name", "static_dynamic",
                    "static_dynamic_override", "created", "updated"]
FUNCTION_INVENTORY_FIELDS = ["schema_name", "function_name", "arg_signature",
                             "kind", "created", "updated"]


def _inventory_paths(conns):
    s_env = (conns.source_env or "source").lower()
    t_env = (conns.target_env or "target").lower()
    s_schema = conns.source_schema.replace(".", "_")
    t_schema = conns.target_schema.replace(".", "_")
    return {
        "table_source": os.path.join(REPORT_DIR, f"table_inventory_source_{s_env}_{s_schema}.csv"),
        "table_target": os.path.join(REPORT_DIR, f"table_inventory_target_{t_env}_{t_schema}.csv"),
        "fn_source": os.path.join(REPORT_DIR, f"function_inventory_source_{s_env}_{s_schema}.csv"),
        "fn_target": os.path.join(REPORT_DIR, f"function_inventory_target_{t_env}_{t_schema}.csv"),
    }


def _load_csv(path, key_fn):
    out = {}
    if os.path.exists(path):
        with open(path, "r", newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                out[key_fn(row)] = row
    return out


def _write_csv(path, fields, rows):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


# ── Table inventory (Section A) ──

def _build_table_inventory(conns, model, paths):
    today = datetime.now().strftime("%Y-%m-%d")
    cutoff = (datetime.now() - timedelta(days=conns.stale_days)).strftime("%Y-%m-%d")
    s_schema, t_schema = conns.source_schema, conns.target_schema

    # Effective classification + presence from the app's model (present only).
    present = [t for t in model["tables"] if t.get("present")]
    cls_by_name = {t["name"]: t for t in present}
    src_names = {t["name"] for t in present if t["in_source"]}
    tgt_names = {t["name"] for t in present if t["in_target"]}

    # --- SOURCE CSV ---
    inv = _load_csv(paths["table_source"], lambda r: r["table_name"])
    added = updated = removed = 0
    for name in src_names:
        info = cls_by_name[name]
        auto_cls = info["classification"]
        override = info.get("override") or ""
        if name not in inv:
            inv[name] = {"schema_name": s_schema, "table_name": name,
                         "static_dynamic": auto_cls, "static_dynamic_override": override,
                         "created": today, "updated": today}
            added += 1
        else:
            inv[name]["static_dynamic"] = override or auto_cls
            inv[name]["static_dynamic_override"] = override
            inv[name]["schema_name"] = s_schema
            inv[name]["updated"] = today
            updated += 1
    stale = [n for n, r in inv.items()
             if n not in src_names and r.get("updated", "") and r["updated"] < cutoff]
    for n in stale:
        del inv[n]
        removed += 1
    _write_csv(paths["table_source"], INVENTORY_FIELDS,
               sorted(inv.values(), key=lambda r: r["table_name"]))

    # --- TARGET CSV (source is master) ---
    tinv = _load_csv(paths["table_target"], lambda r: r["table_name"])
    master = set(inv.keys())
    for name in master:
        s_row = inv[name]
        if name not in tinv:
            tinv[name] = {"schema_name": t_schema, "table_name": name,
                          "static_dynamic": s_row["static_dynamic"],
                          "static_dynamic_override": s_row.get("static_dynamic_override", ""),
                          "created": s_row["created"], "updated": ""}
        else:
            tinv[name]["static_dynamic"] = s_row["static_dynamic"]
            tinv[name]["static_dynamic_override"] = s_row.get("static_dynamic_override", "")
            tinv[name]["created"] = s_row.get("created", tinv[name].get("created", ""))
            tinv[name]["schema_name"] = t_schema
    for name in list(tinv.keys()):
        if name not in master:
            del tinv[name]
    missing = []
    confirmed = 0
    for name in tinv:
        if name in tgt_names:
            tinv[name]["updated"] = today
            confirmed += 1
        else:
            missing.append(name)
    _write_csv(paths["table_target"], INVENTORY_FIELDS,
               sorted(tinv.values(), key=lambda r: r["table_name"]))

    # --- Merged rows for the UI (source master + target last-seen) ---
    rows = []
    for name in sorted(master):
        s_row, t_row = inv[name], tinv.get(name, {})
        in_tgt = name in tgt_names
        rows.append({
            "name": name,
            "static_dynamic": s_row["static_dynamic"],
            "override": s_row.get("static_dynamic_override", ""),
            "in_source": True,
            "in_target": in_tgt,
            "created": s_row.get("created", ""),
            "source_updated": s_row.get("updated", ""),
            "target_updated": t_row.get("updated", ""),
            "last_seen": t_row.get("updated", "") or None,
            "status": "present" if in_tgt else "missing_in_target",
        })
    return {
        "source_csv_path": paths["table_source"],
        "target_csv_path": paths["table_target"],
        "summary": {"source_total": len(master), "target_present": confirmed,
                    "target_missing": len(missing), "added": added,
                    "updated": updated, "removed": removed},
        "rows": rows,
    }


# ── Function inventory (Section D) ──

def _build_function_inventory(conns, model, paths):
    today = datetime.now().strftime("%Y-%m-%d")
    cutoff = (datetime.now() - timedelta(days=conns.stale_days)).strftime("%Y-%m-%d")
    s_schema, t_schema = conns.source_schema, conns.target_schema

    fns = model["functions"]
    by_key = {(f["name"], f["arg_signature"]): f for f in fns}
    src_keys = {k for k, f in by_key.items() if f["in_source"]}
    tgt_keys = {k for k, f in by_key.items() if f["in_target"]}

    def _key(r):
        return (r["function_name"], r["arg_signature"])

    # --- SOURCE CSV ---
    inv = _load_csv(paths["fn_source"], _key)
    added = updated = removed = 0
    for key in src_keys:
        meta = by_key[key]
        if key not in inv:
            inv[key] = {"schema_name": s_schema, "function_name": key[0],
                        "arg_signature": key[1], "kind": meta["kind"],
                        "created": today, "updated": today}
            added += 1
        else:
            inv[key]["kind"] = meta["kind"]
            inv[key]["schema_name"] = s_schema
            inv[key]["updated"] = today
            updated += 1
    stale = [k for k, r in inv.items()
             if k not in src_keys and r.get("updated", "") and r["updated"] < cutoff]
    for k in stale:
        del inv[k]
        removed += 1
    _write_csv(paths["fn_source"], FUNCTION_INVENTORY_FIELDS,
               sorted(inv.values(), key=lambda r: (r["function_name"], r["arg_signature"])))

    # --- TARGET CSV (source is master) ---
    tinv = _load_csv(paths["fn_target"], _key)
    master = set(inv.keys())
    for key in master:
        s_row = inv[key]
        if key not in tinv:
            tinv[key] = {"schema_name": t_schema, "function_name": key[0],
                         "arg_signature": key[1], "kind": s_row["kind"],
                         "created": s_row["created"], "updated": ""}
        else:
            tinv[key]["kind"] = s_row["kind"]
            tinv[key]["created"] = s_row.get("created", tinv[key].get("created", ""))
            tinv[key]["schema_name"] = t_schema
    for key in list(tinv.keys()):
        if key not in master:
            del tinv[key]
    missing = []
    confirmed = 0
    for key in tinv:
        if key in tgt_keys:
            tinv[key]["updated"] = today
            confirmed += 1
        else:
            missing.append(key)
    _write_csv(paths["fn_target"], FUNCTION_INVENTORY_FIELDS,
               sorted(tinv.values(), key=lambda r: (r["function_name"], r["arg_signature"])))

    rows = []
    for key in sorted(master):
        s_row, t_row = inv[key], tinv.get(key, {})
        in_tgt = key in tgt_keys
        rows.append({
            "name": key[0],
            "arg_signature": key[1],
            "kind": s_row.get("kind", ""),
            "in_source": True,
            "in_target": in_tgt,
            "created": s_row.get("created", ""),
            "source_updated": s_row.get("updated", ""),
            "target_updated": t_row.get("updated", ""),
            "last_seen": t_row.get("updated", "") or None,
            "status": "present" if in_tgt else "missing_in_target",
        })
    return {
        "source_csv_path": paths["fn_source"],
        "target_csv_path": paths["fn_target"],
        "summary": {"source_total": len(master), "target_present": confirmed,
                    "target_missing": len(missing), "added": added,
                    "updated": updated, "removed": removed},
        "rows": rows,
    }


def build_inventory(conns):
    """Refresh the 4 per-side inventory CSVs and return the model for the UI."""
    model = cls.build_model(conns)  # discovery + effective classification
    paths = _inventory_paths(conns)
    return {
        "source_env": conns.source_env,
        "target_env": conns.target_env,
        "source_schema": conns.source_schema,
        "target_schema": conns.target_schema,
        "stale_days": conns.stale_days,
        "tables": _build_table_inventory(conns, model, paths),
        "functions": _build_function_inventory(conns, model, paths),
    }
