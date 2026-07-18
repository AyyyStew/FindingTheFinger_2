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

DUMP_PATH="${1:-backups/ftf.sql.gz}"
START_APP="${START_APP:-true}"
EXPECTED_MIN_CORPORA="${EXPECTED_MIN_CORPORA:-1}"
EXPECTED_MIN_UNITS="${EXPECTED_MIN_UNITS:-1}"
EXPECTED_MIN_EMBEDDINGS="${EXPECTED_MIN_EMBEDDINGS:-1}"

if [[ ! -f "${DUMP_PATH}" ]]; then
  echo "Dump file not found: ${DUMP_PATH}" >&2
  exit 1
fi

echo "Validating dump archive..."
gzip -t "${DUMP_PATH}"

echo "Resetting compose stack..."
docker compose down

if docker volume inspect findingthefinger_2_postgres-data >/dev/null 2>&1; then
  docker volume rm findingthefinger_2_postgres-data
fi

echo "Starting fresh Postgres..."
docker compose up -d postgres

echo "Waiting for Postgres readiness..."
until docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-ftf}" -d "${POSTGRES_DB:-ftf}" >/dev/null 2>&1; do
  sleep 2
done

echo "Restoring ${DUMP_PATH} into compose Postgres..."
gunzip -c "${DUMP_PATH}" | docker compose exec -T postgres psql -U "${POSTGRES_USER:-ftf}" -d "${POSTGRES_DB:-ftf}"

echo "Verifying restored row counts..."
COUNTS="$(
  docker compose exec -T postgres psql -U "${POSTGRES_USER:-ftf}" -d "${POSTGRES_DB:-ftf}" -F $'\t' -A -tAc "
    select 'corpus', count(*) from corpus
    union all
    select 'unit', count(*) from unit
    union all
    select 'embedding', count(*) from embedding
    union all
    select 'method', count(*) from method
    union all
    select 'embedding_profile', count(*) from embedding_profile
    union all
    select 'embedding_span', count(*) from embedding_span
    order by 1;
  "
)"

echo "${COUNTS}"

corpus_count="$(printf '%s\n' "${COUNTS}" | awk -F '\t' '$1=="corpus"{print $2}')"
unit_count="$(printf '%s\n' "${COUNTS}" | awk -F '\t' '$1=="unit"{print $2}')"
embedding_count="$(printf '%s\n' "${COUNTS}" | awk -F '\t' '$1=="embedding"{print $2}')"

if [[ "${corpus_count:-0}" -lt "${EXPECTED_MIN_CORPORA}" ]]; then
  echo "Restore verification failed: corpus count ${corpus_count:-0} < ${EXPECTED_MIN_CORPORA}" >&2
  exit 1
fi
if [[ "${unit_count:-0}" -lt "${EXPECTED_MIN_UNITS}" ]]; then
  echo "Restore verification failed: unit count ${unit_count:-0} < ${EXPECTED_MIN_UNITS}" >&2
  exit 1
fi
if [[ "${embedding_count:-0}" -lt "${EXPECTED_MIN_EMBEDDINGS}" ]]; then
  echo "Restore verification failed: embedding count ${embedding_count:-0} < ${EXPECTED_MIN_EMBEDDINGS}" >&2
  exit 1
fi

if [[ "${START_APP}" == "true" ]]; then
  echo "Starting backend and web..."
  docker compose up -d backend web
fi

echo "Local restore test completed successfully."
