"""
scripts/dimreduction/run_all.py

Runner that executes all dimensionality reduction methods under a single
shared run_id. Each method writes to:
    static/dimreduction/<run_id>/<method>/

And updates its own latest pointer:
    static/dimreduction/<method>/latest.json

Usage:
    python -m scripts.dimreduction.run_all
    python -m scripts.dimreduction.run_all --methods umap pca
    python -m scripts.dimreduction.run_all --skip phate isomap
    python -m scripts.dimreduction.run_all --run-id 2026-01-01_120000
"""

import argparse
import sys
import traceback
from datetime import datetime

ALL_METHODS = ["umap", "pca", "phate", "isomap"]


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--run-id",  default=None,
                   help="Shared run ID for all methods (default: auto timestamp)")
    p.add_argument("--methods", nargs="+", choices=ALL_METHODS, default=None,
                   help="Run only these methods (default: all)")
    p.add_argument("--skip",    nargs="+", choices=ALL_METHODS, default=None,
                   help="Skip these methods")
    p.add_argument("--output-dir", default="static/dimreduction")
    return p.parse_args()


def _import_and_run(method: str, run_id: str, output_dir: str) -> None:
    """Import the compute_<method> module and call main(run_id)."""
    # Patch sys.argv so each module's parse_args() sees --output-dir.
    old_argv = sys.argv
    sys.argv = [f"scripts.dimreduction.compute_{method}",
                "--output-dir", output_dir]
    try:
        if method == "umap":
            from scripts.dimreduction.compute_umap import main
        elif method == "pca":
            from scripts.dimreduction.compute_pca import main
        elif method == "phate":
            from scripts.dimreduction.compute_phate import main
        elif method == "isomap":
            from scripts.dimreduction.compute_isomap import main
        else:
            raise ValueError(f"Unknown method: {method}")
        main(run_id=run_id)
    finally:
        sys.argv = old_argv


def main() -> None:
    args = parse_args()
    run_id = args.run_id or datetime.now().strftime("%Y-%m-%d_%H%M%S")

    methods = args.methods or ALL_METHODS
    if args.skip:
        methods = [m for m in methods if m not in args.skip]

    print(f"Run ID : {run_id}")
    print(f"Methods: {', '.join(methods)}")
    print(f"Output : {args.output_dir}")

    results: dict[str, str] = {}

    for method in methods:
        sep = "=" * 60
        print(f"\n{sep}")
        print(f"  {method.upper()}")
        print(f"{sep}")
        try:
            _import_and_run(method, run_id, args.output_dir)
            results[method] = "OK"
        except Exception:
            traceback.print_exc()
            results[method] = "FAILED"

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    for method, status in results.items():
        print(f"  {method:<12} {status}")
    print(f"\nRun ID: {run_id}")

    if any(s == "FAILED" for s in results.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
