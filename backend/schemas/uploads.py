from enum import Enum
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any

class SourceType(str, Enum):
    POSTGRES_DB = "postgres_db"
    MYSQL_DB = "mysql_db"
    EXCEL = "excel"
    CSV = "csv"
    JSON = "json"
    GOOGLE_SHEET = "google_sheet"
    PARQUET = "parquet"


class DataIngestRequest(BaseModel):
    dataset_name: str = Field(..., description="Unique name for this dataset e.g., 'Q3 Sales'")
    description: Optional[str] = Field(None, description="Natural language description of what this data contains. "
                    "Helps the Router Agent decide when to use this source.")
    source_type: SourceType
    ingestion_config: Dict[str, Any] = Field(default_factory=dict)
    connection_string: Optional[str] = Field(None, description="SQLAlchemy URL or Google Sheet ID")