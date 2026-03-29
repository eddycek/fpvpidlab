# FPVPIDlab Infrastructure

Cloud infrastructure for FPVPIDlab backend services. All services run on **Cloudflare** (Workers, R2, D1).

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
| Worker URL | `telemetry.dev.fpvpidlab.app` | `telemetry.fpvpidlab.app` |
| R2 bucket | `pidlab-telemetry-dev` | `pidlab-telemetry` |
| Cron trigger | Disabled | Daily 07:00 UTC |
| Custom domain | `telemetry.dev.fpvpidlab.app` | `telemetry.fpvpidlab.app` |
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
│       ├── keygen.ts              ← FPVPIDLAB-XXXX-XXXX-XXXX key generation
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
│   ├── telemetry-full.sh           ← Full telemetry dump (all data)
│   ├── telemetry-stats.sh         ← Summary (installs, active, modes)
│   ├── app-versions.sh            ← App version distribution
│   ├── telemetry-bf-versions.sh   ← BF firmware versions
│   ├── telemetry-drones.sh        ← Drone sizes + flight styles
│   ├── telemetry-quality.sh       ← Quality score histogram
│   ├── telemetry-sessions.sh      ← Tuning sessions breakdown
│   ├── telemetry-features.sh      ← Feature adoption rates
│   ├── telemetry-blackbox.sh      ← Blackbox usage
│   ├── telemetry-profiles.sh      ← Profile count distribution
│   ├── telemetry-rules.sh         ← Rule effectiveness (v2)
│   ├── telemetry-metrics.sh       ← Metric distributions (v2)
│   ├── telemetry-verification.sh  ← Verification success rates (v2)
│   └── telemetry-convergence.sh   ← Quality score convergence (v2)
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

All manual operations require secrets from `.env.local` in the **repo root**. First-time setup:

```bash
cp env.template .env.local
# Fill in real values from 1Password (vault: FPVPIDlab Infrastructure)
```

Admin scripts auto-load `.env.local` and default to **dev** environment. To target prod:

```bash
PIDLAB_ENV=prod ./infrastructure/scripts/generate-key.sh user@example.com
```

### Deploy infrastructure manually

Normally CI/CD handles this on merge to main. Use this for emergency fixes or debugging.

```bash
source .env.local
cd infrastructure/terraform

# 1. Build telemetry worker bundle
cd ../telemetry-worker && npm install && npx esbuild src/index.ts --bundle --format=esm --outfile=../terraform/worker-bundle.js && cd ../terraform

# 2a. Deploy DEV
terraform init -backend-config=backend-dev.hcl
export TF_VAR_admin_key="$TELEMETRY_ADMIN_KEY_DEV"
export TF_VAR_license_admin_key="$LICENSE_ADMIN_KEY_DEV"
terraform apply -var-file=dev.tfvars

# 2b. Deploy license worker via wrangler (not terraform)
cd ../license-worker && npm install && npx wrangler deploy && cd ../terraform

# 2c. Deploy PROD
terraform init -reconfigure -backend-config=backend-prod.hcl
export TF_VAR_admin_key="$TELEMETRY_ADMIN_KEY_PROD"
export TF_VAR_license_admin_key="$LICENSE_ADMIN_KEY_PROD"
terraform apply -var-file=prod.tfvars
cd ../license-worker && npx wrangler deploy --env prod && cd ../terraform
```

## Admin Scripts

Admin scripts in `infrastructure/scripts/` auto-load secrets from `.env.local` in the repo root and prompt for environment (dev/prod) on startup.

### License Key Management

```bash
# Generate a new license key (interactive — asks for email, type, note)
./infrastructure/scripts/generate-key.sh

# List all keys
./infrastructure/scripts/list-keys.sh

# List with filters
./infrastructure/scripts/list-keys.sh --status active
./infrastructure/scripts/list-keys.sh --type tester

# View key statistics
./infrastructure/scripts/key-stats.sh

# Revoke a key (interactive — asks for key ID)
./infrastructure/scripts/revoke-key.sh

# Reset machine binding (interactive — asks for key ID)
./infrastructure/scripts/reset-key.sh
```

All scripts default to **dev**. To target **prod**, either select "2" in the prompt or:

```bash
PIDLAB_ENV=prod ./infrastructure/scripts/generate-key.sh
```

### Telemetry Analytics

```bash
# Everything in one call
./infrastructure/scripts/telemetry-full.sh

# Individual endpoints:
./infrastructure/scripts/telemetry-stats.sh         # Installs, active 24h/7d/30d, modes, platforms
./infrastructure/scripts/app-versions.sh             # FPVPIDlab app version distribution
./infrastructure/scripts/telemetry-bf-versions.sh    # Betaflight firmware versions
./infrastructure/scripts/telemetry-drones.sh         # Drone sizes + flight styles
./infrastructure/scripts/telemetry-quality.sh        # Quality score histogram + average
./infrastructure/scripts/telemetry-sessions.sh       # Tuning sessions: total, per-mode, top users
./infrastructure/scripts/telemetry-features.sh       # Feature adoption (analysis, snapshots, history)
./infrastructure/scripts/telemetry-blackbox.sh       # Blackbox: logs downloaded, compression, storage
./infrastructure/scripts/telemetry-profiles.sh       # Profile count distribution

# V2 analytics (requires v2 bundles with per-session data):
./infrastructure/scripts/telemetry-rules.sh          # Rule effectiveness: fire/apply rates, avg delta
./infrastructure/scripts/telemetry-metrics.sh         # Metric distributions: noise, overshoot, bandwidth
./infrastructure/scripts/telemetry-verification.sh    # Verification success rates by tuning mode
./infrastructure/scripts/telemetry-convergence.sh     # Quality score convergence across sessions
```

### Health Checks

```bash
curl -sf https://telemetry.dev.fpvpidlab.app/health
curl -sf https://license.dev.fpvpidlab.app/health
```

### Ed25519 Keypair

```bash
# Generate new Ed25519 keypair (one-time, output goes to 1Password + GitHub secrets)
./infrastructure/scripts/generate-ed25519-keypair.sh
```

### Rotate secrets

1. Generate new value (`openssl rand -hex 32` for admin keys, CF dashboard for API tokens)
2. Update GitHub secret: `gh secret set SECRET_NAME --body "new-value"`
3. Update `.env.local` locally
4. Update 1Password vault
5. Push any infra change to trigger CI/CD redeploy

## Telemetry Worker Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/collect` | None | Upload telemetry bundle (gzip, rate-limited 1/hr) |
| `GET` | `/admin/stats` | `X-Admin-Key` | Summary: installs, active 24h/7d/30d, modes, platforms |
| `GET` | `/admin/stats/app-versions` | `X-Admin-Key` | FPVPIDlab app version distribution |
| `GET` | `/admin/stats/versions` | `X-Admin-Key` | Betaflight firmware version distribution |
| `GET` | `/admin/stats/drones` | `X-Admin-Key` | Drone sizes + flight style distribution |
| `GET` | `/admin/stats/quality` | `X-Admin-Key` | Quality score histogram (5 buckets) + average |
| `GET` | `/admin/stats/sessions` | `X-Admin-Key` | Tuning sessions: total, per-mode, top installations |
| `GET` | `/admin/stats/features` | `X-Admin-Key` | Feature adoption rates (analysis, snapshots, history) |
| `GET` | `/admin/stats/blackbox` | `X-Admin-Key` | Blackbox: total logs, compression, storage types |
| `GET` | `/admin/stats/profiles` | `X-Admin-Key` | Profile count distribution + average per install |
| `GET` | `/admin/stats/full` | `X-Admin-Key` | All of the above in a single response |
| `GET` | `/admin/stats/rules` | `X-Admin-Key` | Rule effectiveness: fire/apply rates, avg delta (v2) |
| `GET` | `/admin/stats/metrics` | `X-Admin-Key` | Metric distributions: noise, overshoot, bandwidth (v2) |
| `GET` | `/admin/stats/verification` | `X-Admin-Key` | Verification success rates by tuning mode (v2) |
| `GET` | `/admin/stats/convergence` | `X-Admin-Key` | Quality score convergence across sessions (v2) |
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
