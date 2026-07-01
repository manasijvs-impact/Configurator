"""
Validation Planner Module
Determines what to validate (actuals, forecast, or both) for a strategy
based on bp_forecast_cal_config settings and date ranges.

Uses shared database connection from database.py
"""

from app.core.database import db
from typing import Dict, List, Optional
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta


class ValidationPlanner:
    """Plans validation scope based on forecast calendar configuration.
    
    For each active forecast type in bp_forecast_cal_config:
    - Resolves the date range (start_reference, end_reference)
    - Determines actuals portion (up to max transaction date)
    - Determines forecast portion (after max transaction date)
    """
    
    def __init__(self):
        self._config_cache = None
    
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
    
    def clear_cache(self):
        """Clear configuration cache."""
        self._config_cache = None
    
    # =========================================================================
    # DATA FETCHING METHODS
    # =========================================================================
    
    def get_active_forecast_configs(self) -> List[Dict]:
        """Fetch active forecast calendar configurations."""
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
        """Get strategy details including dates."""
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
    
    def get_max_actuals_date(self) -> date:
        """Get the maximum transaction date from daily transaction data."""
        query = f"""
            SELECT MAX(transaction_date) AS max_actuals_date
            FROM {self.schema}.bp_transaction_data_daily
        """
        result = self._execute_query(query)
        if result and result[0]['max_actuals_date']:
            return result[0]['max_actuals_date']
        return None
    
    def get_fiscal_info_for_date(self, target_date: date) -> Dict:
        """Get fiscal calendar info for a specific date."""
        query = f"""
            SELECT
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
            WHERE date_id = '{target_date}'
            LIMIT 1
        """
        result = self._execute_query(query)
        return result[0] if result else None

    def get_current_fiscal_info(self) -> Dict:
        """Fiscal info for TODAY. Drives FISCAL_YEAR / FISCAL_YEAR_Qx resolution.

        Spec: 'show only current fiscal year segment based on today's date'.
        CALENDAR_YEAR (12 Months) is anchored on strategy_start_date and does NOT use this.
        """
        return self.get_fiscal_info_for_date(date.today())

    def get_forecast_end_date(self, strategy_id: int) -> Optional[date]:
        """Latest forecast date available in bp_monthly_forecast for this strategy."""
        query = f"""
            SELECT MAX(end_date) AS forecast_end_date
            FROM {self.schema}.bp_monthly_forecast
            WHERE strategy_id = {strategy_id}
        """
        result = self._execute_query(query)
        return result[0]['forecast_end_date'] if result and result[0]['forecast_end_date'] else None

    @staticmethod
    def _format_fiscal_year_label(fiscal_year: int) -> str:
        """Format fiscal year as 'FY YYYY-YY' (e.g., FY 2026-27)."""
        if fiscal_year is None:
            return None
        return f"FY {fiscal_year}-{str(fiscal_year + 1)[-2:]}"

    @staticmethod
    def _fmt_date(d) -> Optional[str]:
        """Format a date as DD-Mon-YYYY (e.g., 15-Oct-2026) for message templates."""
        if d is None:
            return None
        return d.strftime('%d-%b-%Y')
    
    def get_quarter_dates(self, fiscal_year: int, quarter: int) -> Dict:
        """Get start and end dates for a specific fiscal quarter."""
        query = f"""
            SELECT 
                MIN(fiscal_fd_qtr) AS quarter_start,
                MAX(fiscal_ld_qtr) AS quarter_end
            FROM global.tb_fiscal_date_mapping
            WHERE fiscal_year = {fiscal_year}
              AND fiscal_quarter = {quarter}
        """
        result = self._execute_query(query)
        return result[0] if result else None
    
    def get_all_quarters_for_fiscal_year(self, fiscal_year: int) -> List[Dict]:
        """Get all quarters and their date ranges for a fiscal year."""
        query = f"""
            SELECT DISTINCT
                fiscal_quarter,
                MIN(fiscal_fd_qtr) AS quarter_start,
                MAX(fiscal_ld_qtr) AS quarter_end
            FROM global.tb_fiscal_date_mapping
            WHERE fiscal_year = {fiscal_year}
            GROUP BY fiscal_quarter
            ORDER BY fiscal_quarter
        """
        return self._execute_query(query)
    
    # =========================================================================
    # DATE RANGE RESOLUTION
    # =========================================================================
    
    def resolve_date_range(self, forecast_type: str, start_reference: str,
                          end_reference: str, strategy_info: Dict,
                          fiscal_info: Dict,
                          cumulative_quarters: Optional[List[int]] = None) -> Dict:
        """Resolve the actual date range based on reference types.

        Args:
            forecast_type: Type like FISCAL_YEAR, CALENDAR_YEAR, FISCAL_YEAR_Q1, etc.
            start_reference, end_reference: Reference labels (fiscal_year_start, etc.)
            strategy_info: Strategy details with start_date, end_date
            fiscal_info: Active FY (today's or strategy's per single/multi-FY rule)
            cumulative_quarters: List of fiscal quarter numbers driving quarter_start/quarter_end.
                For discrete projection_mode it's a single-element list (e.g. [1]).
                For cumulative it's multi-element (e.g. [1, 2]); start uses MIN(q.start),
                end uses MAX(q.end).

        Returns:
            Dict with range_start, range_end, or None if cannot be resolved
        """
        if forecast_type == 'CURRENT_STRATEGY_PERIOD':
            return None

        range_start = None
        range_end = None

        # --- Start ---
        if start_reference == 'fiscal_year_start':
            range_start = fiscal_info['fiscal_fd_year']
        elif start_reference == 'strategy_start_date':
            range_start = strategy_info['start_date']
        elif start_reference == 'quarter_start':
            range_start = self._quarter_bound(
                fiscal_info['fiscal_year'], cumulative_quarters, which='start'
            )

        # --- End ---
        if end_reference == 'fiscal_year_end':
            range_end = fiscal_info['fiscal_ld_year']
        elif end_reference == 'twelve_months':
            # 12 Months: strategy_start + 12 months, rounded to fiscal_ld_month.
            # Fiscal months don't always align with calendar months (e.g., 2026-10-04 -> 2026-10-31).
            target = strategy_info['start_date'] + relativedelta(months=12)
            target_fiscal = self.get_fiscal_info_for_date(target)
            range_end = target_fiscal['fiscal_ld_month'] if target_fiscal else target
        elif end_reference == 'quarter_end':
            range_end = self._quarter_bound(
                fiscal_info['fiscal_year'], cumulative_quarters, which='end'
            )

        if range_start and range_end:
            return {'range_start': range_start, 'range_end': range_end}
        return None

    def _quarter_bound(self, fiscal_year: int, cumulative_quarters: Optional[List[int]],
                       which: str) -> Optional[date]:
        """MIN(quarter_start) or MAX(quarter_end) across the given fiscal quarters.

        which: 'start' -> MIN(fiscal_fd_qtr); 'end' -> MAX(fiscal_ld_qtr).
        Returns None if cumulative_quarters is empty/None.
        """
        if not cumulative_quarters:
            return None
        # Normalise into a comma-separated list of ints (caller may pass a PG array or list)
        quarters = [int(q) for q in cumulative_quarters]
        agg = 'MIN(fiscal_fd_qtr)' if which == 'start' else 'MAX(fiscal_ld_qtr)'
        in_list = ','.join(str(q) for q in quarters)
        query = f"""
            SELECT {agg} AS bound
            FROM global.tb_fiscal_date_mapping
            WHERE fiscal_year = {fiscal_year}
              AND fiscal_quarter IN ({in_list})
        """
        result = self._execute_query(query)
        return result[0]['bound'] if result else None
    
    # =========================================================================
    # ACTUALS/FORECAST SPLIT
    # =========================================================================
    
    def determine_validation_scope(self, range_start: date, range_end: date, 
                                   max_actuals_date: date) -> Dict:
        """Determine what portion is actuals vs forecast.
        
        Args:
            range_start: Start of the validation range
            range_end: End of the validation range
            max_actuals_date: Maximum date with actual transaction data
        
        Returns:
            Dict with:
            - validate_actuals: bool
            - validate_forecast: bool
            - actuals_start, actuals_end: date range for actuals (if applicable)
            - forecast_start, forecast_end: date range for forecast (if applicable)
        """
        result = {
            'validate_actuals': False,
            'validate_forecast': False,
            'actuals_start': None,
            'actuals_end': None,
            'forecast_start': None,
            'forecast_end': None
        }
        
        # Case 1: Entire range is in the past (all actuals)
        if range_end <= max_actuals_date:
            result['validate_actuals'] = True
            result['actuals_start'] = range_start
            result['actuals_end'] = range_end
            return result
        
        # Case 2: Entire range is in the future (all forecast)
        if range_start > max_actuals_date:
            result['validate_forecast'] = True
            result['forecast_start'] = range_start
            result['forecast_end'] = range_end
            return result
        
        # Case 3: Range spans both actuals and forecast
        # Actuals: range_start to max_actuals_date
        result['validate_actuals'] = True
        result['actuals_start'] = range_start
        result['actuals_end'] = max_actuals_date
        
        # Forecast: day after max_actuals_date to range_end
        result['validate_forecast'] = True
        result['forecast_start'] = max_actuals_date + timedelta(days=1)
        result['forecast_end'] = range_end
        
        return result
    
    # =========================================================================
    # MAIN PLANNING METHOD
    # =========================================================================
    
    def get_validation_plan(self, strategy_id: int) -> Dict:
        """Generate a complete validation plan for a strategy.
        
        Returns a plan showing what to validate for each active forecast type:
        - Which forecast types are active
        - Date ranges for each
        - Actuals vs forecast split
        
        Args:
            strategy_id: Strategy to plan validation for
        
        Returns:
            Dict with strategy info and list of validation items
        """
        # Get strategy info
        strategy_info = self.get_strategy_info(strategy_id)
        if not strategy_info:
            return {
                "success": False,
                "error": f"Strategy {strategy_id} not found",
                "strategy_id": strategy_id
            }
        
        # Get max actuals date
        max_actuals_date = self.get_max_actuals_date()
        if not max_actuals_date:
            return {
                "success": False,
                "error": "No transaction data found",
                "strategy_id": strategy_id
            }
        
        # Pick the active FY for FISCAL_YEAR / FISCAL_YEAR_Qx resolution.
        # Rule:
        #   - Strategy fits inside a single FY  -> use strategy's FY
        #   - Strategy crosses an FY boundary   -> use today's FY
        strategy_start_fy = self.get_fiscal_info_for_date(strategy_info['start_date'])
        strategy_end_fy = self.get_fiscal_info_for_date(strategy_info['end_date'])
        current_date_fy = self.get_current_fiscal_info()

        if (strategy_start_fy and strategy_end_fy
                and strategy_start_fy['fiscal_year'] == strategy_end_fy['fiscal_year']):
            fiscal_info = strategy_start_fy
        else:
            fiscal_info = current_date_fy

        if not fiscal_info:
            return {
                "success": False,
                "error": (f"No fiscal calendar data available for strategy start "
                          f"{strategy_info['start_date']}, end {strategy_info['end_date']}, "
                          f"or current date {date.today()}"),
                "strategy_id": strategy_id
            }

        # Latest forecast available for messaging
        forecast_end_date = self.get_forecast_end_date(strategy_id)

        # Get active forecast configs
        active_configs = self.get_active_forecast_configs()
        if not active_configs:
            return {
                "success": False,
                "error": "No active forecast configurations found",
                "strategy_id": strategy_id
            }
        
        # Build validation plan for each active config
        validations = []
        
        for config in active_configs:
            forecast_type = config['forecast_type']
            start_ref = config['start_reference']
            end_ref = config['end_reference']
            
            # Skip CURRENT_STRATEGY_PERIOD
            if forecast_type == 'CURRENT_STRATEGY_PERIOD':
                validations.append({
                    'forecast_type': forecast_type,
                    'label': config['label'],
                    'skip': True,
                    'skip_reason': 'No time-based calculation needed'
                })
                continue
            
            # Resolve date range. Quarter bounds are driven by cumulative_quarters
            # (works for both projection_mode = discrete and = cumulative).
            date_range = self.resolve_date_range(
                forecast_type, start_ref, end_ref,
                strategy_info, fiscal_info,
                cumulative_quarters=config.get('cumulative_quarters'),
            )
            
            if not date_range:
                validations.append({
                    'forecast_type': forecast_type,
                    'label': config['label'],
                    'skip': True,
                    'skip_reason': f'Could not resolve date range for {start_ref} -> {end_ref}'
                })
                continue
            
            # Determine actuals/forecast split
            scope = self.determine_validation_scope(
                date_range['range_start'],
                date_range['range_end'],
                max_actuals_date
            )
            
            # Message-template metadata per spec
            projection_end_date = date_range['range_end']
            # actuals_display_date: actuals_end if it precedes projection_end, else projection_end
            actuals_display_date = (
                min(max_actuals_date, projection_end_date)
                if max_actuals_date and max_actuals_date < projection_end_date
                else projection_end_date
            )

            validations.append({
                'forecast_type': forecast_type,
                'label': config['label'],
                'skip': False,
                'range_start': date_range['range_start'],
                'range_end': date_range['range_end'],
                'projection_end_date': projection_end_date,
                'forecast_end_date': forecast_end_date,
                'actuals_display_date': actuals_display_date,
                'fiscal_year_label': self._format_fiscal_year_label(fiscal_info['fiscal_year']),
                'validate_actuals': scope['validate_actuals'],
                'validate_forecast': scope['validate_forecast'],
                'actuals_start': scope['actuals_start'],
                'actuals_end': scope['actuals_end'],
                'forecast_start': scope['forecast_start'],
                'forecast_end': scope['forecast_end'],
                'projection_mode': config['projection_mode'],
                'cumulative_quarters': config['cumulative_quarters']
            })

        return {
            "success": True,
            "strategy_id": strategy_id,
            "strategy_name": strategy_info['strategy_name'],
            "strategy_start": strategy_info['start_date'],
            "strategy_end": strategy_info['end_date'],
            "max_actuals_date": max_actuals_date,
            "forecast_end_date": forecast_end_date,
            # Today's fiscal year (used for FISCAL_YEAR / FISCAL_YEAR_Qx clipping)
            "fiscal_year": fiscal_info['fiscal_year'],
            "fiscal_year_start": fiscal_info['fiscal_fd_year'],
            "fiscal_year_end": fiscal_info['fiscal_ld_year'],
            "fiscal_year_label": self._format_fiscal_year_label(fiscal_info['fiscal_year']),
            "validations": validations
        }
    
    def print_plan(self, strategy_id: int):
        """Print a human-readable validation plan."""
        plan = self.get_validation_plan(strategy_id)
        
        if not plan['success']:
            print(f"ERROR: {plan['error']}")
            return
        
        print("=" * 80)
        print(f"VALIDATION PLAN FOR STRATEGY {plan['strategy_id']}: {plan['strategy_name']}")
        print("=" * 80)
        print(f"Strategy Period:     {plan['strategy_start']} to {plan['strategy_end']}")
        print(f"Fiscal Year:         {plan['fiscal_year']} ({plan['fiscal_year_start']} to {plan['fiscal_year_end']})")
        print(f"Max Actuals Date:    {plan['max_actuals_date']}")
        print("-" * 80)
        
        for v in plan['validations']:
            print(f"\n[{v['forecast_type']}] {v['label']}")
            
            if v['skip']:
                print(f"  SKIP: {v['skip_reason']}")
                continue
            
            print(f"  Range: {v['range_start']} to {v['range_end']}")
            
            if v['validate_actuals']:
                print(f"  ✓ ACTUALS:  {v['actuals_start']} to {v['actuals_end']}")
            else:
                print(f"  ✗ ACTUALS:  (none)")
            
            if v['validate_forecast']:
                print(f"  ✓ FORECAST: {v['forecast_start']} to {v['forecast_end']}")
            else:
                print(f"  ✗ FORECAST: (none)")
        
        print("\n" + "=" * 80)
    
    def get_months_to_validate(self, strategy_id: int, forecast_type: str = None) -> Dict:
        """Get list of months to validate for actuals and forecast.
        
        Args:
            strategy_id: Strategy to get months for
            forecast_type: Optional specific forecast type, or None for all active
        
        Returns:
            Dict with actuals_months and forecast_months lists
        """
        plan = self.get_validation_plan(strategy_id)
        
        if not plan['success']:
            return plan
        
        result = {
            'success': True,
            'strategy_id': strategy_id,
            'actuals_months': [],
            'forecast_months': []
        }
        
        for v in plan['validations']:
            if v['skip']:
                continue
            
            if forecast_type and v['forecast_type'] != forecast_type:
                continue
            
            # Get months for actuals
            if v['validate_actuals']:
                actuals_months = self._get_months_in_range(
                    v['actuals_start'], v['actuals_end']
                )
                for m in actuals_months:
                    m['forecast_type'] = v['forecast_type']
                result['actuals_months'].extend(actuals_months)
            
            # Get months for forecast
            if v['validate_forecast']:
                forecast_months = self._get_months_in_range(
                    v['forecast_start'], v['forecast_end']
                )
                for m in forecast_months:
                    m['forecast_type'] = v['forecast_type']
                result['forecast_months'].extend(forecast_months)
        
        return result
    
    def _get_months_in_range(self, start_date: date, end_date: date) -> List[Dict]:
        """Get all fiscal months that overlap with a date range."""
        query = f"""
            SELECT DISTINCT
                fiscal_year,
                fiscal_month,
                month_name,
                fiscal_fd_month,
                fiscal_ld_month,
                -- Actual range within this month
                GREATEST(fiscal_fd_month, '{start_date}'::date) AS range_start,
                LEAST(fiscal_ld_month, '{end_date}'::date) AS range_end,
                -- Is this a full month or partial?
                CASE 
                    WHEN fiscal_fd_month >= '{start_date}'::date 
                         AND fiscal_ld_month <= '{end_date}'::date 
                    THEN 'FULL_MONTH'
                    ELSE 'PARTIAL'
                END AS coverage
            FROM global.tb_fiscal_date_mapping
            WHERE date_id BETWEEN '{start_date}' AND '{end_date}'
            ORDER BY fiscal_year, fiscal_month
        """
        return self._execute_query(query)
    
    # =========================================================================
    # COMBINED VALIDATION (ALL ACTIVE TYPES TOGETHER)
    # =========================================================================
    
    def get_combined_validation_plan(self, strategy_id: int) -> Dict:
        """Get combined validation plan across ALL active forecast types.
        
        Instead of separate ranges per forecast type, returns:
        - Overall date range (min start to max end across all types)
        - Combined actuals months to validate
        - Combined forecast months to validate
        
        Args:
            strategy_id: Strategy to plan validation for
        
        Returns:
            Dict with combined actuals_months and forecast_months
        """
        # First get the standard plan
        plan = self.get_validation_plan(strategy_id)
        
        if not plan['success']:
            return plan
        
        # Find overall range across all active (non-skipped) types
        all_starts = []
        all_ends = []
        actuals_ranges = []
        forecast_ranges = []
        
        for v in plan['validations']:
            if v.get('skip'):
                continue
            
            all_starts.append(v['range_start'])
            all_ends.append(v['range_end'])
            
            if v['validate_actuals']:
                actuals_ranges.append((v['actuals_start'], v['actuals_end']))
            
            if v['validate_forecast']:
                forecast_ranges.append((v['forecast_start'], v['forecast_end']))
        
        if not all_starts:
            return {
                "success": False,
                "error": "No active forecast types with valid date ranges",
                "strategy_id": strategy_id
            }
        
        # Calculate overall range
        overall_start = min(all_starts)
        overall_end = max(all_ends)
        
        # Merge actuals ranges and get unique months
        actuals_months = []
        if actuals_ranges:
            # Find min start and max end across all actuals ranges
            actuals_start = min(r[0] for r in actuals_ranges)
            actuals_end = max(r[1] for r in actuals_ranges)
            actuals_months = self._get_months_in_range(actuals_start, actuals_end)
        
        # Merge forecast ranges and get unique months
        forecast_months = []
        if forecast_ranges:
            # Find min start and max end across all forecast ranges
            forecast_start = min(r[0] for r in forecast_ranges)
            forecast_end = max(r[1] for r in forecast_ranges)
            forecast_months = self._get_months_in_range(forecast_start, forecast_end)
        
        # Combined message-template metadata
        projection_end_date = overall_end
        max_actuals_date = plan['max_actuals_date']
        actuals_display_date = (
            min(max_actuals_date, projection_end_date)
            if max_actuals_date and max_actuals_date < projection_end_date
            else projection_end_date
        )

        return {
            "success": True,
            "strategy_id": strategy_id,
            "strategy_name": plan['strategy_name'],
            "strategy_start": plan['strategy_start'],
            "strategy_end": plan['strategy_end'],
            "max_actuals_date": max_actuals_date,
            "forecast_end_date": plan.get('forecast_end_date'),
            # Today's fiscal year
            "fiscal_year": plan['fiscal_year'],
            "fiscal_year_start": plan['fiscal_year_start'],
            "fiscal_year_end": plan['fiscal_year_end'],
            "fiscal_year_label": plan.get('fiscal_year_label'),

            # Overall range
            "overall_range_start": overall_start,
            "overall_range_end": overall_end,
            "projection_end_date": projection_end_date,
            "actuals_display_date": actuals_display_date,

            # Actuals summary
            "validate_actuals": len(actuals_months) > 0,
            "actuals_start": min(r[0] for r in actuals_ranges) if actuals_ranges else None,
            "actuals_end": max(r[1] for r in actuals_ranges) if actuals_ranges else None,
            "actuals_months": actuals_months,

            # Forecast summary
            "validate_forecast": len(forecast_months) > 0,
            "forecast_start": min(r[0] for r in forecast_ranges) if forecast_ranges else None,
            "forecast_end": max(r[1] for r in forecast_ranges) if forecast_ranges else None,
            "forecast_months": forecast_months,

            # Per-type breakdown
            "per_type_validations": plan['validations']
        }
    
    def print_combined_plan(self, strategy_id: int):
        """Print a human-readable combined validation plan."""
        plan = self.get_combined_validation_plan(strategy_id)
        
        if not plan['success']:
            print(f"ERROR: {plan['error']}")
            return
        
        print("=" * 80)
        print(f"COMBINED VALIDATION PLAN FOR STRATEGY {plan['strategy_id']}: {plan['strategy_name']}")
        print("=" * 80)
        print(f"Strategy Period:     {plan['strategy_start']} to {plan['strategy_end']}")
        print(f"Fiscal Year:         {plan['fiscal_year']} ({plan['fiscal_year_start']} to {plan['fiscal_year_end']})")
        print(f"Max Actuals Date:    {plan['max_actuals_date']}")
        print(f"Overall Range:       {plan['overall_range_start']} to {plan['overall_range_end']}")
        print("-" * 80)
        
        # Actuals
        print("\n📊 ACTUALS TO VALIDATE (bp_monthly_forecast_actuals)")
        if plan['validate_actuals']:
            print(f"   Range: {plan['actuals_start']} to {plan['actuals_end']}")
            print(f"   Months:")
            for m in plan['actuals_months']:
                coverage = "FULL" if m['coverage'] == 'FULL_MONTH' else "PARTIAL"
                print(f"     • FY{m['fiscal_year']} M{m['fiscal_month']:02d} ({m['month_name']}) [{coverage}]")
                print(f"       {m['range_start']} to {m['range_end']}")
        else:
            print("   (none)")
        
        # Forecast
        print("\n📈 FORECAST TO VALIDATE (bp_monthly_forecast)")
        if plan['validate_forecast']:
            print(f"   Range: {plan['forecast_start']} to {plan['forecast_end']}")
            print(f"   Months:")
            for m in plan['forecast_months']:
                coverage = "FULL" if m['coverage'] == 'FULL_MONTH' else "PARTIAL"
                print(f"     • FY{m['fiscal_year']} M{m['fiscal_month']:02d} ({m['month_name']}) [{coverage}]")
                print(f"       {m['range_start']} to {m['range_end']}")
        else:
            print("   (none)")
        
        print("\n" + "=" * 80)


    # =========================================================================
    # PROJECTION MESSAGE TEMPLATES (UI display)
    # =========================================================================

    def get_projection_messages(self, strategy_id: int) -> Dict:
        """Compose human-readable projection messages per forecast type.

        For each active forecast type produces:
          - base:                    minimal "<type> projections from A to B."
          - with_forecast_constraint: appended when forecast_end_date < projection_end_date
          - with_actuals:             appended when validate_actuals is true
          - best:                    the most informative applicable variant

        Dates formatted DD-Mon-YYYY (e.g., 15-Oct-2026) per spec.
        """
        plan = self.get_validation_plan(strategy_id)
        if not plan['success']:
            return plan

        messages = {}
        for v in plan['validations']:
            ft = v['forecast_type']

            if v.get('skip'):
                messages[ft] = {'skipped': True, 'reason': v.get('skip_reason')}
                continue

            # Type-specific lead word
            if ft == 'CALENDAR_YEAR':
                label_word = '12-month'
            elif ft == 'FISCAL_YEAR':
                label_word = 'Fiscal year'
            elif ft.startswith('FISCAL_YEAR_Q'):
                label_word = f'Q{ft[-1]}'
            else:
                label_word = ft.replace('_', ' ').title()

            start_s = self._fmt_date(v['range_start'])
            end_s = self._fmt_date(v['projection_end_date'])
            forecast_end = v.get('forecast_end_date')
            actuals_display = v.get('actuals_display_date')

            base = f"{label_word} projections from {start_s} to {end_s}."
            result = {'base': base}

            fc_clause = ''
            if forecast_end and forecast_end < v['projection_end_date']:
                fc_clause = f" (forecast available until {self._fmt_date(forecast_end)})"
                result['with_forecast_constraint'] = (
                    f"{label_word} projections from {start_s} to {end_s}{fc_clause}."
                )

            if v['validate_actuals'] and actuals_display:
                result['with_actuals'] = (
                    f"{label_word} projections from {start_s} to {end_s}{fc_clause}. "
                    f"Actuals up to {self._fmt_date(actuals_display)}."
                )

            result['best'] = (
                result.get('with_actuals')
                or result.get('with_forecast_constraint')
                or result['base']
            )
            messages[ft] = result

        return {
            'success': True,
            'strategy_id': strategy_id,
            'strategy_name': plan['strategy_name'],
            'fiscal_year_label': plan.get('fiscal_year_label'),
            'messages': messages,
        }


# Module-level instance
validation_planner = ValidationPlanner()
