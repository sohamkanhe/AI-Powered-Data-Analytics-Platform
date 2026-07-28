import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from db.db import AsyncSessionLocal
from db.models.dashboard_pin import DashboardPin
from db.models.user import User
from routes.auth_router import get_current_user

dashboard_router = APIRouter()


# ── REQUEST / RESPONSE SCHEMAS ────────────────────────────────────────────────

class PinCreateRequest(BaseModel):
    title: str
    explanation: str
    query: str
    chart_payload: dict          # {spec, data, row_count}
    source_id: Optional[str] = None
    workspace_id: Optional[str] = None


class PinResponse(BaseModel):
    id: str
    title: str
    explanation: str
    query: str
    chart_payload: dict
    source_id: Optional[str]
    workspace_id: Optional[str]
    created_at: str

    @classmethod
    def from_pin(cls, pin: DashboardPin) -> "PinResponse":
        return cls(
            id=str(pin.id),
            title=pin.title,
            explanation=pin.explanation,
            query=pin.query,
            chart_payload=pin.chart_payload,
            source_id=str(pin.source_id) if pin.source_id else None,
            workspace_id=str(pin.workspace_id) if pin.workspace_id else None,
            created_at=pin.created_at.isoformat(),
        )


# ── ENDPOINTS ─────────────────────────────────────────────────────────────────

@dashboard_router.post("/dashboard/pin", response_model=PinResponse)
async def create_pin(
    req: PinCreateRequest,
    current_user: User = Depends(get_current_user),
):
    """Save a pinned chart to the database."""
    source_uuid = uuid.UUID(req.source_id) if req.source_id else None
    workspace_uuid = uuid.UUID(req.workspace_id) if req.workspace_id else None

    if not source_uuid and not workspace_uuid:
        raise HTTPException(status_code=400, detail="Must provide either source_id or workspace_id.")

    pin = DashboardPin(
        user_id=current_user.id,
        source_id=source_uuid,
        workspace_id=workspace_uuid,
        title=req.title,
        explanation=req.explanation,
        query=req.query,
        chart_payload=req.chart_payload,
    )

    async with AsyncSessionLocal() as session:
        session.add(pin)
        await session.commit()
        await session.refresh(pin)

    return PinResponse.from_pin(pin)


@dashboard_router.get("/dashboard/pins", response_model=list[PinResponse])
async def list_pins(
    source_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    """List all pinned charts for the current user, filtered by source or workspace."""
    async with AsyncSessionLocal() as session:
        stmt = select(DashboardPin).where(DashboardPin.user_id == current_user.id)

        if source_id:
            stmt = stmt.where(DashboardPin.source_id == uuid.UUID(source_id))
        elif workspace_id:
            stmt = stmt.where(DashboardPin.workspace_id == uuid.UUID(workspace_id))

        stmt = stmt.order_by(DashboardPin.created_at.desc())
        pins = (await session.execute(stmt)).scalars().all()

    return [PinResponse.from_pin(p) for p in pins]


@dashboard_router.delete("/dashboard/pins/{pin_id}")
async def delete_pin(
    pin_id: str,
    current_user: User = Depends(get_current_user),
):
    """Delete a pinned chart owned by the current user."""
    async with AsyncSessionLocal() as session:
        try:
            pin_uuid = uuid.UUID(pin_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid pin_id")

        stmt = select(DashboardPin).where(
            DashboardPin.id == pin_uuid,
            DashboardPin.user_id == current_user.id,
        )
        pin = (await session.execute(stmt)).scalar_one_or_none()

        if not pin:
            raise HTTPException(status_code=404, detail="Pin not found.")

        await session.delete(pin)
        await session.commit()

    return {"status": "success", "deleted": pin_id}
