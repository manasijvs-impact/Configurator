import React, { useState } from 'react';
import { MdCategory, MdStore, MdPeople, MdInfo, MdFilterList, MdTableChart } from 'react-icons/md';
import ProductHierarchy from './configurator/ProductHierarchy';
import StoreHierarchy from './configurator/StoreHierarchy';
import CustomerSegments from './configurator/CustomerSegments';
import ScreenConfiguration from './configurator/ScreenConfiguration';
import TableConfiguration from './configurator/TableConfiguration';

// Icons matching Data Validator style
const HierarchyIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="8" y="14" width="7" height="7" rx="1"/>
    <line x1="6.5" y1="10" x2="6.5" y2="14"/>
    <line x1="17.5" y1="10" x2="17.5" y2="14"/>
    <line x1="6.5" y1="14" x2="11.5" y2="14"/>
    <line x1="17.5" y1="14" x2="12.5" y2="14"/>
  </svg>
);

function ConfiguratorPage({ activeRoute, scope }) {
  const [activeModule, setActiveModule] = useState(null); // null = module list, 'hierarchy-setup' = hierarchy screen
  const [activeTab, setActiveTab] = useState('product-hierarchy');
  
  // Check if connected
  const isConnected = scope?.connection != null;

  // Setup tabs configuration
  const setupTabs = [
    { id: 'product-hierarchy', label: 'Product Hierarchy', icon: <MdCategory size={18} />, component: ProductHierarchy },
    { id: 'store-hierarchy', label: 'Store Hierarchy', icon: <MdStore size={18} />, component: StoreHierarchy },
    { id: 'customer-segments', label: 'Customer Segments', icon: <MdPeople size={18} />, component: CustomerSegments },
  ];

  // If not connected, show connection required (same as Data Validator)
  if (!isConnected) {
    return (
      <div className="page-container">
        <div style={{ padding: '60px 40px', textAlign: 'center' }}>
          <div style={{ 
            width: '80px', 
            height: '80px', 
            borderRadius: '50%', 
            background: '#fef3c7', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            margin: '0 auto 24px'
          }}>
            <MdInfo size={40} style={{ color: '#d97706' }} />
          </div>
          <h2 style={{ fontSize: '20px', fontWeight: '600', color: '#1a1a1a', marginBottom: '12px' }}>
            Database Connection Required
          </h2>
          <p style={{ fontSize: '14px', color: '#6b7280', maxWidth: '400px', margin: '0 auto' }}>
            Please connect to a database using the Application, Client, and Environment selectors above.
          </p>
        </div>
      </div>
    );
  }

  // Module list view (like Data Validator Workbench)
  if (!activeModule) {
    return (
      <div className="page-container">
        <h2 style={{ margin: '0 0 24px 0', color: '#1a1a2e', fontSize: '20px' }}>
          Screen Designer
        </h2>
        
        {/* Module Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Hierarchy Setup Module */}
          <div 
            onClick={() => setActiveModule('hierarchy-setup')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '16px 20px',
              background: 'white',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              cursor: 'pointer',
              transition: 'all 0.15s',
              boxShadow: '0 2px 4px rgba(0,0,0,0.04)'
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
              <HierarchyIcon />
            </div>
            <span style={{ flex: 1, fontWeight: '500', color: '#1a1a2e', fontSize: '15px' }}>
              Hierarchy Setup
            </span>
            <InfoTooltip text="Configure product hierarchy, store hierarchy, and customer segments" />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>

          {/* Filter Configuration Module */}
          <div 
            onClick={() => setActiveModule('filter-configuration')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '16px 20px',
              background: 'white',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              cursor: 'pointer',
              transition: 'all 0.15s',
              boxShadow: '0 2px 4px rgba(0,0,0,0.04)'
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
              <MdFilterList size={20} />
            </div>
            <span style={{ flex: 1, fontWeight: '500', color: '#1a1a2e', fontSize: '15px' }}>
              Filter Configuration
            </span>
            <InfoTooltip text="Configure filter hierarchies for all application screens" />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>

          {/* Table Configuration Module */}
          <div 
            onClick={() => setActiveModule('table-configuration')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '16px 20px',
              background: 'white',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              cursor: 'pointer',
              transition: 'all 0.15s',
              boxShadow: '0 2px 4px rgba(0,0,0,0.04)'
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
            <span style={{ flex: 1, fontWeight: '500', color: '#1a1a2e', fontSize: '15px' }}>
              Table Configuration
            </span>
            <InfoTooltip text="Configure table columns for application screens" />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        </div>
      </div>
    );
  }

  // Hierarchy Setup module view
  if (activeModule === 'hierarchy-setup') {
    const ActiveComponent = setupTabs.find(s => s.id === activeTab)?.component;

  return (
    <div className="page-container">
      {/* Back button + Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
        <button
          onClick={() => setActiveModule(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
            background: '#fff',
            cursor: 'pointer',
            fontSize: '18px',
            color: '#6b7280'
          }}
        >
          ←
        </button>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#1a1a1a', margin: 0 }}>
            Hierarchy Setup
          </h2>
          <p style={{ fontSize: '13px', color: '#6b7280', margin: '4px 0 0 0' }}>
            Configure product hierarchy, store hierarchy, and customer segments
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '24px',
        borderBottom: '1px solid #e5e7eb',
        paddingBottom: '0'
      }}>
        {setupTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #4f46e5' : '2px solid transparent',
              marginBottom: '-1px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: activeTab === tab.id ? '600' : '500',
              color: activeTab === tab.id ? '#4f46e5' : '#6b7280',
              transition: 'all 0.15s'
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Active Tab Content */}
      <div style={{
        background: '#fff',
        borderRadius: '12px',
        border: '1px solid #e5e7eb',
        padding: '24px'
      }}>
        {ActiveComponent && <ActiveComponent scope={scope} />}
      </div>
    </div>
  );
  }

  // Filter Configuration module view
  if (activeModule === 'filter-configuration') {
    return (
      <div className="page-container">
        {/* Back button + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <button
            onClick={() => setActiveModule(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '18px',
              color: '#6b7280'
            }}
          >
            ←
          </button>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#1a1a1a', margin: 0 }}>
              Filter Configuration
            </h2>
            <p style={{ fontSize: '13px', color: '#6b7280', margin: '4px 0 0 0' }}>
              Configure filter hierarchies for application screens
            </p>
          </div>
        </div>

        {/* Filter Configuration Content */}
        <div style={{
          background: '#fff',
          borderRadius: '12px',
          border: '1px solid #e5e7eb',
          padding: '24px'
        }}>
          <ScreenConfiguration scope={scope} />
        </div>
      </div>
    );
  }

  // Table Configuration module view
  if (activeModule === 'table-configuration') {
    return (
      <div className="page-container">
        {/* Back button + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <button
            onClick={() => setActiveModule(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '18px',
              color: '#6b7280'
            }}
          >
            ←
          </button>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#1a1a1a', margin: 0 }}>
              Table Configuration
            </h2>
            <p style={{ fontSize: '13px', color: '#6b7280', margin: '4px 0 0 0' }}>
              Configure table columns for application screens
            </p>
          </div>
        </div>

        {/* Table Configuration Content */}
        <div style={{
          background: '#fff',
          borderRadius: '12px',
          border: '1px solid #e5e7eb',
          padding: '24px'
        }}>
          <TableConfiguration scope={scope} />
        </div>
      </div>
    );
  }

  // Default - should not reach here
  return null;
}

// Info tooltip component (same as Data Validator)
function InfoTooltip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        style={{
          width: '22px',
          height: '22px',
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
      {show && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: '100%',
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
          {text}
        </div>
      )}
    </div>
  );
}

export default ConfiguratorPage;
