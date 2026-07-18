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

BASE_URL="${BASE_URL:-http://localhost:8080}"
PASSAGE_UNIT_ID="${PASSAGE_UNIT_ID:-}"
SEMANTIC_QUERY="${SEMANTIC_QUERY:-wisdom}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd python3

echo "Checking compose service status..."
docker compose ps

echo "Checking API health..."
curl --fail --silent --show-error "${BASE_URL}/api/healthz"
echo

echo "Checking corpus listing..."
corpora_json="$(curl --fail --silent --show-error "${BASE_URL}/api/corpora")"
python3 - <<'PY' "${corpora_json}"
import json
import sys

data = json.loads(sys.argv[1])
if not isinstance(data, list):
    raise SystemExit("Expected /api/corpora to return a list")
print(f"corpora={len(data)}")
if len(data) == 0:
    raise SystemExit("No corpora returned")
PY

echo "Checking methods..."
curl --fail --silent --show-error "${BASE_URL}/api/methods" >/dev/null
echo "methods=ok"

echo "Checking embedding profiles..."
curl --fail --silent --show-error "${BASE_URL}/api/embedding-profiles" >/dev/null
echo "embedding_profiles=ok"

echo "Checking semantic search..."
semantic_response="$(curl --silent --show-error -X POST "${BASE_URL}/api/search/semantic" \
  -H 'Content-Type: application/json' \
  -d "{\"query\":\"${SEMANTIC_QUERY}\"}")"
python3 - <<'PY' "${semantic_response}"
import json
import sys

data = json.loads(sys.argv[1])
if "detail" in data:
    raise SystemExit(f"semantic search failed: {data['detail']}")
results = data.get("results")
if not isinstance(results, list):
    raise SystemExit("semantic search returned unexpected payload")
print(f"semantic_results={len(results)}")
PY

if [[ -n "${PASSAGE_UNIT_ID}" ]]; then
  echo "Checking passage similarity for unit ${PASSAGE_UNIT_ID}..."
  passage_response="$(curl --silent --show-error -X POST "${BASE_URL}/api/search/passage" \
    -H 'Content-Type: application/json' \
    -d "{\"unit_id\":${PASSAGE_UNIT_ID},\"exclude_self\":true}")"
  python3 - <<'PY' "${passage_response}"
import json
import sys

data = json.loads(sys.argv[1])
if "detail" in data:
    raise SystemExit(f"passage search failed: {data['detail']}")
results = data.get("results")
if not isinstance(results, list):
    raise SystemExit("passage search returned unexpected payload")
print(f"passage_results={len(results)}")
PY
fi

echo "Smoke check completed successfully."
