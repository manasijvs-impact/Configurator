import React, { useState, useMemo, useRef, useEffect } from 'react';
import { MdSearch, MdDownload, MdSync, MdError, MdInsertDriveFile } from 'react-icons/md';
import { tokenDiff, CAT, TYPE_LABEL } from './diffUtil';
import { migratorApi, errText } from './api';
import { THEME, card, pill } from './theme';
import InventoryView from './InventoryView';
import RefIntegrityView from './RefIntegrityView';

// Trigger a browser download of a text file.
const downloadText = (filename, content) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.split('/').pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const keyOf = (d, i) => `${d.object_type}::${d.name}::${d.arg_signature || ''}::${i}`;

// Which envs are valid "winners" for a diff. An env where the object is missing
// can never be the winner (you can't copy from something that isn't there).
const winnerOptions = (d) => {
  const opts = [];
  if (d.source_present !== false) opts.push('source');
  if (d.target_present !== false) opts.push('target');
  return opts.length ? opts : ['source', 'target'];
};

// The effective winner for a row: the user's pick if it's still valid,
// otherwise the first valid env (so missing-in-X rows default sensibly).
const effectiveWinner = (d, sel) => {
  const opts = winnerOptions(d);
  return opts.includes(sel?.winner) ? sel.winner : opts[0];
};

function PresencePill({ present, label }) {
  return present
    ? <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 4, background: '#dcfce7', color: '#15803d' }}>{label} ✓</span>
    : <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 4, background: '#e2e8f0', color: '#94a3b8', textDecoration: 'line-through' }}>{label} ✗</span>;
}

// Red/green side-by-side body diff, or a plain status panel when a body is missing.
function BodyOrDetail({ d, SRC, TGT }) {
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const bothBodies = d.source_body && d.target_body;

  // Lock the two code panes so they scroll together.
  useEffect(() => {
    if (!bothBodies) return;
    const l = leftRef.current, r = rightRef.current;
    if (!l || !r) return;
    let lock = false;
    const sync = (src, dst) => () => {
      if (lock) return; lock = true;
      dst.scrollTop = src.scrollTop; dst.scrollLeft = src.scrollLeft; lock = false;
    };
    const a = sync(l, r), b = sync(r, l);
    l.addEventListener('scroll', a); r.addEventListener('scroll', b);
    return () => { l.removeEventListener('scroll', a); r.removeEventListener('scroll', b); };
  }, [bothBodies]);

  if (!bothBodies) {
    return (
      <>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: THEME.textMuted, marginBottom: 4 }}>Status</div>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f8fafc', border: `1px solid ${THEME.border}`,
          borderRadius: 8, padding: 12, fontSize: 12, maxHeight: 288, overflow: 'auto', margin: 0 }}>{d.detail || ''}</pre>
      </>
    );
  }

  // Token-level matching (whitespace-insensitive) projected onto whole lines:
  // a line is highlighted only if it contains a genuinely changed token, so
  // cosmetic re-wrapping is ignored but changes show as full-line red/green.
  const { left: leftLines, right: rightLines, nAdd, nDel } = tokenDiff(d.source_body, d.target_body);
  const renderLines = (lines, kind) => lines.map((ln, i) => (
    <div key={i} style={{ padding: '0 8px', lineHeight: '20px',
      ...(ln.changed ? (kind === 'del'
        ? { background: '#fee2e2', color: '#991b1b' }
        : { background: '#dcfce7', color: '#166534' }) : {}) }}>{ln.text || '\u00a0'}</div>
  ));
  const paneHdr = { position: 'sticky', top: 0, background: '#f1f5f9', padding: '4px 8px', fontSize: 11.5, fontWeight: 600, color: THEME.textMuted, borderBottom: `1px solid ${THEME.border}` };
  const pane = { border: `1px solid ${THEME.border}`, borderRadius: 8, overflow: 'auto', maxHeight: 384, background: '#fff' };
  // inline-block + min-width:100% lets the block grow to its widest line while
  // still filling the pane, so each line's highlight spans the full width
  // (end-to-end) even when the code scrolls horizontally.
  const pre = { fontFamily: 'ui-monospace, monospace', fontSize: 12, margin: 0, whiteSpace: 'pre', tabSize: 4, display: 'inline-block', minWidth: '100%', boxSizing: 'border-box' };
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11.5, fontWeight: 600, color: THEME.textMuted, marginBottom: 4 }}>
        <span>Full code diff</span>
        <span style={{ padding: '1px 8px', borderRadius: 4, background: '#fee2e2', color: '#b91c1c' }}>− {nDel} in {SRC}</span>
        <span style={{ padding: '1px 8px', borderRadius: 4, background: '#dcfce7', color: '#15803d' }}>+ {nAdd} in {TGT}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div ref={leftRef} style={pane}><div style={paneHdr}>{SRC} (source)</div><pre style={pre}>{renderLines(leftLines, 'del')}</pre></div>
        <div ref={rightRef} style={pane}><div style={paneHdr}>{TGT} (target)</div><pre style={pre}>{renderLines(rightLines, 'add')}</pre></div>
      </div>
    </>
  );
}

// Structured column-level table for a table schema_diff. Far more scannable than
// the old "Column 'x': EXISTS in ...; MISSING in ..." sentence blob.
function TypeCell({ type, missing, accent }) {
  if (missing) {
    return <span style={{ fontSize: 11.5, padding: '1px 8px', borderRadius: 4, background: '#f1f5f9', color: '#94a3b8', fontStyle: 'italic' }}>— missing</span>;
  }
  return <code style={{ fontSize: 12, padding: '1px 7px', borderRadius: 4, background: accent?.bg || '#f1f5f9', color: accent?.fg || THEME.text }}>{type}</code>;
}

function SchemaDiffView({ cols, SRC, TGT }) {
  const KIND = {
    missing_in_target: { label: `Only in ${SRC}`, bg: '#fee2e2', fg: '#b91c1c' },
    missing_in_source: { label: `Only in ${TGT}`, bg: '#f3e8ff', fg: '#7e22ce' },
    type_diff:         { label: 'Type differs',   bg: '#ffedd5', fg: '#c2410c' },
  };
  const counts = cols.reduce((a, c) => { a[c.kind] = (a[c.kind] || 0) + 1; return a; }, {});
  const th = { textAlign: 'left', padding: '7px 12px', fontSize: 11, color: THEME.textMuted, background: '#f8fafc', borderBottom: `1px solid ${THEME.border}` };
  const tdc = { padding: '7px 12px', fontSize: 12.5, borderTop: `1px solid #f1f5f9`, verticalAlign: 'middle' };

  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {Object.entries(counts).map(([k, n]) => (
          <span key={k} style={{ fontSize: 11.5, padding: '2px 9px', borderRadius: 999, background: KIND[k].bg, color: KIND[k].fg, fontWeight: 600 }}>
            {n} {KIND[k].label.toLowerCase()}
          </span>
        ))}
      </div>
      <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Column</th>
              <th style={th}>{SRC} (source)</th>
              <th style={th}>{TGT} (target)</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {cols.map((c, i) => {
              const k = KIND[c.kind];
              return (
                <tr key={i}>
                  <td style={{ ...tdc, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>{c.column}</td>
                  <td style={tdc}>
                    <TypeCell type={c.source_type} missing={c.kind === 'missing_in_source'}
                      accent={c.kind === 'type_diff' ? { bg: '#ffedd5', fg: '#c2410c' } : null} />
                  </td>
                  <td style={tdc}>
                    <TypeCell type={c.target_type} missing={c.kind === 'missing_in_target'}
                      accent={c.kind === 'type_diff' ? { bg: '#ffedd5', fg: '#c2410c' } : null} />
                  </td>
                  <td style={tdc}>
                    <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 4, background: k.bg, color: k.fg, fontWeight: 600, whiteSpace: 'nowrap' }}>{k.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Clean, scannable view for a function overload that exists on one side only.
// Shows the missing overload's parameters (one per line) and the overload(s)
// that DO exist on the other side, highlighting exactly which parameters differ.
function ParamRow({ text, kind }) {
  // kind: 'plain' | 'added' | 'removed'
  const style = {
    added:   { background: '#dcfce7', color: '#166534' },
    removed: { background: '#fee2e2', color: '#991b1b' },
    plain:   { background: 'transparent', color: THEME.text },
  }[kind] || {};
  const mark = kind === 'added' ? '+ ' : kind === 'removed' ? '− ' : '';
  return (
    <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5, padding: '2px 8px',
      borderRadius: 4, ...style }}>{mark}{text}</div>
  );
}

function OverloadCard({ label, side, params, addedParams, removedParams }) {
  const added = new Set(addedParams || []);
  return (
    <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '5px 10px', fontSize: 11.5, fontWeight: 700, color: THEME.textMuted, background: '#f8fafc',
        borderBottom: `1px solid ${THEME.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{label} <span style={{ fontWeight: 400 }}>({side})</span></span>
        <span style={{ flex: 1 }} />
        <span style={{ fontWeight: 400 }}>{params.length} params</span>
      </div>
      <div style={{ padding: '6px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {params.length === 0
          ? <ParamRow text="(no parameters)" kind="plain" />
          : params.map((p, i) => <ParamRow key={i} text={p} kind={added.has(p) ? 'added' : 'plain'} />)}
        {(removedParams && removedParams.length > 0) && removedParams.map((p, i) => (
          <ParamRow key={`r${i}`} text={p} kind="removed" />
        ))}
      </div>
    </div>
  );
}

function ParamOverloadView({ info, name, SRC, TGT }) {
  // The exact overload lives on `present_side`; the opposite side has the
  // other overload(s). We ALWAYS render source on the left, target on the
  // right (consistent with the presence pills), regardless of which side the
  // overload happens to be on.
  const presentIsSource = info.present_side === 'source';
  const refCard = { params: info.signature_params, isRef: true };
  const sourceOverloads = presentIsSource ? [refCard] : (info.other_overloads || []);
  const targetOverloads = presentIsSource ? (info.other_overloads || []) : [refCard];

  const renderSide = (label, side, overloads) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {overloads.length === 0
        ? <div style={{ fontSize: 12.5, color: THEME.textMuted, padding: 8, border: `1px dashed ${THEME.border}`, borderRadius: 8 }}>
            {label} has no overload of <code>{name}</code>.
          </div>
        : overloads.map((o, i) => (
          <OverloadCard
            key={i} label={label} side={side}
            params={o.params}
            addedParams={o.isRef ? [] : o.added_params}
            removedParams={o.isRef ? [] : o.removed_params}
          />
        ))}
    </div>
  );

  return (
    <>
      <div style={{ fontSize: 13, marginBottom: 10 }}>
        This overload of <code style={{ fontFamily: 'ui-monospace, monospace' }}>{name}</code> exists in{' '}
        <b style={{ color: THEME.emerald }}>{info.present_in}</b> but is{' '}
        <b style={{ color: THEME.danger }}>missing in {info.missing_in}</b>.
        {' '}{info.missing_in} has {(info.other_overloads || []).length === 1 ? 'a different overload' : 'different overloads'} of
        the same name — highlighted parameters below show what differs.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {renderSide(SRC, 'source', sourceOverloads)}
        {renderSide(TGT, 'target', targetOverloads)}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: THEME.textMuted }}>
        <span style={{ background: '#dcfce7', color: '#166534', padding: '0 6px', borderRadius: 4, fontFamily: 'ui-monospace, monospace' }}>+ extra</span>{' '}
        param this overload has that the {info.present_in} overload lacks ·{' '}
        <span style={{ background: '#fee2e2', color: '#991b1b', padding: '0 6px', borderRadius: 4, fontFamily: 'ui-monospace, monospace' }}>− missing</span>{' '}
        param the {info.present_in} overload has but this one lacks.
      </div>
    </>
  );
}

// Element chips for a list-column diff (added = only in source, removed = only in target).
function ListChips({ items, more, bg, fg, sign }) {
  if (!items.length && !more) return <span style={{ fontSize: 12, color: THEME.textMuted }}>—</span>;
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {items.map((x, i) => (
        <span key={i} style={{ fontSize: 11.5, fontFamily: 'ui-monospace, monospace', padding: '1px 6px', borderRadius: 4, background: bg, color: fg }}>
          {sign}{x === null ? 'NULL' : x}
        </span>
      ))}
      {more > 0 && <span style={{ fontSize: 11, color: THEME.textMuted }}>+{more} more</span>}
    </span>
  );
}

// One changed row rendered as a collapsible card, keyed by primary key,
// showing only the fields that differ. Lists use element-level set diffs.
function ChangedCard({ row, pkCol, SRC, TGT }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <button onClick={() => setOpen((v) => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f8fafc', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ color: THEME.textMuted, fontSize: 12 }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>
          <span style={{ color: THEME.textMuted }}>{pkCol}=</span><b>{row.pk}</b>
          {row.label ? <span style={{ color: '#9ca3af' }}> · {row.label}</span> : ''}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, padding: '1px 8px', borderRadius: 4, background: '#fef9c3', color: '#854d0e' }}>
          {row.fields.length} field{row.fields.length > 1 ? 's' : ''} differ
        </span>
      </button>
      {open && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: '#fff', color: THEME.textMuted, fontSize: 11 }}>
              <th style={{ textAlign: 'left', padding: '6px 12px', borderTop: `1px solid ${THEME.border}` }}>Column</th>
              <th style={{ textAlign: 'left', padding: '6px 12px', borderTop: `1px solid ${THEME.border}` }}>{SRC} (source)</th>
              <th style={{ textAlign: 'left', padding: '6px 12px', borderTop: `1px solid ${THEME.border}` }}>{TGT} (target)</th>
            </tr>
          </thead>
          <tbody>
            {row.fields.map((f, i) => (
              <tr key={i} style={{ borderTop: `1px solid #f1f5f9` }}>
                <td style={{ padding: '6px 12px', fontFamily: 'ui-monospace, monospace', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{f.column}</td>
                {f.type === 'list' ? (
                  f.reorder_only ? (
                    <td colSpan={2} style={{ padding: '6px 12px', color: THEME.textMuted, fontStyle: 'italic' }}>
                      same {f.source_count} elements, different order
                    </td>
                  ) : (
                    <>
                      <td style={{ padding: '6px 12px', verticalAlign: 'top' }}>
                        <div style={{ fontSize: 10.5, color: THEME.textMuted, marginBottom: 2 }}>in {SRC}, missing in {TGT}</div>
                        <ListChips items={f.added} more={f.added_more} bg="#dcfce7" fg="#166534" sign="+" />
                      </td>
                      <td style={{ padding: '6px 12px', verticalAlign: 'top' }}>
                        <div style={{ fontSize: 10.5, color: THEME.textMuted, marginBottom: 2 }}>in {TGT}, missing in {SRC}</div>
                        <ListChips items={f.removed} more={f.removed_more} bg="#fee2e2" fg="#991b1b" sign="−" />
                      </td>
                    </>
                  )
                ) : (
                  <>
                    <td style={{ padding: '6px 12px', fontFamily: 'ui-monospace, monospace', verticalAlign: 'top', background: '#fef2f2', color: '#991b1b', wordBreak: 'break-word' }}>{f.source === null ? <i>NULL</i> : f.source}</td>
                    <td style={{ padding: '6px 12px', fontFamily: 'ui-monospace, monospace', verticalAlign: 'top', background: '#f0fdf4', color: '#166534', wordBreak: 'break-word' }}>{f.target === null ? <i>NULL</i> : f.target}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Compact, scannable list of PK-only rows (present in just one env).
function OnlyInList({ rows, pkCol, label, accent }) {
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: THEME.textMuted, marginBottom: 4 }}>
        Rows only in {label} ({rows.length})
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {rows.map((r, i) => (
          <span key={i} style={{ fontSize: 11.5, fontFamily: 'ui-monospace, monospace', padding: '2px 8px', borderRadius: 4, background: accent.bg, color: accent.fg }}>
            <span style={{ opacity: 0.7 }}>{pkCol}=</span>{r.pk}{r.label ? <span style={{ opacity: 0.7 }}> · {r.label}</span> : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

// Structured table data diff: summary line + collapsible changed-row cards +
// only-in-X PK lists. Replaces the old big-array text dump.
function DataDiffView({ data, SRC, TGT, excluded }) {
  const rc = data.row_count || {};
  const changed = data.changed || [];
  const excl = excluded || [];
  // Call out when the table has rows on one side but is completely empty on the
  // other — a common, easy-to-miss case behind a "X only in Y" data diff.
  const emptyEnv = rc.source === 0 && rc.target > 0 ? SRC
    : rc.target === 0 && rc.source > 0 ? TGT : null;
  const otherEnv = emptyEnv === SRC ? TGT : SRC;
  const otherCount = emptyEnv === SRC ? rc.target : rc.source;
  const emptyNote = emptyEnv && (
    <div style={{ marginBottom: 10, padding: '8px 12px', background: '#eff6ff', border: '1px solid #bfdbfe',
      borderRadius: 8, color: '#1e40af', fontSize: 12.5 }}>
      This table is <b>empty in {emptyEnv}</b> — {otherEnv} has {otherCount} row{otherCount === 1 ? '' : 's'}.
    </div>
  );
  if (data.schema_mismatch) {
    return (
      <div>
        {emptyNote}
        <div style={{ padding: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, color: '#92400e', fontSize: 12.5 }}>
          Row count: {SRC}={rc.source}, {TGT}={rc.target}. <b>No shared columns</b> — can't compare rows.
          See the <b>Schema diff</b> entry for this table for column-level details.
        </div>
      </div>
    );
  }
  return (
    <div>
      {emptyNote}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11.5, marginBottom: 10 }}>
        <span style={{ padding: '2px 8px', borderRadius: 4, background: '#f1f5f9', color: THEME.textMuted }}>rows: {SRC} {rc.source} · {TGT} {rc.target}</span>
        {excl.length > 0 && (
          <span title={excl.join(', ')} style={{ padding: '2px 8px', borderRadius: 4, background: '#fef3c7', color: '#92400e' }}>
            {excl.length} column{excl.length === 1 ? '' : 's'} excluded from data check: {excl.join(', ')}
          </span>
        )}
        {changed.length > 0 && <span style={{ padding: '2px 8px', borderRadius: 4, background: '#fef9c3', color: '#854d0e' }}>{changed.length} changed</span>}
        {data.only_in_source?.length > 0 && <span style={{ padding: '2px 8px', borderRadius: 4, background: '#dcfce7', color: '#166534' }}>{data.only_in_source.length} only in {SRC}</span>}
        {data.only_in_target?.length > 0 && <span style={{ padding: '2px 8px', borderRadius: 4, background: '#fee2e2', color: '#991b1b' }}>{data.only_in_target.length} only in {TGT}</span>}
      </div>
      {changed.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {changed.map((row, i) => (
            <ChangedCard key={i} row={row} pkCol={data.pk_column} SRC={SRC} TGT={TGT} />
          ))}
        </div>
      )}
      <OnlyInList rows={data.only_in_source || []} pkCol={data.pk_column} label={SRC} accent={{ bg: '#dcfce7', fg: '#166534' }} />
      <OnlyInList rows={data.only_in_target || []} pkCol={data.pk_column} label={TGT} accent={{ bg: '#fee2e2', fg: '#991b1b' }} />
    </div>
  );
}

// Small green badge shown next to an object once the user has generated SQL
// (an export) for it in the current validation run.
function ReviewedBadge() {
  return (
    <span title="SQL generated for this object — reviewed & export produced"
      style={{ fontSize: 10.5, fontWeight: 600, padding: '1px 8px', borderRadius: 999,
        background: '#dcfce7', color: '#15803d', whiteSpace: 'nowrap', display: 'inline-flex',
        alignItems: 'center', gap: 4, flexShrink: 0 }}>
      ✓ reviewed · export generated
    </span>
  );
}

function DiffRow({ d, i, SRC, TGT, sel, onSel, onWinner, reviewed }) {
  const [open, setOpen] = useState(false);
  const cat = CAT[d.category] || { label: d.category, bg: '#f1f5f9', fg: '#475569' };
  const isIdentical = d.category === 'identical';
  return (
    <div style={{ padding: 12, borderTop: `1px solid #f1f5f9` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <input type="checkbox" checked={sel.selected} disabled={isIdentical}
          title={isIdentical ? 'Identical — nothing to migrate' : undefined}
          onChange={(e) => onSel(e.target.checked)}
          style={{ width: 16, height: 16, opacity: isIdentical ? 0.4 : 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {d.name}{d.arg_signature ? <span style={{ color: '#9ca3af' }}>({d.arg_signature})</span> : ''}
          </div>
        </div>
        {reviewed && <ReviewedBadge />}
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: cat.bg, color: cat.fg }}>{cat.label}</span>
        <button onClick={() => setOpen((v) => !v)} style={{ background: 'none', border: 'none', color: THEME.indigo, fontSize: 13, cursor: 'pointer' }}>
          {open ? 'hide ▾' : 'view ▸'}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 12, paddingLeft: 28 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 8, padding: 8 }}>
              <div style={{ marginBottom: 4 }}><PresencePill present={d.source_present !== false} label={SRC} /></div>
              <div style={{ fontSize: 11, color: THEME.textMuted }}>source</div>
            </div>
            <div style={{ border: `1px solid ${THEME.border}`, borderRadius: 8, padding: 8 }}>
              <div style={{ marginBottom: 4 }}><PresencePill present={d.target_present !== false} label={TGT} /></div>
              <div style={{ fontSize: 11, color: THEME.textMuted }}>target</div>
            </div>
          </div>
          {d.category === 'data_diff' && d.data
            ? <DataDiffView data={d.data} SRC={SRC} TGT={TGT} excluded={d.excluded_columns} />
            : d.category === 'param_diff' && d.param_overload
            ? <ParamOverloadView info={d.param_overload} name={d.name} SRC={SRC} TGT={TGT} />
            : d.category === 'schema_diff' && d.column_diffs?.length
            ? <SchemaDiffView cols={d.column_diffs} SRC={SRC} TGT={TGT} />
            : <BodyOrDetail d={d} SRC={SRC} TGT={TGT} />}
          {isIdentical ? (
            <div style={{ marginTop: 12, fontSize: 13, color: THEME.emerald }}>
              Identical in both environments — nothing to migrate.
            </div>
          ) : (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 16, fontSize: 13 }}>
            <span style={{ color: THEME.textMuted }}>Winner:</span>
            {(() => {
              const opts = winnerOptions(d);
              const win = effectiveWinner(d, sel);
              const labelFor = (o) => (o === 'source' ? SRC : TGT);
              return opts.length === 1 ? (
                <span style={{ fontWeight: 600 }}>{labelFor(opts[0])} <span style={{ fontWeight: 400, color: THEME.textMuted }}>(only env with this object)</span></span>
              ) : opts.map((o) => (
                <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="radio" checked={win === o} onChange={() => onWinner(o)} /> {labelFor(o)}
                </label>
              ));
            })()}
          </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Step3Results({ data, isSample, onBack }) {
  const [view, setView] = useState('diffs'); // 'diffs' | 'inventory' | 'refint'
  const [activeFilter, setActiveFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selections, setSelections] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null); // { files, notes }
  const [exportError, setExportError] = useState('');
  // Keys of objects the user has generated SQL (an export) for. Drives the
  // "reviewed · export generated" badge. Scoped to the CURRENT validation run:
  // reset below whenever fresh `data` arrives. (To persist across reloads,
  // swap this Set for a localStorage-backed store keyed by SRC→TGT.)
  const [exported, setExported] = useState(() => new Set());

  // A new validation run = new `data`. Clear per-run UI state so stale
  // selections / review badges don't carry over to different diffs.
  useEffect(() => {
    setSelections({});
    setExported(new Set());
    setExportResult(null);
    setExportError('');
  }, [data]);

  const SRC = (data.source && data.source.label) || 'SOURCE';
  const TGT = (data.target && data.target.label) || 'TARGET';
  const summary = data.summary || {};
  const byType = summary.by_object_type || {};

  const setSel = (key, patch) =>
    setSelections((prev) => ({ ...prev, [key]: { selected: false, winner: 'source', ...prev[key], ...patch } }));

  const filtered = useMemo(() => (
    (data.diffs || [])
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => activeFilter === 'all' || d.object_type === activeFilter)
      .filter(({ d }) => !search || d.name.toLowerCase().includes(search.toLowerCase()))
  ), [data.diffs, activeFilter, search]);

  const groups = useMemo(() => {
    const g = {};
    filtered.forEach((o) => { (g[o.d.object_type] ||= []).push(o); });
    return g;
  }, [filtered]);

  const chosen = Object.values(selections).filter((s) => s.selected);
  const types = ['all', ...Object.keys(byType)];
  const parts = Object.keys(byType).map((t) => `${byType[t]} ${TYPE_LABEL[t] || t}`);

  // Build the export payload from the user's selections + chosen winners.
  const selectedItems = () => (data.diffs || [])
    .map((d, i) => ({ d, key: keyOf(d, i) }))
    .filter(({ key }) => selections[key] && selections[key].selected)
    .map(({ d, key }) => ({
      object_type: d.object_type, name: d.name, arg_signature: d.arg_signature || '',
      category: d.category, winner: effectiveWinner(d, selections[key]),
    }));

  const handleGenerate = async () => {
    if (isSample) {
      setExportError('Generate SQL is disabled in sample preview — run a real validation first.');
      setExportResult(null);
      setModalOpen(true);
      return;
    }
    setModalOpen(true);
    setExporting(true);
    setExportError('');
    setExportResult(null);
    try {
      const { data: res } = await migratorApi.exportDiff(selectedItems());
      setExportResult(res);
      // Mark every object we just generated SQL for as reviewed/exported.
      const doneKeys = (data.diffs || [])
        .map((d, i) => keyOf(d, i))
        .filter((key) => selections[key] && selections[key].selected);
      setExported((prev) => {
        const next = new Set(prev);
        doneKeys.forEach((k) => next.add(k));
        return next;
      });
    } catch (err) {
      setExportError(errText(err));
    } finally {
      setExporting(false);
    }
  };

  const downloadAll = () => {
    (exportResult?.files || []).forEach((f) => downloadText(f.name, f.content));
  };

  return (
    <>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: THEME.textMuted, fontSize: 13, cursor: 'pointer' }}>← change inputs</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={pill(view === 'diffs')} onClick={() => setView('diffs')}>Differences</button>
          <button style={pill(view === 'inventory')} onClick={() => setView('inventory')} disabled={isSample}
            title={isSample ? 'Inventory needs a live connection' : undefined}>Inventory</button>
          <button style={pill(view === 'refint')} onClick={() => setView('refint')} disabled={isSample}
            title={isSample ? 'Function Reference Audit needs a live connection' : undefined}>Function Reference Audit</button>
        </div>
      </div>

      {view === 'inventory' ? (
        <InventoryView SRC={SRC} TGT={TGT} />
      ) : view === 'refint' ? (
        <RefIntegrityView TGT={TGT} />
      ) : (
      <>

      {isSample && (
        <div style={{ marginBottom: 12, borderRadius: 8, background: '#fef3c7', border: '1px solid #fcd34d',
          color: '#92400e', fontSize: 12.5, padding: '8px 12px' }}>
          <b>Sample preview.</b> The backend <code>/api/migrator/diffs</code> endpoint isn't built yet, so this
          shows representative sample data to demonstrate the Step 3 UI. Real diffs will render here unchanged once it's wired.
        </div>
      )}

      <header style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{SRC} → {TGT}</h1>
          <span style={{ fontSize: 13, color: THEME.textMuted }}>{data.source?.schema ? `(${data.source.schema})` : ''}</span>
        </div>
        <p style={{ margin: '4px 0 0', color: THEME.textMuted }}>{summary.total_diffs || 0} differences:  {parts.join('  ·  ')}</p>
        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {types.map((t) => (
            <button key={t} style={pill(activeFilter === t)} onClick={() => setActiveFilter(t)}>
              {t === 'all' ? `All (${summary.total_diffs || 0})` : `${TYPE_LABEL[t] || t} (${byType[t]})`}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', marginTop: 12 }}>
          <MdSearch size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px 8px 32px', borderRadius: 8, border: `1px solid ${THEME.border}`, fontSize: 13.5 }} />
        </div>
      </header>

      <main style={{ paddingBottom: 80 }}>
        {filtered.length === 0 ? (
          <p style={{ textAlign: 'center', color: THEME.textMuted, padding: '40px 0' }}>No differences match.</p>
        ) : (
          Object.keys(groups).map((type) => (
            <section key={type} style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: THEME.textMuted, marginBottom: 8 }}>
                {TYPE_LABEL[type] || type}
              </h2>
              <div style={{ background: THEME.surface, borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                {groups[type].map(({ d, i }) => {
                  const key = keyOf(d, i);
                  const sel = selections[key] || { selected: false, winner: 'source' };
                  return (
                    <DiffRow key={key} d={d} i={i} SRC={SRC} TGT={TGT} sel={sel}
                      reviewed={exported.has(key)}
                      onSel={(v) => setSel(key, { selected: v })}
                      onWinner={(w) => setSel(key, { winner: w })} />
                  );
                })}
              </div>
            </section>
          ))
        )}
      </main>

      {/* Sticky export bar */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: `1px solid ${THEME.border}`, boxShadow: '0 -2px 8px rgba(0,0,0,0.06)', zIndex: 50 }}>
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '12px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: THEME.textMuted }}><b>{chosen.length}</b> selected for export</span>
          <button disabled={chosen.length === 0 || exporting} onClick={handleGenerate}
            style={{ ...pill(true), opacity: (chosen.length === 0 || exporting) ? 0.4 : 1, cursor: (chosen.length === 0 || exporting) ? 'not-allowed' : 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {exporting ? <><MdSync size={16} className="spin" /> Generating…</> : 'Generate SQL'}
          </button>
        </div>
      </div>

      {modalOpen && (
        <div onClick={() => setModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, maxWidth: 820, width: '100%', maxHeight: '85vh', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottom: `1px solid ${THEME.border}`, position: 'sticky', top: 0, background: '#fff' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Generated SQL{exportResult?.files?.length ? ` (${exportResult.files.length} file${exportResult.files.length > 1 ? 's' : ''})` : ''}</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {exportResult?.files?.length > 0 && (
                  <button onClick={downloadAll} style={{ ...pill(true), fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <MdDownload size={16} /> Download all
                  </button>
                )}
                <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', fontSize: 24, color: '#9ca3af', cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>
            </div>
            <div style={{ padding: 16, fontSize: 13 }}>
              {exporting && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: THEME.indigo, padding: '20px 0' }}>
                  <MdSync size={18} className="spin" /> Generating SQL from the winning environments…
                </div>
              )}
              {exportError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: THEME.danger }}>
                  <MdError size={18} /> {exportError}
                </div>
              )}
              {!exporting && !exportError && exportResult && (
                <>
                  {(exportResult.files || []).map((f, idx) => (
                    <div key={idx} style={{ marginBottom: 16, border: `1px solid ${THEME.border}`, borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f8fafc', borderBottom: `1px solid ${THEME.border}` }}>
                        <MdInsertDriveFile size={16} style={{ color: THEME.textMuted }} />
                        <span style={{ fontFamily: 'monospace', fontSize: 12.5, flex: 1, wordBreak: 'break-all' }}>{f.name}</span>
                        <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 4, background: '#eef2ff', color: THEME.indigo }}>{f.action}</span>
                        <span style={{ fontSize: 11, color: THEME.textMuted }}>winner: {f.winner_env}</span>
                        <button onClick={() => downloadText(f.name, f.content)} title="Download" style={{ background: 'none', border: 'none', color: THEME.indigo, cursor: 'pointer', display: 'inline-flex' }}>
                          <MdDownload size={16} />
                        </button>
                      </div>
                      <pre style={{ margin: 0, padding: 12, fontSize: 11.5, fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre', overflow: 'auto', maxHeight: 300, background: '#fff' }}>{f.content}</pre>
                    </div>
                  ))}
                  {(exportResult.notes || []).length > 0 && (
                    <div style={{ marginTop: 8, padding: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, color: '#92400e', fontSize: 12.5 }}>
                      <b>Notes</b>
                      {(exportResult.notes || []).map((n, i) => (<div key={i} style={{ marginTop: 4 }}>• {n}</div>))}
                    </div>
                  )}
                  {(exportResult.files || []).length === 0 && (exportResult.notes || []).length === 0 && (
                    <p style={{ color: THEME.textMuted }}>Nothing was generated for the selected objects.</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </>
  );
}
