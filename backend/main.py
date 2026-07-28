import sys
import asyncio
import io

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    # Force UTF-8 encoding on Windows to prevent charmap errors from emoji in LLM outputs
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

from contextlib import asynccontextmanager
from fastapi import FastAPI
from db.db import init_db
from routes.auth_router import auth_router
from routes.chat_router import chat_router
from routes.dashboard_router import dashboard_router
from routes.ingest import router
from routes.workspace import workspace_router
from fastapi.middleware.cors import CORSMiddleware

@asynccontextmanager
async def life_span(app: FastAPI):
    print("Starting application...")
    await init_db()
    yield
    print("Stopping application...")

app = FastAPI(lifespan=life_span)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/v1/auth")
app.include_router(router, prefix="/api/v1")
app.include_router(chat_router, prefix="/api/v1")
app.include_router(workspace_router, prefix="/api/v1/workspaces")
app.include_router(dashboard_router, prefix="/api/v1")

@app.get("/")
async def run_root():
    return {"message": "hello"}