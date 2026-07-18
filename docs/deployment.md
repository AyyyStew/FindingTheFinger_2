# Deployment

This repo now has one intended production path:

1. Produce a release bundle offline.
2. Provision one Hetzner VPS with Terraform.
3. Deploy the repo to the VPS with one `.env`.
4. Verify the live app.

The deploy MVP is intentionally simple:

- app: `https://findingthefinger.ayyystew.com`
- static + DB artifact host: `https://static.findingthefinger.ayyystew.com`
- runtime stack: `web` + `backend` + `postgres`
- R2 is the source of truth for projection assets and DB dumps

## Working Mental Model

Some behavior here is intentional compatibility glue, not accidental drift:

- legacy embedding fallback stays on so similarity and passage search still work against older data
- R2 remains cross-origin by design for now; the frontend reads projection assets directly from the custom R2 domain
- local helper scripts exist for confidence checks, but they are not the production deployment contract

## Local-Only Files

These are operator-local and should not be treated as committed deploy state:

- `.env`
- `infra/terraform/terraform.tfvars`
- `.terraform/` and Terraform state files
- `backups/`
- runtime caches and `__pycache__/`

Keep templates and reusable config in git:

- `.env.example`
- `infra/terraform/terraform.tfvars.example`

## Deploy Contract

### Release upload vars

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_ASSETS`
- `R2_BUCKET_DB`
- `R2_ENDPOINT`
- `R2_PUBLIC_BASE_URL`
- `R2_DB_PUBLIC_BASE_URL` optional

### Terraform auth/bootstrap vars

- `HCLOUD_TOKEN`
- `CLOUDFLARE_API_TOKEN` optional unless Terraform is managing Cloudflare resources
- `HCLOUD_SSH_PUBLIC_KEY_PATH`
- `HCLOUD_SSH_KEY_NAME` optional

### App runtime vars

- `APP_DOMAIN`
- `DATABASE_URL`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `DB_RESTORE_URL`
- `VITE_STATIC_BASE_URL`
- `CORS_ALLOWED_ORIGINS`
- `PRELOAD_EMBED_MODEL`
- `ENABLE_SEMANTIC_SEARCH`
- `BACKEND_INSTALL_EMBEDDINGS`
- `RUN_DB_MIGRATIONS`

## Canonical Workflow

### 1. Publish the release

Create a dump from the known-good source database:

```bash
./scripts/deploy/create_db_dump.sh backups/ftf.sql.gz
```

Publish projection assets and the dump to R2:

```bash
./scripts/deploy/publish_release_bundle.sh 2026-07-18 backups/ftf.sql.gz
```

That script auto-loads `.env`, validates the dump, uploads both artifact sets, and prints the exact `VITE_STATIC_BASE_URL` and `DB_RESTORE_URL` values for the deploy `.env`.

### 2. Provision the VPS

Use the Terraform wrapper, not raw `terraform`:

```bash
cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars
./scripts/deploy/terraform.sh init
./scripts/deploy/terraform.sh plan
./scripts/deploy/terraform.sh apply
```

The intended non-clicky SSH path is:

1. create or reuse a local SSH keypair
2. point `HCLOUD_SSH_PUBLIC_KEY_PATH` at the `.pub` file
3. leave `hcloud_ssh_keys = []` in `terraform.tfvars`

### 3. Deploy the app

Start from `.env.example`, fill the real runtime values, then deploy with:

```bash
./scripts/deploy/deploy_vps.sh
```

`deploy_vps.sh` is the single remote deploy entrypoint. It:

- resolves the VPS IP from Terraform output
- copies the current repo contents needed for the build
- uploads the chosen `.env`
- runs `docker compose up --build -d`
- checks `http://localhost/api/healthz`

## Runtime Notes

- `web` is Caddy, not nginx
- if `APP_DOMAIN` resolves to the VPS and ports `80` and `443` are open, Caddy will obtain and renew the origin TLS certificate automatically
- Postgres restores from `DB_RESTORE_URL` only on first boot with a fresh data volume
- projection assets are expected at `VITE_STATIC_BASE_URL`, which should point at the custom R2 domain rather than `r2.dev`

## Verification

### Config sanity

- `docker compose config` resolves the expected app and static domains
- no production-facing config should point at `r2.dev`

### Release checks

- `publish_release_bundle.sh` prints `static.findingthefinger.ayyystew.com` URLs
- the release assets and DB dump are reachable from the custom R2 domain

### Runtime checks

- `curl http://localhost:8080/api/healthz` works locally
- `curl -I https://findingthefinger.ayyystew.com` works after deploy
- map asset requests hit `https://static.findingthefinger.ayyystew.com`
- semantic search works
- passage similarity works

### Fresh restore check

On a fresh Postgres volume, the app should still come up cleanly from the public `DB_RESTORE_URL` without recomputing embeddings.
