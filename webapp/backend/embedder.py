"""
webapp/backend/embedder.py

Singleton nomic-embed-text-v1.5 model loaded once at startup.
Query prefix differs from the document prefix used during indexing.
"""
import os
from typing import Any

MODEL_NAME = "nomic-ai/nomic-embed-text-v1.5"
QUERY_PREFIX = "search_query: "

_model: Any | None = None


def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _semantic_search_enabled() -> bool:
    return _env_flag("ENABLE_SEMANTIC_SEARCH", default=True)


def get_model():
    global _model
    if not _semantic_search_enabled():
        raise RuntimeError("Semantic search is disabled by ENABLE_SEMANTIC_SEARCH=false")
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise RuntimeError(
                "sentence-transformers is not installed in this backend image"
            ) from exc
        _model = SentenceTransformer(MODEL_NAME, trust_remote_code=True)
        _model.max_seq_length = 8192
    return _model


def embed_query(text: str) -> list[float]:
    vec = get_model().encode(QUERY_PREFIX + text, normalize_embeddings=True)
    return vec.tolist()
