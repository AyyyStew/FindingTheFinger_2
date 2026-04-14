"""
scripts/dimreduction/compute_phate.py

PHATE 3D projection. Fits on a balanced sample, transforms all points.
Can optionally save the fitted operator as encoder.pkl (supports phate_op.transform()).

Requires: pip install phate

Usage:
    python -m scripts.dimreduction.compute_phate
    python -m scripts.dimreduction.compute_phate --knn 5 --decay 40
    python -m scripts.dimreduction.compute_phate --save-encoder
"""

import argparse
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np

from .shared import (
    DEFAULT_OUTPUT_DIR, DEFAULT_SAMPLE_PER_DIV,
    aggregate_parents, fold_span_positions_to_units, get_session, load_span_embeddings,
    load_unit_labels, load_unit_tree, sample_spans_by_division,
    write_method_output,
)

METHOD_NAME   = "phate"
DEFAULT_KNN   = 5
DEFAULT_DECAY = 40


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--run-id",              default=None)
    p.add_argument("--label",               default=None)
    p.add_argument("--knn",                 type=int,   default=DEFAULT_KNN)
    p.add_argument("--decay",               type=int,   default=DEFAULT_DECAY)
    p.add_argument("--sample-per-division", type=int,   default=DEFAULT_SAMPLE_PER_DIV)
    p.add_argument("--no-sample",           action="store_true")
    p.add_argument("--profile",             default="window-50")
    p.add_argument("--save-encoder",        action="store_true",
                   help="Save fitted encoder.pkl (default: off)")
    p.add_argument("--output-dir",          default=DEFAULT_OUTPUT_DIR)
    return p.parse_args()


def run_phate(matrix: np.ndarray, knn: int, decay: int,
              sample_indices: np.ndarray | None = None):
    import phate

    fit_matrix = matrix[sample_indices] if sample_indices is not None else matrix
    label = (f"sample n={len(fit_matrix):,}" if sample_indices is not None
             else f"all n={len(matrix):,}")
    print(f"\nFitting PHATE  knn={knn}  decay={decay}  on {label}...")

    phate_op = phate.PHATE(
        n_components=3,
        knn=knn,
        decay=decay,
        n_jobs=-1,
        verbose=True,
    )
    phate_op.fit(fit_matrix)

    print(f"  Fit done. Transforming all {len(matrix):,} points...")
    coords = np.array(phate_op.transform(matrix), dtype=np.float32)
    print(f"  Done.  x∈[{coords[:,0].min():.3f}, {coords[:,0].max():.3f}]"
          f"  y∈[{coords[:,1].min():.3f}, {coords[:,1].max():.3f}]"
          f"  z∈[{coords[:,2].min():.3f}, {coords[:,2].max():.3f}]")
    return phate_op, coords


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

        span_ids, matrix, span_meta, profile = load_span_embeddings(session, args.profile)

        if args.no_sample:
            sample_indices = None
        else:
            sample_indices, unassigned_ids = sample_spans_by_division(
                span_ids, span_meta, args.sample_per_division, parent_of, depth_of
            )
            if unassigned_ids:
                print(f"  Warning: {len(unassigned_ids):,} spans skipped from sample")

        phate_op, coords = run_phate(matrix, args.knn, args.decay, sample_indices)
        span_positions = {span_id: coords[i] for i, span_id in enumerate(span_ids)}
        unit_ids, unit_coords = fold_span_positions_to_units(session, span_ids, coords)

        print("Aggregating parent positions...")
        positions = aggregate_parents(unit_ids, unit_coords, children_of, parent_of)

        non_leaf_ids = [uid for uid in positions if height_of.get(uid, 0) > 0]
        print(f"Loading labels for {len(non_leaf_ids):,} non-leaf units...")
        unit_labels = load_unit_labels(session, non_leaf_ids)

    write_method_output(
        base_output_dir = output_dir,
        run_id          = run_id,
        method_name     = METHOD_NAME,
        manifest_extra  = {
            "label":   args.label,
            "knn":     args.knn,
            "decay":   args.decay,
            "sampled": sample_indices is not None,
        },
        positions       = positions,
        depth_of        = depth_of,
        corpus_id_of    = corpus_id_of,
        corpus_version_id_of = corpus_version_id_of,
        unit_labels     = unit_labels,
        n_components    = 3,
        span_positions  = span_positions,
        span_meta       = span_meta,
        profile         = profile,
    )

    if args.save_encoder:
        encoder_path = output_dir / METHOD_NAME / profile.label / run_id / "encoder.pkl"
        joblib.dump(phate_op, encoder_path)
        print(f"  encoder.pkl  saved")
    else:
        print("  encoder.pkl  skipped (use --save-encoder to enable)")

    print(f"\nDone. Run: {run_id}")


if __name__ == "__main__":
    main()
