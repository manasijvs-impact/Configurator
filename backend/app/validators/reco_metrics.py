"""
Reco metrics validator.
Validates the daily-grain metrics stored in the reco tables (bp_price_reco_current_v2,
bp_price_reco_ia_v2, bp_price_reco_finalized_v2) against values recomputed via the
elasticity formula from the simulation tables and (for active strategies) blended with
actuals from bp_transaction_data_daily.
Dynamically fetches configuration (hierarchy, KVI attribute) from database tables.
Uses the shared database connection from database.py.
"""

from app.core.database import db
from typing import Dict, List, Optional


class RecoMetricsValidator:
    """Validates reco-table metrics against expected formula results.

    Uses the shared db connection from database.py — no separate connection management needed.
    """
    
    @property
    def schema(self) -> str:
        """Get current schema from shared db connection."""
        return db.db_schema
    
    def is_connected(self) -> bool:
        """Check if connected to database (delegates to shared db)."""
        return db.is_connected()
    
    def get_connection_status(self) -> Dict:
        """Get current connection status (delegates to shared db)."""
        return db.get_connection_status()
    
    def _execute_query(self, query: str, params: tuple = None) -> list:
        """Execute query using shared db connection."""
        if not db.is_connected():
            raise Exception("Not connected to database. Please connect first.")
        return db.execute_query(query, params)
    
    def get_config(self) -> Dict:
        """Fetch dynamic configuration from database tables."""
        if db._config_cache:
            return db._config_cache
        
        # Get hierarchy columns dynamically from information_schema
        hierarchy_query = f"""
            SELECT array_agg(pm_col ORDER BY pm_col) AS hierarchy_cols
            FROM (
                SELECT column_name AS pm_col
                FROM information_schema.columns
                WHERE table_schema = '{self.schema}'
                  AND table_name = 'bp_product_master'
                  AND column_name ~ '^l[0-9]+_cid$'
            ) pm
            WHERE pm_col IN (
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = '{self.schema}'
                  AND table_name = 'bp_simulation_day_split_ratio'
                  AND column_name ~ '^l[0-9]+_cid$'
            )
        """
        hierarchy_result = self._execute_query(hierarchy_query)
        raw_hierarchy = hierarchy_result[0]['hierarchy_cols'] if hierarchy_result and hierarchy_result[0]['hierarchy_cols'] else None
        
        # Handle PostgreSQL array - might come as string "{l0_cid,l1_cid}" or Python list
        if raw_hierarchy is None:
            hierarchy_list = ['l0_cid', 'l1_cid', 'l2_cid', 'l3_cid']
        elif isinstance(raw_hierarchy, str):
            hierarchy_list = raw_hierarchy.strip('{}').split(',') if raw_hierarchy else ['l0_cid', 'l1_cid', 'l2_cid', 'l3_cid']
        elif isinstance(raw_hierarchy, list):
            hierarchy_list = raw_hierarchy
        else:
            hierarchy_list = ['l0_cid', 'l1_cid', 'l2_cid', 'l3_cid']
        
        # Get channel column from store hierarchy
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
        channel_column = channel_result[0]['channel_col'] if channel_result else 's0_cid'
        
        # Get KVI attribute column
        kvi_query = f"""
            SELECT database_column
            FROM {self.schema}.bp_product_store_attributes_metadata
            WHERE attribute_name = 'is_kvi'
            LIMIT 1
        """
        kvi_result = self._execute_query(kvi_query)
        kvi_column = kvi_result[0]['database_column'] if kvi_result else 'attribute_9'
        
        # Get price_lock attribute column
        price_lock_query = f"""
            SELECT database_column
            FROM {self.schema}.bp_product_store_attributes_metadata
            WHERE attribute_name = 'price_lock'
            LIMIT 1
        """
        price_lock_result = self._execute_query(price_lock_query)
        price_lock_column = price_lock_result[0]['database_column'] if price_lock_result else 'attribute_6'
        
        # Get zone_exception attribute column
        zone_exception_query = f"""
            SELECT database_column
            FROM {self.schema}.bp_product_store_attributes_metadata
            WHERE attribute_name = 'zone_exception'
            LIMIT 1
        """
        zone_exception_result = self._execute_query(zone_exception_query)
        zone_exception_column = zone_exception_result[0]['database_column'] if zone_exception_result else 'attribute_7'
        
        db._config_cache = {
            'hierarchy_fields': ', '.join(hierarchy_list),
            'hierarchy_list': hierarchy_list,
            'channel_column': channel_column,
            'channel_name_column': channel_column.replace('_cid', '_name'),
            'kvi_column': kvi_column,
            'price_lock_column': price_lock_column,
            'zone_exception_column': zone_exception_column
        }
        
        return db._config_cache
    
    def clear_cache(self):
        """Clear configuration cache."""
        db.clear_config_cache()
    
    def get_strategies(self) -> List[Dict]:
        """Get list of strategies available for validation."""
        query = f"""
            SELECT 
                strategy_id, 
                strategy_name,
                start_date,
                end_date,
                is_active
            FROM {self.schema}.bp_strategy_master
            ORDER BY strategy_id DESC
        """
        return self._execute_query(query)
    
    def _build_hierarchy_join(self, table_alias: str, pcs_alias: str, hierarchy_list: List[str]) -> str:
        """Build dynamic hierarchy join condition."""
        conditions = [f"{table_alias}.{h} = {pcs_alias}.{h}" for h in hierarchy_list]
        return " AND ".join(conditions)
    
    def get_strategy_status(self, strategy_id: int) -> Optional[int]:
        """Get strategy status from bp_strategy_master."""
        query = f"""
            SELECT strategy_status_id 
            FROM {self.schema}.bp_strategy_master 
            WHERE strategy_id = {strategy_id}
        """
        result = self._execute_query(query)
        return result[0]['strategy_status_id'] if result else None
    
    # =========================================================================
    # HELPER METHODS FOR BUILDING CTE BLOCKS
    # =========================================================================
    
    def _build_base_ctes(self, strategy_id: int, hierarchy_select: str, kvi_col: str, 
                         price_lock_col: str, zone_exception_col: str, channel_col: str,
                         channel_name_col: str, include_actuals: bool) -> str:
        """Build base CTEs: strategy_params, strategy_products, bins_mapping, reco tables."""
        
        actuals_cutoff_cte = ""
        if include_actuals:
            actuals_cutoff_cte = f"""
-- Get max date from transaction data (actuals cutoff) - global max
actuals_cutoff AS (
    SELECT COALESCE(
        (SELECT MAX(t.transaction_date) 
         FROM {self.schema}.bp_transaction_data_daily t
         CROSS JOIN strategy_params spr
         WHERE t.transaction_date BETWEEN spr.start_date AND spr.end_date),
        (SELECT start_date - INTERVAL '1 day' FROM strategy_params)
    ) AS max_actuals_date
),
"""
        
        return f"""
WITH strategy_params AS (
    SELECT 
        {strategy_id} AS strategy_id,
        start_date,
        end_date,
        strategy_status_id
    FROM {self.schema}.bp_strategy_master 
    WHERE strategy_id = {strategy_id}
),

{actuals_cutoff_cte}
strategy_products AS (
    SELECT DISTINCT product_id, store_id, segment_id
    FROM {self.schema}.bp_strategy_products_stores
    WHERE strategy_id = {strategy_id}
),

strategy_products_with_kvi AS (
    SELECT 
        sp.product_id,
        sp.store_id,
        sp.segment_id,
        v.{kvi_col}::boolean AS is_kvi
    FROM strategy_products sp
    INNER JOIN {self.schema}.bp_product_store_attributes_mapping_v4 v
        ON sp.product_id = v.product_id
        AND sp.store_id = v.store_id
        AND sp.segment_id = v.segment_id
),

strategy_pcs AS (
    SELECT DISTINCT
        spk.product_id,
        {hierarchy_select},
        sm.{channel_col} AS channel_id,
        spk.segment_id,
        spk.is_kvi
    FROM strategy_products_with_kvi spk
    INNER JOIN {self.schema}.bp_product_master pm ON spk.product_id = pm.product_id
    INNER JOIN {self.schema}.bp_store_master sm ON spk.store_id = sm.store_id
),

strategy_products_with_hierarchy AS (
    SELECT DISTINCT
        spk.product_id, spk.store_id, spk.segment_id, spk.is_kvi,
        {hierarchy_select}
    FROM strategy_products_with_kvi spk
    INNER JOIN {self.schema}.bp_product_master pm ON spk.product_id = pm.product_id
),

bins_mapping AS (
    SELECT 
        v.product_id, v.store_id, v.segment_id,
        v.effective_price_zone,
        v.{kvi_col}::boolean AS is_kvi,
        v.{price_lock_col}::boolean AS price_lock_val,
        v.{zone_exception_col}::boolean AS zone_exception_val,
        v.product_id::text || '_' ||
        CASE WHEN v.{price_lock_col}::boolean OR v.{zone_exception_col}::boolean OR v.effective_price_zone IS NULL
            THEN v.store_id::text || '_' || v.segment_id::text
            ELSE v.effective_price_zone || '_' || v.segment_id::text
        END AS opt_level_bins,
        CASE WHEN v.{zone_exception_col}::boolean OR v.effective_price_zone IS NULL
            THEN sm.store_code
            ELSE v.price_zone
        END AS price_zone_display
    FROM {self.schema}.bp_product_store_attributes_mapping_v4 v
    INNER JOIN strategy_products sp
        ON v.product_id = sp.product_id
        AND v.store_id = sp.store_id
        AND v.segment_id = sp.segment_id
    INNER JOIN {self.schema}.bp_store_master sm
        ON v.store_id = sm.store_id
),

our_bins AS (
    SELECT DISTINCT opt_level_bins, product_id FROM bins_mapping
),

bin_identity AS (
    SELECT DISTINCT ON (bm.opt_level_bins, bm.product_id)
        bm.opt_level_bins,
        bm.product_id,
        pm.product_code,
        sm.{channel_name_col} AS channel_name,
        bm.price_zone_display,
        COALESCE(csm.segment_name, 'Segment ' || bm.segment_id::text) AS segment_name,
        bm.price_lock_val,
        bm.zone_exception_val
    FROM bins_mapping bm
    INNER JOIN {self.schema}.bp_product_master pm ON bm.product_id = pm.product_id
    INNER JOIN {self.schema}.bp_store_master sm ON bm.store_id = sm.store_id
    LEFT JOIN {self.schema}.bp_customer_segment_master csm ON bm.segment_id = csm.segment_id
    ORDER BY bm.opt_level_bins, bm.product_id
),

store_channel AS (
    SELECT 
        bm.product_id, bm.store_id, bm.segment_id, bm.opt_level_bins, bm.is_kvi,
        sm.{channel_col} AS channel_id
    FROM bins_mapping bm
    INNER JOIN {self.schema}.bp_store_master sm ON bm.store_id = sm.store_id
),
"""

    def _build_actuals_cte(self) -> str:
        """Build actuals CTEs for active strategies.
        
        Two-stage approach matching production (fn_strategy_actuals_main):
        1. actuals_granular: Product/store/segment level - direct calculations
        2. actuals_by_bin: Bin level aggregation - weighted averages for rates
        """
        return f"""
-- ACTUALS STAGE 1: Granular level (product/store/segment) - direct calculations
actuals_granular AS (
    SELECT 
        bm.opt_level_bins,
        bm.product_id,
        bm.store_id,
        bm.segment_id,
        -- Base sums at granular level
        SUM(t.sales_units) AS sales_units,
        SUM(t.total_revenue) AS revenue,
        SUM(t.total_margin) AS gm_dollar,
        COUNT(DISTINCT t.transaction_date) AS days_count,
        -- Direct rate calculations at granular level (no weighting needed here)
        CASE WHEN SUM(t.sales_units) > 0 
             THEN SUM(t.total_revenue) / SUM(t.sales_units) 
             ELSE 0 END AS asp,
        CASE WHEN SUM(t.sales_units) > 0 
             THEN SUM(t.total_margin) / SUM(t.sales_units) 
             ELSE 0 END AS aum,
        CASE WHEN SUM(t.total_revenue) > 0 
             THEN (SUM(t.total_margin) / SUM(t.total_revenue)) * 100 
             ELSE 0 END AS gm_pct
    FROM bins_mapping bm
    INNER JOIN {self.schema}.bp_transaction_data_daily t
        ON bm.product_id = t.product_id
        AND bm.store_id = t.store_id
        AND bm.segment_id = t.segment_id
    CROSS JOIN strategy_params sp
    CROSS JOIN actuals_cutoff ac
    WHERE t.transaction_date BETWEEN sp.start_date AND ac.max_actuals_date
    GROUP BY bm.opt_level_bins, bm.product_id, bm.store_id, bm.segment_id
),

-- ACTUALS STAGE 2: Bin level - weighted averages for rates
actuals_by_bin AS (
    SELECT 
        opt_level_bins,
        product_id,
        -- Sum the additive metrics
        SUM(sales_units) AS actual_sales_units,
        SUM(revenue) AS actual_revenue,
        SUM(gm_dollar) AS actual_gm_dollar,
        MAX(days_count) AS actual_days,
        -- Weighted averages: SUM(rate * weight) / SUM(weight)
        CASE WHEN SUM(sales_units) > 0 
             THEN SUM(asp * sales_units) / SUM(sales_units) 
             ELSE 0 END AS actual_asp,
        CASE WHEN SUM(sales_units) > 0 
             THEN SUM(aum * sales_units) / SUM(sales_units) 
             ELSE 0 END AS actual_aum,
        CASE WHEN SUM(sales_units) > 0 
             THEN SUM(gm_pct * sales_units) / SUM(sales_units) 
             ELSE 0 END AS actual_gm_pct
    FROM actuals_granular
    GROUP BY opt_level_bins, product_id
),
"""

    def _build_reco_ctes(self, strategy_id: int) -> str:
        """Build reco table CTEs."""
        return f"""
-- RECO TABLES
reco_current AS (
    SELECT r.product_id, r.store_id, r.segment_id, r.channel_id,
           r.opt_level_bins, r.base_price, r.cost,
           r.sales_units AS sales_units_current, 
           r.baseline_sales AS baseline_sales_current,
           r.revenue AS revenue_current,
           r.gross_margin_dollar AS gm_dollar_current,
           r.gross_margin_percentage AS gm_pct_current,
           r.asp AS asp_current,
           r.aum AS aum_current,
           r.baseline_revenue AS baseline_revenue_current,
           r.baseline_margin_dollar AS baseline_gm_dollar_current,
           r.baseline_margin_percentage AS baseline_gm_pct_current,
           r.baseline_asp AS baseline_asp_current,
           r.baseline_aum AS baseline_aum_current,
           COALESCE(r.promotion_applied, 0) AS promo_applied_current,
           -- Stored actuals from reco table
           COALESCE(r.actuals_sales_units, 0) AS stored_actuals_sales_current,
           COALESCE(r.actuals_revenue, 0) AS stored_actuals_revenue_current,
           COALESCE(r.actuals_gross_margin_dollar, 0) AS stored_actuals_gm_dollar_current,
           COALESCE(r.actuals_gross_margin_percentage, 0) AS stored_actuals_gm_pct_current,
           COALESCE(r.actuals_asp, 0) AS stored_actuals_asp_current,
           COALESCE(r.actuals_aum, 0) AS stored_actuals_aum_current
    FROM {self.schema}.bp_price_reco_current_v2 r
    INNER JOIN our_bins ob ON r.opt_level_bins = ob.opt_level_bins AND r.product_id = ob.product_id
    WHERE r.strategy_id = {strategy_id}
),

reco_ia AS (
    SELECT r.product_id, r.store_id, r.segment_id, r.channel_id,
           r.opt_level_bins, r.base_price AS base_price_ia, r.cost AS cost_ia,
           r.sales_units AS sales_units_ia, 
           r.baseline_sales AS baseline_sales_ia,
           r.revenue AS revenue_ia,
           r.gross_margin_dollar AS gm_dollar_ia,
           r.gross_margin_percentage AS gm_pct_ia,
           r.asp AS asp_ia,
           r.aum AS aum_ia,
           r.baseline_revenue AS baseline_revenue_ia,
           r.baseline_margin_dollar AS baseline_gm_dollar_ia,
           r.baseline_margin_percentage AS baseline_gm_pct_ia,
           r.baseline_asp AS baseline_asp_ia,
           r.baseline_aum AS baseline_aum_ia,
           COALESCE(r.promotion_applied, 0) AS promo_applied_ia,
           -- Stored actuals from reco table
           COALESCE(r.actuals_sales_units, 0) AS stored_actuals_sales_ia,
           COALESCE(r.actuals_revenue, 0) AS stored_actuals_revenue_ia,
           COALESCE(r.actuals_gross_margin_dollar, 0) AS stored_actuals_gm_dollar_ia,
           COALESCE(r.actuals_gross_margin_percentage, 0) AS stored_actuals_gm_pct_ia,
           COALESCE(r.actuals_asp, 0) AS stored_actuals_asp_ia,
           COALESCE(r.actuals_aum, 0) AS stored_actuals_aum_ia
    FROM {self.schema}.bp_price_reco_ia_v2 r
    INNER JOIN our_bins ob ON r.opt_level_bins = ob.opt_level_bins AND r.product_id = ob.product_id
    WHERE r.strategy_id = {strategy_id}
),

reco_finalized AS (
    SELECT r.product_id, r.store_id, r.segment_id, r.channel_id,
           r.opt_level_bins, r.base_price AS base_price_finalized, r.cost AS cost_finalized,
           r.sales_units AS sales_units_finalized, 
           r.baseline_sales AS baseline_sales_finalized,
           r.revenue AS revenue_finalized,
           r.gross_margin_dollar AS gm_dollar_finalized,
           r.gross_margin_percentage AS gm_pct_finalized,
           r.asp AS asp_finalized,
           r.aum AS aum_finalized,
           r.baseline_revenue AS baseline_revenue_finalized,
           r.baseline_margin_dollar AS baseline_gm_dollar_finalized,
           r.baseline_margin_percentage AS baseline_gm_pct_finalized,
           r.baseline_asp AS baseline_asp_finalized,
           r.baseline_aum AS baseline_aum_finalized,
           COALESCE(r.promotion_applied, 0) AS promo_applied_finalized,
           -- Stored actuals from reco table
           COALESCE(r.actuals_sales_units, 0) AS stored_actuals_sales_finalized,
           COALESCE(r.actuals_revenue, 0) AS stored_actuals_revenue_finalized,
           COALESCE(r.actuals_gross_margin_dollar, 0) AS stored_actuals_gm_dollar_finalized,
           COALESCE(r.actuals_gross_margin_percentage, 0) AS stored_actuals_gm_pct_finalized,
           COALESCE(r.actuals_asp, 0) AS stored_actuals_asp_finalized,
           COALESCE(r.actuals_aum, 0) AS stored_actuals_aum_finalized
    FROM {self.schema}.bp_price_reco_finalized_v2 r
    INNER JOIN our_bins ob ON r.opt_level_bins = ob.opt_level_bins AND r.product_id = ob.product_id
    WHERE r.strategy_id = {strategy_id}
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
        rf.base_price_finalized,
        rc.sales_units_current, rc.baseline_sales_current,
        ri.sales_units_ia, ri.baseline_sales_ia,
        rf.sales_units_finalized, rf.baseline_sales_finalized,
        rc.revenue_current, rc.baseline_revenue_current,
        ri.revenue_ia, ri.baseline_revenue_ia,
        rf.revenue_finalized, rf.baseline_revenue_finalized,
        rc.gm_dollar_current, rc.baseline_gm_dollar_current,
        ri.gm_dollar_ia, ri.baseline_gm_dollar_ia,
        rf.gm_dollar_finalized, rf.baseline_gm_dollar_finalized,
        rc.gm_pct_current, rc.baseline_gm_pct_current,
        ri.gm_pct_ia, ri.baseline_gm_pct_ia,
        rf.gm_pct_finalized, rf.baseline_gm_pct_finalized,
        rc.asp_current, ri.asp_ia, rf.asp_finalized,
        rc.aum_current, ri.aum_ia, rf.aum_finalized,
        rc.baseline_asp_current, ri.baseline_asp_ia, rf.baseline_asp_finalized,
        rc.baseline_aum_current, ri.baseline_aum_ia, rf.baseline_aum_finalized,
        rc.promo_applied_current, ri.promo_applied_ia, rf.promo_applied_finalized,
        -- Stored actuals from all 3 reco tables
        rc.stored_actuals_sales_current, rc.stored_actuals_revenue_current,
        rc.stored_actuals_gm_dollar_current, rc.stored_actuals_gm_pct_current,
        rc.stored_actuals_asp_current, rc.stored_actuals_aum_current,
        ri.stored_actuals_sales_ia, ri.stored_actuals_revenue_ia,
        ri.stored_actuals_gm_dollar_ia, ri.stored_actuals_gm_pct_ia,
        ri.stored_actuals_asp_ia, ri.stored_actuals_aum_ia,
        rf.stored_actuals_sales_finalized, rf.stored_actuals_revenue_finalized,
        rf.stored_actuals_gm_dollar_finalized, rf.stored_actuals_gm_pct_finalized,
        rf.stored_actuals_asp_finalized, rf.stored_actuals_aum_finalized
    FROM reco_current rc
    FULL OUTER JOIN reco_ia ri ON rc.opt_level_bins = ri.opt_level_bins AND rc.product_id = ri.product_id
    FULL OUTER JOIN reco_finalized rf 
        ON COALESCE(rc.opt_level_bins, ri.opt_level_bins) = rf.opt_level_bins 
        AND COALESCE(rc.product_id, ri.product_id) = rf.product_id
),
"""

    def _build_forecast_ctes(self, hierarchy_join_day_split: str, hierarchy_join_store_split: str, 
                             include_actuals: bool) -> str:
        """Build forecast simulation CTEs (sim_week, promo, day_split, store_split)."""
        
        # Date filter conditions differ based on include_actuals
        if include_actuals:
            sim_week_filter = "w.week_start_date > ac.max_actuals_date - INTERVAL '6 days' AND w.week_start_date <= sp.end_date"
            promo_filter = "p.week_start_date > ac.max_actuals_date - INTERVAL '6 days' AND p.week_start_date <= spr.end_date"
            day_split_filter = "d.date > ac.max_actuals_date AND d.date <= sp.end_date"
            store_split_filter = "ss.week_start_date > ac.max_actuals_date - INTERVAL '6 days' AND ss.week_start_date <= spr.end_date"
            cross_join_actuals = "CROSS JOIN actuals_cutoff ac"
        else:
            sim_week_filter = "w.week_start_date BETWEEN sp.start_date - INTERVAL '6 days' AND sp.end_date"
            promo_filter = "p.week_start_date BETWEEN spr.start_date - INTERVAL '6 days' AND spr.end_date"
            day_split_filter = "d.date BETWEEN sp.start_date AND sp.end_date"
            store_split_filter = "ss.week_start_date BETWEEN spr.start_date - INTERVAL '6 days' AND spr.end_date"
            cross_join_actuals = ""
        
        return f"""
-- SIMULATION WEEK DATA
sim_week AS (
    SELECT 
        w.product_id, w.channel_id, w.segment_id, w.week_start_date,
        w.min_cost, w.base_percentage, w.sales_units AS sim_sales_units,
        w.elasticity_bp, w.promo_elasticity, 
        w.price_point, 
        pcs.is_kvi
    FROM strategy_pcs pcs
    INNER JOIN {self.schema}.bp_simulation_week w
        ON w.product_id = pcs.product_id AND w.channel_id = pcs.channel_id AND w.segment_id = pcs.segment_id
    CROSS JOIN strategy_params sp
    {cross_join_actuals}
    WHERE {sim_week_filter}
),

-- PROMO DATA
promo_week_store AS (
    SELECT p.product_id, p.store_id, p.segment_id, p.week_start_date, 
           p.weighted_promo_percent, p.promo_source, p.effective_reference_price
    FROM strategy_products sp
    INNER JOIN {self.schema}.bp_simulation_promo_week_with_store p
        ON p.product_id = sp.product_id AND p.store_id = sp.store_id AND p.segment_id = sp.segment_id
    CROSS JOIN strategy_params spr
    {cross_join_actuals}
    WHERE {promo_filter}
),

promo_week_channel AS (
    SELECT p.product_id, p.channel_id, p.segment_id, p.week_start_date, 
           p.weighted_promo_percent, p.promo_source, p.effective_reference_price
    FROM strategy_pcs pcs
    INNER JOIN {self.schema}.bp_simulation_promo_week p
        ON p.product_id = pcs.product_id AND p.channel_id = pcs.channel_id AND p.segment_id = pcs.segment_id
    CROSS JOIN strategy_params spr
    {cross_join_actuals}
    WHERE {promo_filter}
),

-- DAY SPLIT (KVI)
day_split_kvi_raw AS (
    SELECT d.product_id, d.channel_id, pcs.segment_id, d.segment_id AS data_segment_id, d.week_start_date,
           SUM(d.day_split_ratio) AS week_split_ratio
    FROM strategy_pcs pcs
    INNER JOIN {self.schema}.bp_simulation_day_split_ratio_kvi d
        ON d.product_id = pcs.product_id AND d.channel_id = pcs.channel_id
        AND d.segment_id IN (pcs.segment_id, 0)
    CROSS JOIN strategy_params sp
    {cross_join_actuals}
    WHERE pcs.is_kvi AND {day_split_filter}
    GROUP BY d.product_id, d.channel_id, pcs.segment_id, d.segment_id, d.week_start_date
),

day_split_kvi AS (
    SELECT DISTINCT ON (product_id, channel_id, segment_id, week_start_date)
        product_id, channel_id, segment_id, week_start_date, week_split_ratio
    FROM day_split_kvi_raw
    ORDER BY product_id, channel_id, segment_id, week_start_date,
             CASE WHEN data_segment_id = segment_id THEN 0 ELSE 1 END
),

-- DAY SPLIT (NON-KVI)
day_split_non_kvi_raw AS (
    SELECT pcs.product_id, d.channel_id, pcs.segment_id, d.segment_id AS data_segment_id, d.week_start_date,
           SUM(d.day_split_ratio) AS week_split_ratio
    FROM strategy_pcs pcs
    INNER JOIN {self.schema}.bp_simulation_day_split_ratio d
        ON {hierarchy_join_day_split}
        AND d.channel_id = pcs.channel_id
        AND d.segment_id IN (pcs.segment_id, 0)
    CROSS JOIN strategy_params sp
    {cross_join_actuals}
    WHERE NOT pcs.is_kvi AND {day_split_filter}
    GROUP BY pcs.product_id, d.channel_id, pcs.segment_id, d.segment_id, d.week_start_date
),

day_split_non_kvi AS (
    SELECT DISTINCT ON (product_id, channel_id, segment_id, week_start_date)
        product_id, channel_id, segment_id, week_start_date, week_split_ratio
    FROM day_split_non_kvi_raw
    ORDER BY product_id, channel_id, segment_id, week_start_date,
             CASE WHEN data_segment_id = segment_id THEN 0 ELSE 1 END
),

day_split AS (
    SELECT * FROM day_split_kvi UNION ALL SELECT * FROM day_split_non_kvi
),

-- STORE SPLIT (KVI)
store_split_kvi_raw AS (
    SELECT ss.product_id, ss.store_id, sph.segment_id, ss.segment_id AS data_segment_id,
           ss.week_start_date, ss.store_split_ratio
    FROM strategy_products_with_hierarchy sph
    INNER JOIN {self.schema}.bp_simulation_store_split_ratio_kvi ss
        ON ss.product_id = sph.product_id AND ss.store_id = sph.store_id
        AND ss.segment_id IN (sph.segment_id, 0)
    CROSS JOIN strategy_params spr
    {cross_join_actuals}
    WHERE sph.is_kvi AND {store_split_filter}
),

store_split_kvi AS (
    SELECT DISTINCT ON (product_id, store_id, segment_id, week_start_date)
        product_id, store_id, segment_id, week_start_date, store_split_ratio
    FROM store_split_kvi_raw
    ORDER BY product_id, store_id, segment_id, week_start_date,
             CASE WHEN data_segment_id = segment_id THEN 0 ELSE 1 END
),

-- STORE SPLIT (NON-KVI)
store_split_non_kvi_raw AS (
    SELECT sph.product_id, ss.store_id, sph.segment_id, ss.segment_id AS data_segment_id,
           ss.week_start_date, ss.store_split_ratio
    FROM strategy_products_with_hierarchy sph
    INNER JOIN {self.schema}.bp_simulation_store_split_ratio ss
        ON {hierarchy_join_store_split}
        AND ss.store_id = sph.store_id
        AND ss.segment_id IN (sph.segment_id, 0)
    CROSS JOIN strategy_params spr
    {cross_join_actuals}
    WHERE NOT sph.is_kvi AND {store_split_filter}
),

store_split_non_kvi AS (
    SELECT DISTINCT ON (product_id, store_id, segment_id, week_start_date)
        product_id, store_id, segment_id, week_start_date, store_split_ratio
    FROM store_split_non_kvi_raw
    ORDER BY product_id, store_id, segment_id, week_start_date,
             CASE WHEN data_segment_id = segment_id THEN 0 ELSE 1 END
),

store_split AS (
    SELECT * FROM store_split_kvi UNION ALL SELECT * FROM store_split_non_kvi
),

-- GRANULAR FORECAST DATA
-- Promo handling per-week (asymmetric, intentional):
--   * weighted_promo_percent → 0 for missing weeks. Each week's reality: no promo row =
--     0% promo applied that week, so the bin-level AVG correctly weights real promo % by
--     its actual coverage.
--   * promo_source → NULL for missing weeks. MIN ignores NULLs, so the bin's real source
--     (LY=1 or CY=0) survives without being polluted by fake 0's from absent rows.
--   * effective_reference_price → NULL for missing weeks. AVG ignores NULLs, so the
--     reference price reflects only weeks that actually have one (never dragged toward 0).
-- A bin with zero promo coverage at all → all three resolve to 0 via COALESCE(fa.*, 0)
-- in combined_metrics, so the override formula short-circuits to "no promo".
granular_forecast AS (
    SELECT
        sc.product_id, sc.store_id, sc.segment_id, sc.channel_id, sc.opt_level_bins,
        sw.min_cost, sw.base_percentage, sw.sim_sales_units,
        sw.elasticity_bp, sw.promo_elasticity, sw.price_point, sw.week_start_date,
        COALESCE(pws.weighted_promo_percent, pwc.weighted_promo_percent, 0) AS weighted_promo_percent,
        COALESCE(pws.promo_source, pwc.promo_source) AS promo_source,
        COALESCE(pws.effective_reference_price, pwc.effective_reference_price) AS effective_reference_price,
        ds.week_split_ratio, 
        ss.store_split_ratio,
        sw.sim_sales_units * ds.week_split_ratio * ss.store_split_ratio AS granular_predicted
    FROM store_channel sc
    INNER JOIN reco_all r ON sc.opt_level_bins = r.opt_level_bins
    INNER JOIN sim_week sw ON sc.product_id = sw.product_id AND sc.channel_id = sw.channel_id AND sc.segment_id = sw.segment_id
    LEFT JOIN promo_week_store pws ON sc.product_id = pws.product_id AND sc.store_id = pws.store_id AND sc.segment_id = pws.segment_id AND sw.week_start_date = pws.week_start_date
    LEFT JOIN promo_week_channel pwc ON sc.product_id = pwc.product_id AND sc.channel_id = pwc.channel_id AND sc.segment_id = pwc.segment_id AND sw.week_start_date = pwc.week_start_date
    INNER JOIN day_split ds ON sc.product_id = ds.product_id AND sc.channel_id = ds.channel_id AND sc.segment_id = ds.segment_id AND sw.week_start_date = ds.week_start_date
    INNER JOIN store_split ss ON sc.product_id = ss.product_id AND sc.store_id = ss.store_id AND sc.segment_id = ss.segment_id AND sw.week_start_date = ss.week_start_date
),

-- AGGREGATE FORECAST
forecast_aggregated AS (
    SELECT 
        opt_level_bins, product_id,
        SUM(granular_predicted) AS forecast_predicted,
        AVG(min_cost) AS avg_min_cost,
        AVG(price_point) AS avg_price_point,
        AVG(base_percentage) AS avg_base_percentage,
        AVG(elasticity_bp) AS avg_elasticity,
        AVG(promo_elasticity) AS avg_promo_elasticity,
        AVG(weighted_promo_percent) AS avg_promo_pct,
        MIN(promo_source) AS promo_source,
        AVG(effective_reference_price) AS avg_effective_ref_price,
        COUNT(DISTINCT store_id) AS store_count,
        COUNT(DISTINCT week_start_date) AS forecast_week_count,
        COUNT(*) AS forecast_row_count
    FROM granular_forecast
    GROUP BY opt_level_bins, product_id
),
"""

    def _build_combined_metrics_cte(self, include_actuals: bool) -> str:
        """Build combined_metrics CTE - combines reco, forecast, and optionally actuals."""
        
        if include_actuals:
            return """
-- COMBINE RECO + FORECAST + ACTUALS
combined_metrics AS (
    SELECT 
        r.opt_level_bins, r.product_id,
        r.base_price_current, r.base_price_ia, r.base_price_finalized,
        r.cost,
        r.sales_units_current, r.baseline_sales_current,
        r.sales_units_ia, r.baseline_sales_ia,
        r.sales_units_finalized, r.baseline_sales_finalized,
        r.revenue_current, r.baseline_revenue_current,
        r.revenue_ia, r.baseline_revenue_ia,
        r.revenue_finalized, r.baseline_revenue_finalized,
        r.gm_dollar_current, r.baseline_gm_dollar_current,
        r.gm_dollar_ia, r.baseline_gm_dollar_ia,
        r.gm_dollar_finalized, r.baseline_gm_dollar_finalized,
        r.gm_pct_current, r.baseline_gm_pct_current,
        r.gm_pct_ia, r.baseline_gm_pct_ia,
        r.gm_pct_finalized, r.baseline_gm_pct_finalized,
        r.asp_current, r.asp_ia, r.asp_finalized,
        r.aum_current, r.aum_ia, r.aum_finalized,
        r.baseline_asp_current, r.baseline_asp_ia, r.baseline_asp_finalized,
        r.baseline_aum_current, r.baseline_aum_ia, r.baseline_aum_finalized,
        r.promo_applied_current, r.promo_applied_ia, r.promo_applied_finalized,
        
        -- Stored actuals from reco tables
        r.stored_actuals_sales_current, r.stored_actuals_revenue_current,
        r.stored_actuals_gm_dollar_current, r.stored_actuals_gm_pct_current,
        r.stored_actuals_asp_current, r.stored_actuals_aum_current,
        r.stored_actuals_sales_ia, r.stored_actuals_revenue_ia,
        r.stored_actuals_gm_dollar_ia, r.stored_actuals_gm_pct_ia,
        r.stored_actuals_asp_ia, r.stored_actuals_aum_ia,
        r.stored_actuals_sales_finalized, r.stored_actuals_revenue_finalized,
        r.stored_actuals_gm_dollar_finalized, r.stored_actuals_gm_pct_finalized,
        r.stored_actuals_asp_finalized, r.stored_actuals_aum_finalized,
        
        -- Calculated actuals data (from transaction table)
        COALESCE(a.actual_sales_units, 0) AS actual_sales_units,
        COALESCE(a.actual_revenue, 0) AS actual_revenue,
        COALESCE(a.actual_gm_dollar, 0) AS actual_gm_dollar,
        COALESCE(a.actual_days, 0) AS actual_days,
        -- Actuals rates: already weighted in actuals_by_bin CTE
        COALESCE(a.actual_asp, 0) AS actual_asp,
        COALESCE(a.actual_aum, 0) AS actual_aum,
        COALESCE(a.actual_gm_pct, 0) AS actual_gm_pct,
        
        -- Forecast data
        COALESCE(fa.forecast_predicted, 0) AS forecast_predicted,
        COALESCE(fa.avg_min_cost, r.cost) AS avg_min_cost,
        COALESCE(fa.avg_price_point, r.base_price_current) AS avg_price_point,
        COALESCE(fa.avg_base_percentage, 0) AS avg_base_percentage,
        COALESCE(fa.avg_elasticity, 0) AS avg_elasticity,
        COALESCE(fa.avg_promo_elasticity, 0) AS avg_promo_elasticity,
        COALESCE(fa.avg_promo_pct, 0) AS avg_promo_pct,
        COALESCE(fa.promo_source, 0) AS promo_source,
        COALESCE(fa.avg_effective_ref_price, 0) AS avg_effective_ref_price,
        COALESCE(fa.store_count, 0) AS store_count,
        COALESCE(fa.forecast_week_count, 0) AS week_count,
        COALESCE(fa.forecast_row_count, 0) AS granular_row_count,
        
        (SELECT max_actuals_date FROM actuals_cutoff) AS actuals_cutoff_date,
        (SELECT start_date FROM strategy_params) AS strategy_start,
        (SELECT end_date FROM strategy_params) AS strategy_end
        
    FROM reco_all r
    LEFT JOIN actuals_by_bin a ON r.opt_level_bins = a.opt_level_bins AND r.product_id = a.product_id
    LEFT JOIN forecast_aggregated fa ON r.opt_level_bins = fa.opt_level_bins AND r.product_id = fa.product_id
),
"""
        else:
            return """
-- COMBINE RECO + FORECAST (NO ACTUALS)
combined_metrics AS (
    SELECT 
        r.opt_level_bins, r.product_id,
        r.base_price_current, r.base_price_ia, r.base_price_finalized,
        r.cost,
        r.sales_units_current, r.baseline_sales_current,
        r.sales_units_ia, r.baseline_sales_ia,
        r.sales_units_finalized, r.baseline_sales_finalized,
        r.revenue_current, r.baseline_revenue_current,
        r.revenue_ia, r.baseline_revenue_ia,
        r.revenue_finalized, r.baseline_revenue_finalized,
        r.gm_dollar_current, r.baseline_gm_dollar_current,
        r.gm_dollar_ia, r.baseline_gm_dollar_ia,
        r.gm_dollar_finalized, r.baseline_gm_dollar_finalized,
        r.gm_pct_current, r.baseline_gm_pct_current,
        r.gm_pct_ia, r.baseline_gm_pct_ia,
        r.gm_pct_finalized, r.baseline_gm_pct_finalized,
        r.asp_current, r.asp_ia, r.asp_finalized,
        r.aum_current, r.aum_ia, r.aum_finalized,
        r.baseline_asp_current, r.baseline_asp_ia, r.baseline_asp_finalized,
        r.baseline_aum_current, r.baseline_aum_ia, r.baseline_aum_finalized,
        r.promo_applied_current, r.promo_applied_ia, r.promo_applied_finalized,
        
        -- Stored actuals from reco tables
        r.stored_actuals_sales_current, r.stored_actuals_revenue_current,
        r.stored_actuals_gm_dollar_current, r.stored_actuals_gm_pct_current,
        r.stored_actuals_asp_current, r.stored_actuals_aum_current,
        r.stored_actuals_sales_ia, r.stored_actuals_revenue_ia,
        r.stored_actuals_gm_dollar_ia, r.stored_actuals_gm_pct_ia,
        r.stored_actuals_asp_ia, r.stored_actuals_aum_ia,
        r.stored_actuals_sales_finalized, r.stored_actuals_revenue_finalized,
        r.stored_actuals_gm_dollar_finalized, r.stored_actuals_gm_pct_finalized,
        r.stored_actuals_asp_finalized, r.stored_actuals_aum_finalized,
        
        -- No calculated actuals (forecast-only mode)
        0 AS actual_sales_units,
        0 AS actual_revenue,
        0 AS actual_gm_dollar,
        0 AS actual_days,
        0 AS actual_asp,
        0 AS actual_aum,
        0 AS actual_gm_pct,
        
        -- Forecast data (full period)
        COALESCE(fa.forecast_predicted, 0) AS forecast_predicted,
        COALESCE(fa.avg_min_cost, r.cost) AS avg_min_cost,
        COALESCE(fa.avg_price_point, r.base_price_current) AS avg_price_point,
        COALESCE(fa.avg_base_percentage, 0) AS avg_base_percentage,
        COALESCE(fa.avg_elasticity, 0) AS avg_elasticity,
        COALESCE(fa.avg_promo_elasticity, 0) AS avg_promo_elasticity,
        COALESCE(fa.avg_promo_pct, 0) AS avg_promo_pct,
        COALESCE(fa.promo_source, 0) AS promo_source,
        COALESCE(fa.avg_effective_ref_price, 0) AS avg_effective_ref_price,
        COALESCE(fa.store_count, 0) AS store_count,
        COALESCE(fa.forecast_week_count, 0) AS week_count,
        COALESCE(fa.forecast_row_count, 0) AS granular_row_count,
        
        NULL::date AS actuals_cutoff_date,
        (SELECT start_date FROM strategy_params) AS strategy_start,
        (SELECT end_date FROM strategy_params) AS strategy_end
        
    FROM reco_all r
    LEFT JOIN forecast_aggregated fa ON r.opt_level_bins = fa.opt_level_bins AND r.product_id = fa.product_id
),
"""

    def _build_calculated_cte(self, include_actuals: bool) -> str:
        """Build calculated CTE with sales/baseline formulas.
        
        Note: We always use `actual_sales_units + forecast` because in forecast-only mode,
        actual_sales_units is already set to 0 in combined_metrics CTE. This keeps the
        formula consistent: 0 + forecast = forecast.
        """
        return f"""
-- CALCULATED METRICS
calculated AS (
    SELECT 
        cm.*,
        
        -- effective promo % (from current price)
        CASE WHEN cm.promo_source = 1 AND cm.base_price_current <= cm.avg_effective_ref_price
             THEN 0.0 ELSE COALESCE(cm.avg_promo_pct, 0) END AS effective_promo_pct,
        
        -- promo prices
        cm.base_price_current * (1 - CASE WHEN cm.promo_source = 1 AND cm.base_price_current <= cm.avg_effective_ref_price
             THEN 0.0 ELSE COALESCE(cm.avg_promo_pct, 0) END) AS promo_price_current,
        cm.base_price_ia * (1 - CASE WHEN cm.promo_source = 1 AND cm.base_price_current <= cm.avg_effective_ref_price
             THEN 0.0 ELSE COALESCE(cm.avg_promo_pct, 0) END) AS promo_price_ia,
        cm.base_price_finalized * (1 - CASE WHEN cm.promo_source = 1 AND cm.base_price_current <= cm.avg_effective_ref_price
             THEN 0.0 ELSE COALESCE(cm.avg_promo_pct, 0) END) AS promo_price_finalized,
        
        -- FORECAST SALES PORTION (with promo effect)
        cm.forecast_predicted * (1 + cm.avg_elasticity * (
            CASE WHEN cm.avg_min_cost > 0 AND cm.base_price_current IS NOT NULL
                 THEN (cm.base_price_current - cm.avg_min_cost) / cm.avg_min_cost ELSE 0 END 
            - cm.avg_base_percentage
        )) * (1 + cm.avg_promo_elasticity * 
            CASE WHEN cm.promo_source = 1 AND cm.base_price_current <= cm.avg_effective_ref_price
                 THEN 0.0 ELSE cm.avg_promo_pct END
        ) AS forecast_sales_current,
        
        cm.forecast_predicted * (1 + cm.avg_elasticity * (
            CASE WHEN cm.avg_min_cost > 0 AND cm.base_price_ia IS NOT NULL
                 THEN (cm.base_price_ia - cm.avg_min_cost) / cm.avg_min_cost ELSE 0 END 
            - cm.avg_base_percentage
        )) * (1 + cm.avg_promo_elasticity * 
            CASE WHEN cm.promo_source = 1 AND cm.base_price_current <= cm.avg_effective_ref_price
                 THEN 0.0 ELSE cm.avg_promo_pct END
        ) AS forecast_sales_ia,
        
        cm.forecast_predicted * (1 + cm.avg_elasticity * (
            CASE WHEN cm.avg_min_cost > 0 AND cm.base_price_finalized IS NOT NULL
                 THEN (cm.base_price_finalized - cm.avg_min_cost) / cm.avg_min_cost ELSE 0 END 
            - cm.avg_base_percentage
        )) * (1 + cm.avg_promo_elasticity * 
            CASE WHEN cm.promo_source = 1 AND cm.base_price_current <= cm.avg_effective_ref_price
                 THEN 0.0 ELSE cm.avg_promo_pct END
        ) AS forecast_sales_finalized,
        
        -- FORECAST BASELINE PORTION (no promo)
        cm.forecast_predicted * (1 + cm.avg_elasticity * (
            CASE WHEN cm.avg_min_cost > 0 AND cm.base_price_current IS NOT NULL
                 THEN (cm.base_price_current - cm.avg_min_cost) / cm.avg_min_cost ELSE 0 END 
            - cm.avg_base_percentage
        )) AS forecast_baseline_current,
        
        cm.forecast_predicted * (1 + cm.avg_elasticity * (
            CASE WHEN cm.avg_min_cost > 0 AND cm.base_price_ia IS NOT NULL
                 THEN (cm.base_price_ia - cm.avg_min_cost) / cm.avg_min_cost ELSE 0 END 
            - cm.avg_base_percentage
        )) AS forecast_baseline_ia,
        
        cm.forecast_predicted * (1 + cm.avg_elasticity * (
            CASE WHEN cm.avg_min_cost > 0 AND cm.base_price_finalized IS NOT NULL
                 THEN (cm.base_price_finalized - cm.avg_min_cost) / cm.avg_min_cost ELSE 0 END 
            - cm.avg_base_percentage
        )) AS forecast_baseline_finalized,
        
        -- TOTAL SALES UNITS = ACTUALS + FORECAST (actuals=0 for forecast-only mode)
        cm.actual_sales_units + (
            cm.forecast_predicted * (1 + cm.avg_elasticity * (
                CASE WHEN cm.avg_min_cost > 0 AND cm.base_price_current IS NOT NULL
                     THEN (cm.base_price_current - cm.avg_min_cost) / cm.avg_min_cost ELSE 0 END 
                - cm.avg_base_percentage
            )) * (1 + cm.avg_promo_elasticity * 
                CASE WHEN cm.promo_source = 1 AND cm.base_price_current <= cm.avg_effective_ref_price
                     THEN 0.0 ELSE cm.avg_promo_pct END
            )
        ) AS calc_sales_current,
        
        cm.actual_sales_units + (
            cm.forecast_predicted * (1 + cm.avg_elasticity * (
                CASE WHEN cm.avg_min_cost > 0 AND cm.base_price_ia IS NOT NULL
                     THEN (cm.base_price_ia - cm.avg_min_cost) / cm.avg_min_cost ELSE 0 END 
                - cm.avg_base_percentage
            )) * (1 + cm.avg_promo_elasticity * 
                CASE WHEN cm.promo_source = 1 AND cm.base_price_current <= cm.avg_effective_ref_price
                     THEN 0.0 ELSE cm.avg_promo_pct END
            )
        ) AS calc_sales_ia,
        
        cm.actual_sales_units + (
            cm.forecast_predicted * (1 + cm.avg_elasticity * (
                CASE WHEN cm.avg_min_cost > 0 AND cm.base_price_finalized IS NOT NULL
                     THEN (cm.base_price_finalized - cm.avg_min_cost) / cm.avg_min_cost ELSE 0 END 
                - cm.avg_base_percentage
            )) * (1 + cm.avg_promo_elasticity * 
                CASE WHEN cm.promo_source = 1 AND cm.base_price_current <= cm.avg_effective_ref_price
                     THEN 0.0 ELSE cm.avg_promo_pct END
            )
        ) AS calc_sales_finalized,
        
        -- TOTAL BASELINE SALES = ACTUALS + FORECAST (no promo)
        cm.actual_sales_units + (
            cm.forecast_predicted * (1 + cm.avg_elasticity * (
                CASE WHEN cm.avg_min_cost > 0 AND cm.base_price_current IS NOT NULL
                     THEN (cm.base_price_current - cm.avg_min_cost) / cm.avg_min_cost ELSE 0 END 
                - cm.avg_base_percentage
            ))
        ) AS calc_baseline_current,
        
        cm.actual_sales_units + (
            cm.forecast_predicted * (1 + cm.avg_elasticity * (
                CASE WHEN cm.avg_min_cost > 0 AND cm.base_price_ia IS NOT NULL
                     THEN (cm.base_price_ia - cm.avg_min_cost) / cm.avg_min_cost ELSE 0 END 
                - cm.avg_base_percentage
            ))
        ) AS calc_baseline_ia,
        
        cm.actual_sales_units + (
            cm.forecast_predicted * (1 + cm.avg_elasticity * (
                CASE WHEN cm.avg_min_cost > 0 AND cm.base_price_finalized IS NOT NULL
                     THEN (cm.base_price_finalized - cm.avg_min_cost) / cm.avg_min_cost ELSE 0 END 
                - cm.avg_base_percentage
            ))
        ) AS calc_baseline_finalized,
        
        -- Sim markup values
        CASE WHEN cm.avg_min_cost > 0 AND cm.base_price_current IS NOT NULL
             THEN (cm.base_price_current - cm.avg_min_cost) / cm.avg_min_cost ELSE 0 END AS sim_markup_current,
        CASE WHEN cm.avg_min_cost > 0 AND cm.base_price_ia IS NOT NULL
             THEN (cm.base_price_ia - cm.avg_min_cost) / cm.avg_min_cost ELSE 0 END AS sim_markup_ia,
        CASE WHEN cm.avg_min_cost > 0 AND cm.base_price_finalized IS NOT NULL
             THEN (cm.base_price_finalized - cm.avg_min_cost) / cm.avg_min_cost ELSE 0 END AS sim_markup_finalized
             
    FROM combined_metrics cm
),
"""

    def _build_metrics_cte(self, include_actuals: bool) -> str:
        """Build metrics CTE with revenue/GM$ calculations.
        
        Note: We always use `actual_revenue + forecast * price` because in forecast-only mode,
        actual_revenue/actual_gm_dollar are already set to 0 in combined_metrics CTE.
        This keeps the formula consistent: 0 + forecast*price = forecast*price.
        """
        # Consistent formula - actuals are 0 when not applicable
        revenue_formula = "(c.actual_revenue + ROUND(c.forecast_sales_{state}::numeric, 0) * c.promo_price_{state})"
        baseline_rev_formula = "(c.actual_revenue + ROUND(c.forecast_baseline_{state}::numeric, 0) * c.base_price_{state})"
        gm_formula = "(c.actual_gm_dollar + (c.promo_price_{state} - c.cost) * ROUND(c.forecast_sales_{state}::numeric, 0))"
        baseline_gm_formula = "(c.actual_gm_dollar + (c.base_price_{state} - c.cost) * ROUND(c.forecast_baseline_{state}::numeric, 0))"
        
        return f"""
-- METRICS: Revenue, GM$
metrics AS (
    SELECT 
        c.*,
        
        -- Rounded units
        ROUND(c.calc_sales_current::numeric, 0) AS rounded_sales_current,
        ROUND(c.calc_sales_ia::numeric, 0) AS rounded_sales_ia,
        ROUND(c.calc_sales_finalized::numeric, 0) AS rounded_sales_finalized,
        ROUND(c.calc_baseline_current::numeric, 0) AS rounded_baseline_current,
        ROUND(c.calc_baseline_ia::numeric, 0) AS rounded_baseline_ia,
        ROUND(c.calc_baseline_finalized::numeric, 0) AS rounded_baseline_finalized,
        
        -- Rounded forecast portions (for actuals mode)
        ROUND(c.forecast_sales_current::numeric, 0) AS rounded_forecast_sales_current,
        ROUND(c.forecast_sales_ia::numeric, 0) AS rounded_forecast_sales_ia,
        ROUND(c.forecast_sales_finalized::numeric, 0) AS rounded_forecast_sales_finalized,
        ROUND(c.forecast_baseline_current::numeric, 0) AS rounded_forecast_baseline_current,
        ROUND(c.forecast_baseline_ia::numeric, 0) AS rounded_forecast_baseline_ia,
        ROUND(c.forecast_baseline_finalized::numeric, 0) AS rounded_forecast_baseline_finalized,
        
        -- REVENUE
        ROUND({revenue_formula.format(state='current')}::numeric, 2) AS calc_revenue_current,
        ROUND({revenue_formula.format(state='ia')}::numeric, 2) AS calc_revenue_ia,
        ROUND({revenue_formula.format(state='finalized')}::numeric, 2) AS calc_revenue_finalized,
        
        -- BASELINE REVENUE
        ROUND({baseline_rev_formula.format(state='current')}::numeric, 2) AS calc_baseline_revenue_current,
        ROUND({baseline_rev_formula.format(state='ia')}::numeric, 2) AS calc_baseline_revenue_ia,
        ROUND({baseline_rev_formula.format(state='finalized')}::numeric, 2) AS calc_baseline_revenue_finalized,
        
        -- GM$
        ROUND({gm_formula.format(state='current')}::numeric, 2) AS calc_gm_dollar_current,
        ROUND({gm_formula.format(state='ia')}::numeric, 2) AS calc_gm_dollar_ia,
        ROUND({gm_formula.format(state='finalized')}::numeric, 2) AS calc_gm_dollar_finalized,
        
        -- BASELINE GM$
        ROUND({baseline_gm_formula.format(state='current')}::numeric, 2) AS calc_baseline_gm_dollar_current,
        ROUND({baseline_gm_formula.format(state='ia')}::numeric, 2) AS calc_baseline_gm_dollar_ia,
        ROUND({baseline_gm_formula.format(state='finalized')}::numeric, 2) AS calc_baseline_gm_dollar_finalized
        
    FROM calculated c
),
"""

    def _build_final_metrics_cte(self) -> str:
        """Build final_metrics CTE with ratio calculations (ASP, AUM, GM%)."""
        return """
-- FINAL METRICS: ASP, AUM, GM%
final_metrics AS (
    SELECT 
        m.*,
        
        -- ASP = Revenue / Sales Units
        CASE WHEN m.rounded_sales_current > 0 
             THEN ROUND((m.calc_revenue_current / m.rounded_sales_current)::numeric, 2)
             ELSE 0 END AS calc_asp_current,
        CASE WHEN m.rounded_sales_ia > 0 
             THEN ROUND((m.calc_revenue_ia / m.rounded_sales_ia)::numeric, 2)
             ELSE 0 END AS calc_asp_ia,
        CASE WHEN m.rounded_sales_finalized > 0 
             THEN ROUND((m.calc_revenue_finalized / m.rounded_sales_finalized)::numeric, 2)
             ELSE 0 END AS calc_asp_finalized,
        
        -- AUM = GM$ / Sales Units
        CASE WHEN m.rounded_sales_current > 0 
             THEN ROUND((m.calc_gm_dollar_current / m.rounded_sales_current)::numeric, 2)
             ELSE 0 END AS calc_aum_current,
        CASE WHEN m.rounded_sales_ia > 0 
             THEN ROUND((m.calc_gm_dollar_ia / m.rounded_sales_ia)::numeric, 2)
             ELSE 0 END AS calc_aum_ia,
        CASE WHEN m.rounded_sales_finalized > 0 
             THEN ROUND((m.calc_gm_dollar_finalized / m.rounded_sales_finalized)::numeric, 2)
             ELSE 0 END AS calc_aum_finalized,
        
        -- GM%
        CASE WHEN m.calc_revenue_current > 0 
             THEN ROUND(((m.calc_gm_dollar_current / m.calc_revenue_current) * 100)::numeric, 2)
             ELSE 0 END AS calc_gm_pct_current,
        CASE WHEN m.calc_revenue_ia > 0 
             THEN ROUND(((m.calc_gm_dollar_ia / m.calc_revenue_ia) * 100)::numeric, 2)
             ELSE 0 END AS calc_gm_pct_ia,
        CASE WHEN m.calc_revenue_finalized > 0 
             THEN ROUND(((m.calc_gm_dollar_finalized / m.calc_revenue_finalized) * 100)::numeric, 2)
             ELSE 0 END AS calc_gm_pct_finalized,
        
        -- Baseline GM%
        CASE WHEN m.calc_baseline_revenue_current > 0
             THEN ROUND(((m.calc_baseline_gm_dollar_current / m.calc_baseline_revenue_current) * 100)::numeric, 2)
             ELSE 0 END AS calc_baseline_gm_pct_current,
        CASE WHEN m.calc_baseline_revenue_ia > 0
             THEN ROUND(((m.calc_baseline_gm_dollar_ia / m.calc_baseline_revenue_ia) * 100)::numeric, 2)
             ELSE 0 END AS calc_baseline_gm_pct_ia,
        CASE WHEN m.calc_baseline_revenue_finalized > 0
             THEN ROUND(((m.calc_baseline_gm_dollar_finalized / m.calc_baseline_revenue_finalized) * 100)::numeric, 2)
             ELSE 0 END AS calc_baseline_gm_pct_finalized,

        -- Baseline ASP = Baseline Revenue / Baseline Sales Units
        CASE WHEN m.rounded_baseline_current > 0
             THEN ROUND((m.calc_baseline_revenue_current / m.rounded_baseline_current)::numeric, 2)
             ELSE 0 END AS calc_baseline_asp_current,
        CASE WHEN m.rounded_baseline_ia > 0
             THEN ROUND((m.calc_baseline_revenue_ia / m.rounded_baseline_ia)::numeric, 2)
             ELSE 0 END AS calc_baseline_asp_ia,
        CASE WHEN m.rounded_baseline_finalized > 0
             THEN ROUND((m.calc_baseline_revenue_finalized / m.rounded_baseline_finalized)::numeric, 2)
             ELSE 0 END AS calc_baseline_asp_finalized,

        -- Baseline AUM = Baseline GM$ / Baseline Sales Units
        CASE WHEN m.rounded_baseline_current > 0
             THEN ROUND((m.calc_baseline_gm_dollar_current / m.rounded_baseline_current)::numeric, 2)
             ELSE 0 END AS calc_baseline_aum_current,
        CASE WHEN m.rounded_baseline_ia > 0
             THEN ROUND((m.calc_baseline_gm_dollar_ia / m.rounded_baseline_ia)::numeric, 2)
             ELSE 0 END AS calc_baseline_aum_ia,
        CASE WHEN m.rounded_baseline_finalized > 0
             THEN ROUND((m.calc_baseline_gm_dollar_finalized / m.rounded_baseline_finalized)::numeric, 2)
             ELSE 0 END AS calc_baseline_aum_finalized

    FROM metrics m
)
"""

    def _build_final_select(self, include_actuals: bool) -> str:
        """Build the final SELECT statement."""
        
        # Common strategy info for both modes
        strategy_info = """
    -- STRATEGY INFO
    m.actuals_cutoff_date,
    m.actual_days,
    m.strategy_start,
    m.strategy_end,
    ROUND(m.forecast_predicted::numeric, 3) AS forecast_predicted,
    
    -- CALCULATED ACTUALS (from transaction table)
    ROUND(m.actual_sales_units::numeric, 0) AS calc_actual_sales_units,
    ROUND(m.actual_revenue::numeric, 2) AS calc_actual_revenue,
    ROUND(m.actual_gm_dollar::numeric, 2) AS calc_actual_gm_dollar,
    -- Actuals ASP/AUM/GM% using weighted averages (like fn_strategy_actuals_main)
    ROUND(m.actual_gm_pct::numeric, 2) AS calc_actual_gm_pct,
    ROUND(m.actual_asp::numeric, 2) AS calc_actual_asp,
    ROUND(m.actual_aum::numeric, 2) AS calc_actual_aum,
"""

        return f"""
SELECT 
    m.opt_level_bins,
    bi.product_code,
    bi.channel_name,
    bi.price_zone_display AS price_zone,
    bi.segment_name,
    
{strategy_info}
    -- BASE PRICES
    ROUND(m.base_price_current::numeric, 2) AS price_current,
    ROUND(m.base_price_ia::numeric, 2) AS price_ia,
    ROUND(m.base_price_finalized::numeric, 2) AS price_finalized,
    ROUND(m.promo_price_current::numeric, 2) AS promo_price_current,
    ROUND(m.promo_price_ia::numeric, 2) AS promo_price_ia,
    ROUND(m.promo_price_finalized::numeric, 2) AS promo_price_finalized,
    ROUND(m.cost::numeric, 2) AS cost,
    
    -- SALES UNITS
    ROUND(m.sales_units_current::numeric, 0) AS stored_sales_current,
    ROUND(m.calc_sales_current::numeric, 0) AS calc_sales_current,
    ROUND(m.sales_units_ia::numeric, 0) AS stored_sales_ia,
    ROUND(m.calc_sales_ia::numeric, 0) AS calc_sales_ia,
    ROUND(m.sales_units_finalized::numeric, 0) AS stored_sales_finalized,
    ROUND(m.calc_sales_finalized::numeric, 0) AS calc_sales_finalized,
    
    -- BASELINE SALES
    ROUND(m.baseline_sales_current::numeric, 0) AS stored_baseline_current,
    ROUND(m.calc_baseline_current::numeric, 0) AS calc_baseline_current,
    ROUND(m.baseline_sales_ia::numeric, 0) AS stored_baseline_ia,
    ROUND(m.calc_baseline_ia::numeric, 0) AS calc_baseline_ia,
    ROUND(m.baseline_sales_finalized::numeric, 0) AS stored_baseline_finalized,
    ROUND(m.calc_baseline_finalized::numeric, 0) AS calc_baseline_finalized,
    
    -- REVENUE
    ROUND(m.revenue_current::numeric, 2) AS stored_revenue_current,
    ROUND(m.calc_revenue_current::numeric, 2) AS calc_revenue_current,
    ROUND(m.revenue_ia::numeric, 2) AS stored_revenue_ia,
    ROUND(m.calc_revenue_ia::numeric, 2) AS calc_revenue_ia,
    ROUND(m.revenue_finalized::numeric, 2) AS stored_revenue_finalized,
    ROUND(m.calc_revenue_finalized::numeric, 2) AS calc_revenue_finalized,
    
    -- BASELINE REVENUE
    ROUND(m.baseline_revenue_current::numeric, 2) AS stored_baseline_rev_current,
    ROUND(m.calc_baseline_revenue_current::numeric, 2) AS calc_baseline_rev_current,
    ROUND(m.baseline_revenue_ia::numeric, 2) AS stored_baseline_rev_ia,
    ROUND(m.calc_baseline_revenue_ia::numeric, 2) AS calc_baseline_rev_ia,
    ROUND(m.baseline_revenue_finalized::numeric, 2) AS stored_baseline_rev_finalized,
    ROUND(m.calc_baseline_revenue_finalized::numeric, 2) AS calc_baseline_rev_finalized,
    
    -- GM$
    ROUND(m.gm_dollar_current::numeric, 2) AS stored_gm_dollar_current,
    ROUND(m.calc_gm_dollar_current::numeric, 2) AS calc_gm_dollar_current,
    ROUND(m.gm_dollar_ia::numeric, 2) AS stored_gm_dollar_ia,
    ROUND(m.calc_gm_dollar_ia::numeric, 2) AS calc_gm_dollar_ia,
    ROUND(m.gm_dollar_finalized::numeric, 2) AS stored_gm_dollar_finalized,
    ROUND(m.calc_gm_dollar_finalized::numeric, 2) AS calc_gm_dollar_finalized,
    
    -- BASELINE GM$
    ROUND(m.baseline_gm_dollar_current::numeric, 2) AS stored_baseline_gm_current,
    ROUND(m.calc_baseline_gm_dollar_current::numeric, 2) AS calc_baseline_gm_current,
    ROUND(m.baseline_gm_dollar_ia::numeric, 2) AS stored_baseline_gm_ia,
    ROUND(m.calc_baseline_gm_dollar_ia::numeric, 2) AS calc_baseline_gm_ia,
    ROUND(m.baseline_gm_dollar_finalized::numeric, 2) AS stored_baseline_gm_finalized,
    ROUND(m.calc_baseline_gm_dollar_finalized::numeric, 2) AS calc_baseline_gm_finalized,
    
    -- GM%
    ROUND(m.gm_pct_current::numeric, 2) AS stored_gm_pct_current,
    ROUND(m.calc_gm_pct_current::numeric, 2) AS calc_gm_pct_current,
    ROUND(m.gm_pct_ia::numeric, 2) AS stored_gm_pct_ia,
    ROUND(m.calc_gm_pct_ia::numeric, 2) AS calc_gm_pct_ia,
    ROUND(m.gm_pct_finalized::numeric, 2) AS stored_gm_pct_finalized,
    ROUND(m.calc_gm_pct_finalized::numeric, 2) AS calc_gm_pct_finalized,
    
    -- BASELINE GM%
    ROUND(m.baseline_gm_pct_current::numeric, 2) AS stored_baseline_gm_pct_current,
    ROUND(m.calc_baseline_gm_pct_current::numeric, 2) AS calc_baseline_gm_pct_current,
    ROUND(m.baseline_gm_pct_ia::numeric, 2) AS stored_baseline_gm_pct_ia,
    ROUND(m.calc_baseline_gm_pct_ia::numeric, 2) AS calc_baseline_gm_pct_ia,
    ROUND(m.baseline_gm_pct_finalized::numeric, 2) AS stored_baseline_gm_pct_finalized,
    ROUND(m.calc_baseline_gm_pct_finalized::numeric, 2) AS calc_baseline_gm_pct_finalized,
    
    -- ASP
    ROUND(m.asp_current::numeric, 2) AS stored_asp_current,
    ROUND(m.calc_asp_current::numeric, 2) AS calc_asp_current,
    ROUND(m.asp_ia::numeric, 2) AS stored_asp_ia,
    ROUND(m.calc_asp_ia::numeric, 2) AS calc_asp_ia,
    ROUND(m.asp_finalized::numeric, 2) AS stored_asp_finalized,
    ROUND(m.calc_asp_finalized::numeric, 2) AS calc_asp_finalized,
    
    -- AUM
    ROUND(m.aum_current::numeric, 2) AS stored_aum_current,
    ROUND(m.calc_aum_current::numeric, 2) AS calc_aum_current,
    ROUND(m.aum_ia::numeric, 2) AS stored_aum_ia,
    ROUND(m.calc_aum_ia::numeric, 2) AS calc_aum_ia,
    ROUND(m.aum_finalized::numeric, 2) AS stored_aum_finalized,
    ROUND(m.calc_aum_finalized::numeric, 2) AS calc_aum_finalized,

    -- BASELINE ASP
    ROUND(m.baseline_asp_current::numeric, 2) AS stored_baseline_asp_current,
    ROUND(m.calc_baseline_asp_current::numeric, 2) AS calc_baseline_asp_current,
    ROUND(m.baseline_asp_ia::numeric, 2) AS stored_baseline_asp_ia,
    ROUND(m.calc_baseline_asp_ia::numeric, 2) AS calc_baseline_asp_ia,
    ROUND(m.baseline_asp_finalized::numeric, 2) AS stored_baseline_asp_finalized,
    ROUND(m.calc_baseline_asp_finalized::numeric, 2) AS calc_baseline_asp_finalized,

    -- BASELINE AUM
    ROUND(m.baseline_aum_current::numeric, 2) AS stored_baseline_aum_current,
    ROUND(m.calc_baseline_aum_current::numeric, 2) AS calc_baseline_aum_current,
    ROUND(m.baseline_aum_ia::numeric, 2) AS stored_baseline_aum_ia,
    ROUND(m.calc_baseline_aum_ia::numeric, 2) AS calc_baseline_aum_ia,
    ROUND(m.baseline_aum_finalized::numeric, 2) AS stored_baseline_aum_finalized,
    ROUND(m.calc_baseline_aum_finalized::numeric, 2) AS calc_baseline_aum_finalized,

    -- DEBUG
    m.store_count,
    m.week_count,
    m.granular_row_count,
    ROUND(m.avg_min_cost::numeric, 2) AS min_cost,
    ROUND(m.avg_price_point::numeric, 2) AS price_point,
    ROUND(m.avg_base_percentage::numeric, 4) AS base_percentage,
    ROUND(m.avg_elasticity::numeric, 4) AS elasticity,
    ROUND(m.avg_promo_elasticity::numeric, 4) AS promo_elasticity,
    ROUND(m.avg_promo_pct::numeric, 4) AS promo_pct,
    m.promo_source,
    ROUND(m.avg_effective_ref_price::numeric, 2) AS effective_ref_price,
    ROUND(m.effective_promo_pct::numeric, 4) AS effective_promo_pct,
    ROUND((m.effective_promo_pct * 100)::numeric, 4) AS calc_promo_pct_display,
    
    -- STORED PROMOTION
    ROUND(COALESCE(m.promo_applied_current, 0)::numeric, 4) AS stored_promo_current,
    ROUND(COALESCE(m.promo_applied_ia, 0)::numeric, 4) AS stored_promo_ia,
    ROUND(COALESCE(m.promo_applied_finalized, 0)::numeric, 4) AS stored_promo_finalized,
    
    ROUND(m.sim_markup_current::numeric, 4) AS markup_current,
    ROUND(m.sim_markup_ia::numeric, 4) AS markup_ia,
    ROUND(m.sim_markup_finalized::numeric, 4) AS markup_fin,
    
    -- STORED ACTUALS FROM RECO TABLES (all 3)
    -- Current
    ROUND(m.stored_actuals_sales_current::numeric, 0) AS reco_actuals_sales_current,
    ROUND(m.stored_actuals_revenue_current::numeric, 2) AS reco_actuals_revenue_current,
    ROUND(m.stored_actuals_gm_dollar_current::numeric, 2) AS reco_actuals_gm_dollar_current,
    ROUND(m.stored_actuals_gm_pct_current::numeric, 2) AS reco_actuals_gm_pct_current,
    ROUND(m.stored_actuals_asp_current::numeric, 2) AS reco_actuals_asp_current,
    ROUND(m.stored_actuals_aum_current::numeric, 2) AS reco_actuals_aum_current,
    -- IA
    ROUND(m.stored_actuals_sales_ia::numeric, 0) AS reco_actuals_sales_ia,
    ROUND(m.stored_actuals_revenue_ia::numeric, 2) AS reco_actuals_revenue_ia,
    ROUND(m.stored_actuals_gm_dollar_ia::numeric, 2) AS reco_actuals_gm_dollar_ia,
    ROUND(m.stored_actuals_gm_pct_ia::numeric, 2) AS reco_actuals_gm_pct_ia,
    ROUND(m.stored_actuals_asp_ia::numeric, 2) AS reco_actuals_asp_ia,
    ROUND(m.stored_actuals_aum_ia::numeric, 2) AS reco_actuals_aum_ia,
    -- Finalized
    ROUND(m.stored_actuals_sales_finalized::numeric, 0) AS reco_actuals_sales_finalized,
    ROUND(m.stored_actuals_revenue_finalized::numeric, 2) AS reco_actuals_revenue_finalized,
    ROUND(m.stored_actuals_gm_dollar_finalized::numeric, 2) AS reco_actuals_gm_dollar_finalized,
    ROUND(m.stored_actuals_gm_pct_finalized::numeric, 2) AS reco_actuals_gm_pct_finalized,
    ROUND(m.stored_actuals_asp_finalized::numeric, 2) AS reco_actuals_asp_finalized,
    ROUND(m.stored_actuals_aum_finalized::numeric, 2) AS reco_actuals_aum_finalized,

    bi.price_lock_val AS price_lock,
    bi.zone_exception_val AS zone_exception,
    
    -- MATCH INDICATORS (comparing ROUNDED values with ABS diff to handle numeric precision)
    CASE WHEN ABS(COALESCE(m.effective_promo_pct * 100, 0) - COALESCE(m.promo_applied_current, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS promo_current_match,
    CASE WHEN ABS(COALESCE(m.effective_promo_pct * 100, 0) - COALESCE(m.promo_applied_ia, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS promo_ia_match,
    CASE WHEN ABS(COALESCE(m.effective_promo_pct * 100, 0) - COALESCE(m.promo_applied_finalized, 0)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS promo_finalized_match,
    
    -- Sales units: exact match on rounded values (integers) - no tolerance
    CASE WHEN ROUND(COALESCE(m.sales_units_current, 0)::numeric, 0) = m.rounded_sales_current THEN 'MATCH' ELSE 'MISMATCH' END AS sales_current_match,
    CASE WHEN ROUND(COALESCE(m.sales_units_ia, 0)::numeric, 0) = m.rounded_sales_ia THEN 'MATCH' ELSE 'MISMATCH' END AS sales_ia_match,
    CASE WHEN ROUND(COALESCE(m.sales_units_finalized, 0)::numeric, 0) = m.rounded_sales_finalized THEN 'MATCH' ELSE 'MISMATCH' END AS sales_finalized_match,
    
    -- Baseline: exact match on rounded values (integers) - no tolerance
    CASE WHEN ROUND(COALESCE(m.baseline_sales_current, 0)::numeric, 0) = m.rounded_baseline_current THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_current_match,
    CASE WHEN ROUND(COALESCE(m.baseline_sales_ia, 0)::numeric, 0) = m.rounded_baseline_ia THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_ia_match,
    CASE WHEN ROUND(COALESCE(m.baseline_sales_finalized, 0)::numeric, 0) = m.rounded_baseline_finalized THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_finalized_match,
    
    -- Revenue: ABS diff on rounded values (2 decimals) - tolerance < 0.01
    CASE WHEN ABS(ROUND(COALESCE(m.revenue_current, 0)::numeric, 2) - m.calc_revenue_current) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS revenue_current_match,
    CASE WHEN ABS(ROUND(COALESCE(m.revenue_ia, 0)::numeric, 2) - m.calc_revenue_ia) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS revenue_ia_match,
    CASE WHEN ABS(ROUND(COALESCE(m.revenue_finalized, 0)::numeric, 2) - m.calc_revenue_finalized) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS revenue_finalized_match,
    
    -- Baseline revenue: ABS diff on rounded values (2 decimals) - tolerance < 0.01
    CASE WHEN ABS(ROUND(COALESCE(m.baseline_revenue_current, 0)::numeric, 2) - m.calc_baseline_revenue_current) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_rev_current_match,
    CASE WHEN ABS(ROUND(COALESCE(m.baseline_revenue_ia, 0)::numeric, 2) - m.calc_baseline_revenue_ia) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_rev_ia_match,
    CASE WHEN ABS(ROUND(COALESCE(m.baseline_revenue_finalized, 0)::numeric, 2) - m.calc_baseline_revenue_finalized) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_rev_finalized_match,
    
    -- GM$: ABS diff on rounded values (2 decimals) - tolerance < 0.01
    CASE WHEN ABS(ROUND(COALESCE(m.gm_dollar_current, 0)::numeric, 2) - m.calc_gm_dollar_current) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS gm_dollar_current_match,
    CASE WHEN ABS(ROUND(COALESCE(m.gm_dollar_ia, 0)::numeric, 2) - m.calc_gm_dollar_ia) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS gm_dollar_ia_match,
    CASE WHEN ABS(ROUND(COALESCE(m.gm_dollar_finalized, 0)::numeric, 2) - m.calc_gm_dollar_finalized) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS gm_dollar_finalized_match,
    
    -- Baseline GM$: ABS diff on rounded values (2 decimals) - tolerance < 0.01
    CASE WHEN ABS(ROUND(COALESCE(m.baseline_gm_dollar_current, 0)::numeric, 2) - m.calc_baseline_gm_dollar_current) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_gm_current_match,
    CASE WHEN ABS(ROUND(COALESCE(m.baseline_gm_dollar_ia, 0)::numeric, 2) - m.calc_baseline_gm_dollar_ia) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_gm_ia_match,
    CASE WHEN ABS(ROUND(COALESCE(m.baseline_gm_dollar_finalized, 0)::numeric, 2) - m.calc_baseline_gm_dollar_finalized) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_gm_finalized_match,
    
    -- GM%: ABS diff on rounded values (2 decimals) - tolerance < 0.01
    CASE WHEN ABS(ROUND(COALESCE(m.gm_pct_current, 0)::numeric, 2) - m.calc_gm_pct_current) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS gm_pct_current_match,
    CASE WHEN ABS(ROUND(COALESCE(m.gm_pct_ia, 0)::numeric, 2) - m.calc_gm_pct_ia) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS gm_pct_ia_match,
    CASE WHEN ABS(ROUND(COALESCE(m.gm_pct_finalized, 0)::numeric, 2) - m.calc_gm_pct_finalized) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS gm_pct_finalized_match,
    
    -- Baseline GM%: ABS diff on rounded values (2 decimals) - tolerance < 0.01
    CASE WHEN ABS(ROUND(COALESCE(m.baseline_gm_pct_current, 0)::numeric, 2) - m.calc_baseline_gm_pct_current) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_gm_pct_current_match,
    CASE WHEN ABS(ROUND(COALESCE(m.baseline_gm_pct_ia, 0)::numeric, 2) - m.calc_baseline_gm_pct_ia) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_gm_pct_ia_match,
    CASE WHEN ABS(ROUND(COALESCE(m.baseline_gm_pct_finalized, 0)::numeric, 2) - m.calc_baseline_gm_pct_finalized) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_gm_pct_finalized_match,
    
    -- ASP: ABS diff on rounded values (2 decimals) - tolerance < 0.01
    CASE WHEN ABS(ROUND(COALESCE(m.asp_current, 0)::numeric, 2) - m.calc_asp_current) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS asp_current_match,
    CASE WHEN ABS(ROUND(COALESCE(m.asp_ia, 0)::numeric, 2) - m.calc_asp_ia) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS asp_ia_match,
    CASE WHEN ABS(ROUND(COALESCE(m.asp_finalized, 0)::numeric, 2) - m.calc_asp_finalized) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS asp_finalized_match,
    
    -- AUM: ABS diff on rounded values (2 decimals) - tolerance < 0.01
    CASE WHEN ABS(ROUND(COALESCE(m.aum_current, 0)::numeric, 2) - m.calc_aum_current) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS aum_current_match,
    CASE WHEN ABS(ROUND(COALESCE(m.aum_ia, 0)::numeric, 2) - m.calc_aum_ia) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS aum_ia_match,
    CASE WHEN ABS(ROUND(COALESCE(m.aum_finalized, 0)::numeric, 2) - m.calc_aum_finalized) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS aum_finalized_match,

    -- Baseline ASP: ABS diff on rounded values (2 decimals) - tolerance < 0.01
    CASE WHEN ABS(ROUND(COALESCE(m.baseline_asp_current, 0)::numeric, 2) - m.calc_baseline_asp_current) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_asp_current_match,
    CASE WHEN ABS(ROUND(COALESCE(m.baseline_asp_ia, 0)::numeric, 2) - m.calc_baseline_asp_ia) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_asp_ia_match,
    CASE WHEN ABS(ROUND(COALESCE(m.baseline_asp_finalized, 0)::numeric, 2) - m.calc_baseline_asp_finalized) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_asp_finalized_match,

    -- Baseline AUM: ABS diff on rounded values (2 decimals) - tolerance < 0.01
    CASE WHEN ABS(ROUND(COALESCE(m.baseline_aum_current, 0)::numeric, 2) - m.calc_baseline_aum_current) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_aum_current_match,
    CASE WHEN ABS(ROUND(COALESCE(m.baseline_aum_ia, 0)::numeric, 2) - m.calc_baseline_aum_ia) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_aum_ia_match,
    CASE WHEN ABS(ROUND(COALESCE(m.baseline_aum_finalized, 0)::numeric, 2) - m.calc_baseline_aum_finalized) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS baseline_aum_finalized_match,

    -- ACTUALS MATCH INDICATORS (stored in reco vs calculated from transaction table)
    -- Sales Units: exact match on rounded (integers) - no tolerance
    CASE WHEN ROUND(COALESCE(m.stored_actuals_sales_current, 0)::numeric, 0) = ROUND(COALESCE(m.actual_sales_units, 0)::numeric, 0) THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_sales_current_match,
    CASE WHEN ROUND(COALESCE(m.stored_actuals_sales_ia, 0)::numeric, 0) = ROUND(COALESCE(m.actual_sales_units, 0)::numeric, 0) THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_sales_ia_match,
    CASE WHEN ROUND(COALESCE(m.stored_actuals_sales_finalized, 0)::numeric, 0) = ROUND(COALESCE(m.actual_sales_units, 0)::numeric, 0) THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_sales_finalized_match,
    -- Revenue: ABS diff on rounded (2 decimals) - tolerance < 0.01
    CASE WHEN ABS(ROUND(COALESCE(m.stored_actuals_revenue_current, 0)::numeric, 2) - ROUND(COALESCE(m.actual_revenue, 0)::numeric, 2)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_revenue_current_match,
    CASE WHEN ABS(ROUND(COALESCE(m.stored_actuals_revenue_ia, 0)::numeric, 2) - ROUND(COALESCE(m.actual_revenue, 0)::numeric, 2)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_revenue_ia_match,
    CASE WHEN ABS(ROUND(COALESCE(m.stored_actuals_revenue_finalized, 0)::numeric, 2) - ROUND(COALESCE(m.actual_revenue, 0)::numeric, 2)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_revenue_finalized_match,
    -- GM$: ABS diff on rounded (2 decimals) - tolerance < 0.01
    CASE WHEN ABS(ROUND(COALESCE(m.stored_actuals_gm_dollar_current, 0)::numeric, 2) - ROUND(COALESCE(m.actual_gm_dollar, 0)::numeric, 2)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_gm_dollar_current_match,
    CASE WHEN ABS(ROUND(COALESCE(m.stored_actuals_gm_dollar_ia, 0)::numeric, 2) - ROUND(COALESCE(m.actual_gm_dollar, 0)::numeric, 2)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_gm_dollar_ia_match,
    CASE WHEN ABS(ROUND(COALESCE(m.stored_actuals_gm_dollar_finalized, 0)::numeric, 2) - ROUND(COALESCE(m.actual_gm_dollar, 0)::numeric, 2)) <= 0.01 THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_gm_dollar_finalized_match,
    -- GM%: ABS diff on rounded (2 decimals) - tolerance < 0.01 (using weighted averages)
    CASE WHEN ABS(ROUND(COALESCE(m.stored_actuals_gm_pct_current, 0)::numeric, 2) - 
              ROUND(COALESCE(m.actual_gm_pct, 0)::numeric, 2)) < 0.01
         THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_gm_pct_current_match,
    CASE WHEN ABS(ROUND(COALESCE(m.stored_actuals_gm_pct_ia, 0)::numeric, 2) - 
              ROUND(COALESCE(m.actual_gm_pct, 0)::numeric, 2)) < 0.01
         THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_gm_pct_ia_match,
    CASE WHEN ABS(ROUND(COALESCE(m.stored_actuals_gm_pct_finalized, 0)::numeric, 2) - 
              ROUND(COALESCE(m.actual_gm_pct, 0)::numeric, 2)) < 0.01
         THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_gm_pct_finalized_match,
    -- ASP: ABS diff on rounded (2 decimals) - tolerance < 0.01 (using weighted averages)
    CASE WHEN ABS(ROUND(COALESCE(m.stored_actuals_asp_current, 0)::numeric, 2) - 
              ROUND(COALESCE(m.actual_asp, 0)::numeric, 2)) < 0.01
         THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_asp_current_match,
    CASE WHEN ABS(ROUND(COALESCE(m.stored_actuals_asp_ia, 0)::numeric, 2) - 
              ROUND(COALESCE(m.actual_asp, 0)::numeric, 2)) < 0.01
         THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_asp_ia_match,
    CASE WHEN ABS(ROUND(COALESCE(m.stored_actuals_asp_finalized, 0)::numeric, 2) - 
              ROUND(COALESCE(m.actual_asp, 0)::numeric, 2)) < 0.01
         THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_asp_finalized_match,
    -- AUM: ABS diff on rounded (2 decimals) - tolerance < 0.01 (using weighted averages)
    CASE WHEN ABS(ROUND(COALESCE(m.stored_actuals_aum_current, 0)::numeric, 2) - 
              ROUND(COALESCE(m.actual_aum, 0)::numeric, 2)) < 0.01
         THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_aum_current_match,
    CASE WHEN ABS(ROUND(COALESCE(m.stored_actuals_aum_ia, 0)::numeric, 2) - 
              ROUND(COALESCE(m.actual_aum, 0)::numeric, 2)) < 0.01
         THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_aum_ia_match,
    CASE WHEN ABS(ROUND(COALESCE(m.stored_actuals_aum_finalized, 0)::numeric, 2) - 
              ROUND(COALESCE(m.actual_aum, 0)::numeric, 2)) < 0.01
         THEN 'MATCH' ELSE 'MISMATCH' END AS actuals_aum_finalized_match

FROM final_metrics m
LEFT JOIN bin_identity bi ON m.opt_level_bins = bi.opt_level_bins AND m.product_id = bi.product_id
ORDER BY 
    sales_current_match DESC, baseline_current_match DESC,
    revenue_current_match DESC, gm_dollar_current_match DESC,
    m.product_id
"""

    # =========================================================================
    # MAIN QUERY BUILDER
    # =========================================================================
    
    def build_validation_query(self, strategy_id: int) -> str:
        """Build the complete validation query dynamically.
        
        Routes to appropriate mode based on strategy status:
        - Status 210 (Active) or 220 (Completed): Uses actuals + forecast blend
        - Other statuses: Pure forecast approach
        """
        status = self.get_strategy_status(strategy_id)
        include_actuals = status in (210, 220)
        return self._build_unified_query(strategy_id, include_actuals)
    
    def _build_unified_query(self, strategy_id: int, include_actuals: bool) -> str:
        """Build unified validation query with optional actuals blending."""
        
        config = self.get_config()
        hierarchy_list = config['hierarchy_list']
        channel_col = config['channel_column']
        channel_name_col = config['channel_name_column']
        kvi_col = config['kvi_column']
        price_lock_col = config['price_lock_column']
        zone_exception_col = config['zone_exception_column']
        
        hierarchy_select = ", ".join([f"pm.{h}" for h in hierarchy_list])
        hierarchy_join_day_split = self._build_hierarchy_join("d", "pcs", hierarchy_list)
        hierarchy_join_store_split = self._build_hierarchy_join("ss", "sph", hierarchy_list)
        
        mode_label = "ACTUALS + FORECAST" if include_actuals else "FORECAST-ONLY"
        
        query_header = f"""
-- ============================================
-- VALIDATION QUERY ({mode_label})
-- Strategy ID: {strategy_id}
-- Schema: {self.schema}
-- Include Actuals: {include_actuals}
-- Hierarchy: {', '.join(hierarchy_list)}
-- ============================================
"""
        
        # Build query from helper methods
        query_parts = [
            query_header,
            self._build_base_ctes(strategy_id, hierarchy_select, kvi_col, 
                                  price_lock_col, zone_exception_col, channel_col,
                                  channel_name_col, include_actuals)
        ]
        
        if include_actuals:
            query_parts.append(self._build_actuals_cte())
        
        query_parts.extend([
            self._build_reco_ctes(strategy_id),
            self._build_forecast_ctes(hierarchy_join_day_split, hierarchy_join_store_split, include_actuals),
            self._build_combined_metrics_cte(include_actuals),
            self._build_calculated_cte(include_actuals),
            self._build_metrics_cte(include_actuals),
            self._build_final_metrics_cte(),
            self._build_final_select(include_actuals)
        ])
        
        return "".join(query_parts)
    
    def validate(self, strategy_id: int, limit: Optional[int] = None) -> Dict:
        """Run validation for a strategy and return results with summary."""
        
        # First check if strategy exists
        strategy_check = self._execute_query(f"""
            SELECT strategy_id, strategy_name, start_date, end_date 
            FROM {self.schema}.bp_strategy_master 
            WHERE strategy_id = {strategy_id}
        """)
        
        if not strategy_check:
            return {
                "success": False,
                "strategy_id": strategy_id,
                "error": f"Strategy {strategy_id} not found in {self.schema}",
                "summary": None,
                "results": []
            }
        
        strategy_info = strategy_check[0]
        
        query = self.build_validation_query(strategy_id)
        
        if limit:
            query = f"{query} LIMIT {limit}"
        
        results = self._execute_query(query)
        
        # Calculate summary stats
        total = len(results)
        if total == 0:
            return {
                "success": True,
                "strategy_id": strategy_id,
                "strategy_name": strategy_info.get('strategy_name'),
                "config": self.get_config(),
                "summary": {
                    "total_bins": 0,
                    "matches": {},
                    "mismatches": {}
                },
                "results": []
            }
        
        # Match columns
        match_cols = [
            'sales_current_match', 'sales_ia_match', 'sales_finalized_match',
            'baseline_current_match', 'baseline_ia_match', 'baseline_finalized_match',
            'revenue_current_match', 'revenue_ia_match', 'revenue_finalized_match',
            'baseline_rev_current_match', 'baseline_rev_ia_match', 'baseline_rev_finalized_match',
            'gm_dollar_current_match', 'gm_dollar_ia_match', 'gm_dollar_finalized_match',
            'baseline_gm_current_match', 'baseline_gm_ia_match', 'baseline_gm_finalized_match',
            'gm_pct_current_match', 'gm_pct_ia_match', 'gm_pct_finalized_match',
            'baseline_gm_pct_current_match', 'baseline_gm_pct_ia_match', 'baseline_gm_pct_finalized_match',
            'asp_current_match', 'asp_ia_match', 'asp_finalized_match',
            'aum_current_match', 'aum_ia_match', 'aum_finalized_match',
            'baseline_asp_current_match', 'baseline_asp_ia_match', 'baseline_asp_finalized_match',
            'baseline_aum_current_match', 'baseline_aum_ia_match', 'baseline_aum_finalized_match',
            # Actuals match columns
            'actuals_sales_current_match', 'actuals_sales_ia_match', 'actuals_sales_finalized_match',
            'actuals_revenue_current_match', 'actuals_revenue_ia_match', 'actuals_revenue_finalized_match',
            'actuals_gm_dollar_current_match', 'actuals_gm_dollar_ia_match', 'actuals_gm_dollar_finalized_match',
            'actuals_gm_pct_current_match', 'actuals_gm_pct_ia_match', 'actuals_gm_pct_finalized_match',
            'actuals_asp_current_match', 'actuals_asp_ia_match', 'actuals_asp_finalized_match',
            'actuals_aum_current_match', 'actuals_aum_ia_match', 'actuals_aum_finalized_match'
        ]
        
        summary = {
            "total_bins": total,
            "matches": {},
            "mismatches": {}
        }
        
        for col in match_cols:
            match_count = sum(1 for r in results if r.get(col) == 'MATCH')
            mismatch_count = sum(1 for r in results if r.get(col) == 'MISMATCH')
            summary["matches"][col] = match_count
            summary["mismatches"][col] = mismatch_count
        
        all_match = all(summary["mismatches"][col] == 0 for col in match_cols)
        
        return {
            "success": True,
            "strategy_id": strategy_id,
            "strategy_name": strategy_info.get('strategy_name'),
            "config": self.get_config(),
            "all_matched": all_match,
            "summary": summary,
            "results": results
        }
    
    def get_query(self, strategy_id: int) -> str:
        """Get the generated SQL query for inspection."""
        return self.build_validation_query(strategy_id)


# Module-level instance
reco_metrics_validator = RecoMetricsValidator()
