"""
Database Configuration for Data Validator
Contains connection details for all clients and environments.
Schema is determined by Application selection, not client.

Credentials loaded from environment variables:
  {CLIENT}_{ENV}_HOST, {CLIENT}_{ENV}_PORT, {CLIENT}_{ENV}_DATABASE,
  {CLIENT}_{ENV}_USERNAME, {CLIENT}_{ENV}_PASSWORD
  
Example: LESLIES_DEV_HOST, LESLIES_DEV_PASSWORD, etc.
"""

import os

def _get_env(key: str, default: str = None) -> str:
    """Get environment variable or return default."""
    return os.environ.get(key, default)


def _build_env_config(client: str, env: str) -> dict:
    """Build config from environment variables."""
    prefix = f"{client.upper()}_{env.upper()}"
    return {
        "host": _get_env(f"{prefix}_HOST", ""),
        "port": int(_get_env(f"{prefix}_PORT", "5432")),
        "database": _get_env(f"{prefix}_DATABASE", ""),
        "username": _get_env(f"{prefix}_USERNAME", ""),
        "password": _get_env(f"{prefix}_PASSWORD", ""),
    }


# Database configurations by client and environment
# Credentials loaded from environment variables
DB_CONFIG = {
    "leslies": {
        "display_name": "Leslies",
        "environments": {
            "dev": _build_env_config("leslies", "dev"),
            "test": _build_env_config("leslies", "test"),
            "uat": _build_env_config("leslies", "uat"),
            "prod": _build_env_config("leslies", "prod"),
        }
    },
    "crackerbarrel": {
        "display_name": "Crackerbarrel",
        "environments": {
            "dev": _build_env_config("crackerbarrel", "dev"),
            "test": _build_env_config("crackerbarrel", "test"),
            "uat": _build_env_config("crackerbarrel", "uat"),
            "prod": _build_env_config("crackerbarrel", "prod"),
        }
    }
}

# Application configurations - schema is determined by application
APPLICATIONS = {
    "base_smart": {
        "display_name": "Base Smart",
        "schema": "base_pricing",
        "clients": ["leslies", "crackerbarrel"]
    },
    "base_smart_restaurant": {
        "display_name": "Base Smart Restaurant",
        "schema": "base_pricing_restaurant",
        "clients": ["leslies", "crackerbarrel"]
    }
}

# Environment display names
ENVIRONMENTS = {
    "dev": "Development",
    "test": "Test",
    "uat": "UAT",
    "prod": "Production"
}


def get_application_schema(application: str) -> str:
    """Get schema name for an application."""
    if application not in APPLICATIONS:
        raise ValueError(f"Unknown application: {application}")
    return APPLICATIONS[application]["schema"]


def get_connection_config(client: str, environment: str, application: str = None) -> dict:
    """Get database connection configuration for a client and environment.
    
    If application is provided, schema comes from application config.
    Otherwise, defaults to base_pricing.
    """
    if client not in DB_CONFIG:
        raise ValueError(f"Unknown client: {client}")
    
    client_config = DB_CONFIG[client]
    
    if environment not in client_config["environments"]:
        raise ValueError(f"Unknown environment: {environment} for client: {client}")
    
    env_config = client_config["environments"][environment]
    
    # Schema comes from application, not client
    schema = "base_pricing"  # default
    if application and application in APPLICATIONS:
        schema = APPLICATIONS[application]["schema"]
    
    return {
        "host": env_config["host"],
        "port": env_config["port"],
        "database": env_config["database"],
        "username": env_config["username"],
        "password": env_config["password"],
        "schema": schema,
        "client_display_name": client_config["display_name"]
    }


def get_available_clients(application: str = "base_smart") -> list:
    """Get list of available clients for an application."""
    if application not in APPLICATIONS:
        return []
    
    app_config = APPLICATIONS[application]
    clients = []
    for client_key in app_config["clients"]:
        if client_key in DB_CONFIG:
            clients.append({
                "key": client_key,
                "display_name": DB_CONFIG[client_key]["display_name"]
            })
    return clients


def get_available_environments(client: str) -> list:
    """Get list of available environments for a client."""
    if client not in DB_CONFIG:
        return []
    
    return [
        {"key": env_key, "display_name": ENVIRONMENTS.get(env_key, env_key)}
        for env_key in DB_CONFIG[client]["environments"].keys()
    ]
