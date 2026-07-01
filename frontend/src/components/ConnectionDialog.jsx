import React, { useState, useEffect } from 'react';
import { MdClose, MdVisibility, MdVisibilityOff, MdCheckCircle, MdError, MdKeyboardArrowDown } from 'react-icons/md';

const APPLICATIONS = [
  { value: 'base_smart', label: 'Base Smart' },
  { value: 'base_smart_restaurant', label: 'Base Smart Restaurant' }
];

function ConnectionDialog({ scope, onConnect, onCancel }) {
  // Allow application to be changed in dialog
  const [selectedApp, setSelectedApp] = useState(scope.app);
  
  // Derive default database name from client/env
  const getDefaultDatabase = (client, env) => {
    // For impactprice clients, use fixed database names
    const impactpriceDbMap = {
      'impactprice-poc-replica': 'ig_poc_replica',
      'impactprice-poc': 'ig_poc'
    };
    if (impactpriceDbMap[client]) {
      return impactpriceDbMap[client];
    }
    const clientMap = {
      'leslies': 'leslies',
      'crackerbarrel': 'cb'
    };
    const clientPrefix = clientMap[client] || client;
    return `${clientPrefix}_${env}`;
  };

  const [credentials, setCredentials] = useState({
    host: '',
    port: '5432',
    database: getDefaultDatabase(scope.client, scope.env),
    username: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');

  // Derive instance name from scope
  const getInstanceName = () => {
    // For impactprice clients, use client name as instance
    if (scope.client.startsWith('impactprice-')) {
      return scope.client;
    }
    const clientMap = {
      'leslies': 'leslies',
      'crackerbarrel': 'cb'
    };
    const envMap = {
      'dev': 'dev',
      'test': 'test',
      'uat': 'uat',
      'prod': 'prod'
    };
    const clientPrefix = clientMap[scope.client] || scope.client;
    const envSuffix = envMap[scope.env] || scope.env;
    return `${clientPrefix}_${envSuffix}`;
  };

  // Determine which schema to check based on selected application
  const getExpectedSchema = () => {
    if (selectedApp === 'base_smart_restaurant') {
      return 'base_pricing_restaurant';
    }
    return 'base_pricing';
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setCredentials(prev => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleAppChange = (e) => {
    setSelectedApp(e.target.value);
    setError('');
  };

  const handleConnect = async () => {
    // Validate required fields
    if (!credentials.host || !credentials.database || !credentials.username || !credentials.password) {
      setError('All fields are required');
      return;
    }

    setIsConnecting(true);
    setError('');

    try {
      // First test the connection
      const testResponse = await fetch('http://localhost:8000/api/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          host: credentials.host,
          port: parseInt(credentials.port, 10),
          database: credentials.database,
          username: credentials.username,
          password: credentials.password,
          expected_schema: getExpectedSchema(),
          instance_name: getInstanceName()
        })
      });

      const testData = await testResponse.json();

      if (!testResponse.ok) {
        throw new Error(testData.detail || 'Connection failed');
      }

      if (testData.success) {
        // Now establish the persistent connection
        const connectResponse = await fetch('http://localhost:8000/api/connect', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            host: credentials.host,
            port: parseInt(credentials.port, 10),
            database: credentials.database,
            username: credentials.username,
            password: credentials.password,
            client_name: scope.client,
            environment: scope.env,
            db_schema: getExpectedSchema()
          })
        });

        const connectData = await connectResponse.json();

        if (!connectResponse.ok) {
          // Handle FastAPI validation errors (array of objects)
          let errorMsg = 'Failed to establish connection';
          if (connectData.detail) {
            if (Array.isArray(connectData.detail)) {
              errorMsg = connectData.detail.map(e => e.msg || JSON.stringify(e)).join(', ');
            } else if (typeof connectData.detail === 'string') {
              errorMsg = connectData.detail;
            } else {
              errorMsg = JSON.stringify(connectData.detail);
            }
          }
          throw new Error(errorMsg);
        }

        onConnect({
          ...credentials,
          instanceName: getInstanceName(),
          schemaVerified: testData.schema_exists,
          app: selectedApp  // Pass the selected app back
        });
      } else {
        setError(testData.message || 'Connection failed');
      }
    } catch (err) {
      setError(err.message || 'Failed to connect to database');
    } finally {
      setIsConnecting(false);
    }
  };

  const instanceName = getInstanceName();
  const expectedSchema = getExpectedSchema();

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
              Database Connection
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6b7280' }}>
              Instance: <strong>{instanceName}</strong>
            </p>
          </div>
          <button onClick={onCancel} style={closeButtonStyle}>
            <MdClose size={20} />
          </button>
        </div>

        {/* Application Select - Editable */}
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Application</label>
          <div style={{ position: 'relative' }}>
            <select
              value={selectedApp}
              onChange={handleAppChange}
              style={{
                ...inputStyle,
                appearance: 'none',
                paddingRight: '36px',
                cursor: 'pointer'
              }}
            >
              {APPLICATIONS.map(app => (
                <option key={app.value} value={app.value}>{app.label}</option>
              ))}
            </select>
            <MdKeyboardArrowDown
              size={20}
              style={{
                position: 'absolute',
                right: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
                color: '#6b7280'
              }}
            />
          </div>
        </div>

        {/* Scope Info */}
        <div style={infoBoxStyle}>
          <div style={infoRowStyle}>
            <span style={{ color: '#6b7280' }}>Client:</span>
            <span style={{ fontWeight: '500', textTransform: 'capitalize' }}>{scope.client}</span>
          </div>
          <div style={infoRowStyle}>
            <span style={{ color: '#6b7280' }}>Environment:</span>
            <span style={{ fontWeight: '500', textTransform: 'capitalize' }}>{scope.env}</span>
          </div>
          <div style={infoRowStyle}>
            <span style={{ color: '#6b7280' }}>Expected Schema:</span>
            <span style={{ fontWeight: '500', fontFamily: 'monospace', background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>{expectedSchema}</span>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div style={errorStyle}>
            <MdError size={18} />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Host & Port Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Host *</label>
              <input
                type="text"
                name="host"
                value={credentials.host}
                onChange={handleChange}
                placeholder="e.g., db.example.com"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Port</label>
              <input
                type="text"
                name="port"
                value={credentials.port}
                onChange={handleChange}
                placeholder="5432"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Database */}
          <div>
            <label style={labelStyle}>Database *</label>
            <input
              type="text"
              name="database"
              value={credentials.database}
              onChange={handleChange}
              placeholder="Database name"
              style={inputStyle}
            />
          </div>

          {/* Username */}
          <div>
            <label style={labelStyle}>Username *</label>
            <input
              type="text"
              name="username"
              value={credentials.username}
              onChange={handleChange}
              placeholder="Database username"
              style={inputStyle}
            />
          </div>

          {/* Password */}
          <div>
            <label style={labelStyle}>Password *</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={credentials.password}
                onChange={handleChange}
                placeholder="Database password"
                style={{ ...inputStyle, paddingRight: '40px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={eyeButtonStyle}
              >
                {showPassword ? <MdVisibilityOff size={20} /> : <MdVisibility size={20} />}
              </button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={actionsStyle}>
          <button onClick={onCancel} style={cancelButtonStyle}>
            Cancel
          </button>
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            style={connectButtonStyle}
          >
            {isConnecting ? 'Connecting...' : 'Connect & Verify'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Styles
const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000
};

const dialogStyle = {
  background: '#fff',
  borderRadius: '12px',
  width: '100%',
  maxWidth: '480px',
  padding: '24px',
  boxShadow: '0 20px 40px rgba(0, 0, 0, 0.15)'
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: '20px'
};

const closeButtonStyle = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#6b7280',
  padding: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '6px'
};

const infoBoxStyle = {
  background: '#f8fafc',
  borderRadius: '8px',
  padding: '12px 16px',
  marginBottom: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px'
};

const infoRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: '13px'
};

const errorStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '12px',
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: '8px',
  color: '#dc2626',
  fontSize: '14px',
  marginBottom: '16px'
};

const labelStyle = {
  display: 'block',
  fontSize: '13px',
  fontWeight: '500',
  color: '#374151',
  marginBottom: '6px'
};

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid #d1d5db',
  fontSize: '14px',
  transition: 'border-color 0.15s, box-shadow 0.15s',
  boxSizing: 'border-box'
};

const eyeButtonStyle = {
  position: 'absolute',
  right: '8px',
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#6b7280',
  padding: '4px',
  display: 'flex',
  alignItems: 'center'
};

const actionsStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '12px',
  marginTop: '24px',
  paddingTop: '20px',
  borderTop: '1px solid #e5e7eb'
};

const cancelButtonStyle = {
  padding: '10px 20px',
  borderRadius: '8px',
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: '500'
};

const connectButtonStyle = {
  padding: '10px 20px',
  borderRadius: '8px',
  border: 'none',
  background: '#264CD7',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: '500'
};

export default ConnectionDialog;
