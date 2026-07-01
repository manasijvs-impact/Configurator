// Shared theme + style primitives for the Migrator tool, so Step 1/2/3
// components stay visually consistent without duplicating style objects.
export const THEME = {
  primary: '#264CD7',
  indigo: '#4f46e5',
  emerald: '#059669',
  bg: '#f5f7fa',
  surface: '#ffffff',
  border: '#e5e7eb',
  text: '#1a1a2e',
  textMuted: '#6b7280',
  success: '#10b981',
  danger: '#dc2626',
  amber: '#d97706',
};

export const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 6,
  border: '1px solid #d1d5db', fontSize: 13.5, boxSizing: 'border-box',
  background: '#fff', fontFamily: 'inherit',
};

export const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 500, color: '#6b7280', marginBottom: 4,
};

export const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px',
  borderRadius: 8, border: 'none', background: THEME.indigo, color: '#fff',
  fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

export const emeraldBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px',
  borderRadius: 8, border: 'none', background: THEME.emerald, color: '#fff',
  fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

export const linkBtn = {
  background: 'none', border: 'none', color: THEME.textMuted, fontSize: 13,
  cursor: 'pointer', textDecoration: 'none',
};

export const card = {
  background: THEME.surface, border: `1px solid ${THEME.border}`,
  borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
};

export const pill = (active) => ({
  padding: '6px 14px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
  border: `1px solid ${active ? THEME.indigo : THEME.border}`,
  background: active ? THEME.indigo : '#fff',
  color: active ? '#fff' : THEME.textMuted, fontWeight: active ? 600 : 400,
});

export const smallFilter = (active) => ({
  padding: '2px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  border: `1px solid ${active ? THEME.indigo : THEME.border}`,
  background: active ? THEME.indigo : '#fff',
  color: active ? '#fff' : THEME.textMuted,
});
