from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, select

from db.models import Corpus, CorpusVersion, Embedding, Method, Unit
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
    method = db.execute(select(Method)).scalars().first()
    if method is None:
        raise HTTPException(status_code=503, detail="No embedding methods in database")
    return method.id



def _vector_search(
    db: Session,
    query_vec: list[float],
    method_id: int,
    height_min: int,
    height_max: int,
    corpus_ids: list[int] | None,
    limit: int,
    tax_map: dict[int, list[TaxonomyLabel]],
    exclude_unit_id: int | None = None,
) -> list[SearchResult]:
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
        .where(Unit.height.between(height_min, height_max))
    )
    if corpus_ids:
        stmt = stmt.where(Unit.corpus_id.in_(corpus_ids))
    if exclude_unit_id is not None:
        stmt = stmt.where(Unit.id != exclude_unit_id)
    stmt = stmt.order_by("distance").limit(limit)

    rows = db.execute(stmt).all()
    return [
        SearchResult(
            id=unit.id,
            text=unit.text,
            reference_label=unit.reference_label,
            ancestor_path=unit.ancestor_path,
            corpus_name=corpus_name,
            corpus_version_name=version_name,
            height=unit.height,
            score=round(1.0 - float(distance), 4),
            taxonomy=tax_map.get(unit.corpus_id, []),
        )
        for unit, corpus_name, version_name, distance in rows
    ]


@router.post("/semantic", response_model=SearchResponse)
def search_semantic(req: SemanticSearchRequest, db: Session = Depends(get_db)):
    method_id = req.method_id or _default_method_id(db)
    query_vec = embed_query(req.query)
    tax_map = build_corpus_taxonomy_map(db)
    results = _vector_search(
        db, query_vec, method_id, req.height_min, req.height_max, req.corpus_ids, req.limit, tax_map
    )
    return SearchResponse(results=results, mode="semantic")


@router.post("/keyword", response_model=SearchResponse)
def search_keyword(req: KeywordSearchRequest, db: Session = Depends(get_db)):
    tax_map = build_corpus_taxonomy_map(db)
    stmt = (
        select(Unit, Corpus.name, CorpusVersion.translation_name)
        .join(Corpus, Corpus.id == Unit.corpus_id)
        .join(CorpusVersion, CorpusVersion.id == Unit.corpus_version_id)
        .where(Unit.text.isnot(None))
        .where(
            or_(
                Unit.text.ilike(f"%{req.query}%"),
                Unit.reference_label.ilike(f"%{req.query}%"),
            )
        )
    )
    if req.corpus_ids:
        stmt = stmt.where(Unit.corpus_id.in_(req.corpus_ids))
    stmt = stmt.limit(req.limit)

    rows = db.execute(stmt).all()
    return SearchResponse(
        results=[
            SearchResult(
                id=unit.id,
                text=unit.text,
                reference_label=unit.reference_label,
                ancestor_path=unit.ancestor_path,
                corpus_name=corpus_name,
                corpus_version_name=version_name,
                height=unit.height,
                score=1.0,
                taxonomy=tax_map.get(unit.corpus_id, []),
            )
            for unit, corpus_name, version_name in rows
        ],
        mode="keyword",
    )


@router.post("/passage", response_model=SearchResponse)
def search_passage(req: PassageSearchRequest, db: Session = Depends(get_db)):
    method_id = req.method_id or _default_method_id(db)
    tax_map = build_corpus_taxonomy_map(db)

    vector = db.execute(
        select(Embedding.vector)
        .where(Embedding.unit_id == req.unit_id)
        .where(Embedding.method_id == method_id)
    ).scalar_one_or_none()

    if vector is None:
        raise HTTPException(
            status_code=404,
            detail=f"No embedding found for unit {req.unit_id} with method {method_id}",
        )

    exclude_id = req.unit_id if req.exclude_self else None
    results = _vector_search(
        db, list(vector), method_id, req.height_min, req.height_max,
        req.corpus_ids, req.limit, tax_map, exclude_id
    )
    return SearchResponse(results=results, mode="passage")
