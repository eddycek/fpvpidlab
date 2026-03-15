# PIDlab Infrastructure

Cloud infrastructure for PIDlab backend services. All services run on **Cloudflare** (Workers, R2, D1).

All resources are managed via **Terraform** with state in Cloudflare R2. CI/CD deploys automatically on merge to main.

## Services

| Service | Status | Description | Design Doc |
|---------|--------|-------------|------------|
| **Telemetry Worker** | Live (dev + prod) | Upload + admin stats + cron report | [TELEMETRY.md](./TELEMETRY.md), [design doc](../docs/complete/TELEMETRY_COLLECTION.md) |
| **License Worker** | Active (client done, worker planned) | Offline-first license key validation (Ed25519) | [docs/LICENSE_KEY_SYSTEM.md](../docs/LICENSE_KEY_SYSTEM.md) |
| **Payment Worker** | Planned | Stripe checkout + invoice generation | [docs/PAYMENT_AND_INVOICING.md](../docs/PAYMENT_AND_INVOICING.md) |

## Environments

| | Dev | Prod |
|---|---|---|
| Worker URL | `pidlab-telemetry-dev.eddycek-ve.workers.dev` | `pidlab-telemetry.eddycek-ve.workers.dev` |
| R2 bucket | `pidlab-telemetry-dev` | `pidlab-telemetry` |
| Cron trigger | Disabled | Daily 07:00 UTC |
| Custom domain | — | (configurable) |
| Terraform state | `pidlab-tfstate` → `dev/terraform.tfstate` | `pidlab-tfstate` → `prod/terraform.tfstate` |

Data is fully isolated — dev and prod never share a bucket.

## Directory Structure

```
infrastructure/
├── README.md
├── terraform/                     ← Infrastructure-as-code
│   ├── main.tf                    ← R2 bucket, Worker, cron, DNS
│   ├── backend-dev.hcl            ← Backend config: dev state key
│   ├── backend-prod.hcl           ← Backend config: prod state key
│   ├── dev.tfvars                 ← Dev variables (non-secret)
│   ├── prod.tfvars                ← Prod variables (non-secret)
│   ├── terraform.tfvars.example   ← Full template (local use)
│   ├── build-worker.sh            ← Build TS → JS bundle
│   └── .gitignore                 ← Excludes state, secrets, bundle
├── telemetry-worker/              ← CF Worker TypeScript source
│   ├── wrangler.toml              ← Local dev + manual deploy
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts               ← Router + CORS + cron entry
│       ├── types.ts               ← Env bindings, bundle schema
│       ├── upload.ts              ← POST /v1/collect
│       ├── admin.ts               ← GET /admin/stats/*
│       ├── validation.ts          ← UUID, schema, rate-limit
│       └── cron.ts                ← Daily report → Resend email
├── license-worker/                ← CF Worker for license key management
│   ├── wrangler.toml
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts               ← Router + CORS
│       ├── types.ts               ← Env bindings, D1 row types
│       ├── admin.ts               ← 6 admin endpoints (generate, list, get, revoke, reset, stats)
│       ├── license.ts             ← Public endpoints (activate, validate, self-reset)
│       ├── crypto.ts              ← Ed25519 sign/verify via WebCrypto
│       ├── keygen.ts              ← PIDLAB-XXXX-XXXX-XXXX key generation
│       ├── validation.ts          ← Input validation
│       └── schema.sql             ← D1 database schema
├── scripts/                       ← Admin CLI tools (auto-source .env.local)
│   ├── _env.sh                    ← Shared env loader
│   ├── generate-ed25519-keypair.sh ← Generate license signing keypair
│   ├── generate-key.sh            ← Generate a license key
│   ├── list-keys.sh               ← List keys with filters
│   ├── revoke-key.sh              ← Revoke a key
│   ├── reset-key.sh               ← Reset machine binding
│   ├── key-stats.sh               ← License key statistics
│   └── app-versions.sh            ← App version distribution (telemetry)
└── payment-worker/                ← (planned)

.github/workflows/
└── infrastructure.yml             ← CI/CD: build → deploy dev (PR+main) → plan+deploy prod (main)
```

## CI/CD Pipeline

```
PR opened/updated (infrastructure/** changed)
  └─ build telemetry + license workers → deploy dev → plan prod

Merge to main
  └─ build telemetry + license workers → deploy dev → deploy prod
```

- **`build-worker`** + **`build-license-worker`**: `esbuild` compiles TypeScript sources into bundles (parallel)
- **`deploy-dev`** (PR + main): `terraform apply` to dev — immediate feedback on PRs (skips fork PRs)
- **`plan-prod`** (PR only, internal): `terraform plan` for prod — review before merge
- **`deploy-prod`** (main push): `terraform apply` to prod (runs after dev succeeds)
- **Concurrency groups**: `deploy-dev` and `deploy-prod` serialize to prevent state corruption

GitHub environments `dev` and `prod` can have protection rules (e.g. required approval for prod).

### GitHub Secrets

10 secrets in GitHub repo settings (`Settings → Secrets and variables → Actions`):

#### `CLOUDFLARE_PROVISIONING`

Cloudflare API token used by Terraform provider to manage all infrastructure resources.

- **Used by**: `terraform apply` (CI/CD deploy-dev, deploy-prod jobs)
- **Scope**: Workers Scripts Edit, Workers KV Storage Edit, Workers R2 Storage Edit, Workers Routes Edit, D1 Edit, DNS Edit, Account Settings Read, User Details Read
- **CF token name**: `pidlab-infra-provisioning`
- **Created in**: Cloudflare Dashboard → My Profile → API Tokens → "Edit Cloudflare Workers" template + R2 Storage Edit + D1 Edit + DNS Edit

#### `TERRAFORM_STATE_R2_ACCESS_KEY_ID` + `TERRAFORM_STATE_R2_SECRET_ACCESS_KEY`

S3-compatible R2 credentials for Terraform backend. Terraform stores its state file (`terraform.tfstate`) in the `pidlab-tfstate` R2 bucket — these credentials allow reading and writing that state.

- **Used by**: `terraform init` (CI/CD all jobs that run Terraform)
- **Scope**: R2 Object Read & Write on all buckets (Terraform also manages telemetry buckets)
- **CF token name**: `pidlab-terraform-r2-v2`
- **Created in**: Cloudflare Dashboard → R2 → Manage R2 API Tokens → Object Read & Write, All buckets

#### `TELEMETRY_ADMIN_KEY_DEV` + `TELEMETRY_ADMIN_KEY_PROD`

API keys for authenticating requests to `/admin/stats/*` endpoints on telemetry Workers. Each environment has its own key. Passed to Workers as `ADMIN_KEY` secret binding via Terraform.

- **Used by**: Terraform (injected as Worker secret), admin shell scripts (`scripts/telemetry-*.sh`)
- **Scope**: Only used within Worker runtime — no Cloudflare API access
- **Generated with**: `openssl rand -hex 32`

#### `RESEND_API_KEY` (not yet set)

Resend email delivery API key for daily telemetry report cron job. Optional — cron job logs report to console if not configured.

- **Used by**: Terraform (injected as Worker secret), daily cron Worker
- **Scope**: Resend email sending only
- **Created in**: resend.com dashboard

#### `LICENSE_ED25519_PRIVATE_KEY` + `LICENSE_ED25519_PUBLIC_KEY`

Ed25519 keypair for signing and verifying license tokens. The private key signs license objects on activation; the public key is bundled in the Electron app for offline verification.

- **Used by**: Terraform (injected as Worker secret bindings `ED25519_PRIVATE_KEY`, `ED25519_PUBLIC_KEY`)
- **Scope**: License signing/verification only (no Cloudflare API access)
- **Generated with**: `infrastructure/scripts/generate-ed25519-keypair.sh`
- **CRITICAL**: Cannot be rotated without invalidating all issued licenses. Back up in 1Password.

#### `LICENSE_ADMIN_KEY_DEV` + `LICENSE_ADMIN_KEY_PROD`

API keys for authenticating requests to `/admin/keys/*` endpoints on license Workers. Each environment has its own key. Passed to Workers as `ADMIN_KEY` secret binding via Terraform.

- **Used by**: Terraform (injected as Worker secret), admin shell scripts (`infrastructure/scripts/generate-key.sh`, etc.)
- **Scope**: Only used within Worker runtime — no Cloudflare API access
- **Generated with**: `openssl rand -hex 32`

## Bootstrap (One-Time Setup)

Three R2 buckets were created manually via `wrangler` CLI (chicken-and-egg — Terraform can't manage its own state bucket):

```bash
# Already done:
npx wrangler r2 bucket create pidlab-tfstate        # Terraform state
npx wrangler r2 bucket create pidlab-telemetry-dev   # Dev telemetry data
npx wrangler r2 bucket create pidlab-telemetry       # Prod telemetry data
```

After bootstrap, everything is managed by Terraform + CI/CD. No more manual commands.

## Manual Operations

All manual operations require secrets from `.env.local`. First-time setup:

```bash
cd infrastructure/terraform
cp env.template .env.local
# Fill in real values from 1Password (vault: PIDlab Infrastructure)
```

### Deploy infrastructure manually

Normally CI/CD handles this on merge to main. Use this for emergency fixes or debugging.

```bash
cd infrastructure/terraform
source .env.local

# 1. Build worker bundle from TypeScript source
cd ../telemetry-worker && npm install && npx esbuild src/index.ts --bundle --format=esm --outfile=../terraform/worker-bundle.js && cd ../terraform

# 2a. Deploy DEV
terraform init -backend-config=backend-dev.hcl
export TF_VAR_admin_key="$TF_VAR_admin_key_dev"
terraform plan -var-file=dev.tfvars          # review changes
terraform apply -var-file=dev.tfvars         # apply

# 2b. Deploy PROD (switch backend state)
terraform init -reconfigure -backend-config=backend-prod.hcl
export TF_VAR_admin_key="$TF_VAR_admin_key_prod"
terraform plan -var-file=prod.tfvars         # review changes
terraform apply -var-file=prod.tfvars        # apply
```

### Check Worker health

```bash
curl -sf https://pidlab-telemetry-dev.eddycek-ve.workers.dev/health    # dev
curl -sf https://pidlab-telemetry.eddycek-ve.workers.dev/health        # prod
```

### View telemetry stats

```bash
source infrastructure/terraform/.env.local

# Quick summary (dev)
PIDLAB_ADMIN_KEY=$PIDLAB_ADMIN_KEY_DEV ./scripts/telemetry-stats.sh https://pidlab-telemetry-dev.eddycek-ve.workers.dev

# Full report (prod)
PIDLAB_ADMIN_KEY=$PIDLAB_ADMIN_KEY_PROD ./scripts/telemetry-report.sh https://pidlab-telemetry.eddycek-ve.workers.dev
```

### Test upload manually

```bash
source infrastructure/terraform/.env.local

curl -X POST "$TELEMETRY_DEV_URL" \
  -H "Content-Type: application/json" \
  -d '{"schemaVersion":1,"installationId":"a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d","timestamp":"2026-01-01T00:00:00Z","appVersion":"0.1.0","platform":"darwin","profiles":{"count":1,"sizes":["5\""],"flightStyles":["balanced"]},"tuningSessions":{"totalCompleted":0,"byMode":{"filter":0,"pid":0,"quick":0},"recentQualityScores":[]},"fcInfo":{"bfVersions":[],"fcSerialHashes":[],"boardTargets":[]},"blackbox":{"totalLogsDownloaded":0,"storageTypes":[],"compressionDetected":false},"features":{"analysisOverviewUsed":false,"snapshotRestoreUsed":false,"snapshotCompareUsed":false,"historyViewUsed":false}}'
```

### Run app with dev telemetry

```bash
source infrastructure/terraform/.env.local
TELEMETRY_URL=$TELEMETRY_DEV_URL npm run dev
```

### Local Worker development (no Cloudflare)

```bash
cd infrastructure/telemetry-worker
npm install
npx wrangler dev
# Worker runs at http://localhost:8787 with local R2 emulation
# Point app: TELEMETRY_URL=http://localhost:8787/v1/collect npm run dev
```

### Rotate secrets

1. Generate new value (API token in CF dashboard, admin key with `openssl rand -hex 32`)
2. Update GitHub secret: `gh secret set SECRET_NAME --body "new-value"`
3. Update `.env.local` locally
4. Update 1Password vault
5. For Worker secrets (ADMIN_KEY, RESEND_API_KEY): push any infra change to trigger CI/CD redeploy, or set manually via `wrangler secret put`

## Telemetry Worker Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/collect` | None | Upload telemetry bundle (gzip, rate-limited 1/hr) |
| `GET` | `/admin/stats` | `X-Admin-Key` | Summary: installs, active 24h/7d/30d, modes |
| `GET` | `/admin/stats/versions` | `X-Admin-Key` | BF version distribution |
| `GET` | `/admin/stats/drones` | `X-Admin-Key` | Drone size + flight style distribution |
| `GET` | `/admin/stats/quality` | `X-Admin-Key` | Quality score histogram (5 buckets) |
| `GET` | `/health` | None | Health check |

## License Worker Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/license/activate` | None | Activate key + bind machine, returns signed license |
| `POST` | `/license/validate` | None | Periodic validation (revocation sync) |
| `POST` | `/license/reset` | None | Self-service machine reset (key + email required) |
| `POST` | `/admin/keys/generate` | `X-Admin-Key` | Generate new license key |
| `GET` | `/admin/keys` | `X-Admin-Key` | List keys (filterable by status, type, email) |
| `GET` | `/admin/keys/{id}` | `X-Admin-Key` | Key details |
| `PUT` | `/admin/keys/{id}/revoke` | `X-Admin-Key` | Revoke a key |
| `PUT` | `/admin/keys/{id}/reset` | `X-Admin-Key` | Admin reset machine binding |
| `GET` | `/admin/keys/stats` | `X-Admin-Key` | Aggregate statistics |
| `GET` | `/health` | None | Health check |

### R2 Storage Layout

```
pidlab-telemetry[-dev]/
├── {installationId}/
│   ├── latest.json       ← Most recent bundle (overwritten each upload)
│   └── metadata.json     ← { firstSeen, lastSeen, uploadCount }
└── ...
```

## Stack

| Component | Service | Free Tier |
|-----------|---------|-----------|
| API endpoints | CF Workers | 100K req/day |
| Telemetry storage | CF R2 | 10 GB, 1M writes/month |
| Terraform state | CF R2 | (shared bucket) |
| License database | CF D1 (SQLite) | 5 GB, 5M reads/day |
| Email reports | Resend | 3K emails/month |
| Payments | Stripe | Pay-as-you-go |
| IaC | Terraform + Cloudflare provider | Free |
| CI/CD | GitHub Actions | 2,000 min/month |

**Estimated cost**: $0/month up to ~5,000 active users.

## Client-Side Integration

The Electron app's `TelemetryManager` (`src/main/telemetry/`) handles:
- Bundle assembly from local managers (profiles, tuning history, blackbox, snapshots)
- FC serial anonymization (SHA-256 salted with installation ID)
- gzip compression + `net.fetch` POST with retry (1s/2s/4s)
- Daily heartbeat on app start, post-session trigger, manual "Send Now"
- Default URL: `TELEMETRY.UPLOAD_URL` in `src/shared/constants.ts` (prod)
- **Override**: `TELEMETRY_URL` env var points app to dev Worker
