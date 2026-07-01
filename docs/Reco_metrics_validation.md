# Forecast Validator - Step by Step Documentation

## Overview

The Forecast Validator compares **stored values** in reco tables against **calculated values** from source data to ensure data integrity.

**Validates:** Sales Units, Baseline Sales, Revenue, GM$, GM%, ASP, AUM, and Actuals

---

## Two Modes of Operation

| Mode | When Used | Formula |
|------|-----------|---------|
| **Actuals + Forecast** | Strategy status = 210 (Active) or 220 (Completed) | Total = Actuals + Forecast |
| **Forecast Only** | Other statuses | Total = Forecast (no actuals) |

---

## Step-by-Step CTE Flow

### Step 1: `strategy_params`
**Purpose:** Get strategy date range and status

```sql
SELECT strategy_id, start_date, end_date, strategy_status_id
FROM bp_strategy_master
WHERE strategy_id = ?
```

**Output:** Strategy configuration used throughout the query

---

### Step 2: `actuals_cutoff` (Active strategies only)
**Purpose:** Find the last date with actual transaction data

```sql
SELECT MAX(transaction_date) AS max_actuals_date
FROM bp_transaction_data_daily
WHERE transaction_date BETWEEN start_date AND end_date
```

**Why:** Splits the strategy period into:
- **Past (actuals):** `start_date` to `max_actuals_date` (inclusive)
- **Future (forecast):** `max_actuals_date + 1` to `end_date` (uses `> max_actuals_date`)

---

### Step 3: `strategy_products` & `strategy_products_with_kvi`
**Purpose:** Get all product/store/segment combinations in the strategy

```sql
-- Products in strategy
SELECT product_id, store_id, segment_id
FROM bp_strategy_products_stores
WHERE strategy_id = ?

-- Add KVI flag
JOIN bp_product_store_attributes_mapping_v4 
    → is_kvi (boolean)
```

**Why:** KVI products use different day-split and store-split tables

---

### Step 4: `bins_mapping`
**Purpose:** Map each product/store/segment to its optimization bin

```sql
opt_level_bins = product_id || '_' || 
    CASE 
        WHEN price_lock OR zone_exception OR no_zone 
        THEN store_id || '_' || segment_id
        ELSE effective_price_zone || '_' || segment_id
    END
```

**Output:** 
- `opt_level_bins` - Unique bin identifier
- `price_zone_display` - Human-readable zone name
- Flags: `price_lock_val`, `zone_exception_val`

---

### Step 5: `actuals_granular` (Active strategies only)
**Purpose:** Calculate actuals at product/store/segment level

```sql
SELECT 
    opt_level_bins, product_id, store_id, segment_id,
    SUM(sales_units) AS sales_units,
    SUM(total_revenue) AS revenue,
    SUM(total_margin) AS gm_dollar,
    -- Direct rate calculations
    revenue / sales_units AS asp,
    gm_dollar / sales_units AS aum,
    (gm_dollar / revenue) * 100 AS gm_pct
FROM bins_mapping
JOIN bp_transaction_data_daily
WHERE transaction_date BETWEEN start_date AND max_actuals_date
GROUP BY opt_level_bins, product_id, store_id, segment_id
```

**Why granular first:** Need rates at lowest level before aggregating

---

### Step 6: `actuals_by_bin` (Active strategies only)
**Purpose:** Aggregate actuals to bin level with weighted averages

```sql
SELECT 
    opt_level_bins, product_id,
    -- Sums (additive)
    SUM(sales_units) AS actual_sales_units,
    SUM(revenue) AS actual_revenue,
    SUM(gm_dollar) AS actual_gm_dollar,
    -- Weighted averages for rates
    SUM(asp * sales_units) / SUM(sales_units) AS actual_asp,
    SUM(aum * sales_units) / SUM(sales_units) AS actual_aum,
    SUM(gm_pct * sales_units) / SUM(sales_units) AS actual_gm_pct
FROM actuals_granular
GROUP BY opt_level_bins, product_id
```

**Why weighted:** Multiple stores with different ASPs combine into one bin

---

### Step 7: `reco_current`, `reco_ia`, `reco_finalized`
**Purpose:** Get stored values from all 3 reco tables

```sql
SELECT 
    opt_level_bins, product_id, base_price, cost,
    sales_units, baseline_sales, revenue, gross_margin_dollar,
    asp, aum, gross_margin_percentage,
    -- Stored actuals
    actuals_sales_units, actuals_revenue, actuals_gross_margin_dollar,
    actuals_asp, actuals_aum, actuals_gross_margin_percentage
FROM bp_price_reco_current_v2  -- (also _ia_v2, _finalized_v2)
WHERE strategy_id = ?
```

---

### Step 8: `reco_all`
**Purpose:** Combine all 3 reco tables into one

```sql
SELECT * FROM reco_current
FULL OUTER JOIN reco_ia
FULL OUTER JOIN reco_finalized
```

**Output:** One row per bin with columns from all 3 tables (current, IA, finalized)

---

### Step 9: `sim_week`
**Purpose:** Get simulation week data for forecast calculation

```sql
SELECT 
    product_id, channel_id, segment_id, week_start_date,
    min_cost, base_percentage, sales_units AS sim_sales_units,
    elasticity_bp, promo_elasticity, price_point, is_kvi
FROM bp_simulation_week
WHERE week_start_date > max_actuals_date  -- Future weeks only
```

---

### Step 10: `promo_week_store` & `promo_week_channel`
**Purpose:** Get promotion data (store-level or channel-level fallback)

```sql
SELECT 
    product_id, store_id/channel_id, segment_id, week_start_date,
    weighted_promo_percent, promo_source, effective_reference_price
FROM bp_simulation_promo_week_with_store  -- or bp_simulation_promo_week
WHERE week_start_date > max_actuals_date
```

---

### Step 11: `day_split_kvi` & `day_split_non_kvi` → `day_split`
**Purpose:** Get day-level split ratios (different tables for KVI vs non-KVI)

```sql
-- KVI uses: bp_simulation_day_split_ratio_kvi (joins on product_id)
-- Non-KVI uses: bp_simulation_day_split_ratio (joins on hierarchy)

SELECT product_id, channel_id, segment_id, week_start_date,
       SUM(day_split_ratio) AS week_split_ratio
```

---

### Step 12: `store_split_kvi` & `store_split_non_kvi` → `store_split`
**Purpose:** Get store-level split ratios

```sql
-- KVI uses: bp_simulation_store_split_ratio_kvi
-- Non-KVI uses: bp_simulation_store_split_ratio

SELECT product_id, store_id, segment_id, week_start_date,
       store_split_ratio
```

---

### Step 13: `granular_forecast`
**Purpose:** Calculate forecast at granular level (product/store/segment/week)

```sql
SELECT 
    sc.product_id, sc.store_id, sc.segment_id, sc.opt_level_bins,
    sw.sim_sales_units * ds.week_split_ratio * ss.store_split_ratio 
        AS granular_predicted,
    -- Also carries: min_cost, base_percentage, elasticity, promo data
FROM store_channel sc
JOIN sim_week sw
JOIN day_split ds
JOIN store_split ss
LEFT JOIN promo_week_store/channel
```

**Formula:** `granular_predicted = sim_units × day_split × store_split`

---

### Step 14: `forecast_aggregated`
**Purpose:** Aggregate forecast to bin level

```sql
SELECT 
    opt_level_bins, product_id,
    SUM(granular_predicted) AS forecast_predicted,
    AVG(min_cost), AVG(price_point), AVG(base_percentage),
    AVG(elasticity_bp), AVG(promo_elasticity), AVG(weighted_promo_percent),
    COUNT(DISTINCT store_id) AS store_count,
    COUNT(DISTINCT week_start_date) AS week_count
FROM granular_forecast
GROUP BY opt_level_bins, product_id
```

---

### Step 15: `combined_metrics`
**Purpose:** Join actuals + reco + forecast

```sql
SELECT 
    r.*,  -- All reco data
    a.actual_sales_units, a.actual_revenue, a.actual_gm_dollar,
    a.actual_asp, a.actual_aum, a.actual_gm_pct,
    fa.forecast_predicted, fa.avg_min_cost, fa.avg_elasticity, ...
FROM reco_all r
LEFT JOIN actuals_by_bin a
LEFT JOIN forecast_aggregated fa
```

---

### Step 16: `calculated`
**Purpose:** Apply sales units & baseline formulas

**Sales Units Formula:**
```sql
calc_sales = actual_sales_units + (
    forecast_predicted 
    × (1 + elasticity × (markup - base_percentage))  -- Price effect
    × (1 + promo_elasticity × promo_pct)            -- Promo effect
)
```

**Baseline Formula:** Same but WITHOUT promo effect
```sql
calc_baseline = actual_sales_units + (
    forecast_predicted 
    × (1 + elasticity × (markup - base_percentage))
)
```

**Where:**
- `markup = (base_price - min_cost) / min_cost`
- `effective_promo_pct` = 0 if promo_source=1 AND price ≤ reference_price

---

### Step 17: `metrics`
**Purpose:** Calculate revenue and GM$

```sql
-- Revenue = (actual_revenue) + (forecast_units × promo_price)
calc_revenue = actual_revenue + ROUND(forecast_sales) × promo_price

-- GM$ = (actual_gm) + ((promo_price - cost) × forecast_units)
calc_gm_dollar = actual_gm_dollar + (promo_price - cost) × ROUND(forecast_sales)

-- Baseline uses base_price instead of promo_price
calc_baseline_revenue = actual_revenue + ROUND(forecast_baseline) × base_price
```

---

### Step 18: `final_metrics`
**Purpose:** Calculate ASP, AUM, GM%

```sql
calc_asp = calc_revenue / rounded_sales_units
calc_aum = calc_gm_dollar / rounded_sales_units
calc_gm_pct = (calc_gm_dollar / calc_revenue) × 100
```

---

### Step 19: Final SELECT
**Purpose:** Output comparison + match indicators

```sql
SELECT
    -- Identification
    opt_level_bins, product_code, channel_name, price_zone, segment_name,
    
    -- Strategy info
    actuals_cutoff_date, actual_days, strategy_start, strategy_end,
    
    -- Stored vs Calculated (for each: current, IA, finalized)
    stored_sales_current, calc_sales_current,
    stored_baseline_current, calc_baseline_current,
    stored_revenue_current, calc_revenue_current,
    ...
    
    -- Match indicators
    CASE WHEN stored = calc THEN 'MATCH' ELSE 'MISMATCH' END AS sales_current_match,
    ...
    
    -- Actuals match (stored in reco vs calculated from transactions)
    CASE WHEN reco_actuals = calc_actuals THEN 'MATCH' ELSE 'MISMATCH' END
```

---

## Match Tolerances

| Metric | Tolerance | Comparison |
|--------|-----------|------------|
| Sales Units, Baseline | 0 (exact) | Rounded integers |
| Revenue, GM$ | < 0.01 | Rounded to 2 decimals |
| GM%, ASP, AUM | < 0.01 | Rounded to 2 decimals |
| Promo % | < 0.01 | 4 decimal places |

---

## Data Flow Diagram

```
                    ┌─────────────────────────────────────────────────────┐
                    │              STRATEGY CONFIGURATION                  │
                    │  strategy_params → actuals_cutoff → strategy_products │
                    └─────────────────────────────────────────────────────┘
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    │                                                     │
                    ▼                                                     ▼
        ┌─────────────────────┐                           ┌─────────────────────┐
        │   ACTUALS PATH      │                           │   FORECAST PATH     │
        │  (Transaction Data) │                           │  (Simulation Data)  │
        └─────────────────────┘                           └─────────────────────┘
                    │                                                     │
                    ▼                                                     ▼
        ┌─────────────────────┐                           ┌─────────────────────┐
        │  actuals_granular   │                           │      sim_week       │
        │  (product/store/seg)│                           │   promo_week_*      │
        └─────────────────────┘                           │   day_split_*       │
                    │                                     │   store_split_*     │
                    ▼                                     └─────────────────────┘
        ┌─────────────────────┐                                       │
        │   actuals_by_bin    │                                       ▼
        │  (weighted avg)     │                           ┌─────────────────────┐
        └─────────────────────┘                           │  granular_forecast  │
                    │                                     │  (prod/store/seg/wk)│
                    │                                     └─────────────────────┘
                    │                                                 │
                    │                                                 ▼
                    │                                     ┌─────────────────────┐
                    │                                     │ forecast_aggregated │
                    │                                     │   (bin level)       │
                    │                                     └─────────────────────┘
                    │                                                 │
                    └──────────────────┬──────────────────────────────┘
                                       │
                                       ▼
                          ┌─────────────────────────┐
                          │    combined_metrics     │
                          │  (actuals + forecast)   │
                          └─────────────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │                                      │
                    ▼                                      ▼
        ┌─────────────────────┐               ┌─────────────────────┐
        │     reco_all        │               │     calculated      │
        │  (stored values)    │               │  (sales formulas)   │
        └─────────────────────┘               └─────────────────────┘
                    │                                      │
                    │                                      ▼
                    │                         ┌─────────────────────┐
                    │                         │      metrics        │
                    │                         │  (revenue, GM$)     │
                    │                         └─────────────────────┘
                    │                                      │
                    │                                      ▼
                    │                         ┌─────────────────────┐
                    │                         │   final_metrics     │
                    │                         │  (ASP, AUM, GM%)    │
                    │                         └─────────────────────┘
                    │                                      │
                    └──────────────────┬───────────────────┘
                                       │
                                       ▼
                          ┌─────────────────────────┐
                          │     FINAL SELECT        │
                          │  stored vs calculated   │
                          │    MATCH/MISMATCH       │
                          └─────────────────────────┘
```

---

## Key Tables Used

| Table | Purpose |
|-------|---------|
| `bp_strategy_master` | Strategy dates & status |
| `bp_strategy_products_stores` | Products in strategy |
| `bp_product_store_attributes_mapping_v4` | Bins, zones, KVI, price_lock |
| `bp_transaction_data_daily` | Historical actuals |
| `bp_simulation_week` | Weekly simulation data |
| `bp_simulation_promo_week*` | Promo data |
| `bp_simulation_day_split_ratio*` | Day-level splits |
| `bp_simulation_store_split_ratio*` | Store-level splits |
| `bp_price_reco_current_v2` | Current prices reco |
| `bp_price_reco_ia_v2` | IA prices reco |
| `bp_price_reco_finalized_v2` | Finalized prices reco |
