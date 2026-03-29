# License Key System

> **Status**: Active (PRs #266-#268)

## Problem

FPVPIDlab needs a freemium model: free version with limited profiles, Pro version with unlimited profiles. The licensing system must work offline (Electron desktop app), be simple to activate, and integrate with the Stripe payment flow.

## Analysis

### Freemium Model

| Feature | Free | Pro |
|---------|------|-----|
| Profiles | 1 | Unlimited |
| Filter Tune | Yes | Yes |
| PID Tune | Yes | Yes |
| Flash Tune | Yes | Yes |
| Tuning history | Yes | Yes |
| Analysis overview | Yes | Yes |
| Snapshots | Yes | Yes |
| Snapshot restore | Yes | Yes |

**Only profile count is gated.** All tuning functionality is fully available in the free version. This maximizes adoption and word-of-mouth while monetizing multi-drone users.

### Why Cloudflare D1

- SQL database, 5 GB free tier, 5M reads/day
- Co-located with Workers (zero-latency queries from webhook/API handlers)
- No separate database service to manage
- Simple schema, low query volume

### Key Format

```
FPVPIDLAB-XXXX-XXXX-XXXX
```

Where each `X` is an alphanumeric character (A-Z, 0-9, excluding ambiguous characters: 0/O, 1/I/L).

**Character set**: `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (28 chars)

**Entropy**: 28^12 ≈ 1.2 × 10^17 — sufficient for brute-force resistance.

**Ed25519 signature**: Each key embeds a signed payload verifiable offline with a public key bundled in the app. This prevents key generators — valid keys can only be created by the server holding the private key.

**Key payload** (encoded in the key, signed by Ed25519):
```
{
  type: 'paid' | 'tester',
  expiresAt: string | null    // ISO 8601 or null (permanent)
}
```

**Offline verification flow**:
1. Key → decode → extract payload + signature
2. Verify signature with embedded public key
3. If signature invalid → reject
4. If `expiresAt` is set and past → downgrade to Free
5. If valid → Pro features enabled immediately (no server needed)

### D1 Schema

```sql
CREATE TABLE licenses (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  license_key TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'paid',          -- 'paid' | 'tester'
  stripe_payment_id TEXT,                      -- NULL for tester keys
  trivi_document_id TEXT,                      -- Trivi invoice ID
  installation_id TEXT,                        -- Bound on first activation
  status TEXT NOT NULL DEFAULT 'active',       -- 'active' | 'revoked'
  note TEXT,                                   -- Admin note (e.g., "Beta tester - John")
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  activated_at TEXT,                            -- First activation timestamp
  last_validated_at TEXT,                       -- Last online validation
  reset_count INTEGER NOT NULL DEFAULT 0,      -- Machine reset counter
  max_resets INTEGER NOT NULL DEFAULT 3         -- Max resets per year
);

CREATE INDEX idx_licenses_key ON licenses(license_key);
CREATE INDEX idx_licenses_email ON licenses(email);
CREATE INDEX idx_licenses_installation ON licenses(installation_id);
CREATE INDEX idx_licenses_status ON licenses(status);
```

## Architecture

```
Stripe payment_intent.succeeded
    ↓
CF Worker (webhook) → Generate key → INSERT INTO D1
    ↓
Customer receives key (email + success page)
    ↓
Electron App: Settings → Enter key
    ↓
1. Offline: Ed25519 signature verification → Pro enabled immediately
2. Online (background): POST /license/activate → bind installationId in D1
    ↓
Periodic (best-effort): POST /license/validate → sync revocation status
```

### Activation Flow (Offline-First)

When user enters a license key in the app:

**Step 1 — Offline (instant)**:
1. Decode key → extract payload + Ed25519 signature
2. Verify signature with bundled public key
3. If valid → store key locally, enable Pro immediately
4. If `expiresAt` is set and past → reject ("License expired")

**Step 2 — Online (background, non-blocking)**:
1. `POST /license/activate { key, installationId }`
2. If success → update local `lastValidatedAt`
3. If 403 "Already activated" → revoke local Pro, show error
4. If network error → silently skip, retry on next app launch

This means: **user gets Pro the instant they enter a valid key**, even without internet. Machine binding happens in the background.

**Endpoint**: `POST /license/activate`

```json
// Request
{ "key": "FPVPIDLAB-ABCD-EFGH-JKLM", "installationId": "uuid-v4-..." }

// Response (success)
{ "status": "activated", "type": "paid" }
```

**Server logic**:

| Key exists? | Installation bound? | Same installation? | Result |
|-------------|--------------------|--------------------|--------|
| No | — | — | 404 "Invalid license key" |
| Yes | No | — | Bind + 200 "activated" |
| Yes | Yes | Yes | 200 "valid" |
| Yes | Yes | No | 403 "Already activated on another machine" |
| Yes (revoked) | — | — | 403 "License revoked" |

### Online Validation (Best-Effort)

**Endpoint**: `POST /license/validate`

```json
// Request
{ "key": "FPVPIDLAB-ABCD-EFGH-JKLM", "installationId": "uuid-v4-..." }

// Response
{ "status": "valid", "type": "paid" }
// or
{ "status": "revoked" }
```

**Purpose**: Sync revocation status, not enforce licensing. Called on app launch + every 24h.

**If server returns "revoked"** → downgrade to Free locally, show notification.

**If server unreachable** → nothing happens. Pro stays active based on local Ed25519 verification.

### Offline Behavior by Key Type

| Key type | Offline behavior | Online validation purpose |
|----------|-----------------|--------------------------|
| **Permanent** (`expiresAt: null`) | Pro forever, no timeout | Sync revocation only (chargeback, abuse) |
| **Expiring** (`expiresAt: "2027-01-01"`) | Pro until expiry date (checked locally) | Sync revocation + potential renewal |

**Permanent keys** (current model): Ed25519 signature is the sole proof of legitimacy. No internet needed, ever. Online check is purely for edge-case revocation sync.

**Expiring keys** (future): Expiration date is embedded in the signed payload, so it cannot be tampered with. App checks `expiresAt` locally on every launch. After expiry → downgrade to Free regardless of online/offline status.

### Local Storage

**File**: `{userData}/license.json`

```json
{
  "key": "FPVPIDLAB-ABCD-EFGH-JKLM",
  "status": "active",
  "type": "paid",
  "expiresAt": null,
  "lastValidatedAt": "2026-03-13T10:00:00Z",
  "activatedAt": "2026-03-01T15:30:00Z"
}
```

### ProfileManager Enforcement

```typescript
// In ProfileManager.createProfile()
const license = await licenseManager.getLicenseStatus();
const profileCount = this.getAllProfiles().length;

if (license.type !== 'paid' && profileCount >= 1) {
  throw new ProfileLimitError('Free version supports 1 profile. Upgrade to Pro for unlimited profiles.');
}
```

**UI**: ProfileSelector shows "Upgrade to Pro" button when at profile limit. Clicking opens fpvpidlab.app/pricing.

## Machine Rotation

Users may change machines (new PC, OS reinstall). Self-service reset:

1. User visits fpvpidlab.app/license/reset
2. Enters license key + email (must match)
3. System clears `installation_id` in D1
4. User activates on new machine
5. Max **3 resets per year** (tracked in `reset_count`, resets annually)

If limit exceeded → contact support (manual reset via admin API).

## Tester Keys

Special keys for beta testers, reviewers, content creators:

- `type = 'tester'` in D1
- No Stripe payment (generated via admin API)
- No expiration
- Same activation/validation flow as paid keys
- Can be revoked individually

## Admin API

All endpoints require `X-Admin-Key` header (shared secret in CF Worker env).

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/keys/generate` | Generate new key |
| `GET` | `/admin/keys` | List all keys (filterable) |
| `GET` | `/admin/keys/{id}` | Key details |
| `PUT` | `/admin/keys/{id}/revoke` | Revoke key |
| `PUT` | `/admin/keys/{id}/reset` | Reset installation binding |
| `GET` | `/admin/keys/stats` | Aggregate statistics |

### Generate Key

```json
// POST /admin/keys/generate
{
  "email": "customer@example.com",
  "type": "paid",           // 'paid' | 'tester'
  "note": "Stripe PI_xxx",  // optional
  "stripePaymentId": "pi_xxx"  // optional, for paid keys
}

// Response
{
  "id": "abc123...",
  "licenseKey": "FPVPIDLAB-ABCD-EFGH-JKLM",
  "email": "customer@example.com",
  "type": "paid",
  "status": "active",
  "createdAt": "2026-03-13T10:00:00Z"
}
```

### List Keys

```
GET /admin/keys?status=active&type=paid&email=john@example.com&limit=50&offset=0
```

### Key Stats

```json
// GET /admin/keys/stats
{
  "total": 1234,
  "active": 1100,
  "revoked": 34,
  "tester": 100,
  "activatedLast24h": 12,
  "activatedLast7d": 85
}
```

## Shell Scripts

Located in `workers/scripts/` for admin CLI operations.

### generate-key.sh
```bash
#!/bin/bash
# Usage: ./generate-key.sh <email> [type] [note]
EMAIL="$1"
TYPE="${2:-paid}"
NOTE="${3:-}"

curl -s -X POST \
  -H "X-Admin-Key: $PIDLAB_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"type\":\"$TYPE\",\"note\":\"$NOTE\"}" \
  https://license.fpvpidlab.app/admin/keys/generate | jq .
```

### list-keys.sh
```bash
#!/bin/bash
# Usage: ./list-keys.sh [--status active|revoked] [--type paid|tester]
PARAMS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --status) PARAMS="${PARAMS}&status=$2"; shift 2 ;;
    --type)   PARAMS="${PARAMS}&type=$2"; shift 2 ;;
    *)        shift ;;
  esac
done

curl -s -H "X-Admin-Key: $PIDLAB_ADMIN_KEY" \
  "https://license.fpvpidlab.app/admin/keys?${PARAMS#&}" | jq .
```

### revoke-key.sh
```bash
#!/bin/bash
# Usage: ./revoke-key.sh <key-id>
curl -s -X PUT \
  -H "X-Admin-Key: $PIDLAB_ADMIN_KEY" \
  "https://license.fpvpidlab.app/admin/keys/$1/revoke" | jq .
```

### reset-key.sh
```bash
#!/bin/bash
# Usage: ./reset-key.sh <key-id>
curl -s -X PUT \
  -H "X-Admin-Key: $PIDLAB_ADMIN_KEY" \
  "https://license.fpvpidlab.app/admin/keys/$1/reset" | jq .
```

### key-stats.sh
```bash
#!/bin/bash
curl -s -H "X-Admin-Key: $PIDLAB_ADMIN_KEY" \
  https://license.fpvpidlab.app/admin/keys/stats | jq .
```

## Stripe Webhook Integration

When `payment_intent.succeeded` fires (see PAYMENT_AND_INVOICING.md):

1. Webhook handler calls `POST /admin/keys/generate` internally (same Worker)
2. Key is created in D1 with `stripe_payment_id` reference
3. Key is returned to webhook handler for email delivery
4. Customer receives key before they even check email

## Implementation Tasks

### Task 1: D1 Schema & Key Generation
- [ ] D1 database creation and schema migration
- [ ] Ed25519 key pair generation (private in CF Worker secret, public bundled in app)
- [ ] License key generation function (format + signature)
- [ ] Key validation function (signature verification)

### Task 2: CF Worker — License Endpoints
- [ ] `POST /license/activate` — activation with installation binding
- [ ] `POST /license/validate` — periodic validation
- [ ] Self-service reset page at fpvpidlab.app/license/reset

### Task 3: CF Worker — Admin API
- [ ] `POST /admin/keys/generate`
- [ ] `GET /admin/keys` (with filters)
- [ ] `GET /admin/keys/{id}`
- [ ] `PUT /admin/keys/{id}/revoke`
- [ ] `PUT /admin/keys/{id}/reset`
- [ ] `GET /admin/keys/stats`
- [ ] `X-Admin-Key` authentication middleware

### Task 4: Electron App — License Manager
- [ ] `src/main/license/LicenseManager.ts`
- [ ] Local storage (`license.json`)
- [ ] Offline-first activation (Ed25519 verify → instant Pro, online binding in background)
- [ ] Periodic online validation (revocation sync, best-effort)
- [ ] Expiration check for future expiring keys (`expiresAt` from payload)
- [ ] IPC handlers: `LICENSE_ACTIVATE`, `LICENSE_VALIDATE`, `LICENSE_GET_STATUS`, `LICENSE_REMOVE`

### Task 5: Electron App — License UI
- [ ] Settings → License section (key input, status display, activate button)
- [ ] ProfileManager enforcement (free=1 profile limit)
- [ ] "Upgrade to Pro" prompt when profile limit hit
- [ ] License status in app header/footer (Free/Pro badge)

### Task 6: Shell Scripts
- [ ] `workers/scripts/generate-key.sh`
- [ ] `workers/scripts/list-keys.sh`
- [ ] `workers/scripts/revoke-key.sh`
- [ ] `workers/scripts/reset-key.sh`
- [ ] `workers/scripts/key-stats.sh`

### Task 7: Stripe Integration
- [ ] Wire key generation into payment webhook handler
- [ ] Pass `stripe_payment_id` to D1 record
- [ ] Return key to webhook for email delivery

## Risks

| Risk | Mitigation |
|------|------------|
| Key sharing | 1 key = 1 machine binding (enforced on next online check). Sharing requires giving away your activation |
| Key generators | Ed25519 signature — keys can only be created with server private key |
| Offline permanent Pro | Acceptable tradeoff — revocation is rare (chargeback/abuse). Signed key proves purchase |
| Revoked key used offline | User keeps Pro until next online check. Low risk — revocation is edge case |
| D1 outage | Offline Ed25519 verification unaffected. Online sync retries on next launch |
| Machine rotation abuse | 3 resets/year limit, admin override for edge cases |
| Lost key | Customer can request re-send via email lookup (admin API) |
| Clock manipulation (expiring keys) | Mitigated by `lastValidatedAt` — online check corrects local state. Low priority for desktop app |
