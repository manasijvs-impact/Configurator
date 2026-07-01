-- ============================================
-- VALIDATION PRE-FLIGHT for Strategy 215
-- Run these BEFORE the big validation queries to confirm the plan inputs.
-- All read-only.
-- ============================================

-- 1) Strategy basics
SELECT strategy_id, strategy_name, start_date, end_date, strategy_status_id
FROM base_pricing.bp_strategy_master
WHERE strategy_id = 215;

-- 2) Global actuals cutoff (drives ACTUALS vs FORECAST split)
SELECT MAX(transaction_date) AS max_actuals_date
FROM base_pricing.bp_transaction_data_daily;

-- 3) Today's fiscal year (drives FISCAL_YEAR / FISCAL_YEAR_Qx resolution)
SELECT fiscal_year, fiscal_quarter, fiscal_month,
       fiscal_fd_year, fiscal_ld_year,
       fiscal_fd_qtr,  fiscal_ld_qtr,
       fiscal_fd_month, fiscal_ld_month, month_name
FROM global.tb_fiscal_date_mapping
WHERE date_id = CURRENT_DATE
LIMIT 1;

-- 4) Active forecast configs (range comes from these — MIN start, MAX end)
SELECT forecast_type, label, projection_mode,
       start_reference, end_reference,
       cumulative_quarters, is_active, default_selected,
       display_order, disable_selection
FROM base_pricing.bp_forecast_cal_config
WHERE is_active = true
ORDER BY display_order;

-- 5) Resolved date range for each active config (preview)
--    Returns one row per active config showing what dates each forecast_type resolves to.
WITH sp AS (
    SELECT start_date, end_date FROM base_pricing.bp_strategy_master WHERE strategy_id = 215
),
-- Active FY rule:
--   single-FY strategy  -> strategy's FY
--   multi-FY strategy   -> today's FY
ssf AS (
    SELECT fdm.fiscal_year, fdm.fiscal_fd_year, fdm.fiscal_ld_year
    FROM global.tb_fiscal_date_mapping fdm CROSS JOIN sp
    WHERE fdm.date_id = sp.start_date LIMIT 1
),
sef AS (
    SELECT fdm.fiscal_year, fdm.fiscal_fd_year, fdm.fiscal_ld_year
    FROM global.tb_fiscal_date_mapping fdm CROSS JOIN sp
    WHERE fdm.date_id = sp.end_date LIMIT 1
),
cdf AS (
    SELECT fdm.fiscal_year, fdm.fiscal_fd_year, fdm.fiscal_ld_year
    FROM global.tb_fiscal_date_mapping fdm
    WHERE fdm.date_id = CURRENT_DATE LIMIT 1
),
fi AS (
    SELECT
        CASE WHEN ssf.fiscal_year = sef.fiscal_year THEN ssf.fiscal_year    ELSE cdf.fiscal_year    END AS fiscal_year,
        CASE WHEN ssf.fiscal_year = sef.fiscal_year THEN ssf.fiscal_fd_year ELSE cdf.fiscal_fd_year END AS fiscal_fd_year,
        CASE WHEN ssf.fiscal_year = sef.fiscal_year THEN ssf.fiscal_ld_year ELSE cdf.fiscal_ld_year END AS fiscal_ld_year
    FROM ssf CROSS JOIN sef CROSS JOIN cdf
),
qd AS (
    SELECT fdm.fiscal_quarter,
           MIN(fdm.fiscal_fd_qtr) AS quarter_start,
           MAX(fdm.fiscal_ld_qtr) AS quarter_end
    FROM global.tb_fiscal_date_mapping fdm
    CROSS JOIN fi
    WHERE fdm.fiscal_year = fi.fiscal_year
    GROUP BY fdm.fiscal_quarter
)
-- Quarter bounds use cumulative_quarters (works for both discrete & cumulative modes):
--   discrete   cumulative_quarters = {Q}      -> MIN/MAX = Q's start/end
--   cumulative cumulative_quarters = {Q1..Qn} -> MIN = Q1.start, MAX = Qn.end
SELECT
    fc.forecast_type,
    fc.projection_mode,
    fc.cumulative_quarters,
    fc.start_reference,
    fc.end_reference,
    CASE fc.start_reference
        WHEN 'fiscal_year_start'   THEN fi.fiscal_fd_year
        WHEN 'strategy_start_date' THEN sp.start_date
        WHEN 'quarter_start'       THEN (
            SELECT MIN(quarter_start) FROM qd
            WHERE fiscal_quarter = ANY(fc.cumulative_quarters)
        )
        ELSE fi.fiscal_fd_year
    END AS resolved_start,
    CASE fc.end_reference
        WHEN 'fiscal_year_end' THEN fi.fiscal_ld_year
        WHEN 'twelve_months'   THEN (
            SELECT fiscal_ld_month
            FROM global.tb_fiscal_date_mapping
            WHERE date_id = (sp.start_date + INTERVAL '12 months')::date LIMIT 1
        )
        WHEN 'quarter_end' THEN (
            SELECT MAX(quarter_end) FROM qd
            WHERE fiscal_quarter = ANY(fc.cumulative_quarters)
        )
        ELSE fi.fiscal_ld_year
    END AS resolved_end
FROM base_pricing.bp_forecast_cal_config fc
CROSS JOIN fi
CROSS JOIN sp
WHERE fc.is_active = true
  AND fc.forecast_type != 'CURRENT_STRATEGY_PERIOD';

-- 6) Expected months for validation (derived from fiscal calendar, NOT from bp_monthly_forecast)
--    We compute the month list ourselves so a month missing from bp_monthly_forecast still surfaces
--    here (with rows_in_stored = 0) instead of being silently ignored.
WITH sp AS (
    SELECT start_date, end_date FROM base_pricing.bp_strategy_master WHERE strategy_id = 215
),
ma AS (
    SELECT COALESCE(MAX(transaction_date), '1900-01-01'::date) AS max_actuals_date
    FROM base_pricing.bp_transaction_data_daily
),
-- Single-FY vs multi-FY rule (same as step 5)
ssf AS (
    SELECT fdm.fiscal_year, fdm.fiscal_fd_year, fdm.fiscal_ld_year
    FROM global.tb_fiscal_date_mapping fdm CROSS JOIN sp
    WHERE fdm.date_id = sp.start_date LIMIT 1
),
sef AS (
    SELECT fdm.fiscal_year, fdm.fiscal_fd_year, fdm.fiscal_ld_year
    FROM global.tb_fiscal_date_mapping fdm CROSS JOIN sp
    WHERE fdm.date_id = sp.end_date LIMIT 1
),
cdf AS (
    SELECT fdm.fiscal_year, fdm.fiscal_fd_year, fdm.fiscal_ld_year
    FROM global.tb_fiscal_date_mapping fdm
    WHERE fdm.date_id = CURRENT_DATE LIMIT 1
),
fi AS (
    SELECT
        CASE WHEN ssf.fiscal_year = sef.fiscal_year THEN ssf.fiscal_year    ELSE cdf.fiscal_year    END AS fiscal_year,
        CASE WHEN ssf.fiscal_year = sef.fiscal_year THEN ssf.fiscal_fd_year ELSE cdf.fiscal_fd_year END AS fiscal_fd_year,
        CASE WHEN ssf.fiscal_year = sef.fiscal_year THEN ssf.fiscal_ld_year ELSE cdf.fiscal_ld_year END AS fiscal_ld_year
    FROM ssf CROSS JOIN sef CROSS JOIN cdf
),
qd AS (
    SELECT fdm.fiscal_quarter,
           MIN(fdm.fiscal_fd_qtr) AS quarter_start,
           MAX(fdm.fiscal_ld_qtr) AS quarter_end
    FROM global.tb_fiscal_date_mapping fdm
    CROSS JOIN fi
    WHERE fdm.fiscal_year = fi.fiscal_year
    GROUP BY fdm.fiscal_quarter
),
-- Resolve each active config's date range.
-- Quarter bounds use cumulative_quarters (works for both discrete & cumulative modes).
configs AS (
    SELECT
        fc.forecast_type,
        CASE fc.start_reference
            WHEN 'fiscal_year_start'   THEN fi.fiscal_fd_year
            WHEN 'strategy_start_date' THEN sp.start_date
            WHEN 'quarter_start'       THEN (
                SELECT MIN(quarter_start) FROM qd
                WHERE fiscal_quarter = ANY(fc.cumulative_quarters)
            )
            ELSE fi.fiscal_fd_year
        END AS resolved_start,
        CASE fc.end_reference
            WHEN 'fiscal_year_end' THEN fi.fiscal_ld_year
            WHEN 'twelve_months'   THEN (
                SELECT fiscal_ld_month FROM global.tb_fiscal_date_mapping
                WHERE date_id = (sp.start_date + INTERVAL '12 months')::date LIMIT 1
            )
            WHEN 'quarter_end' THEN (
                SELECT MAX(quarter_end) FROM qd
                WHERE fiscal_quarter = ANY(fc.cumulative_quarters)
            )
            ELSE fi.fiscal_ld_year
        END AS resolved_end
    FROM base_pricing.bp_forecast_cal_config fc
    CROSS JOIN fi CROSS JOIN sp
    WHERE fc.is_active = true AND fc.forecast_type != 'CURRENT_STRATEGY_PERIOD'
),
-- Union of all active config ranges (MIN start, MAX end). Fallback to strategy dates.
validation_range AS (
    SELECT
        COALESCE(MIN(resolved_start), (SELECT start_date FROM sp)) AS range_start,
        COALESCE(MAX(resolved_end),   (SELECT end_date   FROM sp)) AS range_end
    FROM configs WHERE resolved_start IS NOT NULL AND resolved_end IS NOT NULL
),
-- ★ The key change: expected months come from the fiscal calendar inside validation_range
expected_months AS (
    SELECT DISTINCT
        fdm.fiscal_year,
        fdm.fiscal_month,
        fdm.month_name AS fiscal_month_name,
        fdm.fiscal_fd_month AS month_start,
        fdm.fiscal_ld_month AS month_end
    FROM global.tb_fiscal_date_mapping fdm
    CROSS JOIN validation_range vr
    WHERE fdm.fiscal_fd_month >= vr.range_start
      AND fdm.fiscal_ld_month <= vr.range_end
)
SELECT
    em.fiscal_year,
    em.fiscal_month,
    em.fiscal_month_name,
    em.month_start,
    em.month_end,
    ma.max_actuals_date,
    CASE
        WHEN em.month_end   <= ma.max_actuals_date THEN 'ACTUALS'           -- handled by actuals validator
        WHEN em.month_start >  ma.max_actuals_date THEN 'FULL_FORECAST'     -- monthly sim tables
        ELSE 'PARTIAL_FORECAST'                                             -- weekly sim tables, -6d window
    END AS validation_type,
    CASE
        WHEN em.month_start <= ma.max_actuals_date AND em.month_end > ma.max_actuals_date
        THEN (ma.max_actuals_date + INTERVAL '1 day')::date
        ELSE em.month_start
    END AS forecast_start_date,
    -- Cross-check: how many rows does bp_monthly_forecast actually have for this month?
    -- 0 means the month is expected but missing from stored data.
    (SELECT COUNT(*) FROM base_pricing.bp_monthly_forecast mf
     WHERE mf.strategy_id  = 215
       AND mf.fiscal_year  = em.fiscal_year
       AND mf.fiscal_month = em.fiscal_month) AS rows_in_stored
FROM expected_months em
CROSS JOIN ma
ORDER BY em.fiscal_year, em.fiscal_month;

-- 7) Sanity check: how many stored rows on each side?
WITH sp AS (
    SELECT start_date, end_date FROM base_pricing.bp_strategy_master WHERE strategy_id = 215
),
ma AS (
    SELECT COALESCE(MAX(transaction_date), '1900-01-01'::date) AS max_actuals_date
    FROM base_pricing.bp_transaction_data_daily
)
SELECT
    'bp_monthly_forecast (FORECAST side)'      AS table_label,
    COUNT(*) FILTER (WHERE mf.start_date > ma.max_actuals_date)                                   AS full_forecast_rows,
    COUNT(*) FILTER (WHERE mf.start_date <= ma.max_actuals_date AND mf.end_date > ma.max_actuals_date) AS partial_forecast_rows,
    COUNT(*) FILTER (WHERE mf.end_date   <= ma.max_actuals_date)                                  AS skipped_actuals_rows,
    COUNT(*) AS total_rows
FROM base_pricing.bp_monthly_forecast mf
CROSS JOIN ma
WHERE mf.strategy_id = 215

UNION ALL

SELECT
    'bp_monthly_forecast_actuals (ACTUALS side)' AS table_label,
    NULL, NULL, NULL,
    COUNT(*) AS total_rows
FROM base_pricing.bp_monthly_forecast_actuals
WHERE strategy_id = 215;
