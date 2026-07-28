import uuid
from datetime import datetime, timezone
from typing import List, Optional
from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, DateTime

from db.models.user import User


# ─── ASSOCIATION TABLE ────────────────────────────────────────────────────────
class WorkspaceDataSource(SQLModel, table=True):
    """Many-to-many join table between Workspace and DataSource."""
    __tablename__ = "workspace_data_sources"

    workspace_id: uuid.UUID = Field(foreign_key="workspaces.id", primary_key=True)
    data_source_id: uuid.UUID = Field(foreign_key="data_sources.id", primary_key=True)


# ─── WORKSPACE MODEL ──────────────────────────────────────────────────────────
class Workspace(SQLModel, table=True):
    __tablename__ = "workspaces"

    id: uuid.UUID = Field(
        primary_key=True,
        default_factory=uuid.uuid4,
    )
    name: str = Field(..., description="Display name for this workspace")
    description: Optional[str] = Field(None, description="Optional description")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True)),
    )

    # Many-to-many back to DataSource via the join table
    data_sources: List["DataSource"] = Relationship(
        back_populates="workspaces",
        link_model=WorkspaceDataSource,
    )

    user_id: uuid.UUID = Field(foreign_key="users.id")
    owner: "User" = Relationship(back_populates="workspaces")


