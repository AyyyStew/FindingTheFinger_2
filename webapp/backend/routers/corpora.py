from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select

from db.models import Corpus, CorpusVersion, CorpusToTaxonomy, Taxonomy, Method
from ..deps import get_db
from ..schemas import CorpusInfo, CorpusVersionInfo, MethodInfo

router = APIRouter(prefix="/api")


@router.get("/corpora", response_model=list[CorpusInfo])
def list_corpora(db: Session = Depends(get_db)):
    corpora = db.execute(select(Corpus)).scalars().all()
    result = []
    for corpus in corpora:
        versions = db.execute(
            select(CorpusVersion).where(CorpusVersion.corpus_id == corpus.id)
        ).scalars().all()

        taxonomy_names = db.execute(
            select(Taxonomy.name)
            .join(CorpusToTaxonomy, CorpusToTaxonomy.taxonomy_id == Taxonomy.id)
            .where(CorpusToTaxonomy.corpus_id == corpus.id)
        ).scalars().all()

        result.append(CorpusInfo(
            id=corpus.id,
            name=corpus.name,
            description=corpus.description,
            taxonomy=list(taxonomy_names),
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
