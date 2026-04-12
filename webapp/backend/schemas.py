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
    taxonomy: list[TaxonomyLabel]


class UnitChildPreview(UnitBrief):
    """UnitBrief + first child (for preview) and child count."""
    first_child: "UnitBrief | None" = None
    child_count: int = 0


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------

class CompareRequest(BaseModel):
    reference_unit_id: int
    unit_ids: list[int]
    method_id: int | None = None


class CompareItem(BaseModel):
    unit: UnitBrief
    cosine_similarity: float
    cosine_distance: float


class CompareResponse(BaseModel):
    reference_unit: UnitBrief
    method_id: int
    items: list[CompareItem]


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
    height_min: int | None = None
    height_max: int | None = None
    depth_min: int | None = None
    depth_max: int | None = None
    corpus_ids: list[int] | None = None
    limit: int = 10
    offset: int = 0


class KeywordSearchRequest(BaseModel):
    query: str
    height_min: int | None = None
    height_max: int | None = None
    depth_min: int | None = None
    depth_max: int | None = None
    corpus_ids: list[int] | None = None
    limit: int = 10
    offset: int = 0


class PassageSearchRequest(BaseModel):
    unit_id: int
    method_id: int | None = None
    height_min: int | None = None
    height_max: int | None = None
    depth_min: int | None = None
    depth_max: int | None = None
    corpus_ids: list[int] | None = None
    limit: int = 10
    offset: int = 0
    exclude_self: bool = True
