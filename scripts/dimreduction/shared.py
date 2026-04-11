"""
scripts/dimreduction/shared.py

Shared data loading, sampling, aggregation, and binary I/O utilities
used by all dimensionality reduction scripts.

Binary format (columnar, little-endian):
    height_0.bin:
        [N: uint32]
        [unit_ids:      N × int32]
        [component_0:   N × float32]   ← x (or PC1)
        [component_1:   N × float32]   ← y (or PC2)
        …
        [component_K-1: N × float32]
        [corpus_ids:    N × int32]
        [corpus_seqs:   N × int32]
        [ancestor_h1:   N × int32]
        …
        [ancestor_hH:   N × int32]

    height_N.bin (N > 0):
        [N: uint32]
        [unit_ids:      N × int32]
        [component_0:   N × float32]
        …
        [component_K-1: N × float32]
        [corpus_ids:    N × int32]

Standard methods (UMAP, PHATE, Isomap) use K=2.
PCA uses K = number of retained principal components (stored in manifest).

Per-method latest pointer:  static/dimreduction/<method>/latest.json
Run data:                   static/dimreduction/<run_id>/<method>/
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

from db.models import Corpus, Embedding, Method, Unit
from db.session import get_session  # noqa: F401 — re-exported for convenience

METHOD_LABEL        = "nomic-embed-text-v1.5/all-heights"
DEFAULT_OUTPUT_DIR  = "static/dimreduction"
DEFAULT_SAMPLE_PER_DIV = 100
RANDOM_STATE        = 42


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_unit_tree(session: Session):
    """
    Load full unit tree in one query.
    Returns: parent_of, children_of, height_of, depth_of, corpus_id_of
    """
    print("Loading unit tree...")
    rows = session.execute(
        select(Unit.id, Unit.parent_id, Unit.height, Unit.depth, Unit.corpus_id)
    ).all()

    parent_of:    dict[int, int]       = {}
    children_of:  dict[int, list[int]] = defaultdict(list)
    height_of:    dict[int, int]       = {}
    depth_of:     dict[int, int]       = {}
    corpus_id_of: dict[int, int]       = {}

    for uid, pid, h, d, cid in rows:
        if pid is not None:
            parent_of[uid] = pid
            children_of[pid].append(uid)
        if h is not None:
            height_of[uid] = h
        if d is not None:
            depth_of[uid] = d
        if cid is not None:
            corpus_id_of[uid] = cid

    print(f"  {len(height_of):,} units loaded")
    return parent_of, dict(children_of), height_of, depth_of, corpus_id_of


def load_embeddings(session: Session) -> tuple[list[int], np.ndarray]:
    """
    Load all height=0 unit embeddings for the configured model.
    Returns (unit_ids, float32 matrix). Ordered by corpus_id, unit id.
    """
    print("Loading embeddings from DB...")
    rows = session.execute(
        select(Unit.id, Embedding.vector)
        .join(Embedding, Embedding.unit_id == Unit.id)
        .join(Method, Method.id == Embedding.method_id)
        .where(Method.label == METHOD_LABEL)
        .where(Unit.height == 0)
        .order_by(Unit.corpus_id, Unit.id)
    ).all()

    if not rows:
        raise SystemExit(
            f"No embeddings found for model '{METHOD_LABEL}'. "
            "Run the embed script first."
        )

    unit_ids = [r[0] for r in rows]
    vectors  = []
    for r in rows:
        v = r[1]
        if isinstance(v, str):
            v = [float(x) for x in v.strip("[]").split(",")]
        vectors.append(v)

    matrix = np.array(vectors, dtype=np.float32)
    print(f"  {len(unit_ids):,} units  |  shape: {matrix.shape}")
    return unit_ids, matrix


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
    height_of: dict[int, int],
    depth_of: dict[int, int],
    corpus_id_of: dict[int, int],
    corpus_seqs: dict[int, int],
    leaf_ancestors: dict[int, dict[int, int]],
    unit_labels: dict[int, str],
    max_height: int,
    n_components: int = 2,
) -> None:
    """
    Write binary + JSON output for one method under:
        <base_output_dir>/<run_id>/<method_name>/

    Writes both height_N.bin (grouped by height from leaf) and
    depth_N.bin (grouped by depth from root) so the frontend can
    toggle either grouping. Also writes the per-method latest pointer:
        <base_output_dir>/<method_name>/latest.json
    """
    method_dir = base_output_dir / run_id / method_name
    method_dir.mkdir(parents=True, exist_ok=True)
    print(f"\nWriting output to {method_dir}/")

    # ── Height bins ───────────────────────────────────────────────────────────

    by_height: dict[int, list[int]] = defaultdict(list)
    for uid in positions:
        h = height_of.get(uid, 0)
        by_height[h].append(uid)

    point_counts: dict[str, int] = {}

    for h in sorted(by_height.keys()):
        uids = sorted(by_height[h])
        ids  = np.array(uids, dtype=np.int32)
        cids = np.array([corpus_id_of.get(u, 0) for u in uids], dtype=np.int32)

        cols: list[tuple[np.ndarray, str]] = [(ids, "int32")]

        for k in range(n_components):
            col = np.array([float(positions[u][k]) for u in uids], dtype=np.float32)
            cols.append((col, "float32"))

        if h == 0:
            seqs = np.array([corpus_seqs.get(u, 0) for u in uids], dtype=np.int32)
            cols.append((cids, "int32"))
            cols.append((seqs, "int32"))
            for ah in range(1, max_height + 1):
                anc = np.array(
                    [leaf_ancestors.get(u, {}).get(ah, 0) for u in uids],
                    dtype=np.int32,
                )
                cols.append((anc, "int32"))
        else:
            cols.append((cids, "int32"))

        bin_path = method_dir / f"height_{h}.bin"
        _write_columnar_bin(bin_path, cols)
        point_counts[str(h)] = len(uids)
        print(f"  height_{h}.bin  {len(uids):,} points")

    # ── Depth bins ────────────────────────────────────────────────────────────
    # Each depth_D.bin contains all units at depth D from the corpus root.
    # Format: [N][unit_ids][comp_0]...[comp_K-1][corpus_ids]
    # No ancestor columns — depth bins are for visibility/rendering only.

    by_depth: dict[int, list[int]] = defaultdict(list)
    for uid in positions:
        d = depth_of.get(uid)
        if d is not None:
            by_depth[d].append(uid)

    depth_counts: dict[str, int] = {}
    max_depth = max(by_depth.keys()) if by_depth else 0

    for d in sorted(by_depth.keys()):
        uids = sorted(by_depth[d])
        ids  = np.array(uids, dtype=np.int32)
        cids = np.array([corpus_id_of.get(u, 0) for u in uids], dtype=np.int32)

        cols = [(ids, "int32")]
        for k in range(n_components):
            col = np.array([float(positions[u][k]) for u in uids], dtype=np.float32)
            cols.append((col, "float32"))
        cols.append((cids, "int32"))

        bin_path = method_dir / f"depth_{d}.bin"
        _write_columnar_bin(bin_path, cols)
        depth_counts[str(d)] = len(uids)
        print(f"  depth_{d}.bin   {len(uids):,} points")

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
        "max_height":       max_height,
        "heights":          sorted(by_height.keys()),
        "point_counts":     point_counts,
        "max_depth":        max_depth,
        "depths":           sorted(by_depth.keys()),
        "depth_counts":     depth_counts,
        "n_components":     n_components,
        **manifest_extra,
    }
    with open(method_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"  manifest.json")

    # Per-method latest pointer
    latest_dir = base_output_dir / method_name
    latest_dir.mkdir(parents=True, exist_ok=True)
    with open(latest_dir / "latest.json", "w") as f:
        json.dump({"run_id": run_id}, f)
    print(f"  {method_name}/latest.json → {run_id}")
