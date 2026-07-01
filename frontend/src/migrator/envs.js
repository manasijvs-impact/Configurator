// Env registry for the Migrator dropdowns. Mirrors the NON-SECRET details in
// the repo-root db_connections.py (ENVIRONMENTS) so Step 1 can populate the
// source/target selectors without needing a backend round-trip. Secrets
// (username/password) are NEVER stored here — the user types those in Step 1.
//
// Keep in sync with db_connections.py if envs change.
export const ENVIRONMENTS = [
  { name: 'cb_dev',       client: 'Crackerbarrel', tier: 'Dev',  host: '10.68.0.4',  port: 5432, db: 'cb_dev',       role: 'mtp-dev' },
  { name: 'cb_test',      client: 'Crackerbarrel', tier: 'Test', host: '10.68.0.4',  port: 5432, db: 'cb_test',      role: 'mtp-dev' },
  { name: 'cb_uat',       client: 'Crackerbarrel', tier: 'Uat',  host: '10.68.1.3',  port: 5432, db: 'cb_uat',       role: 'mtp-uat-readonly' },
  { name: 'cb_prod',      client: 'Crackerbarrel', tier: 'Prod', host: '10.68.1.3',  port: 5432, db: 'cb_prod',      role: 'mtp-readonly' },
  { name: 'leslies_dev',  client: 'Leslies',       tier: 'Dev',  host: '10.75.0.2',  port: 5432, db: 'leslies_dev',  role: 'mtp-dev' },
  { name: 'leslies_test', client: 'Leslies',       tier: 'Test', host: '10.75.0.2',  port: 5432, db: 'leslies_test', role: 'mtp-dev' },
  { name: 'leslies_uat',  client: 'Leslies',       tier: 'Uat',  host: '10.75.8.4',  port: 5432, db: 'leslies_uat',  role: 'mtp-uat-readonly' },
  { name: 'leslies_prod', client: 'Leslies',       tier: 'Prod', host: '10.75.8.41', port: 5432, db: 'leslies_prod', role: 'mtp-readonly' },
];

export const envLabel = (e) => `${e.client} · ${e.tier} (${e.name})`;

export const findEnv = (name) => ENVIRONMENTS.find((e) => e.name === name) || null;
