"""
Summary Cards Validation Module
Validates summary card metrics (Sales Units, Revenue, GM$, ASP, AUM, GM%) across Current, IA, Finalized reco tables.
Uses shared database connection from database.py
"""

from app.core.database import db
from typing import Dict, List, Optional


class SummaryCardsValidator:
    """Validates summary card metrics in reco tables.
    
    Uses the shared db connection from database.py - no separate connection management needed.
    """
    
    def __init__(self):
        self._config_cache = None
    
    @property
    def schema(self) -> str:
        """Get current schema from shared db connection."""
        return db.db_schema
    
    def is_connected(self) -> bool:
        """Check if connected to database (delegates to shared db)."""
        return db.is_connected()
    
    def _execute_query(self, query: str, params: tuple = None) -> list:
        """Execute query using shared db connection."""
        if not db.is_connected():
            raise Exception("Not connected to database. Please connect first.")
        return db.execute_query(query, params)
    
    def get_config(self) -> Dict:
        """Fetch dynamic configuration from database tables (same approach as reco_metrics_validator)."""
        if self._config_cache:
            return self._config_cache
        
        # Get channel column from store hierarchy level table
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
        channel_name_column = channel_column.replace('_cid', '_name')
        
        self._config_cache = {
            'channel_column': channel_column,
            'channel_name_column': channel_name_column
        }
        
        return self._config_cache
    
    def clear_cache(self):
        """Clear configuration cache."""
        self._config_cache = None
    
    def get_channels(self, strategy_id: int) -> List[Dict]:
        """Get the channels available for a strategy.

        Logic follows the data model:
        - Multi-channel strategy (bp_strategy_master.is_multi_channel_strategy = true):
          per-channel rows live in bp_strategy_channel_metrics_summary.
        - Single-channel strategy (is_multi_channel_strategy = false): the one channel
          name lives in bp_strategy_master.channel; channel_id is resolved from
          bp_store_master by matching the name.
        """
        master = self._execute_query(f"""
            SELECT is_multi_channel_strategy, channel
            FROM {self.schema}.bp_strategy_master
            WHERE strategy_id = {strategy_id}
            LIMIT 1
        """)
        if not master:
            return []

        is_multi = master[0]['is_multi_channel_strategy']

        if is_multi:
            result = self._execute_query(f"""
                SELECT channel_id, channel_name
                FROM {self.schema}.bp_strategy_channel_metrics_summary
                WHERE strategy_id = {strategy_id}
                ORDER BY channel_name
            """)
        else:
            config = self.get_config()
            channel_col = config['channel_column']
            channel_name_col = config['channel_name_column']
            channel_name = master[0]['channel']
            # Escape single quotes to keep this safe even if channel names ever contain them.
            safe_name = channel_name.replace("'", "''") if channel_name else ''
            result = self._execute_query(f"""
                SELECT DISTINCT {channel_col} AS channel_id, {channel_name_col} AS channel_name
                FROM {self.schema}.bp_store_master
                WHERE {channel_name_col} = '{safe_name}'
                LIMIT 1
            """)

        return [
            {"id": row['channel_id'], "name": row['channel_name'] or str(row['channel_id'])}
            for row in result
        ] if result else []
    
    def _build_where_clause(self, strategy_id: int, channel_ids: Optional[List[int]] = None) -> str:
        """Build WHERE clause with optional channel filter."""
        conditions = [f"strategy_id = {strategy_id}"]
        
        if channel_ids and len(channel_ids) > 0:
            conditions.append(f"channel_id IN ({','.join(map(str, channel_ids))})")
        
        return "WHERE " + " AND ".join(conditions)
    
    def get_query(self, strategy_id: int, channel_ids: Optional[List[int]] = None) -> str:
        """
        Get the generated SQL query for summary cards validation.
        Returns the query string so user can verify in database directly.
        
        Uses direct ratios from aggregates:
        - ASP = total_revenue / total_sales_units
        - AUM = total_gross_margin_dollar / total_sales_units
        - GM% = (total_gross_margin_dollar / total_revenue) * 100
        """
        where_clause = self._build_where_clause(strategy_id, channel_ids)
        
        query = f"""
-- Summary Cards Validation Query
-- Strategy ID: {strategy_id}
-- Channel Filter: {channel_ids if channel_ids else 'All channels'}

WITH current_data AS (
    SELECT
        {strategy_id} AS strategy_id,
        -- Base sums
        COALESCE(SUM(sales_units), 0) AS total_sales_units,
        COALESCE(SUM(revenue), 0) AS total_revenue,
        COALESCE(SUM(gross_margin_dollar), 0) AS total_gross_margin_dollar,
        COALESCE(SUM(actuals_sales_units), 0) AS actuals_sales_units,
        COALESCE(SUM(actuals_revenue), 0) AS actuals_revenue,
        COALESCE(SUM(actuals_gross_margin_dollar), 0) AS actuals_gross_margin_dollar,
        COALESCE(SUM(sales_units), 0) - COALESCE(SUM(actuals_sales_units), 0) AS forecast_sales_units,
        COALESCE(SUM(revenue), 0) - COALESCE(SUM(actuals_revenue), 0) AS forecast_revenue,
        COALESCE(SUM(gross_margin_dollar), 0) - COALESCE(SUM(actuals_gross_margin_dollar), 0) AS forecast_gross_margin_dollar,
        -- Weighted sums for Total (for weighted averages)
        COALESCE(SUM(asp * sales_units), 0) AS total_asp_weighted,
        COALESCE(SUM(aum * sales_units), 0) AS total_aum_weighted,
        COALESCE(SUM(gross_margin_percentage * sales_units), 0) AS total_gm_pct_weighted,
        -- Weighted sums for Actuals
        COALESCE(SUM(actuals_asp * actuals_sales_units), 0) AS actuals_asp_weighted,
        COALESCE(SUM(actuals_aum * actuals_sales_units), 0) AS actuals_aum_weighted,
        COALESCE(SUM(actuals_gross_margin_percentage * actuals_sales_units), 0) AS actuals_gm_pct_weighted
    FROM {self.schema}.bp_price_reco_current_v2
    {where_clause}
),
ia_data AS (
    SELECT
        {strategy_id} AS strategy_id,
        -- Base sums
        COALESCE(SUM(sales_units), 0) AS total_sales_units,
        COALESCE(SUM(revenue), 0) AS total_revenue,
        COALESCE(SUM(gross_margin_dollar), 0) AS total_gross_margin_dollar,
        COALESCE(SUM(actuals_sales_units), 0) AS actuals_sales_units,
        COALESCE(SUM(actuals_revenue), 0) AS actuals_revenue,
        COALESCE(SUM(actuals_gross_margin_dollar), 0) AS actuals_gross_margin_dollar,
        COALESCE(SUM(sales_units), 0) - COALESCE(SUM(actuals_sales_units), 0) AS forecast_sales_units,
        COALESCE(SUM(revenue), 0) - COALESCE(SUM(actuals_revenue), 0) AS forecast_revenue,
        COALESCE(SUM(gross_margin_dollar), 0) - COALESCE(SUM(actuals_gross_margin_dollar), 0) AS forecast_gross_margin_dollar,
        -- Weighted sums for Total
        COALESCE(SUM(asp * sales_units), 0) AS total_asp_weighted,
        COALESCE(SUM(aum * sales_units), 0) AS total_aum_weighted,
        COALESCE(SUM(gross_margin_percentage * sales_units), 0) AS total_gm_pct_weighted,
        -- Weighted sums for Actuals
        COALESCE(SUM(actuals_asp * actuals_sales_units), 0) AS actuals_asp_weighted,
        COALESCE(SUM(actuals_aum * actuals_sales_units), 0) AS actuals_aum_weighted,
        COALESCE(SUM(actuals_gross_margin_percentage * actuals_sales_units), 0) AS actuals_gm_pct_weighted
    FROM {self.schema}.bp_price_reco_ia_v2
    {where_clause}
),
finalized_data AS (
    SELECT
        {strategy_id} AS strategy_id,
        -- Base sums
        COALESCE(SUM(sales_units), 0) AS total_sales_units,
        COALESCE(SUM(revenue), 0) AS total_revenue,
        COALESCE(SUM(gross_margin_dollar), 0) AS total_gross_margin_dollar,
        COALESCE(SUM(actuals_sales_units), 0) AS actuals_sales_units,
        COALESCE(SUM(actuals_revenue), 0) AS actuals_revenue,
        COALESCE(SUM(actuals_gross_margin_dollar), 0) AS actuals_gross_margin_dollar,
        COALESCE(SUM(sales_units), 0) - COALESCE(SUM(actuals_sales_units), 0) AS forecast_sales_units,
        COALESCE(SUM(revenue), 0) - COALESCE(SUM(actuals_revenue), 0) AS forecast_revenue,
        COALESCE(SUM(gross_margin_dollar), 0) - COALESCE(SUM(actuals_gross_margin_dollar), 0) AS forecast_gross_margin_dollar,
        -- Weighted sums for Total
        COALESCE(SUM(asp * sales_units), 0) AS total_asp_weighted,
        COALESCE(SUM(aum * sales_units), 0) AS total_aum_weighted,
        COALESCE(SUM(gross_margin_percentage * sales_units), 0) AS total_gm_pct_weighted,
        -- Weighted sums for Actuals
        COALESCE(SUM(actuals_asp * actuals_sales_units), 0) AS actuals_asp_weighted,
        COALESCE(SUM(actuals_aum * actuals_sales_units), 0) AS actuals_aum_weighted,
        COALESCE(SUM(actuals_gross_margin_percentage * actuals_sales_units), 0) AS actuals_gm_pct_weighted
    FROM {self.schema}.bp_price_reco_finalized_v2
    {where_clause}
)
SELECT 
    -- Current metrics
    c.total_sales_units AS current_total_sales,
    c.actuals_sales_units AS current_actuals_sales,
    c.forecast_sales_units AS current_forecast_sales,
    c.total_revenue AS current_total_revenue,
    c.actuals_revenue AS current_actuals_revenue,
    c.forecast_revenue AS current_forecast_revenue,
    c.total_gross_margin_dollar AS current_total_gm,
    c.actuals_gross_margin_dollar AS current_actuals_gm,
    c.forecast_gross_margin_dollar AS current_forecast_gm,
    -- Current derived (weighted averages: SUM(metric * sales_units) / SUM(sales_units))
    COALESCE(c.total_asp_weighted / NULLIF(c.total_sales_units, 0), 0) AS current_total_asp,
    COALESCE(c.actuals_asp_weighted / NULLIF(c.actuals_sales_units, 0), 0) AS current_actuals_asp,
    COALESCE((c.total_asp_weighted - c.actuals_asp_weighted) / NULLIF(c.forecast_sales_units, 0), 0) AS current_forecast_asp,
    COALESCE(c.total_aum_weighted / NULLIF(c.total_sales_units, 0), 0) AS current_total_aum,
    COALESCE(c.actuals_aum_weighted / NULLIF(c.actuals_sales_units, 0), 0) AS current_actuals_aum,
    COALESCE((c.total_aum_weighted - c.actuals_aum_weighted) / NULLIF(c.forecast_sales_units, 0), 0) AS current_forecast_aum,
    COALESCE(c.total_gm_pct_weighted / NULLIF(c.total_sales_units, 0), 0) AS current_total_gm_pct,
    COALESCE(c.actuals_gm_pct_weighted / NULLIF(c.actuals_sales_units, 0), 0) AS current_actuals_gm_pct,
    COALESCE((c.total_gm_pct_weighted - c.actuals_gm_pct_weighted) / NULLIF(c.forecast_sales_units, 0), 0) AS current_forecast_gm_pct,
    
    -- IA metrics
    i.total_sales_units AS ia_total_sales,
    i.actuals_sales_units AS ia_actuals_sales,
    i.forecast_sales_units AS ia_forecast_sales,
    i.total_revenue AS ia_total_revenue,
    i.actuals_revenue AS ia_actuals_revenue,
    i.forecast_revenue AS ia_forecast_revenue,
    i.total_gross_margin_dollar AS ia_total_gm,
    i.actuals_gross_margin_dollar AS ia_actuals_gm,
    i.forecast_gross_margin_dollar AS ia_forecast_gm,
    -- IA derived (weighted averages)
    COALESCE(i.total_asp_weighted / NULLIF(i.total_sales_units, 0), 0) AS ia_total_asp,
    COALESCE(i.actuals_asp_weighted / NULLIF(i.actuals_sales_units, 0), 0) AS ia_actuals_asp,
    COALESCE((i.total_asp_weighted - i.actuals_asp_weighted) / NULLIF(i.forecast_sales_units, 0), 0) AS ia_forecast_asp,
    COALESCE(i.total_aum_weighted / NULLIF(i.total_sales_units, 0), 0) AS ia_total_aum,
    COALESCE(i.actuals_aum_weighted / NULLIF(i.actuals_sales_units, 0), 0) AS ia_actuals_aum,
    COALESCE((i.total_aum_weighted - i.actuals_aum_weighted) / NULLIF(i.forecast_sales_units, 0), 0) AS ia_forecast_aum,
    COALESCE(i.total_gm_pct_weighted / NULLIF(i.total_sales_units, 0), 0) AS ia_total_gm_pct,
    COALESCE(i.actuals_gm_pct_weighted / NULLIF(i.actuals_sales_units, 0), 0) AS ia_actuals_gm_pct,
    COALESCE((i.total_gm_pct_weighted - i.actuals_gm_pct_weighted) / NULLIF(i.forecast_sales_units, 0), 0) AS ia_forecast_gm_pct,
    
    -- Finalized metrics
    f.total_sales_units AS fin_total_sales,
    f.actuals_sales_units AS fin_actuals_sales,
    f.forecast_sales_units AS fin_forecast_sales,
    f.total_revenue AS fin_total_revenue,
    f.actuals_revenue AS fin_actuals_revenue,
    f.forecast_revenue AS fin_forecast_revenue,
    f.total_gross_margin_dollar AS fin_total_gm,
    f.actuals_gross_margin_dollar AS fin_actuals_gm,
    f.forecast_gross_margin_dollar AS fin_forecast_gm,
    -- Finalized derived (weighted averages)
    COALESCE(f.total_asp_weighted / NULLIF(f.total_sales_units, 0), 0) AS fin_total_asp,
    COALESCE(f.actuals_asp_weighted / NULLIF(f.actuals_sales_units, 0), 0) AS fin_actuals_asp,
    COALESCE((f.total_asp_weighted - f.actuals_asp_weighted) / NULLIF(f.forecast_sales_units, 0), 0) AS fin_forecast_asp,
    COALESCE(f.total_aum_weighted / NULLIF(f.total_sales_units, 0), 0) AS fin_total_aum,
    COALESCE(f.actuals_aum_weighted / NULLIF(f.actuals_sales_units, 0), 0) AS fin_actuals_aum,
    COALESCE((f.total_aum_weighted - f.actuals_aum_weighted) / NULLIF(f.forecast_sales_units, 0), 0) AS fin_forecast_aum,
    COALESCE(f.total_gm_pct_weighted / NULLIF(f.total_sales_units, 0), 0) AS fin_total_gm_pct,
    COALESCE(f.actuals_gm_pct_weighted / NULLIF(f.actuals_sales_units, 0), 0) AS fin_actuals_gm_pct,
    COALESCE((f.total_gm_pct_weighted - f.actuals_gm_pct_weighted) / NULLIF(f.forecast_sales_units, 0), 0) AS fin_forecast_gm_pct,
    
    -- Vs Current deltas (IA vs Current): Sales/Revenue/GM$ = direct diff, ASP/AUM = dollar diff, GM% = percent change
    ROUND((i.total_sales_units - c.total_sales_units)::numeric, 0) AS ia_vs_current_sales,
    ROUND((i.total_revenue - c.total_revenue)::numeric, 2) AS ia_vs_current_revenue,
    ROUND((i.total_gross_margin_dollar - c.total_gross_margin_dollar)::numeric, 2) AS ia_vs_current_gm,
    ROUND((
        COALESCE(i.total_asp_weighted / NULLIF(i.total_sales_units, 0), 0) -
        COALESCE(c.total_asp_weighted / NULLIF(c.total_sales_units, 0), 0)
    )::numeric, 2) AS ia_vs_current_asp,
    ROUND((
        COALESCE(i.total_aum_weighted / NULLIF(i.total_sales_units, 0), 0) -
        COALESCE(c.total_aum_weighted / NULLIF(c.total_sales_units, 0), 0)
    )::numeric, 2) AS ia_vs_current_aum,
    CASE WHEN c.total_sales_units > 0 AND c.total_gm_pct_weighted > 0 THEN 
        ROUND((((i.total_gm_pct_weighted / i.total_sales_units) - (c.total_gm_pct_weighted / c.total_sales_units)) / (c.total_gm_pct_weighted / c.total_sales_units) * 100)::numeric, 2) 
    ELSE 0 END AS ia_vs_current_gm_pct,
    
    -- Vs Current deltas (Finalized vs Current)
    ROUND((f.total_sales_units - c.total_sales_units)::numeric, 0) AS fin_vs_current_sales,
    ROUND((f.total_revenue - c.total_revenue)::numeric, 2) AS fin_vs_current_revenue,
    ROUND((f.total_gross_margin_dollar - c.total_gross_margin_dollar)::numeric, 2) AS fin_vs_current_gm,
    ROUND((
        COALESCE(f.total_asp_weighted / NULLIF(f.total_sales_units, 0), 0) -
        COALESCE(c.total_asp_weighted / NULLIF(c.total_sales_units, 0), 0)
    )::numeric, 2) AS fin_vs_current_asp,
    ROUND((
        COALESCE(f.total_aum_weighted / NULLIF(f.total_sales_units, 0), 0) -
        COALESCE(c.total_aum_weighted / NULLIF(c.total_sales_units, 0), 0)
    )::numeric, 2) AS fin_vs_current_aum,
    CASE WHEN c.total_sales_units > 0 AND c.total_gm_pct_weighted > 0 THEN 
        ROUND((((f.total_gm_pct_weighted / f.total_sales_units) - (c.total_gm_pct_weighted / c.total_sales_units)) / (c.total_gm_pct_weighted / c.total_sales_units) * 100)::numeric, 2) 
    ELSE 0 END AS fin_vs_current_gm_pct
    
FROM current_data c
CROSS JOIN ia_data i
CROSS JOIN finalized_data f
"""
        return query
    
    def validate(self, strategy_id: int, channel_ids: Optional[List[int]] = None) -> Dict:
        """
        Run summary cards validation for a strategy.
        
        Args:
            strategy_id: The strategy ID to validate
            channel_ids: Optional list of channel IDs to filter
            
        Returns:
            Dictionary with success status and formatted data
        """
        query = self.get_query(strategy_id, channel_ids)
        
        result = self._execute_query(query)
        
        if not result:
            return {
                "success": False,
                "error": f"No data found for strategy {strategy_id}"
            }
        
        row = result[0]
        
        # Build response in structured format - all vs_current values now come from SQL
        data = {
            "strategy_id": strategy_id,
            "current": {
                "sales_units": {"actuals": row['current_actuals_sales'], "forecast": row['current_forecast_sales'], "total": row['current_total_sales']},
                "revenue": {"actuals": row['current_actuals_revenue'], "forecast": row['current_forecast_revenue'], "total": row['current_total_revenue']},
                "asp": {"actuals": row['current_actuals_asp'], "forecast": row['current_forecast_asp'], "total": row['current_total_asp']},
                "aum": {"actuals": row['current_actuals_aum'], "forecast": row['current_forecast_aum'], "total": row['current_total_aum']},
                "gm_percentage": {"actuals": row['current_actuals_gm_pct'], "forecast": row['current_forecast_gm_pct'], "total": row['current_total_gm_pct']},
                "gross_margin_dollar": {"actuals": row['current_actuals_gm'], "forecast": row['current_forecast_gm'], "total": row['current_total_gm']}
            },
            "ia_recommended": {
                "sales_units": {"actuals": row['ia_actuals_sales'], "forecast": row['ia_forecast_sales'], "total": row['ia_total_sales'], "vs_current": row['ia_vs_current_sales']},
                "revenue": {"actuals": row['ia_actuals_revenue'], "forecast": row['ia_forecast_revenue'], "total": row['ia_total_revenue'], "vs_current": row['ia_vs_current_revenue']},
                "asp": {"actuals": row['ia_actuals_asp'], "forecast": row['ia_forecast_asp'], "total": row['ia_total_asp'], "vs_current": row['ia_vs_current_asp']},
                "aum": {"actuals": row['ia_actuals_aum'], "forecast": row['ia_forecast_aum'], "total": row['ia_total_aum'], "vs_current": row['ia_vs_current_aum']},
                "gm_percentage": {"actuals": row['ia_actuals_gm_pct'], "forecast": row['ia_forecast_gm_pct'], "total": row['ia_total_gm_pct'], "vs_current": row['ia_vs_current_gm_pct']},
                "gross_margin_dollar": {"actuals": row['ia_actuals_gm'], "forecast": row['ia_forecast_gm'], "total": row['ia_total_gm'], "vs_current": row['ia_vs_current_gm']}
            },
            "finalized": {
                "sales_units": {"actuals": row['fin_actuals_sales'], "forecast": row['fin_forecast_sales'], "total": row['fin_total_sales'], "vs_current": row['fin_vs_current_sales']},
                "revenue": {"actuals": row['fin_actuals_revenue'], "forecast": row['fin_forecast_revenue'], "total": row['fin_total_revenue'], "vs_current": row['fin_vs_current_revenue']},
                "asp": {"actuals": row['fin_actuals_asp'], "forecast": row['fin_forecast_asp'], "total": row['fin_total_asp'], "vs_current": row['fin_vs_current_asp']},
                "aum": {"actuals": row['fin_actuals_aum'], "forecast": row['fin_forecast_aum'], "total": row['fin_total_aum'], "vs_current": row['fin_vs_current_aum']},
                "gm_percentage": {"actuals": row['fin_actuals_gm_pct'], "forecast": row['fin_forecast_gm_pct'], "total": row['fin_total_gm_pct'], "vs_current": row['fin_vs_current_gm_pct']},
                "gross_margin_dollar": {"actuals": row['fin_actuals_gm'], "forecast": row['fin_forecast_gm'], "total": row['fin_total_gm'], "vs_current": row['fin_vs_current_gm']}
            }
        }
        
        return {
            "success": True,
            "data": data
        }


# Singleton instance
summary_cards_validator = SummaryCardsValidator()
