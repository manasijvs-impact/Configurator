import React, { useState, useEffect, useMemo } from 'react';
import { MdSync, MdError, MdSearch, MdDownload, MdRefresh } from 'react-icons/md';
import { migratorApi, errText } from './api';
import { THEME, card, pill } from './theme';

const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11.5, color: THEME.textMuted, position: 'sticky', top: 0, background: '#f1f5f9', whiteSpace: 'nowrap' };
const td = { padding: '7px 10px', fontSize: 12.5, borderTop: `1px solid ${THEME.border}`, whiteSpace: 'nowrap' };

const presence = (ok) => ok
  ? <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 4, background: '#dcfce7', color: '#15803d' }}>yes</span>
  : <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 4, background: '#fee2e2', color: '#b91c1c' }}>no</span>;

// Build a CSV string from inventory rows for client-side download.
const toCsv = (kind, rows, SRC, TGT) => {
  const head = kind === 'functions'
    ? ['function_name', 'arg_signature', 'kind', `in_${SRC}`, `in_${TGT}`, 'created', `${SRC}_updated`, `${TGT}_updated`, 'status']
    : ['table_name', 'static_dynamic', 'override', `in_${SRC}`, `in_${TGT}`, 'created', `${SRC}_updated`, `${TGT}_updated`, 'status'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const line = (r) => (kind === 'functions'
    ? [r.name, r.arg_signature, r.kind, r.in_source, r.in_target, r.created, r.source_updated, r.target_updated, r.status]
    : [r.name, r.static_dynamic, r.override, r.in_source, r.in_target, r.created, r.source_updated, r.target_updated, r.status]
  ).map(esc).join(',');
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

export default function InventoryView({ SRC, TGT }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('tables'); // 'tables' | 'functions'
  const [search, setSearch] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: res } = await migratorApi.getInventory();
      setData(res);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const section = data ? (tab === 'tables' ? data.tables : data.functions) : null;
  const rows = useMemo(() => {
    let r = section?.rows || [];
    if (missingOnly) r = r.filter((x) => x.status !== 'present');
    if (search) {
      const q = search.toLowerCase();
      r = r.filter((x) => x.name.toLowerCase().includes(q)
        || (x.arg_signature || '').toLowerCase().includes(q));
    }
    return r;
  }, [section, search, missingOnly]);

  if (loading) {
    return (
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
        <MdSync size={18} className="spin" style={{ color: THEME.indigo }} /> Building inventory & refreshing CSVs…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ ...card }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: THEME.danger, fontSize: 13 }}>
          <MdError size={18} /> {error}
        </div>
        <button onClick={load} style={{ ...pill(false), marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <MdRefresh size={15} /> Retry
        </button>
      </div>
    );
  }
  if (!data || !section) return null;

  const s = section.summary || {};

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button style={pill(tab === 'tables')} onClick={() => setTab('tables')}>Tables ({data.tables.summary.source_total})</button>
        <button style={pill(tab === 'functions')} onClick={() => setTab('functions')}>Functions ({data.functions.summary.source_total})</button>
        <div style={{ flex: 1 }} />
        <button onClick={load} title="Refresh inventory" style={{ ...pill(false), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <MdRefresh size={15} /> Refresh
        </button>
        <button onClick={() => download(`${tab}_inventory_${SRC}_vs_${TGT}.csv`, toCsv(tab, section.rows, SRC, TGT))}
          style={{ ...pill(true), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <MdDownload size={15} /> Download CSV
        </button>
      </div>

      <p style={{ margin: '12px 0 0', fontSize: 13, color: THEME.textMuted }}>
        <b>{s.source_total}</b> in {SRC} (master) · <b style={{ color: THEME.emerald }}>{s.target_present}</b> present in {TGT}
        {s.target_missing > 0 && <> · <b style={{ color: THEME.danger }}>{s.target_missing}</b> missing in {TGT}</>}
        {' '}· +{s.added} added, {s.updated} updated, -{s.removed} stale removed this run
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <MdSearch size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px 8px 32px', borderRadius: 8, border: `1px solid ${THEME.border}`, fontSize: 13.5 }} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: THEME.textMuted, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> Missing in {TGT} only
        </label>
      </div>

      <div style={{ marginTop: 12, maxHeight: '55vh', overflow: 'auto', border: `1px solid ${THEME.border}`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>{tab === 'functions' ? 'Function' : 'Table'}</th>
              {tab === 'functions' ? <th style={th}>Args</th> : <th style={th}>Class</th>}
              {tab === 'functions' ? <th style={th}>Kind</th> : null}
              <th style={th}>{SRC}</th>
              <th style={th}>{TGT}</th>
              <th style={th}>Created</th>
              <th style={th}>{TGT} last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td style={{ ...td, textAlign: 'center', color: THEME.textMuted }} colSpan={7}>No rows match.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} style={{ background: r.status !== 'present' ? '#fff7f7' : '#fff' }}>
                <td style={{ ...td, fontFamily: 'monospace' }}>{r.name}</td>
                {tab === 'functions'
                  ? <td style={{ ...td, fontFamily: 'monospace', color: '#9ca3af' }}>{r.arg_signature || '—'}</td>
                  : <td style={td}>
                      <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 4,
                        background: r.static_dynamic === 'static' ? '#e0e7ff' : '#fef3c7',
                        color: r.static_dynamic === 'static' ? '#4338ca' : '#b45309' }}>{r.static_dynamic}</span>
                    </td>}
                {tab === 'functions' ? <td style={td}>{r.kind}</td> : null}
                <td style={td}>{presence(r.in_source)}</td>
                <td style={td}>{presence(r.in_target)}</td>
                <td style={{ ...td, color: THEME.textMuted }}>{r.created || '—'}</td>
                <td style={td}>
                  {r.status === 'present'
                    ? <span style={{ color: THEME.textMuted }}>{r.target_updated || '—'}</span>
                    : <span style={{ color: THEME.danger }}>{r.last_seen ? `last seen ${r.last_seen}` : 'never seen'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 8, fontSize: 11.5, color: '#9ca3af' }}>
        CSVs refreshed at <code>{section.source_csv_path}</code> and <code>{section.target_csv_path}</code>
      </div>
    </div>
  );
}
