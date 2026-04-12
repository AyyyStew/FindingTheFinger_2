from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select

from db.models import Corpus, CorpusLevel, CorpusVersion, CorpusToTaxonomy, Taxonomy, Method, Unit
from ..deps import get_db
from ..schemas import (
    CorpusInfo,
    CorpusLevelInfo,
    CorpusVersionInfo,
    MethodInfo,
    TaxonomyLabel,
    UnitBrief,
)

router = APIRouter(prefix="/api")


def _full_taxonomy_chain(db: Session, corpus_id: int) -> list[TaxonomyLabel]:
    """
    Fetch the taxonomy nodes directly linked to this corpus, then walk up
    parent_id chains until we hit root nodes (parent_id IS NULL).
    Returns all nodes in the ancestor chain, deduplicated, ordered by level.
    """
    # Step 1: directly linked nodes
    direct = db.execute(
        select(Taxonomy)
        .join(CorpusToTaxonomy, CorpusToTaxonomy.taxonomy_id == Taxonomy.id)
        .where(CorpusToTaxonomy.corpus_id == corpus_id)
    ).scalars().all()

    collected: dict[int, Taxonomy] = {t.id: t for t in direct}

    # Step 2: iteratively fetch parents until no new ones
    to_fetch = {t.parent_id for t in direct if t.parent_id is not None} - collected.keys()
    while to_fetch:
        parents = db.execute(
            select(Taxonomy).where(Taxonomy.id.in_(to_fetch))
        ).scalars().all()
        for p in parents:
            collected[p.id] = p
        to_fetch = {p.parent_id for p in parents if p.parent_id is not None} - collected.keys()

    return [
        TaxonomyLabel(id=t.id, name=t.name, level=t.level, parent_id=t.parent_id)
        for t in sorted(collected.values(), key=lambda t: t.level)
    ]


@router.get("/corpora", response_model=list[CorpusInfo])
def list_corpora(db: Session = Depends(get_db)):
    corpora = db.execute(select(Corpus)).scalars().all()
    result = []
    for corpus in corpora:
        versions = db.execute(
            select(CorpusVersion).where(CorpusVersion.corpus_id == corpus.id)
        ).scalars().all()

        taxonomy = _full_taxonomy_chain(db, corpus.id)

        level_rows = db.execute(
            select(CorpusLevel)
            .where(CorpusLevel.corpus_id == corpus.id)
            .order_by(CorpusLevel.height)
        ).scalars().all()

        result.append(CorpusInfo(
            id=corpus.id,
            name=corpus.name,
            description=corpus.description,
            taxonomy=taxonomy,
            levels=[
                CorpusLevelInfo(height=l.height, name=l.name)
                for l in level_rows
            ],
            versions=[
                CorpusVersionInfo(
                    id=v.id,
                    translation_name=v.translation_name,
                    language=v.language,
                )
                for v in versions
            ],
        ))
    return result


@router.get("/methods", response_model=list[MethodInfo])
def list_methods(db: Session = Depends(get_db)):
    methods = db.execute(select(Method)).scalars().all()
    return [
        MethodInfo(
            id=m.id,
            model_name=m.model_name,
            label=m.label,
            description=m.description,
            vector_dim=m.vector_dim,
        )
        for m in methods
    ]


@router.get("/corpora/{corpus_id}/roots", response_model=list[UnitBrief])
def corpus_roots(
    corpus_id: int,
    corpus_version_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    corpus = db.execute(
        select(Corpus).where(Corpus.id == corpus_id)
    ).scalar_one_or_none()
    if corpus is None:
        raise HTTPException(status_code=404, detail=f"Corpus {corpus_id} not found")

    version_stmt = (
        select(CorpusVersion)
        .where(CorpusVersion.corpus_id == corpus_id)
        .order_by(CorpusVersion.id)
    )
    versions = db.execute(version_stmt).scalars().all()
    if not versions:
        return []

    version_id = corpus_version_id or versions[0].id
    version_map = {v.id: v for v in versions}
    if version_id not in version_map:
        raise HTTPException(
            status_code=404,
            detail=f"Corpus version {version_id} not found for corpus {corpus_id}",
        )

    version = version_map[version_id]
    taxonomy = _full_taxonomy_chain(db, corpus_id)
    roots = db.execute(
        select(Unit)
        .where(Unit.corpus_id == corpus_id)
        .where(Unit.corpus_version_id == version_id)
        .where(Unit.parent_id.is_(None))
        .order_by(Unit.depth, Unit.id)
    ).scalars().all()

    return [
        UnitBrief(
            id=u.id,
            text=u.text,
            reference_label=u.reference_label,
            ancestor_path=u.ancestor_path,
            corpus_name=corpus.name,
            corpus_version_name=version.translation_name,
            height=u.height,
            depth=u.depth,
            taxonomy=taxonomy,
        )
        for u in roots
    ]
