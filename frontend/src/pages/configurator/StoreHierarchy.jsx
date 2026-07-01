import React, { useState, useEffect, useRef } from 'react';
import { MdAdd, MdDelete, MdSave, MdInfo, MdRefresh, MdCheckCircle, MdEdit, MdDragIndicator } from 'react-icons/md';
import { api } from '../../api';

function StoreHierarchy({ scope }) {
  const [levels, setLevels] = useState([]);
  const [originalLevels, setOriginalLevels] = useState([]); // Track original state for change detection
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [schema, setSchema] = useState('base_pricing'); // Dynamic schema
  
  // Setup mode - when no levels exist, ask for count
  const [setupMode, setSetupMode] = useState(false);
  const [hierarchyCount, setHierarchyCount] = useState(5);
  
  // Label edit mode - enabled by clicking pencil in header
  const [labelEditMode, setLabelEditMode] = useState(false);
  
  // Tooltip state
  const [showTooltip, setShowTooltip] = useState(false);
  
  // Drag state
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  
  // Check if there are unsaved changes
  const hasChanges = JSON.stringify(levels) !== JSON.stringify(originalLevels);

  // Fetch data from bp_store_hierarchy_level table
  useEffect(() => {
    fetchLevels();
  }, []);

  // Helper: Convert label to display name (e.g., "leslies_zone" -> "Leslies Zone")
  const labelToDisplayName = (label) => {
    if (!label) return '';
    return label
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const fetchLevels = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch connection status to get schema
      try {
        const connectionStatus = await api.getConnectionStatus();
        if (connectionStatus.data.schema) {
          setSchema(connectionStatus.data.schema);
        }
      } catch (e) {
        console.log('Could not fetch schema from connection status');
      }
      
      const response = await api.getStoreHierarchy();
      console.log('Store API Response:', response);
      // api.getStoreHierarchy returns { success: true, data: [...] }
      // So response.data contains the array
      if (response.data && response.data.length > 0) {
        console.log('Loaded store levels:', response.data);
        
        // Process data: if store_hierarchy_level_value is empty but label exists, generate from label
        const processedLevels = response.data.map(level => ({
          ...level,
          store_hierarchy_level_value: level.store_hierarchy_level_value || labelToDisplayName(level.store_hierarchy_level_label) || ''
        }));
        
        // Data exists in DB - auto-fill the table
        setLevels(processedLevels);
        setOriginalLevels(JSON.parse(JSON.stringify(processedLevels))); // Deep copy for comparison
        setSetupMode(false);
      } else {
        // No data in DB - show setup mode to ask for level count
        setSetupMode(true);
        setLevels([]);
      }
    } catch (err) {
      console.error('Failed to fetch store hierarchy:', err);
      // Show error to user instead of silently going to setup mode
      const errorMsg = err.response?.data?.detail || err.message || 'Failed to fetch data';
      setError(`Error loading data: ${errorMsg}. Please reconnect to database.`);
      setSetupMode(false); // Don't show setup mode on error - show error instead
      setLevels([]);
    } finally {
      setLoading(false);
    }
  };

  // Generate empty levels based on count
  const generateLevels = () => {
    setError(null); // Clear any previous errors
    const newLevels = [];
    for (let i = 0; i < hierarchyCount; i++) {
      newLevels.push({
        store_hierarchy_level_id: i,
        store_hierarchy_level_value: '',
        store_hierarchy_level_label: '',
        is_cascading: i < hierarchyCount - 1, // All except last level cascade by default
        report_hierarchy_dropdown: i < 3 // First 3 levels show in report dropdown
      });
    }
    setLevels(newLevels);
    setSetupMode(false);
  };

  // Standardize display name: replace underscores with spaces, trim, preserve caps
  const formatDisplayName = (value) => {
    return value
      .replace(/_/g, ' ')      // Replace underscores with spaces
      .replace(/\s+/g, ' ')    // Replace multiple spaces with single space
      .trim();
  };

  // Generate label from display name: lowercase, spaces to underscores
  const generateLabel = (displayName) => {
    return displayName.toLowerCase().replace(/\s+/g, '_').trim();
  };

  const handleValueChange = (index, value) => {
    const updated = [...levels];
    // Don't format while typing - allow spaces. Only format on save.
    const currentLabel = updated[index].store_hierarchy_level_label || '';
    const currentValue = updated[index].store_hierarchy_level_value || '';
    
    updated[index].store_hierarchy_level_value = value;
    
    // Only auto-update label if it's empty or matches the auto-generated version
    // This preserves manually edited labels
    const wasAutoGenerated = !currentLabel || currentLabel === generateLabel(formatDisplayName(currentValue));
    if (wasAutoGenerated && value.trim()) {
      updated[index].store_hierarchy_level_label = generateLabel(formatDisplayName(value));
    }
    
    setLevels(updated);
  };

  const handleAddLevel = () => {
    const newId = levels.length;
    setLevels([...levels, {
      store_hierarchy_level_id: newId,
      store_hierarchy_level_value: '',
      store_hierarchy_level_label: '',
      is_cascading: false,
      report_hierarchy_dropdown: false
    }]);
  };

  const handleDeleteLevel = (index) => {
    const newLevels = levels.filter((_, i) => i !== index);
    // Re-index the levels
    newLevels.forEach((level, i) => {
      level.store_hierarchy_level_id = i;
    });
    setLevels(newLevels);
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

    const newLevels = [...levels];
    const [removed] = newLevels.splice(draggedIndex, 1);
    newLevels.splice(dropIndex, 0, removed);
    
    // Re-index all levels
    newLevels.forEach((level, i) => {
      level.store_hierarchy_level_id = i;
    });
    
    setLevels(newLevels);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleSave = async () => {
    // Validate all values are filled
    const emptyValues = levels.filter(l => !l.store_hierarchy_level_value.trim());
    if (emptyValues.length > 0) {
      setError('Please fill in all hierarchy level names before saving');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      
      // Format display names and generate labels only if not already set
      const levelsToSave = levels.map(level => ({
        ...level,
        store_hierarchy_level_value: formatDisplayName(level.store_hierarchy_level_value),
        // Preserve manually edited label, or generate from display name if empty
        store_hierarchy_level_label: level.store_hierarchy_level_label?.trim() || generateLabel(level.store_hierarchy_level_value)
      }));

      await api.saveStoreHierarchy(levelsToSave);
      setSuccessMessage('Store hierarchy saved successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
      fetchLevels();
    } catch (err) {
      console.error('Failed to save:', err);
      setError('Failed to save changes: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSaving(false);
    }
  };

  const updateLevel = (index, field, value) => {
    const updated = [...levels];
    updated[index][field] = value;
    setLevels(updated);
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
        Loading store hierarchy...
      </div>
    );
  }

  // Setup mode - ask for count
  if (setupMode) {
    return (
      <div>
        <div style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '32px',
          textAlign: 'center',
          maxWidth: '500px',
          margin: '0 auto'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            background: '#fef3c7',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px'
          }}>
            <MdInfo size={32} style={{ color: '#d97706' }} />
          </div>
          <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#1a1a2e', marginBottom: '8px' }}>
            Set Up Store Hierarchy
          </h3>
          <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>
            How many store hierarchy levels does this client have?
          </p>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '20px' }}>
            <input
              type="number"
              min="1"
              max="12"
              value={hierarchyCount}
              onChange={(e) => setHierarchyCount(parseInt(e.target.value) || 1)}
              style={{
                width: '80px',
                padding: '12px 16px',
                fontSize: '18px',
                fontWeight: '600',
                textAlign: 'center',
                border: '2px solid #e2e8f0',
                borderRadius: '8px',
                outline: 'none'
              }}
            />
            <span style={{ color: '#6b7280', fontSize: '14px' }}>levels</span>
          </div>
          
          <button
            onClick={generateLevels}
            style={{
              ...saveButtonStyle,
              padding: '12px 32px',
              fontSize: '15px'
            }}
          >
            Generate Hierarchy Table
          </button>
          
          <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '16px' }}>
            You can add or remove levels later
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Compact Header - Impact UI Style */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px',
        background: 'white',
        borderRadius: '10px',
        border: '1px solid #e2e8f0',
        marginBottom: '16px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <MdCheckCircle size={20} style={{ color: '#22c55e' }} />
          <span style={{ fontWeight: '500', color: '#1a1a2e', fontSize: '15px' }}>
            {levels.length} Level{levels.length !== 1 ? 's' : ''}
          </span>
          <span style={{ color: '#94a3b8' }}>·</span>
          <code style={{ 
            fontSize: '13px', 
            color: '#64748b',
            background: '#f1f5f9',
            padding: '4px 8px',
            borderRadius: '4px'
          }}>
            {schema}.bp_store_hierarchy_level
          </code>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button style={iconButtonStyle} onClick={fetchLevels} title="Refresh">
            <MdRefresh size={18} />
          </button>
          <button style={secondaryButtonStyle} onClick={handleAddLevel}>
            <MdAdd size={16} style={{ marginRight: '4px' }} />
            Add Level
          </button>
          {hasChanges && (
            <>
              <button 
                style={discardButtonStyle} 
                onClick={() => {
                  setLevels(JSON.parse(JSON.stringify(originalLevels)));
                  setError(null);
                }}
              >
                Discard
              </button>
              <button style={saveButtonStyle} onClick={handleSave} disabled={saving}>
                <MdSave size={16} style={{ marginRight: '4px' }} />
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          )}
          <button
            onClick={() => setSetupMode(true)}
            style={resetButtonStyle}
            title="Reset and reconfigure"
          >
            Reset
          </button>
        </div>
      </div>

      {successMessage && (
        <div style={{ padding: '12px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', color: '#166534', marginBottom: '16px', fontSize: '14px' }}>
          {successMessage}
        </div>
      )}

      {error && (
        <div style={{ padding: '12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#dc2626', marginBottom: '16px', fontSize: '14px' }}>
          {error}
        </div>
      )}

      {/* Hierarchy Table */}
      <div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ ...thStyle, width: '70px' }}>Level</th>
              <th style={thStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  Hierarchy Display
                  <div style={{ position: 'relative' }}>
                    <button
                      onMouseEnter={() => setShowTooltip(true)}
                      onMouseLeave={() => setShowTooltip(false)}
                      style={{
                        padding: '2px',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'help',
                        color: '#94a3b8',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                    >
                      <MdInfo size={16} />
                    </button>
                    {showTooltip && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        marginTop: '8px',
                        padding: '10px 12px',
                        background: '#1a1a2e',
                        color: '#fff',
                        fontSize: '12px',
                        borderRadius: '6px',
                        width: '280px',
                        zIndex: 100,
                        lineHeight: '1.5',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                      }}>
                        On save: underscores (_) are replaced with spaces and extra spaces are trimmed. Capitalization is preserved (e.g., SKU stays SKU, MASTER_SKU → MASTER SKU).
                        <div style={{
                          position: 'absolute',
                          top: '-6px',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          width: 0,
                          height: 0,
                          borderLeft: '6px solid transparent',
                          borderRight: '6px solid transparent',
                          borderBottom: '6px solid #1a1a2e'
                        }} />
                      </div>
                    )}
                  </div>
                </div>
              </th>
              <th style={thStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  Hierarchy Label
                  <button
                    onClick={() => setLabelEditMode(!labelEditMode)}
                    style={{
                      padding: '4px',
                      background: labelEditMode ? '#264CD7' : 'transparent',
                      border: labelEditMode ? 'none' : '1px solid #d1d5db',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      color: labelEditMode ? '#fff' : '#6b7280',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title={labelEditMode ? 'Disable editing' : 'Enable editing'}
                  >
                    <MdEdit size={14} />
                  </button>
                </div>
              </th>
              <th style={{ ...thStyle, width: '80px', textAlign: 'center' }}>Cascading</th>
              <th style={{ ...thStyle, width: '90px', textAlign: 'center' }}>Reporting</th>
              <th style={{ ...thStyle, width: '40px', textAlign: 'center' }}></th>
            </tr>
          </thead>
          <tbody>
            {levels.map((level, index) => (
              <tr 
                key={index} 
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                style={{ 
                  borderBottom: '1px solid #e0e0e0',
                  cursor: 'grab',
                  background: dragOverIndex === index ? '#e0f2fe' : 'transparent',
                  transition: 'background 0.15s'
                }}
              >
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <MdDragIndicator size={18} style={{ color: '#94a3b8', cursor: 'grab' }} />
                    <span style={{ fontWeight: '600', color: '#6b7280' }}>{index}</span>
                  </div>
                </td>
                <td style={tdStyle}>
                  <input
                    type="text"
                    value={level.store_hierarchy_level_value || ''}
                    onChange={(e) => handleValueChange(index, e.target.value)}
                    style={inputStyle}
                    placeholder="e.g., Leslies Zone"
                  />
                </td>
                <td style={tdStyle}>
                  {labelEditMode ? (
                    <input
                      type="text"
                      value={level.store_hierarchy_level_label || ''}
                      onChange={(e) => updateLevel(index, 'store_hierarchy_level_label', e.target.value)}
                      style={{
                        ...inputStyle,
                        fontFamily: 'monospace'
                      }}
                      placeholder="e.g., leslies_zone"
                    />
                  ) : (
                    <div style={{
                      padding: '8px 12px',
                      background: '#f1f5f9',
                      borderRadius: '6px',
                      fontSize: '13px',
                      color: '#64748b',
                      fontFamily: 'monospace'
                    }}>
                      {level.store_hierarchy_level_label || '—'}
                    </div>
                  )}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={level.is_cascading || false}
                    onChange={(e) => updateLevel(index, 'is_cascading', e.target.checked)}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    title="Is this a cascading/dependent filter?"
                  />
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={level.report_hierarchy_dropdown || false}
                    onChange={(e) => updateLevel(index, 'report_hierarchy_dropdown', e.target.checked)}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    title="Show in report hierarchy dropdown?"
                  />
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <button 
                    style={deleteButtonStyle} 
                    onClick={(e) => { e.stopPropagation(); handleDeleteLevel(index); }}
                    title="Delete level"
                  >
                    <MdDelete size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle = { padding: '12px 16px', textAlign: 'left', fontWeight: '600', fontSize: '13px', color: '#374151' };
const tdStyle = { padding: '10px 12px', fontSize: '14px', color: '#333' };
const inputStyle = { width: '100%', minWidth: '150px', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d0d0d0', fontSize: '14px', boxSizing: 'border-box' };
const saveButtonStyle = { display: 'flex', alignItems: 'center', padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#264CD7', color: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '500' };
const discardButtonStyle = { display: 'flex', alignItems: 'center', padding: '8px 16px', borderRadius: '6px', border: '1px solid #d0d0d0', background: '#fff', color: '#374151', cursor: 'pointer', fontSize: '14px', fontWeight: '500' };
const resetButtonStyle = { display: 'flex', alignItems: 'center', padding: '8px 14px', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#f8fafc', color: '#64748b', cursor: 'pointer', fontSize: '13px', fontWeight: '500' };
const secondaryButtonStyle = { display: 'flex', alignItems: 'center', padding: '8px 16px', borderRadius: '6px', border: '1px solid #d0d0d0', background: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: '500', color: '#374151' };
const iconButtonStyle = { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', color: '#64748b' };
const deleteButtonStyle = { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', borderRadius: '4px', border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', opacity: 0.6, transition: 'opacity 0.15s' };

export default StoreHierarchy;
