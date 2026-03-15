#!/bin/bash
# List license keys. Options: --status active|revoked  --type paid|tester
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

PARAMS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --status) PARAMS="${PARAMS}&status=$2"; shift 2 ;;
    --type)   PARAMS="${PARAMS}&type=$2"; shift 2 ;;
    *)        shift ;;
  esac
done

echo "=== License Keys ==="
curl -s -H "X-Admin-Key: $PIDLAB_ADMIN_KEY" \
  "$PIDLAB_LICENSE_API_URL/admin/keys?${PARAMS#&}" | jq .
