#!/bin/bash
# Usage: ./list-keys.sh [--status active|revoked] [--type paid|tester]
# Requires: PIDLAB_LICENSE_API_URL, PIDLAB_ADMIN_KEY env vars
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

API_URL="${PIDLAB_LICENSE_API_URL:?Set PIDLAB_LICENSE_API_URL}"
ADMIN_KEY="${PIDLAB_ADMIN_KEY:?Set PIDLAB_ADMIN_KEY}"

PARAMS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --status) PARAMS="${PARAMS}&status=$2"; shift 2 ;;
    --type)   PARAMS="${PARAMS}&type=$2"; shift 2 ;;
    *)        shift ;;
  esac
done

curl -s -H "X-Admin-Key: $ADMIN_KEY" \
  "$API_URL/admin/keys?${PARAMS#&}" | jq .
