import React, { useState, useEffect, useMemo } from 'react';
import { MdVisibility, MdDragIndicator, MdCheck, MdClose, MdRefresh, MdTableChart, MdEdit } from 'react-icons/md';
import { api } from '../../api';

// Screen definitions for table configuration
const SCREENS = [
  { id: 'product-details', name: 'Product Details', screen_id: 3 },
  // More screens can be added here later
];

// Generate dummy data based on column type
const generateDummyValue = (column, rowIndex) => {
  const suffix = rowIndex + 1;
  
  if (column.source === 'reporting_attributes') {
    if (column.attribute_id === 1040) return `SKU${10000 + suffix}`;
    if (column.attribute_id === 5) return `Product Name ${suffix}`;
    return `Value ${suffix}`;
  }
  
  if (column.source === 'product_hierarchy') {
    return `Dummy ${column.display_name} ${suffix}`;
  }
  
  if (column.source === 'product_attributes') {
    const name = column.column_name?.toLowerCase() || '';
    if (name.includes('active')) return rowIndex % 3 === 0 ? 'Inactive' : 'Active';
    if (name.includes('usable') || name.includes('eligib')) return rowIndex % 4 === 0 ? 'Ineligible' : 'Eligible';
    if (name.includes('size')) return (5 + rowIndex * 2.5).toFixed(2);
    if (name.includes('uom')) return ['LB', 'EA', 'OZ', 'KG'][rowIndex % 4];
    if (name.includes('cost') || name.includes('price') || name.includes('fee') || name.includes('rebate')) {
      return `$${(10 + rowIndex * 5.5).toFixed(2)}`;
    }
    return `Dummy ${column.display_name}`;
  }
  
  return `Value ${suffix}`;
};

// Column Section Component
function ColumnSection({ title, subtitle, columns, onToggle, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, draggedIndex, dragOverIndex, startIndex, showEditButton, onEditClick }) {
  if (columns.length === 0) return null;
  
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ 
        padding: '10px 12px', 
        background: '#f1f5f9',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>
            {title}
          </div>
          {subtitle && <div style={{ fontSize: '11px', color: '#94a3b8' }}>{subtitle}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: '#64748b', background: '#e2e8f0', padding: '2px 8px', borderRadius: '10px' }}>
            {columns.length}
          </span>
          {showEditButton && (
            <button
              onClick={onEditClick}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '24px',
                height: '24px',
                borderRadius: '4px',
                border: 'none',
                background: '#e0e7ff',
                color: '#4f46e5',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
              title="Edit Attribute Metadata"
            >
              <MdEdit size={14} />
            </button>
          )}
        </div>
      </div>
      {columns.map((column, idx) => {
        const globalIndex = startIndex + idx;
        return (
          <div
            key={column.id}
            draggable
            onDragStart={(e) => onDragStart(e, globalIndex)}
            onDragOver={(e) => onDragOver(e, globalIndex)}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, globalIndex)}
            onDragEnd={onDragEnd}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              background: dragOverIndex === globalIndex ? '#e0f2fe' : (idx % 2 === 0 ? '#fff' : '#f8fafc'),
              borderBottom: '1px solid #f1f5f9',
              cursor: 'grab',
              opacity: draggedIndex === globalIndex ? 0.5 : 1,
              transition: 'background 0.15s'
            }}
          >
            <MdDragIndicator style={{ color: '#cbd5e1', cursor: 'grab', fontSize: '16px' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ 
                fontSize: '13px', 
                fontWeight: '500', 
                color: '#1a1a1a',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {column.display_name}
              </div>
            </div>
            <button
              onClick={() => onToggle(column.id)}
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '6px',
                border: 'none',
                background: column.is_enabled ? '#dcfce7' : '#f3f4f6',
                color: column.is_enabled ? '#16a34a' : '#9ca3af',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {column.is_enabled ? <MdCheck size={14} /> : <MdClose size={14} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function TableConfiguration({ scope }) {
  const [selectedScreen, setSelectedScreen] = useState(null);
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showPreview, setShowPreview] = useState(true);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [showMetadataEditor, setShowMetadataEditor] = useState(false);
  
  // Metadata editor state
  const [metadata, setMetadata] = useState([]);
  const [metadataSchema, setMetadataSchema] = useState([]); // Dynamic columns from DDL
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState(null);
  const [editedRows, setEditedRows] = useState({}); // Track which rows have been edited
  const [saving, setSaving] = useState(false);

  // Base dropdown values
  const BASE_DATA_TYPES = ['text', 'float8', 'bool', 'date', 'varchar', 'int4', 'int8'];
  const BASE_INPUT_TYPES = ['text', 'checkbox', 'dropdown'];
  const BASE_DATA_FORMATS = [
    'currency-usd',
    'currency-usd-comma',
    'currency-usd-decimal',
    'currency-usd-comma-decimal',
    'currency-usd-format',
    'percentage',
    'percentage-decimal',
    'number',
    'number-decimal',
    'number-comma',
    'number-comma-decimal'
  ];

  // Compute unique dropdown values from metadata (merge base + any unique values from data)
  const dataTypeOptions = useMemo(() => {
    const fromData = metadata.map(row => row.data_type).filter(Boolean);
    const allValues = [...new Set([...BASE_DATA_TYPES, ...fromData])];
    return allValues.sort();
  }, [metadata]);

  const inputTypeOptions = useMemo(() => {
    const fromData = metadata.map(row => row.input_type).filter(Boolean);
    const allValues = [...new Set([...BASE_INPUT_TYPES, ...fromData])];
    return allValues.sort();
  }, [metadata]);

  const dataFormatOptions = useMemo(() => {
    const fromData = metadata.map(row => row.column_data_format).filter(Boolean);
    const allValues = [...new Set([...BASE_DATA_FORMATS, ...fromData])];
    return allValues.sort();
  }, [metadata]);

  // Load columns when screen is selected
  useEffect(() => {
    if (selectedScreen === 'product-details') {
      loadProductDetailsColumns();
    }
  }, [selectedScreen]);

  const loadProductDetailsColumns = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.getProductDetailsColumns();
      if (response.data.success) {
        setColumns(response.data.data || []);
      }
    } catch (err) {
      setError('Failed to load columns: ' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  const toggleColumn = (columnId) => {
    setColumns(prev => prev.map(col => 
      col.id === columnId ? { ...col, is_enabled: !col.is_enabled } : col
    ));
  };

  // Load metadata when editor opens
  const loadMetadata = async () => {
    try {
      setMetadataLoading(true);
      setMetadataError(null);
      
      // Load schema and data in parallel
      const [schemaResponse, dataResponse] = await Promise.all([
        api.getProductAttributesMetadataSchema(),
        api.getProductAttributesMetadataFull()
      ]);
      
      if (schemaResponse.data.success) {
        setMetadataSchema(schemaResponse.data.columns || []);
      }
      if (dataResponse.data.success) {
        setMetadata(dataResponse.data.data || []);
        setEditedRows({});
      }
    } catch (err) {
      setMetadataError('Failed to load metadata: ' + (err.response?.data?.detail || err.message));
    } finally {
      setMetadataLoading(false);
    }
  };

  // Open metadata editor
  const openMetadataEditor = () => {
    setShowMetadataEditor(true);
    loadMetadata();
  };

  // Handle metadata field change
  const handleMetadataChange = (attributeId, field, value) => {
    setMetadata(prev => prev.map(row => 
      row.attribute_id === attributeId ? { ...row, [field]: value } : row
    ));
    setEditedRows(prev => ({
      ...prev,
      [attributeId]: { ...(prev[attributeId] || {}), [field]: value }
    }));
  };

  // Save all edited metadata
  const saveMetadata = async () => {
    const updates = Object.entries(editedRows).map(([attributeId, changes]) => ({
      attribute_id: parseInt(attributeId),
      ...changes
    }));

    if (updates.length === 0) {
      setShowMetadataEditor(false);
      return;
    }

    try {
      setSaving(true);
      await api.bulkUpdateProductAttributesMetadata(updates);
      setEditedRows({});
      setShowMetadataEditor(false);
      // Reload columns to reflect changes
      if (selectedScreen === 'product-details') {
        loadProductDetailsColumns();
      }
    } catch (err) {
      setMetadataError('Failed to save: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
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

    const newColumns = [...columns];
    const [draggedCol] = newColumns.splice(draggedIndex, 1);
    newColumns.splice(dropIndex, 0, draggedCol);
    
    // Update order
    newColumns.forEach((col, idx) => col.order = idx);
    
    setColumns(newColumns);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const enabledColumns = columns.filter(c => c.is_enabled);
  const dummyRows = Array.from({ length: 25 }, (_, i) => i);

  // Group columns by source
  const primaryColumns = columns.filter(c => c.source === 'reporting_attributes');
  const hierarchyColumns = columns.filter(c => c.source === 'product_hierarchy');
  const attributeColumns = columns.filter(c => c.source === 'product_attributes');

  // Calculate start indices for drag/drop
  const primaryStartIndex = 0;
  const hierarchyStartIndex = primaryColumns.length;
  const attributeStartIndex = primaryColumns.length + hierarchyColumns.length;

  // Screen list view
  if (!selectedScreen) {
    return (
      <div>
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#1a1a1a', margin: '0 0 8px 0' }}>
            Select a Screen
          </h3>
          <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
            Choose a screen to configure its table columns
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {SCREENS.map(screen => (
            <div
              key={screen.id}
              onClick={() => setSelectedScreen(screen.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                padding: '16px 20px',
                background: '#fff',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                cursor: 'pointer',
                transition: 'all 0.15s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = '#264CD7'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = '#e2e8f0'}
            >
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748b'
              }}>
                <MdTableChart size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: '500', color: '#1a1a2e', fontSize: '15px' }}>
                  {screen.name}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  Configure table columns for this screen
                </div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Column configuration view
  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
        <button
          onClick={() => setSelectedScreen(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            borderRadius: '6px',
            border: '1px solid #e5e7eb',
            background: '#fff',
            cursor: 'pointer',
            fontSize: '16px',
            color: '#6b7280'
          }}
        >
          ←
        </button>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#1a1a1a', margin: '0 0 4px 0' }}>
            {SCREENS.find(s => s.id === selectedScreen)?.name} - Table Columns
          </h3>
          <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>
            Drag to reorder • Toggle to show/hide columns
          </p>
        </div>
        <button
          onClick={loadProductDetailsColumns}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 14px',
            borderRadius: '6px',
            border: '1px solid #e5e7eb',
            background: '#fff',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            color: '#374151'
          }}
        >
          <MdRefresh size={16} className={loading ? 'spin' : ''} />
          Refresh
        </button>
        <button
          onClick={() => setShowPreview(!showPreview)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 14px',
            borderRadius: '6px',
            border: '1px solid #e5e7eb',
            background: showPreview ? '#264CD7' : '#fff',
            cursor: 'pointer',
            fontSize: '13px',
            color: showPreview ? '#fff' : '#374151'
          }}
        >
          <MdVisibility size={16} />
          Preview
        </button>
      </div>

      {error && (
        <div style={{ 
          padding: '12px 16px', 
          background: '#fef2f2', 
          border: '1px solid #fecaca', 
          borderRadius: '8px', 
          color: '#dc2626',
          marginBottom: '16px',
          fontSize: '13px'
        }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
          Loading columns...
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '24px', height: 'calc(100vh - 280px)', minHeight: '500px' }}>
          {/* Column list - Sectioned */}
          <div style={{ width: '320px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ 
              background: '#fff', 
              borderRadius: '8px', 
              border: '1px solid #e2e8f0',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              height: '100%'
            }}>
              <div style={{ 
                padding: '12px 16px', 
                borderBottom: '1px solid #e2e8f0',
                background: '#fff',
                fontWeight: '600',
                fontSize: '13px',
                color: '#374151',
                flexShrink: 0
              }}>
                Available Columns ({columns.length})
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {/* Primary Section */}
                <ColumnSection
                  title="Primary"
                  subtitle="Key identifiers"
                  columns={primaryColumns}
                  onToggle={toggleColumn}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  draggedIndex={draggedIndex}
                  dragOverIndex={dragOverIndex}
                  startIndex={primaryStartIndex}
                />

                {/* Hierarchy Section */}
                <ColumnSection
                  title="Hierarchy"
                  subtitle="Product hierarchy levels"
                  columns={hierarchyColumns}
                  onToggle={toggleColumn}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  draggedIndex={draggedIndex}
                  dragOverIndex={dragOverIndex}
                  startIndex={hierarchyStartIndex}
                />

                {/* Attributes Section */}
                <ColumnSection
                  title="Attributes"
                  subtitle="Product attributes"
                  columns={attributeColumns}
                  onToggle={toggleColumn}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  draggedIndex={draggedIndex}
                  dragOverIndex={dragOverIndex}
                  startIndex={attributeStartIndex}
                  showEditButton={true}
                  onEditClick={openMetadataEditor}
                />
              </div>
            </div>
          </div>

          {/* Preview table */}
          {showPreview && (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ 
                background: '#fff', 
                borderRadius: '8px', 
                border: '1px solid #e2e8f0',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                height: '100%'
              }}>
                <div style={{ 
                  padding: '12px 16px', 
                  borderBottom: '1px solid #e2e8f0',
                  background: '#f8fafc',
                  fontWeight: '600',
                  fontSize: '13px',
                  color: '#374151',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexShrink: 0
                }}>
                  <span>Table Preview</span>
                  <span style={{ fontWeight: '400', color: '#6b7280' }}>
                    {enabledColumns.length} columns • {dummyRows.length} sample rows
                  </span>
                </div>
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <table style={{ 
                    width: '100%', 
                    borderCollapse: 'collapse',
                    fontSize: '12px'
                  }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        {enabledColumns.map(col => (
                          <th 
                            key={col.id}
                            style={{ 
                              padding: '10px 12px',
                              textAlign: 'left',
                              fontWeight: '600',
                              color: '#374151',
                              borderBottom: '2px solid #e2e8f0',
                              whiteSpace: 'nowrap',
                              position: 'sticky',
                              top: 0,
                              background: '#f8fafc'
                            }}
                          >
                            {col.display_name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dummyRows.map(rowIdx => (
                        <tr 
                          key={rowIdx}
                          style={{ 
                            background: rowIdx % 2 === 0 ? '#fff' : '#f9fafb'
                          }}
                        >
                          {enabledColumns.map(col => (
                            <td 
                              key={col.id}
                              style={{ 
                                padding: '10px 12px',
                                borderBottom: '1px solid #e2e8f0',
                                color: '#374151',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {generateDummyValue(col, rowIdx)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Metadata Editor Modal Placeholder */}
      {showMetadataEditor && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: '#fff',
            borderRadius: '12px',
            width: '95%',
            maxWidth: '1400px',
            maxHeight: '90vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#1a1a1a' }}>
                  Attribute Metadata Editor
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#6b7280' }}>
                  {metadata.length} attributes • {Object.keys(editedRows).length} modified
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {Object.keys(editedRows).length > 0 && (
                  <button
                    onClick={saveMetadata}
                    disabled={saving}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '6px',
                      border: 'none',
                      background: '#264CD7',
                      color: '#fff',
                      cursor: saving ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      fontWeight: '500',
                      opacity: saving ? 0.7 : 1
                    }}
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                )}
                <button
                  onClick={() => setShowMetadataEditor(false)}
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    cursor: 'pointer',
                    fontSize: '18px',
                    color: '#6b7280',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '0' }}>
              {metadataLoading ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                  Loading metadata...
                </div>
              ) : metadataError ? (
                <div style={{ padding: '20px', color: '#dc2626', textAlign: 'center' }}>
                  {metadataError}
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ minWidth: `${Math.max(1200, metadataSchema.length * 120)}px`, borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 }}>
                      <tr>
                        {metadataSchema.map((col, colIdx) => {
                          const isSticky = col.is_sticky;
                          const stickyLeft = col.column_name === 'attribute_id' ? 0 : col.column_name === 'attribute_name' ? '50px' : undefined;
                          return (
                            <th 
                              key={col.column_name}
                              style={{ 
                                padding: '8px 10px', 
                                textAlign: col.ui_type === 'checkbox' ? 'center' : 'left', 
                                borderBottom: '2px solid #e2e8f0', 
                                fontWeight: '600', 
                                color: '#374151', 
                                whiteSpace: 'nowrap',
                                minWidth: col.ui_type === 'json' || col.ui_type === 'array' ? '180px' : col.ui_type === 'checkbox' ? '60px' : '100px',
                                ...(isSticky ? { position: 'sticky', left: stickyLeft, background: '#f8fafc', zIndex: 2 } : {})
                              }}
                            >
                              {col.column_name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {metadata.map((row, idx) => {
                        const isEdited = !!editedRows[row.attribute_id];
                        const cellStyle = { padding: '6px 10px', borderBottom: '1px solid #e2e8f0' };
                        const inputStyle = { width: '100%', padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '12px' };
                        const checkboxStyle = { width: '14px', height: '14px', cursor: 'pointer' };
                        const selectStyle = { ...inputStyle, background: '#fff' };
                        const rowBg = isEdited ? '#fef3c7' : (idx % 2 === 0 ? '#fff' : '#f8fafc');
                        
                        return (
                          <tr key={row.attribute_id} style={{ background: rowBg }}>
                            {metadataSchema.map((col) => {
                              const colName = col.column_name;
                              const isSticky = col.is_sticky;
                              const stickyLeft = colName === 'attribute_id' ? 0 : colName === 'attribute_name' ? '50px' : undefined;
                              const value = row[colName];
                              
                              // Non-editable columns
                              if (!col.is_editable) {
                                let displayVal = value;
                                if (col.ui_type === 'datetime' && value) {
                                  displayVal = new Date(value).toLocaleDateString();
                                } else if (col.ui_type === 'array' && Array.isArray(value)) {
                                  displayVal = value.join(', ') || '-';
                                } else if (col.ui_type === 'json' && value) {
                                  displayVal = JSON.stringify(value);
                                }
                                return (
                                  <td 
                                    key={colName}
                                    style={{ 
                                      ...cellStyle, 
                                      color: '#6b7280', 
                                      fontSize: col.ui_type === 'json' || col.ui_type === 'array' ? '10px' : '12px',
                                      fontFamily: colName === 'attribute_name' || col.ui_type === 'json' ? 'monospace' : 'inherit',
                                      ...(isSticky ? { position: 'sticky', left: stickyLeft, background: rowBg, zIndex: 1 } : {})
                                    }}
                                  >
                                    {displayVal ?? '-'}
                                  </td>
                                );
                              }
                              
                              // Checkbox for boolean
                              if (col.ui_type === 'checkbox') {
                                return (
                                  <td key={colName} style={{ ...cellStyle, textAlign: 'center' }}>
                                    <input 
                                      type="checkbox" 
                                      checked={value || false} 
                                      onChange={(e) => handleMetadataChange(row.attribute_id, colName, e.target.checked)} 
                                      style={checkboxStyle} 
                                    />
                                  </td>
                                );
                              }
                              
                              // Number input
                              if (col.ui_type === 'number') {
                                return (
                                  <td key={colName} style={cellStyle}>
                                    <input 
                                      type="number" 
                                      value={value ?? ''} 
                                      onChange={(e) => handleMetadataChange(row.attribute_id, colName, e.target.value ? parseInt(e.target.value) : null)} 
                                      style={{ ...inputStyle, width: '70px', textAlign: 'center' }} 
                                    />
                                  </td>
                                );
                              }
                              
                              // JSON input
                              if (col.ui_type === 'json') {
                                return (
                                  <td key={colName} style={cellStyle}>
                                    <input 
                                      type="text" 
                                      value={value ? JSON.stringify(value) : ''} 
                                      onChange={(e) => { 
                                        try { 
                                          handleMetadataChange(row.attribute_id, colName, e.target.value ? JSON.parse(e.target.value) : null); 
                                        } catch {} 
                                      }} 
                                      style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '10px' }} 
                                      placeholder="JSON" 
                                    />
                                  </td>
                                );
                              }
                              
                              // Array input (editable as comma-separated)
                              if (col.ui_type === 'array') {
                                return (
                                  <td key={colName} style={cellStyle}>
                                    <input 
                                      type="text" 
                                      value={Array.isArray(value) ? value.join(', ') : (value || '')} 
                                      onChange={(e) => handleMetadataChange(row.attribute_id, colName, e.target.value ? e.target.value.split(',').map(s => s.trim()) : [])} 
                                      style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '10px' }} 
                                      placeholder="comma,separated" 
                                    />
                                  </td>
                                );
                              }
                              
                              // Select for known enum-like fields
                              if (colName === 'data_type') {
                                return (
                                  <td key={colName} style={cellStyle}>
                                    <select value={value || ''} onChange={(e) => handleMetadataChange(row.attribute_id, colName, e.target.value)} style={selectStyle}>
                                      <option value="">-</option>
                                      {dataTypeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                    </select>
                                  </td>
                                );
                              }
                              if (colName === 'input_type') {
                                return (
                                  <td key={colName} style={cellStyle}>
                                    <select value={value || ''} onChange={(e) => handleMetadataChange(row.attribute_id, colName, e.target.value)} style={selectStyle}>
                                      <option value="">-</option>
                                      {inputTypeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                    </select>
                                  </td>
                                );
                              }
                              if (colName === 'column_data_format') {
                                return (
                                  <td key={colName} style={cellStyle}>
                                    <select value={value || ''} onChange={(e) => handleMetadataChange(row.attribute_id, colName, e.target.value)} style={selectStyle}>
                                      <option value="">-</option>
                                      {dataFormatOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                    </select>
                                  </td>
                                );
                              }
                              if (colName === 'attribute_update_level') {
                                return (
                                  <td key={colName} style={cellStyle}>
                                    <select value={value || ''} onChange={(e) => handleMetadataChange(row.attribute_id, colName, e.target.value)} style={selectStyle}>
                                      <option value="">-</option>
                                      <option value="product">product</option>
                                      <option value="store">store</option>
                                      <option value="product_store">product_store</option>
                                    </select>
                                  </td>
                                );
                              }
                              
                              // Default: text input
                              return (
                                <td key={colName} style={cellStyle}>
                                  <input 
                                    type="text" 
                                    value={value || ''} 
                                    onChange={(e) => handleMetadataChange(row.attribute_id, colName, e.target.value)} 
                                    style={inputStyle} 
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TableConfiguration;
