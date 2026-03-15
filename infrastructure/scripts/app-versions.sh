#!/bin/bash
# Show PIDlab app version distribution across all installations.
# Requires: PIDLAB_TELEMETRY_API_URL, PIDLAB_TELEMETRY_ADMIN_KEY env vars
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

API_URL="${PIDLAB_TELEMETRY_API_URL:?Set PIDLAB_TELEMETRY_API_URL}"
ADMIN_KEY="${PIDLAB_TELEMETRY_ADMIN_KEY:?Set PIDLAB_TELEMETRY_ADMIN_KEY}"

curl -s -H "X-Admin-Key: $ADMIN_KEY" \
  "$API_URL/admin/stats/app-versions" | jq .
