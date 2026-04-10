"""
webapp/backend/embedder.py

Singleton nomic-embed-text-v1.5 model loaded once at startup.
Query prefix differs from the document prefix used during indexing.
"""
from sentence_transformers import SentenceTransformer

MODEL_NAME = "nomic-ai/nomic-embed-text-v1.5"
QUERY_PREFIX = "search_query: "

_model: SentenceTransformer | None = None


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(MODEL_NAME, trust_remote_code=True)
        _model.max_seq_length = 8192
    return _model


def embed_query(text: str) -> list[float]:
    vec = get_model().encode(QUERY_PREFIX + text, normalize_embeddings=True)
    return vec.tolist()
