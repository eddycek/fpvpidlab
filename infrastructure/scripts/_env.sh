#!/bin/bash
# Shared env loader for admin scripts.
# Loads .env.local from repo root and sets up dev/prod targeting.
#
# Default: DEV environment
# Override: PIDLAB_ENV=prod ./generate-key.sh ...

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Run: cp env.template .env.local" >&2
  exit 1
fi

# Source as key=value (not export — we control what gets exported)
while IFS='=' read -r key value; do
  # Skip comments, empty lines, and export lines
  [[ "$key" =~ ^#.*$ || -z "$key" || "$key" =~ ^export ]] && continue
  # Strip quotes from value
  value="${value%\"}"
  value="${value#\"}"
  export "$key=$value"
done < "$ENV_FILE"

# Also source export lines (terraform vars)
# shellcheck source=/dev/null
source "$ENV_FILE"

# Select environment (default: dev)
PIDLAB_ENV="${PIDLAB_ENV:-dev}"

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
