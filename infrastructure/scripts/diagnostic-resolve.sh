#!/bin/bash
# Resolve a diagnostic report and optionally send email to user.
# Usage: diagnostic-resolve.sh <reportId> <resolution> [message]
# Resolution: fixed, user-error, known-limitation, wontfix
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

ID="${1:?Usage: diagnostic-resolve.sh <reportId> <resolution> [message]}"
RESOLUTION="${2:?Resolution required: fixed, user-error, known-limitation, wontfix}"
MESSAGE="${3:-}"

BODY="{\"status\":\"resolved\",\"resolution\":\"$RESOLUTION\""
if [[ -n "$MESSAGE" ]]; then
  # Escape double quotes in message
  ESCAPED_MSG=$(echo "$MESSAGE" | sed 's/"/\\"/g')
  BODY="$BODY,\"resolutionMessage\":\"$ESCAPED_MSG\""
fi
BODY="$BODY}"

echo "=== Resolving report $ID as $RESOLUTION ==="
curl -sf -X PATCH -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  "$PIDLAB_TELEMETRY_API_URL/admin/diagnostics/$ID" | jq .
