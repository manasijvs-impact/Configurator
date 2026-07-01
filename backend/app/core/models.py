from pydantic import BaseModel
from typing import Optional, List

class ConnectionRequest(BaseModel):
    client_name: str
    environment: str  # dev, test, uat, prod
    host: str
    port: int = 5432
    database: str
    username: str
    password: str
    db_schema: str = 'base_pricing'  # 'base_pricing' or 'base_pricing_restaurant'

class TestConnectionRequest(BaseModel):
    host: str
    port: int = 5432
    database: str
    username: str
    password: str
    expected_schema: str  # 'base_pricing' or 'base_pricing_restaurant'
    instance_name: str  # e.g., 'leslies_dev', 'cb_uat'

class ProductHierarchyLevel(BaseModel):
    product_hierarchy_level_id: int
    product_hierarchy_level_value: str  # Display name e.g., "Sub Department"
    product_hierarchy_level_label: Optional[str] = None  # DB column e.g., "sub_department"
    is_cascading: bool = True
    report_hierarchy_dropdown: bool = False
    is_competitor_mapping_view_by: bool = False
    is_strategy_step4_view_by: bool = False
    is_zone_mapping_view_by: bool = False

class StoreHierarchyLevel(BaseModel):
    store_hierarchy_level_id: int
    store_hierarchy_level_value: str  # Display name e.g., "Region"
    store_hierarchy_level_label: Optional[str] = None  # DB column e.g., "region"
    is_cascading: bool = True
    report_hierarchy_dropdown: bool = False

class ProductHierarchyBulkRequest(BaseModel):
    levels: List[ProductHierarchyLevel]

class StoreHierarchyBulkRequest(BaseModel):
    levels: List[StoreHierarchyLevel]

class HierarchyCountRequest(BaseModel):
    count: int

class CustomerSegmentConfig(BaseModel):
    is_customer_segment_enabled: bool = False
