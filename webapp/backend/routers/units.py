from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, select

from db.models import Corpus, CorpusVersion, Unit
from ..deps import get_db
from ..schemas import UnitBrief

router = APIRouter(prefix="/api/units")


def _row_to_brief(unit: Unit, corpus_name: str, version_name: str | None) -> UnitBrief:
    return UnitBrief(
        id=unit.id,
        text=unit.text,
        reference_label=unit.reference_label,
        ancestor_path=unit.ancestor_path,
        corpus_name=corpus_name,
        corpus_version_name=version_name,
        height=unit.height,
        depth=unit.depth,
    )


@router.get("/search", response_model=list[UnitBrief])
def search_units(
    q: str = Query(..., min_length=1),
    height: int = Query(0),
    corpus_id: int | None = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    """Passage picker autocomplete — fuzzy match on reference_label and text."""
    stmt = (
        select(Unit, Corpus.name, CorpusVersion.translation_name)
        .join(Corpus, Corpus.id == Unit.corpus_id)
        .join(CorpusVersion, CorpusVersion.id == Unit.corpus_version_id)
        .where(Unit.height == height)
        .where(
            or_(
                Unit.reference_label.ilike(f"%{q}%"),
                Unit.text.ilike(f"%{q}%"),
            )
        )
    )
    if corpus_id is not None:
        stmt = stmt.where(Unit.corpus_id == corpus_id)
    stmt = stmt.limit(limit)

    rows = db.execute(stmt).all()
    return [_row_to_brief(unit, corpus_name, version_name) for unit, corpus_name, version_name in rows]


@router.get("/{unit_id}", response_model=UnitBrief)
def get_unit(unit_id: int, db: Session = Depends(get_db)):
    row = db.execute(
        select(Unit, Corpus.name, CorpusVersion.translation_name)
        .join(Corpus, Corpus.id == Unit.corpus_id)
        .join(CorpusVersion, CorpusVersion.id == Unit.corpus_version_id)
        .where(Unit.id == unit_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    unit, corpus_name, version_name = row
    return _row_to_brief(unit, corpus_name, version_name)
