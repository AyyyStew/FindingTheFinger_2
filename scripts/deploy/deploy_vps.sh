#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TERRAFORM_DIR="${REPO_ROOT}/infra/terraform"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env}"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-${ENV_FILE}}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/finding-the-finger}"
REMOTE_USER="${REMOTE_USER:-root}"
SSH_CONTROL_PATH="${SSH_CONTROL_PATH:-/tmp/ftf-deploy-%r@%h:%p}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if [[ ! -f "${DEPLOY_ENV_FILE}" ]]; then
  echo "Deploy env file not found: ${DEPLOY_ENV_FILE}" >&2
  exit 1
fi

if ! command -v terraform >/dev/null 2>&1; then
  echo "terraform is required" >&2
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "ssh is required" >&2
  exit 1
fi

server_ip="$(terraform -chdir="${TERRAFORM_DIR}" output -raw server_ipv4)"

if [[ -z "${server_ip}" ]]; then
  echo "Could not resolve server IP from Terraform outputs" >&2
  exit 1
fi

ssh_target="${REMOTE_USER}@${server_ip}"
ssh_opts=(
  -o ControlMaster=auto
  -o ControlPersist=10m
  -o ControlPath="${SSH_CONTROL_PATH}"
)

cleanup() {
  ssh "${ssh_opts[@]}" -O exit "${ssh_target}" >/dev/null 2>&1 || true
}

trap cleanup EXIT

echo "Opening SSH control connection to ${ssh_target}..."
ssh "${ssh_opts[@]}" -Nf "${ssh_target}"

echo "Preparing remote app directory on ${ssh_target}..."
ssh "${ssh_opts[@]}" "${ssh_target}" "mkdir -p '${REMOTE_APP_DIR}' '${REMOTE_APP_DIR}/data' '${REMOTE_APP_DIR}/static'"

echo "Syncing repository contents to ${ssh_target}:${REMOTE_APP_DIR}..."
tar \
  --exclude=.git \
  --exclude=.terraform \
  --exclude=.venv \
  --exclude=venv \
  --exclude=__pycache__ \
  --exclude=.pytest_cache \
  --exclude=.mypy_cache \
  --exclude=.ruff_cache \
  --exclude=node_modules \
  --exclude=webapp/frontend/node_modules \
  --exclude=webapp/frontend/dist \
  --exclude=backups \
  --exclude=data \
  --exclude=static/dimreduction \
  --exclude='*.tfstate' \
  --exclude='*.tfstate.*' \
  --exclude="${ENV_FILE#${REPO_ROOT}/}" \
  -C "${REPO_ROOT}" \
  -czf - . \
  | ssh "${ssh_opts[@]}" "${ssh_target}" "tar -xzf - -C '${REMOTE_APP_DIR}'"

if [[ -f "${REPO_ROOT}/data/sources.json" ]]; then
  echo "Uploading canonical source catalog..."
  scp "${ssh_opts[@]}" "${REPO_ROOT}/data/sources.json" "${ssh_target}:${REMOTE_APP_DIR}/data/sources.json"
fi

echo "Uploading deploy env file..."
scp "${ssh_opts[@]}" "${DEPLOY_ENV_FILE}" "${ssh_target}:${REMOTE_APP_DIR}/.env"

echo "Starting Docker Compose on ${ssh_target}..."
ssh "${ssh_opts[@]}" "${ssh_target}" "cd '${REMOTE_APP_DIR}' && docker compose up --build -d"

echo "Checking remote health endpoint..."
if ! ssh "${ssh_opts[@]}" "${ssh_target}" "sleep 5; curl -fsS http://localhost/api/healthz"; then
  echo "Remote health check failed. Showing remote compose status..." >&2
  ssh "${ssh_opts[@]}" "${ssh_target}" "cd '${REMOTE_APP_DIR}' && docker compose ps" >&2 || true
  echo "Recent backend logs:" >&2
  ssh "${ssh_opts[@]}" "${ssh_target}" "cd '${REMOTE_APP_DIR}' && docker compose logs --tail=120 backend" >&2 || true
  echo "Recent web logs:" >&2
  ssh "${ssh_opts[@]}" "${ssh_target}" "cd '${REMOTE_APP_DIR}' && docker compose logs --tail=120 web" >&2 || true
  exit 1
fi

cat <<EOF
Deployment completed.
Server IP: ${server_ip}
SSH target: ${ssh_target}
App directory: ${REMOTE_APP_DIR}
EOF
