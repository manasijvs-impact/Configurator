"""
Monthly Detailed View validator.

Emits the "Detailed View" rows the tool's Projection screen shows under
Product - Price Zone or Line Group - Price Zone groupings. One row per
(group_key, forecast_type). Frontend pivots into the wide column layout.

Group_key:
  - product view    : (product_code, channel_id, segment_id, price_zone_display)
  - line_group view : (COALESCE(line_group, product_code), channel_id, segment_id, price_zone_display)

price_zone_display rule (matches bin-level validators):
  - zone_exception=true OR effective_zone IS NULL  -> store_code
  - otherwise (including price_lock=true)          -> effective_zone

So same-zone bins with different price_lock flags collapse into one group at this view
grain. Only zone_exception (or absent zone) splits a group out by store.

For each (group_key, forecast_type) we emit:
  - 6 metrics x 4 scenarios (current / ia / finalized + actuals scenario-agnostic)
  - 3 base_prices (current / ia / finalized) — units-weighted across the bins in the group

Visibility floor + visible forecast types come from the same chain used by
monthly_summary_cards_validator, so Detailed View shows exactly the same set of
forecast types the Summary tab shows.
"""

from app.core.database import db
from typing import Dict, List, Optional


VIEW_BY_PRODUCT = "product"
VIEW_BY_LINE_GROUP = "line_group"


class MonthlyDetailedViewValidator:
    def __init__(self):
        self._config_cache = None

    @property
    def schema(self) -> str:
        return db.db_schema

    def is_connected(self) -> bool:
        return db.is_connected()

    def _execute_query(self, query: str, params: tuple = None) -> list:
        if not db.is_connected():
            raise Exception("Not connected to database. Please connect first.")
        return db.execute_query(query, params)

    def get_config(self) -> Dict:
        if self._config_cache:
            return self._config_cache

        channel_query = f"""
            SELECT 's' || COALESCE(
                (SELECT store_hierarchy_level_id::text
                 FROM {self.schema}.bp_store_hierarchy_level
                 WHERE LOWER(store_hierarchy_level_label) = 'channel'
                 LIMIT 1),
                '0'
            ) || '_cid' AS channel_col
        """
        channel_result = self._execute_query(channel_query)
        channel_column = channel_result[0]["channel_col"] if channel_result else "s0_cid"
        channel_name_column = channel_column.replace("_cid", "_name")

        # Discover the price_lock and zone_exception attribute columns dynamically
        # (same logic the other validators use).
        def attr_lookup(name: str, fallback: str) -> str:
            res = self._execute_query(f"""
                SELECT database_column FROM {self.schema}.bp_product_store_attributes_metadata
                WHERE attribute_name = '{name}' LIMIT 1
            """)
            return res[0]["database_column"] if res else fallback

        self._config_cache = {
            "channel_column": channel_column,
            "channel_name_column": channel_name_column,
            "price_lock_column": attr_lookup("price_lock", "attribute_6"),
            "zone_exception_column": attr_lookup("zone_exception", "attribute_7"),
        }
        return self._config_cache

    def clear_cache(self):
        self._config_cache = None

    def _channel_filter(self, alias: str, channel_ids: Optional[List[int]]) -> str:
        if channel_ids and len(channel_ids) > 0:
            return f" AND {alias}.channel_id IN ({','.join(map(str, channel_ids))})"
        return ""

    def get_query(
        self,
        strategy_id: int,
        view_by: str = VIEW_BY_PRODUCT,
        channel_ids: Optional[List[int]] = None,
    ) -> str:
        if view_by not in (VIEW_BY_PRODUCT, VIEW_BY_LINE_GROUP):
            raise ValueError(f"view_by must be '{VIEW_BY_PRODUCT}' or '{VIEW_BY_LINE_GROUP}'")

        config = self.get_config()
        channel_col = config["channel_column"]
        channel_name_col = config["channel_name_column"]
        price_lock_col = config["price_lock_column"]
        zone_exception_col = config["zone_exception_column"]

        mf_channel = self._channel_filter("mf", channel_ids)
        mfa_channel = self._channel_filter("mfa", channel_ids)

        # group_label_expr is the single grouping key per row. All other identity columns
        # become aggregates (STRING_AGG / COUNT / MAX) so the SQL shape is uniform across
        # the two views — only this expression differs.
        #   Product view    -> bg.product_code (one product per group)
        #   Line Group view -> COALESCE(bg.line_group, bg.product_code)
        #                       (multiple products can collapse into one group)
        if view_by == VIEW_BY_LINE_GROUP:
            group_label_expr = "COALESCE(bg.line_group, bg.product_code)"
        else:
            group_label_expr = "bg.product_code"

        query = f"""
-- Monthly Detailed View Query
-- Strategy ID: {strategy_id}
-- View By    : {view_by}
-- Channel Filter: {channel_ids if channel_ids else 'All channels'}
-- Grain: one row per (group_label, channel, segment, price_zone, forecast_type).
-- Visibility floor + active forecast types pulled from bp_forecast_cal_config
-- (same chain monthly_summary_cards_validator uses).

WITH strategy_params AS (
    SELECT strategy_id, start_date, end_date
    FROM {self.schema}.bp_strategy_master
    WHERE strategy_id = {strategy_id}
),

-- ----- Active-FY resolution -----
strategy_start_fy AS (
    SELECT fdm.fiscal_year, fdm.fiscal_fd_year, fdm.fiscal_ld_year
    FROM global.tb_fiscal_date_mapping fdm CROSS JOIN strategy_params sp
    WHERE fdm.date_id = sp.start_date LIMIT 1
),
strategy_end_fy AS (
    SELECT fdm.fiscal_year, fdm.fiscal_fd_year, fdm.fiscal_ld_year
    FROM global.tb_fiscal_date_mapping fdm CROSS JOIN strategy_params sp
    WHERE fdm.date_id = sp.end_date LIMIT 1
),
current_date_fy AS (
    SELECT fdm.fiscal_year, fdm.fiscal_fd_year, fdm.fiscal_ld_year
    FROM global.tb_fiscal_date_mapping fdm WHERE fdm.date_id = CURRENT_DATE LIMIT 1
),
fiscal_info AS (
    SELECT
        CASE WHEN ssf.fiscal_year = sef.fiscal_year THEN ssf.fiscal_year    ELSE cdf.fiscal_year    END AS fiscal_year,
        CASE WHEN ssf.fiscal_year = sef.fiscal_year THEN ssf.fiscal_fd_year ELSE cdf.fiscal_fd_year END AS fiscal_fd_year,
        CASE WHEN ssf.fiscal_year = sef.fiscal_year THEN ssf.fiscal_ld_year ELSE cdf.fiscal_ld_year END AS fiscal_ld_year
    FROM strategy_start_fy ssf CROSS JOIN strategy_end_fy sef CROSS JOIN current_date_fy cdf
),

quarter_dates AS (
    SELECT fdm.fiscal_quarter,
           MIN(fdm.fiscal_fd_qtr) AS quarter_start,
           MAX(fdm.fiscal_ld_qtr) AS quarter_end
    FROM global.tb_fiscal_date_mapping fdm CROSS JOIN fiscal_info fi
    WHERE fdm.fiscal_year = fi.fiscal_year
    GROUP BY fdm.fiscal_quarter
),

forecast_configs_resolved AS (
    SELECT
        fc.forecast_type, fc.label, fc.display_order,
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
            WHEN 'twelve_months' THEN (
                SELECT fdm2.fiscal_ld_month FROM global.tb_fiscal_date_mapping fdm2
                WHERE fdm2.date_id = (sp.start_date + INTERVAL '12 months')::date LIMIT 1
            )
            WHEN 'quarter_end' THEN (
                SELECT MAX(qd.quarter_end) FROM quarter_dates qd
                WHERE qd.fiscal_quarter = ANY(fc.cumulative_quarters)
            )
            ELSE fi.fiscal_ld_year
        END AS resolved_end
    FROM {self.schema}.bp_forecast_cal_config fc
    CROSS JOIN fiscal_info fi CROSS JOIN strategy_params sp
    WHERE fc.is_active = true AND fc.forecast_type != 'CURRENT_STRATEGY_PERIOD'
),

visibility_floor AS (
    SELECT COALESCE(
        (SELECT resolved_start FROM forecast_configs_resolved
         WHERE forecast_type = 'FISCAL_YEAR' LIMIT 1),
        (SELECT fi.fiscal_fd_year FROM fiscal_info fi)
    ) AS floor_date
),

forecast_configs_visible AS (
    SELECT fcr.* FROM forecast_configs_resolved fcr
    CROSS JOIN visibility_floor vf
    WHERE fcr.resolved_start IS NOT NULL
      AND fcr.resolved_end   IS NOT NULL
      AND fcr.resolved_end  >= vf.floor_date
),

month_bounds AS (
    SELECT DISTINCT fiscal_year, fiscal_month, fiscal_fd_month, fiscal_ld_month
    FROM global.tb_fiscal_date_mapping
),

-- (forecast_type, fiscal_year, fiscal_month) pairs in scope, clamped to the floor.
calendar AS (
    SELECT
        fcv.forecast_type,
        fcv.label,
        fcv.display_order,
        mb.fiscal_year,
        mb.fiscal_month
    FROM forecast_configs_visible fcv
    CROSS JOIN visibility_floor vf
    JOIN month_bounds mb
      ON mb.fiscal_fd_month >= GREATEST(fcv.resolved_start, vf.floor_date)
     AND mb.fiscal_ld_month <= fcv.resolved_end
),

-- ----- Bins in the strategy, with detailed-view group labels -----
strategy_products AS (
    SELECT DISTINCT product_id, store_id, segment_id
    FROM {self.schema}.bp_strategy_products_stores
    WHERE strategy_id = {strategy_id}
),

bins_mapping AS (
    SELECT
        v.product_id, v.store_id, v.segment_id,
        v.effective_price_zone,
        v.{price_lock_col}::boolean AS price_lock_val,
        v.{zone_exception_col}::boolean AS zone_exception_val,
        sm.{channel_col} AS channel_id,
        v.product_id::text || '_' ||
        CASE WHEN v.{price_lock_col}::boolean OR v.{zone_exception_col}::boolean OR v.effective_price_zone IS NULL
            THEN v.store_id::text || '_' || v.segment_id::text
            ELSE v.effective_price_zone || '_' || v.segment_id::text
        END AS opt_level_bins,
        -- View-level price_zone display: only zone_exception or null zone triggers store_code.
        -- price_lock alone keeps the row inside its zone group.
        CASE WHEN v.{zone_exception_col}::boolean OR v.effective_price_zone IS NULL
            THEN sm.store_code
            ELSE v.price_zone
        END AS price_zone_display
    FROM {self.schema}.bp_product_store_attributes_mapping_v4 v
    INNER JOIN strategy_products sp
        ON v.product_id = sp.product_id AND v.store_id = sp.store_id AND v.segment_id = sp.segment_id
    INNER JOIN {self.schema}.bp_store_master sm ON v.store_id = sm.store_id
),

-- Group-level identity per bin. DISTINCT ON the bin key collapses to ONE row per bin
-- even when a zone bin spans many stores. Without this, the join to bp_monthly_forecast
-- (which has one row per bin × month) would multiply by (stores in zone) and SUM(...)
-- would inflate metrics by the same factor. We still expose a representative store_id /
-- store_code so store-scoped rows (zone_exception or null zone) carry the right label.
bin_groups AS (
    SELECT DISTINCT ON (bm.opt_level_bins, bm.product_id, bm.segment_id, bm.channel_id)
        bm.opt_level_bins,
        bm.product_id,
        bm.store_id,
        bm.segment_id,
        bm.channel_id,
        bm.price_zone_display,
        pm.product_code,
        pm.product_name,
        (
            SELECT attr->'attribute_value'->>'current'
            FROM jsonb_array_elements(pam.attributes) attr
            WHERE attr->>'attribute_name' = 'line_group'
            LIMIT 1
        ) AS line_group,
        sm.{channel_name_col} AS channel_name,
        COALESCE(csm.segment_name, 'Segment ' || bm.segment_id::text) AS segment_name
    FROM bins_mapping bm
    INNER JOIN {self.schema}.bp_product_master pm ON bm.product_id = pm.product_id
    INNER JOIN {self.schema}.bp_store_master sm   ON bm.store_id   = sm.store_id
    LEFT JOIN {self.schema}.bp_customer_segment_master csm ON bm.segment_id = csm.segment_id
    LEFT JOIN {self.schema}.bp_product_attributes_mapping pam ON pam.product_id = bm.product_id
    ORDER BY bm.opt_level_bins, bm.product_id, bm.segment_id, bm.channel_id, bm.store_id
),

-- ----- Aggregate bp_monthly_forecast rows up to bin-level metrics per (fiscal_year, fiscal_month) -----
-- bp_monthly_forecast is keyed by (strategy_id, opt_level_bins, product_id, segment_id, channel_id, fiscal_year, fiscal_month)
-- so we just SUM directly. Then we'll join to bin_groups for the identity columns.
forecast_per_bin_month AS (
    SELECT
        mf.opt_level_bins,
        mf.product_id,
        mf.segment_id,
        mf.channel_id,
        mf.fiscal_year,
        mf.fiscal_month,
        -- sums
        COALESCE(mf.sales_units, 0)              AS cur_su,
        COALESCE(mf.revenue, 0)                  AS cur_rev,
        COALESCE(mf.gross_margin_dollar, 0)      AS cur_gm,
        COALESCE(mf.ia_sales_units, 0)           AS ia_su,
        COALESCE(mf.ia_revenue, 0)               AS ia_rev,
        COALESCE(mf.ia_gross_margin_dollar, 0)   AS ia_gm,
        COALESCE(mf.finalized_sales_units, 0)    AS fin_su,
        COALESCE(mf.finalized_revenue, 0)        AS fin_rev,
        COALESCE(mf.finalized_gross_margin_dollar, 0) AS fin_gm,
        -- weighted rate sums (rate × units) so we can roll up to weighted-avg rates
        COALESCE(mf.asp * mf.sales_units, 0)                                  AS cur_asp_w,
        COALESCE(mf.aum * mf.sales_units, 0)                                  AS cur_aum_w,
        COALESCE(mf.gross_margin_percentage * mf.sales_units, 0)              AS cur_gm_pct_w,
        COALESCE(mf.ia_asp * mf.ia_sales_units, 0)                            AS ia_asp_w,
        COALESCE(mf.ia_aum * mf.ia_sales_units, 0)                            AS ia_aum_w,
        COALESCE(mf.ia_gross_margin_percentage * mf.ia_sales_units, 0)        AS ia_gm_pct_w,
        COALESCE(mf.finalized_asp * mf.finalized_sales_units, 0)              AS fin_asp_w,
        COALESCE(mf.finalized_aum * mf.finalized_sales_units, 0)              AS fin_aum_w,
        COALESCE(mf.finalized_gross_margin_percentage * mf.finalized_sales_units, 0) AS fin_gm_pct_w
    FROM {self.schema}.bp_monthly_forecast mf
    WHERE mf.strategy_id = {strategy_id}{mf_channel}
),

actuals_per_bin_month AS (
    SELECT
        mfa.opt_level_bins,
        mfa.product_id,
        mfa.segment_id,
        mfa.channel_id,
        mfa.fiscal_year,
        mfa.fiscal_month,
        COALESCE(mfa.sales_units, 0)                                  AS act_su,
        COALESCE(mfa.revenue, 0)                                      AS act_rev,
        COALESCE(mfa.gross_margin_dollar, 0)                          AS act_gm,
        COALESCE(mfa.asp * mfa.sales_units, 0)                        AS act_asp_w,
        COALESCE(mfa.aum * mfa.sales_units, 0)                        AS act_aum_w,
        COALESCE(mfa.gross_margin_percentage * mfa.sales_units, 0)    AS act_gm_pct_w
    FROM {self.schema}.bp_monthly_forecast_actuals mfa
    WHERE mfa.strategy_id = {strategy_id}{mfa_channel}
),

-- ----- Base prices from reco_v2 tables, units-weighted across the bins in each group -----
-- One row per bin with its base_price for each scenario + its sales_units weighting.
base_prices_per_bin AS (
    SELECT
        bg.opt_level_bins,
        bg.product_id,
        bg.segment_id,
        bg.channel_id,
        -- weighted sums (we'll group these to the detailed-view grain below)
        COALESCE(rc.base_price * NULLIF(rc.sales_units, 0), 0)        AS cur_bp_w,
        COALESCE(rc.sales_units, 0)                                   AS cur_bp_units,
        COALESCE(ri.base_price * NULLIF(ri.sales_units, 0), 0)        AS ia_bp_w,
        COALESCE(ri.sales_units, 0)                                   AS ia_bp_units,
        COALESCE(rf.base_price * NULLIF(rf.sales_units, 0), 0)        AS fin_bp_w,
        COALESCE(rf.sales_units, 0)                                   AS fin_bp_units
    FROM bin_groups bg
    LEFT JOIN {self.schema}.bp_price_reco_current_v2   rc
        ON rc.strategy_id = {strategy_id}
       AND rc.opt_level_bins = bg.opt_level_bins
       AND rc.product_id = bg.product_id
       AND rc.segment_id = bg.segment_id
       AND rc.channel_id = bg.channel_id
    LEFT JOIN {self.schema}.bp_price_reco_ia_v2        ri
        ON ri.strategy_id = {strategy_id}
       AND ri.opt_level_bins = bg.opt_level_bins
       AND ri.product_id = bg.product_id
       AND ri.segment_id = bg.segment_id
       AND ri.channel_id = bg.channel_id
    LEFT JOIN {self.schema}.bp_price_reco_finalized_v2 rf
        ON rf.strategy_id = {strategy_id}
       AND rf.opt_level_bins = bg.opt_level_bins
       AND rf.product_id = bg.product_id
       AND rf.segment_id = bg.segment_id
       AND rf.channel_id = bg.channel_id
),

-- ----- Roll forecast/actuals to (group_label, channel, segment, price_zone, forecast_type) -----
-- product_code, product_name, line_group are aggregated so the SQL shape is the same for
-- both views. In Product view each group has exactly one product (STRING_AGG returns that
-- single value); in Line Group view multiple products can collapse and the aggregate
-- exposes the full SKU list + count.
forecast_per_group_ft AS (
    SELECT
        {group_label_expr}                              AS group_label,
        STRING_AGG(DISTINCT bg.product_code, ', ' ORDER BY bg.product_code) AS product_codes,
        STRING_AGG(DISTINCT bg.product_name, ' | ' ORDER BY bg.product_name) AS product_names,
        COUNT(DISTINCT bg.product_code)                 AS product_count,
        MAX(bg.line_group)                              AS line_group,
        bg.channel_id,
        MAX(bg.channel_name)                            AS channel_name,
        bg.segment_id,
        MAX(bg.segment_name)                            AS segment_name,
        bg.price_zone_display                           AS price_zone,
        cal.forecast_type,
        cal.label                                       AS period_label,
        cal.display_order,
        SUM(fpb.cur_su)        AS cur_su,
        SUM(fpb.cur_rev)       AS cur_rev,
        SUM(fpb.cur_gm)        AS cur_gm,
        SUM(fpb.ia_su)         AS ia_su,
        SUM(fpb.ia_rev)        AS ia_rev,
        SUM(fpb.ia_gm)         AS ia_gm,
        SUM(fpb.fin_su)        AS fin_su,
        SUM(fpb.fin_rev)       AS fin_rev,
        SUM(fpb.fin_gm)        AS fin_gm,
        SUM(fpb.cur_asp_w)     AS cur_asp_w,
        SUM(fpb.cur_aum_w)     AS cur_aum_w,
        SUM(fpb.cur_gm_pct_w)  AS cur_gm_pct_w,
        SUM(fpb.ia_asp_w)      AS ia_asp_w,
        SUM(fpb.ia_aum_w)      AS ia_aum_w,
        SUM(fpb.ia_gm_pct_w)   AS ia_gm_pct_w,
        SUM(fpb.fin_asp_w)     AS fin_asp_w,
        SUM(fpb.fin_aum_w)     AS fin_aum_w,
        SUM(fpb.fin_gm_pct_w)  AS fin_gm_pct_w
    FROM bin_groups bg
    JOIN forecast_per_bin_month fpb
      ON fpb.opt_level_bins = bg.opt_level_bins
     AND fpb.product_id = bg.product_id
     AND fpb.segment_id = bg.segment_id
     AND fpb.channel_id = bg.channel_id
    JOIN calendar cal
      ON cal.fiscal_year  = fpb.fiscal_year
     AND cal.fiscal_month = fpb.fiscal_month
    GROUP BY
        {group_label_expr}, bg.channel_id, bg.segment_id,
        bg.price_zone_display, cal.forecast_type, cal.label, cal.display_order
),

actuals_per_group_ft AS (
    SELECT
        {group_label_expr}      AS group_label,
        bg.channel_id,
        bg.segment_id,
        bg.price_zone_display   AS price_zone,
        cal.forecast_type,
        SUM(apb.act_su)        AS act_su,
        SUM(apb.act_rev)       AS act_rev,
        SUM(apb.act_gm)        AS act_gm,
        SUM(apb.act_asp_w)     AS act_asp_w,
        SUM(apb.act_aum_w)     AS act_aum_w,
        SUM(apb.act_gm_pct_w)  AS act_gm_pct_w
    FROM bin_groups bg
    JOIN actuals_per_bin_month apb
      ON apb.opt_level_bins = bg.opt_level_bins
     AND apb.product_id = bg.product_id
     AND apb.segment_id = bg.segment_id
     AND apb.channel_id = bg.channel_id
    JOIN calendar cal
      ON cal.fiscal_year  = apb.fiscal_year
     AND cal.fiscal_month = apb.fiscal_month
    GROUP BY {group_label_expr}, bg.channel_id, bg.segment_id, bg.price_zone_display, cal.forecast_type
),

-- Base prices rolled up to the same detailed-view grain (group_label, channel, segment, price_zone).
base_prices_per_group AS (
    SELECT
        {group_label_expr}        AS group_label,
        bg.channel_id,
        bg.segment_id,
        bg.price_zone_display     AS price_zone,
        SUM(bpb.cur_bp_w)         AS cur_bp_w,
        SUM(bpb.cur_bp_units)     AS cur_bp_units,
        SUM(bpb.ia_bp_w)          AS ia_bp_w,
        SUM(bpb.ia_bp_units)      AS ia_bp_units,
        SUM(bpb.fin_bp_w)         AS fin_bp_w,
        SUM(bpb.fin_bp_units)     AS fin_bp_units
    FROM bin_groups bg
    LEFT JOIN base_prices_per_bin bpb
      ON bpb.opt_level_bins = bg.opt_level_bins
     AND bpb.product_id = bg.product_id
     AND bpb.segment_id = bg.segment_id
     AND bpb.channel_id = bg.channel_id
    GROUP BY {group_label_expr}, bg.channel_id, bg.segment_id, bg.price_zone_display
)

SELECT
    -- Identity
    fpg.group_label,
    fpg.product_codes,            -- comma-separated SKUs in the group (single value in Product view)
    fpg.product_names,            -- pipe-separated product names (single value in Product view)
    fpg.product_count,            -- 1 in Product view; N in Line Group view when N products share a line_group
    fpg.line_group,               -- the line_group value (NULL if none)
    fpg.channel_id,
    fpg.channel_name,
    fpg.segment_id,
    fpg.segment_name,
    fpg.price_zone,
    fpg.forecast_type,
    fpg.period_label,
    fpg.display_order,

    -- Base prices (units-weighted, same for every forecast_type row of a given group)
    ROUND(COALESCE(bp.cur_bp_w / NULLIF(bp.cur_bp_units, 0), 0)::numeric, 2) AS base_price_current,
    ROUND(COALESCE(bp.ia_bp_w  / NULLIF(bp.ia_bp_units,  0), 0)::numeric, 2) AS base_price_ia,
    ROUND(COALESCE(bp.fin_bp_w / NULLIF(bp.fin_bp_units, 0), 0)::numeric, 2) AS base_price_fin,

    -- ============ CURRENT scenario (forecast portion only) ============
    fpg.cur_su                                                              AS forecast_cur_sales,
    ROUND(fpg.cur_rev::numeric, 2)                                          AS forecast_cur_revenue,
    ROUND(fpg.cur_gm::numeric, 2)                                           AS forecast_cur_gm,
    ROUND(COALESCE(fpg.cur_asp_w    / NULLIF(fpg.cur_su, 0), 0)::numeric, 2) AS forecast_cur_asp,
    ROUND(COALESCE(fpg.cur_aum_w    / NULLIF(fpg.cur_su, 0), 0)::numeric, 2) AS forecast_cur_aum,
    ROUND(COALESCE(fpg.cur_gm_pct_w / NULLIF(fpg.cur_su, 0), 0)::numeric, 2) AS forecast_cur_gm_pct,

    -- ============ IA scenario (forecast portion only) ============
    fpg.ia_su                                                               AS forecast_ia_sales,
    ROUND(fpg.ia_rev::numeric, 2)                                           AS forecast_ia_revenue,
    ROUND(fpg.ia_gm::numeric, 2)                                            AS forecast_ia_gm,
    ROUND(COALESCE(fpg.ia_asp_w    / NULLIF(fpg.ia_su, 0), 0)::numeric, 2)  AS forecast_ia_asp,
    ROUND(COALESCE(fpg.ia_aum_w    / NULLIF(fpg.ia_su, 0), 0)::numeric, 2)  AS forecast_ia_aum,
    ROUND(COALESCE(fpg.ia_gm_pct_w / NULLIF(fpg.ia_su, 0), 0)::numeric, 2)  AS forecast_ia_gm_pct,

    -- ============ FINALIZED scenario (forecast portion only) ============
    fpg.fin_su                                                              AS forecast_fin_sales,
    ROUND(fpg.fin_rev::numeric, 2)                                          AS forecast_fin_revenue,
    ROUND(fpg.fin_gm::numeric, 2)                                           AS forecast_fin_gm,
    ROUND(COALESCE(fpg.fin_asp_w    / NULLIF(fpg.fin_su, 0), 0)::numeric, 2) AS forecast_fin_asp,
    ROUND(COALESCE(fpg.fin_aum_w    / NULLIF(fpg.fin_su, 0), 0)::numeric, 2) AS forecast_fin_aum,
    ROUND(COALESCE(fpg.fin_gm_pct_w / NULLIF(fpg.fin_su, 0), 0)::numeric, 2) AS forecast_fin_gm_pct,

    -- ============ ACTUALS (scenario-agnostic) ============
    COALESCE(act.act_su, 0)                                                                  AS actuals_sales,
    ROUND(COALESCE(act.act_rev, 0)::numeric, 2)                                              AS actuals_revenue,
    ROUND(COALESCE(act.act_gm, 0)::numeric, 2)                                               AS actuals_gm,
    ROUND(COALESCE(act.act_asp_w    / NULLIF(act.act_su, 0), 0)::numeric, 2)                 AS actuals_asp,
    ROUND(COALESCE(act.act_aum_w    / NULLIF(act.act_su, 0), 0)::numeric, 2)                 AS actuals_aum,
    ROUND(COALESCE(act.act_gm_pct_w / NULLIF(act.act_su, 0), 0)::numeric, 2)                 AS actuals_gm_pct,

    -- ============ TOTAL = forecast + actuals (per scenario, with re-derived weighted rates) ============
    (fpg.cur_su + COALESCE(act.act_su, 0))                                                                                   AS total_cur_sales,
    ROUND((fpg.cur_rev + COALESCE(act.act_rev, 0))::numeric, 2)                                                              AS total_cur_revenue,
    ROUND((fpg.cur_gm  + COALESCE(act.act_gm, 0))::numeric, 2)                                                               AS total_cur_gm,
    ROUND(COALESCE((fpg.cur_asp_w   + COALESCE(act.act_asp_w, 0))    / NULLIF(fpg.cur_su + COALESCE(act.act_su, 0), 0), 0)::numeric, 2) AS total_cur_asp,
    ROUND(COALESCE((fpg.cur_aum_w   + COALESCE(act.act_aum_w, 0))    / NULLIF(fpg.cur_su + COALESCE(act.act_su, 0), 0), 0)::numeric, 2) AS total_cur_aum,
    ROUND(COALESCE((fpg.cur_gm_pct_w + COALESCE(act.act_gm_pct_w, 0)) / NULLIF(fpg.cur_su + COALESCE(act.act_su, 0), 0), 0)::numeric, 2) AS total_cur_gm_pct,

    (fpg.ia_su + COALESCE(act.act_su, 0))                                                                                    AS total_ia_sales,
    ROUND((fpg.ia_rev + COALESCE(act.act_rev, 0))::numeric, 2)                                                               AS total_ia_revenue,
    ROUND((fpg.ia_gm  + COALESCE(act.act_gm, 0))::numeric, 2)                                                                AS total_ia_gm,
    ROUND(COALESCE((fpg.ia_asp_w   + COALESCE(act.act_asp_w, 0))    / NULLIF(fpg.ia_su + COALESCE(act.act_su, 0), 0), 0)::numeric, 2)  AS total_ia_asp,
    ROUND(COALESCE((fpg.ia_aum_w   + COALESCE(act.act_aum_w, 0))    / NULLIF(fpg.ia_su + COALESCE(act.act_su, 0), 0), 0)::numeric, 2)  AS total_ia_aum,
    ROUND(COALESCE((fpg.ia_gm_pct_w + COALESCE(act.act_gm_pct_w, 0)) / NULLIF(fpg.ia_su + COALESCE(act.act_su, 0), 0), 0)::numeric, 2) AS total_ia_gm_pct,

    (fpg.fin_su + COALESCE(act.act_su, 0))                                                                                   AS total_fin_sales,
    ROUND((fpg.fin_rev + COALESCE(act.act_rev, 0))::numeric, 2)                                                              AS total_fin_revenue,
    ROUND((fpg.fin_gm  + COALESCE(act.act_gm, 0))::numeric, 2)                                                               AS total_fin_gm,
    ROUND(COALESCE((fpg.fin_asp_w   + COALESCE(act.act_asp_w, 0))    / NULLIF(fpg.fin_su + COALESCE(act.act_su, 0), 0), 0)::numeric, 2) AS total_fin_asp,
    ROUND(COALESCE((fpg.fin_aum_w   + COALESCE(act.act_aum_w, 0))    / NULLIF(fpg.fin_su + COALESCE(act.act_su, 0), 0), 0)::numeric, 2) AS total_fin_aum,
    ROUND(COALESCE((fpg.fin_gm_pct_w + COALESCE(act.act_gm_pct_w, 0)) / NULLIF(fpg.fin_su + COALESCE(act.act_su, 0), 0), 0)::numeric, 2) AS total_fin_gm_pct

FROM forecast_per_group_ft fpg
LEFT JOIN actuals_per_group_ft act
       ON act.group_label = fpg.group_label
      AND act.channel_id  = fpg.channel_id
      AND act.segment_id  = fpg.segment_id
      AND act.price_zone  = fpg.price_zone
      AND act.forecast_type = fpg.forecast_type
LEFT JOIN base_prices_per_group bp
       ON bp.group_label = fpg.group_label
      AND bp.channel_id  = fpg.channel_id
      AND bp.segment_id  = fpg.segment_id
      AND bp.price_zone  = fpg.price_zone
ORDER BY
    fpg.group_label, fpg.channel_id, fpg.segment_id, fpg.price_zone,
    COALESCE(fpg.display_order, 999), fpg.forecast_type
"""
        return query

    def validate(
        self,
        strategy_id: int,
        view_by: str = VIEW_BY_PRODUCT,
        channel_ids: Optional[List[int]] = None,
    ) -> Dict:
        query = self.get_query(strategy_id, view_by, channel_ids)
        rows = self._execute_query(query)
        return {
            "success": True,
            "strategy_id": strategy_id,
            "view_by": view_by,
            "rows": rows,
        }


monthly_detailed_view_validator = MonthlyDetailedViewValidator()
