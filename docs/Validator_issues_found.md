# Recommendation & Monthly Forecast Validators

## 1. Recommendation (Reco) Metrics Status

### 1.1 Completed Fixes (Test/UAT)

- **Precision Management:** Predicted values were being converted to `int` before deriving downstream metrics, which caused a baseline mismatch. This conversion issue has been addressed.
- **Promo Pricing Logic:** A substitution bug was identified where promoted units were using `effective_reference_price` instead of the actual reco-table prices. Actual reco-table prices are now correctly utilized.
- **Financial Computation:** Revenue / GM$ on promoted rows was computed incorrectly as `units × base_price`. The calculation has been updated to `units × promo_price`, where `promo_price = base_price × (1 − effective_promo_pct)`, and is now consistent across all three states (Current, IA, Finalized).

### 1.2 Development Branch Enhancements

- **Grid Visibility:** New baseline columns for Average Selling Price (ASP) and Average Unit Margin (AUM) are being added to reco tables and surfaced in the UI grid.
- **Promo Synchronization:** Modified `effective_promo_pct` logic to compute once based on Current price and apply globally to IA and Finalized states, rather than independent computations.

### 1.3 Open Issues: Forecast CSV — Wrong Per-Week Fallback for Missing Promo Rows

When `sim_week` covers more strategy weeks than `bp_simulation_promo_week` has rows for a given bin (e.g. Leslies test strategy 1697: 14 sim weeks, only 5 promo weeks per bin), the forecast CSV pipeline coerces **all three** promo columns to `0` for missing weeks. That fallback is wrong for two of them — and the wrong fallback corrupts the bin-level aggregate:

**Current forecast-CSV behaviour (buggy):**

```sql
-- granular_forecast
COALESCE(pws.weighted_promo_percent,    pwc.weighted_promo_percent,    0) AS weighted_promo_percent,
COALESCE(pws.promo_source,              pwc.promo_source,              0) AS promo_source,
COALESCE(pws.effective_reference_price, pwc.effective_reference_price, 0) AS effective_reference_price,
```

- `MIN(promo_source)` over a mix of real `1`s and fallback `0`s collapses to **`0`** → bin labelled **CY Promo** even though every real row is **LY Promo**.
- `AVG(effective_reference_price)` is dragged toward 0 by the injected zeros (e.g. `$268` averaged with 9 zeros lands at `~$95`), so the `base ≤ eff_ref` override never fires.

**Required fix (per-column fallback semantics):**

Each promo column needs a different fallback because each represents something different at the week grain:

| Column | Missing-week fallback | Rationale |
|---|---|---|
| `weighted_promo_percent` | **`0`** (keep) | A week with no promo row means **no promo applied** that week. `0%` is the true per-week value. The bin-level `AVG` then weights real promo by its actual coverage. |
| `promo_source` | **`NULL`** | Absence is not the same as "CY Promo (0)". Leave missing weeks out of the `MIN` so the bin's real source survives. |
| `effective_reference_price` | **`NULL`** | A non-existent reference price is not `$0`. Leave it out of the `AVG` so the reference reflects only real promo weeks. |

**At the overall (bin) grain:**

- `MIN(promo_source)` over the real values is correct. When real weeks legitimately mix `0` and `1` (some CY, some LY), `MIN = 0` is the intended outcome.
- `AVG(weighted_promo_percent)` covers all weeks (real + missing-as-0), giving the true coverage-weighted bin promo.
- `AVG(effective_reference_price)` covers only the real weeks (NULLs ignored).

**Bins with zero promo coverage at all** end up with `AVG(promo_pct) = 0`, `MIN(source) = NULL`, `AVG(eff_ref) = NULL`. Downstream consumers should resolve those NULLs to `0` so the override formula short-circuits to "no promo".

**Verified on Leslies test strategy 1697** (14 sim weeks, 5 promo weeks per bin, all real rows `promo_source = 1`): with the buggy fallback, `MIN(promo_source) = 0` for every bin (false CY Promo label) and `AVG(eff_ref) ≈ $95` (dragged down from real `~$268`). With the per-column fallback above, `MIN(promo_source) = 1`, `AVG(eff_ref) = $268`, override fires for `base ≤ $268`, and the downstream forecast units / revenue / GM$ / ASP / AUM align with the reco tables.

### 1.4 Open Issues: Forecast Boundary Logic

For active strategies, the forecast start point must strictly follow actual data availability. Projections must not overlap with periods where transaction data exists.

- **Requirement:** Forecast must start at `max_actuals_date + 1`.
- **Scenario Example:** For a strategy running 1-Apr → 30-Jul with today being 25-May and max transactions at 23-May:
  - **Correct Split:** 1-Apr → 23-May (Actuals) | 24-May → 30-Jul (Forecast).
  - **Current Split:** 1-Apr → 30-Jul all forecast, plus 23-May actuals → overlap

---

## 2. Monthly Forecast / Actuals Validators: Identified Issues & Requirements

### 2.1 Aggregation Logic for Stored Rate Columns

Rate columns (`asp`, `aum`, `gross_margin_percentage`, plus IA/Finalized variants on the forecast table) exist on both `bp_monthly_forecast` and `bp_monthly_forecast_actuals`. What needs verifying is **how they're populated upstream** — the two-stage rollup must be units-weighted:

- **Stage 1 (Granular):** `asp = rev/units`, `aum = gm$/units`, `gm% = gm$/rev × 100`.
- **Stage 2 (Rollup to bin grain):** `SUM(rate × units) / SUM(units)`.

If the upstream is using a simple `AVG` or a plain aggregate ratio at the bin level, the stored rate will diverge from what `monthly_summary_cards_validator` computes (the validator weights the stored rates by `sales_units`). Spot-checking strategy 1261 showed a ~$11 / ~40% divergence between weighted-avg ASP (using stored `asp`) and the aggregate-ratio ASP (`SUM(rev)/SUM(units)`) — that divergence is the validator flagging a real upstream issue.

### 2.2 Forecast Boundary Logic

- **Forecast Start Date Bug:** This is the same forecast-start-date issue as reco. **Required Fix:** Use `max_actuals_date + 1` whenever the projection range starts before that date. This issue hits any strategy with a fiscal forecast config that reaches back into the past.

### 2.3 Promotional Metrics Verification

- **Promo Application Verification:** Promo on monthly metrics looks like it's not being applied. Needs verification. Trace one (bin, month) row end-to-end through `bp_simulation_promo_{month,week}` to confirm if the stored `revenue` uses `promo_price` or `base_price`. If `base_price`, it's the same class of bug as the reco-side promo bug.

### 2.4 Data Classification (PARTIAL vs FULL) Verification

- **Coverage Logic Audit:** The current PARTIAL vs FULL classification, which classifies each month into a coverage bucket relative to `max_actuals_date`, needs verification. This source-of-truth logic needs to be verified with Vishnu before validator output is trusted.

#### 2.4.1 Forecast Side (Validation Range)

Per month within `validation_range`:

| Condition | Type | Source |
|---|---|---|
| `end_date <= max_actuals_date` | ACTUALS | skipped (actuals validator owns these) |
| `start_date > max_actuals_date` | FULL_FORECAST | monthly sim tables |
| spans the cutoff | PARTIAL_FORECAST | weekly sim tables |

**For PARTIAL_FORECAST:**

- `forecast_start_date = max_actuals_date + 1 day`.
- Weekly tables filtered to `week_start_date >= max_actuals_date - 6 days AND <= forecast_end_date` (catches the boundary week that contains the cutoff).
- `day_split` filtered at day level: `d.date > max_actuals_date AND d.date <= fiscal_month_end`. The boundary week's `week_split_ratio` then sums only the forecast days; later fully-forecast weeks sum to 1.0.

#### 2.4.2 Actuals Side (Strategy Fiscal Year)

Per fiscal month in the strategy's fiscal year:

| Condition | Coverage | Source |
|---|---|---|
| `fiscal_ld_month <= max_actuals_date` | FULL_MONTH | `bp_transaction_data_monthly` |
| `fiscal_fd_month <= max_actuals_date < fiscal_ld_month` | PARTIAL | `bp_transaction_data_daily` capped at `max_actuals_date` |
| `fiscal_fd_month > max_actuals_date` | NO_DATA | skipped (no actuals yet) |

**For PARTIAL Coverage:**

- Daily sum runs `transaction_date BETWEEN fiscal_fd_month AND max_actuals_date`, inclusive on both ends.
- FULL_MONTH rows come pre-aggregated from `bp_transaction_data_monthly`; PARTIAL rows are summed from `bp_transaction_data_daily`. Both feed the same two-stage rollup (p/s/seg → bin with sales-units-weighted rates).
- The `coverage_match` column flags rows where stored `coverage` and calculated `calc_coverage` disagree on FULL_MONTH vs PARTIAL.

---

## 3. Summary Card Calculation (Tool) — Weighted Average Bug

- **Aggregate Ratio vs Weighted Average:** The Summary Cards  on the tool computes ASP, AUM and GM% at the strategy level as simple aggregate ratios (e.g. `total_revenue / total_sales_units`), not as sales-units-weighted averages of the per-bin stored rates. The two methods only agree when the stored bin-level rate columns are perfectly consistent with the underlying revenue / GM$ / units per row — any precision drift or rounding makes them diverge.

- **Required Fix:** Compute weighted averages from the stored bin-level rates:

  ```sql
  asp = SUM(asp * sales_units)                / SUM(sales_units)
  aum = SUM(aum * sales_units)                / SUM(sales_units)
  gm% = SUM(gross_margin_percentage * sales_units) / SUM(sales_units)
  ```

  This matches what `summary_cards_validator` already recomputes, so once the tool is fixed the validator should report all `MATCH`.

- **Buggy snippet (current behavior):**

  ```sql
  'asp', round(total_revenue / total_sales_units, 2)
  'aum', round(total_gross_margin_dollar / total_sales_units, 2)
  'gm_percentage', round((total_gross_margin_dollar / total_revenue) * 100, 2)
  ```

---

## 4. Tool's "vs Current" Delta for GM% — Formula Mismatch

- **Bug (tool side):** On the Projection screen's Summary Cards, the IA-vs-Current and Finalized-vs-Current deltas for GM% are displayed as an **absolute percentage-point difference**, while a percentage metric should be reported as a **relative percent change**. The other 5 metrics (Sales, Revenue, GM$, ASP, AUM) are absolute differences and that's correct for them — only GM% needs to be relative.

  Example (from the Projection screen): Current GM% = 45.06%, Finalized GM% = 39.88%.
  - Tool currently shows: `↓ 5.18%` — this is `45.06 − 39.88 = 5.18` (absolute pp diff). Wrong.
  - Correct value: `((39.88 − 45.06) / 45.06) × 100 = −11.50%` — relative percent change. The validator already returns this.

- **vs Current formula per metric:**

  | Metric             | Tool's current calc (incorrect for GM%)              | Correct calc                                          | Display |
  |--------------------|------------------------------------------------------|-------------------------------------------------------|---------|
  | Sales Units        | `new_sales − cur_sales`                              | same — already correct                                | units   |
  | Revenue            | `new_rev − cur_rev`                                  | same — already correct                                | `$`     |
  | Gross Margin $     | `new_gm$ − cur_gm$`                                  | same — already correct                                | `$`     |
  | **Gross Margin %** | **`new_gm% − cur_gm%`** (absolute pp diff) — wrong   | **`((new_gm% − cur_gm%) / cur_gm%) × 100`** — relative percent change | `%`     |
  | ASP                | `new_asp − cur_asp`                                  | same — already correct                                | `$`     |
  | AUM                | `new_aum − cur_aum`                                  | same — already correct                                | `$`     |

  Five of the six are absolute diffs and stay that way. **GM% is the only one that should be relative percent change** — that's the tool fix. Rates (`ASP`, `AUM`, `GM%`) are computed off sales-units-weighted totals per §3 before the delta is taken.

- **Validator status:** `summary_cards_validator` already computes GM% as relative percent change, so once the tool adopts the same formula the validator and the UI will agree. Relevant SQL:

  ```sql
  CASE WHEN c.total_sales_units > 0 AND c.total_gm_pct_weighted > 0 THEN
      ROUND((((i.total_gm_pct_weighted / i.total_sales_units) -
              (c.total_gm_pct_weighted / c.total_sales_units)) /
              (c.total_gm_pct_weighted / c.total_sales_units) * 100)::numeric, 2)
  ELSE 0 END AS ia_vs_current_gm_pct
  ```

---

## 5. Monthly Summary Cards — Tool's Forecast Query vs. `monthly_summary_cards_validator`

This is the calculation-only diff between the tool's monthly forecast Summary query and our validator. Only the metric formulas — period resolution, filters, deltas, etc. live elsewhere in this doc.

### 5.1 Forecast portion — ASP / AUM / GM%

| Metric | Tool | Validator |
|---|---|---|
| ASP | `SUM(revenue) / SUM(sales_units)` — aggregate ratio | `SUM(asp × sales_units) / SUM(sales_units)` — units-weighted avg of stored bin rates |
| AUM | `SUM(gm$) / SUM(sales_units)` | `SUM(aum × sales_units) / SUM(sales_units)` |
| GM% | `SUM(gm$) / SUM(revenue) × 100` | `SUM(gross_margin_percentage × sales_units) / SUM(sales_units)` |

SU / Rev / GM$ themselves are identical in both (plain `SUM(...)`).

### 5.2 Actuals portion — identical in both

```
ASP  = SUM(actuals_asp × actuals_sales_units) / SUM(actuals_sales_units)
AUM  = SUM(actuals_aum × actuals_sales_units) / SUM(actuals_sales_units)
GM%  = SUM(actuals_gm_pct × actuals_sales_units) / SUM(actuals_sales_units)
```

### 5.3 Total portion (= forecast + actuals) — ASP / AUM / GM%

| Metric | Tool | Validator |
|---|---|---|
| ASP | `cur_total_rev / cur_total_su` — aggregate ratio over combined sums | `(forecast_asp_w + actuals_asp_w) / (forecast_su + actuals_su)` — weighted sums combined, then divided by combined units |
| AUM | `cur_total_gm / cur_total_su` | `(forecast_aum_w + actuals_aum_w) / (forecast_su + actuals_su)` |
| GM% | `(cur_total_gm / cur_total_rev) × 100` | `(forecast_gm_pct_w + actuals_gm_pct_w) / (forecast_su + actuals_su)` |

---

## 6. Open for Discussion — GM% Rollup Method

**ASP and AUM are unit-rate metrics** (`rate per unit`), so weighting by `sales_units` is algebraically equivalent to the aggregate ratio of totals — both rollups give the same number. **GM% is not a unit-rate metric**, it's a `gm$ / revenue` ratio, so weighting it by `sales_units` produces a different number than the true rollup `SUM(gm$) / SUM(revenue)`. The two only coincide when GM% is roughly constant across rows.

### Worked example

Two products, one period:

| Product | Price | Units | Cost | Revenue | GM$ | ASP | AUM | GM% |
|---|---|---|---|---|---|---|---|---|
| 1 | $10 | 100 | $3 | $1000 | $700 | $10 | $7 | 70% |
| 2 | $20 | 50 | $5 | $1000 | $750 | $20 | $15 | 75% |
| **Totals** | — | **150** | — | **$2000** | **$1450** | — | — | — |

| Rollup | ASP | AUM | GM% |
|---|---|---|---|
| **Aggregate ratio of totals** | `$2000 / 150` = **$13.33** | `$1450 / 150` = **$9.67** | `$1450 / $2000 × 100` = **72.50%** |
| **Units-weighted** `SUM(rate × u) / SUM(u)` | `(10×100 + 20×50)/150` = **$13.33** ✓ | `(7×100 + 15×50)/150` = **$9.67** ✓ | `(70×100 + 75×50)/150` = **71.67%** ❌ |
| **Revenue-weighted** `SUM(rate × rev) / SUM(rev)` | n/a | n/a | `(70×1000 + 75×1000)/2000` = **72.50%** ✓ |

ASP and AUM units-weighted formulas reduce algebraically to the aggregate ratio — same number. GM% units-weighted diverges (71.67% vs the correct 72.50%) because weighting a `$/$` ratio by units doesn't undo the per-row division.

### Options for the correct GM% rollup

1. **Compute from sums**: `SUM(gm$) / SUM(revenue) × 100` — always correct, no per-row rate needed.
2. **Weight by revenue**: `SUM(gm_percentage × revenue) / SUM(revenue)` — algebraically same as #1 when stored values are consistent.

Both summary card validators today use the units-weighted formula for GM%, which is the same shape as ASP/AUM but mathematically wrong for a non-unit-rate metric. The two listed options are equivalent under consistent data; we should pick one and apply it to GM% (and only GM%) in both validators. ASP and AUM stay units-weighted as they are now.
