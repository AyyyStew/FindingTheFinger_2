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

RELEASE_ID="${1:?Usage: publish_release_bundle.sh <release-id> <db-dump-path>}"
DB_DUMP_PATH="${2:?Usage: publish_release_bundle.sh <release-id> <db-dump-path>}"

: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID must be set}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID must be set}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY must be set}"
: "${R2_BUCKET_ASSETS:?R2_BUCKET_ASSETS must be set}"
: "${R2_BUCKET_DB:?R2_BUCKET_DB must be set}"
: "${R2_ENDPOINT:?R2_ENDPOINT must be set}"
: "${R2_PUBLIC_BASE_URL:?R2_PUBLIC_BASE_URL must be set}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required" >&2
  exit 1
fi

if [[ ! -d "${REPO_ROOT}/static/dimreduction" ]]; then
  echo "Missing projection assets at ${REPO_ROOT}/static/dimreduction" >&2
  exit 1
fi

if [[ ! -f "${DB_DUMP_PATH}" ]]; then
  echo "Dump file not found: ${DB_DUMP_PATH}" >&2
  exit 1
fi

if [[ "${DB_DUMP_PATH}" == *.gz ]]; then
  echo "Validating compressed dump..."
  gzip -t "${DB_DUMP_PATH}"
fi

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-${R2_ACCESS_KEY_ID}}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-${R2_SECRET_ACCESS_KEY}}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"

db_public_base_url="${R2_DB_PUBLIC_BASE_URL:-${R2_PUBLIC_BASE_URL}}"
asset_release_url="${R2_PUBLIC_BASE_URL%/}/releases/${RELEASE_ID}/dimreduction"
db_object_name="$(basename "${DB_DUMP_PATH}")"
db_restore_url="${db_public_base_url%/}/db/releases/${RELEASE_ID}/${db_object_name}"

echo "Uploading projection assets for release ${RELEASE_ID}..."
aws --endpoint-url "${R2_ENDPOINT}" s3 sync \
  "${REPO_ROOT}/static/dimreduction" \
  "s3://${R2_BUCKET_ASSETS}/releases/${RELEASE_ID}/dimreduction"

echo "Uploading database dump for release ${RELEASE_ID}..."
aws --endpoint-url "${R2_ENDPOINT}" s3 cp \
  "${DB_DUMP_PATH}" \
  "s3://${R2_BUCKET_DB}/db/releases/${RELEASE_ID}/${db_object_name}"

cat <<EOF
Release published.
Release ID: ${RELEASE_ID}
VITE_STATIC_BASE_URL=${R2_PUBLIC_BASE_URL%/}/releases/${RELEASE_ID}
DB_RESTORE_URL=${db_restore_url}
Projection asset root: ${asset_release_url}
Database dump key: s3://${R2_BUCKET_DB}/db/releases/${RELEASE_ID}/${db_object_name}
EOF
