
-- ============================================
-- MONTHLY FORECAST VALIDATION (ELASTICITY-BASED)
-- Strategy ID: 215
-- Schema: base_pricing
-- Range comes from bp_forecast_cal_config (MIN start / MAX end across active configs).
-- Each month is categorized by max_actuals_date:
--   ACTUALS:          end_date   <= max_actuals_date  -> skipped (actuals validator handles)
--   FULL_FORECAST:    start_date >  max_actuals_date  -> bp_simulation_month tables
--   PARTIAL_FORECAST: month spans the cutoff          -> bp_simulation_week tables,
--                     week_start_date >= max_actuals_date - 6 days (boundary week),
--                     day_split filtered to d.date > max_actuals_date AND d.date <= mi.end_date
-- Fallback: no active configs -> range = strategy dates; NULL max_actuals -> all FULL_FORECAST.
-- Dynamic hierarchy columns: l0_cid, l1_cid, l2_cid, l3_cid
-- ============================================

WITH strategy_params AS (
    SELECT 
        strategy_id,
        start_date,
        end_date
    FROM base_pricing.bp_strategy_master
    WHERE strategy_id = 215
),

strategy_products AS (
    SELECT DISTINCT product_id, store_id, segment_id
    FROM base_pricing.bp_strategy_products_stores
    WHERE strategy_id = 215
),

strategy_products_with_kvi AS (
    SELECT 
        sp.product_id,
        sp.store_id,
        sp.segment_id,
        v.attribute_9::boolean AS is_kvi
    FROM strategy_products sp
    INNER JOIN base_pricing.bp_product_store_attributes_mapping_v4 v
        ON sp.product_id = v.product_id
        AND sp.store_id = v.store_id
        AND sp.segment_id = v.segment_id
),

strategy_pcs AS (
    SELECT DISTINCT
        spk.product_id,
        pm.l0_cid, pm.l1_cid, pm.l2_cid, pm.l3_cid,
        sm.s0_cid AS channel_id,
        spk.segment_id,
        spk.is_kvi
    FROM strategy_products_with_kvi spk
    INNER JOIN base_pricing.bp_product_master pm ON spk.product_id = pm.product_id
    INNER JOIN base_pricing.bp_store_master sm ON spk.store_id = sm.store_id
),

strategy_products_with_hierarchy AS (
    SELECT DISTINCT
        spk.product_id, spk.store_id, spk.segment_id, spk.is_kvi,
        pm.l0_cid, pm.l1_cid, pm.l2_cid, pm.l3_cid
    FROM strategy_products_with_kvi spk
    INNER JOIN base_pricing.bp_product_master pm ON spk.product_id = pm.product_id
),

bins_mapping AS (
    SELECT
        v.product_id, v.store_id, v.segment_id,
        v.effective_price_zone,
        v.attribute_9::boolean AS is_kvi,
        v.attribute_6::boolean AS price_lock_val,
        v.attribute_7::boolean AS zone_exception_val,
        v.product_id::text || '_' ||
        CASE WHEN v.attribute_6::boolean OR v.attribute_7::boolean OR v.effective_price_zone IS NULL
            THEN v.store_id::text || '_' || v.segment_id::text
            ELSE v.effective_price_zone || '_' || v.segment_id::text
        END AS opt_level_bins,
        -- Display label: store-scoped (Store: <store_code>) when zone_exception is true
        -- or no zone defined, else the actual zone code. Matches reco_metrics_validator.
        CASE WHEN v.attribute_7::boolean OR v.effective_price_zone IS NULL
            THEN 'Store: ' || sm.store_code
            ELSE v.effective_price_zone
        END AS price_zone_display
    FROM base_pricing.bp_product_store_attributes_mapping_v4 v
    INNER JOIN strategy_products sp
        ON v.product_id = sp.product_id
        AND v.store_id = sp.store_id
        AND v.segment_id = sp.segment_id
    INNER JOIN base_pricing.bp_store_master sm
        ON v.store_id = sm.store_id
),

our_bins AS (
    SELECT DISTINCT opt_level_bins, product_id FROM bins_mapping
),

-- Bin-level identity columns (product_code, channel_name, segment_name, etc).
-- Joined onto expected_grid in the final SELECT so output stays populated
-- even when the stored row is MISSING_STORED. Mirrors reco_metrics_validator.
bin_identity AS (
    SELECT DISTINCT ON (bm.opt_level_bins, bm.product_id)
        bm.opt_level_bins,
        bm.product_id,
        pm.product_code,
        sm.s0_name AS channel_name,
        bm.price_zone_display,
        COALESCE(csm.segment_name, 'Segment ' || bm.segment_id::text) AS segment_name,
        bm.price_lock_val,
        bm.zone_exception_val
    FROM bins_mapping bm
    INNER JOIN base_pricing.bp_product_master pm ON bm.product_id = pm.product_id
    INNER JOIN base_pricing.bp_store_master sm   ON bm.store_id   = sm.store_id
    LEFT JOIN base_pricing.bp_customer_segment_master csm ON bm.segment_id = csm.segment_id
    ORDER BY bm.opt_level_bins, bm.product_id
),

store_channel AS (
    SELECT 
        bm.product_id, bm.store_id, bm.segment_id, bm.opt_level_bins, bm.is_kvi,
        sm.s0_cid AS channel_id
    FROM bins_mapping bm
    INNER JOIN base_pricing.bp_store_master sm ON bm.store_id = sm.store_id
),

-- RECO TABLES (prices)
reco_current AS (
    SELECT r.product_id, r.store_id, r.segment_id, r.channel_id,
           r.opt_level_bins, r.base_price, r.cost
    FROM base_pricing.bp_price_reco_current_v2 r
    INNER JOIN our_bins ob ON r.opt_level_bins = ob.opt_level_bins AND r.product_id = ob.product_id
    WHERE r.strategy_id = 215
),

reco_ia AS (
    SELECT r.product_id, r.store_id, r.segment_id, r.channel_id,
           r.opt_level_bins, r.base_price AS base_price_ia, r.cost AS cost_ia
    FROM base_pricing.bp_price_reco_ia_v2 r
    INNER JOIN our_bins ob ON r.opt_level_bins = ob.opt_level_bins AND r.product_id = ob.product_id
    WHERE r.strategy_id = 215
),

reco_finalized AS (
    SELECT r.product_id, r.store_id, r.segment_id, r.channel_id,
           r.opt_level_bins, r.base_price AS base_price_finalized, r.cost AS cost_finalized
    FROM base_pricing.bp_price_reco_finalized_v2 r
    INNER JOIN our_bins ob ON r.opt_level_bins = ob.opt_level_bins AND r.product_id = ob.product_id
    WHERE r.strategy_id = 215
),

reco_all AS (
    SELECT 
        COALESCE(rc.opt_level_bins, ri.opt_level_bins, rf.opt_level_bins) AS opt_level_bins,
        COALESCE(rc.product_id, ri.product_id, rf.product_id) AS product_id,
        COALESCE(rc.store_id, ri.store_id, rf.store_id) AS store_id,
        COALESCE(rc.segment_id, ri.segment_id, rf.segment_id) AS segment_id,
        COALESCE(rc.channel_id, ri.channel_id, rf.channel_id) AS channel_id,
        rc.base_price AS base_price_current, 
        COALESCE(rc.cost, ri.cost_ia, rf.cost_finalized) AS cost,
        ri.base_price_ia, 
        rf.base_price_finalized
    FROM reco_current rc
    FULL OUTER JOIN reco_ia ri ON rc.opt_level_bins = ri.opt_level_bins AND rc.product_id = ri.product_id
    FULL OUTER JOIN reco_finalized rf 
        ON COALESCE(rc.opt_level_bins, ri.opt_level_bins) = rf.opt_level_bins 
        AND COALESCE(rc.product_id, ri.product_id) = rf.product_id
),

-- Pick the "active" FY for FISCAL_YEAR / FISCAL_YEAR_Qx resolution.
-- Rule:
--   - Strategy in a single FY (FY(start) == FY(end))  -> use strategy's FY
--   - Strategy crosses an FY boundary                 -> use today's FY
-- CALENDAR_YEAR (12 Months) does NOT use fiscal_info -- it anchors on strategy_start_date.
strategy_start_fy AS (
    SELECT fdm.fiscal_year, fdm.fiscal_fd_year, fdm.fiscal_ld_year
    FROM global.tb_fiscal_date_mapping fdm
    CROSS JOIN strategy_params sp
    WHERE fdm.date_id = sp.start_date
    LIMIT 1
),
strategy_end_fy AS (
    SELECT fdm.fiscal_year, fdm.fiscal_fd_year, fdm.fiscal_ld_year
    FROM global.tb_fiscal_date_mapping fdm
    CROSS JOIN strategy_params sp
    WHERE fdm.date_id = sp.end_date
    LIMIT 1
),
current_date_fy AS (
    SELECT fdm.fiscal_year, fdm.fiscal_fd_year, fdm.fiscal_ld_year
    FROM global.tb_fiscal_date_mapping fdm
    WHERE fdm.date_id = CURRENT_DATE
    LIMIT 1
),
fiscal_info AS (
    SELECT
        CASE WHEN ssf.fiscal_year = sef.fiscal_year
             THEN ssf.fiscal_year    ELSE cdf.fiscal_year    END AS fiscal_year,
        CASE WHEN ssf.fiscal_year = sef.fiscal_year
             THEN ssf.fiscal_fd_year ELSE cdf.fiscal_fd_year END AS fiscal_fd_year,
        CASE WHEN ssf.fiscal_year = sef.fiscal_year
             THEN ssf.fiscal_ld_year ELSE cdf.fiscal_ld_year END AS fiscal_ld_year
    FROM strategy_start_fy ssf
    CROSS JOIN strategy_end_fy sef
    CROSS JOIN current_date_fy cdf
),

-- Quarter boundaries for the strategy's fiscal year
quarter_dates AS (
    SELECT
        fdm.fiscal_quarter,
        MIN(fdm.fiscal_fd_qtr) AS quarter_start,
        MAX(fdm.fiscal_ld_qtr) AS quarter_end
    FROM global.tb_fiscal_date_mapping fdm
    CROSS JOIN fiscal_info fi
    WHERE fdm.fiscal_year = fi.fiscal_year
    GROUP BY fdm.fiscal_quarter
),

-- Active forecast configs with resolved start/end dates
forecast_configs_resolved AS (
    SELECT
        fc.forecast_type,
        fc.start_reference,
        fc.end_reference,
        -- Quarter bounds use cumulative_quarters (works for both discrete and cumulative modes):
        --   discrete   cumulative_quarters = {Q}      -> MIN/MAX both = Q's start/end
        --   cumulative cumulative_quarters = {Q1..Qn} -> MIN = Q1.start, MAX = Qn.end
        CASE fc.start_reference
            WHEN 'fiscal_year_start'   THEN fi.fiscal_fd_year
            WHEN 'strategy_start_date' THEN sp.start_date
            WHEN 'quarter_start' THEN (
                SELECT MIN(qd.quarter_start) FROM quarter_dates qd
                WHERE qd.fiscal_quarter = ANY(fc.cumulative_quarters)
            )
            ELSE fi.fiscal_fd_year
        END AS resolved_start,
        CASE fc.end_reference
            WHEN 'fiscal_year_end' THEN fi.fiscal_ld_year
            -- 12 Months: fiscal_ld_month of (strategy_start + 12 months) -- aligns to fiscal calendar
            WHEN 'twelve_months' THEN (
                SELECT fdm2.fiscal_ld_month
                FROM global.tb_fiscal_date_mapping fdm2
                WHERE fdm2.date_id = (sp.start_date + INTERVAL '12 months')::date
                LIMIT 1
            )
            WHEN 'quarter_end' THEN (
                SELECT MAX(qd.quarter_end) FROM quarter_dates qd
                WHERE qd.fiscal_quarter = ANY(fc.cumulative_quarters)
            )
            ELSE fi.fiscal_ld_year
        END AS resolved_end
    FROM base_pricing.bp_forecast_cal_config fc
    CROSS JOIN fiscal_info fi
    CROSS JOIN strategy_params sp
    WHERE fc.is_active = true
      AND fc.forecast_type != 'CURRENT_STRATEGY_PERIOD'
),

-- Visibility floor: pulled from the FISCAL_YEAR config's resolved_start.
--   FY config = fiscal_year_start  -> floor = active FY start  (validate all FY months)
--   FY config = strategy_start_date -> floor = strategy_start  (skip pre-strategy months)
-- Same rule used by monthly_summary_cards_validator so the three validators stay in sync.
visibility_floor AS (
    SELECT COALESCE(
        (SELECT resolved_start FROM forecast_configs_resolved
         WHERE forecast_type = 'FISCAL_YEAR' LIMIT 1),
        (SELECT fi.fiscal_fd_year FROM fiscal_info fi)
    ) AS floor_date
),

-- Drop active configs whose entire range ends before the floor (e.g., FISCAL_YEAR_Q1/Q2
-- when FY anchors to strategy_start_date and strategy starts in Q3).
forecast_configs_visible AS (
    SELECT fcr.*
    FROM forecast_configs_resolved fcr
    CROSS JOIN visibility_floor vf
    WHERE fcr.resolved_start IS NOT NULL
      AND fcr.resolved_end   IS NOT NULL
      AND fcr.resolved_end  >= vf.floor_date
),

-- Validation range: floor on the left, MAX(visible) on the right.
-- Even when a visible config (e.g. Q3) starts before the floor, we clip to the floor —
-- so the pre-strategy portion of an overlapping quarter is excluded, not validated.
validation_range AS (
    SELECT
        COALESCE((SELECT floor_date FROM visibility_floor),
                 (SELECT start_date FROM strategy_params)) AS range_start,
        COALESCE(MAX(resolved_end), (SELECT end_date FROM strategy_params)) AS range_end
    FROM forecast_configs_visible
),

-- Max date with transaction data (actuals cutoff). NULL -> 1900-01-01 so all months become FULL_FORECAST.
max_actuals AS (
    SELECT COALESCE(MAX(transaction_date), '1900-01-01'::date) AS max_actuals_date
    FROM base_pricing.bp_transaction_data_daily
),

-- ============================================================================
-- EXPECTED MONTHS -- derived from fiscal calendar, NOT from bp_monthly_forecast.
-- The validator output is driven by THIS list, so a month missing from stored
-- data shows up as MISSING_STORED rather than being silently skipped.
-- ============================================================================
expected_months AS (
    SELECT DISTINCT
        fdm.fiscal_year,
        fdm.fiscal_month,
        fdm.month_name AS fiscal_month_name,
        fdm.fiscal_fd_month AS month_start,
        fdm.fiscal_ld_month AS month_end,
        ma.max_actuals_date,
        vr.range_start AS config_range_start,
        vr.range_end   AS config_range_end,
        fdm.fiscal_year::text AS fiscal_year_label,
        CASE
            WHEN fdm.fiscal_ld_month <= ma.max_actuals_date THEN 'ACTUALS'           -- handled by actuals validator
            WHEN fdm.fiscal_fd_month >  ma.max_actuals_date THEN 'FULL_FORECAST'     -- monthly sim tables
            ELSE 'PARTIAL_FORECAST'                                                  -- weekly sim tables, -6d window
        END AS validation_type,
        CASE
            WHEN fdm.fiscal_fd_month <= ma.max_actuals_date AND fdm.fiscal_ld_month > ma.max_actuals_date
            THEN (ma.max_actuals_date + INTERVAL '1 day')::date
            ELSE fdm.fiscal_fd_month
        END AS forecast_start_date,
        fdm.fiscal_ld_month AS forecast_end_date
    FROM global.tb_fiscal_date_mapping fdm
    CROSS JOIN validation_range vr
    CROSS JOIN max_actuals ma
    WHERE fdm.fiscal_fd_month >= vr.range_start
      AND fdm.fiscal_ld_month <= vr.range_end
),

-- STORED MONTHLY FORECAST -- plain fetch only. No categorization, no range filter,
-- no COALESCE. NULLs propagate to the final SELECT, where MISSING_STORED is detected.
stored_forecast AS (
    SELECT
        mf.id,
        mf.opt_level_bins,
        mf.product_id,
        mf.segment_id,
        mf.channel_id,
        mf.price_zone,
        mf.line_group,
        mf.fiscal_year,
        mf.fiscal_month,
        mf.start_date AS stored_start_date,
        mf.end_date   AS stored_end_date,
        mf.sales_units                AS stored_curr_sales_units,
        mf.revenue                    AS stored_curr_revenue,
        mf.gross_margin_dollar        AS stored_curr_gm_dollar,
        mf.gross_margin_percentage    AS stored_curr_gm_pct,
        mf.asp                        AS stored_curr_asp,
        mf.aum                        AS stored_curr_aum,
        mf.ia_sales_units             AS stored_ia_sales_units,
        mf.ia_revenue                 AS stored_ia_revenue,
        mf.ia_gross_margin_dollar     AS stored_ia_gm_dollar,
        mf.ia_gross_margin_percentage AS stored_ia_gm_pct,
        mf.ia_asp                     AS stored_ia_asp,
        mf.ia_aum                     AS stored_ia_aum,
        mf.finalized_sales_units             AS stored_final_sales_units,
        mf.finalized_revenue                 AS stored_final_revenue,
        mf.finalized_gross_margin_dollar     AS stored_final_gm_dollar,
        mf.finalized_gross_margin_percentage AS stored_final_gm_pct,
        mf.finalized_asp                     AS stored_final_asp,
        mf.finalized_aum                     AS stored_final_aum
    FROM base_pricing.bp_monthly_forecast mf
    WHERE mf.strategy_id = 215
),

-- Distinct month metadata for sim CTEs (only FORECAST months -- ACTUALS skipped).
-- Sourced from expected_months, NOT from stored_forecast, so a stored month
-- being missing does NOT cause the sim CTEs to skip producing calc values.
month_info AS (
    SELECT DISTINCT
        em.fiscal_year, em.fiscal_month,
        em.validation_type,
        em.month_start AS start_date,
        em.month_end   AS end_date,
        em.forecast_start_date,
        em.forecast_end_date,
        em.max_actuals_date
    FROM expected_months em
    WHERE em.validation_type IN ('FULL_FORECAST', 'PARTIAL_FORECAST')
),

-- ==========================================
-- FULL MONTH PATH (using monthly tables)
-- ==========================================

-- SIMULATION MONTH DATA (for FULL_FORECAST only)
sim_month AS (
    SELECT 
        m.product_id, m.channel_id, m.segment_id,
        m.fiscal_year, m.fiscal_month,
        m.min_cost, m.base_percentage, m.sales_units AS sim_sales_units,
        m.elasticity_bp, m.promo_elasticity, 
        m.price_point,
        pcs.is_kvi,
        'FULL_FORECAST' AS source_type
    FROM strategy_pcs pcs
    INNER JOIN base_pricing.bp_simulation_month m
        ON m.product_id = pcs.product_id 
        AND m.channel_id = pcs.channel_id 
        AND m.segment_id = pcs.segment_id
    INNER JOIN month_info mi 
        ON m.fiscal_year = mi.fiscal_year 
        AND m.fiscal_month = mi.fiscal_month
        AND mi.validation_type = 'FULL_FORECAST'
),

-- PROMO MONTH (channel level, for FULL_FORECAST)
promo_month_channel AS (
    SELECT p.product_id, p.channel_id, p.segment_id, 
           p.fiscal_year, p.fiscal_month,
           p.weighted_promo_percent, p.promo_source, p.effective_reference_price
    FROM strategy_pcs pcs
    INNER JOIN base_pricing.bp_simulation_promo_month p
        ON p.product_id = pcs.product_id 
        AND p.channel_id = pcs.channel_id 
        AND p.segment_id = pcs.segment_id
    INNER JOIN month_info mi 
        ON p.fiscal_year = mi.fiscal_year 
        AND p.fiscal_month = mi.fiscal_month
        AND mi.validation_type = 'FULL_FORECAST'
),

-- STORE SPLIT KVI MONTH (for FULL_FORECAST)
store_split_kvi_month_raw AS (
    SELECT ss.product_id, ss.store_id, sph.segment_id, ss.segment_id AS data_segment_id,
           ss.fiscal_year, ss.fiscal_month, ss.store_split_ratio
    FROM strategy_products_with_hierarchy sph
    INNER JOIN base_pricing.bp_simulation_store_split_ratio_kvi_month ss
        ON ss.product_id = sph.product_id AND ss.store_id = sph.store_id
        AND ss.segment_id IN (sph.segment_id, 0)
    INNER JOIN month_info mi 
        ON ss.fiscal_year = mi.fiscal_year 
        AND ss.fiscal_month = mi.fiscal_month
        AND mi.validation_type = 'FULL_FORECAST'
    WHERE sph.is_kvi
),

store_split_kvi_month AS (
    SELECT DISTINCT ON (product_id, store_id, segment_id, fiscal_year, fiscal_month)
        product_id, store_id, segment_id, fiscal_year, fiscal_month, store_split_ratio
    FROM store_split_kvi_month_raw
    ORDER BY product_id, store_id, segment_id, fiscal_year, fiscal_month,
             CASE WHEN data_segment_id = segment_id THEN 0 ELSE 1 END
),

-- STORE SPLIT NON-KVI MONTH (for FULL_FORECAST)
store_split_non_kvi_month_raw AS (
    SELECT sph.product_id, ss.store_id, sph.segment_id, ss.segment_id AS data_segment_id,
           ss.fiscal_year, ss.fiscal_month, ss.store_split_ratio
    FROM strategy_products_with_hierarchy sph
    INNER JOIN base_pricing.bp_simulation_store_split_ratio_month ss
        ON ss.l0_cid = sph.l0_cid AND ss.l1_cid = sph.l1_cid AND ss.l2_cid = sph.l2_cid AND ss.l3_cid = sph.l3_cid
        AND ss.store_id = sph.store_id
        AND ss.segment_id IN (sph.segment_id, 0)
    INNER JOIN month_info mi 
        ON ss.fiscal_year = mi.fiscal_year 
        AND ss.fiscal_month = mi.fiscal_month
        AND mi.validation_type = 'FULL_FORECAST'
    WHERE NOT sph.is_kvi
),

store_split_non_kvi_month AS (
    SELECT DISTINCT ON (product_id, store_id, segment_id, fiscal_year, fiscal_month)
        product_id, store_id, segment_id, fiscal_year, fiscal_month, store_split_ratio
    FROM store_split_non_kvi_month_raw
    ORDER BY product_id, store_id, segment_id, fiscal_year, fiscal_month,
             CASE WHEN data_segment_id = segment_id THEN 0 ELSE 1 END
),

store_split_month AS (
    SELECT * FROM store_split_kvi_month 
    UNION ALL 
    SELECT * FROM store_split_non_kvi_month
),

-- GRANULAR DATA (FULL_FORECAST - store level with all params)
granular_data_full AS (
    SELECT 
        sc.product_id, sc.store_id, sc.segment_id, sc.channel_id, sc.opt_level_bins,
        sm.fiscal_year, sm.fiscal_month,
        sm.min_cost, sm.base_percentage, sm.sim_sales_units,
        sm.elasticity_bp, sm.promo_elasticity, sm.price_point,
        COALESCE(pmc.weighted_promo_percent, 0) AS weighted_promo_percent,
        COALESCE(pmc.promo_source, 0) AS promo_source,
        COALESCE(pmc.effective_reference_price, 0) AS effective_reference_price,
        ss.store_split_ratio,
        sm.sim_sales_units * ss.store_split_ratio AS granular_predicted,
        'FULL_FORECAST' AS source_type
    FROM store_channel sc
    INNER JOIN sim_month sm 
        ON sc.product_id = sm.product_id 
        AND sc.channel_id = sm.channel_id 
        AND sc.segment_id = sm.segment_id
    LEFT JOIN promo_month_channel pmc 
        ON sc.product_id = pmc.product_id 
        AND sc.channel_id = pmc.channel_id 
        AND sc.segment_id = pmc.segment_id
        AND sm.fiscal_year = pmc.fiscal_year
        AND sm.fiscal_month = pmc.fiscal_month
    INNER JOIN store_split_month ss 
        ON sc.product_id = ss.product_id 
        AND sc.store_id = ss.store_id 
        AND sc.segment_id = ss.segment_id
        AND sm.fiscal_year = ss.fiscal_year
        AND sm.fiscal_month = ss.fiscal_month
),

-- ==========================================
-- PARTIAL MONTH PATH (using weekly tables)
-- ==========================================

-- SIMULATION WEEK DATA (for PARTIAL_FORECAST months)
-- Catches the boundary week (containing max_actuals_date) plus all later weeks in the month.
sim_week AS (
    SELECT
        w.product_id, w.channel_id, w.segment_id, w.week_start_date,
        w.min_cost, w.base_percentage, w.sales_units AS sim_sales_units,
        w.elasticity_bp, w.promo_elasticity,
        w.price_point,
        pcs.is_kvi,
        mi.fiscal_year, mi.fiscal_month,
        mi.forecast_start_date,
        mi.forecast_end_date
    FROM strategy_pcs pcs
    INNER JOIN base_pricing.bp_simulation_week w
        ON w.product_id = pcs.product_id
        AND w.channel_id = pcs.channel_id
        AND w.segment_id = pcs.segment_id
    INNER JOIN month_info mi ON mi.validation_type = 'PARTIAL_FORECAST'
    WHERE w.week_start_date >= mi.max_actuals_date - INTERVAL '6 days'
      AND w.week_start_date <= mi.forecast_end_date
),

-- PROMO WEEK (STORE level, for PARTIAL_FORECAST) -- preferred over channel-level promo.
-- Mirrors reco_metrics_validator's store-then-channel COALESCE pattern.
promo_week_store AS (
    SELECT p.product_id, p.store_id, p.segment_id,
           p.week_start_date,
           p.weighted_promo_percent, p.promo_source, p.effective_reference_price,
           mi.fiscal_year, mi.fiscal_month
    FROM strategy_products sp
    INNER JOIN base_pricing.bp_simulation_promo_week_with_store p
        ON p.product_id  = sp.product_id
       AND p.store_id    = sp.store_id
       AND p.segment_id  = sp.segment_id
    INNER JOIN month_info mi ON mi.validation_type = 'PARTIAL_FORECAST'
    WHERE p.week_start_date >= mi.max_actuals_date - INTERVAL '6 days'
      AND p.week_start_date <= mi.forecast_end_date
),

-- PROMO WEEK (CHANNEL level, for PARTIAL_FORECAST) -- fallback when no store-level row.
promo_week_channel AS (
    SELECT p.product_id, p.channel_id, p.segment_id,
           p.week_start_date,
           p.weighted_promo_percent, p.promo_source, p.effective_reference_price,
           mi.fiscal_year, mi.fiscal_month
    FROM strategy_pcs pcs
    INNER JOIN base_pricing.bp_simulation_promo_week p
        ON p.product_id  = pcs.product_id
       AND p.channel_id  = pcs.channel_id
       AND p.segment_id  = pcs.segment_id
    INNER JOIN month_info mi ON mi.validation_type = 'PARTIAL_FORECAST'
    WHERE p.week_start_date >= mi.max_actuals_date - INTERVAL '6 days'
      AND p.week_start_date <= mi.forecast_end_date
),

-- DAY SPLIT KVI (for PARTIAL_FORECAST)
-- Day-level filter: only forecast days within this fiscal month.
-- The boundary week's week_split_ratio sums to <1.0; later fully-forecast weeks sum to 1.0.
day_split_kvi_raw AS (
    SELECT d.product_id, d.channel_id, pcs.segment_id, d.segment_id AS data_segment_id,
           d.week_start_date,
           SUM(d.day_split_ratio) AS week_split_ratio,
           mi.fiscal_year, mi.fiscal_month
    FROM strategy_pcs pcs
    INNER JOIN base_pricing.bp_simulation_day_split_ratio_kvi d
        ON d.product_id = pcs.product_id AND d.channel_id = pcs.channel_id
        AND d.segment_id IN (pcs.segment_id, 0)
    INNER JOIN month_info mi ON mi.validation_type = 'PARTIAL_FORECAST'
    WHERE pcs.is_kvi
      AND d.date >  mi.max_actuals_date
      AND d.date <= mi.end_date
    GROUP BY d.product_id, d.channel_id, pcs.segment_id, d.segment_id, d.week_start_date,
             mi.fiscal_year, mi.fiscal_month
),

day_split_kvi AS (
    SELECT DISTINCT ON (product_id, channel_id, segment_id, week_start_date, fiscal_year, fiscal_month)
        product_id, channel_id, segment_id, week_start_date, week_split_ratio, fiscal_year, fiscal_month
    FROM day_split_kvi_raw
    ORDER BY product_id, channel_id, segment_id, week_start_date, fiscal_year, fiscal_month,
             CASE WHEN data_segment_id = segment_id THEN 0 ELSE 1 END
),

-- DAY SPLIT NON-KVI (for PARTIAL_FORECAST)
day_split_non_kvi_raw AS (
    SELECT pcs.product_id, d.channel_id, pcs.segment_id, d.segment_id AS data_segment_id,
           d.week_start_date,
           SUM(d.day_split_ratio) AS week_split_ratio,
           mi.fiscal_year, mi.fiscal_month
    FROM strategy_pcs pcs
    INNER JOIN base_pricing.bp_simulation_day_split_ratio d
        ON d.l0_cid = pcs.l0_cid AND d.l1_cid = pcs.l1_cid AND d.l2_cid = pcs.l2_cid AND d.l3_cid = pcs.l3_cid
        AND d.channel_id = pcs.channel_id
        AND d.segment_id IN (pcs.segment_id, 0)
    INNER JOIN month_info mi ON mi.validation_type = 'PARTIAL_FORECAST'
    WHERE NOT pcs.is_kvi
      AND d.date >  mi.max_actuals_date
      AND d.date <= mi.end_date
    GROUP BY pcs.product_id, d.channel_id, pcs.segment_id, d.segment_id, d.week_start_date,
             mi.fiscal_year, mi.fiscal_month
),

day_split_non_kvi AS (
    SELECT DISTINCT ON (product_id, channel_id, segment_id, week_start_date, fiscal_year, fiscal_month)
        product_id, channel_id, segment_id, week_start_date, week_split_ratio, fiscal_year, fiscal_month
    FROM day_split_non_kvi_raw
    ORDER BY product_id, channel_id, segment_id, week_start_date, fiscal_year, fiscal_month,
             CASE WHEN data_segment_id = segment_id THEN 0 ELSE 1 END
),

day_split AS (
    SELECT * FROM day_split_kvi UNION ALL SELECT * FROM day_split_non_kvi
),

-- STORE SPLIT KVI WEEK (for PARTIAL_FORECAST)
store_split_kvi_week_raw AS (
    SELECT ss.product_id, ss.store_id, sph.segment_id, ss.segment_id AS data_segment_id,
           ss.week_start_date, ss.store_split_ratio,
           mi.fiscal_year, mi.fiscal_month
    FROM strategy_products_with_hierarchy sph
    INNER JOIN base_pricing.bp_simulation_store_split_ratio_kvi ss
        ON ss.product_id = sph.product_id AND ss.store_id = sph.store_id
        AND ss.segment_id IN (sph.segment_id, 0)
    INNER JOIN month_info mi ON mi.validation_type = 'PARTIAL_FORECAST'
    WHERE sph.is_kvi
      AND ss.week_start_date >= mi.max_actuals_date - INTERVAL '6 days'
      AND ss.week_start_date <= mi.forecast_end_date
),

store_split_kvi_week AS (
    SELECT DISTINCT ON (product_id, store_id, segment_id, week_start_date, fiscal_year, fiscal_month)
        product_id, store_id, segment_id, week_start_date, store_split_ratio, fiscal_year, fiscal_month
    FROM store_split_kvi_week_raw
    ORDER BY product_id, store_id, segment_id, week_start_date, fiscal_year, fiscal_month,
             CASE WHEN data_segment_id = segment_id THEN 0 ELSE 1 END
),

-- STORE SPLIT NON-KVI WEEK (for PARTIAL_FORECAST - hierarchy join)
store_split_non_kvi_week_raw AS (
    SELECT sph.product_id, ss.store_id, sph.segment_id, ss.segment_id AS data_segment_id,
           ss.week_start_date, ss.store_split_ratio,
           mi.fiscal_year, mi.fiscal_month
    FROM strategy_products_with_hierarchy sph
    INNER JOIN base_pricing.bp_simulation_store_split_ratio ss
        ON ss.l0_cid = sph.l0_cid AND ss.l1_cid = sph.l1_cid AND ss.l2_cid = sph.l2_cid AND ss.l3_cid = sph.l3_cid
        AND ss.store_id = sph.store_id
        AND ss.segment_id IN (sph.segment_id, 0)
    INNER JOIN month_info mi ON mi.validation_type = 'PARTIAL_FORECAST'
    WHERE NOT sph.is_kvi
      AND ss.week_start_date >= mi.max_actuals_date - INTERVAL '6 days'
      AND ss.week_start_date <= mi.forecast_end_date
),

store_split_non_kvi_week AS (
    SELECT DISTINCT ON (product_id, store_id, segment_id, week_start_date, fiscal_year, fiscal_month)
        product_id, store_id, segment_id, week_start_date, store_split_ratio, fiscal_year, fiscal_month
    FROM store_split_non_kvi_week_raw
    ORDER BY product_id, store_id, segment_id, week_start_date, fiscal_year, fiscal_month,
             CASE WHEN data_segment_id = segment_id THEN 0 ELSE 1 END
),

store_split_week AS (
    SELECT * FROM store_split_kvi_week UNION ALL SELECT * FROM store_split_non_kvi_week
),

-- GRANULAR DATA PARTIAL (weekly level)
granular_data_partial_weekly AS (
    SELECT 
        sc.product_id, sc.store_id, sc.segment_id, sc.channel_id, sc.opt_level_bins,
        sw.fiscal_year, sw.fiscal_month, sw.week_start_date,
        sw.min_cost, sw.base_percentage, sw.sim_sales_units,
        sw.elasticity_bp, sw.promo_elasticity, sw.price_point,
        -- Prefer store-level promo; fall back to channel-level if no store row.
        COALESCE(pws.weighted_promo_percent,    pwc.weighted_promo_percent,    0) AS weighted_promo_percent,
        COALESCE(pws.promo_source,              pwc.promo_source,              0) AS promo_source,
        COALESCE(pws.effective_reference_price, pwc.effective_reference_price, 0) AS effective_reference_price,
        ds.week_split_ratio,
        ssw.store_split_ratio,
        sw.sim_sales_units * ds.week_split_ratio * ssw.store_split_ratio AS granular_predicted
    FROM store_channel sc
    INNER JOIN sim_week sw
        ON sc.product_id  = sw.product_id
       AND sc.channel_id  = sw.channel_id
       AND sc.segment_id  = sw.segment_id
    LEFT JOIN promo_week_store pws
        ON sc.product_id  = pws.product_id
       AND sc.store_id    = pws.store_id
       AND sc.segment_id  = pws.segment_id
       AND sw.week_start_date = pws.week_start_date
    LEFT JOIN promo_week_channel pwc
        ON sc.product_id  = pwc.product_id
       AND sc.channel_id  = pwc.channel_id
       AND sc.segment_id  = pwc.segment_id
       AND sw.week_start_date = pwc.week_start_date
    INNER JOIN day_split ds 
        ON sc.product_id = ds.product_id 
        AND sc.channel_id = ds.channel_id 
        AND sc.segment_id = ds.segment_id
        AND sw.week_start_date = ds.week_start_date
        AND sw.fiscal_year = ds.fiscal_year
        AND sw.fiscal_month = ds.fiscal_month
    INNER JOIN store_split_week ssw 
        ON sc.product_id = ssw.product_id 
        AND sc.store_id = ssw.store_id 
        AND sc.segment_id = ssw.segment_id
        AND sw.week_start_date = ssw.week_start_date
        AND sw.fiscal_year = ssw.fiscal_year
        AND sw.fiscal_month = ssw.fiscal_month
),

-- AGGREGATE PARTIAL WEEKLY TO MONTH LEVEL
granular_data_partial AS (
    SELECT 
        product_id, store_id, segment_id, channel_id, opt_level_bins,
        fiscal_year, fiscal_month,
        AVG(min_cost) AS min_cost,
        AVG(base_percentage) AS base_percentage,
        SUM(sim_sales_units) AS sim_sales_units,
        AVG(elasticity_bp) AS elasticity_bp,
        AVG(promo_elasticity) AS promo_elasticity,
        AVG(price_point) AS price_point,
        AVG(weighted_promo_percent) AS weighted_promo_percent,
        MIN(promo_source) AS promo_source,
        AVG(effective_reference_price) AS effective_reference_price,
        AVG(store_split_ratio) AS store_split_ratio,
        SUM(granular_predicted) AS granular_predicted,
        'PARTIAL_FORECAST' AS source_type
    FROM granular_data_partial_weekly
    GROUP BY product_id, store_id, segment_id, channel_id, opt_level_bins, fiscal_year, fiscal_month
),

-- ==========================================
-- COMBINED GRANULAR DATA (FULL + PARTIAL)
-- ==========================================
granular_data_combined AS (
    SELECT 
        product_id, store_id, segment_id, channel_id, opt_level_bins,
        fiscal_year, fiscal_month,
        min_cost, base_percentage, sim_sales_units,
        elasticity_bp, promo_elasticity, price_point,
        weighted_promo_percent, promo_source, effective_reference_price,
        store_split_ratio, granular_predicted, source_type
    FROM granular_data_full
    UNION ALL
    SELECT 
        product_id, store_id, segment_id, channel_id, opt_level_bins,
        fiscal_year, fiscal_month,
        min_cost, base_percentage, sim_sales_units,
        elasticity_bp, promo_elasticity, price_point,
        weighted_promo_percent, promo_source, effective_reference_price,
        store_split_ratio, granular_predicted, source_type
    FROM granular_data_partial
),

-- AGGREGATE TO BIN + MONTH LEVEL
sim_aggregated AS (
    SELECT 
        opt_level_bins, product_id, fiscal_year, fiscal_month,
        SUM(granular_predicted) AS total_predicted,
        AVG(min_cost) AS avg_min_cost,
        AVG(price_point) AS avg_price_point,
        AVG(base_percentage) AS avg_base_percentage,
        AVG(elasticity_bp) AS avg_elasticity,
        AVG(promo_elasticity) AS avg_promo_elasticity,
        AVG(weighted_promo_percent) AS avg_promo_pct,
        MIN(promo_source) AS promo_source,
        AVG(effective_reference_price) AS avg_effective_ref_price,
        COUNT(DISTINCT store_id) AS store_count,
        MAX(source_type) AS source_type
    FROM granular_data_combined
    GROUP BY opt_level_bins, product_id, fiscal_year, fiscal_month
),

-- APPLY ELASTICITY FORMULA
calculated AS (
    SELECT 
        sa.opt_level_bins, sa.product_id, sa.fiscal_year, sa.fiscal_month,
        r.base_price_current, r.base_price_ia, r.base_price_finalized,
        r.cost,
        sa.total_predicted,
        sa.avg_min_cost, sa.avg_base_percentage, sa.avg_elasticity,
        sa.avg_promo_elasticity, sa.avg_promo_pct, sa.promo_source,
        sa.avg_effective_ref_price, sa.store_count, sa.source_type,
        
        -- Effective promo percent
        CASE WHEN sa.promo_source = 1 AND r.base_price_current <= sa.avg_effective_ref_price
             THEN 0.0 ELSE COALESCE(sa.avg_promo_pct, 0) END AS effective_promo_pct,
        
        -- Promo prices
        r.base_price_current * (1 - CASE WHEN sa.promo_source = 1 AND r.base_price_current <= sa.avg_effective_ref_price
             THEN 0.0 ELSE COALESCE(sa.avg_promo_pct, 0) END) AS promo_price_current,
        r.base_price_ia * (1 - CASE WHEN sa.promo_source = 1 AND r.base_price_current <= sa.avg_effective_ref_price
             THEN 0.0 ELSE COALESCE(sa.avg_promo_pct, 0) END) AS promo_price_ia,
        r.base_price_finalized * (1 - CASE WHEN sa.promo_source = 1 AND r.base_price_current <= sa.avg_effective_ref_price
             THEN 0.0 ELSE COALESCE(sa.avg_promo_pct, 0) END) AS promo_price_finalized,
        
        -- Markup calculations
        CASE WHEN sa.avg_min_cost > 0 AND r.base_price_current IS NOT NULL
             THEN (r.base_price_current - sa.avg_min_cost) / sa.avg_min_cost ELSE 0 END AS sim_markup_current,
        CASE WHEN sa.avg_min_cost > 0 AND r.base_price_ia IS NOT NULL
             THEN (r.base_price_ia - sa.avg_min_cost) / sa.avg_min_cost ELSE 0 END AS sim_markup_ia,
        CASE WHEN sa.avg_min_cost > 0 AND r.base_price_finalized IS NOT NULL
             THEN (r.base_price_finalized - sa.avg_min_cost) / sa.avg_min_cost ELSE 0 END AS sim_markup_finalized,
        
        -- ELASTICITY FORMULA: predicted * (1 + elasticity * (markup - base_pct)) * (1 + promo_elasticity * promo_pct)
        sa.total_predicted * (1 + sa.avg_elasticity * (
            CASE WHEN sa.avg_min_cost > 0 AND r.base_price_current IS NOT NULL
                 THEN (r.base_price_current - sa.avg_min_cost) / sa.avg_min_cost ELSE 0 END 
            - sa.avg_base_percentage
        )) * (1 + sa.avg_promo_elasticity * 
            CASE WHEN sa.promo_source = 1 AND r.base_price_current <= sa.avg_effective_ref_price
                 THEN 0.0 ELSE sa.avg_promo_pct END
        ) AS calc_sales_current,
        
        sa.total_predicted * (1 + sa.avg_elasticity * (
            CASE WHEN sa.avg_min_cost > 0 AND r.base_price_ia IS NOT NULL
                 THEN (r.base_price_ia - sa.avg_min_cost) / sa.avg_min_cost ELSE 0 END 
            - sa.avg_base_percentage
        )) * (1 + sa.avg_promo_elasticity * 
            CASE WHEN sa.promo_source = 1 AND r.base_price_current <= sa.avg_effective_ref_price
                 THEN 0.0 ELSE sa.avg_promo_pct END
        ) AS calc_sales_ia,
        
        sa.total_predicted * (1 + sa.avg_elasticity * (
            CASE WHEN sa.avg_min_cost > 0 AND r.base_price_finalized IS NOT NULL
                 THEN (r.base_price_finalized - sa.avg_min_cost) / sa.avg_min_cost ELSE 0 END 
            - sa.avg_base_percentage
        )) * (1 + sa.avg_promo_elasticity * 
            CASE WHEN sa.promo_source = 1 AND r.base_price_current <= sa.avg_effective_ref_price
                 THEN 0.0 ELSE sa.avg_promo_pct END
        ) AS calc_sales_finalized
        
    FROM sim_aggregated sa
    INNER JOIN reco_all r ON sa.opt_level_bins = r.opt_level_bins AND sa.product_id = r.product_id
),

-- CALCULATE ALL METRICS
metrics AS (
    SELECT 
        c.*,
        
        ROUND(c.calc_sales_current::numeric, 0) AS rounded_sales_current,
        ROUND(c.calc_sales_ia::numeric, 0) AS rounded_sales_ia,
        ROUND(c.calc_sales_finalized::numeric, 0) AS rounded_sales_finalized,
        
        ROUND((ROUND(c.calc_sales_current::numeric, 0) * c.promo_price_current)::numeric, 2) AS calc_revenue_current,
        ROUND((ROUND(c.calc_sales_ia::numeric, 0) * c.promo_price_ia)::numeric, 2) AS calc_revenue_ia,
        ROUND((ROUND(c.calc_sales_finalized::numeric, 0) * c.promo_price_finalized)::numeric, 2) AS calc_revenue_finalized,
        
        ROUND(((c.promo_price_current - c.cost) * ROUND(c.calc_sales_current::numeric, 0))::numeric, 2) AS calc_gm_dollar_current,
        ROUND(((c.promo_price_ia - c.cost) * ROUND(c.calc_sales_ia::numeric, 0))::numeric, 2) AS calc_gm_dollar_ia,
        ROUND(((c.promo_price_finalized - c.cost) * ROUND(c.calc_sales_finalized::numeric, 0))::numeric, 2) AS calc_gm_dollar_finalized
        
    FROM calculated c
),

final_metrics AS (
    SELECT 
        m.*,
        
        CASE WHEN m.rounded_sales_current > 0 
             THEN ROUND((m.calc_revenue_current / m.rounded_sales_current)::numeric, 2)
             ELSE 0 END AS calc_asp_current,
        CASE WHEN m.rounded_sales_ia > 0 
             THEN ROUND((m.calc_revenue_ia / m.rounded_sales_ia)::numeric, 2)
             ELSE 0 END AS calc_asp_ia,
        CASE WHEN m.rounded_sales_finalized > 0 
             THEN ROUND((m.calc_revenue_finalized / m.rounded_sales_finalized)::numeric, 2)
             ELSE 0 END AS calc_asp_finalized,
        
        CASE WHEN m.rounded_sales_current > 0 
             THEN ROUND((m.calc_gm_dollar_current / m.rounded_sales_current)::numeric, 2)
             ELSE 0 END AS calc_aum_current,
        CASE WHEN m.rounded_sales_ia > 0 
             THEN ROUND((m.calc_gm_dollar_ia / m.rounded_sales_ia)::numeric, 2)
             ELSE 0 END AS calc_aum_ia,
        CASE WHEN m.rounded_sales_finalized > 0 
             THEN ROUND((m.calc_gm_dollar_finalized / m.rounded_sales_finalized)::numeric, 2)
             ELSE 0 END AS calc_aum_finalized,
        
        CASE WHEN m.calc_revenue_current > 0 
             THEN ROUND(((m.calc_gm_dollar_current / m.calc_revenue_current) * 100)::numeric, 2)
             ELSE 0 END AS calc_gm_pct_current,
        CASE WHEN m.calc_revenue_ia > 0 
             THEN ROUND(((m.calc_gm_dollar_ia / m.calc_revenue_ia) * 100)::numeric, 2)
             ELSE 0 END AS calc_gm_pct_ia,
        CASE WHEN m.calc_revenue_finalized > 0 
             THEN ROUND(((m.calc_gm_dollar_finalized / m.calc_revenue_finalized) * 100)::numeric, 2)
             ELSE 0 END AS calc_gm_pct_finalized
             
    FROM metrics m
),

-- Expected grid: bins x forecast months. The output is driven by this CROSS JOIN,
-- so every (bin, forecast_month) combo emits a row even if stored or calc is missing.
expected_grid AS (
    SELECT
        ob.opt_level_bins, ob.product_id,
        em.fiscal_year, em.fiscal_month, em.fiscal_month_name,
        em.fiscal_year_label,
        em.month_start, em.month_end,
        em.config_range_start, em.config_range_end,
        em.max_actuals_date,
        em.validation_type,
        em.forecast_start_date, em.forecast_end_date
    FROM our_bins ob
    CROSS JOIN expected_months em
    WHERE em.validation_type IN ('FULL_FORECAST', 'PARTIAL_FORECAST')
)

SELECT
    sf.id,
    eg.opt_level_bins,
    eg.product_id,
    -- Bin identity (always populated from bin_identity, even when stored row missing)
    bi.product_code,
    bi.channel_name,
    bi.price_zone_display       AS price_zone,
    bi.segment_name,
    bi.price_lock_val           AS price_lock,
    bi.zone_exception_val       AS zone_exception,
    -- Stored row's own identity columns (NULL when MISSING_STORED)
    sf.segment_id,
    sf.channel_id,
    sf.price_zone               AS stored_price_zone,
    sf.line_group,
    eg.fiscal_year,
    eg.fiscal_month,
    eg.fiscal_month_name,
    eg.fiscal_year_label,
    sf.stored_start_date,
    sf.stored_end_date,
    eg.month_start,
    eg.month_end,
    eg.config_range_start,
    eg.config_range_end,
    eg.max_actuals_date,
    eg.validation_type,
    eg.forecast_start_date::date AS forecast_start_date,
    eg.forecast_end_date,
    fm.source_type AS calc_source_type,

    -- Row-level presence flags (quick filter)
    CASE WHEN sf.id IS NULL              THEN 'MISSING' ELSE 'PRESENT' END AS stored_status,
    CASE WHEN fm.opt_level_bins IS NULL  THEN 'MISSING' ELSE 'PRESENT' END AS calc_status,

    -- Prices (from calc; NULL if calc missing)
    ROUND(fm.base_price_current::numeric, 2)   AS price_current,
    ROUND(fm.base_price_ia::numeric, 2)        AS price_ia,
    ROUND(fm.base_price_finalized::numeric, 2) AS price_finalized,
    ROUND(fm.promo_price_current::numeric, 2)  AS promo_price_current,
    ROUND(fm.cost::numeric, 2)                 AS cost,
    ROUND(fm.total_predicted::numeric, 3)      AS total_predicted,
    fm.store_count,

    -- ======= CURRENT PRICE METRICS =======
    ROUND(sf.stored_curr_sales_units::numeric, 0) AS stored_curr_sales_units,
    ROUND(sf.stored_curr_revenue::numeric, 2)     AS stored_curr_revenue,
    ROUND(sf.stored_curr_gm_dollar::numeric, 2)   AS stored_curr_gm_dollar,
    ROUND(sf.stored_curr_gm_pct::numeric, 2)      AS stored_curr_gm_pct,
    ROUND(sf.stored_curr_asp::numeric, 2)         AS stored_curr_asp,
    ROUND(sf.stored_curr_aum::numeric, 2)         AS stored_curr_aum,

    fm.rounded_sales_current  AS calc_curr_sales_units,
    fm.calc_revenue_current   AS calc_curr_revenue,
    fm.calc_gm_dollar_current AS calc_curr_gm_dollar,
    fm.calc_gm_pct_current    AS calc_curr_gm_pct,
    fm.calc_asp_current       AS calc_curr_asp,
    fm.calc_aum_current       AS calc_curr_aum,

    -- 5-state match for Current
    CASE
        WHEN sf.stored_curr_sales_units IS NULL AND fm.rounded_sales_current IS NULL THEN 'MISSING_BOTH'
        WHEN sf.stored_curr_sales_units IS NULL THEN 'MISSING_STORED'
        WHEN fm.rounded_sales_current   IS NULL THEN 'MISSING_CALC'
        WHEN ROUND(sf.stored_curr_sales_units::numeric, 0) = fm.rounded_sales_current THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS curr_sales_match,
    CASE
        WHEN sf.stored_curr_revenue  IS NULL AND fm.calc_revenue_current IS NULL THEN 'MISSING_BOTH'
        WHEN sf.stored_curr_revenue  IS NULL THEN 'MISSING_STORED'
        WHEN fm.calc_revenue_current IS NULL THEN 'MISSING_CALC'
        WHEN ABS(ROUND(sf.stored_curr_revenue::numeric, 2) - fm.calc_revenue_current) <= 0.01 THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS curr_revenue_match,
    CASE
        WHEN sf.stored_curr_gm_dollar  IS NULL AND fm.calc_gm_dollar_current IS NULL THEN 'MISSING_BOTH'
        WHEN sf.stored_curr_gm_dollar  IS NULL THEN 'MISSING_STORED'
        WHEN fm.calc_gm_dollar_current IS NULL THEN 'MISSING_CALC'
        WHEN ABS(ROUND(sf.stored_curr_gm_dollar::numeric, 2) - fm.calc_gm_dollar_current) <= 0.01 THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS curr_gm_dollar_match,
    CASE
        WHEN sf.stored_curr_gm_pct  IS NULL AND fm.calc_gm_pct_current IS NULL THEN 'MISSING_BOTH'
        WHEN sf.stored_curr_gm_pct  IS NULL THEN 'MISSING_STORED'
        WHEN fm.calc_gm_pct_current IS NULL THEN 'MISSING_CALC'
        WHEN ABS(ROUND(sf.stored_curr_gm_pct::numeric, 2) - fm.calc_gm_pct_current) <= 0.01 THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS curr_gm_pct_match,
    CASE
        WHEN sf.stored_curr_asp  IS NULL AND fm.calc_asp_current IS NULL THEN 'MISSING_BOTH'
        WHEN sf.stored_curr_asp  IS NULL THEN 'MISSING_STORED'
        WHEN fm.calc_asp_current IS NULL THEN 'MISSING_CALC'
        WHEN ABS(ROUND(sf.stored_curr_asp::numeric, 2) - fm.calc_asp_current) <= 0.01 THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS curr_asp_match,
    CASE
        WHEN sf.stored_curr_aum  IS NULL AND fm.calc_aum_current IS NULL THEN 'MISSING_BOTH'
        WHEN sf.stored_curr_aum  IS NULL THEN 'MISSING_STORED'
        WHEN fm.calc_aum_current IS NULL THEN 'MISSING_CALC'
        WHEN ABS(ROUND(sf.stored_curr_aum::numeric, 2) - fm.calc_aum_current) <= 0.01 THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS curr_aum_match,

    -- Differences (NULL when either side missing)
    ROUND(sf.stored_curr_sales_units::numeric, 0) - fm.rounded_sales_current AS curr_sales_diff,
    ROUND(sf.stored_curr_revenue::numeric, 2)     - fm.calc_revenue_current   AS curr_revenue_diff,
    ROUND(sf.stored_curr_gm_dollar::numeric, 2)   - fm.calc_gm_dollar_current AS curr_gm_dollar_diff,

    -- ======= IA METRICS =======
    ROUND(sf.stored_ia_sales_units::numeric, 0) AS stored_ia_sales_units,
    fm.rounded_sales_ia AS calc_ia_sales_units,
    CASE
        WHEN sf.stored_ia_sales_units IS NULL AND fm.rounded_sales_ia IS NULL THEN 'MISSING_BOTH'
        WHEN sf.stored_ia_sales_units IS NULL THEN 'MISSING_STORED'
        WHEN fm.rounded_sales_ia      IS NULL THEN 'MISSING_CALC'
        WHEN ROUND(sf.stored_ia_sales_units::numeric, 0) = fm.rounded_sales_ia THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS ia_sales_match,

    ROUND(sf.stored_ia_revenue::numeric, 2) AS stored_ia_revenue,
    fm.calc_revenue_ia AS calc_ia_revenue,
    CASE
        WHEN sf.stored_ia_revenue IS NULL AND fm.calc_revenue_ia IS NULL THEN 'MISSING_BOTH'
        WHEN sf.stored_ia_revenue IS NULL THEN 'MISSING_STORED'
        WHEN fm.calc_revenue_ia   IS NULL THEN 'MISSING_CALC'
        WHEN ABS(ROUND(sf.stored_ia_revenue::numeric, 2) - fm.calc_revenue_ia) <= 0.01 THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS ia_revenue_match,

    ROUND(sf.stored_ia_gm_dollar::numeric, 2) AS stored_ia_gm_dollar,
    fm.calc_gm_dollar_ia AS calc_ia_gm_dollar,
    CASE
        WHEN sf.stored_ia_gm_dollar IS NULL AND fm.calc_gm_dollar_ia IS NULL THEN 'MISSING_BOTH'
        WHEN sf.stored_ia_gm_dollar IS NULL THEN 'MISSING_STORED'
        WHEN fm.calc_gm_dollar_ia   IS NULL THEN 'MISSING_CALC'
        WHEN ABS(ROUND(sf.stored_ia_gm_dollar::numeric, 2) - fm.calc_gm_dollar_ia) <= 0.01 THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS ia_gm_dollar_match,

    -- ======= FINALIZED METRICS =======
    ROUND(sf.stored_final_sales_units::numeric, 0) AS stored_final_sales_units,
    fm.rounded_sales_finalized AS calc_final_sales_units,
    CASE
        WHEN sf.stored_final_sales_units IS NULL AND fm.rounded_sales_finalized IS NULL THEN 'MISSING_BOTH'
        WHEN sf.stored_final_sales_units IS NULL THEN 'MISSING_STORED'
        WHEN fm.rounded_sales_finalized  IS NULL THEN 'MISSING_CALC'
        WHEN ROUND(sf.stored_final_sales_units::numeric, 0) = fm.rounded_sales_finalized THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS final_sales_match,

    ROUND(sf.stored_final_revenue::numeric, 2) AS stored_final_revenue,
    fm.calc_revenue_finalized AS calc_final_revenue,
    CASE
        WHEN sf.stored_final_revenue   IS NULL AND fm.calc_revenue_finalized IS NULL THEN 'MISSING_BOTH'
        WHEN sf.stored_final_revenue   IS NULL THEN 'MISSING_STORED'
        WHEN fm.calc_revenue_finalized IS NULL THEN 'MISSING_CALC'
        WHEN ABS(ROUND(sf.stored_final_revenue::numeric, 2) - fm.calc_revenue_finalized) <= 0.01 THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS final_revenue_match,

    ROUND(sf.stored_final_gm_dollar::numeric, 2) AS stored_final_gm_dollar,
    fm.calc_gm_dollar_finalized AS calc_final_gm_dollar,
    CASE
        WHEN sf.stored_final_gm_dollar   IS NULL AND fm.calc_gm_dollar_finalized IS NULL THEN 'MISSING_BOTH'
        WHEN sf.stored_final_gm_dollar   IS NULL THEN 'MISSING_STORED'
        WHEN fm.calc_gm_dollar_finalized IS NULL THEN 'MISSING_CALC'
        WHEN ABS(ROUND(sf.stored_final_gm_dollar::numeric, 2) - fm.calc_gm_dollar_finalized) <= 0.01 THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS final_gm_dollar_match

FROM expected_grid eg
LEFT JOIN bin_identity bi
       ON eg.opt_level_bins = bi.opt_level_bins
      AND eg.product_id     = bi.product_id
LEFT JOIN stored_forecast sf
       ON eg.opt_level_bins = sf.opt_level_bins
      AND eg.product_id     = sf.product_id
      AND eg.fiscal_year    = sf.fiscal_year
      AND eg.fiscal_month   = sf.fiscal_month
LEFT JOIN final_metrics fm
       ON eg.opt_level_bins = fm.opt_level_bins
      AND eg.product_id     = fm.product_id
      AND eg.fiscal_year    = fm.fiscal_year
      AND eg.fiscal_month   = fm.fiscal_month
-- Drop rows where BOTH sides are entirely missing (no stored row AND no calc data).
-- Using metric columns (data presence) instead of join-key columns for clarity.
WHERE sf.stored_curr_sales_units IS NOT NULL
   OR fm.rounded_sales_current   IS NOT NULL
ORDER BY eg.opt_level_bins, eg.fiscal_year, eg.fiscal_month
