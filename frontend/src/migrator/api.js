import axios from 'axios';

// Isolated API client for the Migrator tool. We deliberately do NOT import or
// extend Pranjal's src/api/* modules — this keeps our integration self-contained.
//
// MIGRATOR_API_BASE points at OUR backend's migrator endpoints. These do not
// exist yet (frontend-first); the calls below will surface a clear error until
// the backend is wired. Override via Vite env VITE_MIGRATOR_API_BASE if our
// service runs on a different origin/port (e.g. http://localhost:8001/api/migrator).
export const MIGRATOR_API_BASE =
  import.meta.env.VITE_MIGRATOR_API_BASE || '/api/migrator';

// 5-minute timeout: Step 3 validation can fetch rows for every static table +
// all function bodies over VPN. The backend parallelises source/target and
// bulk-fetches columns, but very large schemas can still take a few minutes.
const client = axios.create({ baseURL: MIGRATOR_API_BASE, timeout: 300000 });

export const migratorApi = {
  // Step 1: open persistent source + target connections with user-entered creds.
  connect: ({ username, password, sourceEnv, targetEnv, sourceSchema, targetSchema,
              thresholdTable, excludePrefixes, staleDays }) =>
    client.post('/connect', {
      username,
      password,
      source_env: sourceEnv,
      target_env: targetEnv,
      source_schema: sourceSchema,
      target_schema: targetSchema,
      threshold_table: thresholdTable,
      exclude_prefixes: excludePrefixes,
      stale_days: staleDays,
    }),

  status: () => client.get('/status'),

  disconnect: () => client.post('/disconnect'),

  // Step 2: list tables + functions from the held connections.
  getObjects: () => client.get('/objects'),

  // Step 2 (classification): discover + merge with the persisted CSV store,
  // and save user edits (static/dynamic overrides + skip flags) back to it.
  getClassification: () => client.get('/classification'),
  saveClassification: ({ tables, functions }) =>
    client.post('/classification', { tables, functions }),
  // Ordered column names for one table (Step 2 exclude-columns multiselect).
  tableColumns: (table) => client.get('/table-columns', { params: { table } }),

  // Step 3: diffs (existing migration_diffs contract) + export.
  getDiffs: () => client.get('/diffs'),
  // items: [{ object_type, name, arg_signature, category, winner }]
  exportDiff: (items) => client.post('/export', { items }),
  // Table + function inventory (db_validator Sections A & D). Refreshes the
  // per-side CSVs and returns the merged source/target view with last-seen.
  getInventory: () => client.get('/inventory'),
  // Reference-integrity check (db_validator Section F, TARGET only). Flags
  // unresolved table references inside target function/procedure bodies.
  getRefIntegrity: () => client.get('/ref-integrity'),
};

// Normalize axios errors into a short human string for the UI.
export const errText = (err) => {
  const d = err?.response?.data?.detail;
  if (Array.isArray(d)) return d.map((e) => e.msg || JSON.stringify(e)).join(', ');
  if (typeof d === 'string') return d;
  if (err?.message) return err.message;
  return 'Request failed';
};
