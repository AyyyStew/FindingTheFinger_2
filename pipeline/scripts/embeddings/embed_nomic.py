#!/usr/bin/env python3
"""
pipeline/scripts/embeddings/embed_nomic.py

Generate embeddings for all unit heights using nomic-ai/nomic-embed-text-v1.5.

  h=0  — leaf text embedded directly
  h=1  — concatenated leaf-child text embedded directly
  h>1  — text-length-weighted average of h=1 descendant embeddings, re-normalised

Modes:
    --check     Print token-length stats for height-1 aggregated text, then exit.
    --dry-run   Show how many units would be embedded, skip DB writes.
    (default)   Embed and write to DB.

Usage:
    python embed_nomic.py [--check] [--dry-run] [--batch-size 64] [--corpus CORPUS_NAME]
"""

import argparse
import sys
from collections import defaultdict, deque

import numpy as np
import torch
from sqlalchemy import select
from sqlalchemy.orm import Session

sys.path.insert(0, "/home/alexs/Projects/WebProjects/FindingTheFinger_2")
from db.session import get_session
from db.models import Corpus, Embedding, Method, Unit

MODEL_NAME = "nomic-ai/nomic-embed-text-v1.5"
VECTOR_DIM = 768
METHOD_LABEL = "nomic-embed-text-v1.5/all-heights"
METHOD_DESCRIPTION = (
    "nomic-embed-text-v1.5 embeddings covering all unit heights. "
    "h=0 (leaf): text embedded directly with 'search_document: ' prefix. "
    "h=1 (chapter/section): concatenated leaf-child text embedded directly; "
    "~0.6% of h=1 units exceed the model's 8192-token context and are silently "
    "truncated. "
    "h>1 (book and above): text-length-weighted average of the unit's h=1 descendant "
    "embeddings, re-normalised to unit length. Weights are the character length of each "
    "h=1 unit's aggregated leaf text, so sections with more content pull proportionally "
    "harder."
)
# nomic requires task prefix for asymmetric search
TASK_PREFIX = "search_document: "


# ---------------------------------------------------------------------------
# Method
# ---------------------------------------------------------------------------

def get_or_create_method(session: Session) -> Method:
    method = session.execute(
        select(Method).where(
            Method.model_name == MODEL_NAME,
            Method.label == METHOD_LABEL,
        )
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


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_units_by_height(session: Session, height: int, corpus_id: int | None) -> list[Unit]:
    q = select(Unit).where(Unit.height == height)
    if height == 0:
        q = q.where(Unit.text.isnot(None))
    if corpus_id is not None:
        q = q.where(Unit.corpus_id == corpus_id)
    return list(session.execute(q).scalars())


def load_units_above_h1(session: Session, corpus_id: int | None) -> list[Unit]:
    """All units with height > 1."""
    q = select(Unit).where(Unit.height > 1)
    if corpus_id is not None:
        q = q.where(Unit.corpus_id == corpus_id)
    return list(session.execute(q).scalars())


def build_h1_texts(session: Session, h1_units: list[Unit]) -> dict[int, str]:
    """Aggregate child leaf text for each height-1 unit."""
    if not h1_units:
        return {}

    parent_ids = [u.id for u in h1_units]

    rows = session.execute(
        select(Unit.parent_id, Unit.text)
        .where(Unit.parent_id.in_(parent_ids), Unit.height == 0, Unit.text.isnot(None))
        .order_by(Unit.parent_id, Unit.id)
    ).all()

    children: dict[int, list[str]] = defaultdict(list)
    for parent_id, text in rows:
        children[parent_id].append(text)

    return {uid: " ".join(children[uid]) for uid in parent_ids if children[uid]}


def build_children_map(session: Session, corpus_id: int | None) -> dict[int, list[int]]:
    """parent_id → [child_ids] for all units with height >= 1."""
    q = select(Unit.id, Unit.parent_id, Unit.height).where(Unit.height >= 1)
    if corpus_id is not None:
        q = q.where(Unit.corpus_id == corpus_id)
    rows = session.execute(q).all()

    children: dict[int, list[int]] = defaultdict(list)
    height_map: dict[int, int] = {}
    for uid, parent_id, height in rows:
        height_map[uid] = height
        if parent_id is not None:
            children[parent_id].append(uid)

    return children, height_map


def find_h1_descendants(unit_id: int, children: dict, heights: dict) -> list[int]:
    """BFS from unit_id, collect all h=1 descendants (do not descend past h=1)."""
    result = []
    queue = deque(children.get(unit_id, []))
    while queue:
        child = queue.popleft()
        h = heights.get(child)
        if h == 1:
            result.append(child)
        elif h is not None and h > 1:
            queue.extend(children.get(child, []))
    return result


# ---------------------------------------------------------------------------
# Token-length check
# ---------------------------------------------------------------------------

def check_h1_lengths(session: Session, corpus_id: int | None) -> None:
    try:
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)
    except ImportError:
        print("transformers not installed — estimating by word count (×1.3 tokens/word)")
        tokenizer = None

    h1_units = load_units_by_height(session, 1, corpus_id)
    if not h1_units:
        print("No height-1 units found.")
        return

    h1_texts = build_h1_texts(session, h1_units)
    if not h1_texts:
        print("No aggregated text for height-1 units.")
        return

    lengths = []
    for uid, text in h1_texts.items():
        prefixed = TASK_PREFIX + text
        if tokenizer:
            toks = len(tokenizer.encode(prefixed, add_special_tokens=True))
        else:
            toks = int(len(prefixed.split()) * 1.3)
        lengths.append(toks)

    lengths.sort()
    n = len(lengths)
    over = sum(1 for l in lengths if l > 8192)
    pct_over = 100 * over / n if n else 0

    print(f"\nHeight-1 token-length stats ({n} units)")
    print(f"  min     : {lengths[0]}")
    print(f"  median  : {lengths[n // 2]}")
    print(f"  p95     : {lengths[int(n * 0.95)]}")
    print(f"  p99     : {lengths[int(n * 0.99)]}")
    print(f"  max     : {lengths[-1]}")
    print(f"  > 8192  : {over}/{n}  ({pct_over:.1f}%)")
    print()

    if over:
        print("WARNING: some height-1 units exceed nomic's 8192-token context.")
        print("Those will be silently truncated by the model.")
    else:
        print("All height-1 units fit within nomic's 8192-token context.")


# ---------------------------------------------------------------------------
# Embed h=0 and h=1
# ---------------------------------------------------------------------------

def already_embedded_ids(session: Session, method_id: int) -> set[int]:
    return set(session.execute(
        select(Embedding.unit_id).where(Embedding.method_id == method_id)
    ).scalars())


def embed_h0_h1(
    session: Session,
    method: Method,
    h0_units: list[Unit],
    h1_texts: dict[int, str],
    batch_size: int,
    dry_run: bool,
    device: str = "cpu",
) -> None:
    from sentence_transformers import SentenceTransformer

    done = already_embedded_ids(session, method.id)

    items: list[tuple[int, str]] = []
    for u in h0_units:
        if u.id not in done:
            items.append((u.id, TASK_PREFIX + u.text))
    for uid, text in h1_texts.items():
        if uid not in done:
            items.append((uid, TASK_PREFIX + text))

    # Longest texts first — worst-case VRAM hit up front on a cold cache,
    # so OOM shrinks (if any) happen early rather than mid-run.
    items.sort(key=lambda x: len(x[1]), reverse=True)

    h0_todo = sum(1 for u in h0_units if u.id not in done)
    h1_todo = sum(1 for uid in h1_texts if uid not in done)
    print(f"h0+h1 to embed: {len(items)}  (h0={h0_todo}, h1={h1_todo})", file=sys.stderr)

    if dry_run or not items:
        return

    model = SentenceTransformer(MODEL_NAME, trust_remote_code=True, device=device)
    model.max_seq_length = 8192

    unit_ids = [i for i, _ in items]
    texts    = [t for _, t in items]

    # Base number of clean batches before attempting a batch-size recovery.
    # Doubles after each OOM (backoff), resets to base after a recovery sticks.
    RECOVER_AFTER_BASE = 5

    inserted       = 0
    current_batch  = batch_size
    clean_streak   = 0
    recover_after  = RECOVER_AFTER_BASE
    start          = 0

    while start < len(texts):
        batch_ids   = unit_ids[start : start + current_batch]
        batch_texts = texts[start : start + current_batch]

        try:
            vecs = model.encode(
                batch_texts,
                batch_size=current_batch,
                show_progress_bar=False,
                normalize_embeddings=True,
            )
        except torch.OutOfMemoryError:
            clean_streak  = 0
            recover_after = min(recover_after * 2, 64)  # backoff, cap at 64
            if current_batch == 1:
                print(f"\nOOM on batch_size=1 at offset {start}, skipping item.", file=sys.stderr)
                start += 1
                continue
            new_batch = max(1, current_batch // 2)
            print(f"\nOOM — reducing batch size {current_batch} → {new_batch}"
                  f"  (next recovery threshold: {recover_after})", file=sys.stderr)
            current_batch = new_batch
            torch.cuda.empty_cache()
            continue

        for uid, vec in zip(batch_ids, vecs):
            session.add(Embedding(unit_id=uid, method_id=method.id, vector=vec.tolist()))
        session.commit()
        inserted     += len(batch_ids)
        start        += current_batch
        clean_streak += 1

        # Try recovering toward the original batch size
        if clean_streak >= recover_after and current_batch < batch_size:
            new_batch = min(batch_size, current_batch * 2)
            print(f"\n{recover_after} clean batches — recovering batch size {current_batch} → {new_batch}",
                  file=sys.stderr)
            current_batch = new_batch
            clean_streak  = 0
            # Recovery stuck — reset threshold back to base
            if current_batch == batch_size:
                recover_after = RECOVER_AFTER_BASE

        print(f"  embedded {inserted}/{len(texts)}  (batch_size={current_batch})",
              file=sys.stderr, end="\r")

    print(f"\nh0+h1 done. Inserted {inserted} embeddings.", file=sys.stderr)


# ---------------------------------------------------------------------------
# Weighted average for h>1
# ---------------------------------------------------------------------------

def embed_hn_weighted(
    session: Session,
    method: Method,
    hn_units: list[Unit],
    h1_texts: dict[int, str],
    children_map: dict[int, list[int]],
    height_map: dict[int, int],
    dry_run: bool,
) -> None:
    if not hn_units:
        return

    done = already_embedded_ids(session, method.id)
    todo = [u for u in hn_units if u.id not in done]

    print(f"h>1 to embed (weighted avg): {len(todo)}", file=sys.stderr)
    if dry_run or not todo:
        return

    # Fetch all h=1 embeddings for this method into memory
    h1_rows = session.execute(
        select(Embedding.unit_id, Embedding.vector)
        .where(Embedding.method_id == method.id)
        .join(Unit, Unit.id == Embedding.unit_id)
        .where(Unit.height == 1)
    ).all()

    h1_vec: dict[int, np.ndarray] = {uid: np.array(vec) for uid, vec in h1_rows}

    # text length as weight (chars of aggregated leaf text)
    h1_weight: dict[int, float] = {uid: float(len(text)) for uid, text in h1_texts.items()}

    inserted = 0
    skipped = 0
    for u in todo:
        desc = find_h1_descendants(u.id, children_map, height_map)
        vecs_w = [(h1_vec[d], h1_weight.get(d, 1.0)) for d in desc if d in h1_vec]

        if not vecs_w:
            skipped += 1
            continue

        vecs    = np.stack([v for v, _ in vecs_w])   # (n, dim)
        weights = np.array([w for _, w in vecs_w])    # (n,)
        weights /= weights.sum()

        avg = (vecs * weights[:, None]).sum(axis=0)
        norm = np.linalg.norm(avg)
        if norm > 0:
            avg /= norm

        session.add(Embedding(unit_id=u.id, method_id=method.id, vector=avg.tolist()))
        inserted += 1

    session.commit()
    print(f"h>1 done. Inserted {inserted}, skipped {skipped} (no h=1 descendants).",
          file=sys.stderr)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def resolve_corpus_id(session: Session, name: str) -> int:
    corpus = session.execute(
        select(Corpus).where(Corpus.name == name)
    ).scalar_one_or_none()
    if corpus is None:
        print(f"Corpus '{name}' not found.", file=sys.stderr)
        sys.exit(1)
    return corpus.id


def main() -> None:
    parser = argparse.ArgumentParser(description="Embed all-height units with nomic-embed-text-v1.5")
    parser.add_argument("--check",      action="store_true", help="Print height-1 token stats and exit")
    parser.add_argument("--dry-run",    action="store_true", help="Count units, skip DB writes")
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--corpus",     type=str, default=None, help="Filter to one corpus by name")
    parser.add_argument("--device",     type=str, default=None,
                        help="Device for inference: cuda, cpu, mps. Auto-detects if omitted.")
    args = parser.parse_args()

    with get_session() as session:
        corpus_id = resolve_corpus_id(session, args.corpus) if args.corpus else None

        if args.check:
            check_h1_lengths(session, corpus_id)
            return

        h0      = load_units_by_height(session, 0, corpus_id)
        h1      = load_units_by_height(session, 1, corpus_id)
        hn      = load_units_above_h1(session, corpus_id)
        h1_text = build_h1_texts(session, h1)

        print(f"Loaded: h0={len(h0)}, h1={len(h1)}, h>1={len(hn)}, h1 with text={len(h1_text)}",
              file=sys.stderr)

        method = get_or_create_method(session)

        device = args.device or (
            "cuda" if torch.cuda.is_available() else
            "mps"  if torch.backends.mps.is_available() else
            "cpu"
        )
        print(f"Device: {device}", file=sys.stderr)

        # Phase 1: embed h=0 and h=1 with the model
        embed_h0_h1(session, method, h0, h1_text, args.batch_size, args.dry_run, device)

        # Phase 2: weighted average for h>1 (reads h=1 embeddings written in phase 1)
        if hn:
            children_map, height_map = build_children_map(session, corpus_id)
            embed_hn_weighted(session, method, hn, h1_text, children_map, height_map, args.dry_run)


if __name__ == "__main__":
    main()
