#!/bin/bash
# Reset machine binding on a license key. Defaults to DEV. Override: PIDLAB_ENV=prod
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

if [[ $# -eq 0 ]]; then
  echo "=== Reset License Key Binding (${PIDLAB_ENV:-dev}) ==="
  read -rp "Key ID: " KEY_ID
else
  KEY_ID="$1"
fi

[[ -z "$KEY_ID" ]] && echo "ERROR: Key ID required" >&2 && exit 1

echo "Resetting machine binding for $KEY_ID..."
curl -s -X PUT \
  -H "X-Admin-Key: $PIDLAB_ADMIN_KEY" \
  "$PIDLAB_LICENSE_API_URL/admin/keys/$KEY_ID/reset" | jq .
