# Summary Cards Validator - Step by Step Documentation

## Overview

The Summary Cards Validator aggregates metrics from reco tables to produce **grand totals** for the Summary Cards UI component.

**Calculates:** Sales Units, Revenue, GM$, ASP, AUM, GM% broken down by:
- **Total** (Actuals + Forecast)
- **Actuals** (past period)
- **Forecast** (future period)

For all 3 price scenarios: **Current**, **IA**, **Finalized**

---

## Key Difference from Forecast Validator

| Aspect | Forecast Validator | Summary Cards Validator |
|--------|-------------------|------------------------|
| **Purpose** | Validate bin-level calculations | Aggregate to grand totals |
| **Output** | Per-bin MATCH/MISMATCH | Single row with totals |
| **Data Source** | Transaction + Simulation data | Reco tables only |
| **Complexity** | 19 CTEs | 3 CTEs |

---

## Step-by-Step CTE Flow

### Step 1: `current_data` CTE
**Purpose:** Aggregate all metrics from Current reco table

**Source Table:** `bp_price_reco_current_v2`

```sql
SELECT
    -- Additive metrics (direct sums)
    SUM(sales_units) AS total_sales_units,
    SUM(revenue) AS total_revenue,
    SUM(gross_margin_dollar) AS total_gross_margin_dollar,
    SUM(actuals_sales_units) AS actuals_sales_units,
    SUM(actuals_revenue) AS actuals_revenue,
    SUM(actuals_gross_margin_dollar) AS actuals_gross_margin_dollar,
    
    -- Derived: Forecast = Total - Actuals
    SUM(sales_units) - SUM(actuals_sales_units) AS forecast_sales_units,
    SUM(revenue) - SUM(actuals_revenue) AS forecast_revenue,
    SUM(gross_margin_dollar) - SUM(actuals_gross_margin_dollar) AS forecast_gross_margin_dollar,
    
    -- Weighted sums for Total rates (for weighted averages)
    SUM(asp * sales_units) AS total_asp_weighted,
    SUM(aum * sales_units) AS total_aum_weighted,
    SUM(gross_margin_percentage * sales_units) AS total_gm_pct_weighted,
    
    -- Weighted sums for Actuals rates
    SUM(actuals_asp * actuals_sales_units) AS actuals_asp_weighted,
    SUM(actuals_aum * actuals_sales_units) AS actuals_aum_weighted,
    SUM(actuals_gross_margin_percentage * actuals_sales_units) AS actuals_gm_pct_weighted

FROM bp_price_reco_current_v2
WHERE strategy_id = ?
```

**Key Points:**
- Additive metrics (units, revenue, GM$) are directly summed
- Rate metrics (ASP, AUM, GM%) need weighted sums for later division
- Forecast is derived by subtracting actuals from total

---

### Step 2: `ia_data` CTE
**Purpose:** Same aggregation from IA reco table

**Source Table:** `bp_price_reco_ia_v2`

```sql
-- Identical structure to current_data, just different source table
SELECT ... FROM bp_price_reco_ia_v2 WHERE strategy_id = ?
```

---

### Step 3: `finalized_data` CTE
**Purpose:** Same aggregation from Finalized reco table

**Source Table:** `bp_price_reco_finalized_v2`

```sql
-- Identical structure to current_data, just different source table
SELECT ... FROM bp_price_reco_finalized_v2 WHERE strategy_id = ?
```

---

### Step 4: Final SELECT
**Purpose:** Calculate weighted averages and comparisons

#### 4a. Output Additive Metrics (direct from CTEs)
```sql
SELECT
    c.total_sales_units AS current_total_sales,
    c.actuals_sales_units AS current_actuals_sales,
    c.forecast_sales_units AS current_forecast_sales,
    c.total_revenue AS current_total_revenue,
    c.actuals_revenue AS current_actuals_revenue,
    -- ... same for IA (i.) and Finalized (f.)
```

#### 4b. Calculate Weighted Averages for Rates
```sql
-- Formula: weighted_sum / total_units

-- Total ASP
COALESCE(c.total_asp_weighted / NULLIF(c.total_sales_units, 0), 0) AS current_total_asp,

-- Actuals ASP
COALESCE(c.actuals_asp_weighted / NULLIF(c.actuals_sales_units, 0), 0) AS current_actuals_asp,

-- Forecast ASP (total weighted - actuals weighted) / forecast units
COALESCE((c.total_asp_weighted - c.actuals_asp_weighted) / NULLIF(c.forecast_sales_units, 0), 0) AS current_forecast_asp,

-- Same pattern for AUM and GM%
```

#### 4c. Calculate "Vs Current" Deltas
```sql
-- Sales/Revenue/GM$ = Direct difference
ROUND((i.total_sales_units - c.total_sales_units)::numeric, 0) AS ia_vs_current_sales,
ROUND((i.total_revenue - c.total_revenue)::numeric, 2) AS ia_vs_current_revenue,

-- ASP/AUM = Dollar difference
ROUND((ia_total_asp - current_total_asp)::numeric, 2) AS ia_vs_current_asp,

-- GM% = Percent change
ROUND(((ia_gm_pct - current_gm_pct) / current_gm_pct * 100)::numeric, 2) AS ia_vs_current_gm_pct
```

---

## Weighted Average Calculation

**Why weighted average?** Each bin has different sales volumes. A bin with 10,000 units should contribute more to the average than a bin with 100 units.

**Formula:** `Weighted Avg = Σ(rate × units) / Σ(units)`

**Example:**
```
Bin 1: ASP = $10, Units = 1000  →  $10 × 1000 = $10,000
Bin 2: ASP = $15, Units = 2000  →  $15 × 2000 = $30,000
Bin 3: ASP = $20, Units = 500   →  $20 × 500  = $10,000

Total ASP = ($10,000 + $30,000 + $10,000) / (1000 + 2000 + 500)
          = $50,000 / 3500
          = $14.29

NOT simple average: ($10 + $15 + $20) / 3 = $15  ❌
```

---

## Output Structure

The validator returns a structured JSON with metrics for each price scenario:

```json
{
  "strategy_id": 123,
  "current": {
    "sales_units": {"actuals": 5000, "forecast": 10000, "total": 15000},
    "revenue": {"actuals": 50000, "forecast": 100000, "total": 150000},
    "gross_margin": {"actuals": 15000, "forecast": 30000, "total": 45000},
    "asp": {"actuals": 10.0, "forecast": 10.0, "total": 10.0},
    "aum": {"actuals": 3.0, "forecast": 3.0, "total": 3.0},
    "gm_pct": {"actuals": 30.0, "forecast": 30.0, "total": 30.0}
  },
  "ia": { ... },
  "finalized": { ... },
  "vs_current": {
    "ia": {"sales": 500, "revenue": 5000, "gm": 1500, "asp": 0.5, "aum": 0.15, "gm_pct": 1.5},
    "finalized": { ... }
  }
}
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     RECO TABLES (Bin Level)                      │
│                                                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ bp_price_reco_  │  │ bp_price_reco_  │  │ bp_price_reco_  │  │
│  │   current_v2    │  │     ia_v2       │  │  finalized_v2   │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │            │
└───────────┼────────────────────┼────────────────────┼────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
   ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
   │  current_data  │   │    ia_data     │   │ finalized_data │
   │                │   │                │   │                │
   │ • SUM(units)   │   │ • SUM(units)   │   │ • SUM(units)   │
   │ • SUM(revenue) │   │ • SUM(revenue) │   │ • SUM(revenue) │
   │ • SUM(gm$)     │   │ • SUM(gm$)     │   │ • SUM(gm$)     │
   │ • weighted_asp │   │ • weighted_asp │   │ • weighted_asp │
   │ • weighted_aum │   │ • weighted_aum │   │ • weighted_aum │
   │ • weighted_gm% │   │ • weighted_gm% │   │ • weighted_gm% │
   └────────┬───────┘   └────────┬───────┘   └────────┬───────┘
            │                    │                    │
            └────────────────────┼────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │      FINAL SELECT       │
                    │                         │
                    │ • Additive: direct sums │
                    │ • Rates: weighted ÷ sum │
                    │ • Deltas: IA/Fin vs Cur │
                    └─────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │     SUMMARY CARDS       │
                    │                         │
                    │  Current │ IA │ Final   │
                    │ ─────────┼────┼─────── │
                    │  Actuals │    │         │
                    │  Forecast│    │         │
                    │  Total   │    │         │
                    └─────────────────────────┘
```

---

## Optional Filters

### Channel Filter
```sql
WHERE strategy_id = ? AND channel_id IN (1, 2, 3)
```

Used when user wants to see Summary Cards for specific channels only.

---

## Metrics Breakdown

| Metric | Calculation | Notes |
|--------|-------------|-------|
| **Sales Units** | `SUM(sales_units)` | Direct sum, integer |
| **Revenue** | `SUM(revenue)` | Direct sum, 2 decimals |
| **GM$** | `SUM(gross_margin_dollar)` | Direct sum, 2 decimals |
| **ASP** | `SUM(asp × units) / SUM(units)` | Weighted average |
| **AUM** | `SUM(aum × units) / SUM(units)` | Weighted average |
| **GM%** | `SUM(gm% × units) / SUM(units)` | Weighted average |

---

## Key Tables Used

| Table | Purpose |
|-------|---------|
| `bp_price_reco_current_v2` | Current price scenario metrics |
| `bp_price_reco_ia_v2` | IA price scenario metrics |
| `bp_price_reco_finalized_v2` | Finalized price scenario metrics |
| `bp_store_master` | Channel names (for display) |
| `bp_store_hierarchy_level` | Channel column configuration |

---

## Comparison: Reco Table Columns Used

| Column | Used For |
|--------|----------|
| `sales_units` | Total sales |
| `revenue` | Total revenue |
| `gross_margin_dollar` | Total GM$ |
| `asp` | Stored ASP (for weighted sum) |
| `aum` | Stored AUM (for weighted sum) |
| `gross_margin_percentage` | Stored GM% (for weighted sum) |
| `actuals_sales_units` | Actuals portion |
| `actuals_revenue` | Actuals revenue |
| `actuals_gross_margin_dollar` | Actuals GM$ |
| `actuals_asp` | Stored actuals ASP |
| `actuals_aum` | Stored actuals AUM |
| `actuals_gross_margin_percentage` | Stored actuals GM% |
