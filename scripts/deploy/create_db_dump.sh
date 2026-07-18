#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

OUTPUT_PATH="${1:-backups/ftf.sql.gz}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set" >&2
  exit 1
fi

normalize_pg_url() {
  local url="$1"
  if [[ "$url" == postgresql+*://* ]]; then
    printf '%s\n' "${url/postgresql+psycopg:\/\//postgresql://}"
    return 0
  fi
  printf '%s\n' "$url"
}

mkdir -p "$(dirname "${OUTPUT_PATH}")"

pg_dump \
  --dbname="$(normalize_pg_url "${DATABASE_URL}")" \
  --no-owner \
  --no-privileges \
  | gzip -c > "${OUTPUT_PATH}"

echo "Wrote ${OUTPUT_PATH}"
