#!/bin/bash
# Add an internal note to a diagnostic report.
# Usage: diagnostic-note.sh <reportId> <note>
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

ID="${1:?Usage: diagnostic-note.sh <reportId> <note>}"
NOTE="${2:?Note text required}"

ESCAPED_NOTE=$(echo "$NOTE" | sed 's/"/\\"/g')

echo "=== Adding note to report $ID ==="
curl -sf -X PATCH -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"internalNote\":\"$ESCAPED_NOTE\"}" \
  "$PIDLAB_TELEMETRY_API_URL/admin/diagnostics/$ID" | jq .status
