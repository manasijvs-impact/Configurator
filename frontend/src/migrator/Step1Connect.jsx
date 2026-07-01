import React, { useState } from 'react';
import { MdVisibility, MdVisibilityOff, MdStorage, MdArrowForward } from 'react-icons/md';
import { ENVIRONMENTS, envLabel, findEnv } from './envs';
import { GLOBAL_DEFAULTS } from './seeds';
import { migratorApi, errText } from './api';
import { THEME, inputStyle, labelStyle, primaryBtn, card } from './theme';

// Email must be firstname.initial@impactanalytics.co (company domain fixed),
// and password exactly 12 chars — same rules as the diff_viewer mockup.
const EMAIL_RE = /^[a-zA-Z]+\.[a-zA-Z]+@impactanalytics\.co$/;

function EnvCard({ accent, title, env, schema, onEnv, onSchema }) {
  const e = findEnv(env);
  return (
    <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 14 }}>
      <div style={{ color: accent, fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{title}</div>
      <label style={labelStyle}>Environment</label>
      <select value={env} onChange={(ev) => onEnv(ev.target.value)} style={{ ...inputStyle, marginBottom: 10 }}>
        {ENVIRONMENTS.map((x) => (
          <option key={x.name} value={x.name}>{envLabel(x)} ({x.name})</option>
        ))}
      </select>
      <label style={labelStyle}>Schema</label>
      <input value={schema} onChange={(ev) => onSchema(ev.target.value)} style={inputStyle} />
      {e && (
        <div style={{ marginTop: 10, fontSize: 12, color: THEME.textMuted,
          background: '#f8fafc', border: `1px solid ${THEME.border}`, borderRadius: 6, padding: 8, lineHeight: 1.6 }}>
          <div><MdStorage size={12} style={{ verticalAlign: 'middle', color: accent }} /> host: <span style={{ fontFamily: 'monospace', color: THEME.text }}>{e.host}</span> · db: <span style={{ fontFamily: 'monospace', color: THEME.text }}>{e.db}</span></div>
          <div>role: <span style={{ fontFamily: 'monospace', color: THEME.text }}>{e.role}</span></div>
          <div style={{ color: '#9ca3af' }}>user &amp; password entered below</div>
        </div>
      )}
    </div>
  );
}

export default function Step1Connect({ initial, onConnected }) {
  const [srcEnv, setSrcEnv] = useState(initial?.srcEnv || 'leslies_uat');
  const [tgtEnv, setTgtEnv] = useState(initial?.tgtEnv || 'leslies_prod');
  const [srcSchema, setSrcSchema] = useState(initial?.srcSchema || 'base_pricing');
  const [tgtSchema, setTgtSchema] = useState(initial?.tgtSchema || 'base_pricing');
  const [email, setEmail] = useState(initial?.email || '');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [cfg, setCfg] = useState({ ...GLOBAL_DEFAULTS });
  const [status, setStatus] = useState(null); // { type:'error'|'ok', msg }
  const [connecting, setConnecting] = useState(false);

  const setCfgField = (k) => (e) => setCfg((c) => ({ ...c, [k]: e.target.value }));

  const handleConnect = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      return setStatus({ type: 'error', msg: 'Email must look like firstname.initial@impactanalytics.co' });
    }
    if (password.length !== 12) {
      return setStatus({ type: 'error', msg: `Password must be exactly 12 characters (got ${password.length}).` });
    }
    if (srcEnv === tgtEnv) {
      // Shown inline under the env cards (see sameEnv banner), not here.
      return;
    }
    setConnecting(true);
    setStatus(null);
    try {
      await migratorApi.connect({
        username: email.trim(), password,
        sourceEnv: srcEnv, targetEnv: tgtEnv,
        sourceSchema: srcSchema.trim(), targetSchema: tgtSchema.trim(),
        thresholdTable: cfg.threshold, excludePrefixes: cfg.exclude,
        staleDays: parseInt(cfg.stale, 10) || 30,
      });
      setStatus({ type: 'ok', msg: 'Connected — discovering inventory…' });
      onConnected({
        srcEnv, tgtEnv, srcSchema: srcSchema.trim(), tgtSchema: tgtSchema.trim(),
        email: email.trim(), cfg,
      });
    } catch (err) {
      setStatus({ type: 'error', msg: errText(err) });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <section style={card}>
      <h2 style={{ marginTop: 0, fontSize: 18, fontWeight: 700 }}>1. Connection &amp; configuration</h2>
      <p style={{ marginTop: 0, fontSize: 13, color: THEME.textMuted }}>
        Pick which environment is the SOURCE and which is the TARGET, the schema, and run options.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <EnvCard accent={THEME.indigo} title="SOURCE (promote FROM)"
          env={srcEnv} schema={srcSchema} onEnv={setSrcEnv} onSchema={setSrcSchema} />
        <EnvCard accent={THEME.emerald} title="TARGET (promote TO)"
          env={tgtEnv} schema={tgtSchema} onEnv={setTgtEnv} onSchema={setTgtSchema} />
      </div>

      {srcEnv === tgtEnv && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: THEME.danger,
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px' }}>
          Source and target must be different environments.
        </div>
      )}

      <div style={{ marginTop: 16, border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 2 }}>Database credentials</div>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: THEME.textMuted }}>
          The same login is used for both environments. Host / port / database / role come from the
          selected environment above. Credentials are validated by attempting a real connection.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>Email</label>
            <input type="text" autoComplete="off" value={email} placeholder="firstname.initial@impactanalytics.co"
              onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>DB password (12 characters)</label>
            <div style={{ position: 'relative' }}>
              <input type={showPass ? 'text' : 'password'} autoComplete="off" value={password}
                placeholder="••••••••••••" onChange={(e) => setPassword(e.target.value)}
                style={{ ...inputStyle, paddingRight: 36 }} />
              <button type="button" onClick={() => setShowPass((v) => !v)}
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', display: 'flex' }}>
                {showPass ? <MdVisibilityOff size={18} /> : <MdVisibility size={18} />}
              </button>
            </div>
          </div>
        </div>
        {status && (
          <div style={{ marginTop: 8, fontSize: 12.5,
            color: status.type === 'error' ? THEME.danger : THEME.success }}>
            {status.msg}
          </div>
        )}
      </div>

      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={labelStyle}>Threshold table (static cutoff)</label>
          <input value={cfg.threshold} onChange={setCfgField('threshold')} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Exclude prefixes</label>
          <input value={cfg.exclude} onChange={setCfgField('exclude')} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Stale days (inventory cleanup)</label>
          <input value={cfg.stale} onChange={setCfgField('stale')} style={inputStyle} />
        </div>
      </div>

      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={handleConnect} disabled={connecting}
          style={{ ...primaryBtn, opacity: connecting ? 0.6 : 1, cursor: connecting ? 'not-allowed' : 'pointer' }}>
          {connecting ? 'Connecting…' : <>Connect &amp; Load Inventory <MdArrowForward size={16} /></>}
        </button>
      </div>
    </section>
  );
}
