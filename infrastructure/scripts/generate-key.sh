#!/bin/bash
# Usage: ./generate-key.sh <email> [type] [note]
# Requires: PIDLAB_LICENSE_API_URL, PIDLAB_ADMIN_KEY env vars
set -euo pipefail

EMAIL="${1:?Usage: ./generate-key.sh <email> [type] [note]}"
TYPE="${2:-paid}"
NOTE="${3:-}"

API_URL="${PIDLAB_LICENSE_API_URL:?Set PIDLAB_LICENSE_API_URL}"
ADMIN_KEY="${PIDLAB_ADMIN_KEY:?Set PIDLAB_ADMIN_KEY}"

PAYLOAD=$(jq -n --arg email "$EMAIL" --arg type "$TYPE" --arg note "$NOTE" \
  '{email: $email, type: $type, note: $note}')

curl -s -X POST \
  -H "X-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$API_URL/admin/keys/generate" | jq .
