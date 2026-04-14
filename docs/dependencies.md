# Dependency Management

This repo uses a uv workspace for Python dependency management.

The old `venv/` and `requirements.txt` workflow has been replaced by uv. The frontend remains npm-managed in `webapp/frontend`.

## Setup

Install uv, then run from the repo root:

```bash
uv sync --all-packages
```

uv reads `.python-version` and the workspace `pyproject.toml` files, then creates a managed `.venv/`.

## Python Commands

Run commands from the repo root so the existing flat imports keep working.

```bash
uv run python pipeline/scripts/pipeline.py --dry-run
uv run python pipeline/scripts/pipeline.py

uv run python pipeline/scripts/embeddings/build_embedding_spans.py --help
uv run python pipeline/scripts/embeddings/embed_span_nomic.py --help

uv run python -m scripts.analysis.corpus_audit --help

uv run uvicorn webapp.backend.main:app --reload
```

## Frontend Commands

```bash
cd webapp/frontend
npm install
npm run build
npm run dev
```

## Workspace Layout

- `db`: shared database models/session package.
- `pipeline`: ingestion, migrations, parsing, and embedding jobs.
- `scripts`: analysis and dimensionality-reduction utilities.
- `webapp/backend`: FastAPI backend.
- `webapp/frontend`: npm/Vite frontend.
