"""
scripts/dimreduction/compute_pca.py

PCA projection. Fits on ALL points (PCA is cheap at any n).
Retains enough principal components to explain at least --variance-threshold
of total variance (default 0.95), capped at --max-components.

Stores all K retained components per unit in the binary output.
Frontend picks any two PCs to use as X/Y axes.

Usage:
    python -m scripts.dimreduction.compute_pca
    python -m scripts.dimreduction.compute_pca --variance-threshold 0.90
    python -m scripts.dimreduction.compute_pca --max-components 30
"""

import argparse
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np

from .shared import (
    DEFAULT_OUTPUT_DIR,
    aggregate_parents, compute_corpus_seqs, compute_leaf_ancestors,
    get_session, load_embeddings, load_unit_labels, load_unit_tree,
    write_method_output,
)

METHOD_NAME               = "pca"
DEFAULT_VARIANCE_THRESHOLD = 0.95
DEFAULT_MAX_COMPONENTS     = 50


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--run-id",              default=None)
    p.add_argument("--label",               default=None)
    p.add_argument("--variance-threshold",  type=float, default=DEFAULT_VARIANCE_THRESHOLD,
                   help="Retain PCs until cumulative explained variance >= this (default: 0.95)")
    p.add_argument("--max-components",      type=int,   default=DEFAULT_MAX_COMPONENTS,
                   help="Hard cap on number of PCs retained (default: 50)")
    p.add_argument("--save-encoder",        action="store_true",
                   help="Save fitted encoder.pkl (default: off)")
    p.add_argument("--output-dir",          default=DEFAULT_OUTPUT_DIR)
    return p.parse_args()


def run_pca(matrix: np.ndarray, variance_threshold: float, max_components: int):
    from sklearn.decomposition import PCA

    # Fit with max_components first to get variance ratios cheaply.
    n_fit = min(max_components, matrix.shape[1], matrix.shape[0])
    print(f"\nFitting PCA  n_components={n_fit}  on all {len(matrix):,} points...")
    pca = PCA(n_components=n_fit, random_state=42)
    pca.fit(matrix)

    # Find elbow: fewest PCs that cover variance_threshold.
    cumvar = np.cumsum(pca.explained_variance_ratio_)
    n_keep = int(np.searchsorted(cumvar, variance_threshold) + 1)
    n_keep = min(n_keep, n_fit)
    print(f"  {n_fit} PCs fitted  |  keeping {n_keep} PCs "
          f"(cumulative variance: {cumvar[n_keep-1]:.3f} ≥ {variance_threshold})")

    # Refit with exact n_keep so transform output has the right shape.
    pca_final = PCA(n_components=n_keep, random_state=42)
    coords = pca_final.fit_transform(matrix).astype(np.float32)  # (N, n_keep)

    print(f"  PC1 range: [{coords[:,0].min():.3f}, {coords[:,0].max():.3f}]")
    print(f"  PC2 range: [{coords[:,1].min():.3f}, {coords[:,1].max():.3f}]")
    return pca_final, coords, n_keep


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

        pca, coords, n_components = run_pca(
            matrix, args.variance_threshold, args.max_components
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
            "label":                 args.label,
            "variance_threshold":    args.variance_threshold,
            "explained_variance_ratio": pca.explained_variance_ratio_.tolist(),
            "cumulative_variance":   np.cumsum(pca.explained_variance_ratio_).tolist(),
        },
        positions       = positions,
        height_of       = height_of,
        depth_of        = depth_of,
        corpus_id_of    = corpus_id_of,
        corpus_seqs     = corpus_seqs,
        leaf_ancestors  = leaf_ancestors,
        unit_labels     = unit_labels,
        max_height      = max_height,
        n_components    = n_components,
    )

    if args.save_encoder:
        encoder_path = output_dir / METHOD_NAME / run_id / "encoder.pkl"
        joblib.dump(pca, encoder_path)
        print(f"  encoder.pkl  saved")
    else:
        print("  encoder.pkl  skipped (use --save-encoder to enable)")

    print(f"\nDone. Run: {run_id}")


if __name__ == "__main__":
    main()
