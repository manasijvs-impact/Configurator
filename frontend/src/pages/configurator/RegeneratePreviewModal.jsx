import React, { useState, useEffect } from 'react';
import { MdClose, MdSave, MdCheckCircle, MdExpandMore, MdExpandLess, MdFilterList, MdCheck, MdEdit, MdDelete, MdAdd, MdDragIndicator } from 'react-icons/md';
import { api } from '../../api';

// Fix colValue for special filters that might have old "col_value" stored
const COLVALUE_FIX = {
  'product_group_ids': 'product_group_ids',
  'store_group_ids': 'store_group_ids',
  'segment_ids': 'segment_ids',
  'date_range': 'date_range',
  'strategy_status_display_name': 'strategy_status_display_name',
  'strategy_name': 'strategy_name',
  'filter_name': 'filter_name',
  'strategy_status': 'strategy_status',
  'rule_name': 'rule_name',
  'rule_status': 'rule_status',
  'rule_type_ids': 'rule_type_ids',
  'rule_ids': 'rule_ids'
};

// Default filterLabel for special filters that might be missing it
const FILTER_LABEL_FIX = {
  'date_range': 'Date Range',
  'strategy_status_display_name': 'Approval Status',
  'strategy_status': 'Approval Status',
  'strategy_name': 'Strategy Name',
  'rule_type_ids': 'Rule Type',
  'rule_ids': 'Rule Name',
  'product_group_ids': 'Product Group',
  'store_group_ids': 'Store Group',
  'segment_ids': 'Customer Segment'
};

// Normalize colValue and filterLabel for known filter types
const normalizeColValues = (hierarchies) => {
  if (!hierarchies) return hierarchies;
  const fixed = JSON.parse(JSON.stringify(hierarchies));
  
  Object.keys(fixed).forEach(filterBlock => {
    Object.keys(fixed[filterBlock] || {}).forEach(section => {
      const filters = fixed[filterBlock][section] || [];
      filters.forEach(filter => {
        // Fix colValue
        if (COLVALUE_FIX[filter.filterId]) {
          filter.colValue = COLVALUE_FIX[filter.filterId];
        }
        // Fix filterLabel if missing
        if (!filter.filterLabel && FILTER_LABEL_FIX[filter.filterId]) {
          filter.filterLabel = FILTER_LABEL_FIX[filter.filterId];
        }
      });
    });
  });
  
  return fixed;
};

// Screen friendly names
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

// Get hierarchy level display
const getHierarchyLevel = (filterId) => {
  if (!filterId) return '-';
  const match = filterId.match(/^([ls])(\d+)_ids$/);
  if (match) {
    return `${match[1].toUpperCase()}${match[2]}`;
  }
  if (filterId === 'product_attribute_names') return 'PA';
  if (filterId === 'structure_name') return 'ZS';
  if (filterId === 'product_group_ids') return 'PG';
  if (filterId === 'store_group_ids') return 'SG';
  if (filterId === 'segment_ids') return 'SEG';
  return '-';
};

// Special filter templates
const SPECIAL_FILTERS = {
  product_attribute_names: {
    filterId: 'product_attribute_names',
    filterLabel: 'Product attribute',
    colValue: 'product_attribute_names',
    isMulti: true,
    isMandatory: false,
    selectOnLoad: false,
    filterType: 'dropdown',
    apiEndpoint: 'product/attributes/filters',
    limit: 10,
    isMultiAttributes: true,
    children_template: {
      isMulti: true,
      selection: null,
      filterType: 'dropdown',
      apiEndpoint: 'product/attributes/filters',
      isMandatory: false,
      selectOnLoad: false
    }
  },
  structure_name: {
    filterId: 'structure_name',
    filterLabel: 'Zone Structure',
    colValue: 'structure_name',
    isMulti: true,
    isMandatory: false,
    selectOnLoad: false,
    filterType: 'dropdown',
    apiEndpoint: 'store/attributes/filters',
    limit: 10,
    isMultiAttributes: true,
    children_template: {
      isMulti: true,
      selection: null,
      filterType: 'dropdown',
      apiEndpoint: 'store/attributes/filters',
      isMandatory: false,
      selectOnLoad: false
    }
  },
  product_group_ids: {
    filterId: 'product_group_ids',
    filterLabel: 'Product Group',
    colValue: 'product_group_ids',
    isMulti: true,
    isMandatory: true,
    selectOnLoad: false,
    filterType: 'dropdown',
    apiEndpoint: 'filters'
  },
  store_group_ids: {
    filterId: 'store_group_ids',
    filterLabel: 'Store Group Code',
    colValue: 'store_group_ids',
    isMulti: true,
    isMandatory: true,
    selectOnLoad: false,
    filterType: 'dropdown',
    apiEndpoint: 'filters'
  },
  segment_ids: {
    filterId: 'segment_ids',
    filterLabel: 'Customer Segment',
    colValue: 'segment_ids',
    method: 'POST',
    isMulti: true,
    isMandatory: true,
    selectOnLoad: true,
    filterType: 'dropdown',
    apiEndpoint: 'segments',
    selection: 'All'
  }
};

function RegeneratePreviewModal({ previewData, onSave, onDiscard, saving }) {
  const [selectedScreen, setSelectedScreen] = useState(null);
  const [editedScreens, setEditedScreens] = useState({}); // Track edits per screen
  const [savedScreens, setSavedScreens] = useState({}); // Track which screens are saved
  const [savingScreen, setSavingScreen] = useState(null); // Currently saving screen ID
  const [availableLevels, setAvailableLevels] = useState({ product: [], store: [] });
  const [screenAllowances, setScreenAllowances] = useState({}); // Allowed filters per screen
  const [showAddMenu, setShowAddMenu] = useState(null); // { screenId, filterPath }
  const [dragState, setDragState] = useState({ screenId: null, filterPath: null, index: null });
  const [showJson, setShowJson] = useState(false); // Toggle JSON view for selected screen

  // Load available hierarchy levels and screen allowances on mount
  useEffect(() => {
    loadAvailableLevels();
    loadScreenAllowances();
  }, []);

  const loadScreenAllowances = async () => {
    try {
      const res = await api.getScreenAllowances();
      const allowancesMap = {};
      (res.data.data || []).forEach(a => {
        allowancesMap[a.screen_id] = a;
      });
      setScreenAllowances(allowancesMap);
    } catch (err) {
      console.error('Failed to load screen allowances:', err);
    }
  };

  const loadAvailableLevels = async () => {
    try {
      const [productRes, storeRes] = await Promise.all([
        api.getProductHierarchy(),
        api.getStoreHierarchy()
      ]);
      
      const productLevels = (productRes.data.data || []).map(l => ({
        filterId: `l${l.product_hierarchy_level_id}_ids`,
        filterLabel: l.product_hierarchy_level_value,
        colValue: l.product_hierarchy_level_label,
        isMulti: true,
        isMandatory: l.product_hierarchy_level_id < 2,
        selectOnLoad: l.product_hierarchy_level_id < 2,
        filterType: 'dropdown',
        apiEndpoint: 'filters',
        selection: l.product_hierarchy_level_id < 2 ? 'All' : null
      }));
      
      const storeLevels = (storeRes.data.data || []).map(l => ({
        filterId: `s${l.store_hierarchy_level_id}_ids`,
        filterLabel: l.store_hierarchy_level_value,
        colValue: l.store_hierarchy_level_label,
        isMulti: true,
        isMandatory: l.store_hierarchy_level_id < 2,
        selectOnLoad: l.store_hierarchy_level_id < 2,
        filterType: 'dropdown',
        apiEndpoint: 'filters',
        selection: l.store_hierarchy_level_id < 2 ? 'All' : null
      }));
      
      setAvailableLevels({ product: productLevels, store: storeLevels });
    } catch (err) {
      console.error('Failed to load hierarchy levels:', err);
    }
  };

  // Initialize edited screens from preview data
  const getScreenData = (screenId) => {
    if (editedScreens[screenId]) {
      return editedScreens[screenId];
    }
    const screen = previewData?.screens?.find(s => s.screen_id === screenId);
    // Normalize colValue for special filters (fix old "col_value" from backend)
    return normalizeColValues(screen?.hierarchies || {});
  };

  const selectScreen = (screen) => {
    setSelectedScreen(selectedScreen?.screen_id === screen.screen_id ? null : screen);
  };

  // Update a filter property
  const updateFilter = (screenId, filterPath, filterIndex, property, value) => {
    const currentData = JSON.parse(JSON.stringify(getScreenData(screenId)));
    
    // Navigate to the filter array using the path
    const pathParts = filterPath.split('.');
    let target = currentData;
    for (const part of pathParts) {
      if (!target[part]) target[part] = {};
      target = target[part];
    }
    
    if (Array.isArray(target) && target[filterIndex]) {
      target[filterIndex][property] = value;
    }
    
    setEditedScreens(prev => ({
      ...prev,
      [screenId]: currentData
    }));
    
    // Mark as not saved if it was saved before
    if (savedScreens[screenId]) {
      setSavedScreens(prev => ({
        ...prev,
        [screenId]: false
      }));
    }
  };

  // Save individual screen
  const saveScreen = async (screen) => {
    setSavingScreen(screen.screen_id);
    try {
      const hierarchies = getScreenData(screen.screen_id);
      await api.saveScreen(screen.screen_id, hierarchies);
      setSavedScreens(prev => ({
        ...prev,
        [screen.screen_id]: true
      }));
    } catch (err) {
      alert('Failed to save: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSavingScreen(null);
    }
  };

  // Check if screen has unsaved edits
  const hasEdits = (screenId) => {
    return editedScreens[screenId] && !savedScreens[screenId];
  };

  // Delete a filter from a screen
  const deleteFilter = (screenId, filterPath, filterIndex) => {
    const currentData = JSON.parse(JSON.stringify(getScreenData(screenId)));
    
    // Navigate to the filter array using the path
    const pathParts = filterPath.split('.');
    let target = currentData;
    for (const part of pathParts) {
      if (!target[part]) return;
      target = target[part];
    }
    
    if (Array.isArray(target)) {
      target.splice(filterIndex, 1);
    }
    
    setEditedScreens(prev => ({
      ...prev,
      [screenId]: currentData
    }));
    
    // Mark as not saved
    if (savedScreens[screenId]) {
      setSavedScreens(prev => ({ ...prev, [screenId]: false }));
    }
  };

  // Get addable levels for a filter path
  const getAddableLevels = (screenId, filterPath) => {
    const allLevels = [];
    const allowance = screenAllowances[screenId] || {};
    const allowedFilters = allowance.allowed_filters || {};
    
    // Also get levels from the ORIGINAL preview data (to allow re-adding deleted levels)
    const originalScreen = previewData?.screens?.find(s => s.screen_id === screenId);
    const originalHierarchies = originalScreen?.hierarchies || {};
    
    // Helper to extract filters from original data at a path
    const getOriginalFiltersAtPath = (path) => {
      const parts = path.split('.');
      let target = originalHierarchies;
      for (const part of parts) {
        if (!target?.[part]) return [];
        target = target[part];
      }
      return Array.isArray(target) ? target : [];
    };
    
    // Determine what levels to include based on filter path AND screen allowances
    if (filterPath.includes('product_filter')) {
      const productFilterAllowed = allowedFilters.product_filter || {};
      
      // Add product hierarchy levels if hierarchies are allowed
      if (productFilterAllowed.hierarchies !== false) {
        allLevels.push(...availableLevels.product);
        
        // Also add any levels from original preview that might not be in hierarchy table
        const originalFilters = getOriginalFiltersAtPath(filterPath);
        originalFilters.forEach(f => {
          if (f.filterId?.match(/^l\d+_ids$/) && !allLevels.find(l => l.filterId === f.filterId)) {
            allLevels.push({
              ...f,
              isMulti: f.isMulti ?? true,
              filterType: f.filterType ?? 'dropdown',
              apiEndpoint: f.apiEndpoint ?? 'filters'
            });
          }
        });
      }
      
      // Add product attribute if allowed for this screen
      if (productFilterAllowed.product_attr !== false && allowance.product_attr_allowed !== false) {
        allLevels.push(SPECIAL_FILTERS.product_attribute_names);
      }
      
      // Add product_group_ids only in product_group subsection AND if allowed
      if (filterPath.includes('product_group') && productFilterAllowed.product_group !== false) {
        allLevels.push(SPECIAL_FILTERS.product_group_ids);
      }
    } else if (filterPath.includes('store_filter')) {
      const storeFilterAllowed = allowedFilters.store_filter || {};
      
      // Add store hierarchy levels if hierarchies are allowed
      if (storeFilterAllowed.hierarchies !== false) {
        allLevels.push(...availableLevels.store);
        
        // Also add any levels from original preview that might not be in hierarchy table
        const originalFilters = getOriginalFiltersAtPath(filterPath);
        originalFilters.forEach(f => {
          if (f.filterId?.match(/^s\d+_ids$/) && !allLevels.find(l => l.filterId === f.filterId)) {
            allLevels.push({
              ...f,
              isMulti: f.isMulti ?? true,
              filterType: f.filterType ?? 'dropdown',
              apiEndpoint: f.apiEndpoint ?? 'filters'
            });
          }
        });
      }
      
      // Add zone structure if allowed
      if (storeFilterAllowed.zone_structure !== false) {
        allLevels.push(SPECIAL_FILTERS.structure_name);
      }
      
      // Add store_group_ids only in store_group subsection AND if allowed
      if (filterPath.includes('store_group') && storeFilterAllowed.store_group !== false) {
        allLevels.push(SPECIAL_FILTERS.store_group_ids);
      }
    } else if (filterPath.includes('segment_filter')) {
      // Segment filter allowed check
      if (allowance.segment_filter_allowed !== false) {
        allLevels.push(SPECIAL_FILTERS.segment_ids);
      }
    }
    
    // Get current filters in this path (the EDITED version)
    const currentData = getScreenData(screenId);
    const pathParts = filterPath.split('.');
    let target = currentData;
    for (const part of pathParts) {
      if (!target?.[part]) {
        target = [];
        break;
      }
      target = target[part];
    }
    
    const currentIds = new Set((Array.isArray(target) ? target : []).map(f => f.filterId));
    return allLevels.filter(level => !currentIds.has(level.filterId));
  };

  // Add a filter level
  const addFilterLevel = (screenId, filterPath, level) => {
    const currentData = JSON.parse(JSON.stringify(getScreenData(screenId)));
    const newLevel = { ...level };
    
    // Navigate to the filter array using the path
    const pathParts = filterPath.split('.');
    let target = currentData;
    let parent = null;
    let lastKey = null;
    
    for (const part of pathParts) {
      parent = target;
      lastKey = part;
      if (!target[part]) target[part] = [];
      target = target[part];
    }
    
    if (Array.isArray(target)) {
      target.push(newLevel);
    }
    
    setEditedScreens(prev => ({
      ...prev,
      [screenId]: currentData
    }));
    
    setShowAddMenu(null);
    
    // Mark as not saved
    if (savedScreens[screenId]) {
      setSavedScreens(prev => ({ ...prev, [screenId]: false }));
    }
  };

  // Drag and drop handlers
  const handleDragStart = (screenId, filterPath, index) => {
    setDragState({ screenId, filterPath, index });
  };

  const handleDragEnd = () => {
    setDragState({ screenId: null, filterPath: null, index: null });
  };

  const handleDrop = (screenId, filterPath, dropIndex) => {
    if (dragState.screenId !== screenId || dragState.filterPath !== filterPath || dragState.index === dropIndex) {
      setDragState({ screenId: null, filterPath: null, index: null });
      return;
    }
    
    const currentData = JSON.parse(JSON.stringify(getScreenData(screenId)));
    
    // Navigate to the filter array
    const pathParts = filterPath.split('.');
    let target = currentData;
    for (const part of pathParts) {
      if (!target[part]) return;
      target = target[part];
    }
    
    if (Array.isArray(target)) {
      const [draggedItem] = target.splice(dragState.index, 1);
      target.splice(dropIndex, 0, draggedItem);
    }
    
    setEditedScreens(prev => ({
      ...prev,
      [screenId]: currentData
    }));
    
    // Mark as not saved
    if (savedScreens[screenId]) {
      setSavedScreens(prev => ({ ...prev, [screenId]: false }));
    }
    
    setDragState({ screenId: null, filterPath: null, index: null });
  };

  // Render editable filter table for a section
  const renderFilterTable = (screenId, filters, title, filterPath) => {
    const addableLevels = getAddableLevels(screenId, filterPath);
    const menuKey = `${screenId}-${filterPath}`;
    const isAddMenuOpen = showAddMenu === menuKey;

    return (
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontWeight: '500', marginBottom: '8px', color: '#4B5563', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{title}</span>
          <span style={{ fontSize: '12px', color: '#9CA3AF' }}>{filters?.length || 0} filters</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: '#F3F4F6', borderBottom: '1px solid #E5E7EB' }}>
              <th style={{ padding: '8px', width: '30px' }}></th>
              <th style={{ padding: '8px', textAlign: 'left', width: '50px' }}>Level</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Filter Label</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Column Value</th>
              <th style={{ padding: '8px', textAlign: 'center', width: '60px' }}>Multi</th>
              <th style={{ padding: '8px', textAlign: 'center', width: '70px' }}>On Load</th>
              <th style={{ padding: '8px', textAlign: 'center', width: '70px' }}>Limit</th>
              <th style={{ padding: '8px', textAlign: 'center', width: '80px' }}>Mandatory</th>
              <th style={{ padding: '8px', width: '40px' }}></th>
            </tr>
          </thead>
          <tbody>
            {(filters || []).map((filter, idx) => (
              <tr 
                key={idx} 
                style={{ 
                  borderBottom: '1px solid #E5E7EB',
                  backgroundColor: dragState.screenId === screenId && dragState.filterPath === filterPath && dragState.index === idx ? '#EFF6FF' : 'transparent'
                }}
                draggable
                onDragStart={() => handleDragStart(screenId, filterPath, idx)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(screenId, filterPath, idx)}
              >
                <td style={{ padding: '4px 8px', cursor: 'grab', color: '#9CA3AF' }} title="Drag to reorder">
                  <MdDragIndicator size={18} />
                </td>
                <td style={{ padding: '8px' }}>
                  <span style={{
                    backgroundColor: filter.filterId?.startsWith('l') ? '#DBEAFE' : 
                                    filter.filterId?.startsWith('s') ? '#FEE2E2' : '#F3F4F6',
                    color: filter.filterId?.startsWith('l') ? '#1D4ED8' : 
                           filter.filterId?.startsWith('s') ? '#DC2626' : '#6B7280',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: '500'
                  }}>
                    {getHierarchyLevel(filter.filterId)}
                  </span>
                </td>
                <td style={{ padding: '8px' }}>{filter.filterLabel || '-'}</td>
                <td style={{ padding: '8px', color: '#6B7280' }}>{filter.colValue || filter.filterId || '-'}</td>
                <td style={{ padding: '8px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={filter.isMulti || false}
                    onChange={(e) => updateFilter(screenId, filterPath, idx, 'isMulti', e.target.checked)}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                </td>
                <td style={{ padding: '8px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={filter.selectOnLoad || false}
                    onChange={(e) => updateFilter(screenId, filterPath, idx, 'selectOnLoad', e.target.checked)}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                </td>
                <td style={{ padding: '8px', textAlign: 'center' }}>
                  <input
                    type="number"
                    value={filter.limit || ''}
                    onChange={(e) => updateFilter(screenId, filterPath, idx, 'limit', e.target.value ? parseInt(e.target.value) : null)}
                    placeholder="-"
                    style={{
                      width: '50px',
                      padding: '4px',
                      border: '1px solid #D1D5DB',
                      borderRadius: '4px',
                      textAlign: 'center'
                    }}
                  />
                </td>
                <td style={{ padding: '8px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={filter.isMandatory || false}
                    onChange={(e) => updateFilter(screenId, filterPath, idx, 'isMandatory', e.target.checked)}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                </td>
                <td style={{ padding: '4px 8px' }}>
                  <button
                    onClick={() => deleteFilter(screenId, filterPath, idx)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#DC2626',
                      padding: '4px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title="Delete filter"
                  >
                    <MdDelete size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {/* Add Level Button */}
        <div style={{ marginTop: '8px', position: 'relative' }}>
          <button
            onClick={() => setShowAddMenu(isAddMenuOpen ? null : menuKey)}
            disabled={addableLevels.length === 0}
            style={{
              padding: '6px 12px',
              backgroundColor: addableLevels.length === 0 ? '#F3F4F6' : '#EFF6FF',
              color: addableLevels.length === 0 ? '#9CA3AF' : '#2563EB',
              border: '1px dashed ' + (addableLevels.length === 0 ? '#D1D5DB' : '#93C5FD'),
              borderRadius: '4px',
              cursor: addableLevels.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <MdAdd size={16} />
            Add Level
          </button>
          
          {isAddMenuOpen && addableLevels.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: '4px',
              backgroundColor: 'white',
              border: '1px solid #E5E7EB',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 100,
              minWidth: '280px',
              maxHeight: '300px',
              overflow: 'auto'
            }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid #E5E7EB', color: '#6B7280', fontSize: '12px', fontWeight: '500' }}>
                Select level to add:
              </div>
              {addableLevels.map(level => (
                <div
                  key={level.filterId}
                  onClick={() => addFilterLevel(screenId, filterPath, level)}
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #F3F4F6',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#F9FAFB'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'white'}
                >
                  <span style={{
                    backgroundColor: level.filterId?.startsWith('l') ? '#DBEAFE' : 
                                    level.filterId?.startsWith('s') ? '#FEE2E2' : '#F3F4F6',
                    color: level.filterId?.startsWith('l') ? '#1D4ED8' : 
                           level.filterId?.startsWith('s') ? '#DC2626' : '#6B7280',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: '500',
                    minWidth: '35px',
                    textAlign: 'center'
                  }}>
                    {getHierarchyLevel(level.filterId)}
                  </span>
                  <span style={{ fontWeight: '500' }}>{level.filterLabel}</span>
                  <span style={{ color: '#9CA3AF', fontSize: '12px', marginLeft: 'auto' }}>{level.filterId}</span>
                </div>
              ))}
            </div>
          )}
          
          {addableLevels.length === 0 && (
            <span style={{ marginLeft: '12px', color: '#9CA3AF', fontSize: '12px' }}>
              All available levels are added
            </span>
          )}
        </div>
      </div>
    );
  };

  // Render hierarchies for a screen
  const renderScreenHierarchies = (screen) => {
    const hierarchies = getScreenData(screen.screen_id);
    const sections = [];

    // Product Filter
    if (hierarchies.product_filter) {
      const pf = hierarchies.product_filter;
      if (pf.hierarchies) {
        sections.push(renderFilterTable(screen.screen_id, pf.hierarchies, '🛒 Product Filter > Hierarchies', 'product_filter.hierarchies'));
      }
      if (pf.product_group) {
        sections.push(renderFilterTable(screen.screen_id, pf.product_group, '🛒 Product Filter > Product Group', 'product_filter.product_group'));
      }
      if (pf.specific?.hierarchies) {
        sections.push(renderFilterTable(screen.screen_id, pf.specific.hierarchies, '🛒 Product Filter > Specific', 'product_filter.specific.hierarchies'));
      }
    }

    // Store Filter
    if (hierarchies.store_filter) {
      const sf = hierarchies.store_filter;
      if (sf.hierarchies) {
        sections.push(renderFilterTable(screen.screen_id, sf.hierarchies, '🏬 Store Filter > Hierarchies', 'store_filter.hierarchies'));
      }
      if (sf.store_group) {
        sections.push(renderFilterTable(screen.screen_id, sf.store_group, '🏬 Store Filter > Store Group', 'store_filter.store_group'));
      }
    }

    // Segment Filter
    if (hierarchies.segment_filter?.hierarchies) {
      sections.push(renderFilterTable(screen.screen_id, hierarchies.segment_filter.hierarchies, '👥 Segment Filter', 'segment_filter.hierarchies'));
    }

    // Rule Filter
    if (hierarchies.rule_filter?.rule) {
      sections.push(renderFilterTable(screen.screen_id, hierarchies.rule_filter.rule, '📋 Rule Filter', 'rule_filter.rule'));
    }

    // Strategy Filter
    if (hierarchies.strategy_filter?.strategy_status) {
      sections.push(renderFilterTable(screen.screen_id, hierarchies.strategy_filter.strategy_status, '📊 Strategy Filter', 'strategy_filter.strategy_status'));
    }

    return sections.length > 0 ? sections : <div style={{ color: '#9CA3AF', padding: '12px' }}>No filters configured</div>;
  };

  const screens = previewData?.screens || [];
  const savedCount = Object.values(savedScreens).filter(Boolean).length;
  const unsavedCount = screens.length - savedCount;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        width: '95vw',
        maxWidth: '1400px',
        height: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 25px 50px rgba(0,0,0,0.25)'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid #E5E7EB',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#F9FAFB'
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '600' }}>
              Preview: Regenerate All Screens
            </h2>
            <p style={{ margin: '4px 0 0 0', color: '#6B7280', fontSize: '14px' }}>
              Review and edit configurations • Save individual screens or all at once
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {savedCount > 0 && (
              <span style={{ color: '#16A34A', fontSize: '14px' }}>
                ✓ {savedCount} saved
              </span>
            )}
            <button
              onClick={onDiscard}
              disabled={saving}
              style={{
                padding: '10px 20px',
                backgroundColor: 'white',
                border: '1px solid #D1D5DB',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '500',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <MdClose size={18} />
              Close
            </button>
            <button
              onClick={onSave}
              disabled={saving || unsavedCount === 0}
              style={{
                padding: '10px 20px',
                backgroundColor: unsavedCount > 0 ? '#2563EB' : '#9CA3AF',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: saving || unsavedCount === 0 ? 'not-allowed' : 'pointer',
                fontWeight: '500',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                opacity: saving ? 0.7 : 1
              }}
            >
              <MdSave size={18} />
              {saving ? 'Saving...' : `Save All ${unsavedCount} Remaining`}
            </button>
          </div>
        </div>

        {/* Content - Split View */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left: Screen List */}
          <div style={{
            width: '350px',
            borderRight: '1px solid #E5E7EB',
            overflow: 'auto',
            backgroundColor: '#FAFAFA'
          }}>
            <div style={{ padding: '12px', borderBottom: '1px solid #E5E7EB', fontWeight: '500', color: '#374151' }}>
              Screens ({screens.length})
            </div>
            {screens.map((screen) => {
              const isSelected = selectedScreen?.screen_id === screen.screen_id;
              const friendlyName = SCREEN_FRIENDLY_NAMES[screen.screen_id] || screen.screen_name;
              const filterCount = Object.keys(screen.hierarchies || {}).length;
              const isSaved = savedScreens[screen.screen_id];
              const isEdited = hasEdits(screen.screen_id);
              
              return (
                <div
                  key={screen.screen_id}
                  onClick={() => selectScreen(screen)}
                  style={{
                    padding: '12px 16px',
                    cursor: 'pointer',
                    backgroundColor: isSelected ? '#EFF6FF' : isSaved ? '#F0FDF4' : 'transparent',
                    borderLeft: isSelected ? '3px solid #2563EB' : isSaved ? '3px solid #22C55E' : '3px solid transparent',
                    borderBottom: '1px solid #E5E7EB',
                    transition: 'all 0.15s'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', color: '#9CA3AF' }}>ID: {screen.screen_id}</span>
                        {isSaved && <MdCheckCircle color="#22C55E" size={16} />}
                        {isEdited && <MdEdit color="#F59E0B" size={14} />}
                      </div>
                      <div style={{ fontWeight: '500', marginTop: '2px' }}>{friendlyName}</div>
                      <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>
                        {screen.screen_name}
                      </div>
                    </div>
                    <div style={{
                      backgroundColor: isSaved ? '#DCFCE7' : '#E5E7EB',
                      color: isSaved ? '#166534' : '#4B5563',
                      padding: '4px 8px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: '500'
                    }}>
                      {isSaved ? 'Saved' : `${filterCount} filter${filterCount !== 1 ? 's' : ''}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: Selected Screen Details */}
          <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
            {selectedScreen ? (
              <div>
                <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{
                        backgroundColor: '#E5E7EB',
                        padding: '4px 10px',
                        borderRadius: '4px',
                        fontSize: '13px',
                        fontWeight: '500'
                      }}>
                        ID: {selectedScreen.screen_id}
                      </span>
                      <h3 style={{ margin: 0 }}>
                        {SCREEN_FRIENDLY_NAMES[selectedScreen.screen_id] || selectedScreen.screen_name}
                      </h3>
                      {savedScreens[selectedScreen.screen_id] && (
                        <span style={{ 
                          backgroundColor: '#DCFCE7', 
                          color: '#166534',
                          padding: '4px 10px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: '500',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}>
                          <MdCheckCircle size={14} /> Saved
                        </span>
                      )}
                      {hasEdits(selectedScreen.screen_id) && (
                        <span style={{ 
                          backgroundColor: '#FEF3C7', 
                          color: '#92400E',
                          padding: '4px 10px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: '500'
                        }}>
                          Edited
                        </span>
                      )}
                    </div>
                    <div style={{ color: '#6B7280', fontSize: '13px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span>{selectedScreen.screen_name}</span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={() => setShowJson(false)}
                          style={{
                            padding: '3px 8px',
                            fontSize: '11px',
                            fontWeight: '500',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            background: !showJson ? '#264CD7' : '#f3f4f6',
                            color: !showJson ? '#fff' : '#6b7280'
                          }}
                        >
                          Editor
                        </button>
                        <button
                          onClick={() => setShowJson(true)}
                          style={{
                            padding: '3px 8px',
                            fontSize: '11px',
                            fontWeight: '500',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            background: showJson ? '#264CD7' : '#f3f4f6',
                            color: showJson ? '#fff' : '#6b7280'
                          }}
                        >
                          JSON
                        </button>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => saveScreen(selectedScreen)}
                    disabled={savingScreen === selectedScreen.screen_id || savedScreens[selectedScreen.screen_id]}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: savedScreens[selectedScreen.screen_id] ? '#D1D5DB' : '#22C55E',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: savingScreen === selectedScreen.screen_id || savedScreens[selectedScreen.screen_id] ? 'not-allowed' : 'pointer',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      opacity: savingScreen === selectedScreen.screen_id ? 0.7 : 1
                    }}
                  >
                    {savingScreen === selectedScreen.screen_id ? (
                      'Saving...'
                    ) : savedScreens[selectedScreen.screen_id] ? (
                      <><MdCheck size={18} /> Saved</>
                    ) : (
                      <><MdSave size={18} /> Save This Screen</>
                    )}
                  </button>
                </div>

                {showJson ? (
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
                        bp_screen_hierarchies JSON
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(getScreenData(selectedScreen.screen_id), null, 2));
                          alert('JSON copied to clipboard!');
                        }}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          background: '#f3f4f6',
                          border: '1px solid #e5e7eb',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          color: '#374151'
                        }}
                      >
                        Copy
                      </button>
                    </div>
                    <pre style={{
                      background: '#1e293b',
                      color: '#e2e8f0',
                      padding: '16px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                      overflow: 'auto',
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: 'calc(100vh - 320px)'
                    }}>
                      {JSON.stringify(getScreenData(selectedScreen.screen_id), null, 2)}
                    </pre>
                  </div>
                ) : (
                  renderScreenHierarchies(selectedScreen)
                )}
              </div>
            ) : (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: '#9CA3AF'
              }}>
                <MdFilterList size={48} style={{ marginBottom: '12px', opacity: 0.5 }} />
                <div>Select a screen from the list to view and edit its configuration</div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Summary */}
        <div style={{
          padding: '12px 24px',
          borderTop: '1px solid #E5E7EB',
          backgroundColor: '#F9FAFB',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ color: '#6B7280', fontSize: '14px' }}>
            {savedCount > 0 ? (
              <>✅ {savedCount} screen{savedCount !== 1 ? 's' : ''} saved • {unsavedCount} remaining</>
            ) : (
              <>📝 Click on a screen to review, edit, and save individually or use "Save All"</>
            )}
          </div>
          <div style={{ color: '#9CA3AF', fontSize: '13px' }}>
            Edits are highlighted with yellow badge
          </div>
        </div>
      </div>
    </div>
  );
}

export default RegeneratePreviewModal;
