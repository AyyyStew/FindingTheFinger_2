"""
scripts/dimreduction/compute_umap.py

UMAP 3D projection. Fits on a balanced sample, transforms all points,
aggregates parent positions by mean, writes binary output.
Can optionally save the fitted reducer as encoder.pkl for later transform().

Usage:
    python -m scripts.dimreduction.compute_umap
    python -m scripts.dimreduction.compute_umap --run-id 2026-01-01_120000
    python -m scripts.dimreduction.compute_umap --n-neighbors 15 --min-dist 0.1
    python -m scripts.dimreduction.compute_umap --no-sample
    python -m scripts.dimreduction.compute_umap --save-encoder
    python -m scripts.dimreduction.compute_umap --dry-run
"""

import argparse
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np

from .shared import (
    DEFAULT_OUTPUT_DIR, DEFAULT_SAMPLE_PER_DIV, RANDOM_STATE,
    aggregate_parents, compute_corpus_seqs, compute_leaf_ancestors,
    get_session, load_embeddings, load_unit_labels, load_unit_tree,
    print_unassigned, sample_by_division, write_method_output,
)

METHOD_NAME        = "umap"
DEFAULT_N_NEIGHBORS = 15
DEFAULT_MIN_DIST    = 0.1
UMAP_METRIC         = "cosine"


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--run-id",              default=None)
    p.add_argument("--label",               default=None)
    p.add_argument("--n-neighbors",         type=int,   default=DEFAULT_N_NEIGHBORS)
    p.add_argument("--min-dist",            type=float, default=DEFAULT_MIN_DIST)
    p.add_argument("--sample-per-division", type=int,   default=DEFAULT_SAMPLE_PER_DIV)
    p.add_argument("--no-sample",           action="store_true")
    p.add_argument("--dry-run",             action="store_true")
    p.add_argument("--save-encoder",        action="store_true",
                   help="Save fitted encoder.pkl (default: off)")
    p.add_argument("--output-dir",          default=DEFAULT_OUTPUT_DIR)
    return p.parse_args()


def run_umap(matrix: np.ndarray, n_neighbors: int, min_dist: float,
             sample_indices: np.ndarray | None = None):
    import umap as umap_lib

    fit_matrix = matrix[sample_indices] if sample_indices is not None else matrix
    label = (f"sample n={len(fit_matrix):,}" if sample_indices is not None
             else f"all n={len(matrix):,}")
    print(f"\nFitting UMAP  n_neighbors={n_neighbors}  min_dist={min_dist}"
          f"  metric={UMAP_METRIC}  on {label}...")

    reducer = umap_lib.UMAP(
        n_components=3,
        n_neighbors=n_neighbors,
        min_dist=min_dist,
        metric=UMAP_METRIC,
        random_state=RANDOM_STATE,
        verbose=True,
    )
    reducer.fit(fit_matrix)

    print(f"  Fit done. Transforming all {len(matrix):,} points...")
    coords = np.array(reducer.transform(matrix), dtype=np.float32)
    print(f"  Done.  x∈[{coords[:,0].min():.3f}, {coords[:,0].max():.3f}]"
          f"  y∈[{coords[:,1].min():.3f}, {coords[:,1].max():.3f}]"
          f"  z∈[{coords[:,2].min():.3f}, {coords[:,2].max():.3f}]")
    return reducer, coords


def main(run_id: str | None = None) -> None:
    args = parse_args()
    if run_id is None:
        run_id = args.run_id or datetime.now().strftime("%Y-%m-%d_%H%M%S")
    output_dir = Path(args.output_dir)

    with get_session() as session:
        (
            parent_of,
            children_of,
            height_of,
            depth_of,
            corpus_id_of,
            corpus_version_id_of,
        ) = load_unit_tree(session)
        max_height = max(height_of.values()) if height_of else 0
        print(f"  max height: {max_height}")

        unit_ids, matrix = load_embeddings(session)

        if args.dry_run:
            if not args.no_sample:
                sample_indices, _ = sample_by_division(
                    unit_ids, args.sample_per_division, parent_of, depth_of
                )
                print(f"\nDry run: would fit UMAP on {len(sample_indices):,} sampled, "
                      f"transform all {len(unit_ids):,}.")
            else:
                print(f"\nDry run: would fit+transform UMAP on all {len(unit_ids):,}.")
            return

        if args.no_sample:
            sample_indices = None
        else:
            sample_indices, unassigned_ids = sample_by_division(
                unit_ids, args.sample_per_division, parent_of, depth_of
            )
            if unassigned_ids:
                print_unassigned(session, unassigned_ids)

        reducer, coords = run_umap(matrix, args.n_neighbors, args.min_dist, sample_indices)

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
            "label":      args.label,
            "n_neighbors": args.n_neighbors,
            "min_dist":   args.min_dist,
            "metric":     UMAP_METRIC,
            "sampled":    sample_indices is not None,
        },
        positions       = positions,
        height_of       = height_of,
        depth_of        = depth_of,
        corpus_id_of    = corpus_id_of,
        corpus_version_id_of = corpus_version_id_of,
        corpus_seqs     = corpus_seqs,
        leaf_ancestors  = leaf_ancestors,
        unit_labels     = unit_labels,
        max_height      = max_height,
        n_components    = 3,
    )

    if args.save_encoder:
        # Save encoder for later transform()
        encoder_path = output_dir / METHOD_NAME / run_id / "encoder.pkl"
        joblib.dump(reducer, encoder_path)
        print(f"  encoder.pkl  saved")
    else:
        print("  encoder.pkl  skipped (use --save-encoder to enable)")

    print(f"\nDone. Run: {run_id}")


if __name__ == "__main__":
    main()
