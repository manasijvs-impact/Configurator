"""One-shot helper: regenerate strategy_215_monthly_forecast_validation.sql and
strategy_215_monthly_actuals_validation.sql from the current Python validators.

Run this whenever the validator SQL changes — it keeps the static dumps in sync.
The validators' get_config() is bypassed by pre-populating db._config_cache with the
Leslies/test column conventions so this works without a live DB connection.

Usage:
    cd backend && python3 dump_strategy_215_monthly_validations.py
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from app.core.database import db
from app.validators.monthly_forecast import bp_monthly_forecast_validator
from app.validators.monthly_forecast_actuals import bp_monthly_forecast_actuals_validator

STRATEGY_ID = 215
FORECAST_OUT = os.path.join(HERE, "strategy_215_monthly_forecast_validation.sql")
ACTUALS_OUT = os.path.join(HERE, "strategy_215_monthly_actuals_validation.sql")

# Mirror Leslies/test config so get_config() doesn't need a live DB.
# These validators use instance-level _config_cache, not db._config_cache.
db.db_schema = "base_pricing"
LESLIES_CONFIG = {
    # bp_monthly_forecast_validator uses 'hierarchy_columns'; the actuals validator
    # doesn't need it. Keep both available; harmless extras are ignored.
    "hierarchy_columns": ["l0_cid", "l1_cid", "l2_cid", "l3_cid"],
    "channel_column": "s0_cid",
    "channel_name_column": "s0_name",
    "kvi_column": "attribute_9",
    "price_lock_column": "attribute_6",
    "zone_exception_column": "attribute_7",
}
bp_monthly_forecast_validator._config_cache = dict(LESLIES_CONFIG)
bp_monthly_forecast_actuals_validator._config_cache = dict(LESLIES_CONFIG)

forecast_sql = bp_monthly_forecast_validator.build_validation_query(STRATEGY_ID)
actuals_sql = bp_monthly_forecast_actuals_validator.build_monthly_actuals_validation_query(STRATEGY_ID)

with open(FORECAST_OUT, "w") as fh:
    fh.write(forecast_sql)
with open(ACTUALS_OUT, "w") as fh:
    fh.write(actuals_sql)

print(f"Wrote {FORECAST_OUT}  ({len(forecast_sql):>7,} chars)")
print(f"Wrote {ACTUALS_OUT}  ({len(actuals_sql):>7,} chars)")
