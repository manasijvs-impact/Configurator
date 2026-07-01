"""One-shot helper: dump the reco_metrics_validator queries for strategy 1527
(both FORECAST-ONLY and ACTUALS + FORECAST modes) into strategy_1527_reco_validation.sql.

The validator's pure string-building methods don't need a live DB connection — only
get_config() does. We pre-populate db._config_cache with the canonical leslies/test
values (matching what /api/validation/query/1527 returned) so the builders can run
offline.

Usage:
    cd backend && python3 dump_strategy_1527_reco_validation.py
"""

import os
import sys

# Ensure backend dir is on sys.path so we can import siblings.
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from app.core.database import db
from app.validators.reco_metrics import reco_metrics_validator

STRATEGY_ID = 1527
OUT_PATH = os.path.join(HERE, "strategy_1527_reco_validation.sql")

# Mirror the config the live backend returns for leslies/test.
db.db_schema = "base_pricing"
db._config_cache = {
    "hierarchy_fields": "l0_cid, l1_cid, l2_cid, l3_cid",
    "hierarchy_list": ["l0_cid", "l1_cid", "l2_cid", "l3_cid"],
    "channel_column": "s0_cid",
    "channel_name_column": "s0_name",
    "kvi_column": "attribute_9",
    "price_lock_column": "attribute_6",
    "zone_exception_column": "attribute_7",
}

forecast_only = reco_metrics_validator._build_unified_query(STRATEGY_ID, include_actuals=False)
with_actuals = reco_metrics_validator._build_unified_query(STRATEGY_ID, include_actuals=True)

separator = (
    "\n\n"
    "-- " + "=" * 78 + "\n"
    "-- END OF FORECAST-ONLY QUERY\n"
    "-- " + "=" * 78 + "\n\n"
)

with open(OUT_PATH, "w") as fh:
    fh.write(forecast_only)
    fh.write(separator)
    fh.write(with_actuals)

print(f"Wrote {OUT_PATH}")
print(f"  forecast_only : {len(forecast_only):>7,} chars")
print(f"  with_actuals  : {len(with_actuals):>7,} chars")
