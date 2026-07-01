from dotenv import load_dotenv
load_dotenv()  # Load environment variables from .env file

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.core.database import db
from app.validators.reco_metrics import reco_metrics_validator
from app.validators.monthly_forecast import bp_monthly_forecast_validator
from app.validators.monthly_forecast_actuals import bp_monthly_forecast_actuals_validator
from app.validators.summary_cards import summary_cards_validator
from app.validators.monthly_summary_cards import monthly_summary_cards_validator
from app.validators.monthly_detailed_view import monthly_detailed_view_validator
from app.validators.reco_grid_data import reco_grid_data_validator
from app.core.models import (
    ConnectionRequest, 
    TestConnectionRequest,
    ProductHierarchyLevel, 
    StoreHierarchyLevel,
    ProductHierarchyBulkRequest,
    StoreHierarchyBulkRequest,
    CustomerSegmentConfig
)
from typing import List, Optional
import psycopg
# MIGRATOR (added): our self-contained router, mounted below.
from app.migrator.routes import router as migrator_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: nothing needed
    yield
    # Shutdown: close database connection
    print("Shutting down: closing database connection...")
    db.disconnect()
    print("Connection closed.")


app = FastAPI(title="BaseSmart Filter Configurator", version="1.0.0", lifespan=lifespan)

# CORS middleware for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MIGRATOR (added): mount our /api/migrator/* routes onto this app.
app.include_router(migrator_router)

# ============== CONNECTION ENDPOINTS ==============

@app.post("/api/connect")
def connect_database(request: ConnectionRequest):
    """Connect to client database"""
    result = db.connect(
        host=request.host,
        port=request.port,
        database=request.database,
        username=request.username,
        password=request.password,
        client_name=request.client_name,
        environment=request.environment,
        db_schema=request.db_schema
    )
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return result

@app.post("/api/disconnect")
def disconnect_database():
    """Disconnect from database"""
    db.disconnect()
    return {"success": True, "message": "Disconnected"}

@app.get("/api/connection-status")
def connection_status():
    """Get current connection status"""
    return {
        "connected": db.is_connected(),
        "client_name": db.client_name,
        "environment": db.environment,
        "schema": db.db_schema
    }

@app.post("/api/test-connection")
def test_connection(request: TestConnectionRequest):
    """Test and establish database connection, verify schema exists"""
    try:
        # Connect using the shared db instance
        result = db.connect(
            host=request.host,
            port=request.port,
            database=request.database,
            username=request.username,
            password=request.password,
            client_name=request.instance_name or request.database,
            environment="direct",
            db_schema=request.expected_schema,
            application="base_smart" if request.expected_schema == "base_pricing" else "base_smart_restaurant"
        )
        
        if not result["success"]:
            return {"success": False, "message": result["message"]}
        
        # Check if schema exists
        schema_check = db.check_schema_exists()
        
        if schema_check.get("exists"):
            return {
                "success": True,
                "message": f"Connected successfully. Schema '{request.expected_schema}' found.",
                "schema_exists": True,
                "instance_name": request.instance_name
            }
        else:
            db.disconnect()  # Disconnect if schema not found
            return {
                "success": False,
                "message": schema_check.get("message", f"Schema '{request.expected_schema}' not found."),
                "schema_exists": False,
                "instance_name": request.instance_name
            }
            
    except psycopg.OperationalError as e:
        error_msg = str(e)
        if "password authentication failed" in error_msg.lower():
            return {"success": False, "message": "Authentication failed. Please check username and password."}
        elif "could not connect" in error_msg.lower() or "connection refused" in error_msg.lower():
            return {"success": False, "message": "Could not connect to database. Please check host and port."}
        elif "does not exist" in error_msg.lower():
            return {"success": False, "message": "Database does not exist. Please check database name."}
        else:
            return {"success": False, "message": f"Connection error: {error_msg}"}
    except Exception as e:
        return {"success": False, "message": f"Error: {str(e)}"}

# ============== PRODUCT HIERARCHY ENDPOINTS ==============

@app.get("/api/product-hierarchy")
def get_product_hierarchy():
    """Get all product hierarchy levels"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        query = f"""
            SELECT * FROM {db.db_schema}.bp_product_hierarchy_level 
            ORDER BY product_hierarchy_level_id
        """
        results = db.execute_query(query)
        return {"success": True, "data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/product-hierarchy/save")
def save_product_hierarchy(request: ProductHierarchyBulkRequest):
    """Save all product hierarchy levels (replace all)"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        # Delete existing records
        db.execute_write(f"DELETE FROM {db.db_schema}.bp_product_hierarchy_level")
        
        # Insert new records
        for level in request.levels:
            # Auto-generate label from value if not provided
            label = level.product_hierarchy_level_label
            if not label:
                label = level.product_hierarchy_level_value.lower().replace(" ", "_")
            
            query = f"""
                INSERT INTO {db.db_schema}.bp_product_hierarchy_level 
                (product_hierarchy_level_id, product_hierarchy_level_value, product_hierarchy_level_label,
                 is_cascading, report_hierarchy_dropdown, is_competitor_mapping_view_by, 
                 is_strategy_step4_view_by, is_zone_mapping_view_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """
            db.execute_write(query, (
                level.product_hierarchy_level_id,
                level.product_hierarchy_level_value,
                label,
                level.is_cascading,
                level.report_hierarchy_dropdown,
                level.is_competitor_mapping_view_by,
                level.is_strategy_step4_view_by,
                level.is_zone_mapping_view_by
            ))
        
        return {"success": True, "message": f"Saved {len(request.levels)} product hierarchy levels"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/product-hierarchy/{level_id}")
def delete_product_hierarchy_level(level_id: int):
    """Delete a single product hierarchy level"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        query = f"DELETE FROM {db.db_schema}.bp_product_hierarchy_level WHERE product_hierarchy_level_id = %s"
        rows = db.execute_write(query, (level_id,))
        return {"success": True, "deleted": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============== STORE HIERARCHY ENDPOINTS ==============

@app.get("/api/store-hierarchy")
def get_store_hierarchy():
    """Get all store hierarchy levels"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        query = f"""
            SELECT * FROM {db.db_schema}.bp_store_hierarchy_level 
            ORDER BY store_hierarchy_level_id
        """
        results = db.execute_query(query)
        return {"success": True, "data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/store-hierarchy/save")
def save_store_hierarchy(request: StoreHierarchyBulkRequest):
    """Save all store hierarchy levels (replace all)"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        # Delete existing records
        db.execute_write(f"DELETE FROM {db.db_schema}.bp_store_hierarchy_level")
        
        # Insert new records
        for level in request.levels:
            # Auto-generate label from value if not provided
            label = level.store_hierarchy_level_label
            if not label:
                label = level.store_hierarchy_level_value.lower().replace(" ", "_")
            
            query = f"""
                INSERT INTO {db.db_schema}.bp_store_hierarchy_level 
                (store_hierarchy_level_id, store_hierarchy_level_value, store_hierarchy_level_label,
                 is_cascading, report_hierarchy_dropdown)
                VALUES (%s, %s, %s, %s, %s)
            """
            db.execute_write(query, (
                level.store_hierarchy_level_id,
                level.store_hierarchy_level_value,
                label,
                level.is_cascading,
                level.report_hierarchy_dropdown
            ))
        
        return {"success": True, "message": f"Saved {len(request.levels)} store hierarchy levels"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/store-hierarchy/{level_id}")
def delete_store_hierarchy_level(level_id: int):
    """Delete a single store hierarchy level"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        query = f"DELETE FROM {db.db_schema}.bp_store_hierarchy_level WHERE store_hierarchy_level_id = %s"
        rows = db.execute_write(query, (level_id,))
        return {"success": True, "deleted": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============== CUSTOMER SEGMENT CONFIG ENDPOINTS ==============

@app.get("/api/customer-segment-config")
def get_customer_segment_config():
    """Get customer segment configuration"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        query = f"""
            SELECT is_customer_segment_enabled 
            FROM {db.db_schema}.bp_customer_segment_config 
            LIMIT 1
        """
        results = db.execute_query(query)
        if results and len(results) > 0:
            return {"success": True, "data": results[0]}
        else:
            # Return default if no config exists
            return {"success": True, "data": {"is_customer_segment_enabled": False}}
    except Exception as e:
        # Table might not exist, return default
        return {"success": True, "data": {"is_customer_segment_enabled": False}, "warning": str(e)}

@app.post("/api/customer-segment-config/save")
def save_customer_segment_config(config: CustomerSegmentConfig):
    """Save customer segment configuration"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        # Check if record exists
        check_query = f"SELECT COUNT(*) as count FROM {db.db_schema}.bp_customer_segment_config"
        result = db.execute_query(check_query)
        
        if result and result[0]['count'] > 0:
            # Update existing
            query = f"""
                UPDATE {db.db_schema}.bp_customer_segment_config 
                SET is_customer_segment_enabled = %s
            """
        else:
            # Insert new
            query = f"""
                INSERT INTO {db.db_schema}.bp_customer_segment_config (is_customer_segment_enabled) 
                VALUES (%s)
            """
        
        db.execute_write(query, (config.is_customer_segment_enabled,))
        return {"success": True, "message": "Customer segment config saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============== CUSTOMER SEGMENTS (Combined Config + Master) ==============

@app.get("/api/customer-segments")
def get_customer_segments():
    """Get customer segment config and master data"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        # Get config
        config_query = f"""
            SELECT is_customer_segment_enabled, default_segment_id 
            FROM {db.db_schema}.bp_customer_segment_config 
            LIMIT 1
        """
        config_results = db.execute_query(config_query)
        config = config_results[0] if config_results else {"is_customer_segment_enabled": False, "default_segment_id": None}
        
        # Get segments master
        segments_query = f"""
            SELECT segment_id, segment_code, segment_name, is_active 
            FROM {db.db_schema}.bp_customer_segment_master 
            ORDER BY segment_id
        """
        segments = db.execute_query(segments_query) or []
        
        return {"config": config, "segments": segments}
    except Exception as e:
        # Tables might not exist
        return {"config": {"is_customer_segment_enabled": False, "default_segment_id": None}, "segments": [], "warning": str(e)}

@app.post("/api/customer-segments/save")
def save_customer_segments(data: dict):
    """Save customer segment config and master data"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        config = data.get("config", {})
        segments = data.get("segments", [])
        
        # Save config
        check_query = f"SELECT COUNT(*) as count FROM {db.db_schema}.bp_customer_segment_config"
        result = db.execute_query(check_query)
        
        if result and result[0]['count'] > 0:
            config_query = f"""
                UPDATE {db.db_schema}.bp_customer_segment_config 
                SET is_customer_segment_enabled = %s, default_segment_id = %s
            """
        else:
            config_query = f"""
                INSERT INTO {db.db_schema}.bp_customer_segment_config (is_customer_segment_enabled, default_segment_id) 
                VALUES (%s, %s)
            """
        db.execute_write(config_query, (config.get("is_customer_segment_enabled", False), config.get("default_segment_id")))
        
        # Save segments - delete all and re-insert
        db.execute_write(f"DELETE FROM {db.db_schema}.bp_customer_segment_master")
        for seg in segments:
            seg_query = f"""
                INSERT INTO {db.db_schema}.bp_customer_segment_master 
                (segment_id, segment_code, segment_name, is_active, tenant_id)
                VALUES (%s, %s, %s, %s, %s)
            """
            db.execute_write(seg_query, (
                seg.get("segment_id"),
                seg.get("segment_code", ""),
                seg.get("segment_name", ""),
                seg.get("is_active", True),
                "default"
            ))
        
        return {"success": True, "message": "Customer segments saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============== TABLE CONFIGURATION ENDPOINTS ==============

@app.get("/api/table-config/reporting-attributes")
def get_reporting_attributes_metadata():
    """Get reporting attributes metadata (product_code, product_name, etc.)"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        query = f"""
            SELECT attribute_id, attribute_name, frontend_display_name, is_active
            FROM {db.db_schema}.bp_reporting_attributes_metadata
            ORDER BY attribute_id
        """
        results = db.execute_query(query)
        return {"success": True, "data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/table-config/product-attributes")
def get_product_attributes_metadata():
    """Get product attributes metadata (active, is_usable, size, etc.)"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        query = f"""
            SELECT attribute_id, attribute_name, frontend_display_name, is_active
            FROM {db.db_schema}.bp_product_attributes_metadata
            ORDER BY attribute_id
        """
        results = db.execute_query(query)
        return {"success": True, "data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/table-config/product-details/columns")
def get_product_details_columns():
    """Get all available columns for Product Details screen
    
    Column order:
    1. product_code (attribute_id=1040) - e.g., "SKU"
    2. product_name (attribute_id=5) - e.g., "SKU Description"
    3. Hierarchy levels (Department, Sub Department, etc.) - EXCLUDING any that match primary key display names
    4. Product attributes (Active Status, Eligibility, Size, etc.)
    
    Deduplication: If hierarchy level value matches product_code or product_name frontend_display_name,
    that hierarchy is excluded to avoid ambiguity (e.g., if both have "SKU")
    """
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        columns = []
        
        # 1. Primary key columns from reporting attributes (product_code=1040, product_name=5)
        reporting_query = f"""
            SELECT attribute_id, attribute_name, frontend_display_name
            FROM {db.db_schema}.bp_reporting_attributes_metadata
            WHERE attribute_id IN (1040, 5)
            ORDER BY CASE attribute_id WHEN 1040 THEN 1 WHEN 5 THEN 2 END
        """
        reporting_results = db.execute_query(reporting_query)
        
        # Collect primary key display names for deduplication
        primary_display_names = set()
        for row in reporting_results:
            display_name = row['frontend_display_name']
            if display_name:
                primary_display_names.add(display_name.strip().lower())
            columns.append({
                "id": f"reporting_{row['attribute_id']}",
                "source": "reporting_attributes",
                "attribute_id": row['attribute_id'],
                "column_name": row['attribute_name'],
                "display_name": display_name,
                "is_primary": row['attribute_id'] == 1040,
                "is_enabled": True,
                "order": len(columns)
            })
        
        # 2. Hierarchy columns from bp_product_hierarchy_level
        # EXCLUDE hierarchies where product_hierarchy_level_value matches primary key display names
        hierarchy_query = f"""
            SELECT product_hierarchy_level_id, product_hierarchy_level_label, product_hierarchy_level_value
            FROM {db.db_schema}.bp_product_hierarchy_level
            ORDER BY product_hierarchy_level_id
        """
        hierarchy_results = db.execute_query(hierarchy_query)
        for row in hierarchy_results:
            hierarchy_value = row['product_hierarchy_level_value']
            # Skip if this hierarchy matches a primary key column's display name
            if hierarchy_value and hierarchy_value.strip().lower() in primary_display_names:
                continue  # Deduplicate - don't add this hierarchy
            
            columns.append({
                "id": f"hierarchy_{row['product_hierarchy_level_id']}",
                "source": "product_hierarchy",
                "level_id": row['product_hierarchy_level_id'],
                "column_name": row['product_hierarchy_level_label'],
                "display_name": hierarchy_value,
                "is_primary": False,
                "is_enabled": True,
                "order": len(columns)
            })
        
        # 3. Product attributes from bp_product_attributes_metadata
        attributes_query = f"""
            SELECT attribute_id, attribute_name, frontend_display_name
            FROM {db.db_schema}.bp_product_attributes_metadata
            WHERE is_active = true
            ORDER BY attribute_id
        """
        attributes_results = db.execute_query(attributes_query)
        for row in attributes_results:
            columns.append({
                "id": f"attribute_{row['attribute_id']}",
                "source": "product_attributes",
                "attribute_id": row['attribute_id'],
                "column_name": row['attribute_name'],
                "display_name": row['frontend_display_name'],
                "is_primary": False,
                "is_enabled": True,
                "order": len(columns)
            })
        
        return {"success": True, "data": columns}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============== PRODUCT ATTRIBUTES METADATA ENDPOINTS ==============

@app.get("/api/product-attributes-metadata/schema")
def get_product_attributes_metadata_schema():
    """Get table schema/columns from DDL for dynamic editing"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        # Get column info from information_schema
        query = """
            SELECT 
                column_name,
                data_type,
                udt_name,
                is_nullable,
                column_default,
                ordinal_position
            FROM information_schema.columns
            WHERE table_schema = %s 
            AND table_name = 'bp_product_attributes_metadata'
            ORDER BY ordinal_position
        """
        results = db.execute_query(query, (db.db_schema,))
        
        columns = []
        for row in results:
            col_name = row['column_name']
            data_type = row['data_type']
            udt_name = row['udt_name']
            
            # Determine UI type based on postgres type
            ui_type = 'text'
            if data_type == 'boolean':
                ui_type = 'checkbox'
            elif data_type in ('integer', 'smallint', 'bigint'):
                ui_type = 'number'
            elif data_type == 'ARRAY':
                ui_type = 'array'
            elif data_type in ('json', 'jsonb') or udt_name in ('json', 'jsonb'):
                ui_type = 'json'
            elif 'timestamp' in data_type:
                ui_type = 'datetime'
            
            # Determine if column is editable
            readonly_columns = ['attribute_id', 'created_at', 'updated_at']
            is_editable = col_name not in readonly_columns
            
            # Determine if column should be sticky
            is_sticky = col_name in ['attribute_id', 'attribute_name']
            
            columns.append({
                'column_name': col_name,
                'data_type': data_type,
                'udt_name': udt_name,
                'is_nullable': row['is_nullable'] == 'YES',
                'column_default': row['column_default'],
                'ordinal_position': row['ordinal_position'],
                'ui_type': ui_type,
                'is_editable': is_editable,
                'is_sticky': is_sticky
            })
        
        return {"success": True, "columns": columns}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/product-attributes-metadata")
def get_product_attributes_metadata():
    """Get all product attributes metadata for editing - dynamic columns"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        # First get all columns dynamically
        schema_query = """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = %s 
            AND table_name = 'bp_product_attributes_metadata'
            ORDER BY ordinal_position
        """
        columns_result = db.execute_query(schema_query, (db.db_schema,))
        column_names = [row['column_name'] for row in columns_result]
        
        # Build dynamic SELECT with all columns
        query = f"""
            SELECT {', '.join(column_names)}
            FROM {db.db_schema}.bp_product_attributes_metadata
            ORDER BY COALESCE(column_order, 9999), attribute_id
        """
        results = db.execute_query(query)
        
        # Convert to list of dicts with proper serialization
        data = []
        for row in results:
            row_dict = {}
            for col in column_names:
                val = row.get(col)
                # Handle special types for JSON serialization
                if val is not None:
                    if hasattr(val, 'isoformat'):  # datetime
                        val = val.isoformat()
                    elif isinstance(val, (list, tuple)):
                        val = list(val)
                row_dict[col] = val
            data.append(row_dict)
        
        return {"success": True, "data": data, "columns": column_names}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/product-attributes-metadata/{attribute_id}")
def update_product_attribute_metadata(attribute_id: int, request: dict):
    """Update a single product attribute metadata - dynamic columns"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        # Get allowed columns dynamically from table schema
        schema_query = """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = %s 
            AND table_name = 'bp_product_attributes_metadata'
            AND column_name NOT IN ('attribute_id', 'created_at', 'updated_at')
        """
        columns_result = db.execute_query(schema_query, (db.db_schema,))
        allowed_fields = [row['column_name'] for row in columns_result]
        
        updates = []
        params = []
        for field in allowed_fields:
            if field in request:
                updates.append(f"{field} = %s")
                params.append(request[field])
        
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        params.append(attribute_id)
        query = f"""
            UPDATE {db.db_schema}.bp_product_attributes_metadata
            SET {', '.join(updates)}, updated_at = CURRENT_TIMESTAMP
            WHERE attribute_id = %s
            RETURNING attribute_id
        """
        
        result = db.execute_write(query, params)
        if not result:
            raise HTTPException(status_code=404, detail="Attribute not found")
        
        return {"success": True, "message": "Attribute updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/product-attributes-metadata/bulk")
def bulk_update_product_attributes_metadata(request: dict):
    """Bulk update multiple product attributes metadata - dynamic columns"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        updates = request.get('updates', [])
        if not updates:
            raise HTTPException(status_code=400, detail="No updates provided")
        
        # Get allowed columns dynamically from table schema
        schema_query = """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = %s 
            AND table_name = 'bp_product_attributes_metadata'
            AND column_name NOT IN ('attribute_id', 'created_at', 'updated_at')
        """
        columns_result = db.execute_query(schema_query, (db.db_schema,))
        allowed_fields = [row['column_name'] for row in columns_result]
        
        success_count = 0
        for update in updates:
            attribute_id = update.get('attribute_id')
            if not attribute_id:
                continue
            
            set_clauses = []
            params = []
            for field in allowed_fields:
                if field in update:
                    set_clauses.append(f"{field} = %s")
                    params.append(update[field])
            
            if set_clauses:
                params.append(attribute_id)
                query = f"""
                    UPDATE {db.db_schema}.bp_product_attributes_metadata
                    SET {', '.join(set_clauses)}, updated_at = CURRENT_TIMESTAMP
                    WHERE attribute_id = %s
                """
                db.execute_write(query, params)
                success_count += 1
        
        return {"success": True, "message": f"Updated {success_count} attributes"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============== SCREEN HIERARCHIES ENDPOINTS ==============

from app.configurator.screen_config import SCREEN_DEFINITIONS, PRODUCT_ATTRIBUTE_TEMPLATE, ZONE_STRUCTURE_TEMPLATE, \
    SEGMENT_FILTER_TEMPLATE, PRODUCT_GROUP_IDS_TEMPLATE, STORE_GROUP_IDS_TEMPLATE, \
    RULE_FILTER_TEMPLATE, STRATEGY_FILTER_TEMPLATE, generate_product_hierarchy_filter, \
    generate_store_hierarchy_filter
import json

@app.get("/api/screens")
def get_all_screens():
    """Get all screen definitions with current hierarchies from DB"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        # Get existing screen hierarchies from DB
        query = f"SELECT * FROM {db.db_schema}.bp_screen_hierarchies ORDER BY screen_id"
        db_screens = db.execute_query(query)
        db_screens_dict = {s['screen_id']: s for s in db_screens}
        
        # Merge with screen definitions
        screens = []
        for screen_id, definition in SCREEN_DEFINITIONS.items():
            screen = {
                "screen_id": screen_id,
                "screen_name": definition["screen_name"],
                "description": definition.get("description", ""),
                "allowed_filters": definition.get("allowed_filters", {}),
                "segment_filter_allowed": definition.get("segment_filter_allowed", False),
                "product_attr_allowed": definition.get("product_attr_allowed", False),
                "rule_filter_allowed": definition.get("rule_filter_allowed", False),
                "strategy_filter_allowed": definition.get("strategy_filter_allowed", False),
                "hierarchy_restriction": definition.get("hierarchy_restriction"),
                "has_db_config": screen_id in db_screens_dict
            }
            
            if screen_id in db_screens_dict:
                hierarchies = db_screens_dict[screen_id].get('hierarchies')
                if isinstance(hierarchies, str):
                    hierarchies = json.loads(hierarchies)
                screen["hierarchies"] = hierarchies
            else:
                screen["hierarchies"] = None
            
            screens.append(screen)
        
        return {"success": True, "data": screens}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# NOTE: Static routes MUST come before parameterized routes in FastAPI
@app.get("/api/screens/templates")
def get_filter_templates():
    """Get all filter templates"""
    return {
        "success": True,
        "data": {
            "product_attribute": PRODUCT_ATTRIBUTE_TEMPLATE,
            "zone_structure": ZONE_STRUCTURE_TEMPLATE,
            "segment_filter": SEGMENT_FILTER_TEMPLATE,
            "product_group_ids": PRODUCT_GROUP_IDS_TEMPLATE,
            "store_group_ids": STORE_GROUP_IDS_TEMPLATE,
            "rule_filter": RULE_FILTER_TEMPLATE,
            "strategy_filter": STRATEGY_FILTER_TEMPLATE
        }
    }

@app.get("/api/screens/check-status")
def check_screens_status():
    """Check if screen hierarchies table exists and has data, validate against hierarchy levels"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        # Check if table exists
        table_check = f"""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = '{db.db_schema}' 
                AND table_name = 'bp_screen_hierarchies'
            ) as exists
        """
        table_result = db.execute_query(table_check)
        table_exists = table_result[0]['exists'] if table_result else False
        
        if not table_exists:
            return {
                "success": True,
                "status": "table_missing",
                "message": "Screen hierarchies table does not exist",
                "configured_count": 0,
                "total_screens": len(SCREEN_DEFINITIONS),
                "needs_initialization": True
            }
        
        # Count configured screens
        count_query = f"SELECT COUNT(*) as count FROM {db.db_schema}.bp_screen_hierarchies"
        count_result = db.execute_query(count_query)
        configured_count = count_result[0]['count'] if count_result else 0
        
        # Get current hierarchy levels for validation
        product_levels = db.execute_query(
            f"SELECT product_hierarchy_level_id, product_hierarchy_level_label, is_zone_mapping_view_by, is_competitor_mapping_view_by FROM {db.db_schema}.bp_product_hierarchy_level ORDER BY product_hierarchy_level_id"
        )
        store_levels = db.execute_query(
            f"SELECT store_hierarchy_level_id, store_hierarchy_level_label FROM {db.db_schema}.bp_store_hierarchy_level ORDER BY store_hierarchy_level_id"
        )
        
        # Extract level labels for comparison (full product level info for restriction checking)
        product_labels = {f"l{l['product_hierarchy_level_id']}_ids": l['product_hierarchy_level_label'] for l in product_levels}
        product_levels_full = {f"l{l['product_hierarchy_level_id']}_ids": l for l in product_levels}
        store_labels = {f"s{l['store_hierarchy_level_id']}_ids": l['store_hierarchy_level_label'] for l in store_levels}
        
        # Special filter IDs that are NOT hierarchy levels (should be skipped in validation)
        SPECIAL_FILTER_IDS = {
            'store_group_ids', 'product_group_ids', 'product_attribute_names', 
            'structure_name', 'segment_ids', 'rule_type_ids', 'rule_ids',
            'strategy_status_display_name', 'strategy_name', 'date_range'
        }
        
        if configured_count == 0:
            return {
                "success": True,
                "status": "empty",
                "message": "No screen configurations found",
                "configured_count": 0,
                "total_screens": len(SCREEN_DEFINITIONS),
                "needs_initialization": True,
                "product_levels": list(product_labels.keys()),
                "store_levels": list(store_labels.keys())
            }
        
        # Validate existing configurations against hierarchy levels
        validation_issues = []
        db_screens = db.execute_query(f"SELECT * FROM {db.db_schema}.bp_screen_hierarchies")
        
        for screen in db_screens:
            screen_id = screen['screen_id']
            hierarchies = screen.get('hierarchies')
            if isinstance(hierarchies, str):
                hierarchies = json.loads(hierarchies)
            
            if not hierarchies:
                continue
            
            # Get screen's hierarchy restriction from definitions
            screen_definition = SCREEN_DEFINITIONS.get(screen_id, {})
            hierarchy_restriction = screen_definition.get("hierarchy_restriction")
                
            screen_issues = {"screen_id": screen_id, "issues": []}
            
            # Check product_filter hierarchies - only validate l{N}_ids pattern (not special filters)
            if "product_filter" in hierarchies:
                pf = hierarchies["product_filter"]
                for sub_key in ["hierarchies", "product_group", "specific"]:
                    if sub_key in pf:
                        sub_items = pf[sub_key]
                        if sub_key == "specific" and isinstance(sub_items, dict):
                            sub_items = sub_items.get("hierarchies", [])
                        if isinstance(sub_items, list):
                            for item in sub_items:
                                filter_id = item.get("filterId", "")
                                # Skip special filters - only check hierarchy levels (l0_ids, l1_ids, etc.)
                                if filter_id in SPECIAL_FILTER_IDS:
                                    continue
                                # Check if it matches product hierarchy pattern (l{N}_ids)
                                if filter_id.startswith("l") and filter_id.endswith("_ids"):
                                    if filter_id not in product_labels:
                                        screen_issues["issues"].append({
                                            "type": "extra_level",
                                            "filter": "product",
                                            "level": filter_id,
                                            "message": f"Product level {filter_id} exists in config but not in hierarchy table"
                                        })
            
            # Check for missing product levels (respecting hierarchy restrictions)
            if "product_filter" in hierarchies:
                pf = hierarchies["product_filter"]
                config_product_ids = set()
                for sub_key in ["hierarchies", "product_group"]:
                    if sub_key in pf and isinstance(pf[sub_key], list):
                        for item in pf[sub_key]:
                            fid = item.get("filterId", "")
                            # Only count actual hierarchy levels, not special filters
                            if fid not in SPECIAL_FILTER_IDS and fid.startswith("l") and fid.endswith("_ids"):
                                config_product_ids.add(fid)
                
                for plabel in product_labels.keys():
                    if plabel not in config_product_ids and config_product_ids:
                        # Check if this level should be included based on hierarchy restriction
                        level_info = product_levels_full.get(plabel, {})
                        
                        # If screen has a restriction, only flag as missing if level passes the restriction
                        if hierarchy_restriction:
                            # e.g., is_zone_mapping_view_by or is_competitor_mapping_view_by
                            if not level_info.get(hierarchy_restriction, False):
                                # Level doesn't pass restriction, so it's correctly excluded - skip
                                continue
                        
                        screen_issues["issues"].append({
                            "type": "missing_level",
                            "filter": "product", 
                            "level": plabel,
                            "message": f"Product level {plabel} ({product_labels[plabel]}) missing from config"
                        })
            
            # Check store_filter hierarchies - only validate s{N}_ids pattern (not special filters)
            if "store_filter" in hierarchies:
                sf = hierarchies["store_filter"]
                for sub_key in ["hierarchies", "store_group"]:
                    if sub_key in sf and isinstance(sf[sub_key], list):
                        for item in sf[sub_key]:
                            filter_id = item.get("filterId", "")
                            # Skip special filters - only check hierarchy levels (s0_ids, s1_ids, etc.)
                            if filter_id in SPECIAL_FILTER_IDS:
                                continue
                            # Check if it matches store hierarchy pattern (s{N}_ids)
                            if filter_id.startswith("s") and filter_id.endswith("_ids"):
                                if filter_id not in store_labels:
                                    screen_issues["issues"].append({
                                        "type": "extra_level",
                                        "filter": "store",
                                        "level": filter_id,
                                        "message": f"Store level {filter_id} exists in config but not in hierarchy table"
                                    })
            
            # Check for missing store levels
            if "store_filter" in hierarchies:
                sf = hierarchies["store_filter"]
                config_store_ids = set()
                for sub_key in ["hierarchies", "store_group"]:
                    if sub_key in sf and isinstance(sf[sub_key], list):
                        for item in sf[sub_key]:
                            fid = item.get("filterId", "")
                            # Only count actual hierarchy levels, not special filters
                            if fid not in SPECIAL_FILTER_IDS and fid.startswith("s") and fid.endswith("_ids"):
                                config_store_ids.add(fid)
                
                for slabel in store_labels.keys():
                    if slabel not in config_store_ids and config_store_ids:
                        screen_issues["issues"].append({
                            "type": "missing_level",
                            "filter": "store",
                            "level": slabel,
                            "message": f"Store level {slabel} ({store_labels[slabel]}) missing from config"
                        })
            
            if screen_issues["issues"]:
                validation_issues.append(screen_issues)
        
        status = "valid" if not validation_issues else "mismatch"
        
        return {
            "success": True,
            "status": status,
            "message": "Validation complete" if status == "valid" else "Hierarchy mismatch detected",
            "configured_count": configured_count,
            "total_screens": len(SCREEN_DEFINITIONS),
            "needs_initialization": False,
            "validation_issues": validation_issues,
            "product_levels": list(product_labels.keys()),
            "store_levels": list(store_labels.keys())
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/screens/initialize-all")
def initialize_all_screens():
    """Generate and save default configurations for ALL screens"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        # Ensure table exists
        create_table_query = f"""
            CREATE TABLE IF NOT EXISTS {db.db_schema}.bp_screen_hierarchies (
                screen_id INTEGER PRIMARY KEY,
                screen_name VARCHAR(100),
                hierarchies JSONB
            )
        """
        db.execute_write(create_table_query)
        
        # Get hierarchy levels
        product_levels = db.execute_query(
            f"SELECT * FROM {db.db_schema}.bp_product_hierarchy_level ORDER BY product_hierarchy_level_id"
        )
        store_levels = db.execute_query(
            f"SELECT * FROM {db.db_schema}.bp_store_hierarchy_level ORDER BY store_hierarchy_level_id"
        )
        
        # Get segment config
        try:
            segment_result = db.execute_query(
                f"SELECT is_customer_segment_enabled FROM {db.db_schema}.bp_customer_segment_config LIMIT 1"
            )
            segment_enabled = segment_result[0]['is_customer_segment_enabled'] if segment_result else False
        except:
            segment_enabled = False
        
        created = 0
        errors = []
        
        for screen_id, definition in SCREEN_DEFINITIONS.items():
            try:
                hierarchies = _generate_screen_hierarchies(screen_id, definition, product_levels, store_levels, segment_enabled)
                screen_name = definition["screen_name"]
                
                # Upsert
                query = f"""
                    INSERT INTO {db.db_schema}.bp_screen_hierarchies (screen_id, screen_name, hierarchies)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (screen_id) DO UPDATE SET
                        screen_name = EXCLUDED.screen_name,
                        hierarchies = EXCLUDED.hierarchies
                """
                db.execute_write(query, (screen_id, screen_name, json.dumps(hierarchies)))
                created += 1
            except Exception as e:
                errors.append({"screen_id": screen_id, "error": str(e)})
        
        return {
            "success": True,
            "message": f"Initialized {created} screens",
            "created": created,
            "errors": errors if errors else None
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/screens/regenerate-all")
def regenerate_all_screens():
    """Regenerate configurations for ALL screens based on current hierarchy levels"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        # Get hierarchy levels
        product_levels = db.execute_query(
            f"SELECT * FROM {db.db_schema}.bp_product_hierarchy_level ORDER BY product_hierarchy_level_id"
        )
        store_levels = db.execute_query(
            f"SELECT * FROM {db.db_schema}.bp_store_hierarchy_level ORDER BY store_hierarchy_level_id"
        )
        
        # Get segment config
        try:
            segment_result = db.execute_query(
                f"SELECT is_customer_segment_enabled FROM {db.db_schema}.bp_customer_segment_config LIMIT 1"
            )
            segment_enabled = segment_result[0]['is_customer_segment_enabled'] if segment_result else False
        except:
            segment_enabled = False
        
        regenerated = 0
        errors = []
        
        for screen_id, definition in SCREEN_DEFINITIONS.items():
            try:
                hierarchies = _generate_screen_hierarchies(screen_id, definition, product_levels, store_levels, segment_enabled)
                screen_name = definition["screen_name"]
                
                # Upsert
                query = f"""
                    INSERT INTO {db.db_schema}.bp_screen_hierarchies (screen_id, screen_name, hierarchies)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (screen_id) DO UPDATE SET
                        screen_name = EXCLUDED.screen_name,
                        hierarchies = EXCLUDED.hierarchies
                """
                db.execute_write(query, (screen_id, screen_name, json.dumps(hierarchies)))
                regenerated += 1
            except Exception as e:
                errors.append({"screen_id": screen_id, "error": str(e)})
        
        return {
            "success": True,
            "message": f"Regenerated {regenerated} screens",
            "regenerated": regenerated,
            "errors": errors if errors else None
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/screens/{screen_id}/regenerate")
def regenerate_screen(screen_id: int):
    """Regenerate configuration for a single screen based on current hierarchy levels"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    if screen_id not in SCREEN_DEFINITIONS:
        raise HTTPException(status_code=404, detail=f"Screen {screen_id} not found")
    
    try:
        # Get hierarchy levels
        product_levels = db.execute_query(
            f"SELECT * FROM {db.db_schema}.bp_product_hierarchy_level ORDER BY product_hierarchy_level_id"
        )
        store_levels = db.execute_query(
            f"SELECT * FROM {db.db_schema}.bp_store_hierarchy_level ORDER BY store_hierarchy_level_id"
        )
        
        # Get segment config
        try:
            segment_result = db.execute_query(
                f"SELECT is_customer_segment_enabled FROM {db.db_schema}.bp_customer_segment_config LIMIT 1"
            )
            segment_enabled = segment_result[0]['is_customer_segment_enabled'] if segment_result else False
        except:
            segment_enabled = False
        
        definition = SCREEN_DEFINITIONS[screen_id]
        hierarchies = _generate_screen_hierarchies(screen_id, definition, product_levels, store_levels, segment_enabled)
        screen_name = definition["screen_name"]
        
        # Upsert
        query = f"""
            INSERT INTO {db.db_schema}.bp_screen_hierarchies (screen_id, screen_name, hierarchies)
            VALUES (%s, %s, %s)
            ON CONFLICT (screen_id) DO UPDATE SET
                screen_name = EXCLUDED.screen_name,
                hierarchies = EXCLUDED.hierarchies
        """
        db.execute_write(query, (screen_id, screen_name, json.dumps(hierarchies)))
        
        return {
            "success": True,
            "message": f"Regenerated screen {screen_name}",
            "screen_id": screen_id,
            "screen_name": screen_name,
            "hierarchies": hierarchies
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Static routes must come BEFORE parameterized routes
@app.post("/api/screens/preview-all")
def preview_all_screens_regeneration():
    """Preview regenerated configurations for ALL screens without saving"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    try:
        # Get hierarchy levels
        product_levels = db.execute_query(
            f"SELECT * FROM {db.db_schema}.bp_product_hierarchy_level ORDER BY product_hierarchy_level_id"
        )
        store_levels = db.execute_query(
            f"SELECT * FROM {db.db_schema}.bp_store_hierarchy_level ORDER BY store_hierarchy_level_id"
        )
        
        # Get segment config
        try:
            segment_result = db.execute_query(
                f"SELECT is_customer_segment_enabled FROM {db.db_schema}.bp_customer_segment_config LIMIT 1"
            )
            segment_enabled = segment_result[0]['is_customer_segment_enabled'] if segment_result else False
        except:
            segment_enabled = False
        
        previews = []
        for screen_id, definition in SCREEN_DEFINITIONS.items():
            try:
                hierarchies = _generate_screen_hierarchies(screen_id, definition, product_levels, store_levels, segment_enabled)
                previews.append({
                    "screen_id": screen_id,
                    "screen_name": definition["screen_name"],
                    "hierarchies": hierarchies
                })
            except Exception as e:
                previews.append({
                    "screen_id": screen_id,
                    "screen_name": definition["screen_name"],
                    "error": str(e)
                })
        
        return {
            "success": True,
            "message": "Preview for all screens - not saved yet",
            "screens": previews,
            "total": len(previews),
            "is_preview": True
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Parameterized route - comes after static routes
@app.post("/api/screens/{screen_id}/preview")
def preview_screen_regeneration(screen_id: int):
    """Preview regenerated configuration without saving - user can review before committing"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    if screen_id not in SCREEN_DEFINITIONS:
        raise HTTPException(status_code=404, detail=f"Screen {screen_id} not found")
    
    try:
        # Get hierarchy levels
        product_levels = db.execute_query(
            f"SELECT * FROM {db.db_schema}.bp_product_hierarchy_level ORDER BY product_hierarchy_level_id"
        )
        store_levels = db.execute_query(
            f"SELECT * FROM {db.db_schema}.bp_store_hierarchy_level ORDER BY store_hierarchy_level_id"
        )
        
        # Get segment config
        try:
            segment_result = db.execute_query(
                f"SELECT is_customer_segment_enabled FROM {db.db_schema}.bp_customer_segment_config LIMIT 1"
            )
            segment_enabled = segment_result[0]['is_customer_segment_enabled'] if segment_result else False
        except:
            segment_enabled = False
        
        definition = SCREEN_DEFINITIONS[screen_id]
        hierarchies = _generate_screen_hierarchies(screen_id, definition, product_levels, store_levels, segment_enabled)
        screen_name = definition["screen_name"]
        
        # DO NOT SAVE - just return preview
        return {
            "success": True,
            "message": f"Preview for {screen_name} - not saved yet",
            "screen_id": screen_id,
            "screen_name": screen_name,
            "hierarchies": hierarchies,
            "is_preview": True
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============== ALLOWANCE ENDPOINTS (static - must come before parameterized routes) ==============

@app.get("/api/screens/allowances")
def get_screen_allowances():
    """Get all screen filter allowances (what's allowed per screen)"""
    try:
        allowances = []
        for screen_id, definition in SCREEN_DEFINITIONS.items():
            allowances.append({
                "screen_id": screen_id,
                "screen_name": definition["screen_name"],
                "description": definition.get("description", ""),
                "allowed_filters": definition.get("allowed_filters", {}),
                "segment_filter_allowed": definition.get("segment_filter_allowed", False),
                "product_attr_allowed": definition.get("product_attr_allowed", False),
                "rule_filter_allowed": definition.get("rule_filter_allowed", False),
                "strategy_filter_allowed": definition.get("strategy_filter_allowed", False),
                "hierarchy_restriction": definition.get("hierarchy_restriction"),
                "cross_zone": definition.get("cross_zone", False),
                "segment_filter_required": definition.get("segment_filter_required", False)
            })
        return {"success": True, "data": allowances}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Parameterized routes come AFTER static routes
@app.get("/api/screens/{screen_id}")
def get_screen(screen_id: int):
    """Get single screen with hierarchies"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    if screen_id not in SCREEN_DEFINITIONS:
        raise HTTPException(status_code=404, detail=f"Screen {screen_id} not found")
    
    try:
        definition = SCREEN_DEFINITIONS[screen_id]
        
        # Get from DB
        query = f"SELECT * FROM {db.db_schema}.bp_screen_hierarchies WHERE screen_id = %s"
        results = db.execute_query(query, (screen_id,))
        
        screen = {
            "screen_id": screen_id,
            "screen_name": definition["screen_name"],
            "description": definition.get("description", ""),
            "allowed_filters": definition.get("allowed_filters", {}),
            "segment_filter_allowed": definition.get("segment_filter_allowed", False),
            "product_attr_allowed": definition.get("product_attr_allowed", False),
            "rule_filter_allowed": definition.get("rule_filter_allowed", False),
            "strategy_filter_allowed": definition.get("strategy_filter_allowed", False),
            "hierarchy_restriction": definition.get("hierarchy_restriction"),
        }
        
        if results:
            hierarchies = results[0].get('hierarchies')
            if isinstance(hierarchies, str):
                hierarchies = json.loads(hierarchies)
            screen["hierarchies"] = hierarchies
        else:
            screen["hierarchies"] = None
        
        return {"success": True, "data": screen}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/screens/{screen_id}/generate")
def generate_screen_default(screen_id: int):
    """Generate default hierarchies for a screen based on hierarchy levels"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    if screen_id not in SCREEN_DEFINITIONS:
        raise HTTPException(status_code=404, detail=f"Screen {screen_id} not found")
    
    try:
        # Get product hierarchy levels
        product_levels = db.execute_query(
            f"SELECT * FROM {db.db_schema}.bp_product_hierarchy_level ORDER BY product_hierarchy_level_id"
        )
        
        # Get store hierarchy levels  
        store_levels = db.execute_query(
            f"SELECT * FROM {db.db_schema}.bp_store_hierarchy_level ORDER BY store_hierarchy_level_id"
        )
        
        # Get customer segment config
        try:
            segment_result = db.execute_query(
                f"SELECT is_customer_segment_enabled FROM {db.db_schema}.bp_customer_segment_config LIMIT 1"
            )
            segment_enabled = segment_result[0]['is_customer_segment_enabled'] if segment_result else False
        except:
            segment_enabled = False
        
        definition = SCREEN_DEFINITIONS[screen_id]
        hierarchies = _generate_screen_hierarchies(screen_id, definition, product_levels, store_levels, segment_enabled)
        
        return {"success": True, "data": hierarchies}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/screens/{screen_id}/save")
def save_screen_hierarchies(screen_id: int, data: dict):
    """Save screen hierarchies to database"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected to database")
    
    if screen_id not in SCREEN_DEFINITIONS:
        raise HTTPException(status_code=404, detail=f"Screen {screen_id} not found")
    
    try:
        hierarchies = data.get("hierarchies", {})
        screen_name = SCREEN_DEFINITIONS[screen_id]["screen_name"]
        
        # Check if exists
        check_query = f"SELECT COUNT(*) as count FROM {db.db_schema}.bp_screen_hierarchies WHERE screen_id = %s"
        result = db.execute_query(check_query, (screen_id,))
        
        if result and result[0]['count'] > 0:
            # Update
            query = f"""
                UPDATE {db.db_schema}.bp_screen_hierarchies 
                SET hierarchies = %s, screen_name = %s
                WHERE screen_id = %s
            """
            db.execute_write(query, (json.dumps(hierarchies), screen_name, screen_id))
        else:
            # Insert
            query = f"""
                INSERT INTO {db.db_schema}.bp_screen_hierarchies (screen_id, screen_name, hierarchies)
                VALUES (%s, %s, %s)
            """
            db.execute_write(query, (screen_id, screen_name, json.dumps(hierarchies)))
        
        return {"success": True, "message": f"Screen {screen_name} saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def _generate_screen_hierarchies(screen_id, definition, product_levels, store_levels, segment_enabled):
    """Internal helper to generate screen hierarchies"""
    hierarchies = {}
    allowed = definition.get("allowed_filters", {})
    restriction = definition.get("hierarchy_restriction")
    
    # Simplified rules:
    # - isMulti: always true for all
    # - limit: only for product_attribute (10) and zone_structure (10)
    # - isMandatory: first 2 levels + segment + product_group_ids (in PG section) + store_group_ids (in SG section)
    
    # Generate product_filter
    if "product_filter" in allowed:
        pf_config = allowed["product_filter"]
        product_filter = {}
        
        if pf_config.get("hierarchies"):
            product_filter["hierarchies"] = generate_product_hierarchy_filter(
                product_levels, restriction
            )
            
            # Add product_group_ids to hierarchies if specified (optional when in hierarchies, not product_group section)
            if pf_config.get("product_group_ids"):
                pg_template = PRODUCT_GROUP_IDS_TEMPLATE.copy()
                pg_template["isMandatory"] = False  # Not mandatory when in hierarchies section
                pg_template["filterLabel"] = "Product group"
                product_filter["hierarchies"].append(pg_template)
            
            if pf_config.get("product_attr") and definition.get("product_attr_allowed"):
                product_filter["hierarchies"].append(PRODUCT_ATTRIBUTE_TEMPLATE.copy())
        
        if pf_config.get("product_group"):
            product_filter["product_group"] = generate_product_hierarchy_filter(
                product_levels, restriction
            )
            
            if pf_config.get("product_attr") and definition.get("product_attr_allowed"):
                product_filter["product_group"].append(PRODUCT_ATTRIBUTE_TEMPLATE.copy())
            
            # product_group_ids is MANDATORY when in product_group section
            product_filter["product_group"].append(PRODUCT_GROUP_IDS_TEMPLATE.copy())
        
        if pf_config.get("specific"):
            product_filter["specific"] = {
                "hierarchies": generate_product_hierarchy_filter(product_levels, restriction)
            }
        
        hierarchies["product_filter"] = product_filter
    
    # Generate store_filter
    if "store_filter" in allowed:
        sf_config = allowed["store_filter"]
        store_filter = {}
        
        # Get max level if specified (for cross-zone screens)
        store_max_level = definition.get("store_hierarchy_max_level")
        
        if sf_config.get("hierarchies"):
            store_filter["hierarchies"] = generate_store_hierarchy_filter(
                store_levels, None, store_max_level
            )
            
            # Add store_group_ids to hierarchies if specified (optional when in hierarchies, not store_group section)
            if sf_config.get("store_group_ids"):
                sg_template = STORE_GROUP_IDS_TEMPLATE.copy()
                sg_template["isMandatory"] = False  # Not mandatory when in hierarchies section
                sg_template["filterLabel"] = "Store group"
                store_filter["hierarchies"].append(sg_template)
            
            if sf_config.get("zone_structure"):
                store_filter["hierarchies"].append(ZONE_STRUCTURE_TEMPLATE.copy())
        
        if sf_config.get("store_group"):
            store_filter["store_group"] = generate_store_hierarchy_filter(
                store_levels, None, store_max_level
            )
            
            if sf_config.get("zone_structure"):
                store_filter["store_group"].append(ZONE_STRUCTURE_TEMPLATE.copy())
            
            # store_group_ids is MANDATORY when in store_group section
            store_filter["store_group"].append(STORE_GROUP_IDS_TEMPLATE.copy())
        
        hierarchies["store_filter"] = store_filter
    
    # Add segment filter if allowed and enabled (or required) - segment is always mandatory
    if definition.get("segment_filter_required"):
        hierarchies["segment_filter"] = {"hierarchies": [SEGMENT_FILTER_TEMPLATE.copy()]}
    elif definition.get("segment_filter_allowed") and segment_enabled:
        hierarchies["segment_filter"] = {"hierarchies": [SEGMENT_FILTER_TEMPLATE.copy()]}
    
    # Add rule filter if allowed
    if definition.get("rule_filter_allowed"):
        hierarchies["rule_filter"] = RULE_FILTER_TEMPLATE.copy()
    
    # Add strategy filter if allowed
    if definition.get("strategy_filter_allowed"):
        if definition.get("strategy_filter_simple"):
            # Simple strategy filter without validation/date constraints
            hierarchies["strategy_filter"] = {
                "strategy_status": [
                    {
                        "filterId": "date_range",
                        "colValue": "date_range",
                        "filterLabel": "Date Range",
                        "filterType": "dateRange",
                        "isMandatory": False
                    },
                    {
                        "isMulti": True,
                        "colValue": "strategy_status",
                        "filterId": "strategy_status",
                        "selection": "All",
                        "filterType": "dropdown",
                        "apiEndpoint": "strategies/fetch-status",
                        "filterLabel": "Approval Status",
                        "isMandatory": False,
                        "selectOnLoad": False
                    }
                ]
            }
        else:
            hierarchies["strategy_filter"] = STRATEGY_FILTER_TEMPLATE.copy()
    
    return hierarchies

@app.put("/api/screens/allowances/{screen_id}")
def update_screen_allowance(screen_id: int, request: dict):
    """Update screen filter allowances (in-memory only for now)
    
    Note: This updates the SCREEN_DEFINITIONS dict in memory.
    To persist, these would need to be stored in DB.
    """
    try:
        if screen_id not in SCREEN_DEFINITIONS:
            raise HTTPException(status_code=404, detail=f"Screen {screen_id} not found")
        
        definition = SCREEN_DEFINITIONS[screen_id]
        
        # Update allowed filters
        if "allowed_filters" in request:
            definition["allowed_filters"] = request["allowed_filters"]
        if "segment_filter_allowed" in request:
            definition["segment_filter_allowed"] = request["segment_filter_allowed"]
        if "product_attr_allowed" in request:
            definition["product_attr_allowed"] = request["product_attr_allowed"]
        if "rule_filter_allowed" in request:
            definition["rule_filter_allowed"] = request["rule_filter_allowed"]
        if "strategy_filter_allowed" in request:
            definition["strategy_filter_allowed"] = request["strategy_filter_allowed"]
        
        return {
            "success": True, 
            "message": f"Screen {screen_id} allowances updated",
            "data": {
                "screen_id": screen_id,
                "screen_name": definition["screen_name"],
                "allowed_filters": definition.get("allowed_filters", {}),
                "segment_filter_allowed": definition.get("segment_filter_allowed", False),
                "rule_filter_allowed": definition.get("rule_filter_allowed", False),
                "strategy_filter_allowed": definition.get("strategy_filter_allowed", False)
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============== FORECAST VALIDATION ENDPOINTS ==============

from app.core.db_config import get_available_clients, get_available_environments, APPLICATIONS, ENVIRONMENTS

@app.get("/api/validator/applications")
def get_validator_applications():
    """Get available applications for data validator"""
    return {
        "success": True,
        "applications": [
            {"key": key, "display_name": val["display_name"]}
            for key, val in APPLICATIONS.items()
        ]
    }

@app.get("/api/validator/clients/{application}")
def get_validator_clients(application: str):
    """Get available clients for an application"""
    clients = get_available_clients(application)
    return {"success": True, "clients": clients}

@app.get("/api/validator/environments/{client}")
def get_validator_environments(client: str):
    """Get available environments for a client"""
    envs = get_available_environments(client)
    return {"success": True, "environments": envs}

@app.get("/api/validator/status")
def get_validator_status():
    """Get validator connection status (uses shared db connection)"""
    return db.get_connection_status()

@app.get("/api/validation/config")
def get_validation_config():
    """Get dynamic configuration (hierarchy, KVI, price_lock columns)"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    
    try:
        db.clear_config_cache()
        config = reco_metrics_validator.get_config()
        return {"success": True, "config": config}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/validation/strategies")
def get_validation_strategies():
    """Get list of strategies available for validation"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    
    try:
        strategies = reco_metrics_validator.get_strategies()
        return {"success": True, "strategies": strategies}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/validation/query/{strategy_id}")
def get_validation_query(strategy_id: int):
    """Get the generated validation SQL query for a strategy"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    
    try:
        query = reco_metrics_validator.get_query(strategy_id)
        return {"success": True, "strategy_id": strategy_id, "query": query}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/validation/run/{strategy_id}")
def run_validation(strategy_id: int, limit: Optional[int] = None):
    """Run forecast validation for a strategy"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")

    try:
        result = reco_metrics_validator.validate(strategy_id, limit)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============== BP_MONTHLY_FORECAST VALIDATOR ENDPOINTS ==============

@app.get("/api/validation/monthly-forecast/query/{strategy_id}")
def get_monthly_forecast_query(strategy_id: int):
    """Get the generated SQL for bp_monthly_forecast validation (for manual inspection)."""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    try:
        query = bp_monthly_forecast_validator.get_query(strategy_id)
        return {"success": True, "strategy_id": strategy_id, "query": query}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/validation/monthly-forecast/run/{strategy_id}")
def run_monthly_forecast_validation(strategy_id: int, limit: Optional[int] = None):
    """Run bp_monthly_forecast validation: recomputes via elasticity formula and
    returns one row per (bin, forecast-month) with 5-state match per metric."""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    try:
        result = bp_monthly_forecast_validator.validate(strategy_id, limit)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============== BP_MONTHLY_FORECAST_ACTUALS VALIDATOR ENDPOINTS ==============

@app.get("/api/validation/monthly-actuals/query/{strategy_id}")
def get_monthly_actuals_query(strategy_id: int):
    """Get the generated SQL for bp_monthly_forecast_actuals validation."""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    try:
        query = bp_monthly_forecast_actuals_validator.get_validation_query(strategy_id)
        return {"success": True, "strategy_id": strategy_id, "query": query}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/validation/monthly-actuals/run/{strategy_id}")
def run_monthly_actuals_validation(strategy_id: int, limit: Optional[int] = None):
    """Run bp_monthly_forecast_actuals validation: recomputes actuals from
    transaction tables (FULL_MONTH or PARTIAL) and returns one row per
    (bin, fiscal-month) with 5-state match per metric."""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    try:
        result = bp_monthly_forecast_actuals_validator.validate_monthly_actuals(strategy_id, limit)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/validation/summary-cards/channels/{strategy_id}")
def get_summary_cards_channels(strategy_id: int):
    """Get distinct channels available for a strategy from reco tables"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    
    try:
        channels = summary_cards_validator.get_channels(strategy_id)
        return {
            "success": True,
            "channels": channels
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/validation/summary-cards/query/{strategy_id}")
def get_summary_cards_query(strategy_id: int, channel_ids: Optional[str] = None):
    """Get the generated SQL query for summary cards validation (for manual verification)"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    
    try:
        channel_list = None
        if channel_ids:
            channel_list = [int(c.strip()) for c in channel_ids.split(',') if c.strip()]
        
        query = summary_cards_validator.get_query(strategy_id, channel_list)
        return {
            "success": True,
            "strategy_id": strategy_id,
            "channel_ids": channel_list,
            "query": query
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/validation/summary-cards/{strategy_id}")
def validate_summary_cards(strategy_id: int, channel_ids: Optional[str] = None):
    """Validate summary cards data for a strategy with optional channel filter
    
    Args:
        strategy_id: The strategy ID to validate
        channel_ids: Comma-separated list of channel IDs to filter (e.g., "1,2,3"). If not provided, all channels are included.
    """
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    
    try:
        channel_list = None
        if channel_ids:
            channel_list = [int(c.strip()) for c in channel_ids.split(',') if c.strip()]
        
        result = summary_cards_validator.validate(strategy_id, channel_list)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============== MONTHLY SUMMARY CARDS ENDPOINTS ==============
# Mirrors /api/validation/summary-cards/* but covers forecast types pulled from
# bp_monthly_forecast + bp_monthly_forecast_actuals (FY, FY_Qx, CALENDAR_YEAR,
# TWELVE_MONTHS). The strategy-period endpoints above stay unchanged.

@app.get("/api/validation/monthly-summary-cards/channels/{strategy_id}")
def get_monthly_summary_cards_channels(strategy_id: int):
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    try:
        channels = monthly_summary_cards_validator.get_channels(strategy_id)
        return {"success": True, "channels": channels}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/validation/monthly-summary-cards/query/{strategy_id}")
def get_monthly_summary_cards_query(strategy_id: int, channel_ids: Optional[str] = None):
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    try:
        channel_list = None
        if channel_ids:
            channel_list = [int(c.strip()) for c in channel_ids.split(',') if c.strip()]
        query = monthly_summary_cards_validator.get_query(strategy_id, channel_list)
        return {
            "success": True,
            "strategy_id": strategy_id,
            "channel_ids": channel_list,
            "query": query,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/validation/monthly-summary-cards/{strategy_id}")
def validate_monthly_summary_cards(strategy_id: int, channel_ids: Optional[str] = None):
    """Validate non-strategy-period summary cards (Fiscal Year, quarters, 12-month) for a strategy.

    Channel filter is comma-separated (e.g. "1,2"); omit for all channels.
    """
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    try:
        channel_list = None
        if channel_ids:
            channel_list = [int(c.strip()) for c in channel_ids.split(',') if c.strip()]
        return monthly_summary_cards_validator.validate(strategy_id, channel_list)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============== MONTHLY DETAILED VIEW ENDPOINT ==============
# Companion to /api/validation/monthly-summary-cards — same forecast-type set and
# visibility floor, but grouped at (group_label, channel, segment, price_zone) instead
# of strategy-wide. Two views supported via the view_by query param:
#   view_by=product     -> group_label = product_code
#   view_by=line_group  -> group_label = COALESCE(line_group, product_code)

@app.get("/api/validation/monthly-detailed-view/query/{strategy_id}")
def get_monthly_detailed_view_query(
    strategy_id: int,
    view_by: str = "product",
    channel_ids: Optional[str] = None,
):
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    try:
        channel_list = None
        if channel_ids:
            channel_list = [int(c.strip()) for c in channel_ids.split(',') if c.strip()]
        query = monthly_detailed_view_validator.get_query(strategy_id, view_by, channel_list)
        return {
            "success": True,
            "strategy_id": strategy_id,
            "view_by": view_by,
            "channel_ids": channel_list,
            "query": query,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/validation/monthly-detailed-view/{strategy_id}")
def run_monthly_detailed_view(
    strategy_id: int,
    view_by: str = "product",
    channel_ids: Optional[str] = None,
):
    """Run the Detailed View query for a strategy.

    view_by: 'product' (default) groups by product_code; 'line_group' groups by
    COALESCE(line_group, product_code). Same forecast-type set as the Summary tab.
    """
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    try:
        channel_list = None
        if channel_ids:
            channel_list = [int(c.strip()) for c in channel_ids.split(',') if c.strip()]
        return monthly_detailed_view_validator.validate(strategy_id, view_by, channel_list)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============== RECO GRID DATA VALIDATION ENDPOINT ==============
# Compares our reco rollup vs the tool's pre-aggregated grid tables
# (bp_strategy_price_reco_grid_data_{product,line_group}_pricezone) row-by-row,
# emitting MATCH / MISMATCH / MISSING_* per metric per scenario.

@app.get("/api/validation/reco-grid-data/query/{strategy_id}")
def get_reco_grid_data_query(
    strategy_id: int,
    view_by: str = "product",
    channel_ids: Optional[str] = None,
):
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    try:
        channel_list = None
        if channel_ids:
            channel_list = [int(c.strip()) for c in channel_ids.split(',') if c.strip()]
        query = reco_grid_data_validator.get_query(strategy_id, view_by, channel_list)
        return {
            "success": True,
            "strategy_id": strategy_id,
            "view_by": view_by,
            "channel_ids": channel_list,
            "query": query,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/validation/reco-grid-data/{strategy_id}")
def run_reco_grid_data(
    strategy_id: int,
    view_by: str = "product",
    channel_ids: Optional[str] = None,
):
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    try:
        channel_list = None
        if channel_ids:
            channel_list = [int(c.strip()) for c in channel_ids.split(',') if c.strip()]
        return reco_grid_data_validator.validate(strategy_id, view_by, channel_list)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============== RULES VALIDATION ENDPOINTS ==============

@app.get("/api/rules/validate-defaults")
def validate_default_rules():
    """Validate default rules (1, 2, 3) have all usable products, active stores, and active segments mapped"""
    if not db.is_connected():
        raise HTTPException(status_code=400, detail="Not connected. Please connect to a database first.")
    
    schema = db.db_schema
    
    try:
        # Get master counts
        master_counts_query = f"""
            SELECT 
                (SELECT COUNT(*) FROM {schema}.bp_product_master WHERE usable = true) AS total_products,
                (SELECT COUNT(*) FROM {schema}.bp_store_master WHERE active = true) AS total_stores,
                (SELECT COUNT(*) FROM {schema}.bp_customer_segment_master WHERE is_active = true) AS total_segments
        """
        master_result = db.execute_query(master_counts_query)
        master_counts = master_result[0] if master_result else {'total_products': 0, 'total_stores': 0, 'total_segments': 0}
        
        # Rule definitions
        rules = [
            {'rule_id': 1, 'name': 'Line Price Rule', 'description': 'Enforces same price for similar products or different variations of the same product.'},
            {'rule_id': 2, 'name': 'Price Zone Rule', 'description': 'Enforces the same price across stores within a price zone and the same channel.'},
            {'rule_id': 3, 'name': 'Pre Price Rule', 'description': 'Ensures prices of selected products does not change from current price.'}
        ]
        
        results = []
        for rule in rules:
            rule_id = rule['rule_id']
            
            # Get counts for this rule
            rule_counts_query = f"""
                SELECT 
                    (SELECT COUNT(*) FROM {schema}.bp_rule_products_mapping WHERE rule_id = {rule_id}) AS mapped_products,
                    (SELECT COUNT(*) FROM {schema}.bp_rule_stores_mapping WHERE rule_id = {rule_id}) AS mapped_stores,
                    (SELECT COUNT(*) FROM {schema}.bp_rule_segments_mapping WHERE rule_id = {rule_id}) AS mapped_segments
            """
            rule_result = db.execute_query(rule_counts_query)
            rule_counts = rule_result[0] if rule_result else {'mapped_products': 0, 'mapped_stores': 0, 'mapped_segments': 0}
            
            products_match = rule_counts['mapped_products'] == master_counts['total_products']
            stores_match = rule_counts['mapped_stores'] == master_counts['total_stores']
            segments_match = rule_counts['mapped_segments'] == master_counts['total_segments']
            
            results.append({
                'rule_id': rule_id,
                'name': rule['name'],
                'description': rule['description'],
                'products': {
                    'mapped': rule_counts['mapped_products'],
                    'expected': master_counts['total_products'],
                    'match': products_match
                },
                'stores': {
                    'mapped': rule_counts['mapped_stores'],
                    'expected': master_counts['total_stores'],
                    'match': stores_match
                },
                'segments': {
                    'mapped': rule_counts['mapped_segments'],
                    'expected': master_counts['total_segments'],
                    'match': segments_match
                },
                'all_match': products_match and stores_match and segments_match
            })
        
        all_rules_valid = all(r['all_match'] for r in results)
        
        return {
            'success': True,
            'master_counts': {
                'products': master_counts['total_products'],
                'stores': master_counts['total_stores'],
                'segments': master_counts['total_segments']
            },
            'rules': results,
            'all_valid': all_rules_valid
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============== UTILITY ENDPOINTS ==============

@app.get("/api/health")
def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "connected": db.is_connected()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
