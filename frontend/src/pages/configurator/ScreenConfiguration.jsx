import React, { useState, useEffect } from 'react';
import { MdFilterList, MdSettings, MdCheckCircle, MdWarning, MdRefresh } from 'react-icons/md';
import { api } from '../../api';
import ScreenEditor from './ScreenEditor';
import RegeneratePreviewModal from './RegeneratePreviewModal';

// Screen ID to Screen Name to FE Display Name mapping
// ID | DB Screen Name                  | FE Display Name
// ---|--------------------------------|---------------------------
// 0  | STORE_CONFIGURATION            | Store Group Filter
// 1  | PRODUCT_CONFIGURATION          | Product Group Filter
// 2  | ZONE_MAPPING                   | Zone Mapping
// 3  | PRODUCT_DETAILS                | Product Details
// 4  | STORE_DETAILS                  | Store Details
// 5  | PRODUCT_STORE_DETAILS_MANUAL   | Product Store Details
// 6  | RULE_LISTING                   | Rules
// 7  | RULES_PRODUCT_SCREEN           | Rules Creation Product Screen
// 8  | RULES_STORE_SCREEN             | Rules Creation Store Screen
// 9  | STRATEGY_PRODUCT_SCREEN        | Strategy Creation Product Screen
// 10 | STRATEGY_STORE_SCREEN          | Strategy Creation Store Screen
// 11 | WORKBENCH                      | Workbench
// 12 | PRODUCT_GROUP_CONFIGURATION    | Product Group Creation
// 13 | STORE_GROUP_CONFIGURATION      | Store Group Creation
// 14 | EXCEPTION_REPORT               | Exception Report
// 15 | COMPETITOR_POSITIONING         | Competitor Positioning
// 16 | DECISION_DASHBOARD             | Decision Dashboard
// 17 | SEGMENT_SCREEN                 | Segment Screen
// 19 | COMPETITOR_MAPPING             | Competitor Mapping
// 20 | PRICE_CHANGE_DRIVERS           | Price Change Drivers
// 21 | RULES_STORE_SCREEN_CROSS_ZONE  | Cross Zone Rule Store Screen

const SCREEN_FRIENDLY_NAMES = {
  0: 'Store Group Filter',
  1: 'Product Group Filter',
  2: 'Zone Mapping',
  3: 'Product Details',
  4: 'Store Details',
  5: 'Product Store Details',
  6: 'Rules',
  7: 'Rules Creation Product Screen',
  8: 'Rules Creation Store Screen',
  9: 'Strategy Creation Product Screen',
  10: 'Strategy Creation Store Screen',
  11: 'Workbench',
  12: 'Product Group Creation',
  13: 'Store Group Creation',
  14: 'Exception Report',
  15: 'Competitor Positioning',
  16: 'Decision Dashboard',
  17: 'Segment Screen',
  19: 'Competitor Mapping',
  20: 'Price Change Drivers',
  21: 'Cross Zone Rule Store Screen'
};

// Screen groupings (order preserved)
const SCREEN_GROUPS = [
  { name: 'Details Screen', screenIds: [3, 4, 5] },
  { name: 'Configuration', screenIds: [1, 12, 0, 13, 2] },
  { name: 'Competitor Configuration', screenIds: [19] },
  { name: 'Rules', screenIds: [6, 7, 8, 21] },
  { name: 'Strategy', screenIds: [11, 9, 10] },
  { name: 'Reports', screenIds: [14, 15, 20] },
  { name: 'Decision Dashboard', screenIds: [16] },
  { name: 'Segment', screenIds: [17] }
];

function ScreenConfiguration() {
  const [screens, setScreens] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedScreen, setSelectedScreen] = useState(null);
  const [initializing, setInitializing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regeneratePreview, setRegeneratePreview] = useState(null); // For preview modal
  const [savingAll, setSavingAll] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [schema, setSchema] = useState('base_pricing'); // Default schema

  useEffect(() => {
    fetchScreens();
  }, []);

  const fetchScreens = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch connection status to get schema
      const connectionStatus = await api.getConnectionStatus();
      if (connectionStatus.data.schema) {
        setSchema(connectionStatus.data.schema);
      }
      
      // Fetch status first
      const statusResponse = await api.checkScreensStatus();
      setStatus(statusResponse.data);
      
      // Then fetch screens
      const response = await api.getScreens();
      if (response.data.success) {
        // Merge validation issues into screens
        const screensData = response.data.data;
        if (statusResponse.data.validation_issues) {
          const issuesMap = {};
          statusResponse.data.validation_issues.forEach(vi => {
            issuesMap[vi.screen_id] = vi.issues;
          });
          screensData.forEach(screen => {
            screen.validation_issues = issuesMap[screen.screen_id] || [];
          });
        }
        setScreens(screensData);
      }
    } catch (err) {
      setError('Failed to load screens: ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleInitializeAll = async () => {
    if (!window.confirm('This will create default configurations for ALL screens based on current hierarchy levels. Continue?')) {
      return;
    }
    
    setInitializing(true);
    setError(null);
    try {
      const response = await api.initializeAllScreens();
      if (response.data.success) {
        setSuccessMessage(`Initialized ${response.data.created} screens!`);
        setTimeout(() => setSuccessMessage(''), 3000);
        await fetchScreens();
      }
    } catch (err) {
      setError('Failed to initialize: ' + (err.response?.data?.detail || err.message));
    } finally {
      setInitializing(false);
    }
  };

  const handleRegenerateAll = async () => {
    setRegenerating(true);
    setError(null);
    try {
      // First, preview the changes (doesn't save)
      const previewResponse = await api.previewAllScreensRegeneration();
      if (previewResponse.data.success) {
        // Show preview modal with all the data
        setRegeneratePreview(previewResponse.data);
      }
    } catch (err) {
      setError('Failed to generate preview: ' + (err.response?.data?.detail || err.message));
    } finally {
      setRegenerating(false);
    }
  };

  const handleSaveAllRegenerated = async () => {
    setSavingAll(true);
    setError(null);
    try {
      const saveResponse = await api.regenerateAllScreens();
      if (saveResponse.data.success) {
        setSuccessMessage(`Saved ${saveResponse.data.regenerated} screens!`);
        setTimeout(() => setSuccessMessage(''), 3000);
        setRegeneratePreview(null);
        await fetchScreens();
      }
    } catch (err) {
      setError('Failed to save: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSavingAll(false);
    }
  };

  const handleDiscardRegenerate = () => {
    setRegeneratePreview(null);
    setSuccessMessage('Changes discarded - no screens were modified.');
    setTimeout(() => setSuccessMessage(''), 3000);
  };

  const handleScreenClick = (screen) => {
    setSelectedScreen(screen);
    // TODO: Open filter configuration panel (layout to be discussed later)
  };

  // Count filters for a screen
  const countFilters = (screen) => {
    let count = 0;
    const filters = screen.allowed_filters || {};
    count += Object.keys(filters).length; // product_filter, store_filter
    if (screen.segment_filter_allowed) count++;
    if (screen.rule_filter_allowed) count++;
    if (screen.strategy_filter_allowed) count++;
    return count;
  };

  // Get filter badges for display
  const getFilterBadges = (screen) => {
    const badges = [];
    const filters = screen.allowed_filters || {};
    if (filters.product_filter) badges.push({ type: 'product', label: 'Product' });
    if (filters.store_filter) badges.push({ type: 'store', label: 'Store' });
    if (screen.segment_filter_allowed) badges.push({ type: 'segment', label: 'Segment' });
    if (screen.rule_filter_allowed) badges.push({ type: 'rule', label: 'Rule' });
    if (screen.strategy_filter_allowed) badges.push({ type: 'strategy', label: 'Strategy' });
    return badges;
  };

  // Styles
  const containerStyle = {
    padding: '0'
  };

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px'
  };

  const titleStyle = {
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
    color: '#1a1a2e'
  };

  const subtitleStyle = {
    fontSize: '13px',
    color: '#6b7280',
    margin: '4px 0 0 0'
  };

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '16px'
  };

  const cardStyle = (screen) => {
    const hasIssues = screen.validation_issues && screen.validation_issues.length > 0;
    const isConfigured = screen.has_db_config;
    
    return {
      background: '#fff',
      borderRadius: '12px',
      border: hasIssues ? '1px solid #f59e0b' : '1px solid #e5e7eb',
      padding: '20px',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      position: 'relative',
      overflow: 'hidden'
    };
  };

  const cardHeaderStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '12px'
  };

  const screenIdBadgeStyle = {
    background: '#f3f4f6',
    color: '#6b7280',
    fontSize: '11px',
    fontWeight: '600',
    padding: '4px 8px',
    borderRadius: '4px'
  };

  const statusBadgeStyle = (isConfigured, hasIssues) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '11px',
    fontWeight: '500',
    padding: '4px 8px',
    borderRadius: '4px',
    background: hasIssues ? '#fef3c7' : (isConfigured ? '#d1fae5' : '#f3f4f6'),
    color: hasIssues ? '#92400e' : (isConfigured ? '#059669' : '#6b7280')
  });

  const friendlyNameStyle = {
    fontSize: '15px',
    fontWeight: '600',
    color: '#1a1a2e',
    margin: '0 0 4px 0',
    lineHeight: '1.3'
  };

  const screenNameStyle = {
    fontSize: '12px',
    color: '#9ca3af',
    fontStyle: 'italic',
    margin: 0
  };

  const filterBadgesContainerStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginTop: '16px'
  };

  const filterBadgeStyle = (type) => {
    const colors = {
      product: { bg: '#eff6ff', color: '#2563eb' },
      store: { bg: '#fef3c7', color: '#d97706' },
      segment: { bg: '#f3e8ff', color: '#7c3aed' },
      rule: { bg: '#fee2e2', color: '#dc2626' },
      strategy: { bg: '#d1fae5', color: '#059669' }
    };
    const colorSet = colors[type] || { bg: '#f3f4f6', color: '#6b7280' };
    return {
      fontSize: '11px',
      fontWeight: '500',
      padding: '4px 10px',
      borderRadius: '12px',
      background: colorSet.bg,
      color: colorSet.color
    };
  };

  const filterCountStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '12px',
    fontSize: '12px',
    color: '#6b7280'
  };

  const initBannerStyle = {
    background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    border: '1px solid #e2e8f0'
  };

  const initButtonStyle = {
    background: '#264CD7',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  };

  const errorStyle = {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#dc2626',
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '14px'
  };

  const successStyle = {
    background: '#d1fae5',
    border: '1px solid #a7f3d0',
    color: '#059669',
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ color: '#6b7280' }}>Loading screens...</div>
      </div>
    );
  }

  const needsInit = status?.needs_initialization;
  const configuredCount = status?.configured_count || 0;
  const totalScreens = status?.total_screens || screens.length;

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div>
          <h3 style={titleStyle}>Screen Filter Configuration</h3>
          <p style={subtitleStyle}>
            {configuredCount} of {totalScreens} screens configured • {schema}.bp_screen_hierarchies
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={fetchScreens}
            style={{
              background: 'transparent',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              padding: '8px 12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              color: '#6b7280'
            }}
          >
            <MdRefresh size={16} />
            Refresh
          </button>
          <button
            onClick={handleRegenerateAll}
            disabled={regenerating}
            style={{
              background: '#264CD7',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 16px',
              cursor: regenerating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              color: '#fff',
              fontWeight: '500',
              opacity: regenerating ? 0.7 : 1
            }}
          >
            <MdRefresh size={16} />
            {regenerating ? 'Regenerating...' : 'Regenerate All'}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && <div style={errorStyle}>{error}</div>}

      {/* Success Message */}
      {successMessage && (
        <div style={successStyle}>
          <MdCheckCircle size={18} />
          {successMessage}
        </div>
      )}

      {/* Initialization Banner */}
      {needsInit && (
        <div style={initBannerStyle}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: '#264CD7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: '24px'
          }}>
            ⚡
          </div>
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: '600', color: '#1a1a2e' }}>
              No Screen Configurations Found
            </h4>
            <p style={{ margin: 0, fontSize: '13px', color: '#6b7280' }}>
              Initialize all screens with default filter configurations based on your hierarchy levels.
            </p>
          </div>
          <button
            style={initButtonStyle}
            onClick={handleInitializeAll}
            disabled={initializing}
          >
            <MdSettings size={18} />
            {initializing ? 'Initializing...' : 'Initialize All'}
          </button>
        </div>
      )}

      {/* Screen Groups */}
      {SCREEN_GROUPS.map(group => {
        // Get screens in this group
        const groupScreens = group.screenIds
          .map(id => screens.find(s => s.screen_id === id))
          .filter(Boolean);
        
        if (groupScreens.length === 0) return null;
        
        return (
          <div key={group.name} style={{ marginBottom: '28px' }}>
            {/* Group Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '12px',
              paddingBottom: '8px',
              borderBottom: '1px solid #e5e7eb'
            }}>
              <h4 style={{
                margin: 0,
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151'
              }}>
                {group.name}
              </h4>
              <span style={{
                fontSize: '12px',
                color: '#9ca3af',
                background: '#f3f4f6',
                padding: '2px 8px',
                borderRadius: '10px'
              }}>
                {groupScreens.length} screen{groupScreens.length !== 1 ? 's' : ''}
              </span>
            </div>
            
            {/* Group Grid */}
            <div style={gridStyle}>
              {groupScreens.map(screen => {
                const hasIssues = screen.validation_issues && screen.validation_issues.length > 0;
                const isConfigured = screen.has_db_config;
                const friendlyName = SCREEN_FRIENDLY_NAMES[screen.screen_id] || screen.screen_name.replace(/_/g, ' ');
                const badges = getFilterBadges(screen);
                
                return (
                  <div
                    key={screen.screen_id}
                    style={cardStyle(screen)}
                    onClick={() => handleScreenClick(screen)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
                    }}
                  >
                    {/* Card Header with ID and Status */}
                    <div style={cardHeaderStyle}>
                      <span style={screenIdBadgeStyle}>ID: {screen.screen_id}</span>
                      <span style={statusBadgeStyle(isConfigured, hasIssues)}>
                        {hasIssues ? (
                          <>
                            <MdWarning size={12} />
                            Mismatch
                          </>
                        ) : isConfigured ? (
                          <>
                            <MdCheckCircle size={12} />
                            Configured
                          </>
                        ) : (
                          'Not Set'
                        )}
                      </span>
                    </div>

                    {/* Screen Name */}
                    <h4 style={friendlyNameStyle}>{friendlyName}</h4>
                    <p style={screenNameStyle}>{screen.screen_name}</p>

                    {/* Filter Count */}
                    <div style={filterCountStyle}>
                      <MdFilterList size={14} />
                      <span>{countFilters(screen)} filter types available</span>
                    </div>

                    {/* Filter Type Badges */}
                    <div style={filterBadgesContainerStyle}>
                      {badges.map((badge, idx) => (
                        <span key={idx} style={filterBadgeStyle(badge.type)}>
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Screen Editor Modal */}
      {selectedScreen && (
        <ScreenEditor
          screen={selectedScreen}
          onClose={() => setSelectedScreen(null)}
          onSave={() => {
            fetchScreens();
            setSuccessMessage('Screen configuration saved!');
            setTimeout(() => setSuccessMessage(''), 3000);
          }}
        />
      )}

      {/* Regenerate All Preview Modal */}
      {regeneratePreview && (
        <RegeneratePreviewModal
          previewData={regeneratePreview}
          onSave={handleSaveAllRegenerated}
          onDiscard={handleDiscardRegenerate}
          saving={savingAll}
        />
      )}
    </div>
  );
}

export default ScreenConfiguration;
