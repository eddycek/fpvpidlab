#!/bin/bash
# Telemetry v2: metric distributions (noise floor, overshoot, bandwidth, phase margin).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

echo "=== Metric Distributions ==="
curl -sf -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" \
  "$PIDLAB_TELEMETRY_API_URL/admin/stats/metrics" | jq .
