#!/bin/bash
# Shared env loader for admin scripts.
# Loads .env.local from repo root and prompts for environment if not set.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Run: cp env.template .env.local" >&2
  exit 1
fi

# Source key=value pairs
while IFS='=' read -r key value; do
  [[ "$key" =~ ^#.*$ || -z "$key" || "$key" =~ ^export ]] && continue
  value="${value%\"}"
  value="${value#\"}"
  export "$key=$value"
done < "$ENV_FILE"
# shellcheck source=/dev/null
source "$ENV_FILE"

# Ask for environment if not already set (only in interactive terminal)
if [[ -z "${PIDLAB_ENV:-}" ]]; then
  if [[ -t 0 ]]; then
    echo "Environment: [1] dev  [2] prod"
    read -rp "Select [1]: " ENV_CHOICE || true
    case "${ENV_CHOICE:-}" in
      2|prod) PIDLAB_ENV="prod" ;;
      *)      PIDLAB_ENV="dev" ;;
    esac
  else
    PIDLAB_ENV="dev"
  fi
  export PIDLAB_ENV
fi

echo "── Environment: $(echo "$PIDLAB_ENV" | tr '[:lower:]' '[:upper:]') ──"
echo ""

# Set API URLs and admin keys based on environment
if [[ "$PIDLAB_ENV" == "prod" ]]; then
  export PIDLAB_LICENSE_API_URL="$LICENSE_PROD_URL"
  export PIDLAB_ADMIN_KEY="$LICENSE_ADMIN_KEY_PROD"
  export PIDLAB_TELEMETRY_API_URL="$TELEMETRY_PROD_URL"
  export PIDLAB_TELEMETRY_ADMIN_KEY="$TELEMETRY_ADMIN_KEY_PROD"
else
  export PIDLAB_LICENSE_API_URL="$LICENSE_DEV_URL"
  export PIDLAB_ADMIN_KEY="$LICENSE_ADMIN_KEY_DEV"
  export PIDLAB_TELEMETRY_API_URL="$TELEMETRY_DEV_URL"
  export PIDLAB_TELEMETRY_ADMIN_KEY="$TELEMETRY_ADMIN_KEY_DEV"
fi
