"""
scripts/dimreduction/shared.py

Shared data loading, sampling, aggregation, and binary I/O utilities
used by all dimensionality reduction scripts.

Binary format (columnar, little-endian):
    corpus_version_<id>.bin:
        [N: uint32]
        [unit_ids:      N × int32]
        [component_0:   N × float32]
        …
        [component_K-1: N × float32]
        [corpus_ids:    N × int32]
        [corpus_version_ids: N × int32]

Standard methods (UMAP, PHATE, Isomap) use K=2.
PCA uses K = number of retained principal components (stored in manifest).

Per-method latest pointer:  static/dimreduction/<method>/latest.json
Run data:                   static/dimreduction/<method>/<run_id>/
"""

import json
import struct
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import (
    Corpus,
    Embedding,
    EmbeddingProfile,
    EmbeddingSpan,
    EmbeddingSpanUnit,
    Method,
    SpanEmbedding,
    Unit,
)
from db.session import get_session  # noqa: F401 — re-exported for convenience

METHOD_LABEL        = "nomic-embed-text-v1.5/span-windows"
LEGACY_METHOD_LABEL = "nomic-embed-text-v1.5/all-heights"
DEFAULT_PROFILE_LABEL = "window-50"
DEFAULT_OUTPUT_DIR  = "static/dimreduction"
DEFAULT_SAMPLE_PER_DIV = 100
RANDOM_STATE        = 42
POSTGRES_IN_BATCH_SIZE = 10_000


def _vector_to_list(value) -> list[float]:
    if isinstance(value, str):
        return [float(x) for x in value.strip("[]").split(",")]
    return list(value)


def _chunks(values: list[int], size: int):
    for start in range(0, len(values), size):
        yield values[start:start + size]


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_unit_tree(session: Session):
    """
    Load full unit tree in one query.
    Returns:
      parent_of, children_of, height_of, depth_of, corpus_id_of, corpus_version_id_of
    """
    print("Loading unit tree...")
    rows = session.execute(
        select(
            Unit.id,
            Unit.parent_id,
            Unit.height,
            Unit.depth,
            Unit.corpus_id,
            Unit.corpus_version_id,
        )
    ).all()

    parent_of:    dict[int, int]       = {}
    children_of:  dict[int, list[int]] = defaultdict(list)
    height_of:    dict[int, int]       = {}
    depth_of:     dict[int, int]       = {}
    corpus_id_of: dict[int, int]       = {}
    corpus_version_id_of: dict[int, int] = {}

    for uid, pid, h, d, cid, cvid in rows:
        if pid is not None:
            parent_of[uid] = pid
            children_of[pid].append(uid)
        if h is not None:
            height_of[uid] = h
        if d is not None:
            depth_of[uid] = d
        if cid is not None:
            corpus_id_of[uid] = cid
        if cvid is not None:
            corpus_version_id_of[uid] = cvid

    print(f"  {len(height_of):,} units loaded")
    return (
        parent_of,
        dict(children_of),
        height_of,
        depth_of,
        corpus_id_of,
        corpus_version_id_of,
    )


def load_embeddings(session: Session) -> tuple[list[int], np.ndarray]:
    """
    Load all height=0 unit embeddings for the legacy configured model.
    Returns (unit_ids, float32 matrix). Ordered by corpus_id, unit id.
    """
    print("Loading legacy unit embeddings from DB...")
    rows = session.execute(
        select(Unit.id, Embedding.vector)
        .join(Embedding, Embedding.unit_id == Unit.id)
        .join(Method, Method.id == Embedding.method_id)
        .where(Method.label == LEGACY_METHOD_LABEL)
        .where(Unit.height == 0)
        .order_by(Unit.corpus_id, Unit.id)
    ).all()

    if not rows:
        raise SystemExit(
            f"No embeddings found for model '{LEGACY_METHOD_LABEL}'. "
            "Run the embed script first."
        )

    unit_ids = [r[0] for r in rows]
    vectors  = []
    for r in rows:
        vectors.append(_vector_to_list(r[1]))

    matrix = np.array(vectors, dtype=np.float32)
    print(f"  {len(unit_ids):,} units  |  shape: {matrix.shape}")
    return unit_ids, matrix


def resolve_embedding_profile(session: Session, profile_label: str) -> EmbeddingProfile:
    profile = session.execute(
        select(EmbeddingProfile).where(EmbeddingProfile.label == profile_label)
    ).scalar_one_or_none()
    if profile is None and profile_label == DEFAULT_PROFILE_LABEL:
        profile = session.execute(
            select(EmbeddingProfile)
            .where(EmbeddingProfile.target_tokens == 50)
            .order_by(EmbeddingProfile.id)
        ).scalars().first()
    if profile is None:
        profile = session.execute(
            select(EmbeddingProfile).order_by(EmbeddingProfile.target_tokens)
        ).scalars().first()
    if profile is None:
        raise SystemExit("No embedding profiles found. Run build_embedding_spans.py first.")
    return profile


def load_span_embeddings(
    session: Session,
    profile_label: str = DEFAULT_PROFILE_LABEL,
) -> tuple[list[int], np.ndarray, dict[int, dict[str, Any]], EmbeddingProfile]:
    """
    Load span embeddings for one embedding profile.
    Returns (span_ids, matrix, span_meta, profile). Ordered by corpus_id, span id.
    """
    profile = resolve_embedding_profile(session, profile_label)
    print(f"Loading span embeddings from DB for profile '{profile.label}'...")
    rows = session.execute(
        select(
            EmbeddingSpan.id,
            SpanEmbedding.vector,
            EmbeddingSpan.corpus_id,
            EmbeddingSpan.corpus_version_id,
            EmbeddingSpan.start_unit_id,
            EmbeddingSpan.end_unit_id,
            EmbeddingSpan.token_count,
            EmbeddingSpan.reference_label,
        )
        .join(SpanEmbedding, SpanEmbedding.embedding_span_id == EmbeddingSpan.id)
        .join(Method, Method.id == SpanEmbedding.method_id)
        .where(Method.label == METHOD_LABEL)
        .where(EmbeddingSpan.profile_id == profile.id)
        .order_by(EmbeddingSpan.corpus_id, EmbeddingSpan.id)
    ).all()

    if not rows:
        raise SystemExit(
            f"No span embeddings found for method '{METHOD_LABEL}' and profile "
            f"'{profile.label}'. Run embed_span_nomic.py first."
        )

    span_ids = [r[0] for r in rows]
    matrix = np.array([_vector_to_list(r[1]) for r in rows], dtype=np.float32)
    span_meta = {
        span_id: {
            "corpus_id": corpus_id,
            "corpus_version_id": corpus_version_id,
            "start_unit_id": start_unit_id,
            "end_unit_id": end_unit_id,
            "primary_unit_id": start_unit_id,
            "token_count": token_count,
            "reference_label": reference_label,
        }
        for (
            span_id,
            _vector,
            corpus_id,
            corpus_version_id,
            start_unit_id,
            end_unit_id,
            token_count,
            reference_label,
        ) in rows
    }
    print(f"  {len(span_ids):,} spans  |  shape: {matrix.shape}")
    return span_ids, matrix, span_meta, profile


# ---------------------------------------------------------------------------
# Balanced sampling
# ---------------------------------------------------------------------------

def sample_by_division(
    unit_ids: list[int],
    n_per_division: int,
    parent_of: dict[int, int],
    depth_of: dict[int, int],
) -> tuple[np.ndarray, list[int]]:
    """
    Sample up to n_per_division leaves per depth=0 division.
    Returns (sorted int64 index array into unit_ids, unassigned leaf IDs).
    """
    print(f"\nBuilding balanced sample ({n_per_division} leaves per depth=0 division)...")
    id_to_idx = {uid: i for i, uid in enumerate(unit_ids)}

    div_to_indices: dict[int, list[int]] = defaultdict(list)
    unassigned_ids: list[int] = []

    for leaf_id in unit_ids:
        div_id = _find_depth0_ancestor(leaf_id, parent_of, depth_of)
        if div_id is None:
            unassigned_ids.append(leaf_id)
            continue
        idx = id_to_idx.get(leaf_id)
        if idx is not None:
            div_to_indices[div_id].append(idx)

    if unassigned_ids:
        print(f"  Warning: {len(unassigned_ids):,} leaves had no depth=0 ancestor (skipped from sample)")

    rng = np.random.default_rng(RANDOM_STATE)
    sampled: list[int] = []
    for div_id, indices in div_to_indices.items():
        k = min(n_per_division, len(indices))
        sampled.extend(rng.choice(indices, size=k, replace=False).tolist())

    sampled_arr = np.array(sorted(set(sampled)), dtype=np.int64)
    print(f"  {len(div_to_indices):,} divisions  →  {len(sampled_arr):,} sample leaves"
          f"  (out of {len(unit_ids):,} total)")
    return sampled_arr, unassigned_ids


def sample_spans_by_division(
    span_ids: list[int],
    span_meta: dict[int, dict[str, Any]],
    n_per_division: int,
    parent_of: dict[int, int],
    depth_of: dict[int, int],
) -> tuple[np.ndarray, list[int]]:
    print(f"\nBuilding balanced span sample ({n_per_division} spans per depth=0 division)...")
    div_to_indices: dict[int, list[int]] = defaultdict(list)
    unassigned_ids: list[int] = []

    for idx, span_id in enumerate(span_ids):
        anchor_id = span_meta[span_id]["primary_unit_id"]
        div_id = _find_depth0_ancestor(anchor_id, parent_of, depth_of)
        if div_id is None:
            unassigned_ids.append(span_id)
            continue
        div_to_indices[div_id].append(idx)

    if unassigned_ids:
        print(f"  Warning: {len(unassigned_ids):,} spans had no depth=0 anchor ancestor (skipped from sample)")

    rng = np.random.default_rng(RANDOM_STATE)
    sampled: list[int] = []
    for indices in div_to_indices.values():
        k = min(n_per_division, len(indices))
        sampled.extend(rng.choice(indices, size=k, replace=False).tolist())

    sampled_arr = np.array(sorted(set(sampled)), dtype=np.int64)
    print(f"  {len(div_to_indices):,} divisions  →  {len(sampled_arr):,} sample spans"
          f"  (out of {len(span_ids):,} total)")
    return sampled_arr, unassigned_ids


def _find_depth0_ancestor(uid: int, parent_of: dict, depth_of: dict) -> int | None:
    if depth_of.get(uid) == 0:
        return uid
    cur = uid
    while cur in parent_of:
        cur = parent_of[cur]
        if depth_of.get(cur) == 0:
            return cur
    return None


def print_unassigned(session: Session, unit_ids: list[int]) -> None:
    rows = session.execute(
        select(Unit.id, Unit.reference_label, Unit.depth, Corpus.name)
        .join(Corpus, Corpus.id == Unit.corpus_id)
        .where(Unit.id.in_(unit_ids))
        .order_by(Corpus.name, Unit.id)
    ).all()
    print(f"\n  {'id':>10}  {'depth':>5}  {'corpus':<30}  label")
    print(f"  {'-'*10}  {'-'*5}  {'-'*30}  {'-'*30}")
    for uid, label, depth, corpus in rows:
        print(f"  {uid:>10}  {depth:>5}  {corpus:<30}  {label or '—'}")


# ---------------------------------------------------------------------------
# Post-processing
# ---------------------------------------------------------------------------

def compute_corpus_seqs(leaf_ids: list[int], corpus_id_of: dict[int, int]) -> dict[int, int]:
    """Sequential rank of each leaf within its corpus (1-based), sorted by id."""
    by_corpus: dict[int, list[int]] = defaultdict(list)
    for uid in leaf_ids:
        cid = corpus_id_of.get(uid)
        if cid is not None:
            by_corpus[cid].append(uid)

    seq: dict[int, int] = {}
    for cid, uids in by_corpus.items():
        for rank, uid in enumerate(sorted(uids), start=1):
            seq[uid] = rank
    return seq


def load_unit_labels(session: Session, unit_ids: list[int]) -> dict[int, str]:
    rows = session.execute(
        select(Unit.id, Unit.reference_label)
        .where(Unit.id.in_(unit_ids))
        .where(Unit.reference_label.isnot(None))
    ).all()
    return {r[0]: r[1] for r in rows}


def aggregate_parents(
    leaf_ids: list[int],
    leaf_coords: np.ndarray,
    children_of: dict[int, list[int]],
    parent_of: dict[int, int],
) -> dict[int, np.ndarray]:
    """
    Bottom-up mean aggregation for all ancestor units.
    leaf_coords: (N, D) array — works for any D (2 for standard, K for PCA).
    Returns {unit_id: D-dim np.ndarray}.
    """
    positions: dict[int, np.ndarray] = {
        uid: leaf_coords[i] for i, uid in enumerate(leaf_ids)
    }

    frontier = set(leaf_ids)
    visited  = set(leaf_ids)

    while frontier:
        next_frontier: set[int] = set()
        for uid in frontier:
            pid = parent_of.get(uid)
            if pid is not None and pid not in visited:
                next_frontier.add(pid)

        for pid in next_frontier:
            child_pos = [positions[c] for c in children_of.get(pid, []) if c in positions]
            if child_pos:
                positions[pid] = np.mean(child_pos, axis=0)

        visited.update(next_frontier)
        frontier = next_frontier

    derived = len(positions) - len(leaf_ids)
    print(f"  {len(leaf_ids):,} leaf + {derived:,} derived parent = {len(positions):,} total")
    return positions


def fold_span_positions_to_units(
    session: Session,
    span_ids: list[int],
    span_coords: np.ndarray,
) -> tuple[list[int], np.ndarray]:
    """
    Fold projected span coordinates back onto covered leaf units using
    embedding_span_unit.coverage_weight.
    """
    print("Folding span positions back onto units...")
    idx_by_span = {span_id: i for i, span_id in enumerate(span_ids)}
    totals: dict[int, np.ndarray] = {}
    weights: dict[int, float] = {}
    n_batches = (len(span_ids) + POSTGRES_IN_BATCH_SIZE - 1) // POSTGRES_IN_BATCH_SIZE
    for batch_index, batch in enumerate(_chunks(span_ids, POSTGRES_IN_BATCH_SIZE), start=1):
        rows = session.execute(
            select(
                EmbeddingSpanUnit.span_id,
                EmbeddingSpanUnit.unit_id,
                EmbeddingSpanUnit.coverage_weight,
            )
            .where(EmbeddingSpanUnit.span_id.in_(batch))
            .order_by(EmbeddingSpanUnit.unit_id, EmbeddingSpanUnit.span_id)
        ).all()
        for span_id, unit_id, weight in rows:
            idx = idx_by_span.get(span_id)
            if idx is None:
                continue
            w = float(weight) if weight and weight > 0 else 1.0
            totals[unit_id] = totals.get(unit_id, np.zeros(span_coords.shape[1], dtype=np.float32)) + span_coords[idx] * w
            weights[unit_id] = weights.get(unit_id, 0.0) + w
        if n_batches > 1:
            print(f"  loaded span-unit link batch {batch_index}/{n_batches}", end="\r")
    if n_batches > 1:
        print()

    unit_ids = sorted(totals)
    if not unit_ids:
        raise SystemExit("No span-to-unit links found for projected spans.")
    unit_coords = np.array([totals[uid] / max(weights[uid], 1e-12) for uid in unit_ids], dtype=np.float32)
    print(f"  {len(span_ids):,} spans → {len(unit_ids):,} covered units")
    return unit_ids, unit_coords


def compute_leaf_ancestors(
    leaf_ids: list[int],
    parent_of: dict[int, int],
    height_of: dict[int, int],
    max_height: int,
) -> dict[int, dict[int, int]]:
    result: dict[int, dict[int, int]] = {}
    for leaf_id in leaf_ids:
        ancestors: dict[int, int] = {}
        cur = leaf_id
        while cur in parent_of:
            cur = parent_of[cur]
            h = height_of.get(cur, -1)
            if 1 <= h <= max_height:
                ancestors[h] = cur
        result[leaf_id] = ancestors
    return result


# ---------------------------------------------------------------------------
# Binary I/O
# ---------------------------------------------------------------------------

def _write_columnar_bin(path: Path, columns: list[tuple[np.ndarray, str]]) -> None:
    n = len(columns[0][0])
    with open(path, "wb") as f:
        f.write(struct.pack("<I", n))
        for arr, dtype in columns:
            f.write(np.array(arr, dtype=dtype).tobytes())


def write_method_output(
    base_output_dir: Path,
    run_id: str,
    method_name: str,
    manifest_extra: dict[str, Any],
    positions: dict[int, np.ndarray],
    depth_of: dict[int, int],
    corpus_id_of: dict[int, int],
    corpus_version_id_of: dict[int, int],
    unit_labels: dict[int, str],
    n_components: int = 2,
    span_positions: dict[int, np.ndarray] | None = None,
    span_meta: dict[int, dict[str, Any]] | None = None,
    profile: EmbeddingProfile | None = None,
) -> None:
    """
    Write binary + JSON output for one method under:
        <base_output_dir>/<method_name>/<run_id>/

    Writes corpus_version_<id>.bin (grouped by corpus_version_id),
    optional spans.bin, labels, manifest, and the per-method latest pointer:
        <base_output_dir>/<method_name>/latest.json
    """
    profile_label = profile.label if profile is not None else None
    method_root = base_output_dir / method_name
    latest_dir = method_root
    if profile_label is not None:
        method_root = method_root / profile_label
        latest_dir = method_root
    method_dir = method_root / run_id
    method_dir.mkdir(parents=True, exist_ok=True)
    print(f"\nWriting output to {method_dir}/")

    # ── Corpus-version bins ───────────────────────────────────────────────────
    # Each corpus_version_<id>.bin contains all units in one corpus version.
    # Format:
    # [N][unit_ids][comp_0]...[comp_K-1][corpus_ids][corpus_version_ids]
    # No ancestor columns — these bins are for visibility/rendering only.

    by_corpus_version: dict[int, list[int]] = defaultdict(list)
    for uid in positions:
        cvid = corpus_version_id_of.get(uid)
        if cvid is not None:
            by_corpus_version[cvid].append(uid)

    corpus_version_counts: dict[str, int] = {}
    max_depth = max(depth_of.values()) if depth_of else 0

    for cvid in sorted(by_corpus_version.keys()):
        uids = sorted(by_corpus_version[cvid])
        ids  = np.array(uids, dtype=np.int32)
        cids = np.array([corpus_id_of.get(u, 0) for u in uids], dtype=np.int32)
        cvids = np.array([corpus_version_id_of.get(u, 0) for u in uids], dtype=np.int32)

        cols = [(ids, "int32")]
        for k in range(n_components):
            col = np.array([float(positions[u][k]) for u in uids], dtype=np.float32)
            cols.append((col, "float32"))
        cols.append((cids, "int32"))
        cols.append((cvids, "int32"))

        bin_path = method_dir / f"corpus_version_{cvid}.bin"
        _write_columnar_bin(bin_path, cols)
        corpus_version_counts[str(cvid)] = len(uids)
        print(f"  corpus_version_{cvid}.bin   {len(uids):,} points")

    # ── Span bin ──────────────────────────────────────────────────────────────
    # Format:
    # [N][span_ids][comp_0]...[comp_K-1][corpus_ids][corpus_version_ids]
    # [start_unit_ids][end_unit_ids][primary_unit_ids][token_counts]
    span_count = 0
    if span_positions is not None and span_meta is not None:
        span_ids = sorted(span_positions)
        ids = np.array(span_ids, dtype=np.int32)
        cids = np.array([span_meta[s]["corpus_id"] for s in span_ids], dtype=np.int32)
        cvids = np.array([span_meta[s]["corpus_version_id"] for s in span_ids], dtype=np.int32)
        start_ids = np.array([span_meta[s]["start_unit_id"] for s in span_ids], dtype=np.int32)
        end_ids = np.array([span_meta[s]["end_unit_id"] for s in span_ids], dtype=np.int32)
        primary_ids = np.array([span_meta[s]["primary_unit_id"] for s in span_ids], dtype=np.int32)
        token_counts = np.array([span_meta[s]["token_count"] for s in span_ids], dtype=np.int32)

        cols = [(ids, "int32")]
        for k in range(n_components):
            col = np.array([float(span_positions[s][k]) for s in span_ids], dtype=np.float32)
            cols.append((col, "float32"))
        cols.extend([
            (cids, "int32"),
            (cvids, "int32"),
            (start_ids, "int32"),
            (end_ids, "int32"),
            (primary_ids, "int32"),
            (token_counts, "int32"),
        ])
        _write_columnar_bin(method_dir / "spans.bin", cols)
        span_count = len(span_ids)
        print(f"  spans.bin   {span_count:,} points")

    # ── Labels + manifest ─────────────────────────────────────────────────────

    labels_path = method_dir / "unit_labels.json"
    with open(labels_path, "w") as f:
        json.dump({str(k): v for k, v in unit_labels.items()}, f)
    print(f"  unit_labels.json  {len(unit_labels):,} entries")

    manifest = {
        "run_id":           run_id,
        "created_at":       datetime.now(timezone.utc).isoformat(),
        "method":           method_name,
        "embedding_method": METHOD_LABEL,
        "bin_schema_version": 5,
        "has_corpus_version_ids": True,
        "has_span_layer": span_positions is not None,
        "span_count": span_count,
        "embedding_profile": (
            {
                "id": profile.id,
                "label": profile.label,
                "target_tokens": profile.target_tokens,
                "overlap_tokens": profile.overlap_tokens,
                "min_tokens": profile.min_tokens,
                "max_tokens": profile.max_tokens,
                "model_name": profile.model_name,
            }
            if profile is not None
            else None
        ),
        "max_depth":        max_depth,
        "corpus_version_ids": sorted(by_corpus_version.keys()),
        "corpus_version_counts": corpus_version_counts,
        "n_components":     n_components,
        **manifest_extra,
    }
    with open(method_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"  manifest.json")

    # Per-method latest pointer
    latest_dir.mkdir(parents=True, exist_ok=True)
    with open(latest_dir / "latest.json", "w") as f:
        json.dump({"run_id": run_id}, f)
    print(f"  {method_name}/latest.json → {run_id}")
