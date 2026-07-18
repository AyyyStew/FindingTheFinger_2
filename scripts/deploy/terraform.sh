#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TERRAFORM_DIR="${REPO_ROOT}/infra/terraform"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: ./scripts/deploy/terraform.sh <terraform-subcommand> [args...]" >&2
  exit 1
fi

export TF_VAR_hcloud_token="${TF_VAR_hcloud_token:-${HCLOUD_TOKEN:-}}"
export TF_VAR_cloudflare_api_token="${TF_VAR_cloudflare_api_token:-${CLOUDFLARE_API_TOKEN:-}}"

if [[ -n "${HCLOUD_SSH_PUBLIC_KEY_PATH:-}" ]]; then
  if [[ ! -f "${HCLOUD_SSH_PUBLIC_KEY_PATH}" ]]; then
    echo "HCLOUD_SSH_PUBLIC_KEY_PATH does not exist: ${HCLOUD_SSH_PUBLIC_KEY_PATH}" >&2
    exit 1
  fi
  export TF_VAR_managed_ssh_public_key="${TF_VAR_managed_ssh_public_key:-$(<"${HCLOUD_SSH_PUBLIC_KEY_PATH}")}"
fi

if [[ -n "${HCLOUD_SSH_KEY_NAME:-}" ]]; then
  export TF_VAR_managed_ssh_key_name="${TF_VAR_managed_ssh_key_name:-${HCLOUD_SSH_KEY_NAME}}"
fi

cd "${TERRAFORM_DIR}"
terraform "$@"
