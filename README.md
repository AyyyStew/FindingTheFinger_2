# Finding The Finger

Finding The Finger is a text-ingestion and exploration project for comparing religious, philosophical, and historical corpora across a shared semantic space.

At a high level, this repo:

- ingests source texts into a Postgres database with a hierarchical unit model
- stores corpus metadata, taxonomy labels, versions, and embeddings
- generates derived embedding spans and dimensionality-reduction artifacts
- serves a FastAPI backend for search and text navigation
- serves a Vite/React frontend for browsing corpora, reading passages, and exploring projection maps

## What Is In Here

- `db/`: shared SQLAlchemy models and DB session setup
- `pipeline/`: ingest logic, parsers, migrations, source catalog, and embedding jobs
- `scripts/`: analysis tools and dimensionality-reduction generation scripts
- `webapp/backend/`: FastAPI API used by the frontend
- `webapp/frontend/`: Vite + React UI
- `data/`: source files used by parsers
- `static/`: precomputed map/projection assets consumed by the frontend
- `docs/`: repo notes, including dependency setup

## Mental Model

The repo is easiest to understand as a pipeline:

1. Raw source files live in `data/`.
2. Corpus-specific parsers in `pipeline/pipeline/parsers/` convert those files into a normalized tree structure.
3. `pipeline/scripts/ingest_all.py` seeds taxonomy data and writes corpora, versions, and units into Postgres.
4. Embedding jobs build vector representations for units or derived spans.
5. Dimensionality-reduction scripts write projection artifacts into `static/dimreduction/`.
6. The FastAPI backend exposes corpora, units, search, compare, and projection-related metadata.
7. The React frontend consumes those APIs and static assets to power the explorer UI.

## Data Model In One Minute

The central tables are defined in `db/models.py`.

- `taxonomy`: classification tree like `Abrahamic -> Christianity`
- `corpus`: canonical text identity like `Bible` or `Quran`
- `corpus_version`: a specific edition or translation of a corpus
- `corpus_level`: names for hierarchy levels like `Book`, `Chapter`, `Verse`
- `unit`: every node in a text tree, from top-level sections down to leaves
- `method`: embedding method metadata
- `embedding`: legacy unit-level vectors
- `embedding_profile`, `embedding_span`, `span_embedding`: normalized span-based embedding pipeline

The important distinction is:

- `corpus` is the text as a concept
- `corpus_version` is a specific translation or edition
- `unit` is an addressable node inside that version’s text tree

## Web App Surface

The frontend routes currently map to a few main workflows:

- `/map`: semantic map explorer with UMAP, PCA, PHATE, and Isomap projections
- `/corpus`: grouped corpus browser
- `/corpus/:id`: expandable corpus tree by version
- `/read/:unitId`: passage reader with breadcrumbs, source metadata, and leaf traversal
- `/about`, `/colors`: supporting pages/utilities

The backend entry point is `webapp/backend/main.py`, and the main routers are:

- `webapp/backend/routers/corpora.py`
- `webapp/backend/routers/units.py`
- `webapp/backend/routers/search.py`

## Setup

### Prereqs

- Python `3.13`
- `uv`
- Node/npm
- PostgreSQL

This repo uses a `uv` workspace for Python packages and `npm` for the frontend.

### Python dependencies

From the repo root:

```bash
uv sync --all-packages
```

### Frontend dependencies

```bash
cd webapp/frontend
npm install
```

## Configuration

Database configuration is read from `DATABASE_URL`.

Default if unset:

```text
postgresql+psycopg://ftf:ftf@localhost:5432/ftf
```

That default comes from `db/session.py`, so a local Postgres database with matching credentials is the easiest path unless you set your own env var or `.env`.

## Running Things

Run commands from the repo root unless noted otherwise.

### Backend

```bash
uv run uvicorn webapp.backend.main:app --reload
```

Backend default local URL:

```text
http://127.0.0.1:8000
```

### Frontend

In a second terminal:

```bash
cd webapp/frontend
npm run dev
```

Frontend default local URL:

```text
http://127.0.0.1:5173
```

The backend currently allows CORS from `http://localhost:5173`.

## Ingest And Processing

### Canonical ingest

```bash
uv run python pipeline/scripts/pipeline.py
```

Useful variants:

```bash
uv run python pipeline/scripts/pipeline.py --list
uv run python pipeline/scripts/pipeline.py --dry-run
uv run python pipeline/scripts/pipeline.py --only ingest_all
```

The current pipeline runner wraps:

- `ingest_all`: seed taxonomy and ingest corpus data
- `verify_sources`: verify `source_ref` normalization and source catalog coverage

### Embeddings

Embedding-related scripts live under `pipeline/scripts/embeddings/`.

Examples:

```bash
uv run python pipeline/scripts/embeddings/build_embedding_spans.py --help
uv run python pipeline/scripts/embeddings/embed_span_nomic.py --help
uv run python pipeline/scripts/embeddings/embed_nomic.py --help
```

### Dimensionality reduction

Projection scripts live under `scripts/dimreduction/`.

Examples:

```bash
uv run python scripts/dimreduction/run_all.py --help
uv run python scripts/dimreduction/compute_umap.py --help
```

These jobs populate `static/dimreduction/`, which the map UI reads directly.

## Notable Source/Asset Conventions

- Some corpora come from CSV, TXT, HTML, EPUB, PDF, or SQLite/DB sources.
- `scripts/download_sggs.sh` exists because the Sri Guru Granth Sahib source DB is too large to keep in git.
- `pipeline/sources/catalog.py` is the normalized source catalog used to map ingested corpora/versions back to provenance metadata.
- `static/` contains generated artifacts, not just hand-authored assets.

## Useful Commands

```bash
uv run python -m scripts.analysis.corpus_audit --help
uv run python -m scripts.analysis.span_audit --help
uv run python -m scripts.analysis.taxonomy_tree --help
```

## Deployment

The intended production path is now a cheap single-VPS deployment:

- `docker-compose.yml`: runtime stack for `web`, `backend`, and `postgres`
- `deploy/`: Dockerfiles, Caddy config, and Postgres bootstrap restore hook
- `infra/terraform/`: Hetzner server/firewall scaffolding plus optional R2 bucket resources
- `docs/deployment.md`: deployment workflow, release artifact flow, and resize guidance

The intended model is:

- keep ingest, embedding generation, and dim reduction off the VPS
- store projection artifacts and SQL dump artifacts in R2
- restore the database from a versioned dump instead of recomputing embeddings on the server
- drive Terraform from the repo `.env` instead of ad hoc shell exports
- let Terraform register and attach the Hetzner SSH key from a local `.pub` file when desired
- terminate origin TLS on the VPS so Cloudflare can use `Full (strict)`

Canonical order:

1. create a DB dump from the known-good source database
2. validate locally with restore + smoke gates
3. upload `static/dimreduction` and the dump to R2
4. provision the Hetzner VPS with Terraform
5. set the deploy `.env` with the exact `VITE_STATIC_BASE_URL` and `DB_RESTORE_URL`
6. run `./scripts/deploy/deploy_vps.sh`

Operational detail lives in [docs/deployment.md](/home/alexs/Projects/WebProjects/FindingTheFinger_2/docs/deployment.md). `README.md` should stay high-level.

Local-only files are intentionally not part of the committed deploy contract:

- `.env`
- `infra/terraform/terraform.tfvars`
- Terraform state and `.terraform/`
- caches, backups, and generated runtime junk

Local helper scripts still exist, but they are support tooling for the release/deploy path, not a separate deployment model.

## Current Reality

This repo already has a lot of the hard parts in place, but it helps to know what kind of project you are walking into:

- It is a multi-stage research/prototype codebase, not a polished product scaffold.
- There are older and newer embedding paths in parallel, including legacy unit embeddings and newer span embeddings.
- There are many precomputed static artifacts checked in under `static/dimreduction/`.
- Some setup assumptions still live in code rather than in dedicated env examples or container config.

So if something feels a little archaeological, that is not you. The repo really is carrying pipeline, data, backend, and frontend concerns all at once.

## Suggested Next Cleanup Passes

- split “first-time setup” from “daily dev workflow”
- add a lightweight architecture diagram
- tighten the release tooling around R2 uploads and dump verification
