# Corpus Audit Script

This folder contains a phase-1 data-audit report generator for corpus coverage.

## What it generates

Each run creates a timestamped directory under `scripts/analysis/output/` with:

- `coverage_by_translation_height_depth.csv`
- `coverage_by_translation.csv`
- `coverage_report.html`
- `run_manifest.json`

## Usage

```bash
python -m scripts.analysis.corpus_audit
python -m scripts.analysis.corpus_audit --corpus-id 1 --corpus-id 4
python -m scripts.analysis.corpus_audit --output-dir scripts/analysis/output --limit-top-empty 25
```

## Metrics included

- `unit_count_total`
- `unit_count_nonempty`
- `unit_count_empty_or_null`
- `coverage_pct_nonempty`
- `chars_avg_nonempty`, `chars_min_nonempty`, `chars_max_nonempty`
- `words_avg_nonempty`, `words_min_nonempty`, `words_max_nonempty`

Word count uses simple whitespace tokenization over trimmed text.

## Report sections

- Corpus and translation inventory
- Height/depth coverage heatmap-like tables per translation
- Most incomplete translations
- Translation-level chart summaries for coverage and text length
- H0 histogram overlays by corpus (chars and words)

## Environment notes

- Required: project DB access via `DATABASE_URL` and project Python deps (`sqlalchemy`, `python-dotenv`, models).
- Optional: internet access when opening `coverage_report.html` to load Plotly CDN assets.
  - If offline, tables still render, but charts may not.
