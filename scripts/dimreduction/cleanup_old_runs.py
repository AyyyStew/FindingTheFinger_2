"""
scripts/dimreduction/cleanup_old_runs.py

Delete older dimensionality-reduction run directories, keeping the newest run
within each output group.

The current output layout is:
    static/dimreduction/<method>/<profile>/<run_id>/
    static/dimreduction/<method>/<profile>/latest.json

Legacy layouts like:
    static/dimreduction/<method>/<run_id>/

are also handled if they are present.

Usage:
    python -m scripts.dimreduction.cleanup_old_runs
    python -m scripts.dimreduction.cleanup_old_runs --delete
    python -m scripts.dimreduction.cleanup_old_runs --keep 2 --delete
    python -m scripts.dimreduction.cleanup_old_runs --output-dir static/dimreduction
"""

from __future__ import annotations

import argparse
import json
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_OUTPUT_DIR = "static/dimreduction"
RUN_ID_FORMATS = (
    "%Y-%m-%d_%H%M%S",
    "%Y%m%d_%H%M%S",
    "%Y-%m-%d-%H%M%S",
)


@dataclass(frozen=True)
class RunDir:
    path: Path
    sort_time: float

    @property
    def run_id(self) -> str:
        return self.path.name


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Remove old dim-reduction run directories. Defaults to a dry run; "
            "pass --delete to actually remove files."
        )
    )
    p.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    p.add_argument(
        "--keep",
        type=int,
        default=1,
        help="Number of newest runs to keep in each method/profile group.",
    )
    p.add_argument(
        "--delete",
        action="store_true",
        help="Actually delete old runs. Without this flag, only prints a dry run.",
    )
    return p.parse_args()


def _timestamp_from_run_id(run_id: str) -> float | None:
    for fmt in RUN_ID_FORMATS:
        try:
            return datetime.strptime(run_id, fmt).replace(tzinfo=timezone.utc).timestamp()
        except ValueError:
            pass
    return None


def _timestamp_from_manifest(run_dir: Path) -> float | None:
    manifest_path = run_dir / "manifest.json"
    if not manifest_path.is_file():
        return None

    try:
        with open(manifest_path) as f:
            created_at = json.load(f).get("created_at")
    except (OSError, json.JSONDecodeError):
        return None

    if not isinstance(created_at, str):
        return None

    try:
        if created_at.endswith("Z"):
            created_at = f"{created_at[:-1]}+00:00"
        dt = datetime.fromisoformat(created_at)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except ValueError:
        return None


def _sort_time_for_run(run_dir: Path) -> float:
    return (
        _timestamp_from_run_id(run_dir.name)
        or _timestamp_from_manifest(run_dir)
        or run_dir.stat().st_mtime
    )


def _is_run_dir(path: Path) -> bool:
    if not path.is_dir():
        return False
    return path.joinpath("manifest.json").is_file() or _timestamp_from_run_id(path.name) is not None


def _find_run_groups(output_dir: Path) -> list[tuple[Path, list[RunDir]]]:
    groups: list[tuple[Path, list[RunDir]]] = []

    for parent in [output_dir, *output_dir.rglob("*")]:
        if not parent.is_dir():
            continue

        runs = [
            RunDir(path=child, sort_time=_sort_time_for_run(child))
            for child in parent.iterdir()
            if _is_run_dir(child)
        ]
        if runs:
            groups.append((parent, sorted(runs, key=lambda run: (run.sort_time, run.run_id), reverse=True)))

    return groups


def _write_latest(parent: Path, run_id: str, dry_run: bool) -> None:
    latest_path = parent / "latest.json"
    current_run_id = None
    if latest_path.is_file():
        try:
            with open(latest_path) as f:
                current_run_id = json.load(f).get("run_id")
        except (OSError, json.JSONDecodeError):
            current_run_id = None

    if current_run_id == run_id:
        print(f"  latest.json already points to {run_id}")
        return

    if dry_run:
        print(f"  would update {latest_path} -> {run_id}")
        return

    with open(latest_path, "w") as f:
        json.dump({"run_id": run_id}, f)
    print(f"  updated {latest_path} -> {run_id}")


def cleanup(output_dir: Path, keep: int, dry_run: bool) -> int:
    if keep < 1:
        raise ValueError("--keep must be at least 1")
    if not output_dir.is_dir():
        raise FileNotFoundError(f"Output directory does not exist: {output_dir}")

    groups = _find_run_groups(output_dir)
    if not groups:
        print(f"No dim-reduction run directories found under {output_dir}")
        return 0

    deleted_count = 0
    for parent, runs in groups:
        keepers = runs[:keep]
        stale_runs = runs[keep:]

        print(f"\n{parent}")
        print(f"  keeping: {', '.join(run.run_id for run in keepers)}")

        if stale_runs:
            for run in stale_runs:
                if dry_run:
                    print(f"  would delete {run.path}")
                else:
                    shutil.rmtree(run.path)
                    print(f"  deleted {run.path}")
                deleted_count += 1
        else:
            print("  no old runs to delete")

        if keep == 1:
            _write_latest(parent, keepers[0].run_id, dry_run)

    return deleted_count


def main() -> None:
    args = parse_args()
    dry_run = not args.delete

    if dry_run:
        print("Dry run only. Pass --delete to remove old runs.")

    deleted_count = cleanup(Path(args.output_dir), keep=args.keep, dry_run=dry_run)

    action = "Would delete" if dry_run else "Deleted"
    print(f"\n{action} {deleted_count} old run director{'y' if deleted_count == 1 else 'ies'}.")


if __name__ == "__main__":
    main()
