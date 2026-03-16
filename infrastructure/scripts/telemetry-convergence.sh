#!/bin/bash
# Telemetry v2: quality score convergence across sessions per installation.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

echo "=== Quality Score Convergence ==="
curl -sf -H "X-Admin-Key: $PIDLAB_TELEMETRY_ADMIN_KEY" \
  "$PIDLAB_TELEMETRY_API_URL/admin/stats/convergence" | jq .
