#!/bin/bash
# Usage: ./revoke-key.sh <key-id>
# Requires: PIDLAB_LICENSE_API_URL, PIDLAB_ADMIN_KEY env vars
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

KEY_ID="${1:?Usage: ./revoke-key.sh <key-id>}"
API_URL="${PIDLAB_LICENSE_API_URL:?Set PIDLAB_LICENSE_API_URL}"
ADMIN_KEY="${PIDLAB_ADMIN_KEY:?Set PIDLAB_ADMIN_KEY}"

curl -s -X PUT \
  -H "X-Admin-Key: $ADMIN_KEY" \
  "$API_URL/admin/keys/$KEY_ID/revoke" | jq .
