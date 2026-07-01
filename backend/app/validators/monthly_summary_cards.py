"""
Monthly Summary Cards Validation Module.

Mirrors summary_cards_validator.py but for forecast types that aren't
CURRENT_STRATEGY_PERIOD. Forecast and actuals portions live in separate tables
(bp_monthly_forecast vs bp_monthly_forecast_actuals), so unlike the strategy-period
validator (which derives forecast = total - actuals from reco_v2), this one sums
both sources independently and computes total = forecast + actuals.

Date ranges per forecast_type are resolved entirely in SQL from bp_forecast_cal_config
+ global.tb_fiscal_date_mapping (same pattern bp_monthly_forecast_validator uses) — no
stored functions like fn_get_forecast_cal_config_by_strategy. Single-FY strategies
anchor to the strategy's FY; multi-FY strategies anchor to today's FY. Quarter
bounds come from the cumulative_quarters array on each config row.

Uses the shared database connection from database.py.
"""

from app.core.database import db
from typing import Dict, List, Optional


class MonthlySummaryCardsValidator:
    """Validates summary card metrics for non-strategy-period forecast types."""

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

        self._config_cache = {
            "channel_column": channel_column,
            "channel_name_column": channel_name_column,
        }
        return self._config_cache

    def clear_cache(self):
        self._config_cache = None

    def get_channels(self, strategy_id: int) -> List[Dict]:
        """Channels available for a strategy.

        Logic follows the data model:
        - Multi-channel (bp_strategy_master.is_multi_channel_strategy = true): per-channel
          rows live in bp_strategy_channel_metrics_summary.
        - Single-channel: channel name lives in bp_strategy_master.channel; channel_id
          resolved from bp_store_master by matching the name.
        """
        master = self._execute_query(f"""
            SELECT is_multi_channel_strategy, channel
            FROM {self.schema}.bp_strategy_master
            WHERE strategy_id = {strategy_id}
            LIMIT 1
        """)
        if not master:
            return []

        is_multi = master[0]["is_multi_channel_strategy"]

        if is_multi:
            result = self._execute_query(f"""
                SELECT channel_id, channel_name
                FROM {self.schema}.bp_strategy_channel_metrics_summary
                WHERE strategy_id = {strategy_id}
                ORDER BY channel_name
            """)
        else:
            config = self.get_config()
            channel_col = config["channel_column"]
            channel_name_col = config["channel_name_column"]
            channel_name = master[0]["channel"]
            safe_name = channel_name.replace("'", "''") if channel_name else ''
            result = self._execute_query(f"""
                SELECT DISTINCT {channel_col} AS channel_id, {channel_name_col} AS channel_name
                FROM {self.schema}.bp_store_master
                WHERE {channel_name_col} = '{safe_name}'
                LIMIT 1
            """)

        return [
            {"id": row["channel_id"], "name": row["channel_name"] or str(row["channel_id"])}
            for row in result
        ] if result else []

    def _channel_filter(self, channel_ids: Optional[List[int]]) -> str:
        """Optional channel filter fragment (joined into ON clause with AND)."""
        if channel_ids and len(channel_ids) > 0:
            return f" AND mf.channel_id IN ({','.join(map(str, channel_ids))})"
        return ""

    def _actuals_channel_filter(self, channel_ids: Optional[List[int]]) -> str:
        if channel_ids and len(channel_ids) > 0:
            return f" AND mfa.channel_id IN ({','.join(map(str, channel_ids))})"
        return ""

    def get_query(self, strategy_id: int, channel_ids: Optional[List[int]] = None) -> str:
        """Build the summary card query for monthly forecast types.

        Returns one row per (forecast_type, period_label) with current/ia/finalized
        scenarios, each carrying actuals/forecast/total portions for SU, Rev, GM$,
        ASP, AUM, GM%.

        Date resolution mirrors bp_monthly_forecast_validator: reads bp_forecast_cal_config
        directly (no stored functions) and applies the single-FY / multi-FY rule plus the
        cumulative_quarters logic via base tables.
        """
        mf_channel = self._channel_filter(channel_ids)
        mfa_channel = self._actuals_channel_filter(channel_ids)

        query = f"""
-- Monthly Summary Cards Validation Query
-- Strategy ID: {strategy_id}
-- Channel Filter: {channel_ids if channel_ids else 'All channels'}
-- CURRENT_STRATEGY_PERIOD excluded (owned by summary_cards_validator).
-- Date ranges resolved from bp_forecast_cal_config + global.tb_fiscal_date_mapping —
-- no fn_get_forecast_cal_config_by_strategy or other stored procs used.

WITH strategy_params AS (
    SELECT start_date, end_date
    FROM {self.schema}.bp_strategy_master
    WHERE strategy_id = {strategy_id}
),

-- ----- Active-FY resolution -----
-- single-FY strategy  -> use strategy's FY
-- multi-FY strategy   -> use today's FY
-- (CALENDAR_YEAR / TWELVE_MONTHS anchor on strategy_start_date instead — handled below)
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

-- Quarter bounds within the active FY (for FISCAL_YEAR_Qx resolution).
quarter_dates AS (
    SELECT fdm.fiscal_quarter,
           MIN(fdm.fiscal_fd_qtr) AS quarter_start,
           MAX(fdm.fiscal_ld_qtr) AS quarter_end
    FROM global.tb_fiscal_date_mapping fdm
    CROSS JOIN fiscal_info fi
    WHERE fdm.fiscal_year = fi.fiscal_year
    GROUP BY fdm.fiscal_quarter
),

-- ----- Active forecast configs resolved to (resolved_start, resolved_end) -----
-- Quarter bounds use cumulative_quarters (covers discrete & cumulative modes):
--   discrete   cumulative_quarters = {{Q}}      -> MIN/MAX = Q's start/end
--   cumulative cumulative_quarters = {{Q1..Qn}} -> MIN = Q1.start, MAX = Qn.end
forecast_configs_resolved AS (
    SELECT
        fc.forecast_type,
        fc.label,
        fc.display_order,
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
            -- 12 months: fiscal_ld_month of (strategy_start + 12 months); aligns to fiscal calendar
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

-- One row per (fiscal_year, fiscal_month) with its fd/ld bounds. tb_fiscal_date_mapping
-- has one row per day, so DISTINCT collapses to monthly grain.
month_bounds AS (
    SELECT DISTINCT fiscal_year, fiscal_month, fiscal_fd_month, fiscal_ld_month
    FROM global.tb_fiscal_date_mapping
),

-- Visibility floor: derived from the FISCAL_YEAR config's resolved_start.
--   FY config = fiscal_year_start -> fiscal_year_end  -> floor = active FY start
--      (all 4 quarters of the active FY pass; pre-strategy quarters allowed)
--   FY config = strategy_start_date -> fiscal_year_end -> floor = strategy_start_date
--      (quarters ending before strategy_start are hidden, even if bp_monthly_forecast_actuals
--      has rows for those months)
-- Fallback when no FISCAL_YEAR config exists: active FY start (from fiscal_info).
visibility_floor AS (
    SELECT COALESCE(
        (SELECT resolved_start FROM forecast_configs_resolved
         WHERE forecast_type = 'FISCAL_YEAR' LIMIT 1),
        (SELECT fi.fiscal_fd_year FROM fiscal_info fi)
    ) AS floor_date
),

-- Drop forecast types whose entire range ends before the visibility floor.
forecast_configs_visible AS (
    SELECT fcr.*
    FROM forecast_configs_resolved fcr
    CROSS JOIN visibility_floor vf
    WHERE fcr.resolved_start IS NOT NULL
      AND fcr.resolved_end   IS NOT NULL
      AND fcr.resolved_end  >= vf.floor_date
),

-- Expand each visible config into the list of (fiscal_year, fiscal_month) pairs.
-- Each period's start is clamped to the visibility floor: even within a partially-
-- overlapping period (e.g. Q3 when strategy starts mid-Q3), only months from the floor
-- forward are included. So Q3's pre-strategy months are dropped even though Q3 itself
-- stays visible. Matches forecast/actuals validators.
calendar AS (
    SELECT
        fcv.forecast_type,
        fcv.label,
        fcv.display_order,
        GREATEST(fcv.resolved_start, vf.floor_date) AS resolved_start,
        fcv.resolved_end,
        mb.fiscal_year,
        mb.fiscal_month
    FROM forecast_configs_visible fcv
    CROSS JOIN visibility_floor vf
    JOIN month_bounds mb
      ON mb.fiscal_fd_month >= GREATEST(fcv.resolved_start, vf.floor_date)
     AND mb.fiscal_ld_month <= fcv.resolved_end
),

period_bounds AS (
    SELECT
        forecast_type,
        label,
        display_order,
        MIN(resolved_start) AS start_date,
        MAX(resolved_end)   AS end_date,
        COUNT(DISTINCT (fiscal_year, fiscal_month)) AS month_count,
        ARRAY_AGG(DISTINCT fiscal_year ORDER BY fiscal_year) AS fiscal_years
    FROM calendar
    GROUP BY forecast_type, label, display_order
),
-- Forecast portion: sum bp_monthly_forecast rows whose (fy, fm) match the calendar.
-- Rate columns (asp/aum/gross_margin_percentage and IA/Finalized variants) exist on
-- bp_monthly_forecast at the monthly grain, so we carry the units-weighted sums
-- (SUM(rate * units)) and derive the actual rate in the SELECT as weighted_sum / SUM(units).
forecast_agg AS (
    SELECT
        cal.forecast_type,
        cal.label,
        -- Sums (sales/rev/GM$) per scenario
        COALESCE(SUM(mf.sales_units), 0)                        AS fc_cur_su,
        COALESCE(SUM(mf.revenue), 0)                            AS fc_cur_rev,
        COALESCE(SUM(mf.gross_margin_dollar), 0)                AS fc_cur_gm,
        COALESCE(SUM(mf.ia_sales_units), 0)                     AS fc_ia_su,
        COALESCE(SUM(mf.ia_revenue), 0)                         AS fc_ia_rev,
        COALESCE(SUM(mf.ia_gross_margin_dollar), 0)             AS fc_ia_gm,
        COALESCE(SUM(mf.finalized_sales_units), 0)              AS fc_fin_su,
        COALESCE(SUM(mf.finalized_revenue), 0)                  AS fc_fin_rev,
        COALESCE(SUM(mf.finalized_gross_margin_dollar), 0)      AS fc_fin_gm,
        -- Units-weighted rate sums per scenario (rate * units summed; divide by SUM(units))
        COALESCE(SUM(mf.asp * mf.sales_units), 0)                                    AS fc_cur_asp_w,
        COALESCE(SUM(mf.aum * mf.sales_units), 0)                                    AS fc_cur_aum_w,
        COALESCE(SUM(mf.gross_margin_percentage * mf.sales_units), 0)                AS fc_cur_gm_pct_w,
        COALESCE(SUM(mf.ia_asp * mf.ia_sales_units), 0)                              AS fc_ia_asp_w,
        COALESCE(SUM(mf.ia_aum * mf.ia_sales_units), 0)                              AS fc_ia_aum_w,
        COALESCE(SUM(mf.ia_gross_margin_percentage * mf.ia_sales_units), 0)          AS fc_ia_gm_pct_w,
        COALESCE(SUM(mf.finalized_asp * mf.finalized_sales_units), 0)                AS fc_fin_asp_w,
        COALESCE(SUM(mf.finalized_aum * mf.finalized_sales_units), 0)                AS fc_fin_aum_w,
        COALESCE(SUM(mf.finalized_gross_margin_percentage * mf.finalized_sales_units), 0) AS fc_fin_gm_pct_w
    FROM calendar cal
    LEFT JOIN {self.schema}.bp_monthly_forecast mf
      ON  mf.fiscal_year  = cal.fiscal_year
      AND mf.fiscal_month = cal.fiscal_month
      AND mf.strategy_id  = {strategy_id}{mf_channel}
    GROUP BY cal.forecast_type, cal.label
),
-- Actuals portion: sum bp_monthly_forecast_actuals rows the same way. No scenario
-- split — actuals are scenario-agnostic and get mirrored across current/ia/finalized.
-- Rate columns also exist here, so use weighted sums the same way.
actuals_agg AS (
    SELECT
        cal.forecast_type,
        cal.label,
        COALESCE(SUM(mfa.sales_units), 0)                                          AS act_su,
        COALESCE(SUM(mfa.revenue), 0)                                              AS act_rev,
        COALESCE(SUM(mfa.gross_margin_dollar), 0)                                  AS act_gm,
        COALESCE(SUM(mfa.asp * mfa.sales_units), 0)                                AS act_asp_w,
        COALESCE(SUM(mfa.aum * mfa.sales_units), 0)                                AS act_aum_w,
        COALESCE(SUM(mfa.gross_margin_percentage * mfa.sales_units), 0)            AS act_gm_pct_w
    FROM calendar cal
    LEFT JOIN {self.schema}.bp_monthly_forecast_actuals mfa
      ON  mfa.fiscal_year  = cal.fiscal_year
      AND mfa.fiscal_month = cal.fiscal_month
      AND mfa.strategy_id  = {strategy_id}{mfa_channel}
    GROUP BY cal.forecast_type, cal.label
)
SELECT
    pb.forecast_type,
    pb.label AS period_label,
    pb.fiscal_years,
    pb.start_date,
    pb.end_date,
    pb.month_count,

    -- ASP / AUM / GM% are units-weighted averages across (bin × month) rows:
    --   rate = SUM(rate × units) / SUM(units)
    -- For the "total" portion, weighted sums from forecast and actuals are added before dividing
    -- by combined units. Same convention as summary_cards_validator on the strategy-period side.

    -- ============ CURRENT SCENARIO ============
    -- Forecast portion
    fa.fc_cur_su                                                                                              AS current_forecast_sales,
    ROUND(fa.fc_cur_rev::numeric, 2)                                                                          AS current_forecast_revenue,
    ROUND(fa.fc_cur_gm::numeric, 2)                                                                           AS current_forecast_gm,
    ROUND(COALESCE(fa.fc_cur_asp_w   / NULLIF(fa.fc_cur_su, 0), 0)::numeric, 2)                               AS current_forecast_asp,
    ROUND(COALESCE(fa.fc_cur_aum_w   / NULLIF(fa.fc_cur_su, 0), 0)::numeric, 2)                               AS current_forecast_aum,
    ROUND(COALESCE(fa.fc_cur_gm_pct_w / NULLIF(fa.fc_cur_su, 0), 0)::numeric, 2)                              AS current_forecast_gm_pct,
    -- Actuals portion (same numbers under all 3 scenarios)
    aa.act_su                                                                                                 AS current_actuals_sales,
    ROUND(aa.act_rev::numeric, 2)                                                                             AS current_actuals_revenue,
    ROUND(aa.act_gm::numeric, 2)                                                                              AS current_actuals_gm,
    ROUND(COALESCE(aa.act_asp_w    / NULLIF(aa.act_su, 0), 0)::numeric, 2)                                    AS current_actuals_asp,
    ROUND(COALESCE(aa.act_aum_w    / NULLIF(aa.act_su, 0), 0)::numeric, 2)                                    AS current_actuals_aum,
    ROUND(COALESCE(aa.act_gm_pct_w / NULLIF(aa.act_su, 0), 0)::numeric, 2)                                    AS current_actuals_gm_pct,
    -- Total = forecast + actuals — weighted sums combine before dividing by combined units
    (fa.fc_cur_su + aa.act_su)                                                                                AS current_total_sales,
    ROUND((fa.fc_cur_rev + aa.act_rev)::numeric, 2)                                                           AS current_total_revenue,
    ROUND((fa.fc_cur_gm  + aa.act_gm)::numeric, 2)                                                            AS current_total_gm,
    ROUND(COALESCE((fa.fc_cur_asp_w + aa.act_asp_w) / NULLIF(fa.fc_cur_su + aa.act_su, 0), 0)::numeric, 2)    AS current_total_asp,
    ROUND(COALESCE((fa.fc_cur_aum_w + aa.act_aum_w) / NULLIF(fa.fc_cur_su + aa.act_su, 0), 0)::numeric, 2)    AS current_total_aum,
    ROUND(COALESCE((fa.fc_cur_gm_pct_w + aa.act_gm_pct_w) / NULLIF(fa.fc_cur_su + aa.act_su, 0), 0)::numeric, 2) AS current_total_gm_pct,

    -- ============ IA SCENARIO ============
    fa.fc_ia_su                                                                                               AS ia_forecast_sales,
    ROUND(fa.fc_ia_rev::numeric, 2)                                                                           AS ia_forecast_revenue,
    ROUND(fa.fc_ia_gm::numeric, 2)                                                                            AS ia_forecast_gm,
    ROUND(COALESCE(fa.fc_ia_asp_w    / NULLIF(fa.fc_ia_su, 0), 0)::numeric, 2)                                AS ia_forecast_asp,
    ROUND(COALESCE(fa.fc_ia_aum_w    / NULLIF(fa.fc_ia_su, 0), 0)::numeric, 2)                                AS ia_forecast_aum,
    ROUND(COALESCE(fa.fc_ia_gm_pct_w / NULLIF(fa.fc_ia_su, 0), 0)::numeric, 2)                                AS ia_forecast_gm_pct,
    aa.act_su                                                                                                 AS ia_actuals_sales,
    ROUND(aa.act_rev::numeric, 2)                                                                             AS ia_actuals_revenue,
    ROUND(aa.act_gm::numeric, 2)                                                                              AS ia_actuals_gm,
    ROUND(COALESCE(aa.act_asp_w    / NULLIF(aa.act_su, 0), 0)::numeric, 2)                                    AS ia_actuals_asp,
    ROUND(COALESCE(aa.act_aum_w    / NULLIF(aa.act_su, 0), 0)::numeric, 2)                                    AS ia_actuals_aum,
    ROUND(COALESCE(aa.act_gm_pct_w / NULLIF(aa.act_su, 0), 0)::numeric, 2)                                    AS ia_actuals_gm_pct,
    (fa.fc_ia_su + aa.act_su)                                                                                 AS ia_total_sales,
    ROUND((fa.fc_ia_rev + aa.act_rev)::numeric, 2)                                                            AS ia_total_revenue,
    ROUND((fa.fc_ia_gm  + aa.act_gm)::numeric, 2)                                                             AS ia_total_gm,
    ROUND(COALESCE((fa.fc_ia_asp_w + aa.act_asp_w) / NULLIF(fa.fc_ia_su + aa.act_su, 0), 0)::numeric, 2)      AS ia_total_asp,
    ROUND(COALESCE((fa.fc_ia_aum_w + aa.act_aum_w) / NULLIF(fa.fc_ia_su + aa.act_su, 0), 0)::numeric, 2)      AS ia_total_aum,
    ROUND(COALESCE((fa.fc_ia_gm_pct_w + aa.act_gm_pct_w) / NULLIF(fa.fc_ia_su + aa.act_su, 0), 0)::numeric, 2) AS ia_total_gm_pct,

    -- ============ FINALIZED SCENARIO ============
    fa.fc_fin_su                                                                                              AS fin_forecast_sales,
    ROUND(fa.fc_fin_rev::numeric, 2)                                                                          AS fin_forecast_revenue,
    ROUND(fa.fc_fin_gm::numeric, 2)                                                                           AS fin_forecast_gm,
    ROUND(COALESCE(fa.fc_fin_asp_w    / NULLIF(fa.fc_fin_su, 0), 0)::numeric, 2)                              AS fin_forecast_asp,
    ROUND(COALESCE(fa.fc_fin_aum_w    / NULLIF(fa.fc_fin_su, 0), 0)::numeric, 2)                              AS fin_forecast_aum,
    ROUND(COALESCE(fa.fc_fin_gm_pct_w / NULLIF(fa.fc_fin_su, 0), 0)::numeric, 2)                              AS fin_forecast_gm_pct,
    aa.act_su                                                                                                 AS fin_actuals_sales,
    ROUND(aa.act_rev::numeric, 2)                                                                             AS fin_actuals_revenue,
    ROUND(aa.act_gm::numeric, 2)                                                                              AS fin_actuals_gm,
    ROUND(COALESCE(aa.act_asp_w    / NULLIF(aa.act_su, 0), 0)::numeric, 2)                                    AS fin_actuals_asp,
    ROUND(COALESCE(aa.act_aum_w    / NULLIF(aa.act_su, 0), 0)::numeric, 2)                                    AS fin_actuals_aum,
    ROUND(COALESCE(aa.act_gm_pct_w / NULLIF(aa.act_su, 0), 0)::numeric, 2)                                    AS fin_actuals_gm_pct,
    (fa.fc_fin_su + aa.act_su)                                                                                AS fin_total_sales,
    ROUND((fa.fc_fin_rev + aa.act_rev)::numeric, 2)                                                           AS fin_total_revenue,
    ROUND((fa.fc_fin_gm  + aa.act_gm)::numeric, 2)                                                            AS fin_total_gm,
    ROUND(COALESCE((fa.fc_fin_asp_w + aa.act_asp_w) / NULLIF(fa.fc_fin_su + aa.act_su, 0), 0)::numeric, 2)    AS fin_total_asp,
    ROUND(COALESCE((fa.fc_fin_aum_w + aa.act_aum_w) / NULLIF(fa.fc_fin_su + aa.act_su, 0), 0)::numeric, 2)    AS fin_total_aum,
    ROUND(COALESCE((fa.fc_fin_gm_pct_w + aa.act_gm_pct_w) / NULLIF(fa.fc_fin_su + aa.act_su, 0), 0)::numeric, 2) AS fin_total_gm_pct,

    -- ============ VS CURRENT DELTAS (IA & Finalized) ============
    -- SU / Rev / GM$        -> absolute diff on totals (forecast + actuals)
    -- ASP / AUM             -> absolute diff of the units-weighted total rates
    -- GM%                   -> percent change (((new − old) / old) × 100)
    -- Same convention as summary_cards_validator on the strategy-period side.
    ROUND(((fa.fc_ia_su + aa.act_su) - (fa.fc_cur_su + aa.act_su))::numeric, 0)                               AS ia_vs_current_sales,
    ROUND(((fa.fc_ia_rev + aa.act_rev) - (fa.fc_cur_rev + aa.act_rev))::numeric, 2)                           AS ia_vs_current_revenue,
    ROUND(((fa.fc_ia_gm  + aa.act_gm)  - (fa.fc_cur_gm  + aa.act_gm))::numeric, 2)                            AS ia_vs_current_gm,
    ROUND((
        COALESCE((fa.fc_ia_asp_w  + aa.act_asp_w) / NULLIF(fa.fc_ia_su  + aa.act_su, 0), 0) -
        COALESCE((fa.fc_cur_asp_w + aa.act_asp_w) / NULLIF(fa.fc_cur_su + aa.act_su, 0), 0)
    )::numeric, 2)                                                                                            AS ia_vs_current_asp,
    ROUND((
        COALESCE((fa.fc_ia_aum_w  + aa.act_aum_w) / NULLIF(fa.fc_ia_su  + aa.act_su, 0), 0) -
        COALESCE((fa.fc_cur_aum_w + aa.act_aum_w) / NULLIF(fa.fc_cur_su + aa.act_su, 0), 0)
    )::numeric, 2)                                                                                            AS ia_vs_current_aum,
    CASE
        WHEN COALESCE((fa.fc_cur_gm_pct_w + aa.act_gm_pct_w) / NULLIF(fa.fc_cur_su + aa.act_su, 0), 0) > 0
        THEN ROUND((
            (COALESCE((fa.fc_ia_gm_pct_w  + aa.act_gm_pct_w) / NULLIF(fa.fc_ia_su  + aa.act_su, 0), 0) -
             COALESCE((fa.fc_cur_gm_pct_w + aa.act_gm_pct_w) / NULLIF(fa.fc_cur_su + aa.act_su, 0), 0)) /
            COALESCE((fa.fc_cur_gm_pct_w + aa.act_gm_pct_w)  / NULLIF(fa.fc_cur_su + aa.act_su, 0), 1) * 100
        )::numeric, 2)
        ELSE 0
    END                                                                                                       AS ia_vs_current_gm_pct,

    ROUND(((fa.fc_fin_su + aa.act_su) - (fa.fc_cur_su + aa.act_su))::numeric, 0)                              AS fin_vs_current_sales,
    ROUND(((fa.fc_fin_rev + aa.act_rev) - (fa.fc_cur_rev + aa.act_rev))::numeric, 2)                          AS fin_vs_current_revenue,
    ROUND(((fa.fc_fin_gm  + aa.act_gm)  - (fa.fc_cur_gm  + aa.act_gm))::numeric, 2)                           AS fin_vs_current_gm,
    ROUND((
        COALESCE((fa.fc_fin_asp_w + aa.act_asp_w) / NULLIF(fa.fc_fin_su + aa.act_su, 0), 0) -
        COALESCE((fa.fc_cur_asp_w + aa.act_asp_w) / NULLIF(fa.fc_cur_su + aa.act_su, 0), 0)
    )::numeric, 2)                                                                                            AS fin_vs_current_asp,
    ROUND((
        COALESCE((fa.fc_fin_aum_w + aa.act_aum_w) / NULLIF(fa.fc_fin_su + aa.act_su, 0), 0) -
        COALESCE((fa.fc_cur_aum_w + aa.act_aum_w) / NULLIF(fa.fc_cur_su + aa.act_su, 0), 0)
    )::numeric, 2)                                                                                            AS fin_vs_current_aum,
    CASE
        WHEN COALESCE((fa.fc_cur_gm_pct_w + aa.act_gm_pct_w) / NULLIF(fa.fc_cur_su + aa.act_su, 0), 0) > 0
        THEN ROUND((
            (COALESCE((fa.fc_fin_gm_pct_w + aa.act_gm_pct_w) / NULLIF(fa.fc_fin_su + aa.act_su, 0), 0) -
             COALESCE((fa.fc_cur_gm_pct_w + aa.act_gm_pct_w) / NULLIF(fa.fc_cur_su + aa.act_su, 0), 0)) /
            COALESCE((fa.fc_cur_gm_pct_w + aa.act_gm_pct_w)  / NULLIF(fa.fc_cur_su + aa.act_su, 0), 1) * 100
        )::numeric, 2)
        ELSE 0
    END                                                                                                       AS fin_vs_current_gm_pct

FROM period_bounds pb
LEFT JOIN forecast_agg fa ON fa.forecast_type = pb.forecast_type AND fa.label = pb.label
LEFT JOIN actuals_agg  aa ON aa.forecast_type = pb.forecast_type AND aa.label = pb.label
ORDER BY COALESCE(pb.display_order, 999), pb.forecast_type, pb.label
"""
        return query

    def validate(self, strategy_id: int, channel_ids: Optional[List[int]] = None) -> Dict:
        """Run the validation and return one summary card per supported forecast type."""
        query = self.get_query(strategy_id, channel_ids)
        rows = self._execute_query(query)

        if not rows:
            return {
                "success": False,
                "error": f"No monthly summary card data found for strategy {strategy_id}",
            }

        periods = [self._row_to_period(r) for r in rows]
        return {"success": True, "strategy_id": strategy_id, "periods": periods}

    def _row_to_period(self, row: dict) -> dict:
        """Reshape one SQL row into the nested {scenario: {metric: {portion}}} structure."""
        return {
            "forecast_type": row["forecast_type"],
            "period_label": row["period_label"],
            "fiscal_years": row.get("fiscal_years"),
            "start_date": row["start_date"].isoformat() if row.get("start_date") else None,
            "end_date": row["end_date"].isoformat() if row.get("end_date") else None,
            "month_count": row["month_count"],
            "current": self._scenario_block(row, "current"),
            "ia_recommended": self._scenario_block(row, "ia", vs_current=True),
            "finalized": self._scenario_block(row, "fin", vs_current=True),
        }

    def _scenario_block(self, row: dict, prefix: str, vs_current: bool = False) -> dict:
        block = {
            "sales_units": {
                "actuals":  row[f"{prefix}_actuals_sales"],
                "forecast": row[f"{prefix}_forecast_sales"],
                "total":    row[f"{prefix}_total_sales"],
            },
            "revenue": {
                "actuals":  row[f"{prefix}_actuals_revenue"],
                "forecast": row[f"{prefix}_forecast_revenue"],
                "total":    row[f"{prefix}_total_revenue"],
            },
            "gross_margin_dollar": {
                "actuals":  row[f"{prefix}_actuals_gm"],
                "forecast": row[f"{prefix}_forecast_gm"],
                "total":    row[f"{prefix}_total_gm"],
            },
            "asp": {
                "actuals":  row[f"{prefix}_actuals_asp"],
                "forecast": row[f"{prefix}_forecast_asp"],
                "total":    row[f"{prefix}_total_asp"],
            },
            "aum": {
                "actuals":  row[f"{prefix}_actuals_aum"],
                "forecast": row[f"{prefix}_forecast_aum"],
                "total":    row[f"{prefix}_total_aum"],
            },
            "gm_percentage": {
                "actuals":  row[f"{prefix}_actuals_gm_pct"],
                "forecast": row[f"{prefix}_forecast_gm_pct"],
                "total":    row[f"{prefix}_total_gm_pct"],
            },
        }
        if vs_current:
            block["sales_units"]["vs_current"]         = row[f"{prefix}_vs_current_sales"]
            block["revenue"]["vs_current"]             = row[f"{prefix}_vs_current_revenue"]
            block["gross_margin_dollar"]["vs_current"] = row[f"{prefix}_vs_current_gm"]
            block["asp"]["vs_current"]                 = row[f"{prefix}_vs_current_asp"]
            block["aum"]["vs_current"]                 = row[f"{prefix}_vs_current_aum"]
            block["gm_percentage"]["vs_current"]       = row[f"{prefix}_vs_current_gm_pct"]
        return block


# Singleton instance
monthly_summary_cards_validator = MonthlySummaryCardsValidator()
