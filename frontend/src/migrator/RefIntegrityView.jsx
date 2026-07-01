import React, { useState, useEffect, useMemo } from 'react';
import { MdSync, MdError, MdSearch, MdDownload, MdRefresh, MdWarning, MdCheckCircle } from 'react-icons/md';
import { migratorApi, errText } from './api';
import { THEME, card, pill } from './theme';

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11.5, color: THEME.textMuted, position: 'sticky', top: 0, background: '#f1f5f9', whiteSpace: 'nowrap' };
const td = { padding: '7px 10px', fontSize: 12.5, borderTop: `1px solid ${THEME.border}`, verticalAlign: 'top' };

const chip = (text, bg, fg) => (
  <span style={{ display: 'inline-block', margin: '1px 3px 1px 0', fontSize: 11, padding: '1px 7px', borderRadius: 4, background: bg, color: fg, fontFamily: 'monospace' }}>{text}</span>
);

// Build a CSV string mirroring the notebook's reference_integrity_*.csv layout.
const toCsv = (rows) => {
  const head = ['function_name', 'arg_signature', 'kind', 'missing_table_count', 'missing_tables', 'created_tables', 'accessed_tables'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const line = (r) => [
    r.function_name, r.arg_signature, r.kind, r.missing_table_count,
    (r.missing_tables || []).join(', '),
    (r.created_tables || []).join(', '),
    (r.accessed_tables || []).join(', '),
  ].map(esc).join(',');
  return [head.join(','), ...rows.map(line)].join('\n') + '\n';
};

const download = (filename, content) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};

const Stat = ({ label, value, danger }) => (
  <div style={{ padding: '8px 12px', border: `1px solid ${THEME.border}`, borderRadius: 8, background: danger ? '#fff7f7' : '#f8fafc', minWidth: 120 }}>
    <div style={{ fontSize: 11, color: THEME.textMuted }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 700, color: danger ? THEME.danger : THEME.text }}>{value}</div>
  </div>
);

export default function RefIntegrityView({ TGT }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: res } = await migratorApi.getRefIntegrity();
      setData(res);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    let r = data?.rows || [];
    if (flaggedOnly) r = r.filter((x) => x.missing_table_count > 0);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((x) => x.function_name.toLowerCase().includes(q)
      || (x.arg_signature || '').toLowerCase().includes(q)
      || (x.missing_tables || []).some((m) => m.toLowerCase().includes(q)));
    return r;
  }, [data, flaggedOnly, search]);

  if (loading) {
    return (
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
        <MdSync size={18} className="spin" style={{ color: THEME.indigo }} /> Scanning {TGT} function bodies for unresolved table references…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, color: THEME.danger, fontSize: 13.5 }}>
        <MdError size={18} /> {error}
        <button onClick={load} style={{ ...pill(false), marginLeft: 'auto' }}>Retry</button>
      </div>
    );
  }
  if (!data) return null;

  const s = data.summary;

  return (
    <div style={card}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: THEME.text }}>Function Reference Audit</div>
        <div style={{ fontSize: 11.5, color: THEME.textMuted, marginTop: 2 }}>Target schema only</div>
      </div>
      <div style={{ fontSize: 13, color: THEME.textMuted, marginBottom: 10 }}>
        Audits <b>{data.target_env}</b> · schema <code>{data.target_schema}</code>.
        Flags table references inside function/procedure bodies that don't resolve to a real table,
        unlogged table, system catalog, or a table created by any function.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <Stat label="Functions scanned" value={s.functions_scanned} />
        <Stat label="Tables referred" value={s.universe_size} />
        <Stat label="Existing Tables" value={s.universe_size - s.created_by_functions} />
        <Stat label="Created By Function" value={s.created_by_functions} />
        <Stat label="Flagged functions" value={s.flagged_functions} danger={s.flagged_functions > 0} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: THEME.text }}>
          <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
          Flagged only
        </label>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${THEME.border}`, borderRadius: 8, padding: '4px 8px', background: '#fff' }}>
          <MdSearch size={15} style={{ color: THEME.textMuted }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search function or missing table…"
            style={{ border: 'none', outline: 'none', fontSize: 12.5, width: 240 }} />
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={load} title="Re-run check" style={{ ...pill(false), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <MdRefresh size={15} /> Refresh
        </button>
        <button onClick={() => download(`reference_integrity_${data.target_env}_${data.target_schema}.csv`, toCsv(data.rows))}
          style={{ ...pill(true), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <MdDownload size={15} /> Download CSV
        </button>
      </div>

      <div style={{ marginTop: 12, maxHeight: '55vh', overflow: 'auto', border: `1px solid ${THEME.border}`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Function / Procedure</th>
              <th style={th}>Kind</th>
              <th style={th}>Missing tables</th>
              <th style={th}>Created</th>
              <th style={th}>Accessed</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td style={{ ...td, color: THEME.textMuted }} colSpan={5}>
                {flaggedOnly ? 'No functions with unresolved references.' : 'No functions match.'}
              </td></tr>
            ) : rows.map((r, i) => {
              const flagged = r.missing_table_count > 0;
              return (
                <tr key={i} style={{ background: flagged ? '#fff7f7' : '#fff' }}>
                  <td style={{ ...td, fontFamily: 'monospace', minWidth: 220 }}>
                    {flagged
                      ? <MdWarning size={13} style={{ color: THEME.danger, verticalAlign: 'middle', marginRight: 4 }} />
                      : <MdCheckCircle size={13} style={{ color: THEME.emerald, verticalAlign: 'middle', marginRight: 4 }} />}
                    {r.function_name}
                    <span style={{ color: '#9ca3af' }}>({r.arg_signature})</span>
                  </td>
                  <td style={{ ...td, color: THEME.textMuted, whiteSpace: 'nowrap' }}>{r.kind}</td>
                  <td style={{ ...td, maxWidth: 320 }}>
                    {(r.missing_tables || []).length === 0
                      ? <span style={{ color: '#9ca3af' }}>—</span>
                      : r.missing_tables.map((m, k) => <React.Fragment key={k}>{chip(m, '#fee2e2', '#b91c1c')}</React.Fragment>)}
                  </td>
                  <td style={{ ...td, maxWidth: 260, color: THEME.textMuted }}>
                    {(r.created_tables || []).length === 0
                      ? <span style={{ color: '#9ca3af' }}>—</span>
                      : r.created_tables.map((m, k) => <React.Fragment key={k}>{chip(m, '#dcfce7', '#15803d')}</React.Fragment>)}
                  </td>
                  <td style={{ ...td, maxWidth: 320, color: THEME.textMuted }}>
                    {(r.accessed_tables || []).length === 0
                      ? <span style={{ color: '#9ca3af' }}>—</span>
                      : r.accessed_tables.map((m, k) => <React.Fragment key={k}>{chip(m, '#f1f5f9', '#475569')}</React.Fragment>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 8, fontSize: 11.5, color: '#9ca3af' }}>
        Showing {rows.length} of {data.rows.length} functions. CSV written to <code>{data.csv_path}</code>
      </div>
    </div>
  );
}
