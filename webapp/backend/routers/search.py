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
)

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
    height: int,
    corpus_id: int | None,
    limit: int,
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
        .where(Unit.height == height)
    )
    if corpus_id is not None:
        stmt = stmt.where(Unit.corpus_id == corpus_id)
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
        )
        for unit, corpus_name, version_name, distance in rows
    ]


@router.post("/semantic", response_model=SearchResponse)
def search_semantic(req: SemanticSearchRequest, db: Session = Depends(get_db)):
    method_id = req.method_id or _default_method_id(db)
    query_vec = embed_query(req.query)
    results = _vector_search(db, query_vec, method_id, req.height, req.corpus_id, req.limit)
    return SearchResponse(results=results, mode="semantic")


@router.post("/keyword", response_model=SearchResponse)
def search_keyword(req: KeywordSearchRequest, db: Session = Depends(get_db)):
    stmt = (
        select(Unit, Corpus.name, CorpusVersion.translation_name)
        .join(Corpus, Corpus.id == Unit.corpus_id)
        .join(CorpusVersion, CorpusVersion.id == Unit.corpus_version_id)
        .where(Unit.height == req.height)
        .where(
            or_(
                Unit.text.ilike(f"%{req.query}%"),
                Unit.reference_label.ilike(f"%{req.query}%"),
            )
        )
    )
    if req.corpus_id is not None:
        stmt = stmt.where(Unit.corpus_id == req.corpus_id)
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
            )
            for unit, corpus_name, version_name in rows
        ],
        mode="keyword",
    )


@router.post("/passage", response_model=SearchResponse)
def search_passage(req: PassageSearchRequest, db: Session = Depends(get_db)):
    method_id = req.method_id or _default_method_id(db)

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
        db, list(vector), method_id, req.height, req.corpus_id, req.limit, exclude_id
    )
    return SearchResponse(results=results, mode="passage")
