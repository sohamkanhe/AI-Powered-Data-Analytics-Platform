import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from sqlmodel import SQLModel, Field
from sqlalchemy import Column, DateTime, JSON


class DashboardPin(SQLModel, table=True):
    __tablename__ = "dashboard_pins"

    id: uuid.UUID = Field(
        primary_key=True,
        default_factory=uuid.uuid4,
    )
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)

    # Either source_id (DataSource chat) or workspace_id (Workspace chat) will be set
    source_id: Optional[uuid.UUID] = Field(None, foreign_key="data_sources.id", index=True)
    workspace_id: Optional[uuid.UUID] = Field(None, foreign_key="workspaces.id", index=True)

    title: str = Field(..., description="Chart title shown on the dashboard card")
    explanation: str = Field(default="", description="AI-generated explanation text")
    query: str = Field(default="", description="SQL query that produced this chart")

    # The full chart payload: {spec, data, row_count}
    chart_payload: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON),
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True)),
    )
