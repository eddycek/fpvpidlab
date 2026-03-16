#!/bin/bash
# Telemetry v2: rule effectiveness (fire/apply rates, avg delta, avg improvement).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

echo "=== Rule Effectiveness ==="
curl -sf -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" \
  "$PIDLAB_TELEMETRY_API_URL/admin/stats/rules" | jq .
