"""
Shared taxonomy utilities used by multiple routers.
"""
from sqlalchemy.orm import Session
from sqlalchemy import select

from db.models import CorpusToTaxonomy, Taxonomy
from .schemas import TaxonomyLabel


def build_corpus_taxonomy_map(db: Session) -> dict[int, list[TaxonomyLabel]]:
    """
    Two queries: load all taxonomy nodes + all corpus links, then walk parent
    chains in Python. Returns {corpus_id: [TaxonomyLabel sorted by level]}.
    """
    all_tax = {t.id: t for t in db.execute(select(Taxonomy)).scalars().all()}
    links = db.execute(
        select(CorpusToTaxonomy.corpus_id, CorpusToTaxonomy.taxonomy_id)
    ).all()

    result: dict[int, list[TaxonomyLabel]] = {}
    for corpus_id, tax_id in links:
        chain_ids: set[int] = set()
        cur = tax_id
        while cur is not None and cur in all_tax:
            chain_ids.add(cur)
            cur = all_tax[cur].parent_id

        nodes = sorted([all_tax[i] for i in chain_ids], key=lambda t: t.level)
        result[corpus_id] = [
            TaxonomyLabel(id=t.id, name=t.name, level=t.level, parent_id=t.parent_id)
            for t in nodes
        ]

    return result
