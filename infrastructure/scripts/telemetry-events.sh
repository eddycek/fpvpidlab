#!/bin/bash
# Telemetry v3: events for a specific installation, with optional session filter.
# Usage: telemetry-events.sh <installationId> [sessionId]
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

ID="${1:?Usage: telemetry-events.sh <installationId> [sessionId]}"
SESSION="${2:-}"

URL="$PIDLAB_TELEMETRY_API_URL/admin/events?id=$ID"
[[ -n "$SESSION" ]] && URL="$URL&session=$SESSION"

echo "=== Events for $ID ==="
curl -sf -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" "$URL" | jq .
