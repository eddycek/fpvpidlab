#!/bin/bash
# Shared env loader — sourced by all admin scripts.
# Auto-loads .env.local from terraform directory if it exists.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../terraform/.env.local"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$ENV_FILE"
fi
