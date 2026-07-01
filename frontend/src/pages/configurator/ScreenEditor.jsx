import React, { useState, useEffect, useRef } from 'react';
import { MdClose, MdDelete, MdAdd, MdSave, MdVisibility, MdDragIndicator, MdRefresh } from 'react-icons/md';
import { api } from '../../api';

// Map section keys to display names
const SECTION_NAMES = {
  hierarchies: 'Select Hierarchy',
  product_group: 'Select Product Group',
  store_group: 'Select Store Group',
  specific: 'Specific'
};

// Map filter block to display name
const FILTER_BLOCK_NAMES = {
  product_filter: 'Product Filter',
  store_filter: 'Store Filter',
  segment_filter: 'Segment Filter',
  rule_filter: 'Rule Filter',
  strategy_filter: 'Strategy Filter'
};

// Other filters (non-hierarchy) with colValue = filterId
const OTHER_FILTERS = {
  product: [
    { id: 'product_attribute_names', label: 'Product Attribute', colValue: 'product_attribute_names' },
    { id: 'product_group_ids', label: 'Product Group', colValue: 'product_group_ids' }
  ],
  store: [
    { id: 'store_group_ids', label: 'Store Group', colValue: 'store_group_ids' },
    { id: 'structure_name', label: 'Zone Structure', colValue: 'structure_name' }
  ],
  segment: [
    { id: 'segment_ids', label: 'Customer Segment', colValue: 'segment_ids' }
  ]
};

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

// Extract hierarchy level from filterId (e.g., l0_ids -> L0, s2_ids -> S2)
// filterId contains the hierarchy level ID (l0, l1, s0, etc.)
// colValue is the column label (brand, department, etc.)
const getHierarchyLevel = (filterId) => {
  if (!filterId) return '-';
  const match = filterId.match(/^([ls])(\d+)/i);
  if (match) {
    return match[1].toUpperCase() + match[2];
  }
  return '-';
};

function ScreenEditor({ screen, onClose, onSave }) {
  const [hierarchies, setHierarchies] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState(null);
  const [activeFilterBlock, setActiveFilterBlock] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [rightPanelView, setRightPanelView] = useState('preview'); // 'preview' or 'json'
  
  // Hierarchy levels for building filters
  const [productLevels, setProductLevels] = useState([]);
  const [storeLevels, setStoreLevels] = useState([]);
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  
  // Track deleted filters and initial state for re-adding
  const [deletedFilters, setDeletedFilters] = useState([]);
  const initialHierarchiesRef = useRef(null);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowAddDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (screen) {
      fetchScreenData();
      fetchHierarchyLevels();
    }
  }, [screen]);

  const fetchHierarchyLevels = async () => {
    try {
      const [productRes, storeRes] = await Promise.all([
        api.getProductHierarchy(),
        api.getStoreHierarchy()
      ]);
      if (productRes.data.success) {
        setProductLevels(productRes.data.levels || []);
      }
      if (storeRes.data.success) {
        setStoreLevels(storeRes.data.levels || []);
      }
    } catch (err) {
      console.error('Failed to fetch hierarchies:', err);
    }
  };

  const fetchScreenData = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.getScreen(screen.screen_id);
      if (response.data.success) {
        const data = response.data.data;
        // Normalize colValue for special filters (fix old "col_value" from DB)
        const normalizedHierarchies = normalizeColValues(data.hierarchies || {});
        setHierarchies(normalizedHierarchies);
        // Capture initial state for re-adding deleted levels
        initialHierarchiesRef.current = JSON.parse(JSON.stringify(normalizedHierarchies));
        setDeletedFilters([]); // Clear deleted filters on fresh load
        setHasChanges(false); // Reset changes flag when loading fresh data
        
        // Set initial active filter block and section
        const filterBlocks = Object.keys(normalizedHierarchies);
        if (filterBlocks.length > 0) {
          setActiveFilterBlock(filterBlocks[0]);
          const sections = Object.keys(normalizedHierarchies[filterBlocks[0]] || {});
          if (sections.length > 0) {
            setActiveSection(sections[0]);
          }
        }
      }
    } catch (err) {
      setError('Failed to load screen: ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.saveScreen(screen.screen_id, hierarchies);
      setHasChanges(false);
      if (onSave) onSave();
    } catch (err) {
      setError('Failed to save: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    if (!window.confirm('This will regenerate filters based on current hierarchy levels. Review and click "Save Changes" to persist, or close to discard.')) {
      return;
    }
    
    try {
      setRegenerating(true);
      setError(null);
      // Use preview endpoint - doesn't save to DB
      const response = await api.previewScreenRegeneration(screen.screen_id);
      if (response.data.success) {
        // Normalize colValue for special filters (fix old values from backend)
        const newHierarchies = normalizeColValues(response.data.hierarchies || {});
        setHierarchies(newHierarchies);
        // Update initial reference with regenerated data so deleted levels can be re-added
        initialHierarchiesRef.current = JSON.parse(JSON.stringify(newHierarchies));
        // Clear deleted filters since we have fresh regenerated data
        setDeletedFilters([]);
        setHasChanges(true); // Mark as unsaved - user must click Save
        
        // Reset active filter block and section
        const filterBlocks = Object.keys(newHierarchies);
        if (filterBlocks.length > 0) {
          setActiveFilterBlock(filterBlocks[0]);
          const sections = Object.keys(newHierarchies[filterBlocks[0]] || {});
          if (sections.length > 0) {
            setActiveSection(sections[0]);
          }
        }
        // Don't call onSave - user decides to save or discard
      }
    } catch (err) {
      setError('Failed to regenerate: ' + (err.response?.data?.detail || err.message));
    } finally {
      setRegenerating(false);
    }
  };

  const handleClose = () => {
    if (hasChanges) {
      const action = window.confirm('You have unsaved changes. Click OK to save, or Cancel to discard.');
      if (action) {
        // User wants to save
        handleSave().then(() => {
          onClose();
        });
        return;
      }
    }
    onClose();
  };

  const handleFilterChange = (filterBlock, section, filterIndex, field, value) => {
    const updated = JSON.parse(JSON.stringify(hierarchies));
    updated[filterBlock][section][filterIndex][field] = value;
    setHierarchies(updated);
    setHasChanges(true);
  };

  const handleRemoveFilter = (filterBlock, section, filterIndex) => {
    const updated = JSON.parse(JSON.stringify(hierarchies));
    // Capture the filter being removed before splicing
    const removedFilter = updated[filterBlock][section][filterIndex];
    updated[filterBlock][section].splice(filterIndex, 1);
    
    // Track deleted filter so it can be re-added
    if (removedFilter) {
      setDeletedFilters(prev => [...prev, { 
        ...removedFilter, 
        _filterBlock: filterBlock, 
        _section: section 
      }]);
    }
    
    setHierarchies(updated);
    setHasChanges(true);
  };

  // Add filter from hierarchy level or other filter type
  const handleAddFilterFromSelection = (filterBlock, section, filterOption) => {
    const updated = JSON.parse(JSON.stringify(hierarchies));
    
    let newFilter;
    if (filterOption.isHierarchy) {
      // Hierarchy level filter (L0, L1, S0, S1, etc.)
      const prefix = filterOption.type === 'product' ? 'l' : 's';
      newFilter = {
        isMulti: true,
        colValue: filterOption.label, // product_hierarchy_level_label
        filterId: `${prefix}${filterOption.level}_ids`,
        selection: null,
        filterType: 'dropdown',
        apiEndpoint: 'filters',
        filterLabel: filterOption.value, // product_hierarchy_level_value
        isMandatory: false,
        selectOnLoad: false,
        limit: null
      };
    } else {
      // Other filter (product_attribute_names, product_group_ids, etc.)
      newFilter = {
        isMulti: true,
        colValue: filterOption.colValue || filterOption.id,
        filterId: filterOption.id,
        selection: null,
        filterType: 'dropdown',
        apiEndpoint: 'filters',
        filterLabel: filterOption.label,
        isMandatory: false,
        selectOnLoad: false,
        limit: null
      };
    }
    
    updated[filterBlock][section].push(newFilter);
    
    // Remove from deleted filters if it was there
    const addedFilterId = newFilter.filterId;
    setDeletedFilters(prev => prev.filter(f => f.filterId !== addedFilterId));
    
    setHierarchies(updated);
    setHasChanges(true);
    setShowAddDropdown(false);
  };

  // Get available filters for dropdown based on active filter block
  // Get available filters that can be added (excluding already-added ones)
  const getAvailableFilters = () => {
    const isProductFilter = activeFilterBlock === 'product_filter';
    const isStoreFilter = activeFilterBlock === 'store_filter';
    const isSegmentFilter = activeFilterBlock === 'segment_filter';
    
    // Get current filter IDs in this section to exclude
    const currentFilters = hierarchies?.[activeFilterBlock]?.[activeSection] || [];
    const currentFilterIds = new Set(currentFilters.map(f => f.filterId));
    
    // Get deleted filters for this section that can be re-added
    const deletedForSection = deletedFilters.filter(f => 
      f._filterBlock === activeFilterBlock && f._section === activeSection
    );
    
    // Get filters from initial state (to recover levels not in database but were in config)
    const initialFilters = initialHierarchiesRef.current?.[activeFilterBlock]?.[activeSection] || [];
    
    const available = [];
    
    // For segment_filter, only show segment_ids
    if (isSegmentFilter) {
      OTHER_FILTERS.segment.forEach(f => {
        if (!currentFilterIds.has(f.id)) {
          available.push({
            isHierarchy: false,
            ...f,
            filterId: f.id,
            displayName: f.label
          });
        }
      });
      return available;
    }
    
    // Add product hierarchy levels ONLY for product_filter
    if (isProductFilter) {
      productLevels.forEach(level => {
        const filterId = `l${level.product_hierarchy_level_id}_ids`;
        if (!currentFilterIds.has(filterId)) {
          available.push({
            isHierarchy: true,
            type: 'product',
            level: level.product_hierarchy_level_id,
            label: level.product_hierarchy_level_label,
            value: level.product_hierarchy_level_value,
            filterId: filterId,
            displayName: `L${level.product_hierarchy_level_id} - ${level.product_hierarchy_level_value}`
          });
        }
      });
      
      // Add levels from initial state that might not be in database
      initialFilters.forEach(f => {
        if (f.filterId?.match(/^l\d+_ids$/) && !currentFilterIds.has(f.filterId) && 
            !available.find(a => a.filterId === f.filterId)) {
          const match = f.filterId.match(/^l(\d+)_ids$/);
          available.push({
            isHierarchy: true,
            type: 'product',
            level: parseInt(match[1]),
            label: f.colValue || f.filterLabel,
            value: f.filterLabel,
            filterId: f.filterId,
            displayName: `L${match[1]} - ${f.filterLabel}`
          });
        }
      });
      
      // Add deleted filters from this session
      deletedForSection.forEach(f => {
        if (f.filterId?.match(/^l\d+_ids$/) && !currentFilterIds.has(f.filterId) && 
            !available.find(a => a.filterId === f.filterId)) {
          const match = f.filterId.match(/^l(\d+)_ids$/);
          available.push({
            isHierarchy: true,
            type: 'product',
            level: parseInt(match[1]),
            label: f.colValue || f.filterLabel,
            value: f.filterLabel,
            filterId: f.filterId,
            displayName: `L${match[1]} - ${f.filterLabel}`
          });
        }
      });
      
      // Add product-specific other filters
      OTHER_FILTERS.product.forEach(f => {
        if (!currentFilterIds.has(f.id)) {
          available.push({
            isHierarchy: false,
            ...f,
            filterId: f.id,
            displayName: f.label
          });
        }
      });
    }
    
    // Add store hierarchy levels ONLY for store_filter
    if (isStoreFilter) {
      storeLevels.forEach(level => {
        const filterId = `s${level.store_hierarchy_level_id}_ids`;
        if (!currentFilterIds.has(filterId)) {
          available.push({
            isHierarchy: true,
            type: 'store',
            level: level.store_hierarchy_level_id,
            label: level.store_hierarchy_level_label,
            value: level.store_hierarchy_level_value,
            filterId: filterId,
            displayName: `S${level.store_hierarchy_level_id} - ${level.store_hierarchy_level_value}`
          });
        }
      });
      
      // Add levels from initial state that might not be in database
      initialFilters.forEach(f => {
        if (f.filterId?.match(/^s\d+_ids$/) && !currentFilterIds.has(f.filterId) && 
            !available.find(a => a.filterId === f.filterId)) {
          const match = f.filterId.match(/^s(\d+)_ids$/);
          available.push({
            isHierarchy: true,
            type: 'store',
            level: parseInt(match[1]),
            label: f.colValue || f.filterLabel,
            value: f.filterLabel,
            filterId: f.filterId,
            displayName: `S${match[1]} - ${f.filterLabel}`
          });
        }
      });
      
      // Add deleted filters from this session
      deletedForSection.forEach(f => {
        if (f.filterId?.match(/^s\d+_ids$/) && !currentFilterIds.has(f.filterId) && 
            !available.find(a => a.filterId === f.filterId)) {
          const match = f.filterId.match(/^s(\d+)_ids$/);
          available.push({
            isHierarchy: true,
            type: 'store',
            level: parseInt(match[1]),
            label: f.colValue || f.filterLabel,
            value: f.filterLabel,
            filterId: f.filterId,
            displayName: `S${match[1]} - ${f.filterLabel}`
          });
        }
      });
      
      // Add store-specific other filters
      OTHER_FILTERS.store.forEach(f => {
        if (!currentFilterIds.has(f.id)) {
          available.push({
            isHierarchy: false,
            ...f,
            filterId: f.id,
            displayName: f.label
          });
        }
      });
    }
    
    return available;
  };

  const moveFilter = (filterBlock, section, fromIndex, toIndex) => {
    if (toIndex < 0 || toIndex >= hierarchies[filterBlock][section].length) return;
    const updated = JSON.parse(JSON.stringify(hierarchies));
    const [removed] = updated[filterBlock][section].splice(fromIndex, 1);
    updated[filterBlock][section].splice(toIndex, 0, removed);
    setHierarchies(updated);
    setHasChanges(true);
  };

  // Drag and drop handlers
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.outerHTML);
    setTimeout(() => {
      e.target.style.opacity = '0.5';
    }, 0);
  };

  const handleDragEnd = (e) => {
    e.target.style.opacity = '1';
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }
    moveFilter(activeFilterBlock, activeSection, draggedIndex, dropIndex);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Get filter blocks (product_filter, store_filter, etc.)
  const filterBlocks = hierarchies ? Object.keys(hierarchies) : [];
  
  // Get sections for active filter block
  const sections = activeFilterBlock && hierarchies?.[activeFilterBlock] 
    ? Object.keys(hierarchies[activeFilterBlock]) 
    : [];
  
  // Get filters for active section
  const filters = activeFilterBlock && activeSection && hierarchies?.[activeFilterBlock]?.[activeSection]
    ? hierarchies[activeFilterBlock][activeSection]
    : [];

  if (loading) {
    return (
      <div style={overlayStyle}>
        <div style={modalStyle}>
          <div style={{ padding: '60px', textAlign: 'center', color: '#6b7280' }}>
            Loading screen configuration...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={idBadgeStyle}>ID: {screen.screen_id}</span>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#1a1a2e' }}>
                {screen.screen_name?.replace(/_/g, ' ')}
              </h2>
              {hasChanges && (
                <span style={unsavedBadgeStyle}>Unsaved</span>
              )}
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#6b7280' }}>
              Configure filter hierarchies for this screen
              {hasChanges && ' • Click "Save Changes" to persist or "Discard" to revert'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button 
              onClick={handleRegenerate} 
              disabled={regenerating}
              style={regenerateButtonStyle}
              title="Regenerate filters from hierarchy levels"
            >
              <MdRefresh size={16} />
              {regenerating ? 'Regenerating...' : 'Regenerate'}
            </button>
            {hasChanges && (
              <>
                <button 
                  onClick={() => {
                    if (window.confirm('Discard all unsaved changes?')) {
                      fetchScreenData();
                    }
                  }}
                  style={discardButtonStyle}
                >
                  Discard
                </button>
                <button onClick={handleSave} disabled={saving} style={saveButtonStyle}>
                  <MdSave size={16} />
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </>
            )}
            <button onClick={handleClose} style={closeButtonStyle}>
              <MdClose size={20} />
            </button>
          </div>
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        {/* Main Content */}
        <div style={contentStyle}>
          {/* Left Panel - Filter Blocks */}
          <div style={leftPanelStyle}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
              <span style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase' }}>
                Filter Blocks
              </span>
            </div>
            {filterBlocks.map(block => (
              <div
                key={block}
                onClick={() => {
                  setActiveFilterBlock(block);
                  const sects = Object.keys(hierarchies[block] || {});
                  setActiveSection(sects[0] || null);
                }}
                style={{
                  ...filterBlockItemStyle,
                  background: activeFilterBlock === block ? '#eff6ff' : 'transparent',
                  borderLeft: activeFilterBlock === block ? '3px solid #264CD7' : '3px solid transparent',
                  color: activeFilterBlock === block ? '#264CD7' : '#374151'
                }}
              >
                {FILTER_BLOCK_NAMES[block] || block}
                <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                  {Object.keys(hierarchies[block] || {}).length} sections
                </span>
              </div>
            ))}
          </div>

          {/* Center Panel - Section Tabs & Filters */}
          <div style={centerPanelStyle}>
            {/* Section Tabs */}
            {sections.length > 0 && (
              <div style={tabsContainerStyle}>
                {sections.map(section => (
                  <button
                    key={section}
                    onClick={() => setActiveSection(section)}
                    style={{
                      ...tabButtonStyle,
                      borderBottom: activeSection === section ? '2px solid #264CD7' : '2px solid transparent',
                      color: activeSection === section ? '#264CD7' : '#6b7280',
                      fontWeight: activeSection === section ? '600' : '500'
                    }}
                  >
                    {SECTION_NAMES[section] || section}
                  </button>
                ))}
              </div>
            )}

            {/* Filters Table */}
            <div style={filtersContainerStyle}>
              <div style={filtersHeaderStyle}>
                <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                  Attributes
                </span>
                <div ref={dropdownRef} style={{ display: 'flex', gap: '8px', position: 'relative' }}>
                  <button
                    onClick={() => setShowAddDropdown(!showAddDropdown)}
                    style={addFilterButtonStyle}
                  >
                    <MdAdd size={16} />
                    Add Filter
                  </button>
                  
                  {/* Add Filter Dropdown */}
                  {showAddDropdown && (() => {
                    const availableFilters = getAvailableFilters();
                    const productHierarchyFilters = availableFilters.filter(f => f.isHierarchy && f.type === 'product');
                    const storeHierarchyFilters = availableFilters.filter(f => f.isHierarchy && f.type === 'store');
                    const otherFilters = availableFilters.filter(f => !f.isHierarchy);
                    const hasAnyFilters = availableFilters.length > 0;
                    
                    return (
                    <div style={addFilterDropdownStyle}>
                      <div style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb', fontSize: '11px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase' }}>
                        Select Filter Type
                      </div>
                      <div style={{ maxHeight: '300px', overflow: 'auto' }}>
                        {!hasAnyFilters && (
                          <div style={{ padding: '12px 16px', color: '#9ca3af', fontSize: '13px', textAlign: 'center' }}>
                            All available filters are added
                          </div>
                        )}
                        
                        {/* Product Hierarchy Section */}
                        {productHierarchyFilters.length > 0 && (
                          <>
                            <div style={dropdownSectionHeaderStyle}>Product Hierarchy</div>
                            {productHierarchyFilters.map(filter => (
                              <div
                                key={filter.filterId}
                                onClick={() => handleAddFilterFromSelection(activeFilterBlock, activeSection, filter)}
                                style={dropdownItemStyle}
                              >
                                <span style={levelBadgeSmallStyle}>L{filter.level}</span>
                                {filter.value}
                              </div>
                            ))}
                          </>
                        )}
                        
                        {/* Store Hierarchy Section */}
                        {storeHierarchyFilters.length > 0 && (
                          <>
                            <div style={dropdownSectionHeaderStyle}>Store Hierarchy</div>
                            {storeHierarchyFilters.map(filter => (
                              <div
                                key={filter.filterId}
                                onClick={() => handleAddFilterFromSelection(activeFilterBlock, activeSection, filter)}
                                style={dropdownItemStyle}
                              >
                                <span style={{ ...levelBadgeSmallStyle, background: '#f0fdf4', color: '#16a34a' }}>S{filter.level}</span>
                                {filter.value}
                              </div>
                            ))}
                          </>
                        )}
                        
                        {/* Other Filters Section */}
                        {otherFilters.length > 0 && (
                          <>
                            <div style={dropdownSectionHeaderStyle}>Other Filters</div>
                            {otherFilters.map(f => (
                              <div
                                key={f.filterId}
                                onClick={() => handleAddFilterFromSelection(activeFilterBlock, activeSection, f)}
                                style={dropdownItemStyle}
                              >
                                <span style={{ ...levelBadgeSmallStyle, background: '#fef3c7', color: '#d97706' }}>-</span>
                                {f.label}
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  );
                  })()}
                </div>
              </div>

              {/* Filters Table */}
              <div style={tableContainerStyle}>
                <table style={tableStyle}>
                  <thead>
                    <tr style={tableHeaderRowStyle}>
                      <th style={{ ...tableHeaderCellStyle, width: '50px' }}>Level</th>
                      <th style={{ ...tableHeaderCellStyle, width: '200px' }}>Filter Label</th>
                      <th style={{ ...tableHeaderCellStyle, width: '120px' }}>Column Value</th>
                      <th style={{ ...tableHeaderCellStyle, width: '80px', textAlign: 'center' }}>Multi</th>
                      <th style={{ ...tableHeaderCellStyle, width: '80px', textAlign: 'center' }}>On Load</th>
                      <th style={{ ...tableHeaderCellStyle, width: '70px', textAlign: 'center' }}>Limit</th>
                      <th style={{ ...tableHeaderCellStyle, width: '80px', textAlign: 'center' }}>Mandatory</th>
                      <th style={{ ...tableHeaderCellStyle, width: '50px', textAlign: 'center' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filters.map((filter, index) => (
                      <tr 
                        key={filter.filterId || index} 
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, index)}
                        style={{ 
                          ...tableRowStyle,
                          cursor: 'grab',
                          background: dragOverIndex === index ? '#e0f2fe' : 'transparent',
                          opacity: draggedIndex === index ? 0.5 : 1,
                          transition: 'background 0.15s'
                        }}
                      >
                        <td style={{ ...tableCellStyle, textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                            <MdDragIndicator style={{ color: '#d1d5db', cursor: 'grab' }} />
                            <span style={levelBadgeStyle}>{getHierarchyLevel(filter.filterId)}</span>
                          </div>
                        </td>
                        <td style={tableCellStyle}>
                          <input
                            type="text"
                            value={filter.filterLabel || ''}
                            onChange={(e) => handleFilterChange(activeFilterBlock, activeSection, index, 'filterLabel', e.target.value)}
                            style={tableInputStyle}
                            placeholder="Filter name"
                          />
                        </td>
                        <td style={tableCellStyle}>
                          <input
                            type="text"
                            value={filter.colValue || ''}
                            onChange={(e) => handleFilterChange(activeFilterBlock, activeSection, index, 'colValue', e.target.value)}
                            style={{ ...tableInputStyle, fontSize: '11px', color: '#6b7280' }}
                            placeholder="col_value"
                          />
                        </td>
                        <td style={{ ...tableCellStyle, textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={filter.isMulti || false}
                            onChange={(e) => handleFilterChange(activeFilterBlock, activeSection, index, 'isMulti', e.target.checked)}
                            style={tableCheckboxStyle}
                          />
                        </td>
                        <td style={{ ...tableCellStyle, textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={filter.selectOnLoad || false}
                            onChange={(e) => handleFilterChange(activeFilterBlock, activeSection, index, 'selectOnLoad', e.target.checked)}
                            style={tableCheckboxStyle}
                          />
                        </td>
                        <td style={{ ...tableCellStyle, textAlign: 'center' }}>
                          <input
                            type="number"
                            value={filter.limit ?? ''}
                            onChange={(e) => handleFilterChange(activeFilterBlock, activeSection, index, 'limit', e.target.value ? parseInt(e.target.value) : null)}
                            style={tableLimitInputStyle}
                            placeholder="-"
                            min="1"
                          />
                        </td>
                        <td style={{ ...tableCellStyle, textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={filter.isMandatory || false}
                            onChange={(e) => handleFilterChange(activeFilterBlock, activeSection, index, 'isMandatory', e.target.checked)}
                            style={tableCheckboxStyle}
                          />
                        </td>
                        <td style={{ ...tableCellStyle, textAlign: 'center' }}>
                          <button
                            onClick={() => handleRemoveFilter(activeFilterBlock, activeSection, index)}
                            style={{ ...tableActionButtonStyle, color: '#dc2626' }}
                            title="Remove"
                          >
                            <MdDelete size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filters.length === 0 && (
                      <tr>
                        <td colSpan="8" style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
                          No filters configured. Click "Add Filter" to create one.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right Panel - Live Preview / JSON */}
          <div style={rightPanelStyle}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MdVisibility size={16} style={{ color: '#6b7280' }} />
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase' }}>
                  {rightPanelView === 'preview' ? 'Live Preview' : 'JSON Output'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  onClick={() => setRightPanelView('preview')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: '500',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    background: rightPanelView === 'preview' ? '#264CD7' : '#f3f4f6',
                    color: rightPanelView === 'preview' ? '#fff' : '#6b7280'
                  }}
                >
                  Preview
                </button>
                <button
                  onClick={() => setRightPanelView('json')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: '500',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    background: rightPanelView === 'json' ? '#264CD7' : '#f3f4f6',
                    color: rightPanelView === 'json' ? '#fff' : '#6b7280'
                  }}
                >
                  JSON
                </button>
              </div>
            </div>
            
            {rightPanelView === 'preview' ? (
              <div style={previewContainerStyle}>
                {/* Preview Header */}
                <div style={previewHeaderStyle}>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a2e' }}>All filters</span>
                </div>
                
                {/* Preview Tabs */}
                <div style={previewTabsStyle}>
                  {sections.map(section => (
                    <span
                      key={section}
                      style={{
                        ...previewTabStyle,
                        color: activeSection === section ? '#264CD7' : '#6b7280',
                        borderBottom: activeSection === section ? '2px solid #264CD7' : '2px solid transparent'
                      }}
                    >
                      {SECTION_NAMES[section] || section}
                    </span>
                  ))}
                </div>

                {/* Preview Filters */}
                <div style={previewFiltersStyle}>
                  <div style={previewFiltersGridStyle}>
                    {filters.map((filter, index) => (
                      <div key={index} style={previewFilterItemStyle}>
                        <label style={previewFilterLabelStyle}>
                          {filter.filterLabel}
                          {filter.isMandatory && <span style={{ color: '#dc2626' }}>*</span>}
                        </label>
                        <select disabled style={previewSelectStyle}>
                          <option>Select ...</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '16px', height: 'calc(100% - 50px)', overflow: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
                    bp_screen_hierarchies JSON
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(hierarchies, null, 2));
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
                  maxHeight: 'calc(100vh - 280px)'
                }}>
                  {JSON.stringify(hierarchies, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Styles
const overlayStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000
};

const modalStyle = {
  background: '#fff',
  borderRadius: '12px',
  width: '95%',
  maxWidth: '1400px',
  height: '90vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px 24px',
  borderBottom: '1px solid #e5e7eb',
  background: '#fafafa'
};

const idBadgeStyle = {
  background: '#e5e7eb',
  color: '#374151',
  fontSize: '11px',
  fontWeight: '600',
  padding: '4px 8px',
  borderRadius: '4px'
};

const unsavedBadgeStyle = {
  background: '#fef3c7',
  color: '#d97706',
  fontSize: '10px',
  fontWeight: '600',
  padding: '3px 8px',
  borderRadius: '4px',
  textTransform: 'uppercase'
};

const levelBadgeStyle = {
  background: '#eff6ff',
  color: '#264CD7',
  fontSize: '10px',
  fontWeight: '600',
  padding: '2px 6px',
  borderRadius: '3px',
  minWidth: '24px',
  textAlign: 'center'
};

const saveButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 16px',
  background: '#264CD7',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: '500',
  cursor: 'pointer'
};

const discardButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 16px',
  background: '#fef2f2',
  color: '#dc2626',
  border: '1px solid #fecaca',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: '500',
  cursor: 'pointer'
};

const regenerateButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 16px',
  background: '#f3f4f6',
  color: '#374151',
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: '500',
  cursor: 'pointer'
};

const closeButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '36px',
  height: '36px',
  background: 'transparent',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  cursor: 'pointer',
  color: '#6b7280'
};

const errorStyle = {
  padding: '12px 24px',
  background: '#fef2f2',
  color: '#dc2626',
  fontSize: '13px',
  borderBottom: '1px solid #fecaca'
};

const contentStyle = {
  display: 'flex',
  flex: 1,
  overflow: 'hidden'
};

const leftPanelStyle = {
  width: '200px',
  borderRight: '1px solid #e5e7eb',
  background: '#fafafa',
  overflow: 'auto'
};

const filterBlockItemStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  padding: '12px 16px',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: '500',
  transition: 'all 0.15s'
};

const centerPanelStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
};

const tabsContainerStyle = {
  display: 'flex',
  gap: '0',
  borderBottom: '1px solid #e5e7eb',
  padding: '0 24px',
  background: '#fff'
};

const tabButtonStyle = {
  padding: '14px 20px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontSize: '13px',
  transition: 'all 0.15s'
};

const filtersContainerStyle = {
  flex: 1,
  overflow: 'auto',
  padding: '20px 24px'
};

const filtersHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '16px'
};

const addFilterButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  padding: '6px 12px',
  background: '#f3f4f6',
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: '500',
  color: '#374151',
  cursor: 'pointer'
};

// Table styles
const tableContainerStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  overflow: 'hidden',
  background: '#fff'
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px'
};

const tableHeaderRowStyle = {
  background: '#f9fafb',
  borderBottom: '1px solid #e5e7eb'
};

const tableHeaderCellStyle = {
  padding: '10px 12px',
  textAlign: 'left',
  fontWeight: '600',
  fontSize: '11px',
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.03em'
};

const tableRowStyle = {
  borderBottom: '1px solid #f3f4f6',
  transition: 'background 0.1s'
};

const tableCellStyle = {
  padding: '8px 12px',
  verticalAlign: 'middle'
};

const tableInputStyle = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid #e5e7eb',
  borderRadius: '4px',
  fontSize: '13px',
  background: '#fff'
};

const tableCheckboxStyle = {
  width: '16px',
  height: '16px',
  cursor: 'pointer',
  accentColor: '#264CD7'
};

const tableLimitInputStyle = {
  width: '50px',
  padding: '4px 6px',
  border: '1px solid #e5e7eb',
  borderRadius: '4px',
  fontSize: '12px',
  textAlign: 'center'
};

const tableActionButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '24px',
  height: '24px',
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  color: '#6b7280',
  fontSize: '12px'
};

const rightPanelStyle = {
  width: '320px',
  borderLeft: '1px solid #e5e7eb',
  background: '#f9fafb',
  display: 'flex',
  flexDirection: 'column'
};

const previewContainerStyle = {
  flex: 1,
  overflow: 'auto',
  padding: '16px'
};

const previewHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '12px'
};

const previewTabsStyle = {
  display: 'flex',
  gap: '16px',
  marginBottom: '16px',
  borderBottom: '1px solid #e5e7eb',
  paddingBottom: '0'
};

const previewTabStyle = {
  fontSize: '12px',
  fontWeight: '500',
  paddingBottom: '8px',
  cursor: 'default'
};

const previewFiltersStyle = {
  background: '#fff',
  borderRadius: '8px',
  border: '1px solid #e5e7eb',
  padding: '16px'
};

const previewFiltersGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: '12px'
};

const previewFilterItemStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px'
};

const previewFilterLabelStyle = {
  fontSize: '12px',
  fontWeight: '500',
  color: '#374151'
};

const previewSelectStyle = {
  padding: '8px 10px',
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  fontSize: '12px',
  color: '#9ca3af',
  background: '#fff'
};

// Add Filter Dropdown styles
const addFilterDropdownStyle = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: '4px',
  background: '#fff',
  borderRadius: '8px',
  boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
  border: '1px solid #e5e7eb',
  minWidth: '250px',
  zIndex: 1001
};

const dropdownSectionHeaderStyle = {
  padding: '8px 12px',
  fontSize: '10px',
  fontWeight: '600',
  color: '#9ca3af',
  textTransform: 'uppercase',
  background: '#f9fafb',
  borderTop: '1px solid #e5e7eb'
};

const dropdownItemStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 12px',
  fontSize: '13px',
  color: '#374151',
  cursor: 'pointer',
  transition: 'background 0.1s'
};

const levelBadgeSmallStyle = {
  background: '#eff6ff',
  color: '#264CD7',
  fontSize: '9px',
  fontWeight: '600',
  padding: '2px 5px',
  borderRadius: '3px',
  minWidth: '20px',
  textAlign: 'center'
};

export default ScreenEditor;
