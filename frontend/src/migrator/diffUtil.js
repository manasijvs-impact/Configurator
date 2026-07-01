// Line-level LCS diff. Returns an array of { type: 'equal'|'del'|'add', a, b }.
//
// Lines are compared on a whitespace-collapsed key (all runs of whitespace ->
// single space, then trimmed) so cosmetic-only differences — extra spaces,
// indentation changes, and moved blank lines — are treated as EQUAL and never
// painted as changes. This keeps the viewer consistent with the backend
// body-equality check (diffs._canonical), which also collapses whitespace
// before comparing. Original line text is preserved for display.
const _normLine = (s) => (s || '').replace(/\s+/g, ' ').trim();

export function lineDiff(srcText, tgtText) {
  const aRaw = (srcText || '').split('\n');
  const bRaw = (tgtText || '').split('\n');
  const a = aRaw.map(_normLine), b = bRaw.map(_normLine);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ type: 'equal', a: aRaw[i], b: bRaw[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: 'del', a: aRaw[i], b: null }); i++; }
    else { rows.push({ type: 'add', a: null, b: bRaw[j] }); j++; }
  }
  while (i < n) { rows.push({ type: 'del', a: aRaw[i], b: null }); i++; }
  while (j < m) { rows.push({ type: 'add', a: null, b: bRaw[j] }); j++; }
  return rows;
}

// ── Token-level (whitespace-insensitive) diff ──
//
// Splits each body into non-whitespace tokens and diffs at TOKEN granularity,
// so differences that are purely cosmetic re-wrapping/indentation (e.g. `WITH`
// on its own line vs `WITH raw_data AS (` on one line) are NOT flagged — only
// genuinely added/removed tokens are. The original text (including all
// newlines/indentation) is preserved for display. This matches the backend
// body-equality check (diffs._canonical), which also ignores whitespace.
//
// Highlighting is per-LINE: a line is marked changed when it contains at least
// one added/removed token. This keeps the familiar whole-line red/green look
// while still ignoring cosmetic re-wrapping (a line whose tokens all match the
// other side stays unhighlighted, even if its line breaks differ).
//
// Returns { left, right, nAdd, nDel } where left/right are arrays of
// { text, changed } (one per original line) and nDel/nAdd count changed lines.
const _tokenize = (text) => {
  const toks = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) toks.push({ value: m[0], start: m.index, end: re.lastIndex });
  return toks;
};

// Token-level del/add classification (whitespace-insensitive), with common
// prefix/suffix trimming and a memory guard on the O(an*bn) LCS matrix.
const _tokenTypes = (A, B) => {
  const n = A.length, m = B.length;
  const aType = new Array(n).fill('equal');
  const bType = new Array(m).fill('equal');
  let p = 0;
  while (p < n && p < m && A[p].value === B[p].value) p++;
  let s = 0;
  while (s < n - p && s < m - p && A[n - 1 - s].value === B[m - 1 - s].value) s++;
  const aLo = p, aHi = n - s, bLo = p, bHi = m - s;
  const an = aHi - aLo, bn = bHi - bLo;
  const CAP = 2_000_000;
  if (an > 0 && bn > 0 && an * bn <= CAP) {
    const dp = Array.from({ length: an + 1 }, () => new Int32Array(bn + 1));
    for (let i = an - 1; i >= 0; i--)
      for (let j = bn - 1; j >= 0; j--)
        dp[i][j] = A[aLo + i].value === B[bLo + j].value
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < an && j < bn) {
      if (A[aLo + i].value === B[bLo + j].value) { i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { aType[aLo + i] = 'del'; i++; }
      else { bType[bLo + j] = 'add'; j++; }
    }
    while (i < an) { aType[aLo + i] = 'del'; i++; }
    while (j < bn) { bType[bLo + j] = 'add'; j++; }
  } else {
    for (let i = aLo; i < aHi; i++) aType[i] = 'del';
    for (let j = bLo; j < bHi; j++) bType[j] = 'add';
  }
  return { aType, bType };
};

// Project token-level changes onto whole lines of the original text.
const _toLines = (text, toks, types) => {
  const lines = text.split('\n');
  const changed = new Array(lines.length).fill(false);
  const starts = new Int32Array(lines.length);
  let off = 0;
  for (let i = 0; i < lines.length; i++) { starts[i] = off; off += lines[i].length + 1; }
  const lineOf = (pos) => {
    let lo = 0, hi = lines.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo;
  };
  for (let k = 0; k < toks.length; k++)
    if (types[k] !== 'equal') changed[lineOf(toks[k].start)] = true;
  return lines.map((t, i) => ({ text: t, changed: changed[i] }));
};

export function tokenDiff(srcText, tgtText) {
  const src = srcText || '', tgt = tgtText || '';
  const A = _tokenize(src), B = _tokenize(tgt);
  const { aType, bType } = _tokenTypes(A, B);
  const left = _toLines(src, A, aType);
  const right = _toLines(tgt, B, bType);
  return {
    left,
    right,
    nDel: left.reduce((c, l) => c + (l.changed ? 1 : 0), 0),
    nAdd: right.reduce((c, l) => c + (l.changed ? 1 : 0), 0),
  };
}

// Diff category -> { label, badge background, text color }. Mirrors CAT in the mockup.
export const CAT = {
  missing_in_target: { label: 'missing in target', bg: '#fee2e2', fg: '#b91c1c' },
  missing_in_source: { label: 'missing in source', bg: '#f3e8ff', fg: '#7e22ce' },
  schema_diff:       { label: 'schema diff',        bg: '#ffedd5', fg: '#c2410c' },
  data_diff:         { label: 'data diff',          bg: '#fef3c7', fg: '#b45309' },
  body_diff:         { label: 'body diff',          bg: '#dbeafe', fg: '#1d4ed8' },
  param_diff:        { label: 'parameter diff',     bg: '#dbeafe', fg: '#1d4ed8' },
  default_diff:      { label: 'default diff',       bg: '#dbeafe', fg: '#1d4ed8' },
  return_type_diff:  { label: 'return type diff',   bg: '#dbeafe', fg: '#1d4ed8' },
  definition_diff:   { label: 'definition diff',    bg: '#cffafe', fg: '#0e7490' },
  identical:         { label: 'identical',          bg: '#dcfce7', fg: '#15803d' },
};

export const TYPE_LABEL = {
  table: 'Tables', function: 'Functions', procedure: 'Procedures', matview: 'Matviews',
};

// SQL action that each diff category maps to (used in the export modal). Mirrors the mockup.
export const ACTION_FOR = {
  missing_in_target: 'CREATE',
  missing_in_source: 'CREATE',
  schema_diff: 'ALTER TABLE',
  data_diff: 'INSERT + UPDATE',
  body_diff: 'DROP + CREATE',
  param_diff: 'DROP + CREATE',
  default_diff: 'DROP + CREATE',
  return_type_diff: 'DROP + CREATE',
  definition_diff: 'DROP + CREATE MATERIALIZED VIEW',
};
