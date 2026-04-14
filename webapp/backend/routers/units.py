import math

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session, aliased
from sqlalchemy import func, or_, select

from db.models import (
    Corpus,
    CorpusVersion,
    Embedding,
    EmbeddingProfile,
    EmbeddingSpan,
    EmbeddingSpanUnit,
    Method,
    SourceRef,
    SpanEmbedding,
    Unit,
)
from ..deps import get_db
from ..schemas import (
    CompareItem,
    CompareRequest,
    CompareResponse,
    TaxonomyLabel,
    UnitBrief,
    UnitChildPreview,
    UnitDetail,
)
from ..taxonomy import build_corpus_taxonomy_map

router = APIRouter(prefix="/api/units")


def _row_to_brief(
    unit: Unit,
    corpus_name: str,
    version_name: str | None,
    taxonomy: list[TaxonomyLabel],
) -> UnitBrief:
    return UnitBrief(
        id=unit.id,
        text=unit.text,
        reference_label=unit.reference_label,
        ancestor_path=unit.ancestor_path,
        corpus_name=corpus_name,
        corpus_version_name=version_name,
        height=unit.height,
        depth=unit.depth,
        taxonomy=taxonomy,
    )


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


def _fetch_unit_brief(db: Session, unit_id: int) -> UnitBrief:
    row = db.execute(
        select(Unit, Corpus.name, CorpusVersion.translation_name)
        .join(Corpus, Corpus.id == Unit.corpus_id)
        .join(CorpusVersion, CorpusVersion.id == Unit.corpus_version_id)
        .where(Unit.id == unit_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")
    unit, corpus_name, version_name = row
    tax_map = build_corpus_taxonomy_map(db)
    return _row_to_brief(unit, corpus_name, version_name, tax_map.get(unit.corpus_id, []))


def _normalize_vector(values: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in values))
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
    return _normalize_vector([value / weight_sum for value in totals])


def _fetch_span_embedding(db: Session, unit_id: int, method_id: int, profile_id: int | None) -> list[float] | None:
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


def _fetch_embedding(db: Session, unit_id: int, method_id: int, profile_id: int | None = None):
    span_vector = _fetch_span_embedding(db, unit_id, method_id, profile_id)
    if span_vector is not None:
        return span_vector

    vector = db.execute(
        select(Embedding.vector)
        .where(Embedding.unit_id == unit_id)
        .where(Embedding.method_id == method_id)
    ).scalar_one_or_none()
    if vector is None:
        raise HTTPException(
            status_code=404,
            detail=f"No embedding found for unit {unit_id} with method {method_id}",
        )
    return vector


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


@router.get("/search", response_model=list[UnitBrief])
def search_units(
    q: str = Query(..., min_length=1),
    height: int | None = Query(None),   # None = search all heights
    corpus_id: list[int] = Query(default=[]),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    """Passage picker autocomplete — fuzzy match on reference_label, text, and corpus name."""
    tax_map = build_corpus_taxonomy_map(db)
    stmt = (
        select(Unit, Corpus.name, CorpusVersion.translation_name)
        .join(Corpus, Corpus.id == Unit.corpus_id)
        .join(CorpusVersion, CorpusVersion.id == Unit.corpus_version_id)
        .where(
            or_(
                Unit.reference_label.ilike(f"%{q}%"),
                Unit.text.ilike(f"%{q}%"),
                Unit.ancestor_path.ilike(f"%{q}%"),
                Corpus.name.ilike(f"%{q}%"),
            )
        )
    )
    if height is not None:
        stmt = stmt.where(Unit.height == height)
    if corpus_id:
        stmt = stmt.where(Unit.corpus_id.in_(corpus_id))
    stmt = stmt.order_by(Unit.depth, Unit.id).limit(limit)

    rows = db.execute(stmt).all()
    return [
        _row_to_brief(unit, corpus_name, version_name, tax_map.get(unit.corpus_id, []))
        for unit, corpus_name, version_name in rows
    ]


@router.get("/{unit_id}/children", response_model=list[UnitChildPreview])
def get_unit_children(
    unit_id: int,
    limit: int | None = Query(None, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Direct children of a unit, each with its first child and child count for preview."""
    tax_map = build_corpus_taxonomy_map(db)

    stmt = (
        select(Unit, Corpus.name, CorpusVersion.translation_name)
        .join(Corpus, Corpus.id == Unit.corpus_id)
        .join(CorpusVersion, CorpusVersion.id == Unit.corpus_version_id)
        .where(Unit.parent_id == unit_id)
        .order_by(Unit.depth, Unit.id)
        .offset(offset)
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    child_rows = db.execute(stmt).all()

    if not child_rows:
        return []

    child_ids = [row[0].id for row in child_rows]

    # First grandchild per child (min id)
    first_gc_subq = (
        select(Unit.parent_id, func.min(Unit.id).label("first_id"))
        .where(Unit.parent_id.in_(child_ids))
        .group_by(Unit.parent_id)
        .subquery()
    )
    first_gc_rows = db.execute(
        select(Unit, Corpus.name, CorpusVersion.translation_name)
        .join(Corpus, Corpus.id == Unit.corpus_id)
        .join(CorpusVersion, CorpusVersion.id == Unit.corpus_version_id)
        .join(first_gc_subq, first_gc_subq.c.first_id == Unit.id)
    ).all()
    first_gc_map: dict[int, UnitBrief] = {
        unit.parent_id: _row_to_brief(unit, cn, vn, tax_map.get(unit.corpus_id, []))
        for unit, cn, vn in first_gc_rows
    }

    # Grandchild counts per child
    gc_counts: dict[int, int] = dict(
        db.execute(
            select(Unit.parent_id, func.count(Unit.id))
            .where(Unit.parent_id.in_(child_ids))
            .group_by(Unit.parent_id)
        ).all()
    )

    return [
        UnitChildPreview(
            **_row_to_brief(unit, cn, vn, tax_map.get(unit.corpus_id, [])).model_dump(),
            first_child=first_gc_map.get(unit.id),
            child_count=gc_counts.get(unit.id, 0),
        )
        for unit, cn, vn in child_rows
    ]


@router.get("/{unit_id}", response_model=UnitBrief)
def get_unit(unit_id: int, db: Session = Depends(get_db)):
    return _fetch_unit_brief(db, unit_id)


@router.get("/{unit_id}/ancestors", response_model=list[UnitBrief])
def get_unit_ancestors(unit_id: int, db: Session = Depends(get_db)):
    """
    Ancestor chain from root -> ... -> self for breadcrumb navigation.
    """
    tax_map = build_corpus_taxonomy_map(db)
    chain: list[UnitBrief] = []
    seen: set[int] = set()
    current_id: int | None = unit_id

    while current_id is not None:
        if current_id in seen:
            # Defensive break in case of accidental cycle in source data.
            break
        seen.add(current_id)

        row = db.execute(
            select(Unit, Corpus.name, CorpusVersion.translation_name)
            .join(Corpus, Corpus.id == Unit.corpus_id)
            .join(CorpusVersion, CorpusVersion.id == Unit.corpus_version_id)
            .where(Unit.id == current_id)
        ).first()
        if row is None:
            if not chain:
                raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")
            break

        unit, corpus_name, version_name = row
        chain.append(_row_to_brief(unit, corpus_name, version_name, tax_map.get(unit.corpus_id, [])))
        current_id = unit.parent_id

    chain.reverse()
    return chain


@router.get("/{unit_id}/leaves", response_model=list[UnitBrief])
def get_unit_leaves(
    unit_id: int,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    Leaf descendants (height=0) of a unit. If unit_id is itself a leaf, returns it.
    Ordered by id for stable paging.
    """
    root = db.execute(
        select(Unit.id).where(Unit.id == unit_id)
    ).scalar_one_or_none()
    if root is None:
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")

    tax_map = build_corpus_taxonomy_map(db)

    descendants = select(Unit.id.label("id")).where(Unit.id == unit_id).cte(name="descendants", recursive=True)
    child = aliased(Unit)
    descendants = descendants.union_all(
        select(child.id).where(child.parent_id == descendants.c.id)
    )

    rows = db.execute(
        select(Unit, Corpus.name, CorpusVersion.translation_name)
        .join(Corpus, Corpus.id == Unit.corpus_id)
        .join(CorpusVersion, CorpusVersion.id == Unit.corpus_version_id)
        .where(Unit.id.in_(select(descendants.c.id)))
        .where(Unit.height == 0)
        .order_by(Unit.id)
        .offset(offset)
        .limit(limit)
    ).all()

    return [
        _row_to_brief(unit, corpus_name, version_name, tax_map.get(unit.corpus_id, []))
        for unit, corpus_name, version_name in rows
    ]


@router.get("/{unit_id}/detail", response_model=UnitDetail)
def get_unit_detail(unit_id: int, db: Session = Depends(get_db)):
    row = db.execute(
        select(Unit, Corpus.name, CorpusVersion.translation_name, SourceRef.url)
        .join(Corpus, Corpus.id == Unit.corpus_id)
        .join(CorpusVersion, CorpusVersion.id == Unit.corpus_version_id)
        .outerjoin(SourceRef, SourceRef.id == CorpusVersion.source_id)
        .where(Unit.id == unit_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Unit {unit_id} not found")

    unit, corpus_name, version_name, version_source = row
    tax_map = build_corpus_taxonomy_map(db)
    return UnitDetail(
        id=unit.id,
        reference_label=unit.reference_label,
        ancestor_path=unit.ancestor_path,
        corpus_name=corpus_name,
        corpus_version_name=version_name,
        corpus_version_id=unit.corpus_version_id,
        height=unit.height,
        depth=unit.depth,
        taxonomy=tax_map.get(unit.corpus_id, []),
        cleaned_text=unit.text,
        original_text=unit.uncleaned_text,
        unit_source=None,
        version_source=version_source,
    )


@router.post("/compare", response_model=CompareResponse)
def compare_units(req: CompareRequest, db: Session = Depends(get_db)):
    method_id = req.method_id or _default_method_id(db)
    profile_id = req.embedding_profile_id if req.embedding_profile_id is not None else _default_profile_id(db)
    reference_unit = _fetch_unit_brief(db, req.reference_unit_id)
    reference_vector = list(_fetch_embedding(db, req.reference_unit_id, method_id, profile_id))

    if not req.unit_ids:
        return CompareResponse(reference_unit=reference_unit, method_id=method_id, embedding_profile_id=profile_id, items=[])

    tax_map = build_corpus_taxonomy_map(db)
    unit_rows = db.execute(
        select(Unit, Corpus.name, CorpusVersion.translation_name)
        .join(Corpus, Corpus.id == Unit.corpus_id)
        .join(CorpusVersion, CorpusVersion.id == Unit.corpus_version_id)
        .where(Unit.id.in_(req.unit_ids))
    ).all()

    unit_map = {
        unit.id: (
            _row_to_brief(unit, corpus_name, version_name, tax_map.get(unit.corpus_id, [])),
            _fetch_span_embedding(db, unit.id, method_id, profile_id),
        )
        for unit, corpus_name, version_name in unit_rows
    }

    missing_span_ids = [unit_id for unit_id, (_, vector) in unit_map.items() if vector is None]
    if missing_span_ids:
        rows = db.execute(
            select(Unit, Corpus.name, CorpusVersion.translation_name, Embedding.vector)
            .join(Embedding, Embedding.unit_id == Unit.id)
            .join(Corpus, Corpus.id == Unit.corpus_id)
            .join(CorpusVersion, CorpusVersion.id == Unit.corpus_version_id)
            .where(Embedding.method_id == method_id)
            .where(Unit.id.in_(missing_span_ids))
        ).all()
        for unit, corpus_name, version_name, vector in rows:
            unit_map[unit.id] = (
                _row_to_brief(unit, corpus_name, version_name, tax_map.get(unit.corpus_id, [])),
                list(vector),
            )

    typed_unit_map = {
        unit_id: (unit, vector)
        for unit_id, (unit, vector) in unit_map.items()
        if vector is not None
    }

    items: list[CompareItem] = []
    for unit_id in req.unit_ids:
        entry = typed_unit_map.get(unit_id)
        if entry is None:
            continue
        unit, vector = entry
        similarity = _cosine_similarity(reference_vector, list(vector))
        distance = 1.0 - similarity
        items.append(
            CompareItem(
                unit=unit,
                cosine_similarity=round(similarity, 6),
                cosine_distance=round(distance, 6),
            )
        )

    return CompareResponse(reference_unit=reference_unit, method_id=method_id, embedding_profile_id=profile_id, items=items)
