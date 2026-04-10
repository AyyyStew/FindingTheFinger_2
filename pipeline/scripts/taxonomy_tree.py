#!/usr/bin/env python3
"""
utils/taxonomy_tree.py

Prints the taxonomy tree from the database, with corpus links shown
as leaves under each node.

Usage:
    .venv/bin/python3 utils/taxonomy_tree.py
"""

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import joinedload

from pipeline.db.session import get_session
from pipeline.db.models import Corpus, CorpusToTaxonomy, Taxonomy


def main() -> None:
    with get_session() as session:
        nodes = session.execute(
            select(Taxonomy).order_by(Taxonomy.level, Taxonomy.name)
        ).scalars().all()

        links = session.execute(
            select(CorpusToTaxonomy).options(joinedload(CorpusToTaxonomy.corpus))
        ).scalars().all()

    # Build children map
    children: dict[int | None, list[Taxonomy]] = defaultdict(list)
    for node in nodes:
        children[node.parent_id].append(node)

    # Build corpus map: taxonomy_id → [corpus names]
    corpora: dict[int, list[str]] = defaultdict(list)
    for link in links:
        corpora[link.taxonomy_id].append(link.corpus.name)

    total_nodes   = len(nodes)
    total_corpora = sum(len(v) for v in corpora.values())

    print(f"\n{'='*56}")
    print(f"  FtF Taxonomy Tree  ({total_nodes} nodes, {total_corpora} corpus links)")
    print(f"{'='*56}\n")

    def _print(node_id: int | None, prefix: str = "", last: bool = True) -> None:
        kids = sorted(children.get(node_id, []), key=lambda n: n.name)
        for i, node in enumerate(kids):
            is_last   = i == len(kids) - 1
            connector = "└── " if is_last else "├── "
            print(f"{prefix}{connector}{node.name}")

            child_prefix = prefix + ("    " if is_last else "│   ")

            # Corpus links as leaves
            linked = sorted(corpora.get(node.id, []))
            for j, corpus_name in enumerate(linked):
                c_last = is_last  # whether our branch continues
                leaf_conn = "└── " if j == len(linked) - 1 and not children.get(node.id) else "├── "
                print(f"{child_prefix}{leaf_conn}* {corpus_name}")

            _print(node.id, child_prefix, is_last)

    _print(None)
    print(f"\n{'='*56}\n")


if __name__ == "__main__":
    main()
