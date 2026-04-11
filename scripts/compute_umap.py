"""
scripts/compute_umap.py

Computes a 2D UMAP projection of all height=0 unit embeddings and writes
results to static binary files split by hierarchy level.

Leaf file (height_0.bin) includes ancestor unit IDs at each height level
so the frontend can group leaves for clouds, voronoi, and labels without
extra API calls.

Output layout:
    {output_dir}/{YYYY-MM-DD_HHMMSS}/
        manifest.json        — run params, heights, point counts
        unit_labels.json     — {unit_id: reference_label} for non-leaf units
        height_0.bin         — leaf points (see binary format below)
        height_1.bin         — chapter-level points
        height_N.bin         — ...
    {output_dir}/latest.json — {"run_id": "YYYY-MM-DD_HHMMSS"}

Binary format — columnar, little-endian:
    height_0.bin:
        [N: uint32]
        [unit_ids:      N × int32]
        [x:             N × float32]
        [y:             N × float32]
        [corpus_ids:    N × int32]
        [corpus_seqs:   N × int32]
        [ancestor_h1:   N × int32]   ← 0 if no ancestor at that height
        [ancestor_h2:   N × int32]
        ...up to global max_height

    height_N.bin (N > 0):
        [N: uint32]
        [unit_ids:      N × int32]
        [x:             N × float32]
        [y:             N × float32]
        [corpus_ids:    N × int32]

Usage:
    python -m scripts.compute_umap
    python -m scripts.compute_umap --label "v2" --n-neighbors 15 --min-dist 0.1
    python -m scripts.compute_umap --sample-per-division 50
    python -m scripts.compute_umap --no-sample
    python -m scripts.compute_umap --dry-run
    python -m scripts.compute_umap --output-dir /some/other/path
"""

import argparse
import json
import struct
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import Embedding, Method, Unit
from db.session import get_session

METHOD_LABEL             = "nomic-embed-text-v1.5/all-heights"
DEFAULT_N_NEIGHBORS    = 15
DEFAULT_MIN_DIST       = 0.1
DEFAULT_SAMPLE_PER_DIV = 100
UMAP_METRIC            = "cosine"
UMAP_RANDOM_STATE      = 42
DEFAULT_OUTPUT_DIR     = "static/umap_runs"


# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--label",               default=None,  help="Human-readable label for this run")
    p.add_argument("--n-neighbors",         type=int,  default=DEFAULT_N_NEIGHBORS)
    p.add_argument("--min-dist",            type=float, default=DEFAULT_MIN_DIST)
    p.add_argument("--sample-per-division", type=int,  default=DEFAULT_SAMPLE_PER_DIV,
                   help="Max leaves per depth=0 division for UMAP fit (default: 100)")
    p.add_argument("--no-sample",           action="store_true",
                   help="Fit UMAP on all points instead of balanced sample")
    p.add_argument("--dry-run",             action="store_true")
    p.add_argument("--output-dir",          default=DEFAULT_OUTPUT_DIR,
                   help=f"Root directory for run folders (default: {DEFAULT_OUTPUT_DIR})")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_unit_tree(session: Session) -> tuple[
    dict[int, int],
    dict[int, list[int]],
    dict[int, int],
    dict[int, int],
    dict[int, int],
]:
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
    return parent_of, children_of, height_of, depth_of, corpus_id_of


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


def sample_by_division(
    unit_ids: list[int],
    n_per_division: int,
    parent_of: dict[int, int],
    depth_of: dict[int, int],
) -> tuple[np.ndarray, list[int]]:
    """
    Sample up to n_per_division leaves per depth=0 division (Book/Raag/Surah/…)
    for a balanced UMAP fit. Walks parent chain in Python using loaded tree.
    Returns (sorted int64 index array, list of unassigned leaf_ids).
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

    rng = np.random.default_rng(UMAP_RANDOM_STATE)
    sampled: list[int] = []
    for div_id, indices in div_to_indices.items():
        k = min(n_per_division, len(indices))
        sampled.extend(rng.choice(indices, size=k, replace=False).tolist())

    sampled_arr = np.array(sorted(set(sampled)), dtype=np.int64)
    print(f"  {len(div_to_indices):,} divisions  →  {len(sampled_arr):,} sample leaves"
          f"  (out of {len(unit_ids):,} total)")
    return sampled_arr, unassigned_ids


def _find_depth0_ancestor(
    uid: int,
    parent_of: dict[int, int],
    depth_of: dict[int, int],
) -> int | None:
    """
    Walk up the parent chain and return the first unit with depth=0.
    If the leaf itself is depth=0 (no parent — single-unit corpus), return it.
    """
    if depth_of.get(uid) == 0:
        return uid
    cur = uid
    while cur in parent_of:
        cur = parent_of[cur]
        if depth_of.get(cur) == 0:
            return cur
    return None


def print_unassigned(session: Session, unit_ids: list[int]) -> None:
    """Print corpus name + reference_label for a list of unit IDs."""
    from db.models import Corpus
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


def compute_corpus_seqs(
    leaf_ids: list[int],
    corpus_id_of: dict[int, int],
) -> dict[int, int]:
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
    """Load reference_label for a set of non-leaf unit IDs."""
    rows = session.execute(
        select(Unit.id, Unit.reference_label)
        .where(Unit.id.in_(unit_ids))
        .where(Unit.reference_label.isnot(None))
    ).all()
    return {r[0]: r[1] for r in rows}


# ---------------------------------------------------------------------------
# UMAP
# ---------------------------------------------------------------------------

def run_umap(
    matrix: np.ndarray,
    n_neighbors: int,
    min_dist: float,
    sample_indices: np.ndarray | None = None,
) -> np.ndarray:
    """
    Fit UMAP on matrix[sample_indices] (or all of matrix), transform all rows.
    Returns float32 (N, 2) array.
    """
    import umap as umap_lib

    fit_matrix = matrix[sample_indices] if sample_indices is not None else matrix
    label = (f"sample n={len(fit_matrix):,}" if sample_indices is not None
             else f"all n={len(matrix):,}")
    print(f"\nRunning UMAP  n_neighbors={n_neighbors}  min_dist={min_dist}"
          f"  metric={UMAP_METRIC}  fit on {label}...")

    reducer = umap_lib.UMAP(
        n_components=2,
        n_neighbors=n_neighbors,
        min_dist=min_dist,
        metric=UMAP_METRIC,
        random_state=UMAP_RANDOM_STATE,
        verbose=True,
    )
    reducer.fit(fit_matrix)

    print(f"  Fit done. Transforming all {len(matrix):,} points...")
    coords = np.array(reducer.transform(matrix), dtype=np.float32)
    print(f"  Done.  x∈[{coords[:,0].min():.3f}, {coords[:,0].max():.3f}]"
          f"  y∈[{coords[:,1].min():.3f}, {coords[:,1].max():.3f}]")
    return coords


# ---------------------------------------------------------------------------
# Parent aggregation
# ---------------------------------------------------------------------------

def aggregate_parents(
    leaf_ids: list[int],
    leaf_coords: np.ndarray,
    children_of: dict[int, list[int]],
    parent_of: dict[int, int],
) -> dict[int, tuple[float, float]]:
    """Bottom-up mean aggregation for all ancestor units."""
    positions: dict[int, tuple[float, float]] = {
        uid: (float(x), float(y))
        for uid, (x, y) in zip(leaf_ids, leaf_coords)
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
            child_positions = [positions[c] for c in children_of[pid] if c in positions]
            if child_positions:
                arr = np.array(child_positions, dtype=np.float32)
                positions[pid] = (float(arr[:, 0].mean()), float(arr[:, 1].mean()))

        visited.update(next_frontier)
        frontier = next_frontier

    derived = len(positions) - len(leaf_ids)
    print(f"  {len(leaf_ids):,} leaf + {derived:,} derived parent = {len(positions):,} total")
    return positions


# ---------------------------------------------------------------------------
# Ancestor IDs for leaf nodes
# ---------------------------------------------------------------------------

def compute_leaf_ancestors(
    leaf_ids: list[int],
    parent_of: dict[int, int],
    height_of: dict[int, int],
    max_height: int,
) -> dict[int, dict[int, int]]:
    """
    For each leaf, walk up the parent chain and record the ancestor unit ID
    at each height level h=1..max_height.
    Returns {leaf_id: {height: ancestor_unit_id}}. Missing heights → 0.
    """
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
# Binary writer
# ---------------------------------------------------------------------------

def _write_columnar_bin(path: Path, columns: list[tuple[np.ndarray, str]]) -> None:
    """
    Write a columnar binary file.
    Format: [N: uint32 LE] [col1: N×dtype LE] [col2: N×dtype LE] ...
    """
    n = len(columns[0][0])
    with open(path, "wb") as f:
        f.write(struct.pack("<I", n))
        for arr, dtype in columns:
            f.write(np.array(arr, dtype=dtype).tobytes())


def write_output(
    output_dir: Path,
    run_id: str,
    label: str | None,
    n_neighbors: int,
    min_dist: float,
    positions: dict[int, tuple[float, float]],
    height_of: dict[int, int],
    corpus_id_of: dict[int, int],
    corpus_seqs: dict[int, int],
    leaf_ancestors: dict[int, dict[int, int]],
    unit_labels: dict[int, str],
    max_height: int,
) -> None:
    run_dir = output_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    print(f"\nWriting output to {run_dir}/")

    by_height: dict[int, list[int]] = defaultdict(list)
    for uid in positions:
        h = height_of.get(uid, 0)
        by_height[h].append(uid)

    point_counts: dict[str, int] = {}

    for h in sorted(by_height.keys()):
        uids = sorted(by_height[h])
        ids  = np.array(uids, dtype=np.int32)
        xs   = np.array([positions[u][0] for u in uids], dtype=np.float32)
        ys   = np.array([positions[u][1] for u in uids], dtype=np.float32)
        cids = np.array([corpus_id_of.get(u, 0) for u in uids], dtype=np.int32)

        if h == 0:
            seqs = np.array([corpus_seqs.get(u, 0) for u in uids], dtype=np.int32)
            cols: list[tuple[np.ndarray, str]] = [
                (ids,  "int32"),
                (xs,   "float32"),
                (ys,   "float32"),
                (cids, "int32"),
                (seqs, "int32"),
            ]
            for ah in range(1, max_height + 1):
                anc = np.array(
                    [leaf_ancestors.get(u, {}).get(ah, 0) for u in uids],
                    dtype=np.int32,
                )
                cols.append((anc, "int32"))
        else:
            cols = [
                (ids,  "int32"),
                (xs,   "float32"),
                (ys,   "float32"),
                (cids, "int32"),
            ]

        bin_path = run_dir / f"height_{h}.bin"
        _write_columnar_bin(bin_path, cols)
        point_counts[str(h)] = len(uids)
        print(f"  height_{h}.bin  {len(uids):,} points")

    labels_path = run_dir / "unit_labels.json"
    with open(labels_path, "w") as f:
        json.dump({str(k): v for k, v in unit_labels.items()}, f)
    print(f"  unit_labels.json  {len(unit_labels):,} entries")

    manifest = {
        "run_id":       run_id,
        "created_at":   datetime.now(timezone.utc).isoformat(),
        "label":        label,
        "method":       METHOD_LABEL,
        "n_neighbors":  n_neighbors,
        "min_dist":     min_dist,
        "max_height":   max_height,
        "heights":      sorted(by_height.keys()),
        "point_counts": point_counts,
    }
    with open(run_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"  manifest.json")

    with open(output_dir / "latest.json", "w") as f:
        json.dump({"run_id": run_id}, f)
    print(f"  latest.json → {run_id}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)

    with get_session() as session:
        # Load tree first — used for sampling, ancestor computation, and aggregation
        parent_of, children_of, height_of, depth_of, corpus_id_of = load_unit_tree(session)

        max_height = max(height_of.values()) if height_of else 0
        print(f"  max height: {max_height}")

        unit_ids, matrix = load_embeddings(session)

        if args.dry_run:
            if not args.no_sample:
                sample_indices, unassigned_ids = sample_by_division(
                    unit_ids, args.sample_per_division, parent_of, depth_of
                )
                if unassigned_ids:
                    print_unassigned(session, unassigned_ids)
                print(f"\nDry run: would fit UMAP on {len(sample_indices):,} sampled leaves,"
                      f" then transform all {len(unit_ids):,}.")
            else:
                print(f"\nDry run: would fit+transform UMAP on all {len(unit_ids):,} leaves.")
            return

        if args.no_sample:
            sample_indices = None
        else:
            sample_indices, unassigned_ids = sample_by_division(
                unit_ids, args.sample_per_division, parent_of, depth_of
            )
            if unassigned_ids:
                print_unassigned(session, unassigned_ids)

        coords = run_umap(matrix, args.n_neighbors, args.min_dist, sample_indices)

        print("Aggregating parent positions...")
        positions = aggregate_parents(unit_ids, coords, children_of, parent_of)

        print("Computing corpus sequences...")
        corpus_seqs = compute_corpus_seqs(unit_ids, corpus_id_of)

        print(f"Computing leaf ancestors (heights 1–{max_height})...")
        leaf_ancestors = compute_leaf_ancestors(unit_ids, parent_of, height_of, max_height)

        non_leaf_ids = [uid for uid in positions if height_of.get(uid, 0) > 0]
        print(f"Loading labels for {len(non_leaf_ids):,} non-leaf units...")
        unit_labels = load_unit_labels(session, non_leaf_ids)

    run_id = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    write_output(
        output_dir    = output_dir,
        run_id        = run_id,
        label         = args.label,
        n_neighbors   = args.n_neighbors,
        min_dist      = args.min_dist,
        positions     = positions,
        height_of     = height_of,
        corpus_id_of  = corpus_id_of,
        corpus_seqs   = corpus_seqs,
        leaf_ancestors = leaf_ancestors,
        unit_labels   = unit_labels,
        max_height    = max_height,
    )

    print(f"\nDone. Run: {run_id}")


if __name__ == "__main__":
    main()
