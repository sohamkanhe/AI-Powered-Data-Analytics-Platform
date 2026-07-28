import uuid
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from db.db import AsyncSessionLocal
from db.models.user import User
from db.models.workspace import Workspace, WorkspaceDataSource
from db.models.data_source import DataSource
from routes.auth_router import get_current_user
from routes.explore_helper import generate_data_profile

workspace_router = APIRouter()


# ─── SCHEMAS ──────────────────────────────────────────────────────────────────
class ColumnMeaning(BaseModel):
    column_name: str
    semantic_type: str = Field(description="e.g., Currency, Boolean Flag, Identifier, Measurement, Categorical, Temporal")
    description: str = Field(description="1-2 sentences explaining what this data represents to a business user in plain English.")

class DictionaryGeneration(BaseModel):
    columns: List[ColumnMeaning]

class WorkspaceCreate(BaseModel):
    name: str
    description: Optional[str] = None
    source_ids: List[str]


class WorkspaceAddSources(BaseModel):
    source_ids: List[str]

# Add this to your SCHEMAS section
class WorkspaceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    source_ids: Optional[List[str]] = None



# ─── CREATE ───────────────────────────────────────────────────────────────────
@workspace_router.post("/")
async def create_workspace(req: WorkspaceCreate, current_user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        source_uuids = [uuid.UUID(sid) for sid in req.source_ids]

        # 🔒 SECURE FETCH: Ensure all requested sources belong to this user
        stmt = (
            select(DataSource)
            .where(DataSource.id.in_(source_uuids), DataSource.user_id == current_user.id)
        )
        sources = (await session.execute(stmt)).scalars().all()

        if len(sources) != len(source_uuids):
            raise HTTPException(status_code=400, detail="One or more data sources are invalid or unauthorized.")

        # 🔒 ASSIGN OWNERSHIP
        workspace = Workspace(name=req.name, description=req.description, user_id=current_user.id)
        workspace.data_sources.extend(sources)

        session.add(workspace)
        await session.commit()
        await session.refresh(workspace)

        return {
            "id": str(workspace.id),
            "name": workspace.name,
            "description": workspace.description,
            "source_count": len(sources)
        }


# ─── LIST ALL ────────────────────────────────────────────────────────────────
@workspace_router.get("/")
async def get_workspaces(current_user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        stmt = (
            select(Workspace)
            .where(Workspace.user_id == current_user.id)
            .options(selectinload(Workspace.data_sources))
            .order_by(Workspace.created_at.desc())
        )
        workspaces = (await session.execute(stmt)).scalars().all()

        return [
            {
                "id": str(ws.id),
                "name": ws.name,
                "description": ws.description,
                "source_count": len(ws.data_sources),
                # Preview: first 2 dataset names + ellipsis if more
                "sources_preview": (
                    ", ".join(ds.dataset_name for ds in ws.data_sources[:2])
                    + (" …" if len(ws.data_sources) > 2 else "")
                ),
                "sources": [
                    {"id": str(ds.id), "name": ds.dataset_name, "type": ds.source_type}
                    for ds in ws.data_sources
                ],
                "created_at": ws.created_at.isoformat(),
            }
            for ws in workspaces
        ]


# ─── GET ONE ─────────────────────────────────────────────────────────────────
@workspace_router.get("/{workspace_id}")
async def get_workspace(workspace_id: str, current_user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        stmt = (
            select(Workspace)
            .where(Workspace.id == uuid.UUID(workspace_id), Workspace.user_id == current_user.id)
            .options(selectinload(Workspace.data_sources))
        )
        ws = (await session.execute(stmt)).scalar_one_or_none()

        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found.")

        return {
            "id": str(ws.id),
            "name": ws.name,
            "description": ws.description,
            "created_at": ws.created_at.isoformat(),
            "sources": [
                {
                    "id": str(ds.id),
                    "name": ds.dataset_name,
                    "type": ds.source_type,
                    "artifact_url": ds.artifact_url,
                    "description": ds.description,
                }
                for ds in ws.data_sources
            ],
        }


# ─── ADD SOURCES ─────────────────────────────────────────────────────────────
@workspace_router.post("/{workspace_id}/sources")
async def add_sources(workspace_id: str, req: WorkspaceAddSources):
    async with AsyncSessionLocal() as session:
        stmt = (
            select(Workspace)
            .where(Workspace.id == uuid.UUID(workspace_id))
            .options(selectinload(Workspace.data_sources))
        )
        result = await session.execute(stmt)
        ws = result.scalar_one_or_none()

        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found.")

        existing_ids = {ds.id for ds in ws.data_sources}
        new_uuids = [uuid.UUID(sid) for sid in req.source_ids if uuid.UUID(sid) not in existing_ids]

        if new_uuids:
            stmt2 = select(DataSource).where(DataSource.id.in_(new_uuids))
            result2 = await session.execute(stmt2)
            new_sources = result2.scalars().all()
            ws.data_sources.extend(new_sources)
            await session.commit()

        return {"added": len(new_uuids), "total_sources": len(ws.data_sources)}


# ─── REMOVE SOURCE ────────────────────────────────────────────────────────────
@workspace_router.delete("/{workspace_id}/sources/{source_id}")
async def remove_source(workspace_id: str, source_id: str):
    async with AsyncSessionLocal() as session:
        stmt = (
            select(Workspace)
            .where(Workspace.id == uuid.UUID(workspace_id))
            .options(selectinload(Workspace.data_sources))
        )
        result = await session.execute(stmt)
        ws = result.scalar_one_or_none()

        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found.")

        ws.data_sources = [ds for ds in ws.data_sources if str(ds.id) != source_id]
        await session.commit()

        return {"removed": source_id, "total_sources": len(ws.data_sources)}


# ─── DELETE WORKSPACE ────────────────────────────────────────────────────────
@workspace_router.delete("/{workspace_id}")
async def delete_workspace(workspace_id: str):
    async with AsyncSessionLocal() as session:
        stmt = select(Workspace).where(Workspace.id == uuid.UUID(workspace_id))
        result = await session.execute(stmt)
        ws = result.scalar_one_or_none()

        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found.")

        await session.delete(ws)
        await session.commit()

        return {"deleted": workspace_id}


# Add this to your ROUTES section
@workspace_router.patch("/{workspace_id}")
async def update_workspace(
        workspace_id: str,
        req: WorkspaceUpdate,
        current_user: User = Depends(get_current_user)
):
    async with AsyncSessionLocal() as session:
        # We MUST use selectinload here so SQLAlchemy knows about the existing data sources
        stmt = (
            select(Workspace)
            .where(
                Workspace.id == uuid.UUID(workspace_id),
                Workspace.user_id == current_user.id
            )
            .options(selectinload(Workspace.data_sources))
        )
        ws = (await session.execute(stmt)).scalar_one_or_none()

        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found or access denied")

        # 1. Update text fields
        if req.name is not None:
            ws.name = req.name
        if req.description is not None:
            ws.description = req.description

        # 2. Update the connected Data Sources
        if req.source_ids is not None:
            source_uuids = [uuid.UUID(sid) for sid in req.source_ids]

            # Fetch the requested sources (ensuring the user actually owns them)
            source_stmt = select(DataSource).where(
                DataSource.id.in_(source_uuids),
                DataSource.user_id == current_user.id
            )
            new_sources = (await session.execute(source_stmt)).scalars().all()

            # Reassign the relationship.
            # SQLAlchemy automatically adds/removes rows in the junction table!
            ws.data_sources = list(new_sources)

        await session.commit()
        await session.refresh(ws)

        return {
            "status": "success",
            "id": str(ws.id),
            "name": ws.name,
            "description": ws.description,
            "source_count": len(ws.data_sources)
        }


@workspace_router.get("/{workspace_id}/explore")
async def explore_workspace(workspace_id: str, current_user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        stmt = (
            select(Workspace)
            .where(Workspace.id == uuid.UUID(workspace_id), Workspace.user_id == current_user.id)
            .options(selectinload(Workspace.data_sources))
        )
        ws = (await session.execute(stmt)).scalar_one_or_none()

        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        workspace_profiles = {}
        for source in ws.data_sources:
            profile = generate_data_profile(source.source_type, source.artifact_url, source.connection_string)
            workspace_profiles[source.dataset_name] = profile

        return workspace_profiles