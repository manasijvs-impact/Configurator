import psycopg
from psycopg.rows import dict_row
from typing import Optional

class DatabaseConnection:
    def __init__(self):
        self.connection = None
        self.client_name = None
        self.environment = None
        self.application = None
        self.database_name = None
        self.db_schema = 'base_pricing'  # Default schema
        self._config_cache = {}  # Cache for dynamic config (hierarchy, KVI columns, etc.)
    
    def connect(self, host: str, port: int, database: str, username: str, password: str, 
                client_name: str, environment: str, db_schema: str = 'base_pricing',
                application: str = 'base_smart') -> dict:
        """Establish connection to PostgreSQL database"""
        try:
            # Close existing connection if any
            if self.connection and not self.connection.closed:
                self.connection.close()
            
            self.connection = psycopg.connect(
                host=host,
                port=port,
                dbname=database,
                user=username,
                password=password,
                row_factory=dict_row,
                sslmode="prefer"
            )
            self.client_name = client_name
            self.environment = environment
            self.application = application
            self.database_name = database
            self.db_schema = db_schema
            self._config_cache = {}  # Clear cache on new connection
            return {"success": True, "message": f"Connected to {client_name} ({environment}) using schema {db_schema}"}
        except Exception as e:
            return {"success": False, "message": str(e)}
    
    def disconnect(self):
        """Close database connection"""
        if self.connection:
            self.connection.close()
            self.connection = None
            self.client_name = None
            self.environment = None
            self.application = None
            self.database_name = None
            self.db_schema = 'base_pricing'
            self._config_cache = {}
    
    def is_connected(self) -> bool:
        """Check if connection is active"""
        return self.connection is not None and not self.connection.closed
    
    def execute_query(self, query: str, params: tuple = None) -> list:
        """Execute SELECT query and return results"""
        if not self.is_connected():
            raise Exception("Not connected to database")
        
        with self.connection.cursor() as cursor:
            cursor.execute(query, params)
            return cursor.fetchall()
    
    def execute_write(self, query: str, params: tuple = None) -> int:
        """Execute INSERT/UPDATE/DELETE query"""
        if not self.is_connected():
            raise Exception("Not connected to database")
        
        with self.connection.cursor() as cursor:
            cursor.execute(query, params)
            self.connection.commit()
            return cursor.rowcount
    
    def execute_many(self, query: str, params_list: list) -> int:
        """Execute query with multiple parameter sets"""
        if not self.is_connected():
            raise Exception("Not connected to database")
        
        with self.connection.cursor() as cursor:
            cursor.executemany(query, params_list)
            self.connection.commit()
            return cursor.rowcount
    
    def get_connection_status(self) -> dict:
        """Get current connection status"""
        return {
            "connected": self.is_connected(),
            "client_name": self.client_name,
            "environment": self.environment,
            "application": self.application,
            "schema": self.db_schema if self.is_connected() else None,
            "database": self.database_name
        }
    
    def check_schema_exists(self) -> dict:
        """Check if the current schema exists in the connected database."""
        if not self.is_connected():
            return {"exists": False, "error": "Not connected to database"}
        
        try:
            query = """
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.schemata 
                    WHERE schema_name = %s
                ) AS schema_exists
            """
            result = self.execute_query(query, (self.db_schema,))
            exists = result[0]['schema_exists'] if result else False
            
            if exists:
                return {
                    "exists": True,
                    "schema": self.db_schema,
                    "message": f"Schema {self.db_schema} found"
                }
            else:
                app_display = self.application or "Application"
                return {
                    "exists": False,
                    "schema": self.db_schema,
                    "message": f"{app_display} is not enabled for {self.client_name} ({self.environment})"
                }
        except Exception as e:
            return {"exists": False, "error": str(e)}
    
    def clear_config_cache(self):
        """Clear configuration cache."""
        self._config_cache = {}


# Global database instance
db = DatabaseConnection()
