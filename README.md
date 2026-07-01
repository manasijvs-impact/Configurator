# BaseSmart Configurator & DB Migration Tool

A web application that bundles **two tools** for the BaseSmart pricing platform:

1. **Filter Configurator** — manage product/store hierarchy and filter configurations in the BaseSmart database.
2. **DB Migration / Validation Tool** — compare two PostgreSQL environments (e.g. `dev` vs `test`), review the differences (tables, columns, data, functions, materialized views), and generate ready-to-apply **Liquibase changesets** and seed CSVs to bring a target environment in line with a source.

Both tools share one FastAPI backend and one React/Vite frontend, but are namespaced so they never collide (Configurator routes vs `/api/migrator/*`).

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running the App](#running-the-app)
- [Environments & Credentials](#environments--credentials)
- [Migration Tool Workflow](#migration-tool-workflow)
- [Generated Outputs](#generated-outputs)
- [API Endpoints](#api-endpoints)
- [Troubleshooting](#troubleshooting)
- [Security Notes](#security-notes)

---

## Features

### DB Migration / Validation Tool

- **Dual-environment connect** — opens two persistent PostgreSQL connections at once (source + target) with automatic keep-alive and transparent reconnect after long-running work.
- **Classification (Step 2)** — discovers every table and function/procedure on both sides, merges with persisted CSV overrides (`static` / `dynamic`, `skip_data_check`, `skip_schema_check`, `skip_body_check`, per-table excluded columns).
- **Difference engine (Step 3)** — computes, side by side:
  - **Presence** — objects only in source or only in target.
  - **Schema diff** — column presence + data-type differences, shown in a structured table using Postgres type aliases (`float8`, `int4`, …).
  - **Data diff** — row-by-row comparison for static tables, keyed by primary key, highlighting values missing from each side.
  - **Function / procedure diff** — presence, overload/parameter, default-value, return-type, and logical body diffs.
  - **Materialized view diff** — presence + definition comparison.
- **Function Reference Audit** (target-only) — parses every target function/procedure body and flags table references that cannot be resolved in the target schema.
- **Inventory** — table + function inventory with a 30-day history (mirrors the source-of-truth `db_validator.ipynb`).
- **Export** — generates **Liquibase `.sql` changesets** (CREATE / ALTER / DROP+CREATE) and **seed-data CSVs** for the objects you choose, including a recursive dependency-walk snapshot/rebuild for materialized views.

### Filter Configurator

- Connect to a client environment and configure **product** and **store** hierarchy levels (labels, cascading, visibility), plus customer-segment configuration, saved back to the database.

---

## Tech Stack

- **Backend:** Python 3, FastAPI, Uvicorn, psycopg 3 (`psycopg[binary]`), python-dotenv
- **Frontend:** React 18, Vite 5, Axios, react-icons
- **Reference / source of truth:** `db_validator.ipynb` (the notebook the migration logic mirrors)

---

## Project Structure

```
Configurator/
├── backend/                        # Python FastAPI
│   ├── app/
│   │   ├── main.py                 # FastAPI entry; mounts Configurator + migrator routers
│   │   ├── core/                   # database singleton, db_config, pydantic models
│   │   ├── validators/             # Configurator validator surfaces
│   │   ├── configurator/           # screen/template definitions
│   │   ├── scripts/                # one-off dumps + planner
│   │   └── migrator/               # DB Migration / Validation tool (backend)
│   │       ├── routes.py           # /api/migrator/* endpoints
│   │       ├── connections.py      # source+target connection manager, ENVIRONMENTS
│   │       ├── classification.py   # discovery + CSV-override model
│   │       ├── diffs.py            # Step 3 difference engine
│   │       ├── export.py           # Liquibase changeset + seed CSV generator
│   │       ├── inventory.py        # table/function inventory with 30-day history
│   │       └── ref_integrity.py    # Function Reference Audit (target-only)
│   ├── requirements.txt
│   └── .env                        # DB creds for diagnostics (gitignored — never commit)
│
├── frontend/                       # React + Vite
│   ├── index.html                  # Configurator entry
│   ├── migrator.html               # Migration tool entry
│   ├── src/
│   │   ├── App.jsx, main.jsx
│   │   ├── api/ · components/ · pages/     # Configurator UI
│   │   └── migrator/                       # Migration tool UI
│   │       ├── MigratorApp.jsx
│   │       ├── Step1Connect.jsx · Step2Classify.jsx · Step3Results.jsx
│   │       ├── InventoryView.jsx · RefIntegrityView.jsx
│   │       ├── api.js · diffUtil.js · envs.js · theme.js · seeds.js
│   ├── package.json
│   └── vite.config.js
│
├── queries/                        # canonical SQL dumps used as reference
└── docs/                           # validator design notes
```

---

## Prerequisites

- **Python** 3.10+ and **Node.js** 18+
- Network access (usually **VPN / internal network**) to the target PostgreSQL environments
- Valid PostgreSQL credentials for the environments you want to connect to

---

## Setup

### Backend

```bash
cd backend

# Create and activate a virtual environment
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
```

---

## Running the App

The backend serves both tools at `http://localhost:8000`; the frontend runs at `http://localhost:5173`.

### Development mode (auto-reload while editing code)

```bash
# Backend (from backend/)
uvicorn app.main:app --reload --port 8000

# Frontend (from frontend/)
npm run dev
```

### Stable mode (recommended for long sessions / demos)

`--reload` and the Vite dev server restart on every file change, which **wipes the in-memory connection and results**. For a long, uninterrupted session, run without live-reload:

```bash
# Backend (from backend/) — no --reload
uvicorn app.main:app --port 8000

# Frontend (from frontend/) — build once, then serve the fixed build
npm run build
npm run preview
```

> **Note:** results and the DB connection are held in memory only, so a manual browser refresh will still reset the app to Step 1.

---

## Environments & Credentials

- The migration tool takes your **PostgreSQL username/password directly in the Step 1 UI**. Credentials are held **in memory only** (to allow reconnects) and are **never written to disk**.
- The list of selectable environments (client, tier, host, database, role) lives in **`backend/app/migrator/connections.py`** (`ENVIRONMENTS`) and the frontend mirror `frontend/src/migrator/envs.js`. Keep these two in sync when environments change.
- The optional `backend/.env` file holds credentials used only by the standalone **diagnostic scripts** (e.g. `check_activity.py`, `check_mv_schema.py`). It is **gitignored** — do not commit it.

Environment hosts are on the internal network, so you typically need to be on **VPN** to connect.

---

## Migration Tool Workflow

1. **Step 1 — Connect:** pick a **source** and **target** environment, enter credentials, and set run knobs (excluded name prefixes, stale-days, threshold table).
2. **Step 2 — Classify:** review discovered tables and functions. Mark tables `static`/`dynamic`, toggle skip flags, and choose columns to exclude from the data check. Edits persist to the shared CSVs in `~/Downloads`.
3. **Step 3 — Results:** inspect presence, schema, data, function, and MV differences. Additional tabs: **Inventory** and **Function Reference Audit**.
4. **Export:** pick the "winners" and generate Liquibase `.sql` changesets + seed CSVs.

---

## Generated Outputs

- **Classification & inventory CSVs** → written to `~/Downloads` (notebook-compatible format).
- **Reference-integrity CSVs** → `~/Downloads`.
- **Liquibase changesets & seed CSVs** → produced by the Export step (materialized-view SQL includes a recursive dependency snapshot + rebuild).

---

## API Endpoints

### Migration Tool — `/api/migrator/*`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | `/api/migrator/envs` | List selectable environments (non-secret) |
| POST | `/api/migrator/connect` | Open source + target connections (Step 1) |
| GET  | `/api/migrator/status` | Connection status |
| POST | `/api/migrator/disconnect` | Close connections |
| GET  | `/api/migrator/objects` | List tables + functions on both sides |
| GET  | `/api/migrator/classification` | Discover + merge with persisted CSVs (Step 2) |
| POST | `/api/migrator/classification` | Save classification/skip overrides |
| GET  | `/api/migrator/table-columns` | Ordered columns for a table (exclude-columns picker) |
| GET  | `/api/migrator/diffs` | Source vs target differences (Step 3) |
| POST | `/api/migrator/export` | Generate Liquibase changesets + seed CSVs |
| GET  | `/api/migrator/inventory` | Table + function inventory |
| GET  | `/api/migrator/ref-integrity` | Function Reference Audit (target only) |

### Filter Configurator

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/connect` | Connect to database |
| POST | `/api/disconnect` | Disconnect |
| GET | `/api/connection-status` | Check connection |
| GET | `/api/product-hierarchy` | Get product levels |
| POST | `/api/product-hierarchy/save` | Save product levels |
| GET | `/api/store-hierarchy` | Get store levels |
| POST | `/api/store-hierarchy/save` | Save store levels |

Interactive API docs are available at `http://localhost:8000/docs` while the backend is running.

---

## Troubleshooting

- **"Could not reach the database host"** — you're likely off the VPN / internal network. Connect and retry.
- **"Authentication failed"** — check the username/password for the selected environment.
- **App keeps resetting / losing my results** — you're running in live-reload mode. Use **Stable mode** above (`uvicorn` without `--reload`, and `npm run preview`).
- **Inventory count differs from Step 2 count** — expected: Step 2 counts what's *live right now*; Inventory keeps a 30-day history of recently-removed objects.

---

## Security Notes

- **Never commit** `.env` files or credentials (already covered by `.gitignore`).
- Internal host IPs and DB role names live in code (`connections.py`) for internal use. Be mindful before making this repository **public** — consider moving environment/host details into an untracked config file if the repo will be shared externally.
- All migration-tool database access is read-only against the compared environments; changes are produced only as reviewable `.sql` changesets you apply yourself.
