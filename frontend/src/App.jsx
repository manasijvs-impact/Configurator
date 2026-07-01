import React, { useState } from 'react';
import LoginPage from './pages/LoginPage';
import ConfiguratorPage from './pages/ConfiguratorPage';
import DataValidatorPage from './pages/DataValidatorPage';
import ConnectionDialog from './components/ConnectionDialog';
// MIGRATOR (added): isolated tool, lives entirely under src/migrator/.
import MigratorApp from './migrator/MigratorApp';

// Icons for sidebar
import { 
  MdDashboard, 
  MdSettings, 
  MdStorage, 
  MdAssessment,
  MdMenu,
  MdTableChart,
  MdList,
  MdCode,
  MdKeyboardArrowDown,
  MdCheckCircle,
  MdHelp,
  MdNotifications,
  MdAutoAwesome,
  MdLogout,
  MdExpandMore,
  MdLink,
  MdApi,
  MdClose
} from 'react-icons/md';

// Custom SVG Icons matching reference design
const ModuleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="18" rx="1"/>
    <line x1="14" y1="6" x2="21" y2="6"/>
    <line x1="14" y1="12" x2="21" y2="12"/>
    <line x1="14" y1="18" x2="21" y2="18"/>
  </svg>
);

const DecisionDashboardIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/>
    <rect x="14" y="14" width="7" height="7" rx="1"/>
  </svg>
);

const WorkbenchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
    <line x1="7" y1="7" x2="7.01" y2="7"/>
  </svg>
);

const RulesIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="2" x2="12" y2="6"/>
    <line x1="12" y1="18" x2="12" y2="22"/>
    <line x1="2" y1="12" x2="6" y2="12"/>
    <line x1="18" y1="12" x2="22" y2="12"/>
  </svg>
);

const ReportingIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <line x1="8" y1="15" x2="8" y2="21"/>
    <line x1="12" y1="11" x2="12" y2="21"/>
    <line x1="16" y1="7" x2="16" y2="21"/>
  </svg>
);

// Impact UI Theme Colors
const THEME = {
  sidebar: {
    bg: '#1a1a2e',
    bgHover: '#252543',
    activeIndicator: '#00d9ff',
    text: '#ffffff',
    textMuted: '#8b8ba7'
  },
  primary: '#264CD7',
  primaryLight: '#4361ee',
  accent: '#00d9ff',
  success: '#10b981',
  background: '#f5f7fa',
  surface: '#ffffff',
  border: '#e5e7eb',
  text: {
    primary: '#1a1a2e',
    secondary: '#6b7280',
    muted: '#9ca3af'
  }
};

// Application options
const APPLICATIONS = [
  { value: 'base_smart', label: 'Base Smart' },
  { value: 'base_smart_restaurant', label: 'Base Smart Restaurant' }
];

// Client options per application
const CLIENTS = {
  base_smart: [
    { value: 'leslies', label: 'Leslies' },
    { value: 'crackerbarrel', label: 'Crackerbarrel' },
    { value: 'impactprice-poc-replica', label: 'impactprice-poc-replica (Coppel)' },
    { value: 'impactprice-poc', label: 'impactprice-poc (Pandora)' }
  ],
  base_smart_restaurant: [
    { value: 'leslies', label: 'Leslies' },
    { value: 'crackerbarrel', label: 'Crackerbarrel' },
    { value: 'impactprice-poc-replica', label: 'impactprice-poc-replica (Coppel)' },
    { value: 'impactprice-poc', label: 'impactprice-poc (Pandora)' }
  ]
};

// Environment options
const ENVIRONMENTS = [
  { value: 'dev', label: 'Development' },
  { value: 'test', label: 'Test' },
  { value: 'uat', label: 'UAT' },
  { value: 'prod', label: 'Production' }
];

function App() {
  // Auth state
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('ia_user');
    return saved ? JSON.parse(saved) : null;
  });
  
  // Tool & Navigation state
  const [activeTool, setActiveTool] = useState('configurator'); // 'configurator' or 'data-validator'
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeRoute, setActiveRoute] = useState('screen-designer');
  
  // Scope selection state
  const [selectedApp, setSelectedApp] = useState('');
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedEnv, setSelectedEnv] = useState('');
  
  // Connection state
  const [showConnectionDialog, setShowConnectionDialog] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState(null);
  const [pendingScope, setPendingScope] = useState(null);
  
  // Expanded modules state for sidebar (must be declared with other hooks)
  const [expandedSidebarModules, setExpandedSidebarModules] = useState(['reporting']);

  const handleLogin = (userData) => {
    setUser(userData);
    localStorage.setItem('ia_user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    setConnectionInfo(null);
    setSelectedApp('');
    setSelectedClient('');
    setSelectedEnv('');
    localStorage.removeItem('ia_user');
  };

  const handleAppChange = (e) => {
    setSelectedApp(e.target.value);
    setSelectedClient('');
    setSelectedEnv('');
    setConnectionInfo(null);
  };

  const handleClientChange = (e) => {
    setSelectedClient(e.target.value);
    setSelectedEnv('');
    setConnectionInfo(null);
  };

  const handleEnvChange = (e) => {
    const newEnv = e.target.value;
    if (newEnv && selectedApp && selectedClient) {
      // Store pending scope and show connection dialog
      setPendingScope({ app: selectedApp, client: selectedClient, env: newEnv });
      setShowConnectionDialog(true);
    } else {
      setSelectedEnv('');
      setConnectionInfo(null);
    }
  };

  const handleConnectionSuccess = (connInfo) => {
    setConnectionInfo(connInfo);
    // Update app if changed in dialog
    if (connInfo.app && connInfo.app !== pendingScope.app) {
      setSelectedApp(connInfo.app);
    }
    setSelectedEnv(pendingScope.env);
    setShowConnectionDialog(false);
    setPendingScope(null);
  };

  const handleConnectionCancel = () => {
    setShowConnectionDialog(false);
    setPendingScope(null);
  };

  const handleDisconnect = () => {
    setConnectionInfo(null);
    setSelectedEnv('');
  };

  const isScopeSelected = selectedApp && selectedClient && selectedEnv && connectionInfo;

  // Not logged in - show login page
  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const toggleSidebarModule = (moduleId) => {
    setExpandedSidebarModules(prev => 
      prev.includes(moduleId) 
        ? prev.filter(id => id !== moduleId)
        : [...prev, moduleId]
    );
  };

  // Sidebar routes based on active tool
  const getSidebarRoutes = () => {
    if (activeTool === 'configurator') {
      return [
        { label: 'Dashboard', value: 'dashboard', icon: <MdDashboard size={20} />, disabled: true },
        { label: 'Screen Designer', value: 'screen-designer', icon: <MdTableChart size={20} /> }
      ];
    }
    
    if (activeTool === 'data-validator') {
      return [
        { label: 'Decision Dashboard', value: 'decision-dashboard', icon: <DecisionDashboardIcon /> },
        { label: 'Workbench', value: 'workbench', icon: <WorkbenchIcon /> },
        { label: 'Rules', value: 'rules', icon: <RulesIcon /> },
        { 
          label: 'Reporting', 
          value: 'reporting', 
          icon: <ReportingIcon />,
          subItems: [
            { label: 'Exception Report', value: 'exception-report' },
            { label: 'Competitor positioning', value: 'competitor-positioning' }
          ]
        }
      ];
    }

    return [];
  };

  return (
    <div className="app-container">
      {/* Left Sidebar */}
      <aside style={{
        width: sidebarOpen ? '240px' : '64px',
        background: THEME.sidebar.bg,
        color: THEME.sidebar.text,
        transition: 'width 0.2s ease',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        minHeight: '100vh'
      }}>
        {/* Sidebar Header - Module Icon */}
        <div style={{ 
          padding: '16px', 
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarOpen ? 'flex-start' : 'center',
          height: '64px'
        }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              background: 'transparent',
              border: '2px solid #3d3d5c',
              color: THEME.sidebar.text,
              cursor: 'pointer',
              padding: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '10px',
              transition: 'all 0.15s'
            }}
          >
            {sidebarOpen ? <ModuleIcon /> : <MdMenu size={22} />}
          </button>
        </div>
        
        {/* Navigation */}
        <nav style={{ flex: 1, paddingTop: '8px' }}>
          {getSidebarRoutes().map((route) => {
            const isActive = activeRoute === route.value || (route.subItems && route.subItems.some(s => s.value === activeRoute));
            const hasSubItems = route.subItems && route.subItems.length > 0;
            const isExpanded = expandedSidebarModules.includes(route.value);
            const isDisabled = route.disabled;
            
            return (
              <div key={route.value}>
                <button
                  onClick={() => {
                    if (isDisabled) return;
                    if (hasSubItems) {
                      toggleSidebarModule(route.value);
                    } else {
                      setActiveRoute(route.value);
                    }
                  }}
                  title={isDisabled ? `${route.label} (Coming Soon)` : route.label}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    width: '100%',
                    padding: sidebarOpen ? '14px 24px' : '14px',
                    background: (isActive && !hasSubItems && !isDisabled) ? '#252543' : 'transparent',
                    border: 'none',
                    color: isDisabled ? '#4a4a6a' : (isActive ? '#ffffff' : '#8b8ba7'),
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                    fontSize: '14px',
                    fontWeight: isActive ? '500' : '400',
                    justifyContent: sidebarOpen ? 'flex-start' : 'center',
                    transition: 'all 0.15s ease',
                    borderLeft: `4px solid ${(isActive && !hasSubItems && !isDisabled) ? '#10b981' : 'transparent'}`,
                    opacity: isDisabled ? 0.5 : 1
                  }}
                >
                  <span style={{ 
                    display: 'flex', 
                    alignItems: 'center',
                    color: isDisabled ? '#4a4a6a' : (isActive ? '#10b981' : '#8b8ba7')
                  }}>
                    {route.icon}
                  </span>
                  {sidebarOpen && <span style={{ flex: 1 }}>{route.label}</span>}
                  {sidebarOpen && hasSubItems && (
                    <MdExpandMore 
                      size={18} 
                      style={{ 
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s'
                      }} 
                    />
                  )}
                </button>
                
                {/* Sub-items */}
                {sidebarOpen && hasSubItems && isExpanded && (
                  <div style={{ 
                    marginLeft: '44px', 
                    borderLeft: '1px solid rgba(255,255,255,0.1)',
                    paddingLeft: '12px',
                    marginTop: '4px',
                    marginBottom: '8px'
                  }}>
                    {route.subItems.map(sub => {
                      const isSubActive = activeRoute === sub.value;
                      return (
                        <button
                          key={sub.value}
                          onClick={() => setActiveRoute(sub.value)}
                          style={{
                            display: 'block',
                            width: '100%',
                            padding: '10px 16px',
                            background: isSubActive ? 'rgba(38, 76, 215, 0.2)' : 'transparent',
                            border: 'none',
                            borderRadius: '6px',
                            color: isSubActive ? '#ffffff' : '#8b8ba7',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '13px',
                            marginBottom: '2px',
                            transition: 'all 0.15s'
                          }}
                        >
                          {sub.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Bottom - Logout */}
        <div style={{ 
          padding: '16px',
          borderTop: '1px solid #2a2a4e'
        }}>
          <button
            onClick={handleLogout}
            title="Logout"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: sidebarOpen ? 'flex-start' : 'center',
              gap: '16px',
              width: '100%',
              padding: '14px 20px',
              background: 'transparent',
              border: 'none',
              color: '#10b981',
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.15s ease'
            }}
          >
            <MdLogout size={20} />
            {sidebarOpen && <span>Logout</span>}
          </button>
        </div>
      </aside>
      
      <div className="main-layout">
        {/* Top Header */}
        <header style={{
          background: THEME.surface,
          borderBottom: `1px solid ${THEME.border}`,
          padding: '10px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          height: '56px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            {/* Logo */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <img 
                src="/logo.svg" 
                alt="Impact Analytics" 
                style={{ height: '24px' }}
              />
            </div>
            
            {/* Tool Switcher Dropdown */}
            <div style={{ position: 'relative' }}>
              <select
                value={activeTool}
                onChange={(e) => {
                  setActiveTool(e.target.value);
                  setActiveRoute(e.target.value === 'configurator' ? 'screen-designer' : 'decision-dashboard');
                }}
                style={{
                  padding: '8px 36px 8px 14px',
                  borderRadius: '6px',
                  border: `1px solid ${THEME.border}`,
                  fontSize: '14px',
                  fontWeight: '500',
                  background: THEME.surface,
                  cursor: 'pointer',
                  appearance: 'none',
                  minWidth: '150px',
                  color: THEME.text.primary
                }}
              >
                <option value="configurator">Configurator</option>
                <option value="data-validator">Data Validator</option>
                <option value="migrator">Migrator</option>
              </select>
              <MdKeyboardArrowDown 
                size={18} 
                style={{ 
                  position: 'absolute', 
                  right: '10px', 
                  top: '50%', 
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                  color: THEME.text.secondary
                }} 
              />
            </div>
          </div>
          
          {/* Right side - Actions & User */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button style={iconButtonStyle} title="Help">
              <MdHelp size={20} />
            </button>
            <button style={iconButtonStyle} title="Notifications">
              <MdNotifications size={20} />
            </button>
            <button style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              background: THEME.primary,
              color: '#fff',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              transition: 'background 0.15s'
            }}>
              <MdAutoAwesome size={16} />
              Ask Alan
            </button>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: THEME.success,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: '600',
              fontSize: '14px',
              cursor: 'pointer'
            }} title={user?.name || 'User'}>
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </div>
          </div>
        </header>

        {/* Sub-header with scope selectors */}
        {/* MIGRATOR (added): scope sub-header hidden on the migrator tab, which has its own header */}
        {activeTool !== 'migrator' && (
        <div style={{
          background: THEME.background,
          borderBottom: `1px solid ${THEME.border}`,
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MdSettings size={18} style={{ color: THEME.primary }} />
              <span style={{ fontWeight: '500', color: THEME.primary, fontSize: '14px' }}>
                {activeTool === 'configurator' ? 'Configurator' : 'Data Validator'}
              </span>
            </div>
            
            <div style={{ display: 'flex', gap: '20px' }}>
              {/* Application Select */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: THEME.text.secondary, marginBottom: '4px', fontWeight: '500' }}>
                  Application
                </label>
                <select
                  value={selectedApp}
                  onChange={handleAppChange}
                  style={selectStyle}
                >
                  <option value="">Select</option>
                  {APPLICATIONS.map(app => (
                    <option key={app.value} value={app.value}>{app.label}</option>
                  ))}
                </select>
              </div>
              
              {/* Client Select */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: THEME.text.secondary, marginBottom: '4px', fontWeight: '500' }}>
                  Client
                </label>
                <select
                  value={selectedClient}
                  onChange={handleClientChange}
                  disabled={!selectedApp}
                  style={{
                    ...selectStyle,
                    background: !selectedApp ? '#f5f5f5' : THEME.surface,
                    color: !selectedApp ? THEME.text.muted : THEME.text.primary,
                    cursor: !selectedApp ? 'not-allowed' : 'pointer'
                  }}
                >
                  <option value="">{selectedApp ? 'Select' : 'Select App first'}</option>
                  {selectedApp && CLIENTS[selectedApp]?.map(client => (
                    <option key={client.value} value={client.value}>{client.label}</option>
                  ))}
                </select>
              </div>
              
              {/* Environment Select */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: THEME.text.secondary, marginBottom: '4px', fontWeight: '500' }}>
                  Environment
                </label>
                <select
                  value={selectedEnv}
                  onChange={handleEnvChange}
                  disabled={!selectedClient}
                  style={{
                    ...selectStyle,
                    background: !selectedClient ? '#f5f5f5' : THEME.surface,
                    color: !selectedClient ? THEME.text.muted : THEME.text.primary,
                    cursor: !selectedClient ? 'not-allowed' : 'pointer',
                    borderColor: connectionInfo ? '#10b981' : undefined
                  }}
                >
                  <option value="">{selectedClient ? 'Select' : 'Select Client first'}</option>
                  {ENVIRONMENTS.map(env => (
                    <option key={env.value} value={env.value}>{env.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          
          {/* Connection Status Badge - Right aligned */}
          {connectionInfo && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px',
              padding: '6px 12px',
              background: '#dcfce7',
              borderRadius: '20px',
              border: '1px solid #86efac'
            }}>
              <MdCheckCircle size={16} style={{ color: '#16a34a' }} />
              <span style={{ fontSize: '13px', color: '#166534', fontWeight: '500' }}>
                {connectionInfo.instanceName}
              </span>
              <button
                onClick={handleDisconnect}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  color: '#166534'
                }}
                title="Disconnect"
              >
                <MdClose size={16} />
              </button>
            </div>
          )}
        </div>
        )}
        
        {/* Connection Dialog */}
        {showConnectionDialog && pendingScope && (
          <ConnectionDialog
            scope={pendingScope}
            onConnect={handleConnectionSuccess}
            onCancel={handleConnectionCancel}
          />
        )}
        
        {/* Main Content */}
        <main className="main-content" style={{ background: THEME.background }}>
          {activeTool === 'migrator' ? (
            // MIGRATOR (added): our tool manages its own source/target connection
            // in its Step 1, so it intentionally bypasses the scope gate below.
            <MigratorApp />
          ) : !isScopeSelected ? (
            // Empty state - no scope selected
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              minHeight: '400px',
              color: THEME.text.secondary
            }}>
              <MdSettings size={64} style={{ color: '#d0d5dd', marginBottom: '24px' }} />
              <h2 style={{ fontSize: '18px', fontWeight: '500', color: THEME.text.primary, marginBottom: '8px' }}>
                Select a Configuration Scope
              </h2>
              <p style={{ fontSize: '14px', color: THEME.text.secondary, textAlign: 'center', maxWidth: '400px' }}>
                Choose an Application, Client, and Environment from the header. You'll be prompted to enter database credentials to connect.
              </p>
            </div>
          ) : (
            // Content based on active tool
            activeTool === 'configurator' ? (
              <ConfiguratorPage 
                activeRoute={activeRoute}
                scope={{ app: selectedApp, client: selectedClient, env: selectedEnv, connection: connectionInfo }}
              />
            ) : (
              <DataValidatorPage 
                activeRoute={activeRoute}
                scope={{ app: selectedApp, client: selectedClient, env: selectedEnv, connection: connectionInfo }}
              />
            )
          )}
        </main>
      </div>
    </div>
  );
}

const selectStyle = {
  padding: '8px 14px',
  borderRadius: '6px',
  border: '1px solid #d0d5dd',
  fontSize: '14px',
  minWidth: '150px',
  cursor: 'pointer',
  background: '#fff',
  transition: 'border-color 0.15s'
};

const iconButtonStyle = {
  width: '36px',
  height: '36px',
  borderRadius: '50%',
  border: '1px solid #e5e7eb',
  background: '#fff',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#6b7280',
  transition: 'all 0.15s'
};

export default App;
