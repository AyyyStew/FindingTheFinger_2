#!/usr/bin/env python3
"""
Build normalized multi-scale embedding spans from canonical leaf units.

The span layer is deliberately separate from the unit tree:
  - tiny adjacent leaf units are aggregated up to the target token window
  - large leaf units are split into overlapping windows
  - every span is mapped back to the unit(s) it covers

Usage:
  python -m pipeline.scripts.embeddings.build_embedding_spans --dry-run
  python -m pipeline.scripts.embeddings.build_embedding_spans --replace
  python -m pipeline.scripts.embeddings.build_embedding_spans --profile window-200
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from typing import Iterable

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

sys.path.insert(0, "/home/alexs/Projects/WebProjects/FindingTheFinger_2")
from db.models import (  # noqa: E402
    Corpus,
    EmbeddingProfile,
    EmbeddingSpan,
    EmbeddingSpanUnit,
    SpanEmbedding,
    Unit,
)
from db.session import get_session  # noqa: E402


MODEL_NAME = "nomic-ai/nomic-embed-text-v1.5"
PROFILE_SPECS = {
    "window-50": {"target_tokens": 50, "overlap_tokens": 10, "min_tokens": 25, "max_tokens": 80},
    "window-100": {"target_tokens": 100, "overlap_tokens": 20, "min_tokens": 50, "max_tokens": 150},
    "window-200": {"target_tokens": 200, "overlap_tokens": 40, "min_tokens": 100, "max_tokens": 300},
    "window-500": {"target_tokens": 500, "overlap_tokens": 100, "min_tokens": 250, "max_tokens": 750},
    "window-1000": {"target_tokens": 1000, "overlap_tokens": 200, "min_tokens": 500, "max_tokens": 1500},
}

WORD_RE = re.compile(r"\S+")
SENTENCE_END_RE = re.compile(r"[.!?;:]['\")\]]*$")


@dataclass(frozen=True)
class LeafText:
    unit_id: int
    corpus_id: int
    corpus_version_id: int
    parent_id: int | None
    text: str
    reference_label: str | None
    ancestor_path: str | None
    word_spans: tuple[tuple[int, int], ...]

    @property
    def word_count(self) -> int:
        return len(self.word_spans)


@dataclass(frozen=True)
class SpanDraft:
    corpus_id: int
    corpus_version_id: int
    text: str
    token_count: int
    word_count: int
    char_count: int
    start_unit_id: int
    end_unit_id: int
    start_char_offset: int | None
    end_char_offset: int | None
    reference_label: str | None
    ancestor_path: str | None
    unit_links: tuple[tuple[int, int, int | None, int | None, float], ...]
    metadata: dict


def _word_spans(text: str) -> tuple[tuple[int, int], ...]:
    return tuple((m.start(), m.end()) for m in WORD_RE.finditer(text))


def _safe_text(text: str | None) -> str:
    return " ".join((text or "").split())


def _load_leaves(session: Session, corpus_id: int | None) -> list[LeafText]:
    stmt = (
        select(
            Unit.id,
            Unit.corpus_id,
            Unit.corpus_version_id,
            Unit.parent_id,
            Unit.text,
            Unit.reference_label,
            Unit.ancestor_path,
        )
        .where(Unit.height == 0)
        .where(Unit.text.isnot(None))
        .order_by(Unit.corpus_version_id, Unit.parent_id, Unit.id)
    )
    if corpus_id is not None:
        stmt = stmt.where(Unit.corpus_id == corpus_id)

    leaves: list[LeafText] = []
    for uid, cid, cvid, parent_id, text, label, ancestor_path in session.execute(stmt):
        clean = _safe_text(text)
        if not clean:
            continue
        spans = _word_spans(clean)
        if not spans:
            continue
        leaves.append(
            LeafText(
                unit_id=uid,
                corpus_id=cid,
                corpus_version_id=cvid,
                parent_id=parent_id,
                text=clean,
                reference_label=label,
                ancestor_path=ancestor_path,
                word_spans=spans,
            )
        )
    return leaves


def _group_key(leaf: LeafText) -> tuple[int, int | None]:
    # Parent is the nearest coherent boundary for leaf windows. If a corpus has
    # no parent structure at all, fall back to corpus version so short top-level
    # leaves can still aggregate.
    return (leaf.corpus_version_id, leaf.parent_id)


def _span_label(leaves: list[LeafText]) -> str | None:
    first = leaves[0].reference_label
    last = leaves[-1].reference_label
    if first and last and first != last:
        return f"{first} - {last}"
    return first or last


def _span_path(leaves: list[LeafText]) -> str | None:
    first = leaves[0].ancestor_path
    if first and all(l.ancestor_path == first for l in leaves):
        return first
    return first


def _draft_from_leaf_window(
    leaf: LeafText,
    start_word: int,
    end_word: int,
    target_tokens: int,
    overlap_tokens: int,
) -> SpanDraft:
    start_char = leaf.word_spans[start_word][0]
    end_char = leaf.word_spans[end_word - 1][1]
    text = leaf.text[start_char:end_char].strip()
    char_count = len(text)
    return SpanDraft(
        corpus_id=leaf.corpus_id,
        corpus_version_id=leaf.corpus_version_id,
        text=text,
        token_count=end_word - start_word,
        word_count=end_word - start_word,
        char_count=char_count,
        start_unit_id=leaf.unit_id,
        end_unit_id=leaf.unit_id,
        start_char_offset=start_char,
        end_char_offset=end_char,
        reference_label=leaf.reference_label,
        ancestor_path=leaf.ancestor_path,
        unit_links=((leaf.unit_id, 0, start_char, end_char, 1.0),),
        metadata={
            "segmentation": "split-large-unit",
            "target_tokens": target_tokens,
            "overlap_tokens": overlap_tokens,
            "start_word": start_word,
            "end_word": end_word,
        },
    )


def _sentence_boundaries(leaf: LeafText) -> list[int]:
    boundaries: list[int] = []
    for idx, (start, end) in enumerate(leaf.word_spans, start=1):
        if SENTENCE_END_RE.search(leaf.text[start:end]):
            boundaries.append(idx)
    return boundaries


def _choose_window_end(
    boundaries: list[int],
    start: int,
    raw_end: int,
    word_count: int,
    target_tokens: int,
) -> int:
    if raw_end >= word_count:
        return word_count
    earliest = start + max(1, target_tokens // 2)
    candidates = [b for b in boundaries if earliest <= b <= raw_end]
    if candidates:
        return candidates[-1]
    return raw_end


def _split_large_leaf(leaf: LeafText, target_tokens: int, overlap_tokens: int) -> Iterable[SpanDraft]:
    boundaries = _sentence_boundaries(leaf)
    start = 0
    while start < leaf.word_count:
        raw_end = min(leaf.word_count, start + target_tokens)
        end = _choose_window_end(boundaries, start, raw_end, leaf.word_count, target_tokens)
        yield _draft_from_leaf_window(leaf, start, end, target_tokens, overlap_tokens)
        if end >= leaf.word_count:
            break
        start = max(start + 1, end - overlap_tokens)


def _draft_from_leaf_group(
    leaves: list[LeafText],
    target_tokens: int,
    overlap_tokens: int,
) -> SpanDraft:
    text = " ".join(l.text for l in leaves)
    char_count = len(text)
    unit_links = []
    for order, leaf in enumerate(leaves):
        unit_links.append((leaf.unit_id, order, 0, len(leaf.text), len(leaf.text) / max(1, char_count)))

    return SpanDraft(
        corpus_id=leaves[0].corpus_id,
        corpus_version_id=leaves[0].corpus_version_id,
        text=text,
        token_count=sum(l.word_count for l in leaves),
        word_count=sum(l.word_count for l in leaves),
        char_count=char_count,
        start_unit_id=leaves[0].unit_id,
        end_unit_id=leaves[-1].unit_id,
        start_char_offset=0,
        end_char_offset=len(leaves[-1].text),
        reference_label=_span_label(leaves),
        ancestor_path=_span_path(leaves),
        unit_links=tuple(unit_links),
        metadata={
            "segmentation": "aggregate-small-units" if len(leaves) > 1 else "single-unit",
            "target_tokens": target_tokens,
            "overlap_tokens": overlap_tokens,
        },
    )


def _build_group_spans(
    leaves: list[LeafText],
    target_tokens: int,
    overlap_tokens: int,
    max_tokens: int,
) -> Iterable[SpanDraft]:
    buffer: list[LeafText] = []
    buffer_tokens = 0

    def emit_buffer() -> SpanDraft | None:
        if not buffer:
            return None
        return _draft_from_leaf_group(list(buffer), target_tokens, overlap_tokens)

    for leaf in leaves:
        if leaf.word_count > max_tokens:
            draft = emit_buffer()
            if draft is not None:
                yield draft
                buffer.clear()
                buffer_tokens = 0
            yield from _split_large_leaf(leaf, target_tokens, overlap_tokens)
            continue

        would_exceed = buffer and buffer_tokens + leaf.word_count > target_tokens
        if would_exceed:
            draft = emit_buffer()
            if draft is not None:
                yield draft
            buffer = []
            buffer_tokens = 0

        buffer.append(leaf)
        buffer_tokens += leaf.word_count

    draft = emit_buffer()
    if draft is not None:
        yield draft


def build_span_drafts(leaves: list[LeafText], spec: dict[str, int]) -> list[SpanDraft]:
    by_boundary: dict[tuple[int, int | None], list[LeafText]] = {}
    for leaf in leaves:
        by_boundary.setdefault(_group_key(leaf), []).append(leaf)

    drafts: list[SpanDraft] = []
    for key in sorted(by_boundary):
        group = by_boundary[key]
        drafts.extend(
            _build_group_spans(
                group,
                target_tokens=spec["target_tokens"],
                overlap_tokens=spec["overlap_tokens"],
                max_tokens=spec["max_tokens"],
            )
        )
    return drafts


def get_or_create_profile(session: Session, label: str, spec: dict[str, int]) -> EmbeddingProfile:
    profile = session.execute(
        select(EmbeddingProfile).where(EmbeddingProfile.label == label)
    ).scalar_one_or_none()
    if profile is None:
        profile = EmbeddingProfile(
            label=label,
            model_name=MODEL_NAME,
            extra_metadata={"text_normalization": "collapse-whitespace", "token_estimator": "word-count"},
            **spec,
        )
        session.add(profile)
        session.flush()
    else:
        profile.model_name = MODEL_NAME
        profile.extra_metadata = {"text_normalization": "collapse-whitespace", "token_estimator": "word-count"}
        for key, value in spec.items():
            setattr(profile, key, value)
    return profile


def delete_profile_spans(session: Session, profile_id: int, corpus_id: int | None) -> int:
    span_ids_stmt = select(EmbeddingSpan.id).where(EmbeddingSpan.profile_id == profile_id)
    if corpus_id is not None:
        span_ids_stmt = span_ids_stmt.where(EmbeddingSpan.corpus_id == corpus_id)
    span_ids = list(session.execute(span_ids_stmt).scalars())
    if not span_ids:
        return 0
    session.execute(delete(SpanEmbedding).where(SpanEmbedding.embedding_span_id.in_(span_ids)))
    session.execute(delete(EmbeddingSpanUnit).where(EmbeddingSpanUnit.span_id.in_(span_ids)))
    session.execute(delete(EmbeddingSpan).where(EmbeddingSpan.id.in_(span_ids)))
    session.flush()
    return len(span_ids)


def insert_spans(session: Session, profile: EmbeddingProfile, drafts: list[SpanDraft], batch_size: int) -> None:
    inserted = 0
    for i in range(0, len(drafts), batch_size):
        batch = drafts[i : i + batch_size]
        for draft in batch:
            span = EmbeddingSpan(
                corpus_id=draft.corpus_id,
                corpus_version_id=draft.corpus_version_id,
                profile_id=profile.id,
                text=draft.text,
                token_count=draft.token_count,
                word_count=draft.word_count,
                char_count=draft.char_count,
                start_unit_id=draft.start_unit_id,
                end_unit_id=draft.end_unit_id,
                start_char_offset=draft.start_char_offset,
                end_char_offset=draft.end_char_offset,
                reference_label=draft.reference_label,
                ancestor_path=draft.ancestor_path,
                extra_metadata=draft.metadata,
            )
            session.add(span)
            session.flush()
            for unit_id, unit_order, start_char, end_char, weight in draft.unit_links:
                session.add(
                    EmbeddingSpanUnit(
                        span_id=span.id,
                        unit_id=unit_id,
                        unit_order=unit_order,
                        char_start_in_unit=start_char,
                        char_end_in_unit=end_char,
                        coverage_weight=weight,
                    )
                )
        session.commit()
        inserted += len(batch)
        print(f"  inserted {inserted}/{len(drafts)} spans", file=sys.stderr, end="\r")
    print(file=sys.stderr)


def resolve_corpus_id(session: Session, name: str | None) -> int | None:
    if name is None:
        return None
    corpus = session.execute(select(Corpus).where(Corpus.name == name)).scalar_one_or_none()
    if corpus is None:
        raise SystemExit(f"Corpus '{name}' not found.")
    return corpus.id


def main() -> None:
    parser = argparse.ArgumentParser(description="Build normalized embedding spans.")
    parser.add_argument("--profile", choices=sorted(PROFILE_SPECS), action="append", default=[])
    parser.add_argument("--corpus", type=str, default=None, help="Filter to one corpus by name")
    parser.add_argument("--replace", action="store_true", help="Delete existing spans for selected profiles before inserting")
    parser.add_argument("--dry-run", action="store_true", help="Report span counts without DB writes")
    parser.add_argument("--batch-size", type=int, default=1000)
    args = parser.parse_args()

    labels = args.profile or sorted(PROFILE_SPECS, key=lambda label: PROFILE_SPECS[label]["target_tokens"])

    with get_session() as session:
        corpus_id = resolve_corpus_id(session, args.corpus)
        leaves = _load_leaves(session, corpus_id)
        print(f"Loaded {len(leaves):,} nonempty leaf units.", file=sys.stderr)

        for label in labels:
            spec = PROFILE_SPECS[label]
            drafts = build_span_drafts(leaves, spec)
            counts = [d.token_count for d in drafts]
            min_count = min(counts) if counts else 0
            max_count = max(counts) if counts else 0
            avg_count = sum(counts) / len(counts) if counts else 0
            print(
                f"{label}: {len(drafts):,} spans | tokens min={min_count} "
                f"avg={avg_count:.1f} max={max_count}",
                file=sys.stderr,
            )
            if args.dry_run:
                continue

            profile = get_or_create_profile(session, label, spec)
            if args.replace:
                deleted = delete_profile_spans(session, profile.id, corpus_id)
                print(f"  deleted {deleted:,} existing spans", file=sys.stderr)
            else:
                existing_stmt = select(func.count(EmbeddingSpan.id)).where(EmbeddingSpan.profile_id == profile.id)
                if corpus_id is not None:
                    existing_stmt = existing_stmt.where(EmbeddingSpan.corpus_id == corpus_id)
                existing_count = session.execute(existing_stmt).scalar_one()
                if existing_count:
                    raise SystemExit(f"{label} already has spans. Re-run with --replace to rebuild.")

            insert_spans(session, profile, drafts, args.batch_size)


if __name__ == "__main__":
    main()
