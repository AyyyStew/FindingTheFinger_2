"""
scripts/analysis/corpus_audit.py

Corpus coverage audit script.

Outputs a timestamped report directory containing:
  - coverage_by_translation_height_depth.csv
  - coverage_by_translation.csv
  - coverage_report.html
  - run_manifest.json

Usage:
  python -m scripts.analysis.corpus_audit
  python -m scripts.analysis.corpus_audit --corpus-id 1 --corpus-id 4
  python -m scripts.analysis.corpus_audit --output-dir scripts/analysis/output --limit-top-empty 25
"""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from datetime import datetime
from html import escape
from pathlib import Path
from string import Template
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from db.models import Corpus, CorpusVersion, Unit
from db.session import get_session

DEFAULT_OUTPUT_DIR = Path("scripts/analysis/output")
DEFAULT_TOP_EMPTY = 20
TIMESTAMP_FORMAT = "%Y-%m-%d_%H%M%S"

HD_COLUMNS = [
    "corpus_id",
    "corpus_name",
    "corpus_version_id",
    "translation_name",
    "language",
    "height",
    "depth",
    "unit_count_total",
    "unit_count_nonempty",
    "unit_count_empty_or_null",
    "coverage_pct_nonempty",
    "chars_avg_nonempty",
    "chars_min_nonempty",
    "chars_max_nonempty",
    "words_avg_nonempty",
    "words_min_nonempty",
    "words_max_nonempty",
]

ROLLUP_COLUMNS = [
    "corpus_id",
    "corpus_name",
    "corpus_version_id",
    "translation_name",
    "language",
    "unit_count_total",
    "unit_count_nonempty",
    "unit_count_empty_or_null",
    "coverage_pct_nonempty",
    "chars_avg_nonempty",
    "chars_min_nonempty",
    "chars_max_nonempty",
    "words_avg_nonempty",
    "words_min_nonempty",
    "words_max_nonempty",
    "height_min",
    "height_max",
    "depth_min",
    "depth_max",
    "height_depth_group_count",
]


@dataclass(frozen=True)
class TranslationInfo:
    corpus_id: int
    corpus_name: str
    corpus_version_id: int
    translation_name: str
    language: str


@dataclass
class GroupStats:
    total: int = 0
    nonempty: int = 0
    empty_or_null: int = 0
    chars_sum: int = 0
    chars_min: int | None = None
    chars_max: int | None = None
    words_sum: int = 0
    words_min: int | None = None
    words_max: int | None = None

    def add_text(self, text: str | None) -> None:
        self.total += 1
        stripped = (text or "").strip()
        if not stripped:
            self.empty_or_null += 1
            return

        self.nonempty += 1
        chars = len(text or "")
        words = len(stripped.split())

        self.chars_sum += chars
        self.words_sum += words

        if self.chars_min is None or chars < self.chars_min:
            self.chars_min = chars
        if self.chars_max is None or chars > self.chars_max:
            self.chars_max = chars
        if self.words_min is None or words < self.words_min:
            self.words_min = words
        if self.words_max is None or words > self.words_max:
            self.words_max = words

    def to_metrics(self) -> dict[str, int | float | None]:
        if self.total != self.nonempty + self.empty_or_null:
            raise ValueError("Invariant failed: total != nonempty + empty_or_null")

        coverage = (self.nonempty / self.total) * 100.0 if self.total else 0.0
        chars_avg = (self.chars_sum / self.nonempty) if self.nonempty else None
        words_avg = (self.words_sum / self.nonempty) if self.nonempty else None

        return {
            "unit_count_total": self.total,
            "unit_count_nonempty": self.nonempty,
            "unit_count_empty_or_null": self.empty_or_null,
            "coverage_pct_nonempty": round(coverage, 4),
            "chars_avg_nonempty": round(chars_avg, 4) if chars_avg is not None else None,
            "chars_min_nonempty": self.chars_min,
            "chars_max_nonempty": self.chars_max,
            "words_avg_nonempty": round(words_avg, 4) if words_avg is not None else None,
            "words_min_nonempty": self.words_min,
            "words_max_nonempty": self.words_max,
        }


@dataclass
class NumericStats:
    count: int = 0
    total: float = 0.0
    total_sq: float = 0.0
    min_value: float | None = None
    max_value: float | None = None

    def add(self, value: float) -> None:
        self.count += 1
        self.total += value
        self.total_sq += value * value
        if self.min_value is None or value < self.min_value:
            self.min_value = value
        if self.max_value is None or value > self.max_value:
            self.max_value = value

    def mean(self) -> float | None:
        if self.count == 0:
            return None
        return self.total / self.count

    def stddev(self) -> float | None:
        if self.count == 0:
            return None
        mean = self.total / self.count
        variance = max(0.0, (self.total_sq / self.count) - (mean * mean))
        return variance ** 0.5


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit corpus translation coverage and text-length stats.")
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help=f"Base output directory (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--corpus-id",
        action="append",
        type=int,
        default=[],
        help="Restrict analysis to one corpus ID (repeatable).",
    )
    parser.add_argument(
        "--limit-top-empty",
        type=int,
        default=DEFAULT_TOP_EMPTY,
        help=f"How many most-incomplete translations to show in report (default: {DEFAULT_TOP_EMPTY}).",
    )
    return parser.parse_args()


def _safe_translation_name(name: str | None, version_id: int) -> str:
    return name if name and name.strip() else f"Version {version_id}"


def _safe_language(language: str | None) -> str:
    return language if language and language.strip() else "Unknown"


def load_translation_inventory(corpus_filters: list[int]) -> list[TranslationInfo]:
    with get_session() as session:
        stmt = (
            select(
                Corpus.id,
                Corpus.name,
                CorpusVersion.id,
                CorpusVersion.translation_name,
                CorpusVersion.language,
            )
            .join(CorpusVersion, CorpusVersion.corpus_id == Corpus.id)
            .order_by(Corpus.name, CorpusVersion.id)
        )
        if corpus_filters:
            stmt = stmt.where(Corpus.id.in_(sorted(set(corpus_filters))))

        rows = session.execute(stmt).all()

    return [
        TranslationInfo(
            corpus_id=corpus_id,
            corpus_name=corpus_name,
            corpus_version_id=version_id,
            translation_name=_safe_translation_name(translation_name, version_id),
            language=_safe_language(language),
        )
        for corpus_id, corpus_name, version_id, translation_name, language in rows
    ]


def aggregate_units(
    inventory: list[TranslationInfo],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    if not inventory:
        return [], [], []

    by_version: dict[int, TranslationInfo] = {
        item.corpus_version_id: item for item in inventory
    }
    version_ids = sorted(by_version.keys())

    hd_stats: dict[tuple[int, int, int | None, int], GroupStats] = {}
    version_stats: dict[tuple[int, int], GroupStats] = {}
    version_heights: dict[tuple[int, int], set[int]] = {}
    version_depths: dict[tuple[int, int], set[int]] = {}
    h0_chars_by_corpus: dict[int, NumericStats] = {}
    h0_words_by_corpus: dict[int, NumericStats] = {}
    h0_chars_values_by_corpus: dict[int, list[int]] = {}
    h0_words_values_by_corpus: dict[int, list[int]] = {}
    corpus_name_by_id: dict[int, str] = {item.corpus_id: item.corpus_name for item in inventory}

    with get_session() as session:
        stmt = (
            select(
                Unit.corpus_id,
                Unit.corpus_version_id,
                Unit.height,
                Unit.depth,
                Unit.text,
            )
            .where(Unit.corpus_version_id.in_(version_ids))
            .order_by(Unit.corpus_version_id, Unit.height, Unit.depth, Unit.id)
        )

        for corpus_id, version_id, height, depth, text in session.execute(stmt):
            hd_key = (corpus_id, version_id, height, depth)
            version_key = (corpus_id, version_id)

            hd_group = hd_stats.setdefault(hd_key, GroupStats())
            hd_group.add_text(text)

            version_group = version_stats.setdefault(version_key, GroupStats())
            version_group.add_text(text)

            version_heights.setdefault(version_key, set()).add(height if height is not None else -1)
            version_depths.setdefault(version_key, set()).add(depth)
            if height == 0:
                stripped = (text or "").strip()
                if stripped:
                    chars = len(text or "")
                    words = len(stripped.split())
                    h0_chars_by_corpus.setdefault(corpus_id, NumericStats()).add(float(chars))
                    h0_words_by_corpus.setdefault(corpus_id, NumericStats()).add(float(words))
                    h0_chars_values_by_corpus.setdefault(corpus_id, []).append(chars)
                    h0_words_values_by_corpus.setdefault(corpus_id, []).append(words)

    hd_rows: list[dict[str, Any]] = []
    for (corpus_id, version_id, height, depth), stats in hd_stats.items():
        info = by_version[version_id]
        row: dict[str, Any] = {
            "corpus_id": corpus_id,
            "corpus_name": info.corpus_name,
            "corpus_version_id": version_id,
            "translation_name": info.translation_name,
            "language": info.language,
            "height": height,
            "depth": depth,
        }
        row.update(stats.to_metrics())
        hd_rows.append(row)

    rollup_rows: list[dict[str, Any]] = []
    for (corpus_id, version_id), stats in version_stats.items():
        info = by_version[version_id]
        heights = version_heights.get((corpus_id, version_id), set())
        depths = version_depths.get((corpus_id, version_id), set())

        height_values = sorted([h for h in heights if h >= 0])
        depth_values = sorted(depths)

        row = {
            "corpus_id": corpus_id,
            "corpus_name": info.corpus_name,
            "corpus_version_id": version_id,
            "translation_name": info.translation_name,
            "language": info.language,
        }
        row.update(stats.to_metrics())
        row.update(
            {
                "height_min": height_values[0] if height_values else None,
                "height_max": height_values[-1] if height_values else None,
                "depth_min": depth_values[0] if depth_values else None,
                "depth_max": depth_values[-1] if depth_values else None,
                "height_depth_group_count": sum(
                    1
                    for k in hd_stats.keys()
                    if k[0] == corpus_id and k[1] == version_id
                ),
            }
        )
        rollup_rows.append(row)

    hd_rows.sort(
        key=lambda r: (
            r["corpus_name"],
            r["translation_name"],
            r["corpus_version_id"],
            r["height"] if r["height"] is not None else -1,
            r["depth"],
        )
    )
    rollup_rows.sort(
        key=lambda r: (
            r["corpus_name"],
            r["translation_name"],
            r["corpus_version_id"],
        )
    )

    h0_rows: list[dict[str, Any]] = []
    for corpus_id in sorted(corpus_name_by_id, key=lambda cid: corpus_name_by_id[cid]):
        char_stats = h0_chars_by_corpus.get(corpus_id, NumericStats())
        word_stats = h0_words_by_corpus.get(corpus_id, NumericStats())
        chars_mean = char_stats.mean()
        chars_std = char_stats.stddev()
        words_mean = word_stats.mean()
        words_std = word_stats.stddev()
        h0_rows.append(
            {
                "corpus_id": corpus_id,
                "corpus_name": corpus_name_by_id[corpus_id],
                "h0_nonempty_count": char_stats.count,
                "chars_mean_h0": round(chars_mean, 4) if chars_mean is not None else None,
                "chars_stddev_h0": round(chars_std, 4) if chars_std is not None else None,
                "chars_min_h0": int(char_stats.min_value) if char_stats.min_value is not None else None,
                "chars_max_h0": int(char_stats.max_value) if char_stats.max_value is not None else None,
                "words_mean_h0": round(words_mean, 4) if words_mean is not None else None,
                "words_stddev_h0": round(words_std, 4) if words_std is not None else None,
                "words_min_h0": int(word_stats.min_value) if word_stats.min_value is not None else None,
                "words_max_h0": int(word_stats.max_value) if word_stats.max_value is not None else None,
                "chars_values_h0": h0_chars_values_by_corpus.get(corpus_id, []),
                "words_values_h0": h0_words_values_by_corpus.get(corpus_id, []),
            }
        )
    return hd_rows, rollup_rows, h0_rows


def _csv_value(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 4)
    return value


def write_csv(path: Path, rows: list[dict[str, Any]], columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({col: _csv_value(row.get(col)) for col in columns})


def build_html_report(
    report_path: Path,
    inventory: list[TranslationInfo],
    hd_rows: list[dict[str, Any]],
    rollup_rows: list[dict[str, Any]],
    h0_rows: list[dict[str, Any]],
    limit_top_empty: int,
    run_id: str,
) -> None:
    _ = (hd_rows, rollup_rows, limit_top_empty)
    corpus_count = len({item.corpus_id for item in inventory})
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    histogram_rows = [
        {
            "corpus_id": int(row["corpus_id"]),
            "corpus_name": str(row["corpus_name"]),
            "h0_nonempty_count": int(row["h0_nonempty_count"]),
            "chars_values_h0": row["chars_values_h0"],
            "words_values_h0": row["words_values_h0"],
        }
        for row in h0_rows
    ]

    summary_rows = "\n".join(
        (
            "<tr>"
            f"<td>{escape(item['corpus_name'])}</td>"
            f"<td>{item['corpus_id']}</td>"
            f"<td>{item['h0_nonempty_count']}</td>"
            "</tr>"
        )
        for item in sorted(histogram_rows, key=lambda x: x["corpus_name"].lower())
    )

    html_template = Template(
        """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Corpus H0 Histogram Report $run_id</title>
  <style>
    :root {
      --bg: #f5f6f8;
      --panel: #ffffff;
      --text: #1f2937;
      --muted: #6b7280;
      --border: #dde3ea;
    }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      background: linear-gradient(180deg, #f7f9fc, #f2f4f7);
      color: var(--text);
    }
    main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px 18px 40px;
      display: grid;
      gap: 18px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px;
    }
    h1, h2 {
      margin: 0 0 8px;
    }
    p {
      margin: 0;
      color: var(--muted);
    }
    .kpi {
      margin-top: 10px;
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 14px;
    }
    .chart {
      height: 420px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 6px 8px;
      text-align: left;
    }
    th {
      background: #f8fafc;
    }
    .notice {
      font-size: 14px;
      color: var(--muted);
      margin: 12px 0;
    }
  </style>
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
</head>
<body>
  <main>
    <section class="panel">
      <h1>Corpus H0 Histogram Audit</h1>
      <p>Run ID: $run_id</p>
      <div class="kpi">
        <div>Generated: $generated_at</div>
        <div>Corpora: $corpus_count</div>
        <div>Translations: $translation_count</div>
      </div>
    </section>

    <section class="panel">
      <h2>Corpus H0 Coverage Counts</h2>
      <table>
        <thead>
          <tr><th>Corpus</th><th>Corpus ID</th><th>H0 Non-empty Units</th></tr>
        </thead>
        <tbody>
          $summary_rows
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2>H0 Histograms by Corpus</h2>
      <p>Overlaid normalized histograms from non-empty H0 units, aggregated per corpus.</p>
      <div id="h0CharsHist" class="chart"></div>
      <div id="h0WordsHist" class="chart"></div>
    </section>
  </main>

  <script>
    const h0Rows = $h0_rows_json;

    function buildHistogramTraces(rows, valueKey) {
      return rows
        .filter((row) => row.h0_nonempty_count > 0 && Array.isArray(row[valueKey]) && row[valueKey].length > 0)
        .map((row) => ({
          type: 'histogram',
          x: row[valueKey],
          name: row.corpus_name + ' (n=' + row.h0_nonempty_count + ')',
          histnorm: 'probability density',
          opacity: 0.45,
          nbinsx: 70
        }));
    }

    function renderHistogram(elementId, rows, valueKey, title, xaxisTitle) {
      const traces = buildHistogramTraces(rows, valueKey);
      const target = document.getElementById(elementId);
      if (traces.length === 0) {
        target.innerHTML = '<p class="notice">No non-empty H0 data available for this histogram.</p>';
        return;
      }

      Plotly.newPlot(elementId, traces, {
        title: title,
        xaxis: { title: xaxisTitle },
        yaxis: { title: 'Density' },
        barmode: 'overlay'
      });
    }

    renderHistogram(
      'h0CharsHist',
      h0Rows,
      'chars_values_h0',
      'H0 Character-Length Histograms by Corpus',
      'Characters per H0 unit'
    );

    renderHistogram(
      'h0WordsHist',
      h0Rows,
      'words_values_h0',
      'H0 Word-Length Histograms by Corpus',
      'Words per H0 unit'
    );
  </script>
</body>
</html>
"""
    )

    html = html_template.safe_substitute(
        run_id=escape(run_id),
        generated_at=escape(generated_at),
        corpus_count=str(corpus_count),
        translation_count=str(len(inventory)),
        summary_rows=summary_rows or "<tr><td colspan='3'>No corpus rows found.</td></tr>",
        h0_rows_json=json.dumps(histogram_rows),
    )

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(html, encoding="utf-8")


def write_manifest(
    manifest_path: Path,
    *,
    run_id: str,
    corpus_ids: list[int],
    limit_top_empty: int,
    inventory_count: int,
    corpus_count: int,
    hd_row_count: int,
    rollup_row_count: int,
    h0_corpus_count: int,
    output_files: list[str],
) -> None:
    manifest = {
        "run_id": run_id,
        "generated_at_local": datetime.now().isoformat(timespec="seconds"),
        "filters": {
            "corpus_id": sorted(set(corpus_ids)),
            "limit_top_empty": limit_top_empty,
        },
        "counts": {
            "corpus_count": corpus_count,
            "translation_count": inventory_count,
            "height_depth_group_count": hd_row_count,
            "translation_rollup_count": rollup_row_count,
            "h0_corpus_count": h0_corpus_count,
        },
        "outputs": output_files,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def main() -> None:
    args = parse_args()
    run_id = datetime.now().strftime(TIMESTAMP_FORMAT)
    run_dir = Path(args.output_dir) / run_id
    run_dir.mkdir(parents=True, exist_ok=False)

    print("Loading corpus/version inventory...")
    try:
        inventory = load_translation_inventory(args.corpus_id)
    except OperationalError as exc:
        print("\nDatabase connection failed while loading inventory.")
        print("Check DATABASE_URL and make sure the database server is running.")
        print(f"Error: {exc}")
        raise SystemExit(1) from exc
    if not inventory:
        print("No corpus versions found for requested filters.")
        write_manifest(
            run_dir / "run_manifest.json",
            run_id=run_id,
            corpus_ids=args.corpus_id,
            limit_top_empty=args.limit_top_empty,
            inventory_count=0,
            corpus_count=0,
            hd_row_count=0,
            rollup_row_count=0,
            h0_corpus_count=0,
            output_files=[],
        )
        print(f"Wrote empty manifest: {run_dir / 'run_manifest.json'}")
        return

    print("Aggregating unit metrics...")
    try:
        hd_rows, rollup_rows, h0_rows = aggregate_units(inventory)
    except OperationalError as exc:
        print("\nDatabase connection failed while aggregating unit metrics.")
        print("Check DATABASE_URL and make sure the database server is running.")
        print(f"Error: {exc}")
        raise SystemExit(1) from exc

    hd_csv = run_dir / "coverage_by_translation_height_depth.csv"
    rollup_csv = run_dir / "coverage_by_translation.csv"
    html_report = run_dir / "coverage_report.html"
    manifest_json = run_dir / "run_manifest.json"

    write_csv(hd_csv, hd_rows, HD_COLUMNS)
    write_csv(rollup_csv, rollup_rows, ROLLUP_COLUMNS)
    build_html_report(
        html_report,
        inventory=inventory,
        hd_rows=hd_rows,
        rollup_rows=rollup_rows,
        h0_rows=h0_rows,
        limit_top_empty=args.limit_top_empty,
        run_id=run_id,
    )
    write_manifest(
        manifest_json,
        run_id=run_id,
        corpus_ids=args.corpus_id,
        limit_top_empty=args.limit_top_empty,
        inventory_count=len(inventory),
        corpus_count=len({item.corpus_id for item in inventory}),
        hd_row_count=len(hd_rows),
        rollup_row_count=len(rollup_rows),
        h0_corpus_count=len([r for r in h0_rows if r["h0_nonempty_count"] > 0]),
        output_files=[
            hd_csv.name,
            rollup_csv.name,
            html_report.name,
            manifest_json.name,
        ],
    )

    print("\nCorpus audit complete.")
    print(f"Run directory: {run_dir}")
    print(f"- {hd_csv.name}: {len(hd_rows)} rows")
    print(f"- {rollup_csv.name}: {len(rollup_rows)} rows")
    print(f"- {html_report.name}")
    print(f"- {manifest_json.name}")


if __name__ == "__main__":
    main()
