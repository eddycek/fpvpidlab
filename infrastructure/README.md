# PIDlab Infrastructure

Cloud infrastructure for PIDlab backend services. All services run on **Cloudflare** (Workers, R2, D1).

All resources are managed via **Terraform** — no manual CLI commands needed.

## Services

| Service | Status | Description | Design Doc |
|---------|--------|-------------|------------|
| **Telemetry Worker** | Ready | Upload + admin stats + cron report (`telemetry-worker/`) | [docs/TELEMETRY_COLLECTION.md](../docs/TELEMETRY_COLLECTION.md) |
| **License Worker** | Planned | Offline-first license key validation | [docs/LICENSE_KEY_SYSTEM.md](../docs/LICENSE_KEY_SYSTEM.md) |
| **Payment Worker** | Planned | Stripe checkout + invoice generation | [docs/PAYMENT_AND_INVOICING.md](../docs/PAYMENT_AND_INVOICING.md) |

## Directory Structure

```
infrastructure/
├── README.md
├── terraform/                 ← Infrastructure-as-code (all resources)
│   ├── main.tf                ← R2 bucket, Worker, cron trigger, DNS
│   ├── terraform.tfvars.example
│   ├── build-worker.sh        ← Builds worker-bundle.js from TS source
│   └── .gitignore             ← Excludes state, secrets, bundle
├── telemetry-worker/          ← CF Worker source: upload, admin, cron
│   ├── wrangler.toml          ← Local dev only (wrangler dev)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           ← Router + CORS + cron entry
│       ├── types.ts           ← Env bindings, bundle schema, aggregation types
│       ├── upload.ts          ← POST /v1/collect (validate, rate-limit, R2 write)
│       ├── admin.ts           ← GET /admin/stats/* (authenticated, R2 scan)
│       ├── validation.ts      ← UUID, schema, size, rate-limit checks
│       └── cron.ts            ← Daily 07:00 UTC aggregation → Resend email
├── license-worker/            ← (planned)
└── payment-worker/            ← (planned)

scripts/
├── telemetry-stats.sh         ← Quick summary via admin API
└── telemetry-report.sh        ← Full report with all breakdowns
```

## Deployment (Terraform)

All infrastructure is defined in `terraform/main.tf`. One `terraform apply` creates everything:
- R2 bucket (`pidlab-telemetry`)
- Worker deployment with R2 binding + secrets
- Cron trigger (daily 07:00 UTC)
- Custom domain + DNS (optional)

### First-Time Setup

```bash
cd infrastructure/terraform

# 1. Configure variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your Cloudflare account ID, API token, secrets

# 2. Build worker bundle from TypeScript source
./build-worker.sh

# 3. Init + apply
terraform init
terraform apply

# 4. Verify
curl $(terraform output -raw worker_url)/health
```

### Updating Worker Code

```bash
cd infrastructure/terraform
./build-worker.sh      # Rebuild bundle from latest TS source
terraform apply        # Deploy updated worker
```

### Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `cloudflare_account_id` | Yes | Cloudflare account ID |
| `cloudflare_api_token` | Yes | API token (Workers, R2, DNS permissions) |
| `environment` | Yes | `dev` or `prod` (default: `dev`) |
| `admin_key` | Yes | Admin API key for `/admin/*` endpoints |
| `resend_api_key` | Yes | Resend API key for daily email reports |
| `report_email` | Yes | Recipient for daily reports |
| `domain` | No | Custom domain (e.g. `telemetry.pidlab.app`) |
| `zone_id` | No | Cloudflare zone ID (required if `domain` is set) |

### Dev vs Prod

| | Dev (`environment = "dev"`) | Prod (`environment = "prod"`) |
|---|---|---|
| R2 bucket | `pidlab-telemetry-dev` | `pidlab-telemetry` |
| Worker name | `pidlab-telemetry-dev` | `pidlab-telemetry` |
| Cron trigger | Disabled (empty schedule) | Daily 07:00 UTC |
| Custom domain | Optional | Recommended |

Data is fully isolated — dev and prod never share a bucket.

## Telemetry Worker

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/collect` | None | Upload telemetry bundle (gzip, rate-limited 1/hr) |
| `GET` | `/admin/stats` | `X-Admin-Key` | Summary: installs, active 24h/7d/30d, modes |
| `GET` | `/admin/stats/versions` | `X-Admin-Key` | BF version distribution |
| `GET` | `/admin/stats/drones` | `X-Admin-Key` | Drone size + flight style distribution |
| `GET` | `/admin/stats/quality` | `X-Admin-Key` | Quality score histogram (5 buckets) |
| `GET` | `/health` | None | Health check |

### R2 Storage Layout

```
pidlab-telemetry/
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
| License database | CF D1 (SQLite) | 5 GB, 5M reads/day |
| Email reports | Resend | 3K emails/month |
| Payments | Stripe | Pay-as-you-go |
| IaC | Terraform + Cloudflare provider | Free |

**Estimated cost**: $0/month up to ~5,000 active users.

## Client-Side Integration

The Electron app's `TelemetryManager` (`src/main/telemetry/`) handles:
- Bundle assembly from local managers (profiles, tuning history, blackbox, snapshots)
- FC serial anonymization (SHA-256 salted with installation ID)
- gzip compression + `net.fetch` POST with retry (1s/2s/4s)
- Daily heartbeat on app start, post-session trigger, manual "Send Now"
- Upload URL: `TELEMETRY.UPLOAD_URL` in `src/shared/constants.ts` (prod default)
- **Override**: `TELEMETRY_URL` env var points app to dev Worker

Uploads silently fail until Workers are deployed (by design).

### Pointing app to dev Worker

```bash
# Get dev Worker URL after terraform apply
cd infrastructure/terraform
export TELEMETRY_URL=$(terraform output -raw worker_url)/v1/collect

# Start app with dev telemetry endpoint
TELEMETRY_URL=$TELEMETRY_URL npm run dev
```

## Development

No infrastructure is required for local development. The app runs fully offline.
Demo mode (`npm run dev:demo`) skips all uploads.
