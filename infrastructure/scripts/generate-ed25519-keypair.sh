#!/bin/bash
# Generate Ed25519 keypair for license signing.
# Output: base64-encoded PKCS8 private key and SPKI public key
# GitHub secrets: LICENSE_ED25519_PRIVATE_KEY, LICENSE_ED25519_PUBLIC_KEY
# Worker env bindings: ED25519_PRIVATE_KEY, ED25519_PUBLIC_KEY

set -euo pipefail

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

# Generate private key (PKCS8 DER)
openssl genpkey -algorithm Ed25519 -outform DER -out "$TMPDIR/private.der"

# Extract public key (SPKI DER)
openssl pkey -in "$TMPDIR/private.der" -inform DER -pubout -outform DER -out "$TMPDIR/public.der"

# Base64 encode
PRIVATE_B64=$(base64 < "$TMPDIR/private.der" | tr -d '\n')
PUBLIC_B64=$(base64 < "$TMPDIR/public.der" | tr -d '\n')

echo "=== Ed25519 Keypair ==="
echo ""
echo "LICENSE_ED25519_PRIVATE_KEY (GitHub secret, NEVER commit):"
echo "$PRIVATE_B64"
echo ""
echo "LICENSE_ED25519_PUBLIC_KEY (GitHub secret + bundle in src/shared/constants.ts):"
echo "$PUBLIC_B64"
echo ""
echo "To set as GitHub secrets:"
echo "  gh secret set LICENSE_ED25519_PRIVATE_KEY --body '$PRIVATE_B64'"
echo "  gh secret set LICENSE_ED25519_PUBLIC_KEY --body '$PUBLIC_B64'"
