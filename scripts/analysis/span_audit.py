"""
Audit normalized embedding span profiles.

Outputs CSV summaries for span count, length distribution, overlap, units per span,
and spans per unit by profile/corpus.

Usage:
  python -m scripts.analysis.span_audit
  python -m scripts.analysis.span_audit --output-dir scripts/analysis/output
"""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select

from db.models import Corpus, EmbeddingProfile, EmbeddingSpan, EmbeddingSpanUnit
from db.session import get_session


DEFAULT_OUTPUT_DIR = Path("scripts/analysis/output")
TIMESTAMP_FORMAT = "%Y-%m-%d_%H%M%S"

SUMMARY_COLUMNS = [
    "profile_id",
    "profile_label",
    "target_tokens",
    "overlap_tokens",
    "corpus_id",
    "corpus_name",
    "span_count",
    "tokens_min",
    "tokens_avg",
    "tokens_p95",
    "tokens_max",
    "units_per_span_avg",
    "spans_per_unit_avg",
    "overlapping_unit_link_count",
]


@dataclass
class Numeric:
    values: list[float]

    def add(self, value: float) -> None:
        self.values.append(value)

    def min(self) -> float | None:
        return min(self.values) if self.values else None

    def max(self) -> float | None:
        return max(self.values) if self.values else None

    def avg(self) -> float | None:
        return sum(self.values) / len(self.values) if self.values else None

    def p95(self) -> float | None:
        if not self.values:
            return None
        ordered = sorted(self.values)
        idx = min(len(ordered) - 1, int(len(ordered) * 0.95))
        return ordered[idx]


@dataclass
class Group:
    tokens: Numeric
    units_per_span: Numeric
    spans_by_unit: dict[int, int]
    overlapping_links: int = 0


def _round(value: float | None) -> float | None:
    return round(value, 4) if value is not None else None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit embedding span profiles.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    return parser.parse_args()


def load_summary_rows() -> list[dict[str, Any]]:
    groups: dict[tuple[int, int], Group] = {}
    profile_by_id: dict[int, EmbeddingProfile] = {}
    corpus_by_id: dict[int, str] = {}

    with get_session() as session:
        profiles = list(session.execute(select(EmbeddingProfile)).scalars())
        profile_by_id = {p.id: p for p in profiles}
        corpus_by_id = dict(session.execute(select(Corpus.id, Corpus.name)).all())

        link_rows = session.execute(
            select(
                EmbeddingSpan.id,
                EmbeddingSpan.profile_id,
                EmbeddingSpan.corpus_id,
                EmbeddingSpan.token_count,
                EmbeddingSpanUnit.unit_id,
                EmbeddingSpanUnit.char_start_in_unit,
                EmbeddingSpanUnit.char_end_in_unit,
            )
            .join(EmbeddingSpanUnit, EmbeddingSpanUnit.span_id == EmbeddingSpan.id)
        ).all()

    span_unit_counts: dict[int, int] = {}
    span_to_group: dict[int, tuple[int, int]] = {}
    seen_span_token: set[int] = set()
    for span_id, profile_id, corpus_id, token_count, unit_id, start, end in link_rows:
        key = (profile_id, corpus_id)
        span_to_group[span_id] = key
        group = groups.setdefault(key, Group(Numeric([]), Numeric([]), {}))
        group.spans_by_unit[unit_id] = group.spans_by_unit.get(unit_id, 0) + 1
        span_unit_counts[span_id] = span_unit_counts.get(span_id, 0) + 1
        if span_id not in seen_span_token:
            group.tokens.add(float(token_count))
            seen_span_token.add(span_id)
        if start is not None and end is not None and start != 0:
            group.overlapping_links += 1

    for span_id, unit_count in span_unit_counts.items():
        groups[span_to_group[span_id]].units_per_span.add(float(unit_count))

    rows: list[dict[str, Any]] = []
    for (profile_id, corpus_id), group in sorted(groups.items(), key=lambda item: (item[0][0], corpus_by_id.get(item[0][1], ""))):
        profile = profile_by_id[profile_id]
        rows.append(
            {
                "profile_id": profile_id,
                "profile_label": profile.label,
                "target_tokens": profile.target_tokens,
                "overlap_tokens": profile.overlap_tokens,
                "corpus_id": corpus_id,
                "corpus_name": corpus_by_id.get(corpus_id, "Unknown"),
                "span_count": len(group.tokens.values),
                "tokens_min": _round(group.tokens.min()),
                "tokens_avg": _round(group.tokens.avg()),
                "tokens_p95": _round(group.tokens.p95()),
                "tokens_max": _round(group.tokens.max()),
                "units_per_span_avg": _round(group.units_per_span.avg()),
                "spans_per_unit_avg": _round(
                    sum(group.spans_by_unit.values()) / len(group.spans_by_unit)
                    if group.spans_by_unit
                    else None
                ),
                "overlapping_unit_link_count": group.overlapping_links,
            }
        )
    return rows


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=SUMMARY_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    args = parse_args()
    run_id = datetime.now().strftime(TIMESTAMP_FORMAT)
    run_dir = Path(args.output_dir) / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    rows = load_summary_rows()
    write_csv(run_dir / "embedding_span_profile_audit.csv", rows)
    with (run_dir / "run_manifest.json").open("w", encoding="utf-8") as f:
        json.dump(
            {
                "run_id": run_id,
                "generated_at_local": datetime.now().isoformat(timespec="seconds"),
                "row_count": len(rows),
                "outputs": ["embedding_span_profile_audit.csv", "run_manifest.json"],
            },
            f,
            indent=2,
        )
    print(f"Wrote {run_dir}")


if __name__ == "__main__":
    main()
