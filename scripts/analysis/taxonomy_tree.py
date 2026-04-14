"""
Print the full taxonomy tree from the database.

Usage:
  uv run python -m scripts.taxonomy_tree
  uv run python -m scripts.taxonomy_tree --no-corpora
  uv run python -m scripts.taxonomy_tree --format json
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from db.models import Corpus, CorpusToTaxonomy, Taxonomy
from db.session import get_session


@dataclass
class TaxonomyNode:
    id: int
    parent_id: int | None
    name: str
    level: int
    extra_metadata: dict[str, Any] | None
    corpora: list[dict[str, Any]] = field(default_factory=list)
    children: list["TaxonomyNode"] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "parent_id": self.parent_id,
            "name": self.name,
            "level": self.level,
            "extra_metadata": self.extra_metadata,
            "corpora": self.corpora,
            "children": [child.to_dict() for child in self.children],
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Print the full taxonomy tree from the database.")
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Output format (default: text).",
    )
    parser.add_argument(
        "--no-corpora",
        action="store_true",
        help="Only print taxonomy nodes; omit corpora attached to each node.",
    )
    parser.add_argument(
        "--show-metadata",
        action="store_true",
        help="Include taxonomy extra_metadata in text output. JSON always includes it.",
    )
    return parser.parse_args()


def load_taxonomy_tree(include_corpora: bool) -> list[TaxonomyNode]:
    with get_session() as session:
        taxonomy_rows = session.execute(
            select(Taxonomy).order_by(Taxonomy.level, Taxonomy.name, Taxonomy.id)
        ).scalars().all()

        nodes = {
            row.id: TaxonomyNode(
                id=row.id,
                parent_id=row.parent_id,
                name=row.name,
                level=row.level,
                extra_metadata=row.extra_metadata,
            )
            for row in taxonomy_rows
        }

        if include_corpora:
            corpus_rows = session.execute(
                select(
                    CorpusToTaxonomy.taxonomy_id,
                    Corpus.id,
                    Corpus.name,
                    Corpus.language_of_origin,
                )
                .join(Corpus, Corpus.id == CorpusToTaxonomy.corpus_id)
                .order_by(Corpus.name, Corpus.id)
            ).all()

            for taxonomy_id, corpus_id, name, language_of_origin in corpus_rows:
                node = nodes.get(taxonomy_id)
                if node is None:
                    continue
                node.corpora.append(
                    {
                        "id": corpus_id,
                        "name": name,
                        "language_of_origin": language_of_origin,
                    }
                )

    roots: list[TaxonomyNode] = []
    orphans: list[TaxonomyNode] = []
    children_by_parent: dict[int | None, list[TaxonomyNode]] = defaultdict(list)

    for node in nodes.values():
        children_by_parent[node.parent_id].append(node)

    def sort_key(node: TaxonomyNode) -> tuple[int, str, int]:
        return (node.level, node.name.casefold(), node.id)

    def attach_children(node: TaxonomyNode) -> None:
        node.children = sorted(children_by_parent.get(node.id, []), key=sort_key)
        for child in node.children:
            attach_children(child)

    for node in sorted(children_by_parent.get(None, []), key=sort_key):
        attach_children(node)
        roots.append(node)

    for node in sorted(nodes.values(), key=sort_key):
        if node.parent_id is not None and node.parent_id not in nodes:
            attach_children(node)
            orphans.append(node)

    return roots + orphans


def format_tree(roots: list[TaxonomyNode], show_metadata: bool) -> str:
    lines: list[str] = []

    def walk(node: TaxonomyNode, prefix: str, is_last: bool) -> None:
        connector = "`-- " if is_last else "|-- "
        metadata = ""
        if show_metadata and node.extra_metadata:
            metadata = f" metadata={json.dumps(node.extra_metadata, sort_keys=True)}"
        lines.append(f"{prefix}{connector}{node.name} [id={node.id}, level={node.level}]{metadata}")

        child_prefix = prefix + ("    " if is_last else "|   ")
        for index, child in enumerate(node.children):
            child_is_last = not node.corpora and index == len(node.children) - 1
            walk(child, child_prefix, child_is_last)

        for index, corpus in enumerate(node.corpora):
            corpus_is_last = index == len(node.corpora) - 1
            corpus_connector = "`-- " if corpus_is_last else "|-- "
            language = corpus.get("language_of_origin") or "unknown origin"
            lines.append(
                f"{child_prefix}{corpus_connector}{corpus['name']} "
                f"[corpus_id={corpus['id']}, origin={language}]"
            )

    for index, root in enumerate(roots):
        walk(root, "", index == len(roots) - 1)

    return "\n".join(lines)


def main() -> None:
    args = parse_args()

    try:
        roots = load_taxonomy_tree(include_corpora=not args.no_corpora)
    except OperationalError as exc:
        raise SystemExit(
            "Could not connect to the database. Check DATABASE_URL and make sure the database is running.\n"
            f"Original error: {exc}"
        ) from exc

    if args.format == "json":
        print(json.dumps([root.to_dict() for root in roots], indent=2, sort_keys=True))
        return

    if not roots:
        print("No taxonomy rows found.")
        return

    print(format_tree(roots, show_metadata=args.show_metadata))


if __name__ == "__main__":
    main()
