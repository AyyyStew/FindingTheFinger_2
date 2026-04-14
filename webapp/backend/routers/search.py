from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, select

from db.models import (
    Corpus,
    CorpusVersion,
    Embedding,
    EmbeddingProfile,
    EmbeddingSpan,
    EmbeddingSpanUnit,
    Method,
    SpanEmbedding,
    Unit,
)
from ..deps import get_db
from ..embedder import embed_query
from ..schemas import (
    KeywordSearchRequest,
    PassageSearchRequest,
    SearchResponse,
    SearchResult,
    SemanticSearchRequest,
    TaxonomyLabel,
)
from ..taxonomy import build_corpus_taxonomy_map

router = APIRouter(prefix="/api/search")


def _default_method_id(db: Session) -> int:
    method = db.execute(
        select(Method).where(Method.label == "nomic-embed-text-v1.5/span-windows")
    ).scalars().first()
    if method is None:
        method = db.execute(select(Method)).scalars().first()
    if method is None:
        raise HTTPException(status_code=503, detail="No embedding methods in database")
    return method.id


def _default_profile_id(db: Session) -> int | None:
    profile = db.execute(
        select(EmbeddingProfile).where(EmbeddingProfile.target_tokens == 50)
    ).scalars().first()
    if profile is None:
        profile = db.execute(select(EmbeddingProfile).order_by(EmbeddingProfile.target_tokens)).scalars().first()
    return profile.id if profile is not None else None


def _has_span_embeddings(db: Session, method_id: int, profile_id: int | None) -> bool:
    if profile_id is None:
        return False
    count = db.execute(
        select(func.count(SpanEmbedding.id))
        .join(EmbeddingSpan, EmbeddingSpan.id == SpanEmbedding.embedding_span_id)
        .where(SpanEmbedding.method_id == method_id)
        .where(EmbeddingSpan.profile_id == profile_id)
    ).scalar_one()
    return count > 0


def _normalize_vector(values: list[float]) -> list[float]:
    norm = sum(v * v for v in values) ** 0.5
    if norm == 0:
        return values
    return [v / norm for v in values]


def _weighted_average(vectors: list[tuple[list[float], float]]) -> list[float] | None:
    if not vectors:
        return None
    dim = len(vectors[0][0])
    totals = [0.0] * dim
    weight_sum = 0.0
    for vector, weight in vectors:
        w = weight if weight > 0 else 1.0
        weight_sum += w
        for i, value in enumerate(vector):
            totals[i] += float(value) * w
    if weight_sum == 0:
        return None
    return _normalize_vector([v / weight_sum for v in totals])


def _unit_span_vector(db: Session, unit_id: int, method_id: int, profile_id: int | None) -> list[float] | None:
    if profile_id is None:
        return None
    rows = db.execute(
        select(SpanEmbedding.vector, EmbeddingSpanUnit.coverage_weight)
        .join(EmbeddingSpan, EmbeddingSpan.id == SpanEmbedding.embedding_span_id)
        .join(EmbeddingSpanUnit, EmbeddingSpanUnit.span_id == EmbeddingSpan.id)
        .where(SpanEmbedding.method_id == method_id)
        .where(EmbeddingSpan.profile_id == profile_id)
        .where(EmbeddingSpanUnit.unit_id == unit_id)
    ).all()
    return _weighted_average([(list(vector), float(weight)) for vector, weight in rows])


def _unit_embedding_vector(db: Session, unit_id: int, method_id: int) -> list[float] | None:
    vector = db.execute(
        select(Embedding.vector)
        .where(Embedding.unit_id == unit_id)
        .where(Embedding.method_id == method_id)
    ).scalar_one_or_none()
    return list(vector) if vector is not None else None


def _span_support_unit_ids(db: Session, span_ids: list[int]) -> dict[int, list[int]]:
    if not span_ids:
        return {}
    rows = db.execute(
        select(EmbeddingSpanUnit.span_id, EmbeddingSpanUnit.unit_id)
        .where(EmbeddingSpanUnit.span_id.in_(span_ids))
        .order_by(EmbeddingSpanUnit.span_id, EmbeddingSpanUnit.unit_order)
    ).all()
    support: dict[int, list[int]] = {}
    for span_id, unit_id in rows:
        support.setdefault(span_id, []).append(unit_id)
    return support


def _span_vector_search(
    db: Session,
    query_vec: list[float],
    method_id: int,
    profile_id: int,
    height_min: int | None,
    height_max: int | None,
    depth_min: int | None,
    depth_max: int | None,
    corpus_ids: list[int] | None,
    corpus_version_ids: list[int] | None,
    limit: int,
    tax_map: dict[int, list[TaxonomyLabel]],
    exclude_unit_id: int | None = None,
    offset: int = 0,
) -> list[SearchResult]:
    if corpus_ids is not None and len(corpus_ids) == 0:
        return []
    if corpus_version_ids is not None and len(corpus_version_ids) == 0:
        return []

    stmt = (
        select(
            EmbeddingSpan,
            Unit,
            Corpus.name.label("corpus_name"),
            CorpusVersion.translation_name.label("version_name"),
            SpanEmbedding.vector.cosine_distance(query_vec).label("distance"),
        )
        .join(SpanEmbedding, SpanEmbedding.embedding_span_id == EmbeddingSpan.id)
        .join(Unit, Unit.id == EmbeddingSpan.start_unit_id)
        .join(Corpus, Corpus.id == EmbeddingSpan.corpus_id)
        .join(CorpusVersion, CorpusVersion.id == EmbeddingSpan.corpus_version_id)
        .where(SpanEmbedding.method_id == method_id)
        .where(EmbeddingSpan.profile_id == profile_id)
    )
    # Span search level is controlled by embedding_profile_id. Unit
    # height/depth filters are only meaningful for unit-backed searches.
    _ = (height_min, height_max, depth_min, depth_max)
    if corpus_ids:
        stmt = stmt.where(EmbeddingSpan.corpus_id.in_(corpus_ids))
    if corpus_version_ids:
        stmt = stmt.where(EmbeddingSpan.corpus_version_id.in_(corpus_version_ids))
    if exclude_unit_id is not None:
        stmt = stmt.where(
            ~select(EmbeddingSpanUnit.span_id)
            .where(EmbeddingSpanUnit.span_id == EmbeddingSpan.id)
            .where(EmbeddingSpanUnit.unit_id == exclude_unit_id)
            .exists()
        )
    stmt = stmt.order_by("distance").offset(offset).limit(limit)

    rows = db.execute(stmt).all()
    support_by_span = _span_support_unit_ids(db, [span.id for span, *_ in rows])
    return [
        SearchResult(
            id=span.id,
            result_type="span",
            text=span.text,
            reference_label=span.reference_label or unit.reference_label,
            ancestor_path=span.ancestor_path or unit.ancestor_path,
            corpus_name=corpus_name,
            corpus_version_name=version_name,
            height=unit.height,
            score=round(1.0 - float(distance), 4),
            taxonomy=tax_map.get(span.corpus_id, []),
            embedding_span_id=span.id,
            embedding_profile_id=profile_id,
            support_unit_ids=support_by_span.get(span.id, [span.start_unit_id]),
            start_unit_id=span.start_unit_id,
            end_unit_id=span.end_unit_id,
            primary_unit_id=span.start_unit_id,
        )
        for span, unit, corpus_name, version_name, distance in rows
    ]


def _vector_search(
    db: Session,
    query_vec: list[float],
    method_id: int,
    height_min: int | None,
    height_max: int | None,
    depth_min: int | None,
    depth_max: int | None,
    corpus_ids: list[int] | None,
    corpus_version_ids: list[int] | None,
    limit: int,
    tax_map: dict[int, list[TaxonomyLabel]],
    exclude_unit_id: int | None = None,
    offset: int = 0,
) -> list[SearchResult]:
    if corpus_ids is not None and len(corpus_ids) == 0:
        return []
    if corpus_version_ids is not None and len(corpus_version_ids) == 0:
        return []

    stmt = (
        select(
            Unit,
            Corpus.name.label("corpus_name"),
            CorpusVersion.translation_name.label("version_name"),
            Embedding.vector.cosine_distance(query_vec).label("distance"),
        )
        .join(Embedding, Embedding.unit_id == Unit.id)
        .join(Corpus, Corpus.id == Unit.corpus_id)
        .join(CorpusVersion, CorpusVersion.id == Unit.corpus_version_id)
        .where(Embedding.method_id == method_id)
    )
    if height_min is not None and height_max is not None:
        stmt = stmt.where(Unit.height.between(height_min, height_max))
    if depth_min is not None and depth_max is not None:
        stmt = stmt.where(Unit.depth.between(depth_min, depth_max))
    if corpus_ids:
        stmt = stmt.where(Unit.corpus_id.in_(corpus_ids))
    if corpus_version_ids:
        stmt = stmt.where(Unit.corpus_version_id.in_(corpus_version_ids))
    if exclude_unit_id is not None:
        stmt = stmt.where(Unit.id != exclude_unit_id)
    stmt = stmt.order_by("distance").offset(offset).limit(limit)

    rows = db.execute(stmt).all()
    return [
        SearchResult(
            id=unit.id,
            result_type="unit",
            text=unit.text,
            reference_label=unit.reference_label,
            ancestor_path=unit.ancestor_path,
            corpus_name=corpus_name,
            corpus_version_name=version_name,
            height=unit.height,
            score=round(1.0 - float(distance), 4),
            taxonomy=tax_map.get(unit.corpus_id, []),
            embedding_span_id=None,
            embedding_profile_id=None,
            support_unit_ids=[unit.id],
            start_unit_id=unit.id,
            end_unit_id=unit.id,
            primary_unit_id=unit.id,
        )
        for unit, corpus_name, version_name, distance in rows
    ]


@router.post("/semantic", response_model=SearchResponse)
def search_semantic(req: SemanticSearchRequest, db: Session = Depends(get_db)):
    method_id = req.method_id or _default_method_id(db)
    profile_id = req.embedding_profile_id if req.embedding_profile_id is not None else _default_profile_id(db)
    query_vec = embed_query(req.query)
    tax_map = build_corpus_taxonomy_map(db)
    if _has_span_embeddings(db, method_id, profile_id):
        results = _span_vector_search(
            db, query_vec, method_id, profile_id, req.height_min, req.height_max,
            req.depth_min, req.depth_max, req.corpus_ids, req.corpus_version_ids,
            req.limit, tax_map, offset=req.offset,
        )
        return SearchResponse(results=results, mode="semantic", embedding_profile_id=profile_id)
    results = _vector_search(
        db, query_vec, method_id, req.height_min, req.height_max, req.depth_min, req.depth_max,
        req.corpus_ids, req.corpus_version_ids, req.limit, tax_map, offset=req.offset,
    )
    return SearchResponse(results=results, mode="semantic", embedding_profile_id=None)


@router.post("/keyword", response_model=SearchResponse)
def search_keyword(req: KeywordSearchRequest, db: Session = Depends(get_db)):
    tax_map = build_corpus_taxonomy_map(db)
    if req.corpus_ids is not None and len(req.corpus_ids) == 0:
        return SearchResponse(results=[], mode="keyword")
    if req.corpus_version_ids is not None and len(req.corpus_version_ids) == 0:
        return SearchResponse(results=[], mode="keyword")
    stmt = (
        select(Unit, Corpus.name, CorpusVersion.translation_name)
        .join(Corpus, Corpus.id == Unit.corpus_id)
        .join(CorpusVersion, CorpusVersion.id == Unit.corpus_version_id)
        .where(
            or_(
                Unit.text.ilike(f"%{req.query}%"),
                Unit.reference_label.ilike(f"%{req.query}%"),
                Unit.ancestor_path.ilike(f"%{req.query}%"),
                Corpus.name.ilike(f"%{req.query}%"),
            )
        )
    )
    if req.height_min is not None and req.height_max is not None:
        stmt = stmt.where(Unit.height.between(req.height_min, req.height_max))
    if req.depth_min is not None and req.depth_max is not None:
        stmt = stmt.where(Unit.depth.between(req.depth_min, req.depth_max))
    if req.corpus_ids:
        stmt = stmt.where(Unit.corpus_id.in_(req.corpus_ids))
    if req.corpus_version_ids:
        stmt = stmt.where(Unit.corpus_version_id.in_(req.corpus_version_ids))
    stmt = stmt.offset(req.offset).limit(req.limit)

    rows = db.execute(stmt).all()
    return SearchResponse(
        results=[
            SearchResult(
                id=unit.id,
                result_type="unit",
                text=unit.text,
                reference_label=unit.reference_label,
                ancestor_path=unit.ancestor_path,
                corpus_name=corpus_name,
                corpus_version_name=version_name,
                height=unit.height,
                score=1.0,
                taxonomy=tax_map.get(unit.corpus_id, []),
                embedding_span_id=None,
                embedding_profile_id=None,
                support_unit_ids=[unit.id],
                start_unit_id=unit.id,
                end_unit_id=unit.id,
                primary_unit_id=unit.id,
            )
            for unit, corpus_name, version_name in rows
        ],
        mode="keyword",
    )


@router.post("/passage", response_model=SearchResponse)
def search_passage(req: PassageSearchRequest, db: Session = Depends(get_db)):
    method_id = req.method_id or _default_method_id(db)
    profile_id = req.embedding_profile_id if req.embedding_profile_id is not None else _default_profile_id(db)
    tax_map = build_corpus_taxonomy_map(db)

    vector = _unit_span_vector(db, req.unit_id, method_id, profile_id)
    if vector is None:
        vector = _unit_embedding_vector(db, req.unit_id, method_id)

    if vector is None:
        raise HTTPException(
            status_code=404,
            detail=f"No embedding found for unit {req.unit_id} with method {method_id}",
        )

    exclude_id = req.unit_id if req.exclude_self else None
    if _has_span_embeddings(db, method_id, profile_id):
        results = _span_vector_search(
            db, list(vector), method_id, profile_id, req.height_min, req.height_max,
            req.depth_min, req.depth_max, req.corpus_ids, req.corpus_version_ids,
            req.limit, tax_map, exclude_id, offset=req.offset,
        )
        return SearchResponse(results=results, mode="passage", embedding_profile_id=profile_id)
    results = _vector_search(
        db, list(vector), method_id, req.height_min, req.height_max,
        req.depth_min, req.depth_max, req.corpus_ids, req.corpus_version_ids,
        req.limit, tax_map, exclude_id, offset=req.offset,
    )
    return SearchResponse(results=results, mode="passage", embedding_profile_id=None)
