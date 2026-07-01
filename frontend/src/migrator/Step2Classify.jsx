import React, { useState } from 'react';
import { MdSync, MdError, MdRefresh, MdArrowForward, MdSave, MdCheckCircle } from 'react-icons/md';
import { THEME, card, pill, smallFilter, linkBtn, emeraldBtn } from './theme';
import { migratorApi, errText } from './api';

// Per-table multiselect of real columns to exclude from the data check (lazy-
// loads the table's columns on first open). Selections persist via the normal
// Step 2 Save. Disabled when the table is dynamic or the whole-table data check
// is already skipped (exclusions would be moot).
function ExcludeColumnsCell({ table, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const [cols, setCols] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const selected = table.data_exclude_columns || [];

  const toggleOpen = async () => {
    if (disabled) return;
    const next = !open;
    setOpen(next);
    if (next && cols === null) {
      setBusy(true); setErr('');
      try {
        const { data } = await migratorApi.tableColumns(table.name);
        setCols(data.columns || []);
      } catch (e) { setErr(errText(e)); }
      finally { setBusy(false); }
    }
  };

  const toggleCol = (c) => {
    const set = new Set(selected);
    set.has(c) ? set.delete(c) : set.add(c);
    onChange([...set]);
  };

  if (disabled && selected.length === 0) {
    return <span style={{ color: '#cbd5e1', fontSize: 12 }}>—</span>;
  }
  return (
    <div style={{ display: 'inline-block', minWidth: 150, textAlign: 'center' }}>
      <button onClick={toggleOpen} disabled={disabled}
        style={{ ...smallFilter(open), cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
        {selected.length ? `${selected.length} excluded` : 'none'} {disabled ? '' : (open ? '▴' : '▾')}
      </button>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 3, marginTop: 4 }}>
          {selected.map((c) => (
            <span key={c} style={{ fontFamily: 'monospace', fontSize: 10.5, background: '#fef3c7', color: '#92400e',
              borderRadius: 4, padding: '1px 5px' }}>{c}</span>
          ))}
        </div>
      )}
      {open && !disabled && (
        <div style={{ marginTop: 6, border: `1px solid ${THEME.border}`, borderRadius: 6, background: '#fff',
          maxHeight: 168, overflow: 'auto', padding: 6, textAlign: 'left' }}>
          {busy ? (
            <div style={{ fontSize: 11.5, color: THEME.textMuted, padding: 4 }}>Loading columns…</div>
          ) : err ? (
            <div style={{ fontSize: 11.5, color: THEME.danger, padding: 4 }}>{err}</div>
          ) : (cols || []).length === 0 ? (
            <div style={{ fontSize: 11.5, color: THEME.textMuted, padding: 4 }}>No columns found.</div>
          ) : (
            (cols || []).map((c, idx) => (
              <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                fontFamily: 'monospace', padding: '2px 4px', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.includes(c)} onChange={() => toggleCol(c)} />
                {c}{idx === 0 && <span style={{ fontFamily: 'sans-serif', fontSize: 9.5, color: '#9ca3af' }}>(PK — ignored)</span>}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const th = { textAlign: 'left', padding: '6px 10px', fontSize: 11.5, color: THEME.textMuted, position: 'sticky', top: 0, background: '#f1f5f9' };
const thC = { ...th, textAlign: 'center' };
const td = { padding: '5px 10px', fontSize: 13 };
const tdC = { ...td, textAlign: 'center' };

export default function Step2Classify({
  tables, setTables, functions, setFunctions, meta,
  loading, error, onReload, onSave, saving, savedAt, dirty,
  onBack, onRun, running, runError, sourceEnv, targetEnv,
}) {
  const [classTab, setClassTab] = useState('tables');
  const [tableFilter, setTableFilter] = useState('all');
  const [tableSearch, setTableSearch] = useState('');

  // Static shows the FULL curated list (incl. any seed table not in the DBs).
  // All / Dynamic operate on discovered (present) tables only.
  const presentTables = tables.filter((t) => t.present !== false);
  const staticCount = tables.filter((t) => t.classification === 'static').length;
  const dynamicCount = presentTables.filter((t) => t.classification === 'dynamic').length;

  // Toggling the classification IS the manual override (override wins over auto).
  const setStatic = (name, isStatic) =>
    setTables((prev) => prev.map((t) => {
      if (t.name !== name) return t;
      const cls = isStatic ? 'static' : 'dynamic';
      return { ...t, override: cls, classification: cls, skip_data_check: isStatic ? t.skip_data_check : false };
    }));

  const updateTable = (name, patch) =>
    setTables((prev) => prev.map((t) => (t.name === name ? { ...t, ...patch } : t)));

  const updateFn = (key, patch) =>
    setFunctions((prev) => prev.map((f) => (`${f.name}|${f.arg_signature}` === key ? { ...f, ...patch } : f)));

  // Rows shown for the tables tab (filter pill + name search).
  const q = tableSearch.trim().toLowerCase();
  const tableRows = (
    tableFilter === 'static' ? tables.filter((t) => t.classification === 'static')
    : tableFilter === 'dynamic' ? presentTables.filter((t) => t.classification === 'dynamic')
    : presentTables
  ).filter((t) => !q || t.name.toLowerCase().includes(q));

  const fnRows = functions;

  return (
    <section style={card}>
      <h2 style={{ marginTop: 0, fontSize: 18, fontWeight: 700 }}>2. Classify objects</h2>
      <p style={{ marginTop: 0, fontSize: 13, color: THEME.textMuted }}>
        Tables and functions/SPs are <b>discovered automatically</b> from the two environments
        ({sourceEnv} → {targetEnv}). Each table defaults to <b>Static</b> if it's in the curated
        master-static list ({meta?.static_seed_count || 42} tables), <b>Dynamic</b> otherwise; your
        Static/Dynamic choice <b>overrides</b> the default. Click <b>Save</b> to persist to the shared
        classification CSV.
      </p>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: '#f8fafc',
          border: `1px solid ${THEME.border}`, borderRadius: 8, fontSize: 13 }}>
          <MdSync size={18} style={{ color: THEME.indigo }} /> Discovering &amp; loading saved classification…
        </div>
      )}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, background: '#fef2f2',
          border: '1px solid #fecaca', borderRadius: 8, color: THEME.danger, fontSize: 13.5 }}>
          <MdError size={18} /> {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button style={pill(classTab === 'tables')} onClick={() => setClassTab('tables')}>
              Tables ({staticCount} static / {dynamicCount} dynamic / {presentTables.length})
            </button>
            <button style={pill(classTab === 'functions')} onClick={() => setClassTab('functions')}>
              Functions / SPs ({functions.length})
            </button>
          </div>

          <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 10, overflow: 'auto', maxHeight: '28rem' }}>
            {classTab === 'tables' ? (
              <>
                <div style={{ padding: '8px 10px', fontSize: 12, color: THEME.textMuted, background: '#f8fafc',
                  borderBottom: `1px solid ${THEME.border}`, borderTopLeftRadius: 10, borderTopRightRadius: 10,
                  display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button style={smallFilter(tableFilter === 'all')} onClick={() => setTableFilter('all')}>All ({presentTables.length})</button>
                  <button style={smallFilter(tableFilter === 'static')} onClick={() => setTableFilter('static')}>Static ({staticCount})</button>
                  <button style={smallFilter(tableFilter === 'dynamic')} onClick={() => setTableFilter('dynamic')}>Dynamic ({dynamicCount})</button>
                  <input value={tableSearch} onChange={(e) => setTableSearch(e.target.value)} placeholder="Search tables…"
                    style={{ border: `1px solid ${THEME.border}`, borderRadius: 6, padding: '3px 8px', fontSize: 12, outline: 'none', minWidth: 180 }} />
                  <span style={{ marginLeft: 'auto', maxWidth: 360 }}>
                    <b>Static</b> = included in the row-by-row <b>data check</b>; <b>Dynamic</b> = schema-only.
                  </span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>#</th>
                      <th style={th}>Table</th>
                      <th style={thC}>Static</th>
                      <th style={thC}>Skip data check</th>
                      <th style={thC}>Skip schema check</th>
                      <th style={thC}>Exclude columns<br/>(data check)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((t, i) => {
                      const isStatic = t.classification === 'static';
                      const overridden = t.override && t.override !== t.auto;
                      return (
                        <tr key={t.name} style={{ borderTop: `1px solid ${THEME.border}`,
                          color: isStatic ? THEME.text : THEME.textMuted }}>
                          <td style={{ ...td, color: '#9ca3af', fontSize: 11.5 }}>{i + 1}</td>
                          <td style={{ ...td, fontFamily: 'monospace' }}>
                            {t.name}
                            {overridden && (
                              <span style={{ marginLeft: 6, fontFamily: 'inherit', fontSize: 10, color: '#9ca3af' }}>
                                auto: {t.auto}
                              </span>
                            )}
                          </td>
                          <td style={tdC}>
                            <input type="checkbox" checked={isStatic}
                              onChange={(e) => setStatic(t.name, e.target.checked)} />
                          </td>
                          <td style={tdC}>
                            <input type="checkbox" checked={t.skip_data_check} disabled={!isStatic}
                              onChange={(e) => updateTable(t.name, { skip_data_check: e.target.checked })} />
                          </td>
                          <td style={tdC}>
                            <input type="checkbox" checked={t.skip_schema_check}
                              onChange={(e) => updateTable(t.name, { skip_schema_check: e.target.checked })} />
                          </td>
                          <td style={{ ...tdC, verticalAlign: 'top' }}>
                            <ExcludeColumnsCell table={t} disabled={!isStatic || t.skip_data_check}
                              onChange={(cols) => updateTable(t.name, { data_exclude_columns: cols })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : (
              <>
                <div style={{ padding: '8px 10px', fontSize: 12, color: THEME.textMuted, background: '#f8fafc',
                  borderBottom: `1px solid ${THEME.border}`, borderTopLeftRadius: 10, borderTopRightRadius: 10,
                  display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b>All functions / procedures ({functions.length})</b>
                  <span style={{ marginLeft: 'auto' }}>Tick <b>Skip body check</b> to skip the body diff for a routine.</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>#</th>
                      <th style={th}>Function / Procedure</th>
                      <th style={th}>Kind</th>
                      <th style={thC}>Skip body check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fnRows.map((f, i) => {
                      const key = `${f.name}|${f.arg_signature}`;
                      return (
                        <tr key={key} style={{ borderTop: `1px solid ${THEME.border}` }}>
                          <td style={{ ...td, color: '#9ca3af', fontSize: 11.5 }}>{i + 1}</td>
                          <td style={{ ...td, fontFamily: 'monospace' }}>
                            {f.name}<span style={{ color: '#9ca3af' }}>({f.arg_signature})</span>
                          </td>
                          <td style={{ ...td, fontSize: 12, color: THEME.textMuted }}>{f.kind}</td>
                          <td style={tdC}>
                            <input type="checkbox" checked={f.skip_body_check}
                              onChange={(e) => updateFn(key, { skip_body_check: e.target.checked })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>

          {meta?.table_csv_path && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: '#9ca3af' }}>
              Saved to <code>{meta.table_csv_path}</code>
            </div>
          )}
        </>
      )}

      {running && (
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: '#eef2ff',
          border: '1px solid #c7d2fe', borderRadius: 8, fontSize: 13, color: THEME.indigo }}>
          <MdSync size={18} className="spin" /> Running validation… comparing schema, data (static tables) and function bodies across {sourceEnv} → {targetEnv}. This can take a while over VPN.
        </div>
      )}
      {runError && (
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, padding: 12, background: '#fef2f2',
          border: '1px solid #fecaca', borderRadius: 8, color: THEME.danger, fontSize: 13.5 }}>
          <MdError size={18} /> Validation failed: {runError}
        </div>
      )}

      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button style={linkBtn} onClick={onBack} disabled={running}>← back</button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {dirty && !saving ? (
            <span style={{ fontSize: 12, color: THEME.amber || '#b45309', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <MdError size={14} /> unsaved changes
            </span>
          ) : savedAt && !saving && (
            <span style={{ fontSize: 12, color: THEME.emerald, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <MdCheckCircle size={14} /> saved
            </span>
          )}
          <button style={{ ...linkBtn, display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={onReload} disabled={loading || saving || running}>
            <MdRefresh size={15} /> Refresh
          </button>
          <button style={{ ...linkBtn, display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={onSave} disabled={loading || saving || running || !dirty}
            title={dirty ? 'Save classification to the shared CSV' : 'No unsaved changes'}>
            <MdSave size={15} /> {saving ? 'Saving…' : 'Save'}
          </button>
          <button style={{ ...emeraldBtn, opacity: (loading || saving || running || !!error) ? 0.6 : 1,
            cursor: running ? 'wait' : 'pointer' }}
            onClick={onRun} disabled={loading || saving || running || !!error}
            title={dirty ? 'Saves your unsaved changes, then runs validation' : 'Run validation'}>
            {running ? <><MdSync size={16} className="spin" /> Running…</> : <>{dirty ? 'Save & Run Validation' : 'Run Validation'} <MdArrowForward size={16} /></>}
          </button>
        </div>
      </div>
    </section>
  );
}
