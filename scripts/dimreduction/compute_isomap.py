"""
scripts/dimreduction/compute_isomap.py

Isomap 3D projection. Fits on a balanced sample using sklearn's Isomap,
transforms all points via kernel approximation. Can optionally save encoder.pkl.

Isomap builds a kNN graph, so fitting is O(n_sample²) — the balanced
sample keeps this tractable. Transform on new points uses the Nyström
kernel approximation built into sklearn.

Usage:
    python -m scripts.dimreduction.compute_isomap
    python -m scripts.dimreduction.compute_isomap --n-neighbors 10
    python -m scripts.dimreduction.compute_isomap --save-encoder
"""

import argparse
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np

from .shared import (
    DEFAULT_OUTPUT_DIR, DEFAULT_SAMPLE_PER_DIV,
    aggregate_parents, compute_corpus_seqs, compute_leaf_ancestors,
    get_session, load_embeddings, load_unit_labels, load_unit_tree,
    print_unassigned, sample_by_division, write_method_output,
)

METHOD_NAME          = "isomap"
DEFAULT_N_NEIGHBORS  = 10
DEFAULT_N_JOBS       = 1
DEFAULT_PATH_METHOD  = "D"
DEFAULT_EIGEN_SOLVER = "arpack"
DEFAULT_TRANSFORM_BATCH_SIZE = 2048


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--run-id",              default=None)
    p.add_argument("--label",               default=None)
    p.add_argument("--n-neighbors",         type=int, default=DEFAULT_N_NEIGHBORS)
    p.add_argument("--n-jobs",              type=int, default=DEFAULT_N_JOBS,
                   help="Parallel jobs used by Isomap neighbor graph build")
    p.add_argument("--path-method",         choices=["auto", "D", "FW"], default=DEFAULT_PATH_METHOD,
                   help="Shortest-path algorithm for geodesic distances")
    p.add_argument("--eigen-solver",        choices=["auto", "arpack", "dense"], default=DEFAULT_EIGEN_SOLVER,
                   help="Eigen solver used in kernel PCA step")
    p.add_argument("--transform-batch-size", type=int, default=DEFAULT_TRANSFORM_BATCH_SIZE,
                   help="Batch size for iso.transform over all points to cap RAM usage")
    p.add_argument("--sample-per-division", type=int, default=DEFAULT_SAMPLE_PER_DIV)
    p.add_argument("--no-sample",           action="store_true")
    p.add_argument("--save-encoder",        action="store_true",
                   help="Save fitted encoder.pkl (default: off)")
    p.add_argument("--output-dir",          default=DEFAULT_OUTPUT_DIR)
    return p.parse_args()


def _transform_in_batches(iso, matrix: np.ndarray, batch_size: int) -> np.ndarray:
    if batch_size <= 0 or batch_size >= len(matrix):
        return np.array(iso.transform(matrix), dtype=np.float32)

    n = len(matrix)
    out = np.empty((n, 3), dtype=np.float32)
    n_batches = (n + batch_size - 1) // batch_size
    for bi, start in enumerate(range(0, n, batch_size), start=1):
        end = min(start + batch_size, n)
        out[start:end] = np.array(iso.transform(matrix[start:end]), dtype=np.float32)
        print(f"    transform batch {bi}/{n_batches}  rows {start:,}:{end:,}")
    return out


def run_isomap(matrix: np.ndarray, n_neighbors: int,
               sample_indices: np.ndarray | None = None,
               n_jobs: int = DEFAULT_N_JOBS,
               path_method: str = DEFAULT_PATH_METHOD,
               eigen_solver: str = DEFAULT_EIGEN_SOLVER,
               transform_batch_size: int = DEFAULT_TRANSFORM_BATCH_SIZE):
    from sklearn.manifold import Isomap

    fit_matrix = matrix[sample_indices] if sample_indices is not None else matrix
    label = (f"sample n={len(fit_matrix):,}" if sample_indices is not None
             else f"all n={len(matrix):,}")
    print(
        f"\nFitting Isomap  n_neighbors={n_neighbors}  n_jobs={n_jobs}"
        f"  path_method={path_method}  eigen_solver={eigen_solver}  on {label}..."
    )

    iso = Isomap(
        n_components=3,
        n_neighbors=n_neighbors,
        n_jobs=n_jobs,
        path_method=path_method,
        eigen_solver=eigen_solver,
    )
    iso.fit(fit_matrix)

    print(f"  Fit done. Transforming all {len(matrix):,} points...")
    if 0 < transform_batch_size < len(matrix):
        print(f"  Using batched transform  batch_size={transform_batch_size:,}")
    coords = _transform_in_batches(iso, matrix, transform_batch_size)
    print(f"  Done.  x∈[{coords[:,0].min():.3f}, {coords[:,0].max():.3f}]"
          f"  y∈[{coords[:,1].min():.3f}, {coords[:,1].max():.3f}]"
          f"  z∈[{coords[:,2].min():.3f}, {coords[:,2].max():.3f}]")
    return iso, coords


def main(run_id: str | None = None) -> None:
    args = parse_args()
    if run_id is None:
        run_id = args.run_id or datetime.now().strftime("%Y-%m-%d_%H%M%S")
    output_dir = Path(args.output_dir)

    with get_session() as session:
        parent_of, children_of, height_of, depth_of, corpus_id_of = load_unit_tree(session)
        max_height = max(height_of.values()) if height_of else 0
        print(f"  max height: {max_height}")

        unit_ids, matrix = load_embeddings(session)

        if args.no_sample:
            sample_indices = None
        else:
            sample_indices, unassigned_ids = sample_by_division(
                unit_ids, args.sample_per_division, parent_of, depth_of
            )
            if unassigned_ids:
                print_unassigned(session, unassigned_ids)

        iso, coords = run_isomap(
            matrix,
            args.n_neighbors,
            sample_indices,
            n_jobs=args.n_jobs,
            path_method=args.path_method,
            eigen_solver=args.eigen_solver,
            transform_batch_size=args.transform_batch_size,
        )

        print("Aggregating parent positions...")
        positions = aggregate_parents(unit_ids, coords, children_of, parent_of)

        print("Computing corpus sequences...")
        corpus_seqs = compute_corpus_seqs(unit_ids, corpus_id_of)

        print(f"Computing leaf ancestors (heights 1–{max_height})...")
        leaf_ancestors = compute_leaf_ancestors(unit_ids, parent_of, height_of, max_height)

        non_leaf_ids = [uid for uid in positions if height_of.get(uid, 0) > 0]
        print(f"Loading labels for {len(non_leaf_ids):,} non-leaf units...")
        unit_labels = load_unit_labels(session, non_leaf_ids)

    write_method_output(
        base_output_dir = output_dir,
        run_id          = run_id,
        method_name     = METHOD_NAME,
        manifest_extra  = {
            "label":       args.label,
            "n_neighbors": args.n_neighbors,
            "n_jobs":      args.n_jobs,
            "path_method": args.path_method,
            "eigen_solver": args.eigen_solver,
            "transform_batch_size": args.transform_batch_size,
            "sampled":     sample_indices is not None,
        },
        positions       = positions,
        height_of       = height_of,
        depth_of        = depth_of,
        corpus_id_of    = corpus_id_of,
        corpus_seqs     = corpus_seqs,
        leaf_ancestors  = leaf_ancestors,
        unit_labels     = unit_labels,
        max_height      = max_height,
        n_components    = 3,
    )

    if args.save_encoder:
        encoder_path = output_dir / METHOD_NAME / run_id / "encoder.pkl"
        joblib.dump(iso, encoder_path)
        print(f"  encoder.pkl  saved")
    else:
        print("  encoder.pkl  skipped (use --save-encoder to enable)")

    print(f"\nDone. Run: {run_id}")


if __name__ == "__main__":
    main()
