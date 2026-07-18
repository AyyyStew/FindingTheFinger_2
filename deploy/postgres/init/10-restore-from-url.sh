#!/bin/bash
set -euo pipefail

if [[ -z "${DB_RESTORE_URL:-}" ]]; then
  echo "No DB_RESTORE_URL set; skipping database bootstrap restore."
  exit 0
fi

echo "Bootstrapping database from ${DB_RESTORE_URL}"

if [[ "${DB_RESTORE_URL}" == *.gz ]]; then
  curl -fsSL "${DB_RESTORE_URL}" \
    | gunzip -c \
    | psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}"
else
  curl -fsSL "${DB_RESTORE_URL}" \
    | psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}"
fi
