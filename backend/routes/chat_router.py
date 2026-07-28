import os
import uuid
import re
import json
from fastapi import APIRouter, HTTPException, Depends
from langchain_core.messages import HumanMessage
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from db.db import AsyncSessionLocal
from db.duck_db import get_artifact_read_path, get_duckdb_connection
from db.models.NotebookCell import NotebookCell
from db.models.data_source import DataSource
from db.models.user import User
from db.models.workspace import Workspace
from routes.auth_router import get_current_user

# 💥 IMPORT THE NEW AGENT
from agent.graph import data_agent
from agent.nodes.sandbox import execute_sandbox_node

DB_URI = os.getenv("DATABASE_URL_PG", "postgresql://admin:admin@localhost:5432/da_agent_db")

chat_router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    cell_id: str


class WorkspaceChatRequest(BaseModel):
    message: str
    cell_id: str


def _safe_view_name(dataset_name: str) -> str:
    name = dataset_name.lower().strip()
    name = re.sub(r"[^a-z0-9_]", "_", name)
    return re.sub(r"_+", "_", name).strip("_") or "data_table"



def generate_schema_context(source=None, workspace_sources=None):
    """Pre-fetches the schema to inject into the LLM prompt, making the agent much faster."""
    con = get_duckdb_connection()
    try:
        schema_parts = []
        if workspace_sources:
            for src in workspace_sources:
                view_name = _safe_view_name(src["name"])
                if src["source_type"] in ["postgres_db", "mysql_db"]:
                    db_ext = "postgres" if src["source_type"] == "postgres_db" else "mysql"
                    con.execute(f"INSTALL {db_ext}; LOAD {db_ext};")
                    con.execute(f"ATTACH '{src['connection_string']}' AS live_{view_name} (TYPE {db_ext})")
                    df = con.execute(
                        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'").df()
                    tables = ", ".join(df["table_name"].tolist())
                    schema_parts.append(
                        f"Database '{src['name']}': Tables [{tables}]. Query via live_{view_name}.table_name")
                elif src.get("artifact_url"):
                    read_path = get_artifact_read_path(src["artifact_url"])
                    safe_read_path = read_path.replace("'", "''")
                    con.execute(f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_parquet('{safe_read_path}')")
                    df = con.execute(f"DESCRIBE {view_name}").df()
                    cols = ", ".join(f"{r['column_name']} ({r['column_type']})" for _, r in df.iterrows())
                    schema_parts.append(f"View '{view_name}' (Dataset: {src['name']}): {cols}")
        elif source:
            if source.source_type in ["postgres_db", "mysql_db"]:
                db_ext = "postgres" if source.source_type == "postgres_db" else "mysql"
                con.execute(f"INSTALL {db_ext}; LOAD {db_ext};")
                con.execute(f"ATTACH '{source.connection_string}' AS live_db (TYPE {db_ext})")
                df = con.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public'").df()
                tables = ", ".join(df["table_name"].tolist())
                schema_parts.append(
                    f"Live Database '{source.dataset_name}': Tables [{tables}]. Query via live_db.table_name")
            else:
                if source.artifact_url:
                    read_path = get_artifact_read_path(source.artifact_url)
                    safe_read_path = read_path.replace("'", "''")
                    con.execute(f"CREATE OR REPLACE VIEW data_table AS SELECT * FROM read_parquet('{safe_read_path}')")
                    df = con.execute("DESCRIBE data_table").df()
                    cols = ", ".join(f"{r['column_name']} ({r['column_type']})" for _, r in df.iterrows())
                    schema_parts.append(f"View 'data_table' (Dataset: {source.dataset_name}): {cols}")

        return "\n".join(schema_parts) if schema_parts else "No schema available."
    except Exception as e:
        return f"Error fetching schema: {str(e)}"
    finally:
        con.close()


@chat_router.post("/chat/{source_id}")
async def chat(source_id: str, request: ChatRequest, current_user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        try:
            source_uuid = uuid.UUID(source_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid source_id")

        stmt = select(DataSource).where(DataSource.id == source_uuid, DataSource.user_id == current_user.id)
        source = (await session.execute(stmt)).scalar_one_or_none()

        if not source:
            raise HTTPException(status_code=404, detail="Data source not found.")

    schema_context = generate_schema_context(source=source)
    # Use cell_id as thread_id so each notebook cell has its own isolated state.
    # This prevents ui_blocks from previous cells accumulating via the append_block reducer.
    thread_id = f"cell_{request.cell_id}"
    config = {"configurable": {"thread_id": thread_id}}

    initial_state = {
        "messages": [HumanMessage(content=request.message)],
        "ui_blocks": [],
        "dataset_name": source.dataset_name,
        "artifact_url": source.artifact_url,
        "connection_string": source.connection_string,
        "source_type": source.source_type,
        "workspace_sources": None,
        "schema_context": schema_context,
        "sandbox_result": None,
        "df_json": None,
        "current_code": None,
    }

    try:
        async with AsyncPostgresSaver.from_conn_string(DB_URI) as memory:
            await memory.setup()
            agent_with_memory = data_agent.with_config(checkpointer=memory)
            final_state = await agent_with_memory.ainvoke(initial_state, config=config)
    except Exception as e:
        print(f"PostgresSaver bypass fallback to MemorySaver: {e}")
        try:
            from langgraph.checkpoint.memory import MemorySaver
            memory = MemorySaver()
            agent_with_memory = data_agent.with_config(checkpointer=memory)
            final_state = await agent_with_memory.ainvoke(initial_state, config=config)
        except Exception as agent_err:
            print(f"Agent error: {agent_err}")
            raise HTTPException(status_code=500, detail=str(agent_err))

    blocks = final_state.get("ui_blocks", [])
    async with AsyncSessionLocal() as session:
        stmt = select(NotebookCell).where(NotebookCell.id == uuid.UUID(request.cell_id))
        existing_cell = (await session.execute(stmt)).scalar_one_or_none()

        if existing_cell:
            existing_cell.user_input = request.message
            existing_cell.ui_blocks = blocks
        else:
            new_cell = NotebookCell(
                id=uuid.UUID(request.cell_id), user_id=current_user.id,
                source_id=uuid.UUID(source_id), user_input=request.message, ui_blocks=blocks
            )
            session.add(new_cell)
        await session.commit()

    return {"blocks": blocks}


@chat_router.post("/chat/workspace/{workspace_id}")
async def workspace_chat(workspace_id: str, req: WorkspaceChatRequest, current_user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        stmt = select(Workspace).where(Workspace.id == uuid.UUID(workspace_id),
                                       Workspace.user_id == current_user.id).options(
            selectinload(Workspace.data_sources))
        ws = (await session.execute(stmt)).scalar_one_or_none()

    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found or access denied.")

    sources = [{"id": str(ds.id), "name": ds.dataset_name, "artifact_url": ds.artifact_url,
                "connection_string": ds.connection_string, "source_type": ds.source_type} for ds in ws.data_sources]

    if not sources:
        raise HTTPException(status_code=400, detail="No sources with data files in this workspace.")

    schema_context = generate_schema_context(workspace_sources=sources)
    # Use cell_id as thread_id so each notebook cell has its own isolated state.
    thread_id = f"cell_{req.cell_id}"
    config = {"configurable": {"thread_id": thread_id}}

    initial_state = {
        "messages": [HumanMessage(content=req.message)],
        "dataset_name": ws.name,
        "artifact_url": None,
        "connection_string": None,
        "source_type": "workspace",
        "workspace_sources": sources,
        "schema_context": schema_context,
        "ui_blocks": [],
        "sandbox_result": None,
        "df_json": None,
        "current_code": None,
    }

    try:
        async with AsyncPostgresSaver.from_conn_string(DB_URI) as memory:
            await memory.setup()
            agent_with_memory = data_agent.with_config(checkpointer=memory)
            final_state = await agent_with_memory.ainvoke(initial_state, config=config)
    except Exception as e:
        print(f"Workspace PostgresSaver bypass fallback to MemorySaver: {e}")
        try:
            from langgraph.checkpoint.memory import MemorySaver
            memory = MemorySaver()
            agent_with_memory = data_agent.with_config(checkpointer=memory)
            final_state = await agent_with_memory.ainvoke(initial_state, config=config)
        except Exception as agent_err:
            print(f"Workspace agent error: {agent_err}")
            raise HTTPException(status_code=500, detail=str(agent_err))

    blocks = final_state.get("ui_blocks", [])

    async with AsyncSessionLocal() as session:
        stmt = select(NotebookCell).where(NotebookCell.id == uuid.UUID(req.cell_id))
        existing_cell = (await session.execute(stmt)).scalar_one_or_none()

        if existing_cell:
            existing_cell.user_input = req.message
            existing_cell.ui_blocks = blocks
        else:
            new_cell = NotebookCell(
                id=uuid.UUID(req.cell_id), user_id=current_user.id,
                workspace_id=uuid.UUID(workspace_id), user_input=req.message, ui_blocks=blocks
            )
            session.add(new_cell)
        await session.commit()

    return {"blocks": blocks}


@chat_router.get("/chat/{source_id}/history")
async def get_source_history(source_id: str, current_user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        stmt = (
            select(NotebookCell)
            .where(
                NotebookCell.source_id == uuid.UUID(source_id),
                NotebookCell.user_id == current_user.id
            )
            .order_by(NotebookCell.created_at.asc())
        )
        cells = (await session.execute(stmt)).scalars().all()

        return [
            {
                "id": str(cell.id),
                "type": "code",
                "input": cell.user_input,
                "blocks": cell.ui_blocks,
                "status": "done"
            }
            for cell in cells
        ]


@chat_router.get("/chat/workspace/{workspace_id}/history")
async def get_workspace_history(workspace_id: str, current_user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        stmt = (
            select(NotebookCell)
            .where(
                NotebookCell.workspace_id == uuid.UUID(workspace_id),
                NotebookCell.user_id == current_user.id
            )
            .order_by(NotebookCell.created_at.asc())
        )
        cells = (await session.execute(stmt)).scalars().all()

        return [
            {
                "id": str(cell.id),
                "type": "code",
                "input": cell.user_input,
                "blocks": cell.ui_blocks,
                "status": "done"
            }
            for cell in cells
        ]


@chat_router.delete("/cell/{cell_id}")
async def delete_notebook_cell(cell_id: str, current_user: User = Depends(get_current_user)):
    async with AsyncSessionLocal() as session:
        try:
            cell_uuid = uuid.UUID(cell_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid cell_id")

        stmt = select(NotebookCell).where(
            NotebookCell.id == cell_uuid,
            NotebookCell.user_id == current_user.id
        )
        cell = (await session.execute(stmt)).scalar_one_or_none()

        if cell:
            await session.delete(cell)
            await session.commit()
            return {"status": "success", "deleted": cell_id}

        return {"status": "success", "message": "Cell not found in database"}
