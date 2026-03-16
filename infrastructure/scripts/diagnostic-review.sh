#!/bin/bash
# View a diagnostic report and mark as reviewing.
# Usage: diagnostic-review.sh <reportId>
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

ID="${1:?Usage: diagnostic-review.sh <reportId>}"

echo "=== Diagnostic Report: $ID ==="
curl -sf -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" \
  "$PIDLAB_TELEMETRY_API_URL/admin/diagnostics/$ID" | jq .

echo ""
echo "=== Marking as reviewing... ==="
curl -sf -X PATCH -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"reviewing"}' \
  "$PIDLAB_TELEMETRY_API_URL/admin/diagnostics/$ID" | jq .status
