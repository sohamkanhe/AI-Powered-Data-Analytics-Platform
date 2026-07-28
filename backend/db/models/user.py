import uuid
from typing import List
from sqlmodel import SQLModel, Field, Relationship


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    username: str = Field(unique=True, index=True)
    hashed_password: str

    # Relationships to their owned assets
    data_sources: List["DataSource"] = Relationship(back_populates="owner")
    workspaces: List["Workspace"] = Relationship(back_populates="owner")