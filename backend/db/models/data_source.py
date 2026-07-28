import uuid
from typing import Dict, Optional, Any, List
from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import JSON, Column

from db.models.user import User
from db.models.workspace import WorkspaceDataSource
from schemas.uploads import SourceType


class DataSource(SQLModel, table=True):
    __tablename__ = "data_sources"
    id: uuid.UUID = Field(
        primary_key=True,
        default_factory=uuid.uuid4
    )
    dataset_name: str = Field(..., description="Unique name for this dataset")
    description: Optional[str] = Field(None, description="Natural language description")
    source_type: SourceType
    artifact_url: Optional[str] = None
    ingestion_config: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON)
    )
    connection_string: Optional[str] = Field(None, description="SQLAlchemy URL or Google Sheet ID")
    workspaces: List["Workspace"] = Relationship(
        back_populates="data_sources",
        link_model=WorkspaceDataSource,
    )

    user_id: uuid.UUID = Field(foreign_key="users.id")
    owner: "User" = Relationship(back_populates="data_sources")