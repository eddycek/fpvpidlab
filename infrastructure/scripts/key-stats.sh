#!/bin/bash
# Usage: ./key-stats.sh
# Requires: PIDLAB_LICENSE_API_URL, PIDLAB_ADMIN_KEY env vars
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

API_URL="${PIDLAB_LICENSE_API_URL:?Set PIDLAB_LICENSE_API_URL}"
ADMIN_KEY="${PIDLAB_ADMIN_KEY:?Set PIDLAB_ADMIN_KEY}"

curl -s -H "X-Admin-Key: $ADMIN_KEY" \
  "$API_URL/admin/keys/stats" | jq .
