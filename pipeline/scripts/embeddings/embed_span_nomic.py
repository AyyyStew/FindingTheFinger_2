#!/usr/bin/env python3
"""
Embed normalized embedding spans with nomic-ai/nomic-embed-text-v1.5.

Usage:
  python -m pipeline.scripts.embeddings.embed_span_nomic --dry-run
  python -m pipeline.scripts.embeddings.embed_span_nomic --profile window-200 --batch-size 64
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

sys.path.insert(0, "/home/alexs/Projects/WebProjects/FindingTheFinger_2")
from db.models import Corpus, EmbeddingProfile, EmbeddingSpan, Method, SpanEmbedding  # noqa: E402
from db.session import get_session  # noqa: E402
from pipeline.scripts.embeddings.utils import embed_items_adaptive, select_device  # noqa: E402


MODEL_NAME = "nomic-ai/nomic-embed-text-v1.5"
VECTOR_DIM = 768
METHOD_LABEL = "nomic-embed-text-v1.5/span-windows"
METHOD_DESCRIPTION = (
    "nomic-embed-text-v1.5 embeddings for normalized embedding_span windows. "
    "The span profiles window-50, window-100, window-200, window-500, and "
    "window-1000 are built separately and preserve mappings back to canonical units."
)
TASK_PREFIX = "search_document: "


def get_or_create_method(session: Session) -> Method:
    method = session.execute(
        select(Method).where(Method.model_name == MODEL_NAME, Method.label == METHOD_LABEL)
    ).scalar_one_or_none()
    if method is None:
        method = Method(
            model_name=MODEL_NAME,
            label=METHOD_LABEL,
            description=METHOD_DESCRIPTION,
            vector_dim=VECTOR_DIM,
        )
        session.add(method)
        session.flush()
    return method


def resolve_corpus_id(session: Session, name: str | None) -> int | None:
    if name is None:
        return None
    corpus = session.execute(select(Corpus).where(Corpus.name == name)).scalar_one_or_none()
    if corpus is None:
        raise SystemExit(f"Corpus '{name}' not found.")
    return corpus.id


def resolve_profile_ids(session: Session, labels: list[str]) -> list[int]:
    stmt = select(EmbeddingProfile).order_by(EmbeddingProfile.target_tokens)
    if labels:
        stmt = stmt.where(EmbeddingProfile.label.in_(labels))
    profiles = list(session.execute(stmt).scalars())
    if labels and len(profiles) != len(set(labels)):
        found = {p.label for p in profiles}
        missing = sorted(set(labels) - found)
        raise SystemExit(f"Embedding profile(s) not found: {', '.join(missing)}")
    if not profiles:
        raise SystemExit("No embedding profiles found. Run build_embedding_spans.py first.")
    return [p.id for p in profiles]


def load_todo(
    session: Session,
    method_id: int,
    profile_ids: list[int],
    corpus_id: int | None,
    limit: int | None,
) -> list[tuple[int, str]]:
    stmt = (
        select(EmbeddingSpan.id, EmbeddingSpan.text)
        .where(EmbeddingSpan.profile_id.in_(profile_ids))
        .where(
            ~select(SpanEmbedding.id)
            .where(SpanEmbedding.embedding_span_id == EmbeddingSpan.id)
            .where(SpanEmbedding.method_id == method_id)
            .exists()
        )
        .order_by(EmbeddingSpan.token_count.desc(), EmbeddingSpan.id)
    )
    if corpus_id is not None:
        stmt = stmt.where(EmbeddingSpan.corpus_id == corpus_id)
    if limit is not None:
        stmt = stmt.limit(limit)
    return [(span_id, TASK_PREFIX + text) for span_id, text in session.execute(stmt)]


def embed_spans(
    session: Session,
    method: Method,
    items: list[tuple[int, str]],
    batch_size: int,
    dry_run: bool,
    device: str,
) -> None:
    def add_span_embedding(session: Session, span_id: int, vec) -> None:
        session.add(SpanEmbedding(embedding_span_id=span_id, method_id=method.id, vector=vec.tolist()))

    embed_items_adaptive(
        session=session,
        items=items,
        model_name=MODEL_NAME,
        batch_size=batch_size,
        dry_run=dry_run,
        device=device,
        description="Spans",
        add_embedding=add_span_embedding,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Embed normalized spans with nomic-embed-text-v1.5")
    parser.add_argument("--profile", action="append", default=[], help="Profile label, repeatable")
    parser.add_argument("--corpus", type=str, default=None, help="Filter to one corpus by name")
    parser.add_argument("--limit", type=int, default=None, help="Limit spans for smoke tests")
    parser.add_argument("--dry-run", action="store_true", help="Count spans, skip model loading and DB writes")
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--device", type=str, default=None, help="Device for inference: cuda, cpu, mps")
    args = parser.parse_args()

    with get_session() as session:
        corpus_id = resolve_corpus_id(session, args.corpus)
        profile_ids = resolve_profile_ids(session, args.profile)
        method = get_or_create_method(session)
        items = load_todo(session, method.id, profile_ids, corpus_id, args.limit)

        device = select_device(args.device)
        print(f"Device: {device}", file=sys.stderr)
        embed_spans(session, method, items, args.batch_size, args.dry_run, device)


if __name__ == "__main__":
    main()
