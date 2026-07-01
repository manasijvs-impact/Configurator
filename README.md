# BaseSmart Filter Configurator

A web-based tool for managing filter configurations in the BaseSmart tool.

## Project Structure

```
Configurator/
├── backend/                        # Python FastAPI
│   ├── app/
│   │   ├── main.py                 # FastAPI entry (API routes)
│   │   ├── core/                   # database, db_config, pydantic models
│   │   ├── validators/             # one module per validator surface
│   │   │   ├── reco_metrics.py
│   │   │   ├── reco_grid_data.py
│   │   │   ├── summary_cards.py
│   │   │   ├── monthly_summary_cards.py
│   │   │   ├── monthly_detailed_view.py
│   │   │   ├── monthly_forecast.py
│   │   │   └── monthly_forecast_actuals.py
│   │   ├── configurator/           # screen/template definitions
│   │   └── scripts/                # one-off dumps + planner
│   ├── tests/
│   └── requirements.txt
│
├── frontend/                       # React + Vite
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   ├── api/                    # one file per domain; index.js composes
│   │   │   ├── connection.js · hierarchy.js · segments.js · screens.js · …
│   │   │   └── validators/         # reco_metrics, reco_grid_data, summary_cards, …
│   │   ├── components/             # shared widgets (ConnectionDialog, …)
│   │   └── pages/                  # route-level screens
│   │       ├── LoginPage.jsx · LandingPage.jsx · DataValidatorPage.jsx · ConfiguratorPage.jsx
│   │       └── configurator/       # sub-screens under Configurator
│   ├── package.json
│   └── vite.config.js
│
├── queries/                        # canonical SQL dumps used as reference
└── docs/                           # validator design notes
```

## Setup Instructions

### Backend

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the server (from the backend/ directory)
uvicorn app.main:app --reload --port 8000
```

Backend will run at `http://localhost:8000`

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev
```

Frontend will run at `http://localhost:5173`

## Usage

1. **Connect to Database**
   - Enter client name (e.g., LESL)
   - Select environment (dev/test/uat/prod)
   - Enter PostgreSQL credentials

2. **Configure Product Hierarchy**
   - Enter number of hierarchy levels
   - Fill in display names (auto-generates labels)
   - Set cascading and visibility options
   - Save to database

3. **Configure Store Hierarchy**
   - Same flow as product hierarchy

## Database Tables

The configurator manages these tables:

```sql
-- Product Hierarchy
CREATE TABLE base_pricing.bp_product_hierarchy_level (
    product_hierarchy_level_id int2 PRIMARY KEY,
    product_hierarchy_level_value varchar,
    product_hierarchy_level_label varchar,
    is_cascading bool DEFAULT true,
    report_hierarchy_dropdown bool,
    is_competitor_mapping_view_by bool DEFAULT false,
    is_strategy_step4_view_by bool DEFAULT false,
    is_zone_mapping_view_by bool DEFAULT false
);

-- Store Hierarchy
CREATE TABLE base_pricing.bp_store_hierarchy_level (
    store_hierarchy_level_id int2 PRIMARY KEY,
    store_hierarchy_level_value varchar(50),
    store_hierarchy_level_label varchar,
    is_cascading bool DEFAULT true,
    report_hierarchy_dropdown bool
);
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/connect` | Connect to database |
| POST | `/api/disconnect` | Disconnect |
| GET | `/api/connection-status` | Check connection |
| GET | `/api/product-hierarchy` | Get product levels |
| POST | `/api/product-hierarchy/save` | Save product levels |
| GET | `/api/store-hierarchy` | Get store levels |
| POST | `/api/store-hierarchy/save` | Save store levels |
