"""
webapp/backend/schemas.py

Pydantic models for request/response bodies.
"""
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Corpus / Method
# ---------------------------------------------------------------------------

class CorpusVersionInfo(BaseModel):
    id: int
    translation_name: str | None
    language: str | None


class TaxonomyLabel(BaseModel):
    id: int
    name: str
    level: int
    parent_id: int | None


class CorpusLevelInfo(BaseModel):
    height: int
    name: str


class CorpusInfo(BaseModel):
    id: int
    name: str
    description: str | None
    taxonomy: list[TaxonomyLabel]
    levels: list[CorpusLevelInfo]
    versions: list[CorpusVersionInfo]


class MethodInfo(BaseModel):
    id: int
    model_name: str
    label: str
    description: str | None
    vector_dim: int


# ---------------------------------------------------------------------------
# Units
# ---------------------------------------------------------------------------

class UnitBrief(BaseModel):
    id: int
    text: str | None
    reference_label: str | None
    ancestor_path: str | None
    corpus_name: str
    corpus_version_name: str | None
    height: int | None
    depth: int


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

class SearchResult(BaseModel):
    id: int
    text: str | None
    reference_label: str | None
    ancestor_path: str | None
    corpus_name: str
    corpus_version_name: str | None
    height: int | None
    score: float  # cosine similarity 0–1; always 1.0 for keyword
    taxonomy: list[TaxonomyLabel]  # full ancestor chain, for color-coding


class SearchResponse(BaseModel):
    results: list[SearchResult]
    mode: str  # "semantic" | "keyword" | "passage"


class SemanticSearchRequest(BaseModel):
    query: str
    method_id: int | None = None
    height_min: int = 0
    height_max: int = 0
    corpus_ids: list[int] | None = None
    limit: int = 10


class KeywordSearchRequest(BaseModel):
    query: str
    corpus_ids: list[int] | None = None
    limit: int = 10


class PassageSearchRequest(BaseModel):
    unit_id: int
    method_id: int | None = None
    height_min: int = 0
    height_max: int = 0
    corpus_ids: list[int] | None = None
    limit: int = 10
    exclude_self: bool = True
