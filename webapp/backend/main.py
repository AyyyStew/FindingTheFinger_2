"""
webapp/backend/main.py

Run from the project root:
    uvicorn webapp.backend.main:app --reload
"""
from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .embedder import get_model
from .routers import corpora, search, units


def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ALLOWED_ORIGINS")
    if raw:
        origins = [item.strip() for item in raw.split(",") if item.strip()]
        if origins:
            return origins
    return ["http://localhost:5173"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    if _env_flag("PRELOAD_EMBED_MODEL", default=False):
        get_model()
    yield


app = FastAPI(title="FindingTheFinger API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/healthz")
def healthz():
    return {"ok": True}


app.include_router(search.router)
app.include_router(corpora.router)
app.include_router(units.router)

_STATIC_DIR = Path(__file__).parents[2] / "static"
_STATIC_DIR.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")
