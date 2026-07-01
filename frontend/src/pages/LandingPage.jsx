import React from 'react';
import { MdSettings, MdAssessment, MdBuild, MdArrowForward } from 'react-icons/md';

const tools = [
  {
    id: 'configurator',
    name: 'BaseSmart Configurator',
    description: 'Configure product hierarchies, store hierarchies, customer segments, and application settings.',
    icon: <MdSettings size={24} />,
    color: '#667eea'
  },
  {
    id: 'data-validator',
    name: 'Data Validator',
    description: 'Validate forecast calculations and data integrity across different environments.',
    icon: <MdAssessment size={24} />,
    color: '#10b981'
  },
  {
    id: 'screen-builder',
    name: 'Screen Builder',
    description: 'Design and configure custom screens and layouts for your applications.',
    icon: <MdBuild size={24} />,
    color: '#f59e0b',
    disabled: true
  }
];

function LandingPage({ user, onSelectTool, onLogout }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      {/* Simple Header */}
      <header style={{
        background: '#fff',
        borderBottom: '1px solid #e0e0e0',
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h1 style={{ fontSize: '18px', fontWeight: '600', color: '#1a1a1a' }}>
          Impact Analytics Tools
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '14px', color: '#666' }}>{user?.name}</span>
          <button
            onClick={onLogout}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid #d0d0d0',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Logout
          </button>
        </div>
      </header>
      
      <div className="landing-container">
        <div className="landing-header">
          <h1 className="landing-title">
            Welcome, {user?.name || 'User'}
          </h1>
          <p className="landing-subtitle">
            Select a tool to get started
          </p>
        </div>

        <div className="tools-grid">
          {tools.map((tool) => (
            <div
              key={tool.id}
              className="tool-card"
              onClick={() => !tool.disabled && onSelectTool(tool.id)}
              style={{
                opacity: tool.disabled ? 0.6 : 1,
                cursor: tool.disabled ? 'not-allowed' : 'pointer'
              }}
            >
              <div 
                className="tool-icon"
                style={{ background: tool.color }}
              >
                {tool.icon}
              </div>
              
              <h3 className="tool-name">{tool.name}</h3>
              <p className="tool-description">{tool.description}</p>
              
              {!tool.disabled && (
                <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '4px', color: tool.color }}>
                  <span style={{ fontSize: '14px', fontWeight: 500 }}>Open Tool</span>
                  <MdArrowForward size={16} />
                </div>
              )}
              
              {tool.disabled && (
                <div style={{ marginTop: '16px' }}>
                  <span style={{ fontSize: '12px', color: '#999', background: '#f0f0f0', padding: '4px 8px', borderRadius: '4px' }}>
                    Coming Soon
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default LandingPage;
