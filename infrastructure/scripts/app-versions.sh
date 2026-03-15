#!/bin/bash
# Show PIDlab app version distribution. Defaults to DEV. Override: PIDLAB_ENV=prod
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

echo "=== App Version Distribution ==="
curl -sf -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" \
  "$PIDLAB_TELEMETRY_API_URL/admin/stats/app-versions" | jq .
