52 Weeks Projections — Validation Approach
==========================================

Two monthly validators together cover the entire projection range for a strategy:

  1. **bp_monthly_reco_metrics_validator**     → validates `bp_monthly_forecast`
  2. **bp_monthly_forecast_actuals_validator**  → validates `bp_monthly_forecast_actuals`

The split is anchored at `max_actuals_date` (MAX of `bp_transaction_data_daily`):

  - Past months (`end_date <= max_actuals_date`)   → handled by **actuals** validator
  - Future months / spanning the cutoff             → handled by **forecast** validator


============================================================================
MONTHLY FORECAST VALIDATION
============================================================================

Validates `bp_monthly_forecast` by recalculating expected values using elasticity
formulas and comparing with stored values. Output is driven by the **fiscal
calendar** (not by `bp_monthly_forecast` rows), so missing stored months surface
as `MISSING_STORED` rather than being silently skipped.

STEP 1 — DETERMINE THE ACTIVE FISCAL YEAR
------------------------------------------
Single-vs-multi-FY rule:

  - Strategy fits inside a single FY  → use **strategy's FY**
  - Strategy crosses an FY boundary   → use **today's FY**

This is the FY that drives `FISCAL_YEAR` and `FISCAL_YEAR_Qx` config resolution.
`CALENDAR_YEAR` (12 Months) does **not** use this — it always anchors on
`strategy_start_date`.

STEP 2 — RESOLVE EACH ACTIVE FORECAST CONFIG
---------------------------------------------
For each active row in `bp_forecast_cal_config` (skip `CURRENT_STRATEGY_PERIOD`):

| `start_reference`     | resolves to                                  |
|-----------------------|----------------------------------------------|
| `fiscal_year_start`   | `fi.fiscal_fd_year`                          |
| `strategy_start_date` | `sp.start_date`                              |
| `quarter_start`       | `MIN(fiscal_fd_qtr)` over `cumulative_quarters` |

| `end_reference`   | resolves to                                       |
|-------------------|---------------------------------------------------|
| `fiscal_year_end` | `fi.fiscal_ld_year`                               |
| `twelve_months`   | `fiscal_ld_month` of `(sp.start_date + 12 months)` |
| `quarter_end`     | `MAX(fiscal_ld_qtr)` over `cumulative_quarters`   |

Quarter bounds use **cumulative_quarters** (covers both projection modes):

  - `projection_mode = discrete`,   `cumulative_quarters = {Q}`       → MIN/MAX = Q's start/end
  - `projection_mode = cumulative`, `cumulative_quarters = {Q1..Qn}`  → MIN = Q1.start, MAX = Qn.end

STEP 3 — COMPUTE `validation_range`
------------------------------------
```
range_start = MIN(resolved_start) across active configs
range_end   = MAX(resolved_end)   across active configs
```
Fallback: if no active configs produce a usable range, use strategy dates.

STEP 4 — DERIVE `expected_months` FROM THE FISCAL CALENDAR
-----------------------------------------------------------
```
expected_months =
    SELECT DISTINCT fiscal_year, fiscal_month, fiscal_fd_month, fiscal_ld_month, …
    FROM global.tb_fiscal_date_mapping
    WHERE fiscal_fd_month >= validation_range.range_start
      AND fiscal_ld_month <= validation_range.range_end
```

Each expected month is categorized by `max_actuals_date`:

| Condition                                       | `validation_type`  | Source           |
|-------------------------------------------------|--------------------|------------------|
| `end_date <= max_actuals_date`                  | `ACTUALS`          | (skipped — owned by actuals validator) |
| `start_date > max_actuals_date`                 | `FULL_FORECAST`    | monthly sim tables |
| `start_date <= max_actuals_date < end_date`     | `PARTIAL_FORECAST` | weekly sim tables  |

For `PARTIAL_FORECAST`: `forecast_start_date = max_actuals_date + 1 day`.

STEP 5 — BUILD `expected_grid`
-------------------------------
```
expected_grid = our_bins × expected_months   (only FULL_FORECAST / PARTIAL_FORECAST)
```

This is what drives the validator's output. Stored values and calculated values
are `LEFT JOIN`'d onto the grid — so missing data is detectable, not silently
dropped.

STEP 6 — COMPUTE FORECASTS
---------------------------
**FULL_FORECAST path** (monthly sim tables):

  - `bp_simulation_month`
  - `bp_simulation_promo_month`
  - `bp_simulation_store_split_ratio_month` (non-KVI, hierarchy join) and `_kvi_month`

**PARTIAL_FORECAST path** (weekly sim tables, boundary-week aware):

  - `bp_simulation_week`
  - `bp_simulation_promo_week_with_store` (store-level, **preferred**)
  - `bp_simulation_promo_week`             (channel-level, fallback)
  - `bp_simulation_store_split_ratio_kvi` / `bp_simulation_store_split_ratio` (non-KVI)
  - `bp_simulation_day_split_ratio_kvi`    / `bp_simulation_day_split_ratio`  (non-KVI)

Filters:

  - **Weekly tables**: `week_start_date >= max_actuals_date - 6 days` AND `<= forecast_end_date`
    (catches the boundary week containing the cutoff)
  - **Day split**: `d.date > max_actuals_date` AND `d.date <= mi.end_date`
    (so the boundary week's `week_split_ratio` sums only the forecast days; later
    fully-forecast weeks sum to 1.0)

Promo preference: store-level COALESCE'd before channel-level — matches the
existing `reco_metrics_validator` pattern:
```
COALESCE(pws.weighted_promo_percent, pwc.weighted_promo_percent, 0)
COALESCE(pws.promo_source,           pwc.promo_source,           0)
COALESCE(pws.effective_reference_price, pwc.effective_reference_price, 0)
```

STEP 7 — APPLY ELASTICITY
--------------------------
For each of Current / IA / Finalized:
```
sales   = predicted × (1 + ε × (markup − base_pct))
                    × (1 + promo_ε × effective_promo_pct)
```
Where:

  - `predicted`           = SUM of granular (store-level) predictions
  - `markup`              = `(price − min_cost) / min_cost`
  - `effective_promo_pct` = 0 if `promo_source = 1 AND base_price <= effective_ref_price`,
                            else `weighted_promo_percent`

Derived metrics:
```
revenue = ROUND(sales) × promo_price
gm$     = (promo_price − cost) × ROUND(sales)
asp     = revenue / sales
aum     = gm$     / sales
gm%     = gm$ / revenue × 100
```

STEP 8 — 5-STATE MATCH
-----------------------
For each metric the validator emits one of:

| State            | Meaning                                          |
|------------------|--------------------------------------------------|
| `MATCH`          | Values agree within tolerance                    |
| `MISMATCH`       | Both sides have data but disagree                |
| `MISSING_STORED` | Calc has data, stored row absent                 |
| `MISSING_CALC`   | Stored has data, calc absent (usually sim gap)   |
| `MISSING_BOTH`   | Neither side has data — **filtered out before output** |

Tolerances:

  - Sales units: integer-equal (no tolerance)
  - Everything else: `abs(stored − calc) < 0.01` on 2-decimal rounded values

The final SELECT drops `MISSING_BOTH` rows. A row appears in output iff at
least one side (stored OR calc) has a value:
```sql
WHERE sf.stored_curr_sales_units IS NOT NULL
   OR fm.rounded_sales_current   IS NOT NULL
```


============================================================================
MONTHLY ACTUALS VALIDATION
============================================================================

Validates `bp_monthly_forecast_actuals` by recalculating actuals from transaction
tables. Same calendar-driven, `expected_grid` pattern as the forecast validator.

STEP 1 — SCOPE TO STRATEGY'S FISCAL YEAR
-----------------------------------------
The actuals validator scopes to the FY containing `strategy_start_date`
(`fiscal_fd_year` … `fiscal_ld_year`).

STEP 2 — CATEGORIZE EACH FISCAL MONTH BY `max_actuals_date`
------------------------------------------------------------

| Condition                                              | `calc_coverage` | Source                              |
|--------------------------------------------------------|-----------------|-------------------------------------|
| `fiscal_ld_month <= max_actuals_date`                  | `FULL_MONTH`    | `bp_transaction_data_monthly`       |
| `fiscal_fd_month <= max_actuals_date < fiscal_ld_month` | `PARTIAL`      | `bp_transaction_data_daily` (capped at `max_actuals_date`) |
| `fiscal_fd_month > max_actuals_date`                   | `NO_DATA`       | (skipped — no actuals yet)          |

STEP 3 — BUILD `expected_grid`
-------------------------------
```
expected_grid = our_bins × fiscal_months
                (NO_DATA months excluded upstream)
```

STEP 4 — TWO-STAGE AGGREGATION (mirrors reco_metrics_validator)
------------------------------------------------------------
**Stage 1 — granular** (per `product × store × segment × fiscal_year × fiscal_month`):
```
sales_units = SUM(units)
revenue     = SUM(revenue)
gm$         = SUM(margin)
asp         = revenue / sales_units      (per-store rate)
aum         = gm$     / sales_units
gm%         = gm$ / revenue × 100
```

**Stage 2 — bin-level rollup** (per `opt_level_bins × month`):
```
Additive metrics  → SUM as-is
Rate metrics      → sales-units-weighted average:
                    SUM(rate × units) / SUM(units)
```

STEP 5 — 5-STATE MATCH
-----------------------
Same scheme as the forecast side (`MATCH` / `MISMATCH` / `MISSING_STORED` /
`MISSING_CALC` / `MISSING_BOTH`). `MISSING_BOTH` rows are dropped before output:
```sql
WHERE sa.stored_sales_units IS NOT NULL
   OR ab.calc_sales_units   IS NOT NULL
```

Plus a `coverage_match`: stored `coverage` vs calculated `calc_coverage`
(`FULL_MONTH` / `PARTIAL`).


============================================================================
KEY TABLES
============================================================================

**Source-of-truth (the tables being validated):**

  - `bp_monthly_forecast`            — forecast validator's target
  - `bp_monthly_forecast_actuals`    — actuals validator's target

**Recompute sources:**

  - Forecast: `bp_simulation_{month,week}`, `bp_simulation_promo_{month,week,week_with_store}`,
              `bp_simulation_store_split_ratio_{month,kvi_month,_,kvi}`,
              `bp_simulation_day_split_ratio_{_,kvi}`,
              `bp_price_reco_{current,ia,finalized}_v2`
  - Actuals:  `bp_transaction_data_{monthly,daily}`

**Range / category drivers:**

  - `bp_forecast_cal_config`         — active configs → `validation_range`
  - `bp_transaction_data_daily`      — `MAX(transaction_date)` → `max_actuals_date`
  - `global.tb_fiscal_date_mapping`  — fiscal calendar (months, quarters, years)

**Bins:**

  - `bp_product_store_attributes_mapping_v4` — attributes + price zone → `opt_level_bins`
  - `bp_product_master`, `bp_store_master`   — hierarchy / channel
  - `bp_strategy_products_stores`            — strategy scope


============================================================================
FILES
============================================================================

  - `bp_monthly_reco_metrics_validator.py`
  - `bp_monthly_forecast_actuals_validator.py`
  - `validation_planner.py`
  - `strategy_215_monthly_forecast_validation.sql`   (literal example — paste-ready)
  - `strategy_215_monthly_actuals_validation.sql`    (literal example — paste-ready)
  - `strategy_215_validation_preflight.sql`          (preflight diagnostics)

---
Last updated: 2026-05-25
