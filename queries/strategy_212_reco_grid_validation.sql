
-- Reco Grid Data Validation Query
-- Strategy ID: 212
-- View By    : product
-- Channel Filter: All channels
-- Grid Table : bp_strategy_price_reco_grid_data_product_pricezone
-- Compares our reco rollup (one row per group) vs the tool's pre-aggregated grid,
-- emitting per-metric MATCH / MISMATCH / MISSING_OURS / MISSING_GRID.

WITH strategy_products AS (
    SELECT DISTINCT product_id, store_id, segment_id
    FROM base_pricing.bp_strategy_products_stores
    WHERE strategy_id = 212
),

bins_mapping AS (
    SELECT
        v.product_id, v.store_id, v.segment_id,
        v.effective_price_zone,
        sm.s0_cid AS channel_id,
        v.product_id::text || '_' ||
        CASE WHEN v.attribute_6::boolean OR v.attribute_7::boolean OR v.effective_price_zone IS NULL
            THEN v.store_id::text || '_' || v.segment_id::text
            ELSE v.effective_price_zone || '_' || v.segment_id::text
        END AS opt_level_bins,
        CASE WHEN v.attribute_7::boolean OR v.effective_price_zone IS NULL
            THEN sm.store_code
            ELSE v.price_zone
        END AS price_zone_display
    FROM base_pricing.bp_product_store_attributes_mapping_v4 v
    INNER JOIN strategy_products sp
        ON v.product_id = sp.product_id AND v.store_id = sp.store_id AND v.segment_id = sp.segment_id
    INNER JOIN base_pricing.bp_store_master sm ON v.store_id = sm.store_id
),

-- One row per bin (collapses multi-store zone bins to a single representative store).
-- Without DISTINCT ON, downstream SUM(...) would multiply metrics by (stores in zone).
bin_groups AS (
    SELECT DISTINCT ON (bm.opt_level_bins, bm.product_id, bm.segment_id, bm.channel_id)
        bm.opt_level_bins,
        bm.product_id,
        bm.store_id,
        bm.segment_id,
        bm.channel_id,
        bm.price_zone_display,
        pm.product_code,
        (
            SELECT attr->'attribute_value'->>'current'
            FROM jsonb_array_elements(pam.attributes) attr
            WHERE attr->>'attribute_name' = 'line_group'
            LIMIT 1
        ) AS line_group,
        sm.s0_name AS channel_name,
        COALESCE(csm.segment_name, 'Segment ' || bm.segment_id::text) AS segment_name
    FROM bins_mapping bm
    INNER JOIN base_pricing.bp_product_master pm ON bm.product_id = pm.product_id
    INNER JOIN base_pricing.bp_store_master sm   ON bm.store_id   = sm.store_id
    LEFT JOIN base_pricing.bp_customer_segment_master csm ON bm.segment_id = csm.segment_id
    LEFT JOIN base_pricing.bp_product_attributes_mapping pam ON pam.product_id = bm.product_id
    ORDER BY bm.opt_level_bins, bm.product_id, bm.segment_id, bm.channel_id, bm.store_id
),

-- ----- Per-bin reco rows (one row per bin per scenario) -----
-- Standard + baseline metrics. Actuals are sourced from finalized only (single set, not per-scenario).
current_per_bin AS (
    SELECT rc.opt_level_bins, rc.product_id, rc.segment_id, rc.channel_id,
        COALESCE(rc.sales_units, 0) AS su, COALESCE(rc.revenue, 0) AS rev, COALESCE(rc.gross_margin_dollar, 0) AS gm,
        COALESCE(rc.asp * rc.sales_units, 0) AS asp_w,
        COALESCE(rc.aum * rc.sales_units, 0) AS aum_w,
        COALESCE(rc.gross_margin_percentage * rc.sales_units, 0) AS gm_pct_w,
        rc.base_price AS bp,
        -- Baseline
        COALESCE(rc.baseline_sales, 0) AS bl_su,
        COALESCE(rc.baseline_revenue, 0) AS bl_rev,
        COALESCE(rc.baseline_margin_dollar, 0) AS bl_gm,
        COALESCE(rc.baseline_asp * rc.baseline_sales, 0) AS bl_asp_w,
        COALESCE(rc.baseline_aum * rc.baseline_sales, 0) AS bl_aum_w,
        COALESCE(rc.baseline_margin_percentage * rc.baseline_sales, 0) AS bl_gm_pct_w
    FROM base_pricing.bp_price_reco_current_v2 rc
    WHERE rc.strategy_id = 212
),
ia_per_bin AS (
    SELECT ri.opt_level_bins, ri.product_id, ri.segment_id, ri.channel_id,
        COALESCE(ri.sales_units, 0) AS su, COALESCE(ri.revenue, 0) AS rev, COALESCE(ri.gross_margin_dollar, 0) AS gm,
        COALESCE(ri.asp * ri.sales_units, 0) AS asp_w,
        COALESCE(ri.aum * ri.sales_units, 0) AS aum_w,
        COALESCE(ri.gross_margin_percentage * ri.sales_units, 0) AS gm_pct_w,
        ri.base_price AS bp,
        -- Baseline
        COALESCE(ri.baseline_sales, 0) AS bl_su,
        COALESCE(ri.baseline_revenue, 0) AS bl_rev,
        COALESCE(ri.baseline_margin_dollar, 0) AS bl_gm,
        COALESCE(ri.baseline_asp * ri.baseline_sales, 0) AS bl_asp_w,
        COALESCE(ri.baseline_aum * ri.baseline_sales, 0) AS bl_aum_w,
        COALESCE(ri.baseline_margin_percentage * ri.baseline_sales, 0) AS bl_gm_pct_w
    FROM base_pricing.bp_price_reco_ia_v2 ri
    WHERE ri.strategy_id = 212
),
fin_per_bin AS (
    SELECT rf.opt_level_bins, rf.product_id, rf.segment_id, rf.channel_id,
        COALESCE(rf.sales_units, 0) AS su, COALESCE(rf.revenue, 0) AS rev, COALESCE(rf.gross_margin_dollar, 0) AS gm,
        COALESCE(rf.asp * rf.sales_units, 0) AS asp_w,
        COALESCE(rf.aum * rf.sales_units, 0) AS aum_w,
        COALESCE(rf.gross_margin_percentage * rf.sales_units, 0) AS gm_pct_w,
        rf.base_price AS bp,
        -- Baseline
        COALESCE(rf.baseline_sales, 0) AS bl_su,
        COALESCE(rf.baseline_revenue, 0) AS bl_rev,
        COALESCE(rf.baseline_margin_dollar, 0) AS bl_gm,
        COALESCE(rf.baseline_asp * rf.baseline_sales, 0) AS bl_asp_w,
        COALESCE(rf.baseline_aum * rf.baseline_sales, 0) AS bl_aum_w,
        COALESCE(rf.baseline_margin_percentage * rf.baseline_sales, 0) AS bl_gm_pct_w,
        -- Actuals (sourced from finalized; single set, not per-scenario)
        COALESCE(rf.actuals_sales_units, 0) AS act_su,
        COALESCE(rf.actuals_revenue, 0) AS act_rev,
        COALESCE(rf.actuals_gross_margin_dollar, 0) AS act_gm,
        COALESCE(rf.actuals_asp * rf.actuals_sales_units, 0) AS act_asp_w,
        COALESCE(rf.actuals_aum * rf.actuals_sales_units, 0) AS act_aum_w,
        COALESCE(rf.actuals_gross_margin_percentage * rf.actuals_sales_units, 0) AS act_gm_pct_w
    FROM base_pricing.bp_price_reco_finalized_v2 rf
    WHERE rf.strategy_id = 212
),

-- ----- Roll up per scenario to (group_label, channel, segment, price_zone) -----
-- Rates use units-weighted average: SUM(rate * units) / SUM(units).
-- base_price uses simple AVG so zero-unit bins still surface the configured price.
-- Actuals sourced from finalized only (single set, not per-scenario).
ours AS (
    SELECT
        bg.product_id::text             AS group_label,
        bg.channel_id,
        bg.segment_id,
        bg.price_zone_display        AS price_zone,
        MAX(bg.channel_name)         AS channel_name,
        MAX(bg.segment_name)         AS segment_name,
        STRING_AGG(DISTINCT bg.product_code, ', ' ORDER BY bg.product_code) AS product_codes,
        COUNT(DISTINCT bg.product_code) AS product_count,
        -- ====== CURRENT scenario ======
        SUM(cb.su)                                                           AS cur_su,
        SUM(cb.rev)                                                          AS cur_rev,
        SUM(cb.gm)                                                           AS cur_gm,
        COALESCE(SUM(cb.asp_w)    / NULLIF(SUM(cb.su), 0), 0)               AS cur_asp,
        COALESCE(SUM(cb.aum_w)    / NULLIF(SUM(cb.su), 0), 0)               AS cur_aum,
        COALESCE(SUM(cb.gm_pct_w) / NULLIF(SUM(cb.su), 0), 0)               AS cur_gm_pct,
        AVG(cb.bp)                                                          AS cur_bp,
        -- Current baseline
        SUM(cb.bl_su)                                                        AS cur_bl_su,
        SUM(cb.bl_rev)                                                       AS cur_bl_rev,
        SUM(cb.bl_gm)                                                        AS cur_bl_gm,
        COALESCE(SUM(cb.bl_asp_w)    / NULLIF(SUM(cb.bl_su), 0), 0)         AS cur_bl_asp,
        COALESCE(SUM(cb.bl_aum_w)    / NULLIF(SUM(cb.bl_su), 0), 0)         AS cur_bl_aum,
        COALESCE(SUM(cb.bl_gm_pct_w) / NULLIF(SUM(cb.bl_su), 0), 0)         AS cur_bl_gm_pct,
        -- ====== IA scenario ======
        SUM(ib.su)                                                           AS ia_su,
        SUM(ib.rev)                                                          AS ia_rev,
        SUM(ib.gm)                                                           AS ia_gm,
        COALESCE(SUM(ib.asp_w)    / NULLIF(SUM(ib.su), 0), 0)               AS ia_asp,
        COALESCE(SUM(ib.aum_w)    / NULLIF(SUM(ib.su), 0), 0)               AS ia_aum,
        COALESCE(SUM(ib.gm_pct_w) / NULLIF(SUM(ib.su), 0), 0)               AS ia_gm_pct,
        AVG(ib.bp)                                                          AS ia_bp,
        -- IA baseline
        SUM(ib.bl_su)                                                        AS ia_bl_su,
        SUM(ib.bl_rev)                                                       AS ia_bl_rev,
        SUM(ib.bl_gm)                                                        AS ia_bl_gm,
        COALESCE(SUM(ib.bl_asp_w)    / NULLIF(SUM(ib.bl_su), 0), 0)         AS ia_bl_asp,
        COALESCE(SUM(ib.bl_aum_w)    / NULLIF(SUM(ib.bl_su), 0), 0)         AS ia_bl_aum,
        COALESCE(SUM(ib.bl_gm_pct_w) / NULLIF(SUM(ib.bl_su), 0), 0)         AS ia_bl_gm_pct,
        -- ====== FINALIZED scenario ======
        SUM(fb.su)                                                           AS fin_su,
        SUM(fb.rev)                                                          AS fin_rev,
        SUM(fb.gm)                                                           AS fin_gm,
        COALESCE(SUM(fb.asp_w)    / NULLIF(SUM(fb.su), 0), 0)               AS fin_asp,
        COALESCE(SUM(fb.aum_w)    / NULLIF(SUM(fb.su), 0), 0)               AS fin_aum,
        COALESCE(SUM(fb.gm_pct_w) / NULLIF(SUM(fb.su), 0), 0)               AS fin_gm_pct,
        AVG(fb.bp)                                                          AS fin_bp,
        -- Finalized baseline
        SUM(fb.bl_su)                                                        AS fin_bl_su,
        SUM(fb.bl_rev)                                                       AS fin_bl_rev,
        SUM(fb.bl_gm)                                                        AS fin_bl_gm,
        COALESCE(SUM(fb.bl_asp_w)    / NULLIF(SUM(fb.bl_su), 0), 0)         AS fin_bl_asp,
        COALESCE(SUM(fb.bl_aum_w)    / NULLIF(SUM(fb.bl_su), 0), 0)         AS fin_bl_aum,
        COALESCE(SUM(fb.bl_gm_pct_w) / NULLIF(SUM(fb.bl_su), 0), 0)         AS fin_bl_gm_pct,
        -- ====== ACTUALS (from finalized, single set) ======
        SUM(fb.act_su)                                                       AS act_su,
        SUM(fb.act_rev)                                                      AS act_rev,
        SUM(fb.act_gm)                                                       AS act_gm,
        COALESCE(SUM(fb.act_asp_w)    / NULLIF(SUM(fb.act_su), 0), 0)       AS act_asp,
        COALESCE(SUM(fb.act_aum_w)    / NULLIF(SUM(fb.act_su), 0), 0)       AS act_aum,
        COALESCE(SUM(fb.act_gm_pct_w) / NULLIF(SUM(fb.act_su), 0), 0)       AS act_gm_pct
    FROM bin_groups bg
    LEFT JOIN current_per_bin cb ON cb.opt_level_bins=bg.opt_level_bins AND cb.product_id=bg.product_id AND cb.segment_id=bg.segment_id AND cb.channel_id=bg.channel_id
    LEFT JOIN ia_per_bin ib      ON ib.opt_level_bins=bg.opt_level_bins AND ib.product_id=bg.product_id AND ib.segment_id=bg.segment_id AND ib.channel_id=bg.channel_id
    LEFT JOIN fin_per_bin fb     ON fb.opt_level_bins=bg.opt_level_bins AND fb.product_id=bg.product_id AND fb.segment_id=bg.segment_id AND fb.channel_id=bg.channel_id
    GROUP BY bg.product_id::text, bg.channel_id, bg.segment_id, bg.price_zone_display
),

-- ----- Grid table read (extract jsonb to flat columns) -----
-- Baselines are jsonb keyed by current/ia_recommended/finalized.
-- Actuals are flat columns (single value per row, not per-scenario).
grid AS (
    SELECT
        g.product_id::text                                          AS group_label,
        g.channel_id,
        g.segment_id,
        g.price_zone_name                                           AS price_zone,
        -- ====== CURRENT scenario ======
        (g.sales_unit->>'current')::numeric                         AS cur_su,
        (g.revenue->>'current')::numeric                            AS cur_rev,
        (g.gross_margin->>'current')::numeric                       AS cur_gm,
        (g.asp->>'current')::numeric                                AS cur_asp,
        (g.aum->>'current')::numeric                                AS cur_aum,
        (g.gross_margin_percentage->>'current')::numeric            AS cur_gm_pct,
        (g.base_price->>'current')::numeric                         AS cur_bp,
        (g.baseline_sales_unit->>'current')::numeric                AS cur_bl_su,
        (g.baseline_revenue->>'current')::numeric                   AS cur_bl_rev,
        (g.baseline_gross_margin->>'current')::numeric              AS cur_bl_gm,
        (g.baseline_asp->>'current')::numeric                       AS cur_bl_asp,
        (g.baseline_aum->>'current')::numeric                       AS cur_bl_aum,
        (g.baseline_gross_margin_percentage->>'current')::numeric   AS cur_bl_gm_pct,
        -- ====== IA scenario ======
        (g.sales_unit->>'ia_recommended')::numeric                  AS ia_su,
        (g.revenue->>'ia_recommended')::numeric                     AS ia_rev,
        (g.gross_margin->>'ia_recommended')::numeric                AS ia_gm,
        (g.asp->>'ia_recommended')::numeric                         AS ia_asp,
        (g.aum->>'ia_recommended')::numeric                         AS ia_aum,
        (g.gross_margin_percentage->>'ia_recommended')::numeric     AS ia_gm_pct,
        (g.base_price->>'ia_recommended')::numeric                  AS ia_bp,
        (g.baseline_sales_unit->>'ia_recommended')::numeric         AS ia_bl_su,
        (g.baseline_revenue->>'ia_recommended')::numeric            AS ia_bl_rev,
        (g.baseline_gross_margin->>'ia_recommended')::numeric       AS ia_bl_gm,
        (g.baseline_asp->>'ia_recommended')::numeric                AS ia_bl_asp,
        (g.baseline_aum->>'ia_recommended')::numeric                AS ia_bl_aum,
        (g.baseline_gross_margin_percentage->>'ia_recommended')::numeric AS ia_bl_gm_pct,
        -- ====== FINALIZED scenario ======
        (g.sales_unit->>'finalized')::numeric                       AS fin_su,
        (g.revenue->>'finalized')::numeric                          AS fin_rev,
        (g.gross_margin->>'finalized')::numeric                     AS fin_gm,
        (g.asp->>'finalized')::numeric                              AS fin_asp,
        (g.aum->>'finalized')::numeric                              AS fin_aum,
        (g.gross_margin_percentage->>'finalized')::numeric          AS fin_gm_pct,
        (g.base_price->>'finalized')::numeric                       AS fin_bp,
        (g.baseline_sales_unit->>'finalized')::numeric              AS fin_bl_su,
        (g.baseline_revenue->>'finalized')::numeric                 AS fin_bl_rev,
        (g.baseline_gross_margin->>'finalized')::numeric            AS fin_bl_gm,
        (g.baseline_asp->>'finalized')::numeric                     AS fin_bl_asp,
        (g.baseline_aum->>'finalized')::numeric                     AS fin_bl_aum,
        (g.baseline_gross_margin_percentage->>'finalized')::numeric AS fin_bl_gm_pct,
        -- ====== ACTUALS (flat, single set) ======
        COALESCE(g.actuals_sales_units, 0)                          AS act_su,
        COALESCE(g.actuals_revenue, 0)                              AS act_rev,
        COALESCE(g.actuals_gross_margin_dollar, 0)                  AS act_gm,
        COALESCE(g.actuals_asp, 0)                                  AS act_asp,
        COALESCE(g.actuals_aum, 0)                                  AS act_aum,
        COALESCE(g.actuals_gross_margin_percentage, 0)              AS act_gm_pct
    FROM base_pricing.bp_strategy_price_reco_grid_data_product_pricezone g
    WHERE g.strategy_id = 212
)

SELECT
    -- Identity (prefer ours; fall back to grid for in-grid-only rows)
    COALESCE(o.group_label, g.group_label)   AS group_label,
    COALESCE(o.channel_id, g.channel_id)     AS channel_id,
    COALESCE(o.segment_id, g.segment_id)     AS segment_id,
    COALESCE(o.price_zone, g.price_zone)     AS price_zone,
    o.channel_name,
    o.segment_name,
    o.product_codes,
    o.product_count,

    -- ============ CURRENT scenario ============
    ROUND(o.cur_su::numeric, 2)   AS our_cur_sales,    ROUND(g.cur_su::numeric, 2)   AS grid_cur_sales,    CASE WHEN o.cur_su IS NULL AND g.cur_su IS NULL THEN 'MATCH' WHEN o.cur_su IS NULL THEN 'MISSING_OURS' WHEN g.cur_su IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.cur_su::numeric, 0) - COALESCE(g.cur_su::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS cur_sales_match,
    ROUND(o.cur_rev::numeric, 2)  AS our_cur_revenue,  ROUND(g.cur_rev::numeric, 2)  AS grid_cur_revenue,  CASE WHEN o.cur_rev IS NULL AND g.cur_rev IS NULL THEN 'MATCH' WHEN o.cur_rev IS NULL THEN 'MISSING_OURS' WHEN g.cur_rev IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.cur_rev::numeric, 0) - COALESCE(g.cur_rev::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END   AS cur_revenue_match,
    ROUND(o.cur_gm::numeric, 2)   AS our_cur_gm,       ROUND(g.cur_gm::numeric, 2)   AS grid_cur_gm,       CASE WHEN o.cur_gm IS NULL AND g.cur_gm IS NULL THEN 'MATCH' WHEN o.cur_gm IS NULL THEN 'MISSING_OURS' WHEN g.cur_gm IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.cur_gm::numeric, 0) - COALESCE(g.cur_gm::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS cur_gm_match,
    ROUND(o.cur_asp::numeric, 2)  AS our_cur_asp,      ROUND(g.cur_asp::numeric, 2)  AS grid_cur_asp,      CASE WHEN o.cur_asp IS NULL AND g.cur_asp IS NULL THEN 'MATCH' WHEN o.cur_asp IS NULL THEN 'MISSING_OURS' WHEN g.cur_asp IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.cur_asp::numeric, 0) - COALESCE(g.cur_asp::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END   AS cur_asp_match,
    ROUND(o.cur_aum::numeric, 2)  AS our_cur_aum,      ROUND(g.cur_aum::numeric, 2)  AS grid_cur_aum,      CASE WHEN o.cur_aum IS NULL AND g.cur_aum IS NULL THEN 'MATCH' WHEN o.cur_aum IS NULL THEN 'MISSING_OURS' WHEN g.cur_aum IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.cur_aum::numeric, 0) - COALESCE(g.cur_aum::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END   AS cur_aum_match,
    ROUND(o.cur_gm_pct::numeric,2)AS our_cur_gm_pct,   ROUND(g.cur_gm_pct::numeric,2)AS grid_cur_gm_pct,   CASE WHEN o.cur_gm_pct IS NULL AND g.cur_gm_pct IS NULL THEN 'MATCH' WHEN o.cur_gm_pct IS NULL THEN 'MISSING_OURS' WHEN g.cur_gm_pct IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.cur_gm_pct::numeric, 0) - COALESCE(g.cur_gm_pct::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS cur_gm_pct_match,
    ROUND(o.cur_bp::numeric, 2)   AS our_cur_bp,       ROUND(g.cur_bp::numeric, 2)   AS grid_cur_bp,       CASE WHEN o.cur_bp IS NULL AND g.cur_bp IS NULL THEN 'MATCH' WHEN o.cur_bp IS NULL THEN 'MISSING_OURS' WHEN g.cur_bp IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.cur_bp::numeric, 0) - COALESCE(g.cur_bp::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS cur_bp_match,
    -- Current baseline
    ROUND(o.cur_bl_su::numeric, 2)   AS our_cur_bl_sales,    ROUND(g.cur_bl_su::numeric, 2)   AS grid_cur_bl_sales,    CASE WHEN o.cur_bl_su IS NULL AND g.cur_bl_su IS NULL THEN 'MATCH' WHEN o.cur_bl_su IS NULL THEN 'MISSING_OURS' WHEN g.cur_bl_su IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.cur_bl_su::numeric, 0) - COALESCE(g.cur_bl_su::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END       AS cur_bl_sales_match,
    ROUND(o.cur_bl_rev::numeric, 2)  AS our_cur_bl_revenue,  ROUND(g.cur_bl_rev::numeric, 2)  AS grid_cur_bl_revenue,  CASE WHEN o.cur_bl_rev IS NULL AND g.cur_bl_rev IS NULL THEN 'MATCH' WHEN o.cur_bl_rev IS NULL THEN 'MISSING_OURS' WHEN g.cur_bl_rev IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.cur_bl_rev::numeric, 0) - COALESCE(g.cur_bl_rev::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS cur_bl_revenue_match,
    ROUND(o.cur_bl_gm::numeric, 2)   AS our_cur_bl_gm,       ROUND(g.cur_bl_gm::numeric, 2)   AS grid_cur_bl_gm,       CASE WHEN o.cur_bl_gm IS NULL AND g.cur_bl_gm IS NULL THEN 'MATCH' WHEN o.cur_bl_gm IS NULL THEN 'MISSING_OURS' WHEN g.cur_bl_gm IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.cur_bl_gm::numeric, 0) - COALESCE(g.cur_bl_gm::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END       AS cur_bl_gm_match,
    ROUND(o.cur_bl_asp::numeric, 2)  AS our_cur_bl_asp,      ROUND(g.cur_bl_asp::numeric, 2)  AS grid_cur_bl_asp,      CASE WHEN o.cur_bl_asp IS NULL AND g.cur_bl_asp IS NULL THEN 'MATCH' WHEN o.cur_bl_asp IS NULL THEN 'MISSING_OURS' WHEN g.cur_bl_asp IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.cur_bl_asp::numeric, 0) - COALESCE(g.cur_bl_asp::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS cur_bl_asp_match,
    ROUND(o.cur_bl_aum::numeric, 2)  AS our_cur_bl_aum,      ROUND(g.cur_bl_aum::numeric, 2)  AS grid_cur_bl_aum,      CASE WHEN o.cur_bl_aum IS NULL AND g.cur_bl_aum IS NULL THEN 'MATCH' WHEN o.cur_bl_aum IS NULL THEN 'MISSING_OURS' WHEN g.cur_bl_aum IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.cur_bl_aum::numeric, 0) - COALESCE(g.cur_bl_aum::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS cur_bl_aum_match,
    ROUND(o.cur_bl_gm_pct::numeric,2)AS our_cur_bl_gm_pct,   ROUND(g.cur_bl_gm_pct::numeric,2)AS grid_cur_bl_gm_pct,   CASE WHEN o.cur_bl_gm_pct IS NULL AND g.cur_bl_gm_pct IS NULL THEN 'MATCH' WHEN o.cur_bl_gm_pct IS NULL THEN 'MISSING_OURS' WHEN g.cur_bl_gm_pct IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.cur_bl_gm_pct::numeric, 0) - COALESCE(g.cur_bl_gm_pct::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS cur_bl_gm_pct_match,

    -- ============ IA scenario ============
    ROUND(o.ia_su::numeric, 2)    AS our_ia_sales,     ROUND(g.ia_su::numeric, 2)    AS grid_ia_sales,     CASE WHEN o.ia_su IS NULL AND g.ia_su IS NULL THEN 'MATCH' WHEN o.ia_su IS NULL THEN 'MISSING_OURS' WHEN g.ia_su IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.ia_su::numeric, 0) - COALESCE(g.ia_su::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END       AS ia_sales_match,
    ROUND(o.ia_rev::numeric, 2)   AS our_ia_revenue,   ROUND(g.ia_rev::numeric, 2)   AS grid_ia_revenue,   CASE WHEN o.ia_rev IS NULL AND g.ia_rev IS NULL THEN 'MATCH' WHEN o.ia_rev IS NULL THEN 'MISSING_OURS' WHEN g.ia_rev IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.ia_rev::numeric, 0) - COALESCE(g.ia_rev::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS ia_revenue_match,
    ROUND(o.ia_gm::numeric, 2)    AS our_ia_gm,        ROUND(g.ia_gm::numeric, 2)    AS grid_ia_gm,        CASE WHEN o.ia_gm IS NULL AND g.ia_gm IS NULL THEN 'MATCH' WHEN o.ia_gm IS NULL THEN 'MISSING_OURS' WHEN g.ia_gm IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.ia_gm::numeric, 0) - COALESCE(g.ia_gm::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END       AS ia_gm_match,
    ROUND(o.ia_asp::numeric, 2)   AS our_ia_asp,       ROUND(g.ia_asp::numeric, 2)   AS grid_ia_asp,       CASE WHEN o.ia_asp IS NULL AND g.ia_asp IS NULL THEN 'MATCH' WHEN o.ia_asp IS NULL THEN 'MISSING_OURS' WHEN g.ia_asp IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.ia_asp::numeric, 0) - COALESCE(g.ia_asp::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS ia_asp_match,
    ROUND(o.ia_aum::numeric, 2)   AS our_ia_aum,       ROUND(g.ia_aum::numeric, 2)   AS grid_ia_aum,       CASE WHEN o.ia_aum IS NULL AND g.ia_aum IS NULL THEN 'MATCH' WHEN o.ia_aum IS NULL THEN 'MISSING_OURS' WHEN g.ia_aum IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.ia_aum::numeric, 0) - COALESCE(g.ia_aum::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS ia_aum_match,
    ROUND(o.ia_gm_pct::numeric,2) AS our_ia_gm_pct,    ROUND(g.ia_gm_pct::numeric,2) AS grid_ia_gm_pct,    CASE WHEN o.ia_gm_pct IS NULL AND g.ia_gm_pct IS NULL THEN 'MATCH' WHEN o.ia_gm_pct IS NULL THEN 'MISSING_OURS' WHEN g.ia_gm_pct IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.ia_gm_pct::numeric, 0) - COALESCE(g.ia_gm_pct::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS ia_gm_pct_match,
    ROUND(o.ia_bp::numeric, 2)    AS our_ia_bp,        ROUND(g.ia_bp::numeric, 2)    AS grid_ia_bp,        CASE WHEN o.ia_bp IS NULL AND g.ia_bp IS NULL THEN 'MATCH' WHEN o.ia_bp IS NULL THEN 'MISSING_OURS' WHEN g.ia_bp IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.ia_bp::numeric, 0) - COALESCE(g.ia_bp::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END       AS ia_bp_match,
    -- IA baseline
    ROUND(o.ia_bl_su::numeric, 2)   AS our_ia_bl_sales,    ROUND(g.ia_bl_su::numeric, 2)   AS grid_ia_bl_sales,    CASE WHEN o.ia_bl_su IS NULL AND g.ia_bl_su IS NULL THEN 'MATCH' WHEN o.ia_bl_su IS NULL THEN 'MISSING_OURS' WHEN g.ia_bl_su IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.ia_bl_su::numeric, 0) - COALESCE(g.ia_bl_su::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END       AS ia_bl_sales_match,
    ROUND(o.ia_bl_rev::numeric, 2)  AS our_ia_bl_revenue,  ROUND(g.ia_bl_rev::numeric, 2)  AS grid_ia_bl_revenue,  CASE WHEN o.ia_bl_rev IS NULL AND g.ia_bl_rev IS NULL THEN 'MATCH' WHEN o.ia_bl_rev IS NULL THEN 'MISSING_OURS' WHEN g.ia_bl_rev IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.ia_bl_rev::numeric, 0) - COALESCE(g.ia_bl_rev::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS ia_bl_revenue_match,
    ROUND(o.ia_bl_gm::numeric, 2)   AS our_ia_bl_gm,       ROUND(g.ia_bl_gm::numeric, 2)   AS grid_ia_bl_gm,       CASE WHEN o.ia_bl_gm IS NULL AND g.ia_bl_gm IS NULL THEN 'MATCH' WHEN o.ia_bl_gm IS NULL THEN 'MISSING_OURS' WHEN g.ia_bl_gm IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.ia_bl_gm::numeric, 0) - COALESCE(g.ia_bl_gm::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END       AS ia_bl_gm_match,
    ROUND(o.ia_bl_asp::numeric, 2)  AS our_ia_bl_asp,      ROUND(g.ia_bl_asp::numeric, 2)  AS grid_ia_bl_asp,      CASE WHEN o.ia_bl_asp IS NULL AND g.ia_bl_asp IS NULL THEN 'MATCH' WHEN o.ia_bl_asp IS NULL THEN 'MISSING_OURS' WHEN g.ia_bl_asp IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.ia_bl_asp::numeric, 0) - COALESCE(g.ia_bl_asp::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS ia_bl_asp_match,
    ROUND(o.ia_bl_aum::numeric, 2)  AS our_ia_bl_aum,      ROUND(g.ia_bl_aum::numeric, 2)  AS grid_ia_bl_aum,      CASE WHEN o.ia_bl_aum IS NULL AND g.ia_bl_aum IS NULL THEN 'MATCH' WHEN o.ia_bl_aum IS NULL THEN 'MISSING_OURS' WHEN g.ia_bl_aum IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.ia_bl_aum::numeric, 0) - COALESCE(g.ia_bl_aum::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS ia_bl_aum_match,
    ROUND(o.ia_bl_gm_pct::numeric,2)AS our_ia_bl_gm_pct,   ROUND(g.ia_bl_gm_pct::numeric,2)AS grid_ia_bl_gm_pct,   CASE WHEN o.ia_bl_gm_pct IS NULL AND g.ia_bl_gm_pct IS NULL THEN 'MATCH' WHEN o.ia_bl_gm_pct IS NULL THEN 'MISSING_OURS' WHEN g.ia_bl_gm_pct IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.ia_bl_gm_pct::numeric, 0) - COALESCE(g.ia_bl_gm_pct::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS ia_bl_gm_pct_match,

    -- ============ FINALIZED scenario ============
    ROUND(o.fin_su::numeric, 2)   AS our_fin_sales,    ROUND(g.fin_su::numeric, 2)   AS grid_fin_sales,    CASE WHEN o.fin_su IS NULL AND g.fin_su IS NULL THEN 'MATCH' WHEN o.fin_su IS NULL THEN 'MISSING_OURS' WHEN g.fin_su IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.fin_su::numeric, 0) - COALESCE(g.fin_su::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS fin_sales_match,
    ROUND(o.fin_rev::numeric, 2)  AS our_fin_revenue,  ROUND(g.fin_rev::numeric, 2)  AS grid_fin_revenue,  CASE WHEN o.fin_rev IS NULL AND g.fin_rev IS NULL THEN 'MATCH' WHEN o.fin_rev IS NULL THEN 'MISSING_OURS' WHEN g.fin_rev IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.fin_rev::numeric, 0) - COALESCE(g.fin_rev::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END   AS fin_revenue_match,
    ROUND(o.fin_gm::numeric, 2)   AS our_fin_gm,       ROUND(g.fin_gm::numeric, 2)   AS grid_fin_gm,       CASE WHEN o.fin_gm IS NULL AND g.fin_gm IS NULL THEN 'MATCH' WHEN o.fin_gm IS NULL THEN 'MISSING_OURS' WHEN g.fin_gm IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.fin_gm::numeric, 0) - COALESCE(g.fin_gm::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS fin_gm_match,
    ROUND(o.fin_asp::numeric, 2)  AS our_fin_asp,      ROUND(g.fin_asp::numeric, 2)  AS grid_fin_asp,      CASE WHEN o.fin_asp IS NULL AND g.fin_asp IS NULL THEN 'MATCH' WHEN o.fin_asp IS NULL THEN 'MISSING_OURS' WHEN g.fin_asp IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.fin_asp::numeric, 0) - COALESCE(g.fin_asp::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END   AS fin_asp_match,
    ROUND(o.fin_aum::numeric, 2)  AS our_fin_aum,      ROUND(g.fin_aum::numeric, 2)  AS grid_fin_aum,      CASE WHEN o.fin_aum IS NULL AND g.fin_aum IS NULL THEN 'MATCH' WHEN o.fin_aum IS NULL THEN 'MISSING_OURS' WHEN g.fin_aum IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.fin_aum::numeric, 0) - COALESCE(g.fin_aum::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END   AS fin_aum_match,
    ROUND(o.fin_gm_pct::numeric,2)AS our_fin_gm_pct,   ROUND(g.fin_gm_pct::numeric,2)AS grid_fin_gm_pct,   CASE WHEN o.fin_gm_pct IS NULL AND g.fin_gm_pct IS NULL THEN 'MATCH' WHEN o.fin_gm_pct IS NULL THEN 'MISSING_OURS' WHEN g.fin_gm_pct IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.fin_gm_pct::numeric, 0) - COALESCE(g.fin_gm_pct::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS fin_gm_pct_match,
    ROUND(o.fin_bp::numeric, 2)   AS our_fin_bp,       ROUND(g.fin_bp::numeric, 2)   AS grid_fin_bp,       CASE WHEN o.fin_bp IS NULL AND g.fin_bp IS NULL THEN 'MATCH' WHEN o.fin_bp IS NULL THEN 'MISSING_OURS' WHEN g.fin_bp IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.fin_bp::numeric, 0) - COALESCE(g.fin_bp::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS fin_bp_match,
    -- Finalized baseline
    ROUND(o.fin_bl_su::numeric, 2)   AS our_fin_bl_sales,    ROUND(g.fin_bl_su::numeric, 2)   AS grid_fin_bl_sales,    CASE WHEN o.fin_bl_su IS NULL AND g.fin_bl_su IS NULL THEN 'MATCH' WHEN o.fin_bl_su IS NULL THEN 'MISSING_OURS' WHEN g.fin_bl_su IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.fin_bl_su::numeric, 0) - COALESCE(g.fin_bl_su::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END       AS fin_bl_sales_match,
    ROUND(o.fin_bl_rev::numeric, 2)  AS our_fin_bl_revenue,  ROUND(g.fin_bl_rev::numeric, 2)  AS grid_fin_bl_revenue,  CASE WHEN o.fin_bl_rev IS NULL AND g.fin_bl_rev IS NULL THEN 'MATCH' WHEN o.fin_bl_rev IS NULL THEN 'MISSING_OURS' WHEN g.fin_bl_rev IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.fin_bl_rev::numeric, 0) - COALESCE(g.fin_bl_rev::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS fin_bl_revenue_match,
    ROUND(o.fin_bl_gm::numeric, 2)   AS our_fin_bl_gm,       ROUND(g.fin_bl_gm::numeric, 2)   AS grid_fin_bl_gm,       CASE WHEN o.fin_bl_gm IS NULL AND g.fin_bl_gm IS NULL THEN 'MATCH' WHEN o.fin_bl_gm IS NULL THEN 'MISSING_OURS' WHEN g.fin_bl_gm IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.fin_bl_gm::numeric, 0) - COALESCE(g.fin_bl_gm::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END       AS fin_bl_gm_match,
    ROUND(o.fin_bl_asp::numeric, 2)  AS our_fin_bl_asp,      ROUND(g.fin_bl_asp::numeric, 2)  AS grid_fin_bl_asp,      CASE WHEN o.fin_bl_asp IS NULL AND g.fin_bl_asp IS NULL THEN 'MATCH' WHEN o.fin_bl_asp IS NULL THEN 'MISSING_OURS' WHEN g.fin_bl_asp IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.fin_bl_asp::numeric, 0) - COALESCE(g.fin_bl_asp::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS fin_bl_asp_match,
    ROUND(o.fin_bl_aum::numeric, 2)  AS our_fin_bl_aum,      ROUND(g.fin_bl_aum::numeric, 2)  AS grid_fin_bl_aum,      CASE WHEN o.fin_bl_aum IS NULL AND g.fin_bl_aum IS NULL THEN 'MATCH' WHEN o.fin_bl_aum IS NULL THEN 'MISSING_OURS' WHEN g.fin_bl_aum IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.fin_bl_aum::numeric, 0) - COALESCE(g.fin_bl_aum::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END     AS fin_bl_aum_match,
    ROUND(o.fin_bl_gm_pct::numeric,2)AS our_fin_bl_gm_pct,   ROUND(g.fin_bl_gm_pct::numeric,2)AS grid_fin_bl_gm_pct,   CASE WHEN o.fin_bl_gm_pct IS NULL AND g.fin_bl_gm_pct IS NULL THEN 'MATCH' WHEN o.fin_bl_gm_pct IS NULL THEN 'MISSING_OURS' WHEN g.fin_bl_gm_pct IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.fin_bl_gm_pct::numeric, 0) - COALESCE(g.fin_bl_gm_pct::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS fin_bl_gm_pct_match,

    -- ============ ACTUALS (from reco_finalized vs grid flat columns; single set) ============
    ROUND(o.act_su::numeric, 2)     AS our_act_sales,    ROUND(g.act_su::numeric, 2)     AS grid_act_sales,    CASE WHEN o.act_su IS NULL AND g.act_su IS NULL THEN 'MATCH' WHEN o.act_su IS NULL THEN 'MISSING_OURS' WHEN g.act_su IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.act_su::numeric, 0) - COALESCE(g.act_su::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END         AS act_sales_match,
    ROUND(o.act_rev::numeric, 2)    AS our_act_revenue,  ROUND(g.act_rev::numeric, 2)    AS grid_act_revenue,  CASE WHEN o.act_rev IS NULL AND g.act_rev IS NULL THEN 'MATCH' WHEN o.act_rev IS NULL THEN 'MISSING_OURS' WHEN g.act_rev IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.act_rev::numeric, 0) - COALESCE(g.act_rev::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END       AS act_revenue_match,
    ROUND(o.act_gm::numeric, 2)     AS our_act_gm,       ROUND(g.act_gm::numeric, 2)     AS grid_act_gm,       CASE WHEN o.act_gm IS NULL AND g.act_gm IS NULL THEN 'MATCH' WHEN o.act_gm IS NULL THEN 'MISSING_OURS' WHEN g.act_gm IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.act_gm::numeric, 0) - COALESCE(g.act_gm::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END         AS act_gm_match,
    ROUND(o.act_asp::numeric, 2)    AS our_act_asp,      ROUND(g.act_asp::numeric, 2)    AS grid_act_asp,      CASE WHEN o.act_asp IS NULL AND g.act_asp IS NULL THEN 'MATCH' WHEN o.act_asp IS NULL THEN 'MISSING_OURS' WHEN g.act_asp IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.act_asp::numeric, 0) - COALESCE(g.act_asp::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END       AS act_asp_match,
    ROUND(o.act_aum::numeric, 2)    AS our_act_aum,      ROUND(g.act_aum::numeric, 2)    AS grid_act_aum,      CASE WHEN o.act_aum IS NULL AND g.act_aum IS NULL THEN 'MATCH' WHEN o.act_aum IS NULL THEN 'MISSING_OURS' WHEN g.act_aum IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.act_aum::numeric, 0) - COALESCE(g.act_aum::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END       AS act_aum_match,
    ROUND(o.act_gm_pct::numeric, 2) AS our_act_gm_pct,   ROUND(g.act_gm_pct::numeric, 2) AS grid_act_gm_pct,   CASE WHEN o.act_gm_pct IS NULL AND g.act_gm_pct IS NULL THEN 'MATCH' WHEN o.act_gm_pct IS NULL THEN 'MISSING_OURS' WHEN g.act_gm_pct IS NULL THEN 'MISSING_GRID' WHEN ABS(COALESCE(o.act_gm_pct::numeric, 0) - COALESCE(g.act_gm_pct::numeric, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS act_gm_pct_match,

    -- Per-row overall: 'ROW_MATCH' iff every numeric metric matches; otherwise lists the failing metrics
    CASE
        WHEN o.group_label IS NULL THEN 'MISSING_OURS'
        WHEN g.group_label IS NULL THEN 'MISSING_GRID'
        ELSE 'PRESENT'
    END AS row_presence

FROM ours o
FULL OUTER JOIN grid g
    ON g.group_label = o.group_label
   AND g.channel_id  = o.channel_id
   AND g.segment_id  = o.segment_id
   AND g.price_zone  = o.price_zone
ORDER BY COALESCE(o.group_label, g.group_label),
         COALESCE(o.channel_id, g.channel_id),
         COALESCE(o.segment_id, g.segment_id),
         COALESCE(o.price_zone, g.price_zone)
