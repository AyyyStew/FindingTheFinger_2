"""
webapp/backend/main.py

Run from the project root:
    uvicorn webapp.backend.main:app --reload
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .embedder import get_model
from .routers import corpora, search, units


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_model()  # load nomic at startup so first search is not slow
    yield


app = FastAPI(title="FindingTheFinger API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router)
app.include_router(corpora.router)
app.include_router(units.router)
