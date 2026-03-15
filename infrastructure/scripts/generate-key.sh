#!/bin/bash
# Generate a license key (interactive).
# Reads secrets from .env.local, defaults to DEV.
# Override: PIDLAB_ENV=prod ./generate-key.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

echo "=== Generate License Key (${PIDLAB_ENV:-dev}) ==="
echo ""

# Interactive prompts
read -rp "Email: " EMAIL
if [[ -z "$EMAIL" ]]; then
  echo "ERROR: Email is required." >&2
  exit 1
fi

echo "Type: paid (default) or tester"
read -rp "Type [paid]: " TYPE
TYPE="${TYPE:-paid}"

read -rp "Note (optional): " NOTE

echo ""
echo "Generating $TYPE key for $EMAIL..."
echo ""

PAYLOAD=$(jq -n --arg email "$EMAIL" --arg type "$TYPE" --arg note "$NOTE" \
  '{email: $email, type: $type, note: $note}')

RESULT=$(curl -sf -X POST \
  -H "X-Admin-Key: $PIDLAB_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "$PIDLAB_LICENSE_API_URL/admin/keys/generate")

echo "$RESULT" | jq .
echo ""
echo "License key: $(echo "$RESULT" | jq -r '.licenseKey')"
