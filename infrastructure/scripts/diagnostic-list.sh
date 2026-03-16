#!/bin/bash
# List diagnostic reports. Optional status filter.
# Usage: diagnostic-list.sh [status]
# Status: new, reviewing, resolved, needs-bbl
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

STATUS="${1:-}"
URL="$PIDLAB_TELEMETRY_API_URL/admin/diagnostics"
[[ -n "$STATUS" ]] && URL="$URL?status=$STATUS"

echo "=== Diagnostic Reports${STATUS:+ (status=$STATUS)} ==="
curl -sf -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" "$URL" | jq .
