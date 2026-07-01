"""
bp_monthly_forecast_actuals validator.
Validates rows in bp_monthly_forecast_actuals by recomputing from transaction tables
(bp_transaction_data_monthly for FULL_MONTH, bp_transaction_data_daily for PARTIAL).
Uses the shared database connection from database.py.
"""

from app.core.database import db
from typing import Dict, List, Optional
from datetime import date


class BpMonthlyForecastActualsValidator:
    """Validates bp_monthly_forecast_actuals against recomputed-from-transaction values.

    Uses the shared db connection from database.py.
    """
    
    def __init__(self):
        self._config_cache = None
        self._fiscal_cache = None
    
    @property
    def schema(self) -> str:
        """Get current schema from shared db connection."""
        return db.db_schema
    
    def is_connected(self) -> bool:
        """Check if connected to database."""
        return db.is_connected()
    
    def _execute_query(self, query: str, params: tuple = None) -> list:
        """Execute query using shared db connection."""
        if not db.is_connected():
            raise Exception("Not connected to database. Please connect first.")
        return db.execute_query(query, params)
    
    def get_config(self) -> Dict:
        """Fetch dynamic configuration from database tables (same as forecast_validator)."""
        if self._config_cache:
            return self._config_cache
        
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
        
        self._config_cache = {
            'kvi_column': kvi_column,
            'price_lock_column': price_lock_column,
            'zone_exception_column': zone_exception_column,
            'channel_column': channel_column,
            'channel_name_column': channel_column.replace('_cid', '_name'),  # for bin_identity.channel_name
        }
        
        return self._config_cache
    
    def clear_cache(self):
        """Clear configuration cache."""
        self._config_cache = None
        self._fiscal_cache = None
    
    # =========================================================================
    # CONFIG METHODS
    # =========================================================================
    
    def get_forecast_cal_config(self) -> List[Dict]:
        """Fetch forecast calendar configuration."""
        query = f"""
            SELECT 
                forecast_type,
                label,
                projection_mode,
                start_reference,
                end_reference,
                cumulative_quarters,
                is_active,
                default_selected,
                display_order,
                disable_selection
            FROM {self.schema}.bp_forecast_cal_config
            WHERE is_active = true
            ORDER BY display_order
        """
        return self._execute_query(query)
    
    def get_strategy_info(self, strategy_id: int) -> Dict:
        """Get strategy details."""
        query = f"""
            SELECT 
                strategy_id,
                strategy_name,
                start_date,
                end_date,
                strategy_status_id
            FROM {self.schema}.bp_strategy_master
            WHERE strategy_id = {strategy_id}
        """
        result = self._execute_query(query)
        return result[0] if result else None
    
    def get_fiscal_calendar(self, start_date: date, end_date: date) -> List[Dict]:
        """Get fiscal calendar data for a date range."""
        query = f"""
            SELECT DISTINCT
                fiscal_year,
                fiscal_quarter,
                fiscal_month,
                fiscal_fd_year,
                fiscal_ld_year,
                fiscal_fd_qtr,
                fiscal_ld_qtr,
                fiscal_fd_month,
                fiscal_ld_month,
                month_name
            FROM global.tb_fiscal_date_mapping
            WHERE date_id BETWEEN '{start_date}' AND '{end_date}'
            ORDER BY fiscal_year, fiscal_month
        """
        return self._execute_query(query)
    
    def get_fiscal_year_for_date(self, target_date: date) -> Dict:
        """Get fiscal year info for a specific date."""
        query = f"""
            SELECT 
                fiscal_year,
                fiscal_quarter,
                fiscal_month,
                fiscal_fd_year,
                fiscal_ld_year,
                fiscal_fd_qtr,
                fiscal_ld_qtr
            FROM global.tb_fiscal_date_mapping
            WHERE date_id = '{target_date}'
            LIMIT 1
        """
        result = self._execute_query(query)
        return result[0] if result else None
    
    # =========================================================================
    # MONTHLY ACTUALS VALIDATION
    # =========================================================================
    
    def get_stored_monthly_actuals(self, strategy_id: int) -> List[Dict]:
        """Get stored monthly actuals from bp_monthly_forecast_actuals."""
        query = f"""
            SELECT 
                id,
                strategy_id,
                opt_level_bins,
                product_id,
                segment_id,
                channel_id,
                price_zone,
                line_group,
                fiscal_year,
                fiscal_month,
                fiscal_month_name,
                range_start_date,
                range_end_date,
                coverage,
                sales_units AS stored_sales_units,
                revenue AS stored_revenue,
                gross_margin_dollar AS stored_gm_dollar
            FROM {self.schema}.bp_monthly_forecast_actuals
            WHERE strategy_id = {strategy_id}
            ORDER BY opt_level_bins, fiscal_year, fiscal_month
        """
        return self._execute_query(query)
    
    def build_monthly_actuals_validation_query(self, strategy_id: int) -> str:
        """Build query to validate monthly actuals against transaction data.
        
        Compares:
        - bp_monthly_forecast_actuals (stored)
        - bp_transaction_data_monthly for FULL_MONTH records
        - bp_transaction_data_daily for PARTIAL month records
        
        Uses same two-stage approach as forecast_validator:
        1. actuals_granular: product/store/segment level with direct calculations
        2. actuals_by_bin: bin level with weighted averages for rates
        """
        config = self.get_config()
        price_lock_col = config['price_lock_column']
        zone_exception_col = config['zone_exception_column']
        channel_col = config['channel_column']
        channel_name_col = config['channel_name_column']

        query = f"""
-- ============================================
-- MONTHLY ACTUALS VALIDATION
-- Strategy ID: {strategy_id}
-- Schema: {self.schema}
-- FULL_MONTH: bp_transaction_data_monthly
-- PARTIAL: bp_transaction_data_daily
-- Two-stage approach: granular -> weighted avg at bin
-- ============================================

WITH strategy_params AS (
    SELECT 
        strategy_id,
        start_date,
        end_date
    FROM {self.schema}.bp_strategy_master
    WHERE strategy_id = {strategy_id}
),

-- Get max actuals date from transaction data (global max, not limited to strategy period)
max_actuals AS (
    SELECT MAX(transaction_date) AS max_actuals_date
    FROM {self.schema}.bp_transaction_data_daily
),

-- ----- Active-FY resolution (same chain used by forecast/summary validators) -----
-- single-FY strategy  -> use strategy's FY
-- multi-FY strategy   -> use today's FY
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

-- Quarter bounds within the active FY (needed to resolve FISCAL_YEAR_Qx configs).
quarter_dates AS (
    SELECT fdm.fiscal_quarter,
           MIN(fdm.fiscal_fd_qtr) AS quarter_start,
           MAX(fdm.fiscal_ld_qtr) AS quarter_end
    FROM global.tb_fiscal_date_mapping fdm
    CROSS JOIN fiscal_info fi
    WHERE fdm.fiscal_year = fi.fiscal_year
    GROUP BY fdm.fiscal_quarter
),

-- All active forecast configs resolved to (resolved_start, resolved_end).
-- Excludes CURRENT_STRATEGY_PERIOD (handled by the reco-side validator).
forecast_configs_resolved AS (
    SELECT
        fc.forecast_type,
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
    FROM {self.schema}.bp_forecast_cal_config fc
    CROSS JOIN fiscal_info fi
    CROSS JOIN strategy_params sp
    WHERE fc.is_active = true
      AND fc.forecast_type != 'CURRENT_STRATEGY_PERIOD'
),

-- Visibility floor: derived from the FISCAL_YEAR config's resolved_start.
--   FY config = fiscal_year_start   -> floor = active FY start  (validate all FY months)
--   FY config = strategy_start_date -> floor = strategy_start   (skip pre-strategy periods)
-- Keeps this validator in sync with the forecast + summary-cards validators.
visibility_floor AS (
    SELECT COALESCE(
        (SELECT resolved_start FROM forecast_configs_resolved
         WHERE forecast_type = 'FISCAL_YEAR' LIMIT 1),
        (SELECT fi.fiscal_fd_year FROM fiscal_info fi)
    ) AS floor_date
),

-- Drop configs whose entire range ends before the floor (e.g. Q1/Q2 when strategy starts in Q3).
-- Pre-floor months within still-visible periods (like Q3's first months) DO surface, matching
-- how the summary-cards validator treats partially-overlapping periods.
forecast_configs_visible AS (
    SELECT fcr.*
    FROM forecast_configs_resolved fcr
    CROSS JOIN visibility_floor vf
    WHERE fcr.resolved_start IS NOT NULL
      AND fcr.resolved_end   IS NOT NULL
      AND fcr.resolved_end  >= vf.floor_date
),

-- Validation range: floor on the left, LEAST(MAX(visible), max_actuals_date) on the right.
-- Even when a visible config (e.g. Q3) starts before the floor, we clip to the floor —
-- so the pre-strategy portion of an overlapping quarter is excluded, not validated.
validation_range AS (
    SELECT
        COALESCE((SELECT floor_date FROM visibility_floor),
                 (SELECT start_date FROM strategy_params)) AS range_start,
        LEAST(
            COALESCE(MAX(resolved_end), (SELECT end_date FROM strategy_params)),
            (SELECT max_actuals_date FROM max_actuals)
        ) AS range_end
    FROM forecast_configs_visible
),

-- Backwards-compat alias for the rest of the query, which references fr.fiscal_year_start /
-- fr.fiscal_year_end / ma.max_actuals_date.
fiscal_range AS (
    SELECT
        vr.range_start AS fiscal_year_start,
        vr.range_end   AS fiscal_year_end,
        ma.max_actuals_date
    FROM validation_range vr
    CROSS JOIN max_actuals ma
),

-- Get all fiscal months with their date ranges and calculate coverage.
-- Scope is the validation_range from above (union of visible periods, clipped by max_actuals_date).
fiscal_months AS (
    SELECT DISTINCT
        f.fiscal_year,
        f.fiscal_month,
        f.month_name AS fiscal_month_name,
        f.fiscal_fd_month,
        f.fiscal_ld_month,
        ma.max_actuals_date,
        CASE
            WHEN f.fiscal_ld_month <= ma.max_actuals_date THEN 'FULL_MONTH'
            WHEN f.fiscal_fd_month <= ma.max_actuals_date THEN 'PARTIAL'
            ELSE 'NO_DATA'
        END AS calc_coverage,
        f.fiscal_fd_month AS range_start,
        CASE
            WHEN f.fiscal_ld_month <= ma.max_actuals_date THEN f.fiscal_ld_month
            ELSE ma.max_actuals_date
        END AS range_end
    FROM global.tb_fiscal_date_mapping f
    CROSS JOIN max_actuals ma
    CROSS JOIN fiscal_range fr
    WHERE f.fiscal_fd_month >= fr.fiscal_year_start
      AND f.fiscal_fd_month <= fr.fiscal_year_end
      AND f.fiscal_fd_month <= ma.max_actuals_date
),

strategy_products AS (
    SELECT DISTINCT product_id, store_id, segment_id
    FROM {self.schema}.bp_strategy_products_stores
    WHERE strategy_id = {strategy_id}
),

-- Bins mapping (same logic as forecast_validator)
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

-- Distinct bin set for the expected grid below.
our_bins AS (
    SELECT DISTINCT opt_level_bins, product_id
    FROM bins_mapping
),

-- Bin-level identity columns (product_code, channel_name, segment_name, etc).
-- Joined onto expected_grid in the final SELECT so output stays populated
-- even when the stored row is MISSING_STORED. Mirrors reco_metrics_validator.
-- line_group is pulled from bp_product_attributes_mapping.attributes (jsonb array of
-- {{attribute_name, attribute_value: {{current, initial}}}}) -- pick the 'current'
-- value of the row whose attribute_name = 'line_group'. Returns NULL if absent.
bin_identity AS (
    SELECT DISTINCT ON (bm.opt_level_bins, bm.product_id)
        bm.opt_level_bins,
        bm.product_id,
        pm.product_code,
        (
            SELECT attr->'attribute_value'->>'current'
            FROM jsonb_array_elements(pam.attributes) attr
            WHERE attr->>'attribute_name' = 'line_group'
            LIMIT 1
        ) AS line_group,
        sm.{channel_name_col} AS channel_name,
        bm.price_zone_display,
        COALESCE(csm.segment_name, 'Segment ' || bm.segment_id::text) AS segment_name,
        bm.price_lock_val,
        bm.zone_exception_val
    FROM bins_mapping bm
    INNER JOIN {self.schema}.bp_product_master pm ON bm.product_id = pm.product_id
    INNER JOIN {self.schema}.bp_store_master sm   ON bm.store_id   = sm.store_id
    LEFT JOIN {self.schema}.bp_customer_segment_master csm ON bm.segment_id = csm.segment_id
    LEFT JOIN {self.schema}.bp_product_attributes_mapping pam ON pam.product_id = bm.product_id
    ORDER BY bm.opt_level_bins, bm.product_id
),

-- Stored monthly actuals -- plain fetch only. No COALESCE; NULL columns mean
-- the stored side is missing for that (bin, month), which surfaces as MISSING_STORED.
stored_actuals AS (
    SELECT
        mfa.id,
        mfa.strategy_id,
        mfa.opt_level_bins,
        mfa.product_id,
        mfa.segment_id,
        mfa.channel_id,
        mfa.price_zone,
        mfa.line_group,
        mfa.fiscal_year,
        mfa.fiscal_month,
        mfa.range_start_date,
        mfa.range_end_date,
        mfa.coverage,
        mfa.sales_units                AS stored_sales_units,
        mfa.revenue                    AS stored_revenue,
        mfa.gross_margin_dollar        AS stored_gm_dollar,
        mfa.gross_margin_percentage    AS stored_gm_pct,
        mfa.asp                        AS stored_asp,
        mfa.aum                        AS stored_aum
    FROM {self.schema}.bp_monthly_forecast_actuals mfa
    WHERE mfa.strategy_id = {strategy_id}
),

-- STAGE 1A: Granular level for FULL_MONTH records (from monthly table)
actuals_granular_monthly AS (
    SELECT 
        bm.product_id,
        bm.store_id,
        bm.segment_id,
        fm.fiscal_year,
        fm.fiscal_month,
        fm.calc_coverage AS coverage,
        SUM(tm.sales_units) AS sales_units,
        SUM(tm.total_revenue) AS revenue,
        SUM(tm.total_margin) AS gm_dollar,
        CASE WHEN SUM(tm.sales_units) > 0 
             THEN SUM(tm.total_revenue) / SUM(tm.sales_units) 
             ELSE 0 END AS asp,
        CASE WHEN SUM(tm.sales_units) > 0 
             THEN SUM(tm.total_margin) / SUM(tm.sales_units) 
             ELSE 0 END AS aum,
        CASE WHEN SUM(tm.total_revenue) > 0 
             THEN (SUM(tm.total_margin) / SUM(tm.total_revenue)) * 100 
             ELSE 0 END AS gm_pct
    FROM bins_mapping bm
    INNER JOIN fiscal_months fm ON fm.calc_coverage = 'FULL_MONTH'
    INNER JOIN {self.schema}.bp_transaction_data_monthly tm
        ON bm.product_id = tm.product_id
        AND bm.store_id = tm.store_id
        AND bm.segment_id = tm.segment_id
        AND tm.fiscal_year = fm.fiscal_year
        AND tm.fiscal_month = fm.fiscal_month
    GROUP BY bm.product_id, bm.store_id, bm.segment_id,
             fm.fiscal_year, fm.fiscal_month, fm.calc_coverage
),

-- STAGE 1B: Granular level for PARTIAL records (from daily table, aggregated by date range)
actuals_granular_daily AS (
    SELECT 
        bm.product_id,
        bm.store_id,
        bm.segment_id,
        fm.fiscal_year,
        fm.fiscal_month,
        fm.calc_coverage AS coverage,
        SUM(td.sales_units) AS sales_units,
        SUM(td.total_revenue) AS revenue,
        SUM(td.total_margin) AS gm_dollar,
        CASE WHEN SUM(td.sales_units) > 0 
             THEN SUM(td.total_revenue) / SUM(td.sales_units) 
             ELSE 0 END AS asp,
        CASE WHEN SUM(td.sales_units) > 0 
             THEN SUM(td.total_margin) / SUM(td.sales_units) 
             ELSE 0 END AS aum,
        CASE WHEN SUM(td.total_revenue) > 0 
             THEN (SUM(td.total_margin) / SUM(td.total_revenue)) * 100 
             ELSE 0 END AS gm_pct
    FROM bins_mapping bm
    CROSS JOIN fiscal_months fm
    INNER JOIN {self.schema}.bp_transaction_data_daily td
        ON bm.product_id = td.product_id
        AND bm.store_id = td.store_id
        AND bm.segment_id = td.segment_id
        AND td.transaction_date BETWEEN fm.range_start AND fm.range_end
    WHERE fm.calc_coverage = 'PARTIAL'
    GROUP BY bm.product_id, bm.store_id, bm.segment_id,
             fm.fiscal_year, fm.fiscal_month, fm.calc_coverage
),

-- UNION both granular sources
actuals_granular AS (
    SELECT * FROM actuals_granular_monthly
    UNION ALL
    SELECT * FROM actuals_granular_daily
),

-- STAGE 2: Bin level - JOIN to get opt_level_bins, then weighted averages
actuals_by_bin AS (
    SELECT 
        bm.opt_level_bins,
        ag.product_id,
        ag.fiscal_year,
        ag.fiscal_month,
        ag.coverage,
        -- Sum the additive metrics
        SUM(ag.sales_units) AS calc_sales_units,
        SUM(ag.revenue) AS calc_revenue,
        SUM(ag.gm_dollar) AS calc_gm_dollar,
        COUNT(DISTINCT ag.store_id) AS stores_with_data,
        -- Weighted averages: SUM(rate * weight) / SUM(weight)
        CASE WHEN SUM(ag.sales_units) > 0 
             THEN SUM(ag.asp * ag.sales_units) / SUM(ag.sales_units) 
             ELSE 0 END AS calc_asp,
        CASE WHEN SUM(ag.sales_units) > 0 
             THEN SUM(ag.aum * ag.sales_units) / SUM(ag.sales_units) 
             ELSE 0 END AS calc_aum,
        CASE WHEN SUM(ag.sales_units) > 0 
             THEN SUM(ag.gm_pct * ag.sales_units) / SUM(ag.sales_units) 
             ELSE 0 END AS calc_gm_pct
    FROM actuals_granular ag
    INNER JOIN bins_mapping bm
        ON ag.product_id = bm.product_id
        AND ag.store_id = bm.store_id
        AND ag.segment_id = bm.segment_id
    GROUP BY bm.opt_level_bins, ag.product_id, ag.fiscal_year, ag.fiscal_month, ag.coverage
),

-- Expected grid: bins x fiscal months with actuals available. Drives the output.
-- fiscal_months already filters to months with data (NO_DATA months are excluded upstream).
expected_grid AS (
    SELECT
        ob.opt_level_bins, ob.product_id,
        fm.fiscal_year, fm.fiscal_month, fm.fiscal_month_name,
        fm.calc_coverage,
        fm.range_start AS calc_range_start,
        fm.range_end   AS calc_range_end,
        fm.max_actuals_date
    FROM our_bins ob
    CROSS JOIN fiscal_months fm
)

SELECT
    sa.id,
    eg.opt_level_bins,
    eg.product_id,
    -- Bin identity (always populated, even when stored row is MISSING_STORED)
    bi.product_code,
    bi.line_group,
    bi.channel_name,
    bi.price_zone_display       AS price_zone,
    bi.segment_name,
    bi.price_lock_val           AS price_lock,
    bi.zone_exception_val       AS zone_exception,
    -- Stored row's own identity columns (NULL when MISSING_STORED)
    sa.segment_id,
    sa.channel_id,
    sa.price_zone               AS stored_price_zone,
    sa.line_group,
    eg.fiscal_year,
    eg.fiscal_month,
    eg.fiscal_month_name,
    sa.range_start_date AS stored_range_start_date,
    sa.range_end_date   AS stored_range_end_date,
    sa.coverage         AS stored_coverage,

    (SELECT fiscal_year_start FROM fiscal_range) AS fiscal_year_start,
    eg.max_actuals_date,

    eg.calc_coverage,
    eg.calc_range_start,
    eg.calc_range_end,

    -- Row-level presence flags
    CASE WHEN sa.id IS NULL              THEN 'MISSING' ELSE 'PRESENT' END AS stored_status,
    CASE WHEN ab.opt_level_bins IS NULL  THEN 'MISSING' ELSE 'PRESENT' END AS calc_status,

    -- 5-state coverage match
    CASE
        WHEN sa.coverage IS NULL AND eg.calc_coverage IS NULL THEN 'MISSING_BOTH'
        WHEN sa.coverage IS NULL THEN 'MISSING_STORED'
        WHEN eg.calc_coverage IS NULL THEN 'MISSING_CALC'
        WHEN sa.coverage = eg.calc_coverage THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS coverage_match,

    -- Stored
    ROUND(sa.stored_sales_units::numeric, 0) AS stored_sales_units,
    ROUND(sa.stored_revenue::numeric, 2)     AS stored_revenue,
    ROUND(sa.stored_gm_dollar::numeric, 2)   AS stored_gm_dollar,
    ROUND(sa.stored_gm_pct::numeric, 2)      AS stored_gm_pct,
    ROUND(sa.stored_asp::numeric, 2)         AS stored_asp,
    ROUND(sa.stored_aum::numeric, 2)         AS stored_aum,

    -- Calculated (NULL when missing; no COALESCE so MISSING_CALC is detectable)
    ROUND(ab.calc_sales_units::numeric, 0) AS calc_sales_units,
    ROUND(ab.calc_revenue::numeric, 2)     AS calc_revenue,
    ROUND(ab.calc_gm_dollar::numeric, 2)   AS calc_gm_dollar,
    ROUND(ab.calc_gm_pct::numeric, 2)      AS calc_gm_pct,
    ROUND(ab.calc_asp::numeric, 2)         AS calc_asp,
    ROUND(ab.calc_aum::numeric, 2)         AS calc_aum,

    ab.stores_with_data,

    -- 5-state match per metric
    CASE
        WHEN sa.stored_sales_units IS NULL AND ab.calc_sales_units IS NULL THEN 'MISSING_BOTH'
        WHEN sa.stored_sales_units IS NULL THEN 'MISSING_STORED'
        WHEN ab.calc_sales_units   IS NULL THEN 'MISSING_CALC'
        WHEN ROUND(sa.stored_sales_units::numeric, 0) = ROUND(ab.calc_sales_units::numeric, 0) THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS sales_match,
    CASE
        WHEN sa.stored_revenue IS NULL AND ab.calc_revenue IS NULL THEN 'MISSING_BOTH'
        WHEN sa.stored_revenue IS NULL THEN 'MISSING_STORED'
        WHEN ab.calc_revenue   IS NULL THEN 'MISSING_CALC'
        WHEN ABS(ROUND(sa.stored_revenue::numeric, 2) - ROUND(ab.calc_revenue::numeric, 2)) <= 0.01 THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS revenue_match,
    CASE
        WHEN sa.stored_gm_dollar IS NULL AND ab.calc_gm_dollar IS NULL THEN 'MISSING_BOTH'
        WHEN sa.stored_gm_dollar IS NULL THEN 'MISSING_STORED'
        WHEN ab.calc_gm_dollar   IS NULL THEN 'MISSING_CALC'
        WHEN ABS(ROUND(sa.stored_gm_dollar::numeric, 2) - ROUND(ab.calc_gm_dollar::numeric, 2)) <= 0.01 THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS gm_dollar_match,
    CASE
        WHEN sa.stored_gm_pct IS NULL AND ab.calc_gm_pct IS NULL THEN 'MISSING_BOTH'
        WHEN sa.stored_gm_pct IS NULL THEN 'MISSING_STORED'
        WHEN ab.calc_gm_pct   IS NULL THEN 'MISSING_CALC'
        WHEN ABS(ROUND(sa.stored_gm_pct::numeric, 2) - ROUND(ab.calc_gm_pct::numeric, 2)) <= 0.01 THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS gm_pct_match,
    CASE
        WHEN sa.stored_asp IS NULL AND ab.calc_asp IS NULL THEN 'MISSING_BOTH'
        WHEN sa.stored_asp IS NULL THEN 'MISSING_STORED'
        WHEN ab.calc_asp   IS NULL THEN 'MISSING_CALC'
        WHEN ABS(ROUND(sa.stored_asp::numeric, 2) - ROUND(ab.calc_asp::numeric, 2)) <= 0.01 THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS asp_match,
    CASE
        WHEN sa.stored_aum IS NULL AND ab.calc_aum IS NULL THEN 'MISSING_BOTH'
        WHEN sa.stored_aum IS NULL THEN 'MISSING_STORED'
        WHEN ab.calc_aum   IS NULL THEN 'MISSING_CALC'
        WHEN ABS(ROUND(sa.stored_aum::numeric, 2) - ROUND(ab.calc_aum::numeric, 2)) <= 0.01 THEN 'MATCH'
        ELSE 'MISMATCH'
    END AS aum_match,

    -- Diffs (NULL when either side missing)
    ROUND(sa.stored_sales_units::numeric, 0) - ROUND(ab.calc_sales_units::numeric, 0) AS sales_diff,
    ROUND(sa.stored_revenue::numeric, 2)     - ROUND(ab.calc_revenue::numeric, 2)     AS revenue_diff,
    ROUND(sa.stored_gm_dollar::numeric, 2)   - ROUND(ab.calc_gm_dollar::numeric, 2)   AS gm_dollar_diff,
    ROUND(sa.stored_gm_pct::numeric, 2)      - ROUND(ab.calc_gm_pct::numeric, 2)      AS gm_pct_diff,
    ROUND(sa.stored_asp::numeric, 2)         - ROUND(ab.calc_asp::numeric, 2)         AS asp_diff,
    ROUND(sa.stored_aum::numeric, 2)         - ROUND(ab.calc_aum::numeric, 2)         AS aum_diff

FROM expected_grid eg
LEFT JOIN bin_identity bi
       ON eg.opt_level_bins = bi.opt_level_bins
      AND eg.product_id     = bi.product_id
LEFT JOIN stored_actuals sa
       ON eg.opt_level_bins = sa.opt_level_bins
      AND eg.product_id     = sa.product_id
      AND eg.fiscal_year    = sa.fiscal_year
      AND eg.fiscal_month   = sa.fiscal_month
LEFT JOIN actuals_by_bin ab
       ON eg.opt_level_bins = ab.opt_level_bins
      AND eg.product_id     = ab.product_id
      AND eg.fiscal_year    = ab.fiscal_year
      AND eg.fiscal_month   = ab.fiscal_month
      AND eg.calc_coverage  = ab.coverage
-- Drop rows where BOTH sides are entirely missing (no stored row AND no calc data).
-- Using metric columns (data presence) instead of join-key columns for clarity.
WHERE sa.stored_sales_units IS NOT NULL
   OR ab.calc_sales_units   IS NOT NULL
ORDER BY eg.opt_level_bins, eg.fiscal_year, eg.fiscal_month
"""
        return query
    
    def validate_monthly_actuals(self, strategy_id: int, limit: Optional[int] = None) -> Dict:
        """Run validation for monthly actuals and return results with summary."""
        
        # Check strategy exists
        strategy_info = self.get_strategy_info(strategy_id)
        if not strategy_info:
            return {
                "success": False,
                "strategy_id": strategy_id,
                "error": f"Strategy {strategy_id} not found",
                "summary": None,
                "results": []
            }
        
        # Build and execute query
        query = self.build_monthly_actuals_validation_query(strategy_id)
        if limit:
            query = f"{query} LIMIT {limit}"
        
        results = self._execute_query(query)
        
        if not results:
            return {
                "success": True,
                "strategy_id": strategy_id,
                "strategy_name": strategy_info.get('strategy_name'),
                "message": "No monthly actuals data found for this strategy",
                "summary": {"total_records": 0},
                "results": []
            }
        
        # Summary: counts per 5-state for each metric column.
        # Values: MATCH / MISMATCH / MISSING_STORED / MISSING_CALC / MISSING_BOTH
        total = len(results)

        def bucket(col):
            counts = {"match": 0, "mismatch": 0, "missing_stored": 0, "missing_calc": 0, "missing_both": 0}
            for r in results:
                v = r.get(col)
                if   v == 'MATCH':          counts["match"] += 1
                elif v == 'MISMATCH':       counts["mismatch"] += 1
                elif v == 'MISSING_STORED': counts["missing_stored"] += 1
                elif v == 'MISSING_CALC':   counts["missing_calc"] += 1
                elif v == 'MISSING_BOTH':   counts["missing_both"] += 1
            return counts

        summary = {
            "total_records": total,
            "stored_status": {
                "present": sum(1 for r in results if r.get('stored_status') == 'PRESENT'),
                "missing": sum(1 for r in results if r.get('stored_status') == 'MISSING'),
            },
            "calc_status": {
                "present": sum(1 for r in results if r.get('calc_status') == 'PRESENT'),
                "missing": sum(1 for r in results if r.get('calc_status') == 'MISSING'),
            },
            "coverage":    bucket('coverage_match'),
            "sales_units": bucket('sales_match'),
            "revenue":     bucket('revenue_match'),
            "gm_dollar":   bucket('gm_dollar_match'),
            "gm_pct":      bucket('gm_pct_match'),
            "asp":         bucket('asp_match'),
            "aum":         bucket('aum_match'),
        }
        # all_matched: every metric is fully MATCH (no MISMATCH, no MISSING_*).
        all_match = all(
            summary[m]["match"] == total
            for m in ("sales_units", "revenue", "gm_dollar", "gm_pct", "asp", "aum")
        )
        summary["all_matched"] = all_match
        
        return {
            "success": True,
            "strategy_id": strategy_id,
            "strategy_name": strategy_info.get('strategy_name'),
            "all_matched": all_match,
            "summary": summary,
            "results": results
        }
    
    def get_validation_query(self, strategy_id: int) -> str:
        """Get the generated SQL query for inspection."""
        return self.build_monthly_actuals_validation_query(strategy_id)


# Module-level instance
bp_monthly_forecast_actuals_validator = BpMonthlyForecastActualsValidator()

