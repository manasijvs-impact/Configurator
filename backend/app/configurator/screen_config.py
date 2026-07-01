# Screen Configuration Definitions
# Defines what filter types and options are allowed per screen
# 
# Simplified Rules:
# - isMulti: always True for all filters
# - limit: only for product_attribute (10) and zone_structure (10)
# - isMandatory: first 2 hierarchy levels (L0,L1 / S0,S1) + segment + 
#                product_group_ids (in product_group section) + store_group_ids (in store_group section)

SCREEN_DEFINITIONS = {
    0: {
        "screen_name": "STORE_CONFIGURATION",
        "description": "Store group landing page filter",
        "allowed_filters": {
            "store_filter": {
                "hierarchies": True,
                "store_group": False,
                "zone_structure": True
            }
        },
        "segment_filter_allowed": False,
        "product_attr_allowed": False,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False
    },
    1: {
        "screen_name": "PRODUCT_CONFIGURATION",
        "description": "Product group landing page filter",
        "allowed_filters": {
            "product_filter": {
                "hierarchies": True,
                "product_group": False,
                "product_attr": True
            }
        },
        "segment_filter_allowed": False,
        "product_attr_allowed": True,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False
    },
    2: {
        "screen_name": "ZONE_MAPPING",
        "description": "Zone mapping landing page filter",
        "allowed_filters": {
            "product_filter": {
                "hierarchies": True,
                "product_group": False,
                "product_attr": False
            }
        },
        "segment_filter_allowed": True,
        "product_attr_allowed": False,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False,
        "hierarchy_restriction": "is_zone_mapping_view_by"
    },
    3: {
        "screen_name": "PRODUCT_DETAILS",
        "description": "Product details landing page filter",
        "allowed_filters": {
            "product_filter": {
                "hierarchies": True,
                "product_group": True,
                "product_attr": True
            }
        },
        "segment_filter_allowed": False,
        "product_attr_allowed": True,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False
    },
    4: {
        "screen_name": "STORE_DETAILS",
        "description": "Store details landing page filter",
        "allowed_filters": {
            "store_filter": {
                "hierarchies": True,
                "store_group": True,
                "zone_structure": True
            }
        },
        "segment_filter_allowed": False,
        "product_attr_allowed": False,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False
    },
    5: {
        "screen_name": "PRODUCT_STORE_DETAILS_MANUAL",
        "description": "Product-store manual mapping screen",
        "allowed_filters": {
            "product_filter": {
                "hierarchies": True,
                "product_group": True,
                "product_attr": True
            },
            "store_filter": {
                "hierarchies": True,
                "store_group": True,
                "zone_structure": True
            }
        },
        "segment_filter_allowed": True,
        "product_attr_allowed": True,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False
    },
    6: {
        "screen_name": "RULE_LISTING",
        "description": "Rule listing page filter",
        "allowed_filters": {
            "product_filter": {
                "hierarchies": True,
                "product_group": False,
                "product_attr": False,
                "product_group_ids": True
            },
            "store_filter": {
                "hierarchies": True,
                "store_group": False,
                "zone_structure": False,
                "store_group_ids": True
            }
        },
        "segment_filter_allowed": True,
        "product_attr_allowed": False,
        "rule_filter_allowed": True,
        "strategy_filter_allowed": False
    },
    7: {
        "screen_name": "RULES_PRODUCT_SCREEN",
        "description": "Rule creation (product) filter",
        "allowed_filters": {
            "product_filter": {
                "hierarchies": True,
                "product_group": True,
                "specific": True,
                "product_attr": False
            }
        },
        "segment_filter_allowed": False,
        "product_attr_allowed": False,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False
    },
    8: {
        "screen_name": "RULES_STORE_SCREEN",
        "description": "Rule creation (store) filter",
        "allowed_filters": {
            "store_filter": {
                "hierarchies": True,
                "store_group": True,
                "zone_structure": False
            }
        },
        "segment_filter_allowed": False,
        "product_attr_allowed": False,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False
    },
    9: {
        "screen_name": "STRATEGY_PRODUCT_SCREEN",
        "description": "Strategy creation (product) filter",
        "allowed_filters": {
            "product_filter": {
                "hierarchies": True,
                "product_group": True,
                "specific": True,
                "product_attr": False
            }
        },
        "segment_filter_allowed": False,
        "product_attr_allowed": False,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False
    },
    10: {
        "screen_name": "STRATEGY_STORE_SCREEN",
        "description": "Strategy creation (store) filter",
        "allowed_filters": {
            "store_filter": {
                "hierarchies": True,
                "store_group": True,
                "zone_structure": False
            }
        },
        "segment_filter_allowed": False,
        "product_attr_allowed": False,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False
    },
    11: {
        "screen_name": "WORKBENCH",
        "description": "Workbench strategy filter",
        "allowed_filters": {
            "product_filter": {
                "hierarchies": True,
                "product_group": False,
                "product_attr": False,
                "product_group_ids": True
            },
            "store_filter": {
                "hierarchies": True,
                "store_group": False,
                "zone_structure": False,
                "store_group_ids": True
            }
        },
        "segment_filter_allowed": True,
        "product_attr_allowed": False,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": True,
        "strategy_filter_simple": True
    },
    12: {
        "screen_name": "PRODUCT_GROUP_CONFIGURATION",
        "description": "Product group creation filter",
        "allowed_filters": {
            "product_filter": {
                "hierarchies": True,
                "product_group": False,
                "product_attr": True
            }
        },
        "segment_filter_allowed": False,
        "product_attr_allowed": True,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False
    },
    13: {
        "screen_name": "STORE_GROUP_CONFIGURATION",
        "description": "Store group creation filter",
        "allowed_filters": {
            "store_filter": {
                "hierarchies": True,
                "store_group": False,
                "zone_structure": True
            }
        },
        "segment_filter_allowed": False,
        "product_attr_allowed": False,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False
    },
    14: {
        "screen_name": "EXCEPTION_REPORT",
        "description": "Exception report filter",
        "allowed_filters": {
            "product_filter": {
                "hierarchies": True,
                "product_group": False,
                "product_attr": True
            },
            "store_filter": {
                "hierarchies": True,
                "store_group": False,
                "zone_structure": True
            }
        },
        "segment_filter_allowed": True,
        "product_attr_allowed": True,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": True
    },
    15: {
        "screen_name": "COMPETITOR_POSITIONING",
        "description": "Competitor positioning filter",
        "allowed_filters": {
            "product_filter": {
                "hierarchies": True,
                "product_group": False,
                "product_attr": True
            },
            "store_filter": {
                "hierarchies": True,
                "store_group": False,
                "zone_structure": True
            }
        },
        "segment_filter_allowed": True,
        "product_attr_allowed": True,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False
    },
    16: {
        "screen_name": "DECISION_DASHBOARD",
        "description": "Decision dashboard filter",
        "allowed_filters": {
            "product_filter": {
                "hierarchies": True,
                "product_group": False,
                "product_attr": False,
                "product_group_ids": True
            },
            "store_filter": {
                "hierarchies": True,
                "store_group": False,
                "zone_structure": False,
                "store_group_ids": True
            }
        },
        "segment_filter_allowed": True,
        "product_attr_allowed": False,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": True,
        "strategy_filter_simple": True
    },
    17: {
        "screen_name": "SEGMENT_SCREEN",
        "description": "Segment screen filter",
        "allowed_filters": {},
        "segment_filter_allowed": True,
        "segment_filter_required": True,
        "product_attr_allowed": False,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False
    },
    19: {
        "screen_name": "COMPETITOR_MAPPING",
        "description": "Competitor mapping filter",
        "allowed_filters": {
            "product_filter": {
                "hierarchies": True,
                "product_group": False,
                "product_attr": False,
                "product_group_ids": True
            }
        },
        "segment_filter_allowed": False,
        "product_attr_allowed": False,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False,
        "hierarchy_restriction": "is_competitor_mapping_view_by"
    },
    20: {
        "screen_name": "PRICE_CHANGE_DRIVERS",
        "description": "Price change drivers filter",
        "allowed_filters": {
            "product_filter": {
                "hierarchies": True,
                "product_group": False,
                "product_attr": True
            },
            "store_filter": {
                "hierarchies": True,
                "store_group": False,
                "zone_structure": True
            }
        },
        "segment_filter_allowed": True,
        "product_attr_allowed": True,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": True
    },
    21: {
        "screen_name": "RULES_STORE_SCREEN_CROSS_ZONE",
        "description": "Cross-zone rule creation (store) filter",
        "allowed_filters": {
            "store_filter": {
                "hierarchies": True,
                "store_group": False,
                "zone_structure": False
            }
        },
        "store_hierarchy_max_level": 0,  # Only include S0
        "segment_filter_allowed": False,
        "product_attr_allowed": False,
        "rule_filter_allowed": False,
        "strategy_filter_allowed": False,
        "cross_zone": True
    }
}

# Constant filter templates
PRODUCT_ATTRIBUTE_TEMPLATE = {
    "limit": 10,
    "isMulti": True,
    "colValue": "product_attribute_names",
    "filterId": "product_attribute_names",
    "selection": None,
    "filterType": "dropdown",
    "apiEndpoint": "product/attributes/filters",
    "filterLabel": "Product attribute",
    "isMandatory": False,
    "selectOnLoad": False,
    "children_template": {
        "isMulti": True,
        "selection": None,
        "filterType": "dropdown",
        "apiEndpoint": "product/attributes/filters",
        "isMandatory": False,
        "selectOnLoad": False
    },
    "isMultiAttributes": True
}

ZONE_STRUCTURE_TEMPLATE = {
    "isMulti": True,
    "colValue": "structure_name",
    "filterId": "structure_name",
    "selection": None,
    "filterType": "dropdown",
    "apiEndpoint": "store/attributes/filters",
    "filterLabel": "Zone Structure",
    "isMandatory": False,
    "selectOnLoad": False,
    "children_template": {
        "isMulti": True,
        "selection": None,
        "filterType": "dropdown",
        "apiEndpoint": "store/attributes/filters",
        "isMandatory": False,
        "selectOnLoad": False
    },
    "isMultiAttributes": True
}

SEGMENT_FILTER_TEMPLATE = {
    "method": "POST",
    "isMulti": True,
    "colValue": "segment_ids",
    "filterId": "segment_ids",
    "selection": "All",
    "filterType": "dropdown",
    "apiEndpoint": "segments",
    "filterLabel": "Customer Segment",
    "isMandatory": True,  # Always mandatory
    "selectOnLoad": True
}

PRODUCT_GROUP_IDS_TEMPLATE = {
    # No limit - limit only for product_attribute and zone_structure
    "isMulti": True,  # Always true
    "colValue": "product_group_ids",
    "filterId": "product_group_ids",
    "selection": None,
    "filterType": "dropdown",
    "apiEndpoint": "filters",
    "filterLabel": "Product Group",
    "isMandatory": True,  # Mandatory when in product_group section
    "selectOnLoad": False
}

STORE_GROUP_IDS_TEMPLATE = {
    # No limit - limit only for product_attribute and zone_structure
    "isMulti": True,  # Always true
    "colValue": "store_group_ids",
    "filterId": "store_group_ids",
    "selection": None,
    "filterType": "dropdown",
    "apiEndpoint": "filters",
    "filterLabel": "Store Group Code",
    "isMandatory": True,  # Mandatory when in store_group section
    "selectOnLoad": False
}

RULE_FILTER_TEMPLATE = {
    "rule": [
        {
            "method": "GET",
            "isMulti": True,
            "colValue": "rule_type_ids",
            "filterId": "rule_type_ids",
            "selection": None,
            "filterType": "dropdown",
            "apiEndpoint": "rules/types",
            "filterLabel": "Rule type",
            "isMandatory": False,
            "selectOnLoad": False
        },
        {
            "method": "POST",
            "isMulti": True,
            "colValue": "rule_ids",
            "filterId": "rule_ids",
            "selection": None,
            "filterType": "dropdown",
            "apiEndpoint": "rules/names",
            "filterLabel": "Rule name",
            "isMandatory": False,
            "selectOnLoad": False
        }
    ]
}

STRATEGY_FILTER_TEMPLATE = {
    "strategy_status": [
        {
            "filterId": "date_range",
            "colValue": "date_range",
            "filterLabel": "Date Range",
            "filterType": "dateRange",
            "isMandatory": True,
            "defaultValue": {
                "startDate": "today",
                "endDate": "+30d"
            },
            "validation": {
                "relativeRange": {
                    "min": {"value": 6, "unit": "months", "operator": "-"},
                    "max": {"value": 6, "unit": "months", "operator": "+"}
                },
                "errorMessage": "The date must be within 6 months of today."
            }
        },
        {
            "isMulti": True,
            "colValue": "strategy_status_display_name",
            "filterId": "strategy_status_display_name",
            "selection": "All",
            "filterType": "dropdown",
            "apiEndpoint": "strategies/filters",
            "filterLabel": "Approval Status",
            "isMandatory": False,
            "selectOnLoad": False,
            "api_request_type": "POST"
        },
        {
            "isMulti": True,
            "colValue": "strategy_name",
            "filterId": "strategy_name",
            "selection": None,
            "filterType": "dropdown",
            "apiEndpoint": "strategies/filters",
            "filterLabel": "Strategy Name",
            "isMandatory": False,
            "selectOnLoad": False,
            "api_request_type": "POST"
        }
    ]
}


def generate_product_hierarchy_filter(hierarchy_levels, restriction=None, level_configs=None, max_level=None):
    """Generate product hierarchy filter from hierarchy levels
    
    Args:
        hierarchy_levels: List of product hierarchy level records from DB
        restriction: Optional field to filter levels (e.g., 'is_zone_mapping_view_by')
        level_configs: Dict mapping level_id to overrides (mostly unused now - simplified)
        max_level: Optional max level to include (inclusive)
    
    Rules:
        - isMulti: always True
        - limit: NOT set for hierarchy levels (only for product_attribute/zone_structure)
        - isMandatory: True for first 2 levels (L0, L1), False for rest
        - selectOnLoad: True for first 3 levels (L0, L1, L2), False for rest
    """
    filters = []
    for level in hierarchy_levels:
        # Check if level should be included based on restriction
        if restriction:
            if restriction == "is_zone_mapping_view_by" and not level.get("is_zone_mapping_view_by", False):
                continue
            if restriction == "is_competitor_mapping_view_by" and not level.get("is_competitor_mapping_view_by", False):
                continue
        
        level_id = level.get("product_hierarchy_level_id", 0)
        
        # Check max_level
        if max_level is not None and level_id > max_level:
            continue
        
        filter_obj = {
            "isMulti": True,  # Always true
            "colValue": level.get("product_hierarchy_level_label", ""),
            "filterId": f"l{level_id}_ids",
            "selection": "All" if level_id < 3 else None,
            "filterType": "dropdown",
            "apiEndpoint": "filters",
            "filterLabel": level.get("product_hierarchy_level_value", ""),
            "isMandatory": level_id < 2,  # Only L0, L1 are mandatory
            "selectOnLoad": level_id < 3   # L0, L1, L2 load on start
        }
        # No limit for hierarchy levels
        
        filters.append(filter_obj)
    return filters


def generate_store_hierarchy_filter(hierarchy_levels, level_configs=None, max_level=None):
    """Generate store hierarchy filter from hierarchy levels
    
    Args:
        hierarchy_levels: List of store hierarchy level records from DB
        level_configs: Dict mapping level_id to overrides (mostly unused now - simplified)
        max_level: Optional max level to include (inclusive)
    
    Rules:
        - isMulti: always True
        - limit: NOT set for hierarchy levels (only for zone_structure)
        - isMandatory: True for first 2 levels (S0, S1), False for rest
        - selectOnLoad: True for first 2 levels (S0, S1), False for rest
    """
    filters = []
    for level in hierarchy_levels:
        level_id = level.get("store_hierarchy_level_id", 0)
        
        # Check max_level
        if max_level is not None and level_id > max_level:
            continue
        
        filter_obj = {
            "isMulti": True,  # Always true
            "colValue": level.get("store_hierarchy_level_label", ""),
            "filterId": f"s{level_id}_ids",
            "selection": "All" if level_id < 2 else None,
            "filterType": "dropdown",
            "apiEndpoint": "filters",
            "filterLabel": level.get("store_hierarchy_level_value", ""),
            "isMandatory": level_id < 2,  # Only S0, S1 are mandatory
            "selectOnLoad": level_id < 2   # S0, S1 load on start
        }
        # No limit for hierarchy levels
        
        filters.append(filter_obj)
    return filters
