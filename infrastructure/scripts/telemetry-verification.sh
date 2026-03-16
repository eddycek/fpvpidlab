#!/bin/bash
# Telemetry v2: verification success rates by mode.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

echo "=== Verification Success Rates ==="
curl -sf -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" \
  "$PIDLAB_TELEMETRY_API_URL/admin/stats/verification" | jq .
