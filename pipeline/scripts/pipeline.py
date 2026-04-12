#!/usr/bin/env python3
"""
scripts/pipeline.py

Ordered, reproducible pipeline runner.

This runner keeps the canonical ingest order in scripts/ingest_all.py and
provides a stable place to append future pipeline steps.

Usage:
    ./venv/bin/python pipeline/scripts/pipeline.py
    ./venv/bin/python pipeline/scripts/pipeline.py --list
    ./venv/bin/python pipeline/scripts/pipeline.py --only ingest_all
    ./venv/bin/python pipeline/scripts/pipeline.py --dry-run
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


# Allow running from any cwd
_pipeline_root = str(Path(__file__).resolve().parents[1])
_repo_root = str(Path(__file__).resolve().parents[2])
for _p in (_pipeline_root, _repo_root):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from db.session import get_session
from pipeline.sources.catalog import get_source_entry

StepFn = Callable[[], None]


@dataclass(frozen=True)
class Step:
    id: str
    description: str
    fn: StepFn


def _step_ingest_all() -> None:
    ingest_path = Path(__file__).resolve().parent / "ingest_all.py"
    spec = importlib.util.spec_from_file_location("pipeline_ingest_all", ingest_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load ingest script: {ingest_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.main()


def _step_verify_sources() -> None:
    """
    Sanity-check normalized source linkage after ingest.
    This is intentionally strict to preserve reproducibility.
    """
    from sqlalchemy import text

    with get_session() as s:
        nulls = int(s.execute(text("SELECT COUNT(*) FROM corpus_version WHERE source_id IS NULL")).scalar_one())
        if nulls:
            raise RuntimeError(f"source verification failed: {nulls} corpus_version rows have NULL source_id")

        missing_refs = int(s.execute(text("""
            SELECT COUNT(*)
            FROM corpus_version cv
            LEFT JOIN source_ref sr ON sr.id = cv.source_id
            WHERE sr.id IS NULL
        """)).scalar_one())
        if missing_refs:
            raise RuntimeError(
                f"source verification failed: {missing_refs} corpus_version rows point to missing source_ref"
            )

        rows = s.execute(text("""
            SELECT c.name, cv.translation_name
            FROM corpus_version cv
            JOIN corpus c ON c.id = cv.corpus_id
        """)).all()

        # Ensure every ingested version has an explicit catalog mapping.
        # This prevents accidental drift as new corpora are added.
        for corpus_name, translation_name in rows:
            get_source_entry(corpus_name, translation_name)

    print("source verification passed")


STEPS: list[Step] = [
    Step(
        id="ingest_all",
        description="Run canonical ordered corpus ingest",
        fn=_step_ingest_all,
    ),
    Step(
        id="verify_sources",
        description="Verify normalized source_ref linkage and catalog coverage",
        fn=_step_verify_sources,
    ),
]


def _step_ids() -> list[str]:
    return [s.id for s in STEPS]


def _index_of(step_id: str) -> int:
    for i, s in enumerate(STEPS):
        if s.id == step_id:
            return i
    raise ValueError(f"Unknown step: {step_id!r}. Valid steps: {', '.join(_step_ids())}")


def _resolve_selected_steps(args: argparse.Namespace) -> list[Step]:
    if args.only:
        idx = _index_of(args.only)
        selected = [STEPS[idx]]
    else:
        start = _index_of(args.from_step) if args.from_step else 0
        end = _index_of(args.to_step) if args.to_step else len(STEPS) - 1
        if end < start:
            raise ValueError("--to must be at or after --from")
        selected = STEPS[start : end + 1]

    if args.skip:
        skip_set = set(args.skip)
        selected = [s for s in selected if s.id not in skip_set]
    return selected


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="FindingTheFinger ordered pipeline runner")
    p.add_argument("--list", action="store_true", help="List steps and exit")
    p.add_argument("--dry-run", action="store_true", help="Print selected steps but do not execute")
    p.add_argument("--only", choices=_step_ids(), help="Run exactly one step")
    p.add_argument("--from", dest="from_step", choices=_step_ids(), help="Start from this step")
    p.add_argument("--to", dest="to_step", choices=_step_ids(), help="Stop at this step")
    p.add_argument("--skip", action="append", choices=_step_ids(), help="Skip one or more steps")
    return p


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    if args.list:
        print("Pipeline steps:")
        for i, step in enumerate(STEPS, start=1):
            print(f"{i:>2}. {step.id:<16} {step.description}")
        return

    selected = _resolve_selected_steps(args)
    if not selected:
        print("No steps selected.")
        return

    print("=" * 72)
    print("  FindingTheFinger Pipeline Runner")
    print("=" * 72)
    print("Selected steps:")
    for i, step in enumerate(selected, start=1):
        print(f"  [{i}/{len(selected)}] {step.id} - {step.description}")

    if args.dry_run:
        print("\nDry run complete.")
        return

    for i, step in enumerate(selected, start=1):
        print(f"\n--- [{i}/{len(selected)}] {step.id} ---")
        t0 = time.perf_counter()
        try:
            step.fn()
        except Exception as exc:
            dt = time.perf_counter() - t0
            print(f"FAILED: {step.id} after {dt:.2f}s")
            print(f"ERROR: {exc}")
            raise
        dt = time.perf_counter() - t0
        print(f"OK: {step.id} ({dt:.2f}s)")

    print("\nPipeline complete.")


if __name__ == "__main__":
    main()
