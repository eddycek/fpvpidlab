#!/bin/bash
# Show license key statistics. Defaults to DEV. Override: PIDLAB_ENV=prod
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

echo "=== License Key Stats ==="
curl -s -H "X-Admin-Key: $PIDLAB_ADMIN_KEY" \
  "$PIDLAB_LICENSE_API_URL/admin/keys/stats" | jq .
