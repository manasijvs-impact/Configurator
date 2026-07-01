import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';

// Icons
const WorkbenchIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
    <line x1="7" y1="7" x2="7.01" y2="7"/>
  </svg>
);

const RulesIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4"/>
  </svg>
);

const DocumentIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
  </svg>
);

const ChartIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
    <line x1="18" y1="20" x2="18" y2="10"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);

const InfoIcon = ({ tooltip }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        style={{
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          background: '#264CD7',
          color: 'white',
          border: 'none',
          cursor: 'help',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: '600',
          fontStyle: 'italic'
        }}
      >
        i
      </button>
      {showTooltip && (
        <div style={{
          position: 'absolute',
          left: '50%',
          top: '100%',
          transform: 'translateX(-50%)',
          marginTop: '8px',
          padding: '10px 14px',
          background: '#1a1a2e',
          color: 'white',
          fontSize: '12px',
          borderRadius: '8px',
          whiteSpace: 'nowrap',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
          {tooltip}
          <div style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            border: '6px solid transparent',
            borderBottomColor: '#1a1a2e'
          }} />
        </div>
      )}
    </div>
  );
};

function DataValidatorPage({ activeRoute, scope }) {
  const [activeWorkbenchTab, setActiveWorkbenchTab] = useState(null); // null = workbench list, 'sales-units' = validator screen
  const [strategyId, setStrategyId] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [validationError, setValidationError] = useState(null);
  const [validationQuery, setValidationQuery] = useState('');
  const [showValidationQuery, setShowValidationQuery] = useState(false);
  // Single shared spinner flag for every Show/View Query button across validators —
  // each handler that fetches a generated SQL flips this on entry and off in finally,
  // so users can't spam the button while the fetch is in flight.
  const [isLoadingQuery, setIsLoadingQuery] = useState(false);
  
  // Rules validation state
  const [isValidatingRules, setIsValidatingRules] = useState(false);
  const [rulesValidationResult, setRulesValidationResult] = useState(null);
  const [rulesValidationError, setRulesValidationError] = useState(null);
  
  // Metrics validation state
  const [metricsStrategyId, setMetricsStrategyId] = useState('');
  const [metricsViewBy, setMetricsViewBy] = useState('summary');
  const [isValidatingMetrics, setIsValidatingMetrics] = useState(false);
  const [metricsValidationResult, setMetricsValidationResult] = useState(null);
  const [metricsValidationError, setMetricsValidationError] = useState(null);
  
  // Summary cards validation state
  const [summaryCardsStrategyId, setSummaryCardsStrategyId] = useState('');
  const [isValidatingSummaryCards, setIsValidatingSummaryCards] = useState(false);
  const [summaryCardsResult, setSummaryCardsResult] = useState(null);
  const [summaryCardsError, setSummaryCardsError] = useState(null);
  const [summaryCardsChannels, setSummaryCardsChannels] = useState([]);
  const [selectedChannels, setSelectedChannels] = useState([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);
  const [showChannelDropdown, setShowChannelDropdown] = useState(false);
  const [summaryCardsQuery, setSummaryCardsQuery] = useState('');
  const [showSummaryCardsQuery, setShowSummaryCardsQuery] = useState(false);

  // Monthly summary cards validation state (FISCAL_YEAR / Qx / CALENDAR_YEAR / TWELVE_MONTHS)
  const [monthlySummaryStrategyId, setMonthlySummaryStrategyId] = useState('');
  const [isValidatingMonthlySummary, setIsValidatingMonthlySummary] = useState(false);
  const [monthlySummaryResult, setMonthlySummaryResult] = useState(null);
  const [monthlySummaryError, setMonthlySummaryError] = useState(null);
  const [monthlySummaryChannels, setMonthlySummaryChannels] = useState([]);
  const [selectedMonthlyChannels, setSelectedMonthlyChannels] = useState([]);
  const [isLoadingMonthlyChannels, setIsLoadingMonthlyChannels] = useState(false);
  const [showMonthlyChannelDropdown, setShowMonthlyChannelDropdown] = useState(false);
  const [monthlySummaryQuery, setMonthlySummaryQuery] = useState('');
  const [showMonthlySummaryQuery, setShowMonthlySummaryQuery] = useState(false);

  // Monthly detailed view state (Summary | Detailed-view tabs share strategy + channels)
  const [monthlyActiveTab, setMonthlyActiveTab] = useState('summary'); // 'summary' | 'detailed'
  const [monthlyDetailedViewBy, setMonthlyDetailedViewBy] = useState('product'); // 'product' | 'line_group'
  const [monthlyDetailedRows, setMonthlyDetailedRows] = useState([]);
  const [monthlyDetailedLoading, setMonthlyDetailedLoading] = useState(false);
  const [monthlyDetailedError, setMonthlyDetailedError] = useState(null);

  // Reco grid data validator state (our reco rollup vs bp_strategy_price_reco_grid_data_*_pricezone)
  const [recoGridStrategyId, setRecoGridStrategyId] = useState('');
  const [recoGridViewBy, setRecoGridViewBy] = useState('product'); // 'product' | 'line_group'
  const [isValidatingRecoGrid, setIsValidatingRecoGrid] = useState(false);
  const [recoGridResult, setRecoGridResult] = useState(null);
  const [recoGridError, setRecoGridError] = useState(null);
  const [recoGridQuery, setRecoGridQuery] = useState('');
  const [showRecoGridQuery, setShowRecoGridQuery] = useState(false);
  const [recoGridScenario, setRecoGridScenario] = useState('current'); // 'current' | 'ia' | 'finalized' | 'actuals'

  // Table interaction states
  const [columnFilters, setColumnFilters] = useState({});
  const [sortConfig, setSortConfig] = useState({ key: null, direction: null });
  const [expandedRow, setExpandedRow] = useState(null);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState(new Set());
  const [wrapText, setWrapText] = useState(false);  // Global wrap text setting
  const [contentDensity, setContentDensity] = useState('default');  // default, compact, comfort
  const [columnSearch, setColumnSearch] = useState('');  // Search columns
  const [openFilterColumn, setOpenFilterColumn] = useState(null);  // For dropdown (triangle)
  const [filterSearchText, setFilterSearchText] = useState('');    // Search within dropdown list
  const [textSearchFilters, setTextSearchFilters] = useState({});  // Text search per column
  const [openTextSearch, setOpenTextSearch] = useState(null);      // For magnifying glass
  
  // Ref for scrollable cards container
  const cardsScrollRef = useRef(null);
  
  // Scroll cards left/right
  const scrollCards = (direction) => {
    if (cardsScrollRef.current) {
      const scrollAmount = 400;
      cardsScrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };
  
  // Auto-load channels for the Summary Cards screens once the user has typed a
  // strategy ID. Debounced to 400ms so we don't spam the endpoint while typing.
  // Without this the Validate button stays disabled until the input is blurred,
  // which is non-obvious.
  useEffect(() => {
    const id = summaryCardsStrategyId.trim();
    if (!id) return;
    const t = setTimeout(async () => {
      try {
        setIsLoadingChannels(true);
        const response = await api.getSummaryCardsChannels(parseInt(id));
        if (response.data.success) {
          const channels = response.data.channels || [];
          setSummaryCardsChannels(channels);
          setSelectedChannels(channels.map(c => c.id));
        }
      } catch (err) {
        setSummaryCardsChannels([]);
        setSelectedChannels([]);
      } finally {
        setIsLoadingChannels(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [summaryCardsStrategyId]);

  useEffect(() => {
    const id = monthlySummaryStrategyId.trim();
    if (!id) return;
    const t = setTimeout(async () => {
      try {
        setIsLoadingMonthlyChannels(true);
        const response = await api.getMonthlySummaryCardsChannels(parseInt(id));
        if (response.data.success) {
          const channels = response.data.channels || [];
          setMonthlySummaryChannels(channels);
          setSelectedMonthlyChannels(channels.map(c => c.id));
        }
      } catch (err) {
        setMonthlySummaryChannels([]);
        setSelectedMonthlyChannels([]);
      } finally {
        setIsLoadingMonthlyChannels(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [monthlySummaryStrategyId]);

  // Fetch Detailed view rows whenever the Detailed tab is active and strategy/view/channels change.
  useEffect(() => {
    if (monthlyActiveTab !== 'detailed') return;
    const id = monthlySummaryStrategyId.trim();
    if (!id || selectedMonthlyChannels.length === 0) {
      setMonthlyDetailedRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setMonthlyDetailedLoading(true);
        setMonthlyDetailedError(null);
        const channelIds = selectedMonthlyChannels.join(',');
        const response = await api.getMonthlyDetailedView(parseInt(id), monthlyDetailedViewBy, channelIds);
        if (cancelled) return;
        if (response.data.success) {
          setMonthlyDetailedRows(response.data.rows || []);
        } else {
          setMonthlyDetailedError(response.data.error || 'Failed to load detailed view');
        }
      } catch (err) {
        if (cancelled) return;
        setMonthlyDetailedError(err.response?.data?.detail || err.message || 'Failed to load detailed view');
      } finally {
        if (!cancelled) setMonthlyDetailedLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [monthlyActiveTab, monthlyDetailedViewBy, monthlySummaryStrategyId, selectedMonthlyChannels]);

  // Whenever a validator's strategy input (or view-by / channel selection, where
  // applicable) changes, collapse the "Show Query" block, clear the cached SQL,
  // AND drop the last validation result + error — otherwise the user is staring at
  // stale summary cards / tables that no longer correspond to the inputs in the bar.
  useEffect(() => {
    setShowValidationQuery(false);
    setValidationQuery('');
    setValidationResult(null);
    setValidationError(null);
  }, [strategyId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setShowSummaryCardsQuery(false);
    setSummaryCardsQuery('');
    setSummaryCardsResult(null);
    setSummaryCardsError(null);
  }, [summaryCardsStrategyId, selectedChannels]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setShowMonthlySummaryQuery(false);
    setMonthlySummaryQuery('');
    setMonthlySummaryResult(null);
    setMonthlySummaryError(null);
    setMonthlyDetailedRows([]);
    setMonthlyDetailedError(null);
  }, [monthlySummaryStrategyId, selectedMonthlyChannels]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setShowRecoGridQuery(false);
    setRecoGridQuery('');
    setRecoGridResult(null);
    setRecoGridError(null);
  }, [recoGridStrategyId, recoGridViewBy]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close filter popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (openFilterColumn && !e.target.closest('.filter-popover')) {
        setOpenFilterColumn(null);
        setFilterSearchText('');
      }
      if (openTextSearch && !e.target.closest('.text-search-popover')) {
        setOpenTextSearch(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openFilterColumn, openTextSearch]);
  
  // Column definitions for the table
  const columnGroups = [
    { name: 'Identity', color: '#94a3b8', columns: [
      { key: 'opt_level_bins', label: 'Opt Level Bins' },
      { key: 'product_code', label: 'Product Code' },
      { key: 'channel_name', label: 'Channel' },
      { key: 'price_zone', label: 'Price Zone' },
      { key: 'segment_name', label: 'Segment' },
    ]},
    { name: 'Calculated Actuals', color: '#f9a8d4', columns: [
      { key: 'calc_actual_sales_units', label: 'Actual Sales Units' },
      { key: 'calc_actual_revenue', label: 'Actual Revenue' },
      { key: 'calc_actual_gm_dollar', label: 'Actual GM$' },
      { key: 'calc_actual_gm_pct', label: 'Actual GM%' },
      { key: 'calc_actual_asp', label: 'Actual ASP' },
      { key: 'calc_actual_aum', label: 'Actual AUM' },
    ]},
    { name: 'Current', color: '#93c5fd', columns: [
      // Prices
      { key: 'price_current', label: 'Base Price' },
      { key: 'promo_price_current', label: 'Promo Price' },
      { key: 'stored_promo_current', label: 'Stored Promo %' },
      { key: 'promo_current_match', label: 'Promo Match', isMatch: true },
      // Sales
      { key: 'stored_sales_current', label: 'Sales Stored' },
      { key: 'calc_sales_current', label: 'Sales Calc' },
      { key: 'sales_current_match', label: 'Sales Match', isMatch: true },
      // Baseline Units
      { key: 'stored_baseline_current', label: 'Baseline Units Stored' },
      { key: 'calc_baseline_current', label: 'Baseline Units Calc' },
      { key: 'baseline_current_match', label: 'Baseline Units Match', isMatch: true },
      // Revenue
      { key: 'stored_revenue_current', label: 'Revenue Stored' },
      { key: 'calc_revenue_current', label: 'Revenue Calc' },
      { key: 'revenue_current_match', label: 'Revenue Match', isMatch: true },
      // Baseline Revenue
      { key: 'stored_baseline_rev_current', label: 'Baseline Rev Stored' },
      { key: 'calc_baseline_rev_current', label: 'Baseline Rev Calc' },
      { key: 'baseline_rev_current_match', label: 'Baseline Rev Match', isMatch: true },
      // GM$
      { key: 'stored_gm_dollar_current', label: 'GM$ Stored' },
      { key: 'calc_gm_dollar_current', label: 'GM$ Calc' },
      { key: 'gm_dollar_current_match', label: 'GM$ Match', isMatch: true },
      // Baseline GM$
      { key: 'stored_baseline_gm_current', label: 'Baseline GM$ Stored' },
      { key: 'calc_baseline_gm_current', label: 'Baseline GM$ Calc' },
      { key: 'baseline_gm_current_match', label: 'Baseline GM$ Match', isMatch: true },
      // GM%
      { key: 'stored_gm_pct_current', label: 'GM% Stored' },
      { key: 'calc_gm_pct_current', label: 'GM% Calc' },
      { key: 'gm_pct_current_match', label: 'GM% Match', isMatch: true },
      // Baseline GM%
      { key: 'stored_baseline_gm_pct_current', label: 'Baseline GM% Stored' },
      { key: 'calc_baseline_gm_pct_current', label: 'Baseline GM% Calc' },
      { key: 'baseline_gm_pct_current_match', label: 'Baseline GM% Match', isMatch: true },
      // ASP
      { key: 'stored_asp_current', label: 'ASP Stored' },
      { key: 'calc_asp_current', label: 'ASP Calc' },
      { key: 'asp_current_match', label: 'ASP Match', isMatch: true },
      // Baseline ASP
      { key: 'stored_baseline_asp_current', label: 'Baseline ASP Stored' },
      { key: 'calc_baseline_asp_current', label: 'Baseline ASP Calc' },
      { key: 'baseline_asp_current_match', label: 'Baseline ASP Match', isMatch: true },
      // AUM
      { key: 'stored_aum_current', label: 'AUM Stored' },
      { key: 'calc_aum_current', label: 'AUM Calc' },
      { key: 'aum_current_match', label: 'AUM Match', isMatch: true },
      // Baseline AUM
      { key: 'stored_baseline_aum_current', label: 'Baseline AUM Stored' },
      { key: 'calc_baseline_aum_current', label: 'Baseline AUM Calc' },
      { key: 'baseline_aum_current_match', label: 'Baseline AUM Match', isMatch: true },
      // Reco Actuals Current
      { key: 'reco_actuals_sales_current', label: 'Reco Actuals Sales' },
      { key: 'reco_actuals_revenue_current', label: 'Reco Actuals Revenue' },
      { key: 'reco_actuals_gm_dollar_current', label: 'Reco Actuals GM$' },
      { key: 'reco_actuals_gm_pct_current', label: 'Reco Actuals GM%' },
      { key: 'reco_actuals_asp_current', label: 'Reco Actuals ASP' },
      { key: 'reco_actuals_aum_current', label: 'Reco Actuals AUM' },
      { key: 'actuals_sales_current_match', label: 'Actuals Sales Match', isMatch: true },
      { key: 'actuals_revenue_current_match', label: 'Actuals Revenue Match', isMatch: true },
      { key: 'actuals_gm_dollar_current_match', label: 'Actuals GM$ Match', isMatch: true },
      { key: 'actuals_gm_pct_current_match', label: 'Actuals GM% Match', isMatch: true },
      { key: 'actuals_asp_current_match', label: 'Actuals ASP Match', isMatch: true },
      { key: 'actuals_aum_current_match', label: 'Actuals AUM Match', isMatch: true },
    ]},
    { name: 'IA', color: '#c4b5fd', columns: [
      // Prices
      { key: 'price_ia', label: 'Base Price' },
      { key: 'promo_price_ia', label: 'Promo Price' },
      { key: 'stored_promo_ia', label: 'Stored Promo %' },
      { key: 'promo_ia_match', label: 'Promo Match', isMatch: true },
      // Sales
      { key: 'stored_sales_ia', label: 'Sales Stored' },
      { key: 'calc_sales_ia', label: 'Sales Calc' },
      { key: 'sales_ia_match', label: 'Sales Match', isMatch: true },
      // Baseline Units
      { key: 'stored_baseline_ia', label: 'Baseline Units Stored' },
      { key: 'calc_baseline_ia', label: 'Baseline Units Calc' },
      { key: 'baseline_ia_match', label: 'Baseline Units Match', isMatch: true },
      // Revenue
      { key: 'stored_revenue_ia', label: 'Revenue Stored' },
      { key: 'calc_revenue_ia', label: 'Revenue Calc' },
      { key: 'revenue_ia_match', label: 'Revenue Match', isMatch: true },
      // Baseline Revenue
      { key: 'stored_baseline_rev_ia', label: 'Baseline Rev Stored' },
      { key: 'calc_baseline_rev_ia', label: 'Baseline Rev Calc' },
      { key: 'baseline_rev_ia_match', label: 'Baseline Rev Match', isMatch: true },
      // GM$
      { key: 'stored_gm_dollar_ia', label: 'GM$ Stored' },
      { key: 'calc_gm_dollar_ia', label: 'GM$ Calc' },
      { key: 'gm_dollar_ia_match', label: 'GM$ Match', isMatch: true },
      // Baseline GM$
      { key: 'stored_baseline_gm_ia', label: 'Baseline GM$ Stored' },
      { key: 'calc_baseline_gm_ia', label: 'Baseline GM$ Calc' },
      { key: 'baseline_gm_ia_match', label: 'Baseline GM$ Match', isMatch: true },
      // GM%
      { key: 'stored_gm_pct_ia', label: 'GM% Stored' },
      { key: 'calc_gm_pct_ia', label: 'GM% Calc' },
      { key: 'gm_pct_ia_match', label: 'GM% Match', isMatch: true },
      // Baseline GM%
      { key: 'stored_baseline_gm_pct_ia', label: 'Baseline GM% Stored' },
      { key: 'calc_baseline_gm_pct_ia', label: 'Baseline GM% Calc' },
      { key: 'baseline_gm_pct_ia_match', label: 'Baseline GM% Match', isMatch: true },
      // ASP
      { key: 'stored_asp_ia', label: 'ASP Stored' },
      { key: 'calc_asp_ia', label: 'ASP Calc' },
      { key: 'asp_ia_match', label: 'ASP Match', isMatch: true },
      // Baseline ASP
      { key: 'stored_baseline_asp_ia', label: 'Baseline ASP Stored' },
      { key: 'calc_baseline_asp_ia', label: 'Baseline ASP Calc' },
      { key: 'baseline_asp_ia_match', label: 'Baseline ASP Match', isMatch: true },
      // AUM
      { key: 'stored_aum_ia', label: 'AUM Stored' },
      { key: 'calc_aum_ia', label: 'AUM Calc' },
      { key: 'aum_ia_match', label: 'AUM Match', isMatch: true },
      // Baseline AUM
      { key: 'stored_baseline_aum_ia', label: 'Baseline AUM Stored' },
      { key: 'calc_baseline_aum_ia', label: 'Baseline AUM Calc' },
      { key: 'baseline_aum_ia_match', label: 'Baseline AUM Match', isMatch: true },
      // Reco Actuals IA
      { key: 'reco_actuals_sales_ia', label: 'Reco Actuals Sales' },
      { key: 'reco_actuals_revenue_ia', label: 'Reco Actuals Revenue' },
      { key: 'reco_actuals_gm_dollar_ia', label: 'Reco Actuals GM$' },
      { key: 'reco_actuals_gm_pct_ia', label: 'Reco Actuals GM%' },
      { key: 'reco_actuals_asp_ia', label: 'Reco Actuals ASP' },
      { key: 'reco_actuals_aum_ia', label: 'Reco Actuals AUM' },
      { key: 'actuals_sales_ia_match', label: 'Actuals Sales Match', isMatch: true },
      { key: 'actuals_revenue_ia_match', label: 'Actuals Revenue Match', isMatch: true },
      { key: 'actuals_gm_dollar_ia_match', label: 'Actuals GM$ Match', isMatch: true },
      { key: 'actuals_gm_pct_ia_match', label: 'Actuals GM% Match', isMatch: true },
      { key: 'actuals_asp_ia_match', label: 'Actuals ASP Match', isMatch: true },
      { key: 'actuals_aum_ia_match', label: 'Actuals AUM Match', isMatch: true },
    ]},
    { name: 'Finalized', color: '#86efac', columns: [
      // Prices
      { key: 'price_finalized', label: 'Base Price' },
      { key: 'promo_price_finalized', label: 'Promo Price' },
      { key: 'stored_promo_finalized', label: 'Stored Promo %' },
      { key: 'promo_finalized_match', label: 'Promo Match', isMatch: true },
      // Sales
      { key: 'stored_sales_finalized', label: 'Sales Stored' },
      { key: 'calc_sales_finalized', label: 'Sales Calc' },
      { key: 'sales_finalized_match', label: 'Sales Match', isMatch: true },
      // Baseline Units
      { key: 'stored_baseline_finalized', label: 'Baseline Units Stored' },
      { key: 'calc_baseline_finalized', label: 'Baseline Units Calc' },
      { key: 'baseline_finalized_match', label: 'Baseline Units Match', isMatch: true },
      // Revenue
      { key: 'stored_revenue_finalized', label: 'Revenue Stored' },
      { key: 'calc_revenue_finalized', label: 'Revenue Calc' },
      { key: 'revenue_finalized_match', label: 'Revenue Match', isMatch: true },
      // Baseline Revenue
      { key: 'stored_baseline_rev_finalized', label: 'Baseline Rev Stored' },
      { key: 'calc_baseline_rev_finalized', label: 'Baseline Rev Calc' },
      { key: 'baseline_rev_finalized_match', label: 'Baseline Rev Match', isMatch: true },
      // GM$
      { key: 'stored_gm_dollar_finalized', label: 'GM$ Stored' },
      { key: 'calc_gm_dollar_finalized', label: 'GM$ Calc' },
      { key: 'gm_dollar_finalized_match', label: 'GM$ Match', isMatch: true },
      // Baseline GM$
      { key: 'stored_baseline_gm_finalized', label: 'Baseline GM$ Stored' },
      { key: 'calc_baseline_gm_finalized', label: 'Baseline GM$ Calc' },
      { key: 'baseline_gm_finalized_match', label: 'Baseline GM$ Match', isMatch: true },
      // GM%
      { key: 'stored_gm_pct_finalized', label: 'GM% Stored' },
      { key: 'calc_gm_pct_finalized', label: 'GM% Calc' },
      { key: 'gm_pct_finalized_match', label: 'GM% Match', isMatch: true },
      // Baseline GM%
      { key: 'stored_baseline_gm_pct_finalized', label: 'Baseline GM% Stored' },
      { key: 'calc_baseline_gm_pct_finalized', label: 'Baseline GM% Calc' },
      { key: 'baseline_gm_pct_finalized_match', label: 'Baseline GM% Match', isMatch: true },
      // ASP
      { key: 'stored_asp_finalized', label: 'ASP Stored' },
      { key: 'calc_asp_finalized', label: 'ASP Calc' },
      { key: 'asp_finalized_match', label: 'ASP Match', isMatch: true },
      // Baseline ASP
      { key: 'stored_baseline_asp_finalized', label: 'Baseline ASP Stored' },
      { key: 'calc_baseline_asp_finalized', label: 'Baseline ASP Calc' },
      { key: 'baseline_asp_finalized_match', label: 'Baseline ASP Match', isMatch: true },
      // AUM
      { key: 'stored_aum_finalized', label: 'AUM Stored' },
      { key: 'calc_aum_finalized', label: 'AUM Calc' },
      { key: 'aum_finalized_match', label: 'AUM Match', isMatch: true },
      // Baseline AUM
      { key: 'stored_baseline_aum_finalized', label: 'Baseline AUM Stored' },
      { key: 'calc_baseline_aum_finalized', label: 'Baseline AUM Calc' },
      { key: 'baseline_aum_finalized_match', label: 'Baseline AUM Match', isMatch: true },
      // Reco Actuals Finalized
      { key: 'reco_actuals_sales_finalized', label: 'Reco Actuals Sales' },
      { key: 'reco_actuals_revenue_finalized', label: 'Reco Actuals Revenue' },
      { key: 'reco_actuals_gm_dollar_finalized', label: 'Reco Actuals GM$' },
      { key: 'reco_actuals_gm_pct_finalized', label: 'Reco Actuals GM%' },
      { key: 'reco_actuals_asp_finalized', label: 'Reco Actuals ASP' },
      { key: 'reco_actuals_aum_finalized', label: 'Reco Actuals AUM' },
      { key: 'actuals_sales_finalized_match', label: 'Actuals Sales Match', isMatch: true },
      { key: 'actuals_revenue_finalized_match', label: 'Actuals Revenue Match', isMatch: true },
      { key: 'actuals_gm_dollar_finalized_match', label: 'Actuals GM$ Match', isMatch: true },
      { key: 'actuals_gm_pct_finalized_match', label: 'Actuals GM% Match', isMatch: true },
      { key: 'actuals_asp_finalized_match', label: 'Actuals ASP Match', isMatch: true },
      { key: 'actuals_aum_finalized_match', label: 'Actuals AUM Match', isMatch: true },
    ]},
    { name: 'Parameters', color: '#cbd5e1', columns: [
      // Strategy Info
      { key: 'actuals_cutoff_date', label: 'Actuals Cutoff' },
      { key: 'actual_days', label: 'Actual Days' },
      { key: 'strategy_start', label: 'Strategy Start' },
      { key: 'strategy_end', label: 'Strategy End' },
      { key: 'forecast_predicted', label: 'Forecast Predicted' },
      // Cost & Counts
      { key: 'cost', label: 'Cost' },
      { key: 'store_count', label: 'Stores' },
      { key: 'week_count', label: 'Weeks' },
      { key: 'granular_row_count', label: 'Rows' },
      { key: 'min_cost', label: 'Min Cost' },
      { key: 'price_point', label: 'Price Point' },
      // Elasticity & Base
      { key: 'base_percentage', label: 'Base %' },
      { key: 'elasticity', label: 'Elasticity' },
      { key: 'promo_elasticity', label: 'Promo Elast' },
      // Promo
      { key: 'promo_pct', label: 'Weighted Promo %' },
      { key: 'promo_source', label: 'Promo Source', format: (v) => Number(v) === 1 ? 'LY Promo' : 'CY Promo' },
      { key: 'effective_ref_price', label: 'Eff Ref Price' },
      { key: 'calc_promo_pct_display', label: 'Promo %' },
      // Markup
      { key: 'markup_current', label: 'Markup Curr' },
      { key: 'markup_ia', label: 'Markup IA' },
      { key: 'markup_fin', label: 'Markup Final' },
      // Flags
      { key: 'price_lock', label: 'Price Lock', isBool: true },
      { key: 'zone_exception', label: 'Zone Exception', isBool: true },
    ]},
  ];
  
  const allColumns = columnGroups.flatMap(g => g.columns);
  
  // Sort handler - cycles through: asc -> desc -> none
  const handleSort = (key) => {
    setSortConfig(prev => {
      if (prev.key !== key) {
        return { key, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { key, direction: 'desc' };
      }
      if (prev.direction === 'desc') {
        return { key: null, direction: null };
      }
      return { key, direction: 'asc' };
    });
  };
  
  // Toggle column visibility
  const toggleColumn = (key) => {
    setHiddenColumns(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };
  
  // Get unique values for a column
  const getUniqueValues = (key) => {
    if (!validationResult?.results) return [];
    const values = validationResult.results.map(row => {
      const val = row[key];
      if (typeof val === 'boolean') return val ? 'Yes' : 'No';
      return String(val ?? '');
    });
    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
  };
  
  // Toggle a single value in column filter
  const toggleFilterValue = (colKey, value) => {
    setColumnFilters(prev => {
      const currentSet = prev[colKey] || new Set();
      const newSet = new Set(currentSet);
      if (newSet.has(value)) {
        newSet.delete(value);
      } else {
        newSet.add(value);
      }
      return { ...prev, [colKey]: newSet.size > 0 ? newSet : null };
    });
  };
  
  // Select all values for a column
  const selectAllValues = (colKey) => {
    const allValues = getUniqueValues(colKey);
    setColumnFilters(prev => ({
      ...prev,
      [colKey]: new Set(allValues)
    }));
  };
  
  // Clear filter for a column (select none = show all)
  const clearColumnFilter = (colKey) => {
    setColumnFilters(prev => {
      const newFilters = { ...prev };
      delete newFilters[colKey];
      return newFilters;
    });
  };
  
  // Check if all values are selected
  const areAllSelected = (colKey) => {
    const filter = columnFilters[colKey];
    if (!filter) return true; // No filter = all shown
    const allValues = getUniqueValues(colKey);
    return filter.size === allValues.length;
  };
  
  // Clear all filters
  const clearAllFilters = () => {
    setColumnFilters({});
    setTextSearchFilters({});
  };
  
  // Check if any filters are active
  const hasActiveFilters = Object.keys(columnFilters).some(k => columnFilters[k] && columnFilters[k].size > 0) ||
    Object.keys(textSearchFilters).some(k => textSearchFilters[k] && textSearchFilters[k].trim());
  
  // Filter and sort data
  const getFilteredSortedData = () => {
    if (!validationResult?.results) return [];
    
    let data = [...validationResult.results];
    
    // Filter by column filters (set-based checkbox selection)
    Object.entries(columnFilters).forEach(([key, selectedValues]) => {
      if (selectedValues && selectedValues.size > 0) {
        data = data.filter(row => {
          let cellValue = row[key];
          // Handle boolean columns
          if (typeof cellValue === 'boolean') {
            cellValue = cellValue ? 'Yes' : 'No';
          } else {
            cellValue = String(cellValue ?? '');
          }
          return selectedValues.has(cellValue);
        });
      }
    });
    
    // Filter by text search filters (contains search)
    Object.entries(textSearchFilters).forEach(([key, searchText]) => {
      if (searchText && searchText.trim()) {
        const term = searchText.toLowerCase().trim();
        data = data.filter(row => {
          let cellValue = row[key];
          if (typeof cellValue === 'boolean') {
            cellValue = cellValue ? 'yes' : 'no';
          } else {
            cellValue = String(cellValue ?? '').toLowerCase();
          }
          return cellValue.includes(term);
        });
      }
    });
    
    // Sort
    if (sortConfig.key) {
      data.sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];
        
        // Handle nulls
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        
        // Numeric comparison
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        
        // String comparison
        const comparison = String(aVal).localeCompare(String(bVal));
        return sortConfig.direction === 'asc' ? comparison : -comparison;
      });
    }
    
    return data;
  };
  
  const handleRunValidation = async () => {
    if (!strategyId.trim()) {
      setValidationError('Please enter a strategy ID');
      return;
    }
    
    setIsValidating(true);
    setValidationError(null);
    setValidationResult(null);
    
    try {
      const response = await api.runValidation(parseInt(strategyId));
      const result = response.data;
      
      // Check if strategy was found
      if (!result.success && result.error) {
        setValidationError(result.error);
        return;
      }
      
      setValidationResult(result);
      console.log('=== VALIDATION RESULT ===');
      console.log('Strategy ID:', result.strategy_id);
      console.log('Summary:', result.summary);
      console.log('Results:', result.results);
    } catch (err) {
      const errorMsg = err.response?.data?.detail || err.message || 'Validation failed';
      setValidationError(errorMsg);
      console.error('Validation Error:', errorMsg);
    } finally {
      setIsValidating(false);
    }
  };
  
  const handleBackToWorkbench = () => {
    setActiveWorkbenchTab(null);
    setValidationResult(null);
    setValidationError(null);
    setStrategyId('');
    setValidationQuery('');
    setShowValidationQuery(false);
  };

  // Fetch the generated SQL for the current strategy (Reco Table Metrics validator).
  const handleViewValidationQuery = async () => {
    if (!strategyId.trim()) {
      setValidationError('Please enter a strategy ID');
      return;
    }
    if (isLoadingQuery) return;  // already in flight — ignore spam clicks
    setValidationError(null);
    setIsLoadingQuery(true);
    try {
      const response = await api.getValidationQuery(parseInt(strategyId));
      setValidationQuery(response.data.query || '');
      setShowValidationQuery(true);
    } catch (err) {
      setValidationError(err.response?.data?.detail || err.message || 'Failed to fetch query');
    } finally {
      setIsLoadingQuery(false);
    }
  };

  // Shared helper: run a validation by passing the api method (DRY for the three monthly screens)
  const runValidatorWith = async (apiCall) => {
    if (!strategyId.trim()) {
      setValidationError('Please enter a strategy ID');
      return;
    }
    setIsValidating(true);
    setValidationError(null);
    setValidationResult(null);
    try {
      const response = await apiCall(parseInt(strategyId));
      const result = response.data;
      if (!result.success && result.error) {
        setValidationError(result.error);
        return;
      }
      setValidationResult(result);
    } catch (err) {
      const errorMsg = err.response?.data?.detail || err.message || 'Validation failed';
      setValidationError(errorMsg);
      console.error('Validation Error:', errorMsg);
    } finally {
      setIsValidating(false);
    }
  };

  const handleRunMonthlyForecastValidation = () => runValidatorWith(api.runMonthlyForecastValidation);
  const handleRunMonthlyActualsValidation  = () => runValidatorWith(api.runMonthlyActualsValidation);

  // Show Query handlers for the Monthly Forecast / Monthly Actuals screens.
  // They reuse the shared validationQuery / showValidationQuery state with Reco
  // Table Metrics — the three screens are mutually exclusive (only one active
  // at a time), so a single pair of state fields is enough.
  const fetchQueryWith = async (apiCall) => {
    if (!strategyId.trim()) {
      setValidationError('Please enter a strategy ID');
      return;
    }
    if (isLoadingQuery) return;
    setValidationError(null);
    setIsLoadingQuery(true);
    try {
      const response = await apiCall(parseInt(strategyId));
      setValidationQuery(response.data.query || '');
      setShowValidationQuery(true);
    } catch (err) {
      setValidationError(err.response?.data?.detail || err.message || 'Failed to fetch query');
    } finally {
      setIsLoadingQuery(false);
    }
  };
  const handleViewMonthlyForecastQuery = () => fetchQueryWith(api.getMonthlyForecastQuery);
  const handleViewMonthlyActualsQuery  = () => fetchQueryWith(api.getMonthlyActualsQuery);
  
  // Render content based on active route
  const renderContent = () => {
    switch (activeRoute) {
      case 'decision-dashboard':
        return (
          <div>
            <h2 style={{ margin: '0 0 8px 0', color: '#1a1a2e', fontSize: '20px' }}>Decision Dashboard</h2>
            <p style={{ margin: '0 0 24px 0', color: '#64748b', fontSize: '14px' }}>
              {scope?.connection?.instanceName || `${scope?.client || 'Client'}/${scope?.env || 'Environment'}`}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
              <StatCard title="Active Strategies" value="12" color="#0284c7" bgColor="#e0f2fe" />
              <StatCard title="Pending Reviews" value="5" color="#d97706" bgColor="#fef3c7" />
              <StatCard title="Completed" value="47" color="#16a34a" bgColor="#dcfce7" />
            </div>
          </div>
        );
      case 'workbench':
        return renderWorkbench();
      case 'rules':
        const validateDefaultRules = async () => {
          setIsValidatingRules(true);
          setRulesValidationError(null);
          try {
            const response = await api.validateDefaultRules();
            setRulesValidationResult(response.data);
          } catch (err) {
            setRulesValidationError(err.response?.data?.detail || err.message || 'Failed to validate rules');
            setRulesValidationResult(null);
          } finally {
            setIsValidatingRules(false);
          }
        };
        
        // Colorful rule icons matching reference design
        const ruleIcons = {
          1: (
            <div style={{ 
              width: '44px', height: '44px', 
              background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
              borderRadius: '10px',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5z" fill="#f59e0b"/>
                <path d="M2 17l10 5 10-5" stroke="#d97706" strokeWidth="2" fill="none"/>
                <path d="M2 12l10 5 10-5" stroke="#d97706" strokeWidth="2" fill="none"/>
              </svg>
            </div>
          ),
          2: (
            <div style={{ 
              width: '44px', height: '44px', 
              background: 'linear-gradient(135deg, #dbeafe 0%, #93c5fd 100%)',
              borderRadius: '10px',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="8" fill="#3b82f6"/>
                <circle cx="12" cy="12" r="4" fill="white"/>
                <circle cx="12" cy="12" r="2" fill="#3b82f6"/>
              </svg>
            </div>
          ),
          3: (
            <div style={{ 
              width: '44px', height: '44px', 
              background: 'linear-gradient(135deg, #dcfce7 0%, #86efac 100%)',
              borderRadius: '10px',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="#22c55e"/>
                <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          )
        };
        
        const RuleCard = ({ rule }) => {
          const allMatch = rule.all_match;
          const [expanded, setExpanded] = useState(false);
          
          return (
            <div style={{ 
              background: '#f8fafc', 
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              overflow: 'hidden',
              transition: 'all 0.2s ease'
            }}>
              {/* Card Header - Simple style like reference */}
              <div 
                onClick={() => setExpanded(!expanded)}
                style={{ 
                  padding: '20px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '14px'
                }}
              >
                <div style={{ flexShrink: 0 }}>
                  {ruleIcons[rule.rule_id]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px',
                    marginBottom: '6px'
                  }}>
                    <span style={{ 
                      fontSize: '15px', 
                      fontWeight: '600', 
                      color: '#1e293b'
                    }}>
                      {rule.name}
                    </span>
                    <span style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      background: allMatch ? '#dcfce7' : '#fef2f2',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: '700',
                      color: allMatch ? '#16a34a' : '#dc2626'
                    }}>
                      {allMatch ? '✓' : '!'}
                    </span>
                  </div>
                  <div style={{ 
                    fontSize: '13px', 
                    color: '#64748b',
                    lineHeight: '1.4'
                  }}>
                    {rule.description}
                  </div>
                </div>
                <svg 
                  width="16" height="16" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="#94a3b8" 
                  strokeWidth="2"
                  style={{ 
                    transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
                    transition: 'transform 0.2s ease',
                    flexShrink: 0,
                    marginTop: '4px'
                  }}
                >
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </div>
              
              {/* Expandable Details */}
              {expanded && (
                <div style={{ 
                  borderTop: '1px solid #e2e8f0',
                  background: 'white',
                  padding: '16px 20px'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {[
                      { label: 'Products', data: rule.products },
                      { label: 'Stores', data: rule.stores },
                      { label: 'Segments', data: rule.segments }
                    ].map(item => (
                      <div key={item.label} style={{ 
                        display: 'flex', 
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        background: item.data.match ? '#f0fdf4' : '#fef2f2',
                        borderRadius: '8px',
                        border: `1px solid ${item.data.match ? '#bbf7d0' : '#fecaca'}`
                      }}>
                        <span style={{ 
                          fontSize: '13px', 
                          fontWeight: '500', 
                          color: '#475569'
                        }}>
                          {item.label}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap' }}>
                            <strong style={{ color: '#1e293b' }}>{item.data.mapped.toLocaleString()}</strong>
                            {' / '}
                            {item.data.expected.toLocaleString()}
                          </span>
                          <span style={{
                            fontSize: '11px',
                            fontWeight: '600',
                            color: item.data.match ? '#16a34a' : '#dc2626',
                            background: item.data.match ? '#dcfce7' : '#fee2e2',
                            padding: '2px 8px',
                            borderRadius: '4px'
                          }}>
                            {item.data.match ? 'MATCH' : 'MISMATCH'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        };
        
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div>
                <h2 style={{ margin: '0 0 8px 0', color: '#1a1a2e', fontSize: '20px' }}>Default Rules Validation</h2>
                <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
                  Verify all usable products, active stores, and segments are mapped to default rules
                </p>
              </div>
              <button
                onClick={validateDefaultRules}
                disabled={isValidatingRules}
                style={{
                  padding: '10px 20px',
                  background: isValidatingRules ? '#94a3b8' : '#264CD7',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: isValidatingRules ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                {isValidatingRules ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                      <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"/>
                    </svg>
                    Validating...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 11l3 3L22 4"/>
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                    </svg>
                    Validate Rules
                  </>
                )}
              </button>
            </div>
            
            {rulesValidationError && (
              <div style={{ 
                background: '#fef2f2', 
                border: '1px solid #fecaca', 
                borderRadius: '8px', 
                padding: '16px',
                marginBottom: '20px',
                color: '#991b1b'
              }}>
                <strong>Error:</strong> {rulesValidationError}
              </div>
            )}
            
            {!rulesValidationResult && !isValidatingRules && !rulesValidationError && (
              <div style={{ 
                background: '#f8fafc', 
                borderRadius: '12px', 
                padding: '40px',
                textAlign: 'center',
                color: '#64748b'
              }}>
                <RulesIcon />
                <p style={{ marginTop: '16px', fontSize: '14px' }}>
                  Click "Validate Rules" to check if default rules have all products, stores, and segments mapped
                </p>
              </div>
            )}
            
            {rulesValidationResult && (
              <>
                {/* Summary Header */}
                <div style={{ 
                  background: 'white', 
                  borderRadius: '12px', 
                  padding: '16px 24px',
                  marginBottom: '20px',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ display: 'flex', gap: '40px' }}>
                    <div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Usable Products</div>
                      <div style={{ fontSize: '22px', fontWeight: '700', color: '#264CD7' }}>
                        {rulesValidationResult.master_counts.products.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Active Stores</div>
                      <div style={{ fontSize: '22px', fontWeight: '700', color: '#264CD7' }}>
                        {rulesValidationResult.master_counts.stores.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Active Segments</div>
                      <div style={{ fontSize: '22px', fontWeight: '700', color: '#264CD7' }}>
                        {rulesValidationResult.master_counts.segments.toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div style={{ 
                    padding: '10px 20px', 
                    background: rulesValidationResult.all_valid ? '#dcfce7' : '#fef2f2', 
                    borderRadius: '8px',
                    border: `1px solid ${rulesValidationResult.all_valid ? '#86efac' : '#fecaca'}`
                  }}>
                    <span style={{ 
                      fontSize: '15px', 
                      fontWeight: '600', 
                      color: rulesValidationResult.all_valid ? '#16a34a' : '#dc2626' 
                    }}>
                      {rulesValidationResult.all_valid ? '✓ All Rules Valid' : '✗ Validation Issues'}
                    </span>
                  </div>
                </div>
                
                {/* Rule Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                  {rulesValidationResult.rules.map(rule => (
                    <RuleCard key={rule.rule_id} rule={rule} />
                  ))}
                </div>
              </>
            )}
          </div>
        );
      case 'exception-report':
        return (
          <div>
            <h2 style={{ margin: '0 0 8px 0', color: '#1a1a2e', fontSize: '20px' }}>Exception Report</h2>
            <p style={{ margin: '0 0 24px 0', color: '#64748b', fontSize: '14px' }}>View data exceptions</p>
            <PlaceholderCard 
              icon={<DocumentIcon />} 
              title="Exception Report" 
              description="View and manage data exceptions and anomalies. Coming soon." 
            />
          </div>
        );
      case 'competitor-positioning':
        return (
          <div>
            <h2 style={{ margin: '0 0 8px 0', color: '#1a1a2e', fontSize: '20px' }}>Competitor Positioning</h2>
            <p style={{ margin: '0 0 24px 0', color: '#64748b', fontSize: '14px' }}>Analyze competitive data</p>
            <PlaceholderCard 
              icon={<ChartIcon />} 
              title="Competitor Positioning" 
              description="Analyze competitive positioning data. Coming soon." 
            />
          </div>
        );
      default:
        return (
          <div>
            <h2 style={{ margin: '0 0 8px 0', color: '#1a1a2e', fontSize: '20px' }}>Decision Dashboard</h2>
            <p style={{ margin: '0 0 24px 0', color: '#64748b', fontSize: '14px' }}>
              {scope?.connection?.instanceName || 'Select a connection'}
            </p>
          </div>
        );
    }
  };

  const renderWorkbench = () => {
    // If a validator is selected, show its dedicated screen
    if (activeWorkbenchTab === 'sales-units') {
      return renderSalesUnitsValidator();
    }

    if (activeWorkbenchTab === 'metrics-validator') {
      return renderMetricsValidator();
    }

    if (activeWorkbenchTab === 'summary-cards') {
      return renderSummaryCardsValidator();
    }

    if (activeWorkbenchTab === 'monthly-forecast') {
      return renderMonthlyForecastValidator();
    }

    if (activeWorkbenchTab === 'monthly-actuals') {
      return renderMonthlyActualsValidator();
    }

    if (activeWorkbenchTab === 'monthly-summary-cards') {
      return renderMonthlySummaryCardsValidator();
    }

    if (activeWorkbenchTab === 'reco-grid-data') {
      return renderRecoGridDataValidator();
    }

    // Otherwise show the workbench list
    const workbenchItems = [
      { 
        id: 'sales-units', 
        name: 'Reco Table Metrics Validator',
        tooltip: 'Validate all reco-table metrics (Sales, Revenue, GM$, GM%, ASP, AUM) against recomputed values',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4"/>
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
        )
      },
      {
        id: 'summary-cards',
        name: 'Summary Cards Validator',
        tooltip: 'Validate summary card metrics (Total, Actuals, Forecast) across Current, IA, Finalized',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
        )
      },
      {
        id: 'monthly-forecast',
        name: 'Monthly Forecast Validator',
        tooltip: 'Validate bp_monthly_forecast — elasticity-based recompute vs stored, per (bin × month) with 5-state match',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
            <polyline points="9 16 11 18 15 14"/>
          </svg>
        )
      },
      {
        id: 'monthly-actuals',
        name: 'Monthly Forecast Actuals Validator',
        tooltip: 'Validate bp_monthly_forecast_actuals — recompute from transaction tables vs stored, per (bin × month)',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
            <path d="M9 14h6M9 18h4"/>
          </svg>
        )
      },
      {
        id: 'monthly-summary-cards',
        name: 'Monthly Summary Cards Validator',
        tooltip: 'Summary cards (Sales, Rev, GM$, GM%, ASP, AUM) for Fiscal Year / Quarters / 12 Months — pulled from bp_monthly_forecast + bp_monthly_forecast_actuals',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/>
            <line x1="6.5" y1="6.5" x2="6.5" y2="6.5"/>
            <line x1="17.5" y1="17.5" x2="17.5" y2="17.5"/>
          </svg>
        )
      },
      {
        id: 'reco-grid-data',
        name: 'Reco Grid Data Validator',
        tooltip: 'Our reco rollup vs bp_strategy_price_reco_grid_data_{product,line_group}_pricezone — per-metric MATCH/MISMATCH including baselines and actuals',
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="3" y1="15" x2="21" y2="15"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
            <line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
        )
      },
      {
        id: 'metrics-validator',
        name: 'Metrics Validator', 
        tooltip: 'Validate strategy metrics across various view bys',
        disabled: true,
        icon: (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 20V10"/>
            <path d="M12 20V4"/>
            <path d="M6 20v-6"/>
          </svg>
        )
      }
    ];

    return (
      <div>
        <h2 style={{ margin: '0 0 24px 0', color: '#1a1a2e', fontSize: '20px' }}>Workbench</h2>
        
        {/* Workbench Items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {workbenchItems.map(item => (
            <div
              key={item.id}
              onClick={() => !item.disabled && setActiveWorkbenchTab(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                padding: '16px 20px',
                background: 'white',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                cursor: item.disabled ? 'not-allowed' : 'pointer',
                opacity: item.disabled ? 0.5 : 1,
                transition: 'all 0.15s',
                boxShadow: '0 2px 4px rgba(0,0,0,0.04)'
              }}
              onMouseEnter={(e) => !item.disabled && (e.currentTarget.style.borderColor = '#264CD7')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#e2e8f0')}
            >
              <div style={{ 
                width: '40px', 
                height: '40px', 
                background: '#f1f5f9',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748b'
              }}>
                {item.icon}
              </div>
              <span style={{ 
                flex: 1, 
                fontWeight: '500', 
                color: '#1a1a2e',
                fontSize: '15px'
              }}>
                {item.name}
              </span>
              <InfoIcon tooltip={item.tooltip} />
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderMetricsValidator = () => {
    return (
      <div>
        {/* Header with Back button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <button
            onClick={handleBackToWorkbench}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              background: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              color: '#64748b'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back
          </button>
          <div>
            <h2 style={{ margin: 0, color: '#1a1a2e', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              Metrics Validator
              <InfoIcon tooltip="Validate strategy metrics across various view bys" />
            </h2>
          </div>
        </div>

        {/* Placeholder content */}
        <div style={{ 
          background: 'white', 
          borderRadius: '12px', 
          padding: '40px',
          textAlign: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
          <h3 style={{ margin: '0 0 8px', color: '#1a1a2e' }}>Metrics Validator</h3>
          <p style={{ margin: 0, color: '#64748b' }}>Calculation logic coming soon...</p>
        </div>
      </div>
    );
  };

  const renderSummaryCardsValidator = () => {
    const handleLoadChannels = async (strategyId) => {
      if (!strategyId.trim()) return;
      
      setIsLoadingChannels(true);
      try {
        const response = await api.getSummaryCardsChannels(parseInt(strategyId));
        if (response.data.success) {
          const channels = response.data.channels || [];
          setSummaryCardsChannels(channels);
          // Select all channels by default
          setSelectedChannels(channels.map(c => c.id));
        }
      } catch (err) {
        console.error('Failed to load channels:', err);
        setSummaryCardsChannels([]);
        setSelectedChannels([]);
      } finally {
        setIsLoadingChannels(false);
      }
    };

    const handleValidateSummaryCards = async () => {
      if (!summaryCardsStrategyId.trim()) {
        setSummaryCardsError('Please enter a strategy ID');
        return;
      }
      
      if (selectedChannels.length === 0) {
        setSummaryCardsError('Please select at least one channel');
        return;
      }
      
      setIsValidatingSummaryCards(true);
      setSummaryCardsError(null);
      setSummaryCardsResult(null);
      
      try {
        const channelIds = selectedChannels.join(',');
        const response = await api.validateSummaryCards(parseInt(summaryCardsStrategyId), channelIds);
        if (response.data.success) {
          setSummaryCardsResult(response.data.data);
        } else {
          setSummaryCardsError(response.data.error || 'Validation failed');
        }
      } catch (err) {
        setSummaryCardsError(err.response?.data?.detail || err.message || 'Validation failed');
      } finally {
        setIsValidatingSummaryCards(false);
      }
    };

    const handleShowQuery = async () => {
      if (!summaryCardsStrategyId.trim()) {
        setSummaryCardsError('Please enter a strategy ID');
        return;
      }
      if (isLoadingQuery) return;
      setIsLoadingQuery(true);
      try {
        const channelIds = selectedChannels.length > 0 ? selectedChannels.join(',') : null;
        const response = await api.getSummaryCardsQuery(parseInt(summaryCardsStrategyId), channelIds);
        if (response.data.success) {
          setSummaryCardsQuery(response.data.query);
          setShowSummaryCardsQuery(true);
        }
      } catch (err) {
        setSummaryCardsError(err.response?.data?.detail || err.message || 'Failed to get query');
      } finally {
        setIsLoadingQuery(false);
      }
    };

    const handleStrategyIdChange = (e) => {
      const newId = e.target.value;
      setSummaryCardsStrategyId(newId);
      setSummaryCardsResult(null);
      setSummaryCardsChannels([]);
      setSelectedChannels([]);
    };

    const handleStrategyIdBlur = () => {
      if (summaryCardsStrategyId.trim()) {
        handleLoadChannels(summaryCardsStrategyId);
      }
    };

    const toggleChannel = (channelId) => {
      // Allow deselecting all — Validate button gates on selectedChannels.length === 0.
      setSelectedChannels(prev =>
        prev.includes(channelId) ? prev.filter(id => id !== channelId) : [...prev, channelId]
      );
    };

    const toggleAllChannels = () => {
      const allSelected = selectedChannels.length === summaryCardsChannels.length;
      setSelectedChannels(allSelected ? [] : summaryCardsChannels.map(c => c.id));
    };

    const formatNumber = (val, decimals = 2, useK = false) => {
      if (val === null || val === undefined) return '-';
      const num = Number(val);
      if (isNaN(num)) return '-';
      
      // Format with K suffix for thousands
      if (useK && Math.abs(num) >= 1000) {
        const kVal = num / 1000;
        return kVal.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'K';
      }
      
      return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    };

    const formatDelta = (val, decimals = 2, isPercentage = false, isDollar = false) => {
      if (val === null || val === undefined) return '-';
      const num = Number(val);
      if (isNaN(num)) return '-';
      if (num === 0) return '-';
      
      const formatted = Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      const isPositive = num > 0;
      const isNegative = num < 0;
      const bgColor = isPositive ? '#dcfce7' : isNegative ? '#fee2e2' : 'transparent';
      const textColor = isPositive ? '#16a34a' : isNegative ? '#dc2626' : '#64748b';
      const arrow = isPositive ? '↑' : isNegative ? '↓' : '';
      const prefix = isDollar ? '$' : '';
      const suffix = isPercentage ? '%' : '';
      
      return (
        <span style={{ 
          color: textColor, 
          fontWeight: '500',
          background: bgColor,
          padding: '2px 8px',
          borderRadius: '12px',
          fontSize: '12px',
          whiteSpace: 'nowrap'
        }}>
          {arrow} {prefix}{formatted}{suffix}
        </span>
      );
    };

    const metrics = [
      { key: 'sales_units', label: 'Sales units', decimals: 1, prefix: '', isDollar: false, useK: false },
      { key: 'revenue', label: 'Revenue $', decimals: 2, prefix: '$', isDollar: true, useK: true },
      { key: 'gross_margin_dollar', label: 'Gross margin $', decimals: 2, prefix: '$', isDollar: true, useK: true },
      { key: 'gm_percentage', label: 'Gross margin %', decimals: 2, prefix: '', suffix: '%', isPercentage: true, useK: false },
      { key: 'asp', label: 'ASP $', decimals: 2, prefix: '$', isDollar: true, useK: false },
      { key: 'aum', label: 'AUM $', decimals: 2, prefix: '$', isDollar: true, useK: false },
    ];

    const cellStyle = { 
      padding: '10px 12px', 
      textAlign: 'right', 
      borderBottom: '1px solid #e5e7eb',
      fontSize: '13px',
      color: '#1a1a2e'
    };

    const headerCellStyle = {
      padding: '10px 12px',
      textAlign: 'center',
      fontWeight: '600',
      fontSize: '12px',
      borderBottom: '1px solid #e5e7eb',
      background: '#f9fafb',
      color: '#475569'
    };

    return (
      <div>
        {/* Header with Back button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <button
            onClick={handleBackToWorkbench}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              background: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              color: '#64748b'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back
          </button>
          <div>
            <h2 style={{ margin: 0, color: '#1a1a2e', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              Summary Cards Validator
              <InfoIcon tooltip="Validate summary card metrics (Total, Actuals, Forecast) across Current, IA Recommended, Finalized" />
            </h2>
          </div>
        </div>

        {/* Strategy Input */}
        <div style={{ 
          background: 'white', 
          borderRadius: '12px', 
          padding: '20px',
          marginBottom: '20px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, maxWidth: '200px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '6px' }}>
                Strategy ID
              </label>
              <input
                type="text"
                value={summaryCardsStrategyId}
                onChange={handleStrategyIdChange}
                onBlur={handleStrategyIdBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleLoadChannels(summaryCardsStrategyId);
                  }
                }}
                placeholder="Enter strategy ID"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>
            <button
              onClick={handleValidateSummaryCards}
              disabled={isValidatingSummaryCards || selectedChannels.length === 0}
              style={{
                padding: '10px 20px',
                background: (isValidatingSummaryCards || selectedChannels.length === 0) ? '#94a3b8' : '#264CD7',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: (isValidatingSummaryCards || selectedChannels.length === 0) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              {isValidatingSummaryCards ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"/>
                  </svg>
                  Validating...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 11l3 3L22 4"/>
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                  </svg>
                  Validate
                </>
              )}
            </button>
            <button
              onClick={handleShowQuery}
              disabled={!summaryCardsStrategyId.trim() || isLoadingQuery || showSummaryCardsQuery}
              style={{
                padding: '10px 20px',
                background: (!summaryCardsStrategyId.trim() || isLoadingQuery || showSummaryCardsQuery) ? '#94a3b8' : '#64748b',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: (!summaryCardsStrategyId.trim() || isLoadingQuery || showSummaryCardsQuery) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              {isLoadingQuery ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"/>
                  </svg>
                  Loading…
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                  </svg>
                  Show Query
                </>
              )}
            </button>
          </div>
        </div>

        {/* Channel Dropdown */}
        {summaryCardsChannels.length > 0 && (
          <div style={{ 
            background: 'white', 
            borderRadius: '12px', 
            padding: '16px 20px',
            marginBottom: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <label style={{ fontSize: '13px', fontWeight: '500', color: '#475569' }}>
                Channels:
              </label>
              <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                <button
                  onClick={() => setShowChannelDropdown(!showChannelDropdown)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    background: 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '13px',
                    color: '#1a1a2e'
                  }}
                >
                  <span>
                    {selectedChannels.length === summaryCardsChannels.length 
                      ? 'All channels selected' 
                      : `${selectedChannels.length} of ${summaryCardsChannels.length} selected`}
                  </span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                
                {showChannelDropdown && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: '4px',
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    zIndex: 100,
                    maxHeight: '250px',
                    overflow: 'auto'
                  }}>
                    <div style={{ 
                      padding: '8px 12px', 
                      borderBottom: '1px solid #e5e7eb',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <button
                        onClick={toggleAllChannels}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#264CD7',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: '500'
                        }}
                      >
                        {selectedChannels.length === summaryCardsChannels.length ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    {summaryCardsChannels.map(channel => (
                      <label
                        key={channel.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '10px 12px',
                          cursor: 'pointer',
                          borderBottom: '1px solid #f3f4f6'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedChannels.includes(channel.id)}
                          onChange={() => toggleChannel(channel.id)}
                          style={{ accentColor: '#264CD7' }}
                        />
                        <span style={{ fontSize: '13px', color: '#1a1a2e' }}>{channel.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Generated SQL — inline dark panel, sits after the channel dropdown */}
        {showSummaryCardsQuery && summaryCardsQuery && (
          <div style={{ background: '#0f172a', borderRadius: '12px', padding: '16px 20px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 600 }}>Generated SQL</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => { navigator.clipboard?.writeText(summaryCardsQuery); }}
                  style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
                >
                  Copy
                </button>
                <button
                  onClick={() => setShowSummaryCardsQuery(false)}
                  style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
                >
                  Hide
                </button>
              </div>
            </div>
            <pre style={{ margin: 0, color: '#cbd5e1', fontSize: '11px', overflow: 'auto', maxHeight: '400px', fontFamily: 'ui-monospace, monospace' }}>{summaryCardsQuery}</pre>
          </div>
        )}

        {/* Error */}
        {summaryCardsError && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px', 
            padding: '16px',
            marginBottom: '20px',
            color: '#991b1b',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            {summaryCardsError}
          </div>
        )}

        {/* Results Table */}
        {summaryCardsResult && (
          <div style={{ 
            background: 'white', 
            borderRadius: '12px', 
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            border: '1px solid #e5e7eb'
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
              <h3 style={{ margin: 0, color: '#1a1a2e', fontSize: '16px', fontWeight: '600' }}>
                Simulation results
              </h3>
            </div>
            
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1200px' }}>
                <thead>
                  {/* Top header row - section names with pill buttons */}
                  <tr>
                    <th style={{ ...headerCellStyle, textAlign: 'left', width: '140px', background: 'white', borderBottom: 'none' }}></th>
                    <th colSpan="3" style={{ ...headerCellStyle, background: 'white', borderBottom: 'none', borderLeft: '1px solid #e5e7eb' }}>
                      <span style={{ 
                        display: 'inline-block',
                        background: '#dbeafe', 
                        color: '#1e40af', 
                        padding: '6px 16px', 
                        borderRadius: '20px',
                        fontSize: '13px',
                        fontWeight: '500'
                      }}>Current</span>
                    </th>
                    <th colSpan="4" style={{ ...headerCellStyle, background: 'white', borderBottom: 'none', borderLeft: '1px solid #e5e7eb' }}>
                      <span style={{ 
                        display: 'inline-block',
                        background: '#ede9fe', 
                        color: '#5b21b6', 
                        padding: '6px 16px', 
                        borderRadius: '20px',
                        fontSize: '13px',
                        fontWeight: '500'
                      }}>IA Recommended</span>
                      <span style={{ 
                        display: 'inline-block',
                        color: '#94a3b8', 
                        padding: '6px 12px', 
                        fontSize: '13px',
                        fontWeight: '400'
                      }}>Vs Current</span>
                    </th>
                    <th colSpan="4" style={{ ...headerCellStyle, background: 'white', borderBottom: 'none', borderLeft: '1px solid #e5e7eb' }}>
                      <span style={{ 
                        display: 'inline-block',
                        background: '#f1f5f9', 
                        color: '#475569', 
                        padding: '6px 16px', 
                        borderRadius: '20px',
                        fontSize: '13px',
                        fontWeight: '500'
                      }}>Finalized</span>
                      <span style={{ 
                        display: 'inline-block',
                        color: '#94a3b8', 
                        padding: '6px 12px', 
                        fontSize: '13px',
                        fontWeight: '400'
                      }}>Vs Current</span>
                    </th>
                  </tr>
                  {/* Sub header row */}
                  <tr>
                    <th style={{ ...headerCellStyle, textAlign: 'left', background: 'white', color: '#64748b', fontWeight: '500' }}>KPIs</th>
                    {/* Current */}
                    <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400', borderLeft: '1px solid #e5e7eb' }}>Actuals</th>
                    <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400' }}>Forecast</th>
                    <th style={{ ...headerCellStyle, background: 'white', color: '#374151', fontWeight: '600' }}>Total</th>
                    {/* IA Recommended */}
                    <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400', borderLeft: '1px solid #e5e7eb' }}>Actuals</th>
                    <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400' }}>Forecast</th>
                    <th style={{ ...headerCellStyle, background: 'white', color: '#374151', fontWeight: '600' }}>Total</th>
                    <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400' }}></th>
                    {/* Finalized */}
                    <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400', borderLeft: '1px solid #e5e7eb' }}>Actuals</th>
                    <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400' }}>Forecast</th>
                    <th style={{ ...headerCellStyle, background: 'white', color: '#374151', fontWeight: '600' }}>Total</th>
                    <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((metric, idx) => (
                    <tr key={metric.key} style={{ background: 'white' }}>
                      <td style={{ ...cellStyle, textAlign: 'left', fontWeight: '400', color: '#475569' }}>
                        {metric.label}
                      </td>
                      {/* Current */}
                      <td style={{ ...cellStyle, color: '#64748b', borderLeft: '1px solid #e5e7eb' }}>
                        {metric.prefix}{formatNumber(summaryCardsResult.current?.[metric.key]?.actuals, metric.decimals, metric.useK)}{metric.suffix || ''}
                      </td>
                      <td style={{ ...cellStyle, color: '#64748b' }}>
                        {metric.prefix}{formatNumber(summaryCardsResult.current?.[metric.key]?.forecast, metric.decimals, metric.useK)}{metric.suffix || ''}
                      </td>
                      <td style={{ ...cellStyle, fontWeight: '600', color: '#1a1a2e' }}>
                        {metric.prefix}{formatNumber(summaryCardsResult.current?.[metric.key]?.total, metric.decimals, metric.useK)}{metric.suffix || ''}
                      </td>
                      {/* IA Recommended */}
                      <td style={{ ...cellStyle, color: '#64748b', borderLeft: '1px solid #e5e7eb' }}>
                        {metric.prefix}{formatNumber(summaryCardsResult.ia_recommended?.[metric.key]?.actuals, metric.decimals, metric.useK)}{metric.suffix || ''}
                      </td>
                      <td style={{ ...cellStyle, color: '#64748b' }}>
                        {metric.prefix}{formatNumber(summaryCardsResult.ia_recommended?.[metric.key]?.forecast, metric.decimals, metric.useK)}{metric.suffix || ''}
                      </td>
                      <td style={{ ...cellStyle, fontWeight: '600', color: '#1a1a2e' }}>
                        {metric.prefix}{formatNumber(summaryCardsResult.ia_recommended?.[metric.key]?.total, metric.decimals, metric.useK)}{metric.suffix || ''}
                      </td>
                      <td style={{ ...cellStyle }}>
                        {formatDelta(
                          summaryCardsResult.ia_recommended?.[metric.key]?.vs_current, 
                          metric.decimals, 
                          metric.isPercentage, 
                          metric.isDollar
                        )}
                      </td>
                      {/* Finalized */}
                      <td style={{ ...cellStyle, color: '#64748b', borderLeft: '1px solid #e5e7eb' }}>
                        {metric.prefix}{formatNumber(summaryCardsResult.finalized?.[metric.key]?.actuals, metric.decimals, metric.useK)}{metric.suffix || ''}
                      </td>
                      <td style={{ ...cellStyle, color: '#64748b' }}>
                        {metric.prefix}{formatNumber(summaryCardsResult.finalized?.[metric.key]?.forecast, metric.decimals, metric.useK)}{metric.suffix || ''}
                      </td>
                      <td style={{ ...cellStyle, fontWeight: '600', color: '#1a1a2e' }}>
                        {metric.prefix}{formatNumber(summaryCardsResult.finalized?.[metric.key]?.total, metric.decimals, metric.useK)}{metric.suffix || ''}
                      </td>
                      <td style={{ ...cellStyle }}>
                        {formatDelta(
                          summaryCardsResult.finalized?.[metric.key]?.vs_current, 
                          metric.decimals, 
                          metric.isPercentage, 
                          metric.isDollar
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!summaryCardsResult && !summaryCardsError && !isValidatingSummaryCards && (
          <div style={{ 
            background: 'white', 
            borderRadius: '12px', 
            padding: '40px',
            textAlign: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
          }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" style={{ marginBottom: '16px' }}>
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
            <h3 style={{ margin: '0 0 8px', color: '#1a1a2e' }}>Summary Cards Validator</h3>
            <p style={{ margin: 0, color: '#64748b' }}>
              Enter a strategy ID to view the summary card metrics from reco tables
            </p>
          </div>
        )}

        {/* (Loading state for channels is shown inline inside the channel dropdown above.) */}

      </div>
    );
  };

  const renderMonthlySummaryCardsValidator = () => {
    const handleLoadChannels = async (strategyId) => {
      if (!strategyId.trim()) return;
      setIsLoadingMonthlyChannels(true);
      try {
        const response = await api.getMonthlySummaryCardsChannels(parseInt(strategyId));
        if (response.data.success) {
          const channels = response.data.channels || [];
          setMonthlySummaryChannels(channels);
          setSelectedMonthlyChannels(channels.map(c => c.id));
        }
      } catch (err) {
        console.error('Failed to load channels:', err);
        setMonthlySummaryChannels([]);
        setSelectedMonthlyChannels([]);
      } finally {
        setIsLoadingMonthlyChannels(false);
      }
    };

    const handleValidate = async () => {
      if (!monthlySummaryStrategyId.trim()) {
        setMonthlySummaryError('Please enter a strategy ID');
        return;
      }
      if (selectedMonthlyChannels.length === 0) {
        setMonthlySummaryError('Please select at least one channel');
        return;
      }
      setIsValidatingMonthlySummary(true);
      setMonthlySummaryError(null);
      setMonthlySummaryResult(null);
      try {
        const channelIds = selectedMonthlyChannels.join(',');
        const response = await api.validateMonthlySummaryCards(parseInt(monthlySummaryStrategyId), channelIds);
        if (response.data.success) {
          setMonthlySummaryResult(response.data);
        } else {
          setMonthlySummaryError(response.data.error || 'Validation failed');
        }
      } catch (err) {
        setMonthlySummaryError(err.response?.data?.detail || err.message || 'Validation failed');
      } finally {
        setIsValidatingMonthlySummary(false);
      }
    };

    const handleShowQuery = async () => {
      if (!monthlySummaryStrategyId.trim()) {
        setMonthlySummaryError('Please enter a strategy ID');
        return;
      }
      if (isLoadingQuery) return;
      setIsLoadingQuery(true);
      try {
        const channelIds = selectedMonthlyChannels.length > 0 ? selectedMonthlyChannels.join(',') : null;
        const response = await api.getMonthlySummaryCardsQuery(parseInt(monthlySummaryStrategyId), channelIds);
        if (response.data.success) {
          setMonthlySummaryQuery(response.data.query);
          setShowMonthlySummaryQuery(true);
        }
      } catch (err) {
        setMonthlySummaryError(err.response?.data?.detail || err.message || 'Failed to get query');
      } finally {
        setIsLoadingQuery(false);
      }
    };

    const toggleChannel = (channelId) => {
      // Allow deselecting all — Validate button gates on selectedMonthlyChannels.length === 0.
      setSelectedMonthlyChannels(prev =>
        prev.includes(channelId) ? prev.filter(id => id !== channelId) : [...prev, channelId]
      );
    };

    const toggleAllChannels = () => {
      const allSelected = selectedMonthlyChannels.length === monthlySummaryChannels.length;
      setSelectedMonthlyChannels(allSelected ? [] : monthlySummaryChannels.map(c => c.id));
    };

    const formatNumber = (val, decimals = 2, useK = false) => {
      if (val === null || val === undefined) return '-';
      const num = Number(val);
      if (isNaN(num)) return '-';
      if (useK && Math.abs(num) >= 1000) {
        const kVal = num / 1000;
        return kVal.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'K';
      }
      return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    };

    const formatDelta = (val, decimals = 2, isPercentage = false, isDollar = false) => {
      if (val === null || val === undefined) return '-';
      const num = Number(val);
      if (isNaN(num) || num === 0) return '-';
      const formatted = Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      const isPositive = num > 0;
      const bgColor = isPositive ? '#dcfce7' : '#fee2e2';
      const textColor = isPositive ? '#16a34a' : '#dc2626';
      const arrow = isPositive ? '↑' : '↓';
      const prefix = isDollar ? '$' : '';
      const suffix = isPercentage ? '%' : '';
      return (
        <span style={{ color: textColor, fontWeight: '500', background: bgColor, padding: '2px 8px', borderRadius: '12px', fontSize: '12px', whiteSpace: 'nowrap' }}>
          {arrow} {prefix}{formatted}{suffix}
        </span>
      );
    };

    const metrics = [
      { key: 'sales_units',         label: 'Sales units',    decimals: 1, prefix: '',  isDollar: false, useK: false },
      { key: 'revenue',             label: 'Revenue $',      decimals: 2, prefix: '$', isDollar: true,  useK: true  },
      { key: 'gross_margin_dollar', label: 'Gross margin $', decimals: 2, prefix: '$', isDollar: true,  useK: true  },
      { key: 'gm_percentage',       label: 'Gross margin %', decimals: 2, prefix: '',  suffix: '%', isPercentage: true, useK: false },
      { key: 'asp',                 label: 'ASP $',          decimals: 2, prefix: '$', isDollar: true,  useK: false },
      { key: 'aum',                 label: 'AUM $',          decimals: 2, prefix: '$', isDollar: true,  useK: false },
    ];

    const cellStyle = { padding: '10px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb', fontSize: '13px', color: '#1a1a2e' };
    const headerCellStyle = { padding: '10px 12px', textAlign: 'center', fontWeight: '600', fontSize: '12px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb', color: '#475569' };

    const periodTitle = (p) => {
      const titleMap = {
        FISCAL_YEAR: 'Fiscal Year',
        FISCAL_YEAR_Q1: 'Fiscal Year Q1',
        FISCAL_YEAR_Q2: 'Fiscal Year Q2',
        FISCAL_YEAR_Q3: 'Fiscal Year Q3',
        FISCAL_YEAR_Q4: 'Fiscal Year Q4',
        CALENDAR_YEAR: 'Calendar Year (12 Months)',
        TWELVE_MONTHS: '12 Months',
      };
      return titleMap[p.forecast_type] || p.period_label || p.forecast_type;
    };

    const renderPeriodCard = (period, idx) => (
      <div key={`${period.forecast_type}-${period.period_label}-${idx}`} style={{ background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #e5e7eb', marginBottom: '20px' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <h3 style={{ margin: 0, color: '#1a1a2e', fontSize: '16px', fontWeight: '600' }}>{periodTitle(period)}</h3>
          <span style={{ color: '#64748b', fontSize: '13px' }}>
            {period.start_date} to {period.end_date}
            {period.month_count != null && <span style={{ marginLeft: '8px', color: '#94a3b8' }}>· {period.month_count} months</span>}
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1200px' }}>
            <thead>
              <tr>
                <th style={{ ...headerCellStyle, textAlign: 'left', width: '140px', background: 'white', borderBottom: 'none' }}></th>
                <th colSpan="3" style={{ ...headerCellStyle, background: 'white', borderBottom: 'none', borderLeft: '1px solid #e5e7eb' }}>
                  <span style={{ display: 'inline-block', background: '#dbeafe', color: '#1e40af', padding: '6px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: '500' }}>Current</span>
                </th>
                <th colSpan="4" style={{ ...headerCellStyle, background: 'white', borderBottom: 'none', borderLeft: '1px solid #e5e7eb' }}>
                  <span style={{ display: 'inline-block', background: '#ede9fe', color: '#5b21b6', padding: '6px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: '500' }}>IA Recommended</span>
                  <span style={{ display: 'inline-block', color: '#94a3b8', padding: '6px 12px', fontSize: '13px', fontWeight: '400' }}>Vs Current</span>
                </th>
                <th colSpan="4" style={{ ...headerCellStyle, background: 'white', borderBottom: 'none', borderLeft: '1px solid #e5e7eb' }}>
                  <span style={{ display: 'inline-block', background: '#f1f5f9', color: '#475569', padding: '6px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: '500' }}>Finalized</span>
                  <span style={{ display: 'inline-block', color: '#94a3b8', padding: '6px 12px', fontSize: '13px', fontWeight: '400' }}>Vs Current</span>
                </th>
              </tr>
              <tr>
                <th style={{ ...headerCellStyle, textAlign: 'left', background: 'white', color: '#64748b', fontWeight: '500' }}>KPIs</th>
                <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400', borderLeft: '1px solid #e5e7eb' }}>Actuals</th>
                <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400' }}>Forecast</th>
                <th style={{ ...headerCellStyle, background: 'white', color: '#374151', fontWeight: '600' }}>Total</th>
                <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400', borderLeft: '1px solid #e5e7eb' }}>Actuals</th>
                <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400' }}>Forecast</th>
                <th style={{ ...headerCellStyle, background: 'white', color: '#374151', fontWeight: '600' }}>Total</th>
                <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400' }}></th>
                <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400', borderLeft: '1px solid #e5e7eb' }}>Actuals</th>
                <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400' }}>Forecast</th>
                <th style={{ ...headerCellStyle, background: 'white', color: '#374151', fontWeight: '600' }}>Total</th>
                <th style={{ ...headerCellStyle, background: 'white', color: '#94a3b8', fontWeight: '400' }}></th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => (
                <tr key={metric.key} style={{ background: 'white' }}>
                  <td style={{ ...cellStyle, textAlign: 'left', fontWeight: '400', color: '#475569' }}>{metric.label}</td>
                  <td style={{ ...cellStyle, color: '#64748b', borderLeft: '1px solid #e5e7eb' }}>{metric.prefix}{formatNumber(period.current?.[metric.key]?.actuals, metric.decimals, metric.useK)}{metric.suffix || ''}</td>
                  <td style={{ ...cellStyle, color: '#64748b' }}>{metric.prefix}{formatNumber(period.current?.[metric.key]?.forecast, metric.decimals, metric.useK)}{metric.suffix || ''}</td>
                  <td style={{ ...cellStyle, fontWeight: '600', color: '#1a1a2e' }}>{metric.prefix}{formatNumber(period.current?.[metric.key]?.total, metric.decimals, metric.useK)}{metric.suffix || ''}</td>
                  <td style={{ ...cellStyle, color: '#64748b', borderLeft: '1px solid #e5e7eb' }}>{metric.prefix}{formatNumber(period.ia_recommended?.[metric.key]?.actuals, metric.decimals, metric.useK)}{metric.suffix || ''}</td>
                  <td style={{ ...cellStyle, color: '#64748b' }}>{metric.prefix}{formatNumber(period.ia_recommended?.[metric.key]?.forecast, metric.decimals, metric.useK)}{metric.suffix || ''}</td>
                  <td style={{ ...cellStyle, fontWeight: '600', color: '#1a1a2e' }}>{metric.prefix}{formatNumber(period.ia_recommended?.[metric.key]?.total, metric.decimals, metric.useK)}{metric.suffix || ''}</td>
                  <td style={{ ...cellStyle }}>{formatDelta(period.ia_recommended?.[metric.key]?.vs_current, metric.decimals, metric.isPercentage, metric.isDollar)}</td>
                  <td style={{ ...cellStyle, color: '#64748b', borderLeft: '1px solid #e5e7eb' }}>{metric.prefix}{formatNumber(period.finalized?.[metric.key]?.actuals, metric.decimals, metric.useK)}{metric.suffix || ''}</td>
                  <td style={{ ...cellStyle, color: '#64748b' }}>{metric.prefix}{formatNumber(period.finalized?.[metric.key]?.forecast, metric.decimals, metric.useK)}{metric.suffix || ''}</td>
                  <td style={{ ...cellStyle, fontWeight: '600', color: '#1a1a2e' }}>{metric.prefix}{formatNumber(period.finalized?.[metric.key]?.total, metric.decimals, metric.useK)}{metric.suffix || ''}</td>
                  <td style={{ ...cellStyle }}>{formatDelta(period.finalized?.[metric.key]?.vs_current, metric.decimals, metric.isPercentage, metric.isDollar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );

    return (
      <div>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <button onClick={handleBackToWorkbench} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: '#64748b' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </button>
          <h2 style={{ margin: 0, color: '#1a1a2e', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            Monthly Summary Cards Validator
            <InfoIcon tooltip="Summary cards for non-strategy-period forecast types (FY, Quarters, 12-month). Forecast portion from bp_monthly_forecast, actuals from bp_monthly_forecast_actuals." />
          </h2>
        </div>

        {/* Strategy Input — matches Summary Cards Validator layout */}
        <div style={{
          background: 'white',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '20px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, maxWidth: '200px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#475569', marginBottom: '6px' }}>
                Strategy ID
              </label>
              <input
                type="text"
                value={monthlySummaryStrategyId}
                onChange={(e) => { setMonthlySummaryStrategyId(e.target.value); setMonthlySummaryResult(null); setMonthlySummaryChannels([]); setSelectedMonthlyChannels([]); }}
                onBlur={() => monthlySummaryStrategyId.trim() && handleLoadChannels(monthlySummaryStrategyId)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); handleValidate(); } }}
                placeholder="Enter strategy ID"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>
            <button
              onClick={handleValidate}
              disabled={!monthlySummaryStrategyId.trim() || isValidatingMonthlySummary || selectedMonthlyChannels.length === 0}
              style={{
                padding: '10px 20px',
                background: (!monthlySummaryStrategyId.trim() || isValidatingMonthlySummary || selectedMonthlyChannels.length === 0) ? '#94a3b8' : '#264CD7',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: (!monthlySummaryStrategyId.trim() || isValidatingMonthlySummary || selectedMonthlyChannels.length === 0) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              {isValidatingMonthlySummary ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"/>
                  </svg>
                  Validating...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 11l3 3L22 4"/>
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                  </svg>
                  Validate
                </>
              )}
            </button>
            <button
              onClick={handleShowQuery}
              disabled={!monthlySummaryStrategyId.trim() || isLoadingQuery || showMonthlySummaryQuery}
              style={{
                padding: '10px 20px',
                background: (!monthlySummaryStrategyId.trim() || isLoadingQuery || showMonthlySummaryQuery) ? '#94a3b8' : '#64748b',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: (!monthlySummaryStrategyId.trim() || isLoadingQuery || showMonthlySummaryQuery) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              {isLoadingQuery ? (<>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                  <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"/>
                </svg>
                Loading…
              </>) : (<>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
                Show Query
              </>)}
            </button>
          </div>
        </div>

        {/* Channel Dropdown — separate card to match Summary Cards Validator */}
        {monthlySummaryChannels.length > 0 && (
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '16px 20px',
            marginBottom: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <label style={{ fontSize: '13px', fontWeight: '500', color: '#475569' }}>
                Channels:
              </label>
              <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                <button
                  onClick={() => setShowMonthlyChannelDropdown(!showMonthlyChannelDropdown)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    background: 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '13px',
                    color: '#1a1a2e'
                  }}
                >
                  <span>
                    {selectedMonthlyChannels.length === monthlySummaryChannels.length
                      ? 'All channels selected'
                      : `${selectedMonthlyChannels.length} of ${monthlySummaryChannels.length} selected`}
                  </span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>

                {showMonthlyChannelDropdown && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: '4px',
                    background: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    zIndex: 100,
                    maxHeight: '250px',
                    overflow: 'auto'
                  }}>
                    <div style={{
                      padding: '8px 12px',
                      borderBottom: '1px solid #e5e7eb',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <button
                        onClick={toggleAllChannels}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#264CD7',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: '500'
                        }}
                      >
                        {selectedMonthlyChannels.length === monthlySummaryChannels.length ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    {monthlySummaryChannels.map(channel => (
                      <label
                        key={channel.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '10px 12px',
                          cursor: 'pointer',
                          borderBottom: '1px solid #f3f4f6'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedMonthlyChannels.includes(channel.id)}
                          onChange={() => toggleChannel(channel.id)}
                          style={{ accentColor: '#264CD7' }}
                        />
                        <span style={{ fontSize: '13px', color: '#1a1a2e' }}>{channel.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Generated SQL — inline dark panel, sits after the channel dropdown */}
        {showMonthlySummaryQuery && monthlySummaryQuery && (
          <div style={{ background: '#0f172a', borderRadius: '12px', padding: '16px 20px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 600 }}>Generated SQL</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => { navigator.clipboard?.writeText(monthlySummaryQuery); }}
                  style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
                >
                  Copy
                </button>
                <button
                  onClick={() => setShowMonthlySummaryQuery(false)}
                  style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
                >
                  Hide
                </button>
              </div>
            </div>
            <pre style={{ margin: 0, color: '#cbd5e1', fontSize: '11px', overflow: 'auto', maxHeight: '400px', fontFamily: 'ui-monospace, monospace' }}>{monthlySummaryQuery}</pre>
          </div>
        )}

        {/* Error */}
        {monthlySummaryError && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '16px', marginBottom: '20px', color: '#991b1b' }}>
            {monthlySummaryError}
          </div>
        )}

        {/* ===== Tab strip: Summary / Detailed view ===== */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '1px solid #e2e8f0', paddingBottom: '0' }}>
          {[
            { id: 'summary', label: 'Summary' },
            { id: 'detailed', label: 'Detailed view' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setMonthlyActiveTab(t.id)}
              style={{
                padding: '10px 16px',
                background: 'transparent',
                border: 'none',
                borderBottom: monthlyActiveTab === t.id ? '2px solid #264CD7' : '2px solid transparent',
                color: monthlyActiveTab === t.id ? '#264CD7' : '#64748b',
                fontWeight: monthlyActiveTab === t.id ? 600 : 500,
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ===== SUMMARY TAB ===== */}
        {monthlyActiveTab === 'summary' && (
          <>
            {monthlySummaryResult?.periods?.length > 0 && (
              <div>
                {monthlySummaryResult.periods.map((p, i) => renderPeriodCard(p, i))}
              </div>
            )}
            {!monthlySummaryResult && !monthlySummaryError && !isValidatingMonthlySummary && (
              <div style={{ background: 'white', borderRadius: '12px', padding: '40px', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <h3 style={{ margin: '0 0 8px', color: '#1a1a2e' }}>Monthly Summary Cards Validator</h3>
                <p style={{ margin: 0, color: '#64748b' }}>
                  Enter a strategy ID to view summary cards for Fiscal Year, Quarters, and 12-Month forecast types.
                </p>
              </div>
            )}
          </>
        )}

        {/* ===== DETAILED VIEW TAB ===== */}
        {monthlyActiveTab === 'detailed' && renderMonthlyDetailedView()}
      </div>
    );
  };

  // Detailed view: grouped table with metrics × scenarios × forecast_type pivoted as columns.
  // Built off /api/validation/monthly-detailed-view/{strategy_id}?view_by=product|line_group.
  const renderMonthlyDetailedView = () => {
    if (!monthlySummaryStrategyId.trim() || selectedMonthlyChannels.length === 0) {
      return (
        <div style={{ background: 'white', borderRadius: '12px', padding: '40px', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: 0, color: '#64748b' }}>Enter a strategy ID and select at least one channel.</p>
        </div>
      );
    }

    const rows = monthlyDetailedRows;

    // Build dynamic columns: each (forecast_type, period_label) gets its own group of cells.
    // Scenarios × portions × metrics within each group.
    const metricSpecs = [
      { key: 'sales',   label: 'Sales Units', decimals: 0, prefix: '',  useK: false },
      { key: 'revenue', label: 'Revenue',     decimals: 0, prefix: '$', useK: true  },
      { key: 'gm',      label: 'GM$',         decimals: 0, prefix: '$', useK: true  },
      { key: 'gm_pct',  label: 'GM%',         decimals: 2, prefix: '',  useK: false, suffix: '%' },
      { key: 'asp',     label: 'ASP',         decimals: 2, prefix: '$', useK: false },
      { key: 'aum',     label: 'AUM',         decimals: 2, prefix: '$', useK: false },
    ];

    // Sub-columns under each (metric × forecast_type). Actuals appears once (scenario-agnostic).
    // Each spec knows where to pull its value from inside a row.
    const subColSpecs = [
      { key: 'actuals',     label: 'Actuals',          color: '#fef3c7', read: (r, mc) => r[`actuals_${mc}`] },
      { key: 'cur_forecast',label: 'Current Forecast', color: '#dbeafe', read: (r, mc) => r[`forecast_cur_${mc}`] },
      { key: 'cur_total',   label: 'Current Total',    color: '#dbeafe', read: (r, mc) => r[`total_cur_${mc}`] },
      { key: 'ia_forecast', label: 'IA Forecast',      color: '#ede9fe', read: (r, mc) => r[`forecast_ia_${mc}`] },
      { key: 'ia_total',    label: 'IA Total',         color: '#ede9fe', read: (r, mc) => r[`total_ia_${mc}`] },
      { key: 'fin_forecast',label: 'Final Forecast',   color: '#f1f5f9', read: (r, mc) => r[`forecast_fin_${mc}`] },
      { key: 'fin_total',   label: 'Final Total',      color: '#f1f5f9', read: (r, mc) => r[`total_fin_${mc}`] },
    ];
    // Map metricSpec.key -> SQL column suffix (matches backend output names).
    const metricColMap = {
      sales: 'sales', revenue: 'revenue', gm: 'gm', gm_pct: 'gm_pct', asp: 'asp', aum: 'aum',
    };

    // Distinct forecast_types present (sorted by display_order).
    const forecastTypeRecs = (() => {
      const seen = new Map();
      rows.forEach(r => {
        if (!seen.has(r.forecast_type)) {
          seen.set(r.forecast_type, { forecast_type: r.forecast_type, label: r.period_label, display_order: r.display_order ?? 999 });
        }
      });
      return Array.from(seen.values()).sort((a, b) => a.display_order - b.display_order);
    })();

    // Distinct group rows (one per group_label × channel × segment × price_zone).
    const groupRows = (() => {
      const byKey = new Map();
      rows.forEach(r => {
        const k = `${r.group_label}|${r.channel_id}|${r.segment_id}|${r.price_zone}`;
        if (!byKey.has(k)) {
          byKey.set(k, {
            key: k,
            group_label: r.group_label,
            product_codes: r.product_codes,      // comma-separated; single value in product view
            product_names: r.product_names,
            product_count: r.product_count,
            line_group: r.line_group,
            channel_name: r.channel_name,
            segment_name: r.segment_name,
            price_zone: r.price_zone,
            base_price_current: r.base_price_current,
            base_price_ia: r.base_price_ia,
            base_price_fin: r.base_price_fin,
            byForecastType: {},
          });
        }
        byKey.get(k).byForecastType[r.forecast_type] = r;
      });
      return Array.from(byKey.values());
    })();

    const fmt = (val, m) => {
      if (val == null) return '—';
      const n = Number(val);
      if (!Number.isFinite(n)) return '—';
      const v = m.useK && Math.abs(n) >= 1000
        ? (n / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'K'
        : n.toLocaleString(undefined, { minimumFractionDigits: m.decimals, maximumFractionDigits: m.decimals });
      return `${m.prefix || ''}${v}${m.suffix || ''}`;
    };


    // NOTE: header row uses sticky-top so the column labels stay visible during
    // vertical scroll. Body identity cells are NOT sticky-left — when multiple
    // identity columns all set `left: 0` they pile up on each other during
    // horizontal scroll, which looked like values "rolling over" each other.
    const thIdentityStyle = { padding: '8px 10px', textAlign: 'left', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', color: '#475569', fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 2 };
    const thGroupStyle    = { padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: 600 };
    const tdStyle         = { padding: '6px 8px', borderBottom: '1px solid #f1f5f9', fontSize: '11px', color: '#1a1a2e', whiteSpace: 'nowrap' };
    const tdIdentityStyle = { ...tdStyle, background: '#f8fafc' };

    return (
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, color: '#1a1a2e', fontSize: '15px', fontWeight: 600 }}>Price recommendations</h3>
          <div style={{ flex: 1 }} />
          <label style={{ fontSize: '13px', color: '#64748b' }}>View by:</label>
          <select
            value={monthlyDetailedViewBy}
            onChange={(e) => setMonthlyDetailedViewBy(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', background: 'white', cursor: 'pointer' }}
          >
            <option value="product">Product - Price Zone</option>
            <option value="line_group">Line Group - Price Zone</option>
          </select>
        </div>

        {monthlyDetailedError && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', color: '#991b1b', fontSize: '13px' }}>
            {monthlyDetailedError}
          </div>
        )}

        {monthlyDetailedLoading && (
          <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>Loading detailed view…</div>
        )}

        {!monthlyDetailedLoading && !monthlyDetailedError && groupRows.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>No rows for this strategy/channel selection.</div>
        )}

        {!monthlyDetailedLoading && groupRows.length > 0 && (
          <div style={{ overflow: 'auto', maxHeight: '700px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '11px', width: '100%' }}>
              {/* Identity columns differ per view:
                  Product view  : Product Code | Product Name | Price Zone | Channel | Segment
                  LG view       : Line Group | Price Zone | Channel | Segment
                  (Line Group cell carries a hover tooltip listing the SKUs in the group.) */}
              <thead>
                {(() => {
                  const isLineGroupHdr = monthlyDetailedViewBy === 'line_group';
                  const identityCols = isLineGroupHdr
                    ? ['Line Group', 'Price Zone', 'Channel', 'Segment']
                    : ['Product Code', 'Product Name', 'Price Zone', 'Channel', 'Segment'];
                  // Layout: Metric (top) -> Forecast type (middle) -> 7 sub-columns (leaf).
                  // Row 1: Identity banner + Base Price banner + per-metric banner
                  // Row 2: identity col labels (rowSpan=2) + BP scenarios (rowSpan=2)
                  //         + per metric × forecast_type label (colSpan=7)
                  // Row 3: per metric × forecast_type × sub-column (7 leaf cells)
                  return (
                    <>
                      <tr>
                        <th colSpan={identityCols.length} style={{ ...thIdentityStyle, background: '#e2e8f0', borderRight: '2px solid #475569' }}>Identity</th>
                        <th colSpan={3} style={{ ...thGroupStyle, background: '#fde68a', borderRight: '2px solid #475569' }}>Base Price ($)</th>
                        {metricSpecs.map((m, mi) => (
                          <th
                            key={m.key}
                            colSpan={forecastTypeRecs.length * subColSpecs.length}
                            style={{ ...thGroupStyle, background: '#bae6fd', borderRight: mi < metricSpecs.length - 1 ? '2px solid #475569' : undefined }}
                          >
                            {m.label}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {identityCols.map((label, ii) => (
                          <th key={label} rowSpan={2} style={{ ...thIdentityStyle, borderRight: ii === identityCols.length - 1 ? '2px solid #475569' : undefined }}>{label}</th>
                        ))}
                        <th rowSpan={2} style={thGroupStyle}>Current</th>
                        <th rowSpan={2} style={thGroupStyle}>IA</th>
                        <th rowSpan={2} style={{ ...thGroupStyle, borderRight: '2px solid #475569' }}>Final</th>
                        {metricSpecs.map((m, mi) => (
                          forecastTypeRecs.map((ft, fi) => {
                            const isLastFt = fi === forecastTypeRecs.length - 1;
                            const isLastMetric = mi === metricSpecs.length - 1;
                            const borderRight = isLastFt && !isLastMetric ? '2px solid #475569'
                                              : isLastFt ? undefined
                                              : '1px solid #cbd5e1';
                            return (
                              <th
                                key={`${m.key}-${ft.forecast_type}`}
                                colSpan={subColSpecs.length}
                                style={{ ...thGroupStyle, background: '#e0f2fe', borderRight }}
                              >
                                {ft.label || ft.forecast_type}
                              </th>
                            );
                          })
                        ))}
                      </tr>
                      <tr>
                        {metricSpecs.map((m, mi) => (
                          forecastTypeRecs.map((ft, fi) => (
                            subColSpecs.map((sc, si) => {
                              const isLastSubCol = si === subColSpecs.length - 1;
                              const isLastFt = fi === forecastTypeRecs.length - 1;
                              const isLastMetric = mi === metricSpecs.length - 1;
                              const borderRight = isLastSubCol && isLastFt && !isLastMetric ? '2px solid #475569'
                                                : isLastSubCol && !isLastFt ? '1px solid #cbd5e1'
                                                : undefined;
                              return (
                                <th
                                  key={`${m.key}-${ft.forecast_type}-${sc.key}`}
                                  style={{ ...thGroupStyle, background: sc.color, fontSize: '10px', borderRight }}
                                >
                                  {sc.label}
                                </th>
                              );
                            })
                          ))
                        ))}
                      </tr>
                    </>
                  );
                })()}
              </thead>
              <tbody>
                {groupRows.map(g => {
                  const isLineGroup = monthlyDetailedViewBy === 'line_group';
                  // Line Group cell: when multiple SKUs collapse into the group, show a
                  // small "(N products)" suffix with a hover tooltip listing the SKUs.
                  const lineGroupCell = (g.product_count > 1)
                    ? (
                      <>
                        <span style={{ fontWeight: 600 }}>{g.group_label || '—'}</span>
                        <span title={g.product_codes || ''} style={{ marginLeft: '6px', color: '#64748b', cursor: 'help', borderBottom: '1px dotted #94a3b8', fontSize: '10px' }}>
                          ({g.product_count} products)
                        </span>
                      </>
                    )
                    : (<span style={{ fontWeight: 600 }}>{g.group_label || '—'}</span>);
                  // Last identity column gets a thick right border to separate from Base Price block.
                  const lastIdentityIdx = isLineGroup ? 3 : 4;
                  const idCell = (i, content, extra = {}) => (
                    <td style={{ ...tdIdentityStyle, ...(i === lastIdentityIdx ? { borderRight: '2px solid #475569' } : {}), ...extra }}>{content}</td>
                  );
                  return (
                  <tr key={g.key}>
                    {isLineGroup ? (
                      <>
                        {idCell(0, lineGroupCell)}
                        {idCell(1, g.price_zone)}
                        {idCell(2, g.channel_name)}
                        {idCell(3, g.segment_name)}
                      </>
                    ) : (
                      <>
                        {idCell(0, g.group_label || '—', { fontWeight: 600 })}
                        {idCell(1, g.product_names || '—')}
                        {idCell(2, g.price_zone)}
                        {idCell(3, g.channel_name)}
                        {idCell(4, g.segment_name)}
                      </>
                    )}
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(g.base_price_current, { decimals: 2, prefix: '$' })}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(g.base_price_ia,      { decimals: 2, prefix: '$' })}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', borderRight: '2px solid #475569' }}>{fmt(g.base_price_fin,     { decimals: 2, prefix: '$' })}</td>
                    {metricSpecs.map((m, mi) => (
                      forecastTypeRecs.map((ft, fi) => {
                        const rowFt = g.byForecastType[ft.forecast_type];
                        const metricCol = metricColMap[m.key];
                        const isLastFt = fi === forecastTypeRecs.length - 1;
                        const isLastMetric = mi === metricSpecs.length - 1;
                        return subColSpecs.map((sc, si) => {
                          const isLastSubCol = si === subColSpecs.length - 1;
                          // Same border rules as the header row so the lines align.
                          const borderRight = isLastSubCol && isLastFt && !isLastMetric ? '2px solid #475569'
                                            : isLastSubCol && !isLastFt ? '1px solid #cbd5e1'
                                            : undefined;
                          return (
                            <td
                              key={`${g.key}-${m.key}-${ft.forecast_type}-${sc.key}`}
                              style={{ ...tdStyle, textAlign: 'right', borderRight }}
                            >
                              {fmt(rowFt ? sc.read(rowFt, metricCol) : null, m)}
                            </td>
                          );
                        });
                      })
                    ))}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: '10px', color: '#94a3b8', fontSize: '11px' }}>
          {groupRows.length} group rows · {forecastTypeRecs.length} forecast types · sub-columns per metric × period: Actuals, Current Forecast, Current Total, IA Forecast, IA Total, Final Forecast, Final Total (Total = Forecast + Actuals)
        </div>
      </div>
    );
  };

  // Reco Grid Data validator — our reco rollup vs the tool's pre-aggregated
  // bp_strategy_price_reco_grid_data_{product,line_group}_pricezone tables.
  // Each row is (group_label, channel, segment, price_zone); per metric we surface
  //   our value | grid value | MATCH/MISMATCH/MISSING_* status.
  // Scenario tabs (Current / IA / Finalized / Actuals) flip the visible columns so
  // the user isn't drowning in 60+ columns at once.
  const handleRunRecoGridData = async () => {
    if (!recoGridStrategyId.trim()) {
      setRecoGridError('Please enter a strategy ID');
      return;
    }
    setIsValidatingRecoGrid(true);
    setRecoGridError(null);
    setRecoGridResult(null);
    try {
      const response = await api.runRecoGridDataValidation(parseInt(recoGridStrategyId), recoGridViewBy);
      const result = response.data;
      if (!result.success && result.error) {
        setRecoGridError(result.error);
        return;
      }
      setRecoGridResult(result);
    } catch (err) {
      setRecoGridError(err.response?.data?.detail || err.message || 'Validation failed');
    } finally {
      setIsValidatingRecoGrid(false);
    }
  };

  const handleViewRecoGridQuery = async () => {
    if (!recoGridStrategyId.trim()) {
      setRecoGridError('Please enter a strategy ID');
      return;
    }
    if (isLoadingQuery) return;
    setIsLoadingQuery(true);
    try {
      const response = await api.getRecoGridDataQuery(parseInt(recoGridStrategyId), recoGridViewBy);
      setRecoGridQuery(response.data.query || '');
      setShowRecoGridQuery(true);
    } catch (err) {
      setRecoGridError(err.response?.data?.detail || err.message || 'Failed to fetch query');
    } finally {
      setIsLoadingQuery(false);
    }
  };

  // Metric specs reused across the 3 scenario tabs. The 'metrics-bp' set is for
  // the standard scenario (includes base_price); 'metrics-baseline' drops BP.
  // Each metric key matches the suffix the backend emits, e.g. for current:
  //   our_cur_sales / grid_cur_sales / cur_sales_match, our_cur_asp / ... etc.
  const recoGridMetricGroups = {
    current: {
      label: 'Current',
      color: '#dbeafe',
      standard: [
        { key: 'sales',   label: 'Sales',   prefix: '',  decimals: 2, ourCol: 'our_cur_sales',   gridCol: 'grid_cur_sales',   matchCol: 'cur_sales_match' },
        { key: 'revenue', label: 'Revenue', prefix: '$', decimals: 2, ourCol: 'our_cur_revenue', gridCol: 'grid_cur_revenue', matchCol: 'cur_revenue_match' },
        { key: 'gm',      label: 'GM$',     prefix: '$', decimals: 2, ourCol: 'our_cur_gm',      gridCol: 'grid_cur_gm',      matchCol: 'cur_gm_match' },
        { key: 'asp',     label: 'ASP',     prefix: '$', decimals: 2, ourCol: 'our_cur_asp',     gridCol: 'grid_cur_asp',     matchCol: 'cur_asp_match' },
        { key: 'aum',     label: 'AUM',     prefix: '$', decimals: 2, ourCol: 'our_cur_aum',     gridCol: 'grid_cur_aum',     matchCol: 'cur_aum_match' },
        { key: 'gm_pct',  label: 'GM%',     prefix: '',  decimals: 2, suffix: '%', ourCol: 'our_cur_gm_pct',  gridCol: 'grid_cur_gm_pct',  matchCol: 'cur_gm_pct_match' },
        { key: 'bp',      label: 'Base Price', prefix: '$', decimals: 2, ourCol: 'our_cur_bp',   gridCol: 'grid_cur_bp',      matchCol: 'cur_bp_match' },
      ],
      baseline: [
        { key: 'bl_sales',   label: 'BL Sales',   prefix: '',  decimals: 2, ourCol: 'our_cur_bl_sales',   gridCol: 'grid_cur_bl_sales',   matchCol: 'cur_bl_sales_match' },
        { key: 'bl_revenue', label: 'BL Revenue', prefix: '$', decimals: 2, ourCol: 'our_cur_bl_revenue', gridCol: 'grid_cur_bl_revenue', matchCol: 'cur_bl_revenue_match' },
        { key: 'bl_gm',      label: 'BL GM$',     prefix: '$', decimals: 2, ourCol: 'our_cur_bl_gm',      gridCol: 'grid_cur_bl_gm',      matchCol: 'cur_bl_gm_match' },
        { key: 'bl_asp',     label: 'BL ASP',     prefix: '$', decimals: 2, ourCol: 'our_cur_bl_asp',     gridCol: 'grid_cur_bl_asp',     matchCol: 'cur_bl_asp_match' },
        { key: 'bl_aum',     label: 'BL AUM',     prefix: '$', decimals: 2, ourCol: 'our_cur_bl_aum',     gridCol: 'grid_cur_bl_aum',     matchCol: 'cur_bl_aum_match' },
        { key: 'bl_gm_pct',  label: 'BL GM%',     prefix: '',  decimals: 2, suffix: '%', ourCol: 'our_cur_bl_gm_pct', gridCol: 'grid_cur_bl_gm_pct', matchCol: 'cur_bl_gm_pct_match' },
      ],
    },
    ia: {
      label: 'IA Recommended',
      color: '#ede9fe',
      standard: [
        { key: 'sales',   label: 'Sales',      prefix: '',  decimals: 2, ourCol: 'our_ia_sales',   gridCol: 'grid_ia_sales',   matchCol: 'ia_sales_match' },
        { key: 'revenue', label: 'Revenue',    prefix: '$', decimals: 2, ourCol: 'our_ia_revenue', gridCol: 'grid_ia_revenue', matchCol: 'ia_revenue_match' },
        { key: 'gm',      label: 'GM$',        prefix: '$', decimals: 2, ourCol: 'our_ia_gm',      gridCol: 'grid_ia_gm',      matchCol: 'ia_gm_match' },
        { key: 'asp',     label: 'ASP',        prefix: '$', decimals: 2, ourCol: 'our_ia_asp',     gridCol: 'grid_ia_asp',     matchCol: 'ia_asp_match' },
        { key: 'aum',     label: 'AUM',        prefix: '$', decimals: 2, ourCol: 'our_ia_aum',     gridCol: 'grid_ia_aum',     matchCol: 'ia_aum_match' },
        { key: 'gm_pct',  label: 'GM%',        prefix: '',  decimals: 2, suffix: '%', ourCol: 'our_ia_gm_pct',  gridCol: 'grid_ia_gm_pct',  matchCol: 'ia_gm_pct_match' },
        { key: 'bp',      label: 'Base Price', prefix: '$', decimals: 2, ourCol: 'our_ia_bp',      gridCol: 'grid_ia_bp',      matchCol: 'ia_bp_match' },
      ],
      baseline: [
        { key: 'bl_sales',   label: 'BL Sales',   prefix: '',  decimals: 2, ourCol: 'our_ia_bl_sales',   gridCol: 'grid_ia_bl_sales',   matchCol: 'ia_bl_sales_match' },
        { key: 'bl_revenue', label: 'BL Revenue', prefix: '$', decimals: 2, ourCol: 'our_ia_bl_revenue', gridCol: 'grid_ia_bl_revenue', matchCol: 'ia_bl_revenue_match' },
        { key: 'bl_gm',      label: 'BL GM$',     prefix: '$', decimals: 2, ourCol: 'our_ia_bl_gm',      gridCol: 'grid_ia_bl_gm',      matchCol: 'ia_bl_gm_match' },
        { key: 'bl_asp',     label: 'BL ASP',     prefix: '$', decimals: 2, ourCol: 'our_ia_bl_asp',     gridCol: 'grid_ia_bl_asp',     matchCol: 'ia_bl_asp_match' },
        { key: 'bl_aum',     label: 'BL AUM',     prefix: '$', decimals: 2, ourCol: 'our_ia_bl_aum',     gridCol: 'grid_ia_bl_aum',     matchCol: 'ia_bl_aum_match' },
        { key: 'bl_gm_pct',  label: 'BL GM%',     prefix: '',  decimals: 2, suffix: '%', ourCol: 'our_ia_bl_gm_pct',  gridCol: 'grid_ia_bl_gm_pct',  matchCol: 'ia_bl_gm_pct_match' },
      ],
    },
    finalized: {
      label: 'Finalized',
      color: '#f1f5f9',
      standard: [
        { key: 'sales',   label: 'Sales',      prefix: '',  decimals: 2, ourCol: 'our_fin_sales',   gridCol: 'grid_fin_sales',   matchCol: 'fin_sales_match' },
        { key: 'revenue', label: 'Revenue',    prefix: '$', decimals: 2, ourCol: 'our_fin_revenue', gridCol: 'grid_fin_revenue', matchCol: 'fin_revenue_match' },
        { key: 'gm',      label: 'GM$',        prefix: '$', decimals: 2, ourCol: 'our_fin_gm',      gridCol: 'grid_fin_gm',      matchCol: 'fin_gm_match' },
        { key: 'asp',     label: 'ASP',        prefix: '$', decimals: 2, ourCol: 'our_fin_asp',     gridCol: 'grid_fin_asp',     matchCol: 'fin_asp_match' },
        { key: 'aum',     label: 'AUM',        prefix: '$', decimals: 2, ourCol: 'our_fin_aum',     gridCol: 'grid_fin_aum',     matchCol: 'fin_aum_match' },
        { key: 'gm_pct',  label: 'GM%',        prefix: '',  decimals: 2, suffix: '%', ourCol: 'our_fin_gm_pct',  gridCol: 'grid_fin_gm_pct',  matchCol: 'fin_gm_pct_match' },
        { key: 'bp',      label: 'Base Price', prefix: '$', decimals: 2, ourCol: 'our_fin_bp',      gridCol: 'grid_fin_bp',      matchCol: 'fin_bp_match' },
      ],
      baseline: [
        { key: 'bl_sales',   label: 'BL Sales',   prefix: '',  decimals: 2, ourCol: 'our_fin_bl_sales',   gridCol: 'grid_fin_bl_sales',   matchCol: 'fin_bl_sales_match' },
        { key: 'bl_revenue', label: 'BL Revenue', prefix: '$', decimals: 2, ourCol: 'our_fin_bl_revenue', gridCol: 'grid_fin_bl_revenue', matchCol: 'fin_bl_revenue_match' },
        { key: 'bl_gm',      label: 'BL GM$',     prefix: '$', decimals: 2, ourCol: 'our_fin_bl_gm',      gridCol: 'grid_fin_bl_gm',      matchCol: 'fin_bl_gm_match' },
        { key: 'bl_asp',     label: 'BL ASP',     prefix: '$', decimals: 2, ourCol: 'our_fin_bl_asp',     gridCol: 'grid_fin_bl_asp',     matchCol: 'fin_bl_asp_match' },
        { key: 'bl_aum',     label: 'BL AUM',     prefix: '$', decimals: 2, ourCol: 'our_fin_bl_aum',     gridCol: 'grid_fin_bl_aum',     matchCol: 'fin_bl_aum_match' },
        { key: 'bl_gm_pct',  label: 'BL GM%',     prefix: '',  decimals: 2, suffix: '%', ourCol: 'our_fin_bl_gm_pct',  gridCol: 'grid_fin_bl_gm_pct',  matchCol: 'fin_bl_gm_pct_match' },
      ],
    },
    actuals: {
      label: 'Actuals (from reco_finalized)',
      color: '#fef3c7',
      standard: [
        { key: 'sales',   label: 'Sales',   prefix: '',  decimals: 2, ourCol: 'our_act_sales',   gridCol: 'grid_act_sales',   matchCol: 'act_sales_match' },
        { key: 'revenue', label: 'Revenue', prefix: '$', decimals: 2, ourCol: 'our_act_revenue', gridCol: 'grid_act_revenue', matchCol: 'act_revenue_match' },
        { key: 'gm',      label: 'GM$',     prefix: '$', decimals: 2, ourCol: 'our_act_gm',      gridCol: 'grid_act_gm',      matchCol: 'act_gm_match' },
        { key: 'asp',     label: 'ASP',     prefix: '$', decimals: 2, ourCol: 'our_act_asp',     gridCol: 'grid_act_asp',     matchCol: 'act_asp_match' },
        { key: 'aum',     label: 'AUM',     prefix: '$', decimals: 2, ourCol: 'our_act_aum',     gridCol: 'grid_act_aum',     matchCol: 'act_aum_match' },
        { key: 'gm_pct',  label: 'GM%',     prefix: '',  decimals: 2, suffix: '%', ourCol: 'our_act_gm_pct',  gridCol: 'grid_act_gm_pct',  matchCol: 'act_gm_pct_match' },
      ],
      baseline: null, // actuals have no per-scenario baseline split
    },
  };

  // Format a value with prefix/suffix/decimals; null/undefined → em-dash.
  const fmtRecoGrid = (val, spec) => {
    if (val == null) return '—';
    const n = Number(val);
    if (!Number.isFinite(n)) return '—';
    return `${spec.prefix || ''}${n.toLocaleString(undefined, { minimumFractionDigits: spec.decimals, maximumFractionDigits: spec.decimals })}${spec.suffix || ''}`;
  };

  // Match status → background tint. MATCH=green, MISMATCH=red, MISSING_*=amber.
  const matchBg = (status) => {
    if (status === 'MATCH') return '#dcfce7';
    if (status === 'MISMATCH') return '#fee2e2';
    if (status === 'MISSING_OURS' || status === 'MISSING_GRID') return '#fef3c7';
    return '#f8fafc';
  };
  const matchFg = (status) => {
    if (status === 'MATCH') return '#16a34a';
    if (status === 'MISMATCH') return '#dc2626';
    if (status === 'MISSING_OURS' || status === 'MISSING_GRID') return '#d97706';
    return '#64748b';
  };

  const renderRecoGridDataValidator = () => {
    const result = recoGridResult;
    const rows = result?.rows || [];
    const summary = result?.summary || {};

    // Per-metric mismatch tally for the current scenario tab; used in the badge row above the table.
    const currentScenarioSpec = recoGridMetricGroups[recoGridScenario];
    const metricsForScenario = [
      ...(currentScenarioSpec.standard || []),
      ...(currentScenarioSpec.baseline || []),
    ];

    // High-level counts across ALL metrics (for the summary cards), grouped by category.
    const summaryByCategory = {
      standard: { match: 0, mismatch: 0, missing: 0 },
      baseline: { match: 0, mismatch: 0, missing: 0 },
      actuals:  { match: 0, mismatch: 0, missing: 0 },
    };
    Object.entries(summary).forEach(([col, counts]) => {
      const cat = col.includes('act_') ? 'actuals' : (col.includes('bl_') ? 'baseline' : 'standard');
      summaryByCategory[cat].match    += counts.MATCH        || 0;
      summaryByCategory[cat].mismatch += counts.MISMATCH     || 0;
      summaryByCategory[cat].missing  += (counts.MISSING_OURS || 0) + (counts.MISSING_GRID || 0);
    });

    const thStyle = { padding: '8px 10px', textAlign: 'center', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', color: '#475569', fontWeight: 600, whiteSpace: 'nowrap' };
    const tdStyle = { padding: '6px 8px', borderBottom: '1px solid #f1f5f9', fontSize: '11px', color: '#1a1a2e', whiteSpace: 'nowrap', textAlign: 'right' };
    const tdIdStyle = { ...tdStyle, textAlign: 'left', background: '#f8fafc', position: 'sticky', left: 0, zIndex: 1 };

    return (
      <div>
        {/* Header with Back button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <button
            onClick={handleBackToWorkbench}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: '#64748b' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back to Workbench
          </button>
          <div>
            <h2 style={{ margin: '0 0 4px 0', color: '#1a1a2e', fontSize: '20px' }}>Reco Grid Data Validator</h2>
            <p style={{ margin: 0, color: '#64748b', fontSize: '13px' }}>
              Compares our reco rollup against bp_strategy_price_reco_grid_data_{recoGridViewBy === 'line_group' ? 'line_group' : 'product'}_pricezone — per-metric MATCH / MISMATCH / MISSING flags including baselines and actuals.
            </p>
          </div>
        </div>

        {/* Input bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', padding: '16px', background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <input
            type="text"
            value={recoGridStrategyId}
            onChange={(e) => setRecoGridStrategyId(e.target.value)}
            placeholder="Enter strategy ID (e.g. 1697)"
            style={{ flex: '1 1 240px', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px' }}
            onKeyDown={(e) => e.key === 'Enter' && handleRunRecoGridData()}
          />
          <label style={{ fontSize: '13px', color: '#64748b' }}>View by:</label>
          <select
            value={recoGridViewBy}
            onChange={(e) => setRecoGridViewBy(e.target.value)}
            style={{ padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', background: 'white', cursor: 'pointer' }}
          >
            <option value="product">Product × Price Zone</option>
            <option value="line_group">Line Group × Price Zone</option>
          </select>
          <button
            onClick={handleViewRecoGridQuery}
            disabled={isValidatingRecoGrid || !recoGridStrategyId.trim() || isLoadingQuery || showRecoGridQuery}
            style={{ padding: '10px 16px', background: 'white', color: '#264CD7', border: '1px solid #264CD7', borderRadius: '8px', fontSize: '14px', fontWeight: 500, cursor: (isValidatingRecoGrid || !recoGridStrategyId.trim() || isLoadingQuery || showRecoGridQuery) ? 'not-allowed' : 'pointer', opacity: (isValidatingRecoGrid || !recoGridStrategyId.trim() || isLoadingQuery || showRecoGridQuery) ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            {isLoadingQuery && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"/>
              </svg>
            )}
            {isLoadingQuery ? 'Loading…' : 'View Query'}
          </button>
          <button
            onClick={handleRunRecoGridData}
            disabled={isValidatingRecoGrid || !recoGridStrategyId.trim()}
            style={{ padding: '10px 20px', background: (isValidatingRecoGrid || !recoGridStrategyId.trim()) ? '#94a3b8' : '#264CD7', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 500, cursor: (isValidatingRecoGrid || !recoGridStrategyId.trim()) ? 'not-allowed' : 'pointer' }}
          >
            {isValidatingRecoGrid ? 'Validating…' : 'Run Validation'}
          </button>
        </div>

        {recoGridError && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', color: '#991b1b', fontSize: '13px' }}>
            <strong>Error:</strong> {recoGridError}
          </div>
        )}

        {showRecoGridQuery && recoGridQuery && (
          <div style={{ background: '#0f172a', borderRadius: '12px', padding: '16px 20px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 600 }}>Generated SQL</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => { navigator.clipboard?.writeText(recoGridQuery); }}
                  style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
                >
                  Copy
                </button>
                <button
                  onClick={() => setShowRecoGridQuery(false)}
                  style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
                >
                  Hide
                </button>
              </div>
            </div>
            <pre style={{ margin: 0, color: '#cbd5e1', fontSize: '11px', overflow: 'auto', maxHeight: '400px', fontFamily: 'ui-monospace, monospace' }}>{recoGridQuery}</pre>
          </div>
        )}

        {!result && !isValidatingRecoGrid && !recoGridError && (
          <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '40px', textAlign: 'center', color: '#64748b' }}>
            Enter a strategy ID and click "Run Validation" to compare our reco rollup against the tool's grid data tables.
          </div>
        )}

        {result && (
          <>
            {/* Strategy heading + horizontal card strip — mirrors the Reco Table
                Metrics layout. Counts are derived row-by-row from `rows` using
                each metric's backend column name. Standard + Baseline cards show
                Current / IA / Finalized; Actuals cards show one "Actuals" row. */}
            {(() => {
              const totalRows = rows.length || 0;
              const bothPresent = rows.filter(r => r.row_presence === 'PRESENT').length;
              const missingOurs = rows.filter(r => r.row_presence === 'MISSING_OURS').length;
              const missingGrid = rows.filter(r => r.row_presence === 'MISSING_GRID').length;
              const allMatched = summaryByCategory.standard.mismatch === 0
                              && summaryByCategory.baseline.mismatch === 0
                              && summaryByCategory.actuals.mismatch === 0
                              && summaryByCategory.standard.missing  === 0
                              && summaryByCategory.baseline.missing  === 0
                              && summaryByCategory.actuals.missing   === 0;

              // [card title, prefix used in match column name, isMatch flag, scenarios shown].
              // Scenarios use the backend's `cur` / `ia` / `fin` for standard + baseline,
              // and a single `act` for the actuals block.
              const stdScenarios = [
                { label: 'Current',   col: 'cur' },
                { label: 'IA',        col: 'ia' },
                { label: 'Finalized', col: 'fin' },
              ];
              const actScenarios = [{ label: 'Actuals', col: 'act' }];

              const metricCards = [
                // Standard metrics
                { title: 'Sales Match',         matchKey: 'sales',     isMatch: true,  scenarios: stdScenarios },
                { title: 'Sales Mismatch',      matchKey: 'sales',     isMatch: false, scenarios: stdScenarios },
                { title: 'Revenue Match',       matchKey: 'revenue',   isMatch: true,  scenarios: stdScenarios },
                { title: 'Revenue Mismatch',    matchKey: 'revenue',   isMatch: false, scenarios: stdScenarios },
                { title: 'GM$ Match',           matchKey: 'gm',        isMatch: true,  scenarios: stdScenarios },
                { title: 'GM$ Mismatch',        matchKey: 'gm',        isMatch: false, scenarios: stdScenarios },
                { title: 'GM% Match',           matchKey: 'gm_pct',    isMatch: true,  scenarios: stdScenarios },
                { title: 'GM% Mismatch',        matchKey: 'gm_pct',    isMatch: false, scenarios: stdScenarios },
                { title: 'ASP Match',           matchKey: 'asp',       isMatch: true,  scenarios: stdScenarios },
                { title: 'ASP Mismatch',        matchKey: 'asp',       isMatch: false, scenarios: stdScenarios },
                { title: 'AUM Match',           matchKey: 'aum',       isMatch: true,  scenarios: stdScenarios },
                { title: 'AUM Mismatch',        matchKey: 'aum',       isMatch: false, scenarios: stdScenarios },
                { title: 'Base Price Match',    matchKey: 'bp',        isMatch: true,  scenarios: stdScenarios },
                { title: 'Base Price Mismatch', matchKey: 'bp',        isMatch: false, scenarios: stdScenarios },
                // Baseline metrics — column names have an extra `_bl` segment:
                //   cur_bl_sales_match, ia_bl_revenue_match, fin_bl_gm_match, etc.
                { title: 'BL Sales Match',      matchKey: 'bl_sales',   isMatch: true,  scenarios: stdScenarios },
                { title: 'BL Sales Mismatch',   matchKey: 'bl_sales',   isMatch: false, scenarios: stdScenarios },
                { title: 'BL Revenue Match',    matchKey: 'bl_revenue', isMatch: true,  scenarios: stdScenarios },
                { title: 'BL Revenue Mismatch', matchKey: 'bl_revenue', isMatch: false, scenarios: stdScenarios },
                { title: 'BL GM$ Match',        matchKey: 'bl_gm',      isMatch: true,  scenarios: stdScenarios },
                { title: 'BL GM$ Mismatch',     matchKey: 'bl_gm',      isMatch: false, scenarios: stdScenarios },
                { title: 'BL GM% Match',        matchKey: 'bl_gm_pct',  isMatch: true,  scenarios: stdScenarios },
                { title: 'BL GM% Mismatch',     matchKey: 'bl_gm_pct',  isMatch: false, scenarios: stdScenarios },
                { title: 'BL ASP Match',        matchKey: 'bl_asp',     isMatch: true,  scenarios: stdScenarios },
                { title: 'BL ASP Mismatch',     matchKey: 'bl_asp',     isMatch: false, scenarios: stdScenarios },
                { title: 'BL AUM Match',        matchKey: 'bl_aum',     isMatch: true,  scenarios: stdScenarios },
                { title: 'BL AUM Mismatch',     matchKey: 'bl_aum',     isMatch: false, scenarios: stdScenarios },
                // Actuals — single scenario (`act_<metric>_match`).
                { title: 'Actuals Sales Match',    matchKey: 'sales',   isMatch: true,  scenarios: actScenarios },
                { title: 'Actuals Sales Mismatch', matchKey: 'sales',   isMatch: false, scenarios: actScenarios },
                { title: 'Actuals Revenue Match',  matchKey: 'revenue', isMatch: true,  scenarios: actScenarios },
                { title: 'Actuals Revenue Mismatch', matchKey: 'revenue', isMatch: false, scenarios: actScenarios },
                { title: 'Actuals GM$ Match',      matchKey: 'gm',      isMatch: true,  scenarios: actScenarios },
                { title: 'Actuals GM$ Mismatch',   matchKey: 'gm',      isMatch: false, scenarios: actScenarios },
                { title: 'Actuals GM% Match',      matchKey: 'gm_pct',  isMatch: true,  scenarios: actScenarios },
                { title: 'Actuals GM% Mismatch',   matchKey: 'gm_pct',  isMatch: false, scenarios: actScenarios },
                { title: 'Actuals ASP Match',      matchKey: 'asp',     isMatch: true,  scenarios: actScenarios },
                { title: 'Actuals ASP Mismatch',   matchKey: 'asp',     isMatch: false, scenarios: actScenarios },
                { title: 'Actuals AUM Match',      matchKey: 'aum',     isMatch: true,  scenarios: actScenarios },
                { title: 'Actuals AUM Mismatch',   matchKey: 'aum',     isMatch: false, scenarios: actScenarios },
              ];

              return (
                <div style={{ background: 'white', borderRadius: '12px', padding: '20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                  <h3 style={{ margin: '0 0 16px 0', color: '#1a1a2e', fontSize: '15px' }}>
                    Strategy #{recoGridStrategyId} — {recoGridViewBy === 'line_group' ? 'Line Group' : 'Product'} × Price Zone
                  </h3>

                  <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch', overflowX: 'auto', paddingBottom: '8px' }}>
                    {/* Total Rows */}
                    <div style={{ padding: '16px 24px', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center', minWidth: '110px', flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <div style={{ fontSize: '28px', fontWeight: '700', color: '#1a1a2e' }}>{totalRows}</div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', fontWeight: '500' }}>Total Rows</div>
                    </div>

                    {/* Overall Pass / Fail */}
                    <div style={{ padding: '16px 24px', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center', minWidth: '100px', flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      <div style={{ fontSize: '18px', fontWeight: '700', color: allMatched ? '#16a34a' : '#dc2626' }}>
                        {allMatched ? 'Pass' : 'Fail'}
                      </div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', fontWeight: '500' }}>Overall</div>
                    </div>

                    {/* Row Identity — both-present / missing on either side. */}
                    <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', minWidth: '180px', flexShrink: 0 }}>
                      <div style={{ background: '#f0f9ff', padding: '8px 12px', borderBottom: '1px solid #bae6fd', fontSize: '12px', fontWeight: '600', color: '#0369a1' }}>Row Identity</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead>
                          <tr style={{ background: '#f9fafb' }}>
                            <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '500', color: '#374151', borderBottom: '1px solid #e5e7eb' }}></th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '6px 10px', color: '#374151' }}>Both present</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#0369a1' }}>{bothPresent}</td>
                          </tr>
                          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '6px 10px', color: '#374151' }}>Missing ours</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#d97706' }}>{missingOurs}</td>
                          </tr>
                          <tr>
                            <td style={{ padding: '6px 10px', color: '#374151' }}>Missing grid</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#d97706' }}>{missingGrid}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Per-metric Match / Mismatch cards */}
                    {metricCards.map((card, idx) => {
                      const total = totalRows || 1;
                      const target = card.isMatch ? 'MATCH' : 'MISMATCH';
                      const bg = card.isMatch ? '#dcfce7' : '#fef2f2';
                      const border = card.isMatch ? '#86efac' : '#fecaca';
                      const color = card.isMatch ? '#166534' : '#991b1b';
                      return (
                        <div key={idx} style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', minWidth: '180px', flexShrink: 0 }}>
                          <div style={{ background: bg, padding: '8px 12px', borderBottom: `1px solid ${border}`, fontSize: '12px', fontWeight: '600', color }}>
                            {card.title}
                          </div>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                            <thead>
                              <tr style={{ background: '#f9fafb' }}>
                                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '500', color: '#374151', borderBottom: '1px solid #e5e7eb' }}></th>
                                <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Count</th>
                                <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>%</th>
                              </tr>
                            </thead>
                            <tbody>
                              {card.scenarios.map(s => {
                                const colKey = `${s.col}_${card.matchKey}_match`;
                                const count = rows.reduce((acc, r) => acc + (r[colKey] === target ? 1 : 0), 0);
                                const pct = ((count / total) * 100).toFixed(1);
                                return (
                                  <tr key={s.col} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                    <td style={{ padding: '6px 10px', color: '#374151' }}>{s.label}</td>
                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '500', color }}>{count}</td>
                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '500', color }}>{pct}%</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Scenario tabs */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
              {Object.entries(recoGridMetricGroups).map(([key, spec]) => (
                <button
                  key={key}
                  onClick={() => setRecoGridScenario(key)}
                  style={{ padding: '8px 16px', background: recoGridScenario === key ? spec.color : 'white', color: recoGridScenario === key ? '#1a1a2e' : '#64748b', border: `1px solid ${recoGridScenario === key ? '#1a1a2e' : '#e2e8f0'}`, borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                >
                  {spec.label}
                </button>
              ))}
            </div>

            {/* Results table — same grouped-header layout used by Monthly Forecast /
                Monthly Actuals: identity columns, then per-metric Calc | Stored | Match
                with MATCH / MISMATCH cells tinted green / red and styled by the shared
                renderResultsTable helper. Builds rows with pre-formatted values per
                metric (since renderResultsTable doesn't know about per-metric prefix /
                decimals / suffix). */}
            {(() => {
              const stdSpec = currentScenarioSpec.standard || [];
              const baselineSpec = currentScenarioSpec.baseline || [];
              const isLineGroup = recoGridViewBy === 'line_group';

              // Pre-format every metric cell into a string so the table just prints what
              // we give it; the formatter handles $, %, decimals per metric.
              const formattedRows = rows.map(r => {
                const out = {
                  group_label: r.group_label || r.product_codes || '—',
                  channel_name: r.channel_name || (r.channel_id != null ? `ch ${r.channel_id}` : '—'),
                  segment_name: r.segment_name || (r.segment_id != null ? `seg ${r.segment_id}` : '—'),
                  price_zone: r.price_zone || '—',
                  products_display: r.product_count > 1 ? `${r.product_count} products` : (r.product_codes || '—'),
                };
                [...stdSpec, ...baselineSpec].forEach(m => {
                  out[`${m.key}__calc`]   = fmtRecoGrid(r[m.ourCol],  m);
                  out[`${m.key}__stored`] = fmtRecoGrid(r[m.gridCol], m);
                  out[m.matchCol]         = r[m.matchCol];
                });
                return out;
              });

              const metricColumnsFor = (specs) => specs.flatMap(m => ([
                { key: `${m.key}__calc`,   label: `${m.label} Calc` },
                { key: `${m.key}__stored`, label: `${m.label} Stored` },
                { key: m.matchCol,         label: `${m.label} Match`, isMatch: true },
              ]));

              const groups = [
                { name: 'Identity', color: '#e2e8f0', columns: [
                  { key: 'group_label',     label: isLineGroup ? 'Line Group' : 'Product' },
                  { key: 'channel_name',    label: 'Channel' },
                  { key: 'segment_name',    label: 'Segment' },
                  { key: 'price_zone',      label: 'Price Zone' },
                  { key: 'products_display', label: 'Products' },
                ]},
                { name: currentScenarioSpec.label, color: currentScenarioSpec.color, columns: metricColumnsFor(stdSpec) },
              ];
              if (baselineSpec.length > 0) {
                groups.push({ name: `${currentScenarioSpec.label} — Baseline`, color: '#fde68a', columns: metricColumnsFor(baselineSpec) });
              }

              return renderResultsTable(groups, formattedRows);
            })()}
          </>
        )}
      </div>
    );
  };

  const renderSalesUnitsValidator = () => {
    return (
      <div>
        {/* Header with Back button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <button
            onClick={handleBackToWorkbench}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 12px',
              background: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              color: '#64748b'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back
          </button>
          <div>
            <h2 style={{ margin: 0, color: '#1a1a2e', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              Reco Table Metrics Validator
              <InfoIcon tooltip="Validate all reco-table metrics (Sales, Revenue, GM$, GM%, ASP, AUM) against recomputed values" />
            </h2>
          </div>
        </div>

        {/* Strategy ID Input */}
        <div style={{ 
          background: 'white', 
          borderRadius: '12px', 
          padding: '20px',
          marginBottom: '20px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}>
          <label style={{ 
            display: 'block', 
            fontSize: '13px', 
            fontWeight: '500', 
            color: '#475569', 
            marginBottom: '8px' 
          }}>
            Strategy ID
          </label>
          <div style={{ display: 'flex', gap: '12px' }}>
            <input
              type="number"
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value)}
              placeholder="Enter strategy ID"
              style={{
                flex: 1,
                maxWidth: '300px',
                padding: '10px 14px',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '14px',
                outline: 'none'
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleRunValidation()}
            />
            <button
              onClick={handleRunValidation}
              disabled={isValidating || !strategyId.trim()}
              style={{
                padding: '10px 20px',
                background: (isValidating || !strategyId.trim()) ? '#94a3b8' : '#264CD7',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: (isValidating || !strategyId.trim()) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              {isValidating ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"/>
                  </svg>
                  Validating...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 11l3 3L22 4"/>
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                  </svg>
                  Validate
                </>
              )}
            </button>
            <button
              onClick={handleViewValidationQuery}
              disabled={!strategyId.trim() || isLoadingQuery || showValidationQuery}
              style={{
                padding: '10px 20px',
                background: (!strategyId.trim() || isLoadingQuery || showValidationQuery) ? '#94a3b8' : '#64748b',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: (!strategyId.trim() || isLoadingQuery || showValidationQuery) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              {isLoadingQuery ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"/>
                  </svg>
                  Loading…
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                  </svg>
                  Show Query
                </>
              )}
            </button>
          </div>
        </div>

        {/* Generated SQL — inline dark panel */}
        {showValidationQuery && validationQuery && (
          <div style={{ background: '#0f172a', borderRadius: '12px', padding: '16px 20px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 600 }}>Generated SQL</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => { navigator.clipboard?.writeText(validationQuery); }}
                  style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
                >
                  Copy
                </button>
                <button
                  onClick={() => setShowValidationQuery(false)}
                  style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
                >
                  Hide
                </button>
              </div>
            </div>
            <pre style={{ margin: 0, color: '#cbd5e1', fontSize: '11px', overflow: 'auto', maxHeight: '400px', fontFamily: 'ui-monospace, monospace' }}>{validationQuery}</pre>
          </div>
        )}

        {/* Error Message */}
        {validationError && (
          <div style={{
            padding: '16px 20px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '10px',
            color: '#dc2626',
            fontSize: '14px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            {validationError}
          </div>
        )}

        {/* Results */}
        {validationResult && validationResult.success && (
          <>
            {/* Summary Cards */}
            <div style={{ 
              background: 'white', 
              borderRadius: '12px', 
              padding: '20px',
              marginBottom: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
            }}>
              <h3 style={{ margin: '0 0 16px 0', color: '#1a1a2e', fontSize: '15px' }}>
                Strategy #{validationResult.strategy_id} {validationResult.strategy_name && `- ${validationResult.strategy_name}`}
              </h3>
              
              <div style={{ 
                display: 'flex', 
                gap: '12px', 
                alignItems: 'stretch',
                overflowX: 'auto',
                paddingBottom: '8px'
              }}>
                {/* Total Bins Card */}
                <div style={{ 
                  padding: '16px 24px', 
                  background: 'white', 
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  textAlign: 'center',
                  minWidth: '100px',
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center'
                }}>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#1a1a2e' }}>
                    {validationResult.summary?.total_bins || 0}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', fontWeight: '500' }}>Total Bins</div>
                </div>
                
                {/* Overall Status Card */}
                <div style={{ 
                  padding: '16px 24px', 
                  background: 'white', 
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  textAlign: 'center',
                  minWidth: '100px',
                  flexShrink: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center'
                }}>
                  <div style={{ 
                    fontSize: '18px', 
                    fontWeight: '700', 
                    color: validationResult.all_matched ? '#16a34a' : '#dc2626' 
                  }}>
                    {validationResult.all_matched ? 'Pass' : 'Fail'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', fontWeight: '500' }}>
                    Overall
                  </div>
                </div>
                
                {/* Data Coverage Card - right after summary cards */}
                {validationResult.results && validationResult.results.length > 0 && (() => {
                  const results = validationResult.results;
                  const uniqueProducts = new Set(results.map(r => r.product_code)).size;
                  const totalStores = results.reduce((sum, r) => sum + (r.store_count || 0), 0);
                  const avgWeeks = Math.round(results.reduce((sum, r) => sum + (r.week_count || 0), 0) / results.length);
                  return (
                    <div style={{ 
                      background: 'white', 
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                      overflow: 'hidden',
                      minWidth: '140px',
                      flexShrink: 0
                    }}>
                      <div style={{ 
                        background: '#f0f9ff', 
                        padding: '8px 12px', 
                        borderBottom: '1px solid #bae6fd',
                        fontSize: '12px', 
                        fontWeight: '600', 
                        color: '#0369a1'
                      }}>
                        Data Coverage
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead>
                          <tr style={{ background: '#f9fafb' }}>
                            <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '500', color: '#374151', borderBottom: '1px solid #e5e7eb' }}></th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '6px 10px', color: '#374151' }}>Products</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#0369a1' }}>{uniqueProducts}</td>
                          </tr>
                          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <td style={{ padding: '6px 10px', color: '#374151' }}>Store-Bins</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#0369a1' }}>{totalStores.toLocaleString()}</td>
                          </tr>
                          <tr>
                            <td style={{ padding: '6px 10px', color: '#374151' }}>Avg Weeks</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#0369a1' }}>{avgWeeks}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
                
                {/* Metric Cards */}
                {[
                  { title: 'Sales Units Match', matchKey: 'sales', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Sales Units Mismatch', matchKey: 'sales', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'Baseline Units Match', matchKey: 'baseline', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Baseline Units Mismatch', matchKey: 'baseline', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'Revenue Match', matchKey: 'revenue', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Revenue Mismatch', matchKey: 'revenue', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'Baseline Rev Match', matchKey: 'baseline_rev', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Baseline Rev Mismatch', matchKey: 'baseline_rev', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'GM$ Match', matchKey: 'gm_dollar', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'GM$ Mismatch', matchKey: 'gm_dollar', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'Baseline GM$ Match', matchKey: 'baseline_gm', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Baseline GM$ Mismatch', matchKey: 'baseline_gm', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'GM% Match', matchKey: 'gm_pct', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'GM% Mismatch', matchKey: 'gm_pct', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'Baseline GM% Match', matchKey: 'baseline_gm_pct', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Baseline GM% Mismatch', matchKey: 'baseline_gm_pct', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'ASP Match', matchKey: 'asp', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'ASP Mismatch', matchKey: 'asp', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'Baseline ASP Match', matchKey: 'baseline_asp', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Baseline ASP Mismatch', matchKey: 'baseline_asp', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'AUM Match', matchKey: 'aum', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'AUM Mismatch', matchKey: 'aum', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'Baseline AUM Match', matchKey: 'baseline_aum', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Baseline AUM Mismatch', matchKey: 'baseline_aum', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'Actuals Sales Match', matchKey: 'actuals_sales', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Actuals Sales Mismatch', matchKey: 'actuals_sales', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'Actuals Revenue Match', matchKey: 'actuals_revenue', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Actuals Revenue Mismatch', matchKey: 'actuals_revenue', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'Actuals GM$ Match', matchKey: 'actuals_gm_dollar', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Actuals GM$ Mismatch', matchKey: 'actuals_gm_dollar', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'Actuals GM% Match', matchKey: 'actuals_gm_pct', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Actuals GM% Mismatch', matchKey: 'actuals_gm_pct', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'Actuals ASP Match', matchKey: 'actuals_asp', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Actuals ASP Mismatch', matchKey: 'actuals_asp', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'Actuals AUM Match', matchKey: 'actuals_aum', isMatch: true, color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Actuals AUM Mismatch', matchKey: 'actuals_aum', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                ].map((card, idx) => {
                  const dataSource = card.isMatch ? validationResult.summary?.matches : validationResult.summary?.mismatches;
                  const totalBins = validationResult.summary?.total_bins || 1;
                  return (
                    <div key={idx} style={{ 
                      background: 'white', 
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                      overflow: 'hidden',
                      minWidth: '160px',
                      flexShrink: 0
                    }}>
                      <div style={{ 
                        background: card.bg, 
                        padding: '8px 12px', 
                        borderBottom: `1px solid ${card.border}`,
                        fontSize: '12px', 
                        fontWeight: '600', 
                        color: card.color
                      }}>
                        {card.title}
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead>
                          <tr style={{ background: '#f9fafb' }}>
                            <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '500', color: '#374151', borderBottom: '1px solid #e5e7eb' }}></th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Count</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {['current', 'ia', 'finalized'].map(version => {
                            const count = dataSource?.[`${card.matchKey}_${version}_match`] || 0;
                            const pct = ((count / totalBins) * 100).toFixed(1);
                            return (
                              <tr key={version} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                <td style={{ padding: '6px 10px', color: '#374151', textTransform: 'capitalize' }}>{version === 'ia' ? 'IA' : version}</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '500', color: card.color }}>{count}</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '500', color: card.color }}>{pct}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Detailed Results Table */}
            {validationResult.results && validationResult.results.length > 0 && (
              <div style={{ 
                background: 'white', 
                borderRadius: '12px', 
                padding: '20px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                overflow: 'hidden'
              }}>
                {/* Table Toolbar */}
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  marginBottom: '16px',
                  flexWrap: 'wrap',
                  gap: '12px'
                }}>
                  <h3 style={{ margin: 0, color: '#1a1a2e', fontSize: '15px' }}>
                    Detailed Results ({getFilteredSortedData().length} of {validationResult.results.length} rows)
                    {hasActiveFilters && <span style={{ color: '#64748b', fontWeight: 'normal' }}> (filtered)</span>}
                  </h3>
                  
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    {/* Table Settings (3-dots) */}
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setShowColumnPicker(!showColumnPicker)}
                        style={{
                          padding: '8px 10px',
                          background: showColumnPicker ? '#264CD7' : 'white',
                          color: showColumnPicker ? 'white' : '#475569',
                          border: '1px solid #e2e8f0',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="5" cy="12" r="2"/>
                          <circle cx="12" cy="12" r="2"/>
                          <circle cx="19" cy="12" r="2"/>
                        </svg>
                      </button>
                      
                      {showColumnPicker && (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          marginTop: '4px',
                          background: 'white',
                          border: '1px solid #e2e8f0',
                          borderRadius: '12px',
                          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                          zIndex: 100,
                          width: '320px',
                          maxHeight: '520px',
                          overflow: 'hidden'
                        }}>
                          {/* Header */}
                          <div style={{ 
                            padding: '16px 16px 12px', 
                            borderBottom: '1px solid #e2e8f0',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}>
                            <span style={{ fontWeight: '600', fontSize: '15px', color: '#1a1a2e' }}>Table Settings</span>
                            <button 
                              onClick={() => setShowColumnPicker(false)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#64748b' }}
                            >
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </button>
                          </div>
                          
                          {/* Content Density Section */}
                          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>
                            <div style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              gap: '8px', 
                              marginBottom: '10px',
                              color: '#475569',
                              fontSize: '13px'
                            }}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M4 6h16M4 12h16M4 18h16"/>
                              </svg>
                              Content density
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              {[{id: 'default', label: 'Default'}, {id: 'compact', label: 'Compact'}, {id: 'comfort', label: 'Comfort'}].map(opt => (
                                <button
                                  key={opt.id}
                                  onClick={() => setContentDensity(opt.id)}
                                  style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    background: contentDensity === opt.id ? '#eff6ff' : '#f8fafc',
                                    color: contentDensity === opt.id ? '#264CD7' : '#475569',
                                    border: contentDensity === opt.id ? '1px solid #264CD7' : '1px solid #e2e8f0',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    fontWeight: contentDensity === opt.id ? '600' : '400',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                  }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M4 6h16M4 12h16M4 18h16"/>
                                  </svg>
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          
                          {/* Wrap Text Section */}
                          <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>
                            <label style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              cursor: 'pointer',
                              gap: '10px'
                            }}>
                              <input
                                type="checkbox"
                                checked={wrapText}
                                onChange={() => setWrapText(!wrapText)}
                                style={{ accentColor: '#264CD7', width: '16px', height: '16px' }}
                              />
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2">
                                  <path d="M3 6h18M3 12h15M3 18h18"/>
                                  <path d="M19 12v3a2 2 0 0 1-2 2h-2"/>
                                  <polyline points="14 15 17 18 14 21"/>
                                </svg>
                                <span style={{ fontSize: '13px', color: '#475569' }}>Wrap text</span>
                              </div>
                            </label>
                          </div>
                          
                          {/* Columns Section */}
                          <div style={{ 
                            padding: '12px 16px', 
                            background: '#f0f4ff',
                            border: '1px solid #264CD7',
                            borderRadius: '8px',
                            margin: '12px 16px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            color: '#264CD7',
                            fontWeight: '600',
                            fontSize: '14px'
                          }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="3" width="18" height="18" rx="2"/>
                              <line x1="9" y1="3" x2="9" y2="21"/>
                              <line x1="15" y1="3" x2="15" y2="21"/>
                            </svg>
                            Columns
                            {hiddenColumns.size > 0 && <span style={{ 
                              background: '#ef4444', 
                              color: 'white', 
                              borderRadius: '10px', 
                              padding: '2px 8px',
                              fontSize: '11px',
                              fontWeight: '500',
                              marginLeft: 'auto'
                            }}>{hiddenColumns.size} hidden</span>}
                          </div>
                          
                          {/* Search & Select All */}
                          <div style={{ padding: '0 16px 8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              onClick={() => {
                                if (hiddenColumns.size === 0) {
                                  // Hide all
                                  const allKeys = allColumns.map(c => c.key);
                                  setHiddenColumns(new Set(allKeys));
                                } else {
                                  // Show all
                                  setHiddenColumns(new Set());
                                }
                              }}
                              style={{
                                width: '20px',
                                height: '20px',
                                background: hiddenColumns.size === 0 ? '#264CD7' : 'white',
                                border: '2px solid #264CD7',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                              }}
                            >
                              {hiddenColumns.size === 0 && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              )}
                            </button>
                            <div style={{
                              flex: 1,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              background: '#f8fafc',
                              borderRadius: '6px',
                              padding: '8px 10px',
                              border: '1px solid #e2e8f0'
                            }}>
                              <input
                                type="text"
                                placeholder="Search"
                                value={columnSearch}
                                onChange={(e) => setColumnSearch(e.target.value)}
                                style={{
                                  flex: 1,
                                  border: 'none',
                                  outline: 'none',
                                  fontSize: '13px',
                                  background: 'transparent',
                                  color: '#1a1a2e'
                                }}
                              />
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                              </svg>
                            </div>
                          </div>
                          
                          {/* Column List */}
                          <div style={{ maxHeight: '250px', overflowY: 'auto', padding: '0 16px 16px' }}>
                            {allColumns
                              .filter(col => !columnSearch || col.label.toLowerCase().includes(columnSearch.toLowerCase()))
                              .map(col => (
                              <label key={col.key} style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                padding: '10px 8px',
                                cursor: 'pointer',
                                gap: '10px',
                                fontSize: '13px',
                                borderBottom: '1px solid #f1f5f9',
                                background: !hiddenColumns.has(col.key) ? '#f8fafc' : 'white'
                              }}>
                                <input
                                  type="checkbox"
                                  checked={!hiddenColumns.has(col.key)}
                                  onChange={() => toggleColumn(col.key)}
                                  style={{ 
                                    accentColor: '#264CD7',
                                    width: '16px',
                                    height: '16px'
                                  }}
                                />
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="#94a3b8">
                                  <circle cx="6" cy="6" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="6" cy="18" r="2"/>
                                  <circle cx="12" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="18" r="2"/>
                                </svg>
                                <span style={{ color: '#1a1a2e' }}>{col.label}</span>
                              </label>
                            ))}
                            {columnSearch && allColumns.filter(col => col.label.toLowerCase().includes(columnSearch.toLowerCase())).length === 0 && (
                              <div style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                                No columns match "{columnSearch}"
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* Clear filters */}
                    {(hasActiveFilters || hiddenColumns.size > 0 || wrapText || contentDensity !== 'default') && (
                      <button
                        onClick={() => { clearAllFilters(); setHiddenColumns(new Set()); setWrapText(false); setContentDensity('default'); }}
                        style={{
                          padding: '8px 12px',
                          background: '#fee2e2',
                          color: '#dc2626',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          cursor: 'pointer'
                        }}
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                </div>
                
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ 
                    width: '100%', 
                    borderCollapse: 'collapse', 
                    fontSize: '11px',
                    minWidth: '2800px'
                  }}>
                    <thead>
                      {/* Column Group Headers */}
                      <tr>
                        <th style={{ ...thGroupStyle, background: '#f1f5f9', width: '30px' }}></th>
                        {columnGroups.map(group => {
                          const visibleCols = group.columns.filter(c => !hiddenColumns.has(c.key));
                          if (visibleCols.length === 0) return null;
                          return (
                            <th key={group.name} colSpan={visibleCols.length} style={{ ...thGroupStyle, background: group.color, textAlign: 'left', position: 'relative' }}>
                              <span style={{
                                position: 'sticky',
                                left: '40px',
                                background: group.color,
                                padding: '0 12px',
                                zIndex: 1
                              }}>
                                {group.name}
                              </span>
                            </th>
                          );
                        })}
                      </tr>
                      <tr style={{ background: '#f8fafc' }}>
                        <th style={{ ...thStyle, width: '30px' }}></th>
                        {columnGroups.flatMap(group => 
                          group.columns.filter(c => !hiddenColumns.has(c.key)).map(col => (
                            <th 
                              key={col.key} 
                              style={{ ...thStyle, position: 'relative' }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {/* Column label */}
                                <span style={{ flex: 1 }}>{col.label}</span>
                                
                                {/* Sort indicator */}
                                {sortConfig.key === col.key && sortConfig.direction && (
                                  <span style={{ color: '#264CD7', fontWeight: '700', fontSize: '11px' }}>
                                    {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                  </span>
                                )}
                                
                                {/* Magnifying glass - Text search */}
                                <button
                                  className="text-search-popover"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenTextSearch(openTextSearch === col.key ? null : col.key);
                                    setOpenFilterColumn(null);
                                  }}
                                  style={{
                                    background: textSearchFilters[col.key] ? '#264CD7' : 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '2px',
                                    borderRadius: '3px',
                                    display: 'flex',
                                    alignItems: 'center'
                                  }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" 
                                    stroke={textSearchFilters[col.key] ? 'white' : '#94a3b8'} strokeWidth="2">
                                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                                  </svg>
                                </button>
                                
                                {/* Triangle - Dropdown filter */}
                                <button
                                  className="filter-popover"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenFilterColumn(openFilterColumn === col.key ? null : col.key);
                                    setFilterSearchText('');
                                    setOpenTextSearch(null);
                                  }}
                                  style={{
                                    background: columnFilters[col.key] ? '#264CD7' : 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '2px',
                                    borderRadius: '3px',
                                    display: 'flex',
                                    alignItems: 'center'
                                  }}
                                >
                                  <svg width="10" height="10" viewBox="0 0 24 24" 
                                    fill={columnFilters[col.key] ? 'white' : '#94a3b8'}>
                                    <path d="M7 10l5 5 5-5z"/>
                                  </svg>
                                </button>
                              </div>
                              
                              {/* Text Search Popover (Magnifying glass) */}
                              {openTextSearch === col.key && (
                                <div 
                                  className="text-search-popover"
                                  style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    marginTop: '4px',
                                    background: '#1a1a2e',
                                    border: '1px solid #374151',
                                    borderRadius: '8px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                                    zIndex: 200,
                                    width: '220px',
                                    padding: '12px'
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>
                                    Contains filter
                                  </div>
                                  <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    background: '#2d2d44',
                                    borderRadius: '6px',
                                    padding: '8px 10px',
                                    border: '1px solid #4b5563'
                                  }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                                      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                                    </svg>
                                    <input
                                      type="text"
                                      placeholder="Type to filter..."
                                      value={textSearchFilters[col.key] || ''}
                                      onChange={(e) => setTextSearchFilters(prev => ({
                                        ...prev,
                                        [col.key]: e.target.value
                                      }))}
                                      autoFocus
                                      style={{
                                        flex: 1,
                                        border: 'none',
                                        outline: 'none',
                                        fontSize: '13px',
                                        background: 'transparent',
                                        color: 'white'
                                      }}
                                    />
                                    {textSearchFilters[col.key] && (
                                      <button
                                        onClick={() => setTextSearchFilters(prev => {
                                          const newFilters = { ...prev };
                                          delete newFilters[col.key];
                                          return newFilters;
                                        })}
                                        style={{
                                          background: 'none',
                                          border: 'none',
                                          cursor: 'pointer',
                                          padding: '2px',
                                          color: '#9ca3af',
                                          display: 'flex'
                                        }}
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                              
                              {/* Dropdown Filter Popover (Triangle) */}
                              {openFilterColumn === col.key && (
                                <div 
                                  className="filter-popover"
                                  style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    marginTop: '4px',
                                    background: '#1a1a2e',
                                    border: '1px solid #374151',
                                    borderRadius: '8px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                                    zIndex: 200,
                                    width: '280px',
                                    maxHeight: '420px',
                                    overflow: 'hidden',
                                    display: 'flex',
                                    flexDirection: 'column'
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {/* Sort section */}
                                  <div style={{ padding: '12px', borderBottom: '1px solid #374151' }}>
                                    <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>Sort</div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                      <button
                                        onClick={() => {
                                          // Toggle: if already asc, clear sort; otherwise set asc
                                          if (sortConfig.key === col.key && sortConfig.direction === 'asc') {
                                            setSortConfig({ key: null, direction: null });
                                          } else {
                                            setSortConfig({ key: col.key, direction: 'asc' });
                                          }
                                        }}
                                        style={{
                                          flex: 1,
                                          padding: '8px 12px',
                                          background: sortConfig.key === col.key && sortConfig.direction === 'asc' ? '#264CD7' : '#2d2d44',
                                          color: 'white',
                                          border: '1px solid #4b5563',
                                          borderRadius: '6px',
                                          cursor: 'pointer',
                                          fontSize: '13px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '6px'
                                        }}
                                      >
                                        <span style={{ fontSize: '11px' }}>A↓</span> Ascending
                                      </button>
                                      <button
                                        onClick={() => {
                                          // Toggle: if already desc, clear sort; otherwise set desc
                                          if (sortConfig.key === col.key && sortConfig.direction === 'desc') {
                                            setSortConfig({ key: null, direction: null });
                                          } else {
                                            setSortConfig({ key: col.key, direction: 'desc' });
                                          }
                                        }}
                                        style={{
                                          flex: 1,
                                          padding: '8px 12px',
                                          background: sortConfig.key === col.key && sortConfig.direction === 'desc' ? '#264CD7' : '#2d2d44',
                                          color: 'white',
                                          border: '1px solid #4b5563',
                                          borderRadius: '6px',
                                          cursor: 'pointer',
                                          fontSize: '13px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '6px'
                                        }}
                                      >
                                        <span style={{ fontSize: '11px' }}>A↑</span> Descending
                                      </button>
                                    </div>
                                  </div>
                                  
                                  {/* Filter section */}
                                  <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #374151' }}>
                                    <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>Filter</div>
                                    <div style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                      background: '#2d2d44',
                                      borderRadius: '6px',
                                      padding: '8px 10px',
                                      border: '1px solid #4b5563'
                                    }}>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                                        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                                      </svg>
                                      <input
                                        type="text"
                                        placeholder="Search values..."
                                        value={filterSearchText}
                                        onChange={(e) => setFilterSearchText(e.target.value)}
                                        style={{
                                          flex: 1,
                                          border: 'none',
                                          outline: 'none',
                                          fontSize: '13px',
                                          background: 'transparent',
                                          color: 'white'
                                        }}
                                      />
                                      {filterSearchText && (
                                        <button
                                          onClick={() => setFilterSearchText('')}
                                          style={{
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '2px',
                                            color: '#9ca3af',
                                            display: 'flex'
                                          }}
                                        >
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                                          </svg>
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  
                                  {/* Checkbox list */}
                                  <div style={{ 
                                    flex: 1, 
                                    overflowY: 'auto',
                                    padding: '4px 0',
                                    maxHeight: '200px'
                                  }}>
                                    {/* Select All */}
                                    <label style={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      padding: '8px 12px',
                                      cursor: 'pointer',
                                      gap: '10px',
                                      color: 'white',
                                      fontSize: '13px',
                                      borderBottom: '1px solid #374151'
                                    }}>
                                      <input
                                        type="checkbox"
                                        checked={areAllSelected(col.key)}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            clearColumnFilter(col.key);
                                          } else {
                                            setColumnFilters(prev => ({ ...prev, [col.key]: new Set() }));
                                          }
                                        }}
                                        style={{ 
                                          width: '16px', 
                                          height: '16px',
                                          accentColor: '#22c55e'
                                        }}
                                      />
                                      <span style={{ fontWeight: '500' }}>(Select All)</span>
                                    </label>
                                    
                                    {/* Individual values - filtered by search */}
                                    {getUniqueValues(col.key)
                                      .filter(value => !filterSearchText || 
                                        String(value).toLowerCase().includes(filterSearchText.toLowerCase())
                                      )
                                      .map(value => {
                                        const isSelected = !columnFilters[col.key] || columnFilters[col.key].has(value);
                                        return (
                                          <label key={value} style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            padding: '6px 12px',
                                            cursor: 'pointer',
                                            gap: '10px',
                                            color: 'white',
                                            fontSize: '13px'
                                          }}>
                                            <input
                                              type="checkbox"
                                              checked={isSelected}
                                              onChange={() => {
                                                if (!columnFilters[col.key]) {
                                                  const allValues = getUniqueValues(col.key);
                                                  const newSet = new Set(allValues.filter(v => v !== value));
                                                  setColumnFilters(prev => ({ ...prev, [col.key]: newSet.size > 0 ? newSet : null }));
                                                } else {
                                                  toggleFilterValue(col.key, value);
                                                }
                                              }}
                                              style={{ 
                                                width: '16px', 
                                                height: '16px',
                                                accentColor: '#22c55e'
                                              }}
                                            />
                                            <span style={{ 
                                              overflow: 'hidden', 
                                              textOverflow: 'ellipsis',
                                              whiteSpace: 'nowrap'
                                            }}>{value}</span>
                                          </label>
                                        );
                                      })}
                                    
                                    {/* No results message */}
                                    {filterSearchText && getUniqueValues(col.key)
                                      .filter(value => String(value).toLowerCase().includes(filterSearchText.toLowerCase())).length === 0 && (
                                      <div style={{ padding: '12px', color: '#9ca3af', textAlign: 'center', fontSize: '13px' }}>
                                        No matching values
                                      </div>
                                    )}
                                  </div>
                                  
                                  {/* Footer buttons */}
                                  <div style={{ 
                                    padding: '12px', 
                                    borderTop: '1px solid #374151',
                                    display: 'flex',
                                    gap: '8px',
                                    justifyContent: 'flex-end'
                                  }}>
                                    <button
                                      onClick={() => {
                                        clearColumnFilter(col.key);
                                        if (sortConfig.key === col.key) {
                                          setSortConfig({ key: null, direction: null });
                                        }
                                      }}
                                      style={{
                                        padding: '6px 12px',
                                        background: 'transparent',
                                        color: '#9ca3af',
                                        border: '1px solid #4b5563',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '12px'
                                      }}
                                    >
                                      Clear Filter
                                    </button>
                                    <button
                                      onClick={() => setOpenFilterColumn(null)}
                                      style={{
                                        padding: '6px 12px',
                                        background: '#264CD7',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '12px'
                                      }}
                                    >
                                      Apply Filter
                                    </button>
                                  </div>
                                </div>
                              )}
                            </th>
                          ))
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {getFilteredSortedData().map((row, idx) => (
                        <React.Fragment key={idx}>
                          <tr style={{ 
                            borderBottom: expandedRow === idx ? 'none' : '1px solid #f1f5f9',
                            background: expandedRow === idx ? '#f8fafc' : 'transparent'
                          }}>
                            {/* Expand button */}
                            <td style={{ ...tdStyle, width: '30px', textAlign: 'center' }}>
                              <button
                                onClick={() => setExpandedRow(expandedRow === idx ? null : idx)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  padding: '2px',
                                  color: '#64748b'
                                }}
                              >
                                {expandedRow === idx ? '▼' : '▶'}
                              </button>
                            </td>
                            {columnGroups.flatMap(group =>
                              group.columns.filter(c => !hiddenColumns.has(c.key)).map(col => {
                                const value = row[col.key];
                                if (col.isMatch) {
                                  return <td key={col.key} style={matchCellStyle(value, col.key)}>{value}</td>;
                                }
                                if (col.isBool) {
                                  return <td key={col.key} style={boolCellStyle(value, col.key)}>{value ? 'Yes' : 'No'}</td>;
                                }
                                if (col.format) {
                                  return <td key={col.key} style={getCellStyle(col.key)}>{col.format(value)}</td>;
                                }
                                return <td key={col.key} style={getCellStyle(col.key)}>{value}</td>;
                              })
                            )}
                          </tr>
                          {/* Expanded Row Details */}
                          {expandedRow === idx && (
                            <tr>
                              <td colSpan={allColumns.filter(c => !hiddenColumns.has(c.key)).length + 1} style={{ 
                                padding: '16px 20px',
                                background: '#f8fafc',
                                borderBottom: '2px solid #264CD7'
                              }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                                  {columnGroups.map(group => (
                                    <div key={group.name} style={{ 
                                      background: 'white', 
                                      padding: '12px', 
                                      borderRadius: '8px',
                                      border: '1px solid #e2e8f0'
                                    }}>
                                      <div style={{ 
                                        fontWeight: '600', 
                                        color: group.color, 
                                        marginBottom: '8px',
                                        fontSize: '12px',
                                        borderBottom: `2px solid ${group.color}`,
                                        paddingBottom: '4px'
                                      }}>
                                        {group.name}
                                      </div>
                                      {group.columns.map(col => (
                                        <div key={col.key} style={{ 
                                          display: 'flex', 
                                          justifyContent: 'space-between', 
                                          padding: '4px 0',
                                          fontSize: '11px',
                                          borderBottom: '1px solid #f1f5f9'
                                        }}>
                                          <span style={{ color: '#64748b' }}>{col.label}:</span>
                                          <span style={{ 
                                            fontWeight: '500',
                                            color: col.isMatch 
                                              ? (row[col.key] === 'MATCH' ? '#16a34a' : '#dc2626')
                                              : col.isBool 
                                                ? (row[col.key] ? '#d97706' : '#64748b')
                                                : '#1a1a2e'
                                          }}>
                                            {col.format ? col.format(row[col.key]) : col.isBool ? (row[col.key] ? 'Yes' : 'No') : row[col.key]}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {/* No results message */}
                {getFilteredSortedData().length === 0 && hasActiveFilters && (
                  <div style={{ 
                    padding: '40px', 
                    textAlign: 'center', 
                    color: '#64748b' 
                  }}>
                    No results match the current filters
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Initial state */}
        {!validationResult && !validationError && !isValidating && (
          <div style={{
            padding: '60px 40px',
            background: 'white',
            borderRadius: '12px',
            border: '2px dashed #e2e8f0',
            textAlign: 'center'
          }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" style={{ marginBottom: '16px' }}>
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
            <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
              Enter a strategy ID and click "Run Validation" to compare calculated vs stored sales units
            </p>
          </div>
        )}
      </div>
    );
  };

  // =========================================================================
  // Shared building blocks for the two monthly validators below
  // =========================================================================

  const matchPillStyle = (state) => {
    const map = {
      MATCH:           { bg: '#dcfce7', fg: '#166534' },
      MISMATCH:        { bg: '#fee2e2', fg: '#991b1b' },
      MISSING_STORED:  { bg: '#fef3c7', fg: '#92400e' },
      MISSING_CALC:    { bg: '#e0e7ff', fg: '#3730a3' },
      MISSING_BOTH:    { bg: '#f1f5f9', fg: '#64748b' },
    };
    const c = map[state] || { bg: '#f1f5f9', fg: '#64748b' };
    return {
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '999px',
      fontSize: '11px',
      fontWeight: 500,
      background: c.bg,
      color: c.fg,
      whiteSpace: 'nowrap',
    };
  };

  const MatchPill = ({ state }) => (
    <span style={matchPillStyle(state)}>{state || '—'}</span>
  );

  // Render the strategy-input + Run button bar (mirrors the existing screens)
  const renderStrategyInputBar = (onRun, placeholder = 'Enter strategy ID (e.g., 1527)', onShowQuery = null) => (
    <div style={{
      background: 'white', borderRadius: '12px', padding: '20px',
      marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    }}>
      <label style={{
        display: 'block', fontSize: '13px', fontWeight: '500',
        color: '#475569', marginBottom: '8px',
      }}>
        Strategy ID
      </label>
      <div style={{ display: 'flex', gap: '12px' }}>
        <input
          type="number"
          value={strategyId}
          onChange={(e) => setStrategyId(e.target.value)}
          placeholder={placeholder}
          style={{
            flex: 1, maxWidth: '300px', padding: '10px 14px',
            border: '1px solid #e2e8f0', borderRadius: '8px',
            fontSize: '14px', outline: 'none',
          }}
          onKeyDown={(e) => e.key === 'Enter' && onRun()}
        />
        <button
          onClick={onRun}
          disabled={isValidating || !strategyId.trim()}
          style={{
            padding: '10px 20px',
            background: (isValidating || !strategyId.trim()) ? '#94a3b8' : '#264CD7',
            color: 'white', border: 'none', borderRadius: '8px',
            fontSize: '14px', fontWeight: '500',
            cursor: (isValidating || !strategyId.trim()) ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}
        >
          {isValidating ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"/>
              </svg>
              Validating...
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 11l3 3L22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
              Validate
            </>
          )}
        </button>
        {onShowQuery && (
          <button
            onClick={onShowQuery}
            disabled={!strategyId.trim() || isLoadingQuery || showValidationQuery}
            style={{
              padding: '10px 20px',
              background: (!strategyId.trim() || isLoadingQuery || showValidationQuery) ? '#94a3b8' : '#64748b',
              color: 'white', border: 'none', borderRadius: '8px',
              fontSize: '14px', fontWeight: '500',
              cursor: (!strategyId.trim() || isLoadingQuery || showValidationQuery) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}
          >
            {isLoadingQuery ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                  <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"/>
                </svg>
                Loading…
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
                Show Query
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );

  // Initial empty-state card — shown before the user has run a validation.
  // Same dashed-border placeholder used in Reco Table Metrics; reused across the
  // monthly validators so all four screens look identical when idle.
  const renderInitialState = (message) => (
    !validationResult && !validationError && !isValidating && (
      <div style={{ padding: '60px 40px', background: 'white', borderRadius: '12px', border: '2px dashed #e2e8f0', textAlign: 'center' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" style={{ marginBottom: '16px' }}>
          <path d="M9 11l3 3L22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
        <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>{message}</p>
      </div>
    )
  );

  // Inline dark SQL panel — reused by Reco Table Metrics, Monthly Forecast, Monthly Actuals.
  // All three share `validationQuery` / `showValidationQuery` state.
  const renderValidationQueryBlock = () => (
    showValidationQuery && validationQuery && (
      <div style={{ background: '#0f172a', borderRadius: '12px', padding: '16px 20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 600 }}>Generated SQL</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => { navigator.clipboard?.writeText(validationQuery); }}
              style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
            >
              Copy
            </button>
            <button
              onClick={() => setShowValidationQuery(false)}
              style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer' }}
            >
              Hide
            </button>
          </div>
        </div>
        <pre style={{ margin: 0, color: '#cbd5e1', fontSize: '11px', overflow: 'auto', maxHeight: '400px', fontFamily: 'ui-monospace, monospace' }}>{validationQuery}</pre>
      </div>
    )
  );

  const renderValidationError = () => validationError && (
    <div style={{
      padding: '16px 20px', background: '#fef2f2', border: '1px solid #fecaca',
      borderRadius: '10px', color: '#dc2626', fontSize: '14px',
      marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px',
    }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
      {validationError}
    </div>
  );

  // Render a back-button header
  const renderHeader = (title, tooltip) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
      <button
        onClick={handleBackToWorkbench}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '8px 12px', background: 'white',
          border: '1px solid #e2e8f0', borderRadius: '8px',
          cursor: 'pointer', fontSize: '13px', color: '#64748b',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back
      </button>
      <h2 style={{ margin: 0, color: '#1a1a2e', fontSize: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        {title}
        <InfoIcon tooltip={tooltip} />
      </h2>
    </div>
  );

  // Polished grouped-header results table (mirrors the reco validator's look).
  // columnGroups: [{ name, color, columns: [{ key, label, isMatch?, isStatus? }] }]
  // rows: result array from the validator API
  const renderResultsTable = (columnGroups, rows) => {
    if (!rows || rows.length === 0) {
      return (
        <div style={{
          padding: '24px', textAlign: 'center', color: '#94a3b8',
          background: 'white', borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}>
          No rows returned.
        </div>
      );
    }

    const allCols = columnGroups.flatMap(g => g.columns);
    const minWidth = Math.max(1200, allCols.length * 110);

    const matchCellColors = (v) => {
      const map = {
        MATCH:           { bg: '#f0fdf4', fg: '#16a34a' },
        MISMATCH:        { bg: '#fef2f2', fg: '#dc2626' },
        MISSING_STORED:  { bg: '#fef3c7', fg: '#92400e' },
        MISSING_CALC:    { bg: '#e0e7ff', fg: '#3730a3' },
        MISSING_BOTH:    { bg: '#f1f5f9', fg: '#64748b' },
        // Reco-grid-validator emits these legacy names; alias to the same colors
        // as their renamed counterparts.
        MISSING_OURS:    { bg: '#e0e7ff', fg: '#3730a3' },
        MISSING_GRID:    { bg: '#fef3c7', fg: '#92400e' },
      };
      const c = map[v];
      if (!c) return { background: 'transparent', color: '#94a3b8' };
      return { background: c.bg, color: c.fg, fontWeight: 600 };
    };

    const statusCellColors = (v) => {
      if (v === 'PRESENT') return { background: '#f0fdf4', color: '#16a34a', fontWeight: 600 };
      if (v === 'MISSING') return { background: '#fef3c7', color: '#92400e', fontWeight: 600 };
      return {};
    };

    return (
      <div style={{
        background: 'white', borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: '20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', gap: '12px' }}>
          <h3 style={{ margin: 0, color: '#1a1a2e', fontSize: '15px', fontWeight: 600 }}>
            Detailed Results ({rows.length} of {rows.length} rows)
          </h3>
        </div>

        <div style={{
          overflowX: 'auto', maxHeight: '600px', overflowY: 'auto',
          borderRadius: '8px', border: '1px solid #e2e8f0',
        }}>
          <table style={{
            borderCollapse: 'collapse', fontSize: '11px',
            width: '100%', minWidth: `${minWidth}px`,
          }}>
            <thead>
              {/* Group headers (colored bars) */}
              <tr>
                {columnGroups.map(g => (
                  <th
                    key={g.name}
                    colSpan={g.columns.length}
                    style={{ ...thGroupStyle, background: g.color, textAlign: 'left' }}
                  >
                    <span style={{ padding: '0 12px' }}>{g.name}</span>
                  </th>
                ))}
              </tr>
              {/* Column headers */}
              <tr style={{ background: '#f8fafc' }}>
                {allCols.map(c => (
                  <th key={c.key} style={thStyle}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  {allCols.map(c => {
                    const v = row[c.key];
                    if (c.isMatch) {
                      return (
                        <td key={c.key} style={{ ...tdStyle, ...matchCellColors(v), textAlign: 'center' }}>
                          {v || '—'}
                        </td>
                      );
                    }
                    if (c.isStatus) {
                      return (
                        <td key={c.key} style={{ ...tdStyle, ...statusCellColors(v), textAlign: 'center' }}>
                          {v || '—'}
                        </td>
                      );
                    }
                    if (c.isBool) {
                      // Match reco-validator pill styling: amber for true, muted grey for false.
                      const boolStyle = v == null
                        ? { color: '#94a3b8' }
                        : v
                          ? { color: '#d97706', background: '#fef3c7', fontWeight: 600 }
                          : { color: '#64748b' };
                      return (
                        <td key={c.key} style={{ ...tdStyle, ...boolStyle, textAlign: 'center' }}>
                          {v == null ? '—' : (v ? 'Yes' : 'No')}
                        </td>
                      );
                    }
                    if (typeof v === 'number' && Number.isFinite(v)) {
                      return (
                        <td key={c.key} style={tdStyle}>
                          {v.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                      );
                    }
                    return (
                      <td key={c.key} style={tdStyle}>{v == null ? '—' : String(v)}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Render a per-metric bucket summary (counts of each 5-state)
  const renderBucketSummary = (label, bucket) => (
    <div style={{
      padding: '10px 14px', background: '#f8fafc',
      borderRadius: '8px', border: '1px solid #e2e8f0',
    }}>
      <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 500, marginBottom: '6px' }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {['match', 'mismatch', 'missing_stored', 'missing_calc', 'missing_both'].map(k => (
          (bucket?.[k] ?? 0) > 0 && (
            <span key={k} style={matchPillStyle(k.toUpperCase())}>
              {k}: {bucket[k]}
            </span>
          )
        ))}
      </div>
    </div>
  );

  // =========================================================================
  // BP MONTHLY FORECAST VALIDATOR — validates bp_monthly_forecast
  // =========================================================================
  const renderMonthlyForecastValidator = () => {
    const result = validationResult;
    const rows = result?.results || [];

    // Filter to rows where any Current-side match is not 'MATCH' (default off)
    return (
      <div>
        {renderHeader(
          'Monthly Forecast Validator',
          'Validate bp_monthly_forecast — elasticity-based recompute vs stored, per (bin × month) with 5-state match'
        )}
        {renderStrategyInputBar(handleRunMonthlyForecastValidation, undefined, handleViewMonthlyForecastQuery)}
        {renderValidationQueryBlock()}
        {renderValidationError()}

        {result && result.success && (
          <>
            {/* Strategy heading + horizontal card strip — mirrors Reco Table Metrics Validator.
                Counts are derived row-by-row from the result set so the same code handles
                Current (all 6 metrics) and IA / Finalized (only Sales / Revenue / GM$ exist
                for those scenarios — missing fields naturally count as 0). */}
            <div style={{ background: 'white', borderRadius: '12px', padding: '20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <h3 style={{ margin: '0 0 16px 0', color: '#1a1a2e', fontSize: '15px' }}>
                Strategy #{result.strategy_id}{result.strategy_name && ` - ${result.strategy_name}`}
              </h3>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch', overflowX: 'auto', paddingBottom: '8px' }}>
                {/* Total Rows */}
                <div style={{ padding: '16px 24px', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center', minWidth: '100px', flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#1a1a2e' }}>{result.summary?.total_records ?? rows.length}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', fontWeight: '500' }}>Total Rows</div>
                </div>

                {/* Overall Pass/Fail */}
                <div style={{ padding: '16px 24px', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center', minWidth: '100px', flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: result.summary?.all_matched ? '#16a34a' : '#dc2626' }}>
                    {result.summary?.all_matched ? 'Pass' : 'Fail'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', fontWeight: '500' }}>Overall</div>
                </div>

                {/* Data Coverage — Stored / Calc presence */}
                <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', minWidth: '160px', flexShrink: 0 }}>
                  <div style={{ background: '#f0f9ff', padding: '8px 12px', borderBottom: '1px solid #bae6fd', fontSize: '12px', fontWeight: '600', color: '#0369a1' }}>Data Coverage</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                    <thead>
                      <tr style={{ background: '#f9fafb' }}>
                        <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '500', color: '#374151', borderBottom: '1px solid #e5e7eb' }}></th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Present</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Missing</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '6px 10px', color: '#374151' }}>Stored</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#0369a1' }}>{result.summary?.stored_status?.present ?? 0}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#0369a1' }}>{result.summary?.stored_status?.missing ?? 0}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '6px 10px', color: '#374151' }}>Calc</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#0369a1' }}>{result.summary?.calc_status?.present ?? 0}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#0369a1' }}>{result.summary?.calc_status?.missing ?? 0}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Metric cards — each metric gets Match (green) + Mismatch (red).
                    Scenarios use the backend's `curr` / `ia` / `final` prefixes; missing
                    columns (e.g. GM%/ASP/AUM in IA/Final) count as 0 naturally. */}
                {[
                  { title: 'Sales Units Match',     matchKey: 'sales',     isMatch: true,  color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Sales Units Mismatch',  matchKey: 'sales',     isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'Revenue Match',         matchKey: 'revenue',   isMatch: true,  color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Revenue Mismatch',      matchKey: 'revenue',   isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'GM$ Match',             matchKey: 'gm_dollar', isMatch: true,  color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'GM$ Mismatch',          matchKey: 'gm_dollar', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'GM% Match',             matchKey: 'gm_pct',    isMatch: true,  color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'GM% Mismatch',          matchKey: 'gm_pct',    isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'ASP Match',             matchKey: 'asp',       isMatch: true,  color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'ASP Mismatch',          matchKey: 'asp',       isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'AUM Match',             matchKey: 'aum',       isMatch: true,  color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'AUM Mismatch',          matchKey: 'aum',       isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                ].map((card, idx) => {
                  const total = rows.length || 1;
                  // Monthly Forecast uses `curr` / `ia` / `final` scenario prefixes.
                  const scenarios = [
                    { label: 'Current',   col: 'curr'  },
                    { label: 'IA',        col: 'ia'    },
                    { label: 'Finalized', col: 'final' },
                  ];
                  return (
                    <div key={idx} style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', minWidth: '180px', flexShrink: 0 }}>
                      <div style={{ background: card.bg, padding: '8px 12px', borderBottom: `1px solid ${card.border}`, fontSize: '12px', fontWeight: '600', color: card.color }}>
                        {card.title}
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead>
                          <tr style={{ background: '#f9fafb' }}>
                            <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '500', color: '#374151', borderBottom: '1px solid #e5e7eb' }}></th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Count</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scenarios.map(s => {
                            const colKey = `${s.col}_${card.matchKey}_match`;
                            const target = card.isMatch ? 'MATCH' : 'MISMATCH';
                            const count = rows.reduce((acc, r) => acc + (r[colKey] === target ? 1 : 0), 0);
                            const pct = ((count / total) * 100).toFixed(1);
                            return (
                              <tr key={s.col} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                <td style={{ padding: '6px 10px', color: '#374151' }}>{s.label}</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '500', color: card.color }}>{count}</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '500', color: card.color }}>{pct}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Results table — polished grouped-header layout (mirrors reco validator) */}
            {renderResultsTable([
              { name: 'Bin Identity', color: '#e2e8f0', columns: [
                { key: 'opt_level_bins', label: 'Bin' },
                { key: 'product_code',   label: 'Product' },
                { key: 'line_group',     label: 'Line Group' },
                { key: 'channel_name',   label: 'Channel' },
                { key: 'price_zone',     label: 'Price Zone' },
                { key: 'segment_name',   label: 'Segment' },
                { key: 'price_lock',     label: 'Price Lock',     isBool: true },
                { key: 'zone_exception', label: 'Zone Exception', isBool: true },
              ]},
              { name: 'Month', color: '#fde68a', columns: [
                { key: 'fiscal_year_label', label: 'FY' },
                { key: 'fiscal_month_name', label: 'Month' },
                { key: 'validation_type',   label: 'Type' },
              ]},
              { name: 'Status', color: '#fef3c7', columns: [
                { key: 'stored_status', label: 'Stored', isStatus: true },
                { key: 'calc_status',   label: 'Calc',   isStatus: true },
              ]},
              { name: 'Current', color: '#93c5fd', columns: [
                { key: 'stored_curr_sales_units', label: 'Sales Stored' },
                { key: 'calc_curr_sales_units',   label: 'Sales Calc' },
                { key: 'curr_sales_match',        label: 'Sales Match', isMatch: true },
                { key: 'stored_curr_revenue',     label: 'Revenue Stored' },
                { key: 'calc_curr_revenue',       label: 'Revenue Calc' },
                { key: 'curr_revenue_match',      label: 'Revenue Match', isMatch: true },
                { key: 'stored_curr_gm_dollar',   label: 'GM$ Stored' },
                { key: 'calc_curr_gm_dollar',     label: 'GM$ Calc' },
                { key: 'curr_gm_dollar_match',    label: 'GM$ Match', isMatch: true },
                { key: 'stored_curr_gm_pct',      label: 'GM% Stored' },
                { key: 'calc_curr_gm_pct',        label: 'GM% Calc' },
                { key: 'curr_gm_pct_match',       label: 'GM% Match', isMatch: true },
                { key: 'stored_curr_asp',         label: 'ASP Stored' },
                { key: 'calc_curr_asp',           label: 'ASP Calc' },
                { key: 'curr_asp_match',          label: 'ASP Match', isMatch: true },
                { key: 'stored_curr_aum',         label: 'AUM Stored' },
                { key: 'calc_curr_aum',           label: 'AUM Calc' },
                { key: 'curr_aum_match',          label: 'AUM Match', isMatch: true },
              ]},
              { name: 'IA', color: '#86efac', columns: [
                { key: 'stored_ia_sales_units', label: 'Sales Stored' },
                { key: 'calc_ia_sales_units',   label: 'Sales Calc' },
                { key: 'ia_sales_match',        label: 'Sales Match', isMatch: true },
                { key: 'stored_ia_revenue',     label: 'Revenue Stored' },
                { key: 'calc_ia_revenue',       label: 'Revenue Calc' },
                { key: 'ia_revenue_match',      label: 'Revenue Match', isMatch: true },
                { key: 'stored_ia_gm_dollar',   label: 'GM$ Stored' },
                { key: 'calc_ia_gm_dollar',     label: 'GM$ Calc' },
                { key: 'ia_gm_dollar_match',    label: 'GM$ Match', isMatch: true },
              ]},
              { name: 'Finalized', color: '#fca5a5', columns: [
                { key: 'stored_final_sales_units', label: 'Sales Stored' },
                { key: 'calc_final_sales_units',   label: 'Sales Calc' },
                { key: 'final_sales_match',        label: 'Sales Match', isMatch: true },
                { key: 'stored_final_revenue',     label: 'Revenue Stored' },
                { key: 'calc_final_revenue',       label: 'Revenue Calc' },
                { key: 'final_revenue_match',      label: 'Revenue Match', isMatch: true },
                { key: 'stored_final_gm_dollar',   label: 'GM$ Stored' },
                { key: 'calc_final_gm_dollar',     label: 'GM$ Calc' },
                { key: 'final_gm_dollar_match',    label: 'GM$ Match', isMatch: true },
              ]},
            ], rows)}
          </>
        )}

        {renderInitialState('Enter a strategy ID and click "Validate" to recompute bp_monthly_forecast metrics per (bin × month)')}
      </div>
    );
  };

  // =========================================================================
  // BP MONTHLY FORECAST ACTUALS VALIDATOR — validates bp_monthly_forecast_actuals
  // =========================================================================
  const renderMonthlyActualsValidator = () => {
    const result = validationResult;
    const rows = result?.results || [];

    return (
      <div>
        {renderHeader(
          'Monthly Forecast Actuals Validator',
          'Validate bp_monthly_forecast_actuals — recompute from transaction tables vs stored, per (bin × month)'
        )}
        {renderStrategyInputBar(handleRunMonthlyActualsValidation, undefined, handleViewMonthlyActualsQuery)}
        {renderValidationQueryBlock()}
        {renderValidationError()}

        {result && result.success && (
          <>
            {/* Strategy heading + horizontal card strip — mirrors the Reco /
                Monthly Forecast validator layouts. Actuals is a single scenario
                so each metric card has one "Actuals" row instead of three. */}
            <div style={{ background: 'white', borderRadius: '12px', padding: '20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <h3 style={{ margin: '0 0 16px 0', color: '#1a1a2e', fontSize: '15px' }}>
                Strategy #{result.strategy_id}{result.strategy_name && ` - ${result.strategy_name}`}
              </h3>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch', overflowX: 'auto', paddingBottom: '8px' }}>
                {/* Total Rows */}
                <div style={{ padding: '16px 24px', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center', minWidth: '100px', flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#1a1a2e' }}>{result.summary?.total_records ?? rows.length}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', fontWeight: '500' }}>Total Rows</div>
                </div>

                {/* Overall Pass/Fail */}
                <div style={{ padding: '16px 24px', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center', minWidth: '100px', flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: result.summary?.all_matched ? '#16a34a' : '#dc2626' }}>
                    {result.summary?.all_matched ? 'Pass' : 'Fail'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px', fontWeight: '500' }}>Overall</div>
                </div>

                {/* Data Coverage — Stored / Calc presence */}
                <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', minWidth: '160px', flexShrink: 0 }}>
                  <div style={{ background: '#f0f9ff', padding: '8px 12px', borderBottom: '1px solid #bae6fd', fontSize: '12px', fontWeight: '600', color: '#0369a1' }}>Data Coverage</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                    <thead>
                      <tr style={{ background: '#f9fafb' }}>
                        <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '500', color: '#374151', borderBottom: '1px solid #e5e7eb' }}></th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Present</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Missing</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '6px 10px', color: '#374151' }}>Stored</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#0369a1' }}>{result.summary?.stored_status?.present ?? 0}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#0369a1' }}>{result.summary?.stored_status?.missing ?? 0}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '6px 10px', color: '#374151' }}>Calc</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#0369a1' }}>{result.summary?.calc_status?.present ?? 0}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#0369a1' }}>{result.summary?.calc_status?.missing ?? 0}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Metric cards — each metric gets Match (green) + Mismatch (red).
                    Actuals is a single scenario; column name is `<metric>_match`
                    (no `curr_` / `ia_` / `final_` prefix). */}
                {[
                  { title: 'Sales Units Match',    matchKey: 'sales',     isMatch: true,  color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Sales Units Mismatch', matchKey: 'sales',     isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'Revenue Match',        matchKey: 'revenue',   isMatch: true,  color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'Revenue Mismatch',     matchKey: 'revenue',   isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'GM$ Match',            matchKey: 'gm_dollar', isMatch: true,  color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'GM$ Mismatch',         matchKey: 'gm_dollar', isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'GM% Match',            matchKey: 'gm_pct',    isMatch: true,  color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'GM% Mismatch',         matchKey: 'gm_pct',    isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'ASP Match',            matchKey: 'asp',       isMatch: true,  color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'ASP Mismatch',         matchKey: 'asp',       isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                  { title: 'AUM Match',            matchKey: 'aum',       isMatch: true,  color: '#166534', bg: '#dcfce7', border: '#86efac' },
                  { title: 'AUM Mismatch',         matchKey: 'aum',       isMatch: false, color: '#991b1b', bg: '#fef2f2', border: '#fecaca' },
                ].map((card, idx) => {
                  const total = rows.length || 1;
                  const colKey = `${card.matchKey}_match`;
                  const target = card.isMatch ? 'MATCH' : 'MISMATCH';
                  const count = rows.reduce((acc, r) => acc + (r[colKey] === target ? 1 : 0), 0);
                  const pct = ((count / total) * 100).toFixed(1);
                  return (
                    <div key={idx} style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', minWidth: '160px', flexShrink: 0 }}>
                      <div style={{ background: card.bg, padding: '8px 12px', borderBottom: `1px solid ${card.border}`, fontSize: '12px', fontWeight: '600', color: card.color }}>
                        {card.title}
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead>
                          <tr style={{ background: '#f9fafb' }}>
                            <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '500', color: '#374151', borderBottom: '1px solid #e5e7eb' }}></th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>Count</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '600', color: '#374151', borderBottom: '1px solid #e5e7eb' }}>%</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td style={{ padding: '6px 10px', color: '#374151' }}>Actuals</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '500', color: card.color }}>{count}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: '500', color: card.color }}>{pct}%</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Results table — polished grouped-header layout (mirrors reco validator) */}
            {renderResultsTable([
              { name: 'Bin Identity', color: '#e2e8f0', columns: [
                { key: 'opt_level_bins', label: 'Bin' },
                { key: 'product_code', label: 'Product' },
                { key: 'line_group',   label: 'Line Group' },
                { key: 'channel_name', label: 'Channel' },
                { key: 'price_zone',   label: 'Price Zone' },
                { key: 'segment_name', label: 'Segment' },
                { key: 'price_lock',     label: 'Price Lock',     isBool: true },
                { key: 'zone_exception', label: 'Zone Exception', isBool: true },
              ]},
              { name: 'Month', color: '#fde68a', columns: [
                { key: 'fiscal_year',       label: 'FY' },
                { key: 'fiscal_month_name', label: 'Month' },
                { key: 'calc_coverage',     label: 'Coverage' },
              ]},
              { name: 'Status', color: '#fef3c7', columns: [
                { key: 'stored_status',  label: 'Stored',         isStatus: true },
                { key: 'calc_status',    label: 'Calc',           isStatus: true },
                { key: 'coverage_match', label: 'Coverage Match', isMatch: true },
              ]},
              { name: 'Actuals (Calculated vs Stored)', color: '#f9a8d4', columns: [
                { key: 'stored_sales_units', label: 'Sales Stored' },
                { key: 'calc_sales_units',   label: 'Sales Calc' },
                { key: 'sales_match',        label: 'Sales Match', isMatch: true },
                { key: 'stored_revenue',     label: 'Revenue Stored' },
                { key: 'calc_revenue',       label: 'Revenue Calc' },
                { key: 'revenue_match',      label: 'Revenue Match', isMatch: true },
                { key: 'stored_gm_dollar',   label: 'GM$ Stored' },
                { key: 'calc_gm_dollar',     label: 'GM$ Calc' },
                { key: 'gm_dollar_match',    label: 'GM$ Match', isMatch: true },
                { key: 'stored_gm_pct',      label: 'GM% Stored' },
                { key: 'calc_gm_pct',        label: 'GM% Calc' },
                { key: 'gm_pct_match',       label: 'GM% Match', isMatch: true },
                { key: 'stored_asp',         label: 'ASP Stored' },
                { key: 'calc_asp',           label: 'ASP Calc' },
                { key: 'asp_match',          label: 'ASP Match', isMatch: true },
                { key: 'stored_aum',         label: 'AUM Stored' },
                { key: 'calc_aum',           label: 'AUM Calc' },
                { key: 'aum_match',          label: 'AUM Match', isMatch: true },
                { key: 'stores_with_data',   label: 'Stores w/ data' },
              ]},
            ], rows)}
          </>
        )}

        {renderInitialState('Enter a strategy ID and click "Validate" to recompute bp_monthly_forecast_actuals from the transaction tables per (bin × month)')}
      </div>
    );
  };

  // Table styles
  const thGroupStyle = {
    padding: '8px 12px',
    textAlign: 'center',
    fontWeight: '600',
    color: '#1e293b',
    fontSize: '12px',
    borderBottom: '2px solid #e2e8f0'
  };
  
  // Content density padding values
  const densityPadding = {
    default: '10px 8px',
    compact: '4px 6px',
    comfort: '14px 12px'
  };
  
  const thStyle = {
    padding: densityPadding[contentDensity],
    textAlign: 'left',
    fontWeight: '600',
    color: '#475569',
    borderBottom: '2px solid #e2e8f0',
    whiteSpace: 'nowrap',
    minWidth: '80px'
  };
  
  const tdStyle = {
    padding: densityPadding[contentDensity],
    color: '#1a1a2e',
    whiteSpace: 'nowrap'
  };
  
  // Dynamic cell style based on wrap setting
  const getCellStyle = (colKey, baseStyle = {}) => ({
    ...baseStyle,
    padding: densityPadding[contentDensity],
    color: baseStyle.color || '#1a1a2e',
    whiteSpace: wrapText ? 'normal' : 'nowrap',
    wordBreak: wrapText ? 'break-word' : 'normal',
    maxWidth: wrapText ? '200px' : 'none',
    minWidth: wrapText ? '100px' : 'auto'
  });
  
  const matchCellStyle = (value, colKey) => ({
    padding: densityPadding[contentDensity],
    fontWeight: '600',
    color: value === 'MATCH' ? '#16a34a' : '#dc2626',
    background: value === 'MATCH' ? '#f0fdf4' : '#fef2f2',
    whiteSpace: wrapText ? 'normal' : 'nowrap',
    wordBreak: wrapText ? 'break-word' : 'normal'
  });
  
  const boolCellStyle = (value, colKey) => ({
    padding: densityPadding[contentDensity],
    fontWeight: '500',
    color: value ? '#d97706' : '#64748b',
    background: value ? '#fef3c7' : 'transparent',
    whiteSpace: wrapText ? 'normal' : 'nowrap',
    wordBreak: wrapText ? 'break-word' : 'normal'
  });

  return (
    <div style={{ width: '100%' }}>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      {renderContent()}
    </div>
  );
}

// Helper Components
const StatCard = ({ title, value, color, bgColor }) => (
  <div style={{ 
    background: 'white', 
    borderRadius: '12px', 
    padding: '20px', 
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)' 
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{ 
        width: '40px', 
        height: '40px', 
        background: bgColor, 
        borderRadius: '10px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center' 
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>
      <div>
        <div style={{ fontSize: '24px', fontWeight: '700', color: '#1a1a2e' }}>{value}</div>
        <div style={{ fontSize: '13px', color: '#64748b' }}>{title}</div>
      </div>
    </div>
  </div>
);

const PlaceholderCard = ({ icon, title, description }) => (
  <div style={{ 
    textAlign: 'center', 
    padding: '60px 20px', 
    color: '#64748b',
    background: 'white',
    borderRadius: '12px',
    border: '2px dashed #e2e8f0'
  }}>
    <div style={{ marginBottom: '16px' }}>{icon}</div>
    <h3 style={{ margin: '0 0 8px 0', color: '#475569' }}>{title}</h3>
    <p style={{ margin: 0, fontSize: '14px' }}>{description}</p>
  </div>
);

export default DataValidatorPage;
