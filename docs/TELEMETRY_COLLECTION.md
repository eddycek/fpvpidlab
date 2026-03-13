# Telemetry Collection System

> **Status**: Proposed

## Problem

Before community release, we need to understand how people use PIDlab — which tuning modes they prefer, what drones they fly, how flight quality progresses. This data informs product decisions, identifies common failure patterns, and lays the foundation for a future paid backup service.

## Analysis

### Cloudflare Stack

| Service | Purpose | Free Tier | Cost After |
|---------|---------|-----------|------------|
| **Workers** | API endpoints | 100K req/day | $5/month (10M req) |
| **R2** | Blob storage (telemetry bundles) | 10 GB, 1M writes/month | $0.015/GB/month |
| **D1** | SQL database (licenses, see LICENSE_KEY_SYSTEM.md) | 5 GB, 5M reads/day | $0.001/M reads |

**Cost estimate**: $0/month up to ~5,000 active users. ~$0.45/month at 20K users.

### Privacy & Consent

- **Opt-out model**: Telemetry enabled by default, toggle in Settings
- **No PII**: No names, emails, or file paths collected
- **FC serial anonymization**: `SHA-256(fcSerial + installationId)` — cannot be reversed or correlated across installations
- **Installation ID**: UUID v4 generated on first launch, stored locally in `{userData}/telemetry-settings.json`
- **GDPR**: Opt-out toggle satisfies legitimate interest basis. No cross-device tracking. Data deletion via installation ID on request.

## Architecture

```
Electron App (renderer)
    ↓ IPC
Main Process (TelemetryManager)
    ↓ HTTPS POST (gzip)
CF Worker (api.pidlab.app/telemetry/upload)
    ↓
R2 Bucket (pidlab-telemetry)
    └── {installationId}/latest.json
    └── {installationId}/metadata.json

CF Worker Cron (daily)
    ↓ aggregate R2 data
Resend API → daily email report
```

### Installation ID & Settings

**File**: `{userData}/telemetry-settings.json`

```json
{
  "installationId": "a1b2c3d4-...",
  "enabled": true,
  "lastUploadAt": "2026-03-13T10:00:00Z"
}
```

Generated on first app launch. Never changes. Used as the only identifier for this installation.

### Telemetry Bundle Format

```typescript
interface TelemetryBundle {
  installationId: string;
  appVersion: string;
  platform: 'darwin' | 'win32' | 'linux';
  electronVersion: string;
  timestamp: string; // ISO 8601

  // Aggregated stats (no raw data)
  profiles: {
    count: number;
    droneSizes: string[];           // ['5"', '3"']
    flightStyles: string[];         // ['freestyle', 'cinematic']
  };

  tuningSessions: {
    totalCompleted: number;
    byMode: { filter: number; pid: number; quick: number };
    averageQualityScore: number | null;
    qualityScoreHistory: number[];  // last 10 scores
  };

  fcInfo: {
    bfVersions: string[];           // ['4.5.1', '2025.12.0']
    fcSerialHashes: string[];       // SHA-256 anonymized
    boardTargets: string[];         // ['STM32H743', 'STM32F405']
  };

  blackbox: {
    totalLogsDownloaded: number;
    storageTypes: string[];         // ['flash', 'sdcard']
    compressionDetected: boolean;
  };

  features: {
    analysisOverviewUsed: boolean;
    snapshotRestoreUsed: boolean;
    snapshotCompareUsed: boolean;
    historyViewUsed: boolean;
  };
}
```

### Anonymization Rules

| Field | Raw Value | Transmitted Value |
|-------|-----------|-------------------|
| FC serial | `0x1A2B3C4D` | `SHA-256("0x1A2B3C4D" + installationId)` |
| File paths | `/Users/john/logs/` | Never collected |
| Profile names | "My Race Quad" | Never collected (only count + size) |
| Snapshot labels | "Pre-tuning #3" | Never collected (only count) |

### Upload Protocol

**Endpoint**: `POST /telemetry/upload` (CF Worker)

**Request**:
```
Content-Type: application/json
Content-Encoding: gzip
X-Installation-ID: {installationId}

Body: gzipped TelemetryBundle JSON
```

**Response**:
```json
{ "status": "ok" }
```

**Worker logic**:
1. Validate `X-Installation-ID` (UUID format)
2. Rate limit: max 1 upload per installation per hour (check R2 metadata timestamp)
3. Validate payload size (max 10 MB decompressed)
4. Validate JSON schema (required fields present)
5. Write to R2: `{installationId}/latest.json` (overwrite)
6. Update R2: `{installationId}/metadata.json` (first_seen, last_seen, upload_count)
7. Return 200

**No API key required**: Rate limiting by installation ID + payload validation is sufficient. The data has no commercial value to attackers.

### Upload Triggers

| Trigger | Condition |
|---------|-----------|
| Tuning session completed | Immediately after archival |
| Daily heartbeat | Once per 24h on app launch |
| Manual | Settings → "Send telemetry now" button |
| Stale data | On app start if last upload > 7 days ago |

### Retry Logic

- Exponential backoff: 1s → 2s → 4s (max 3 attempts)
- Silent failure: telemetry must never block or degrade the app
- Failed uploads logged locally (electron-log) but not shown to user
- Next trigger will retry naturally

### Compression

- gzip before upload (~70% size reduction for JSON)
- Typical bundle: ~2-5 KB compressed
- Node.js `zlib.gzipSync()` in main process

### R2 Storage Layout

```
pidlab-telemetry/
├── {installationId-1}/
│   ├── latest.json          # Most recent bundle (overwritten each upload)
│   └── metadata.json        # { firstSeen, lastSeen, uploadCount }
├── {installationId-2}/
│   ├── latest.json
│   └── metadata.json
└── ...
```

**Why overwrite**: We only need the latest state per installation. Historical trends are derived from `qualityScoreHistory` array within the bundle. This keeps R2 costs minimal.

## Daily Email Report

**Mechanism**: CF Worker Cron Trigger (runs once daily at 07:00 UTC)

**Process**:
1. List all R2 prefixes (installation IDs)
2. For each: read `metadata.json` for last_seen, read `latest.json` for stats
3. Aggregate into report
4. Send via Resend API

**Report content**:
```
PIDlab Telemetry Report — 2026-03-13
═══════════════════════════════════════
New installations (24h):     3
Active users (24h):          47
Active users (7d):           182
Total installations:         1,234

Tuning Mode Distribution:
  Filter Tune:  45%
  PID Tune:     30%
  Flash Tune:   25%

BF Versions:
  4.5.1:       60%
  2025.12.0:   25%
  4.4.3:       15%

Drone Sizes:
  5":          70%
  3":          15%
  7":          10%
  Other:        5%

Avg Quality Score:  72.3
Platforms: macOS 55%, Windows 35%, Linux 10%
```

## Admin CLI Statistics

### API Endpoints (CF Worker)

All admin endpoints require `X-Admin-Key` header.

| Endpoint | Description |
|----------|-------------|
| `GET /admin/stats` | Summary: total installs, active 24h/7d/30d, mode distribution |
| `GET /admin/stats/versions` | BF version distribution |
| `GET /admin/stats/drones` | Drone size distribution |
| `GET /admin/stats/quality` | Quality score histogram (buckets: 0-20, 20-40, ..., 80-100) |

### Shell Scripts

**`scripts/telemetry-stats.sh`**: Quick summary
```bash
#!/bin/bash
curl -s -H "X-Admin-Key: $PIDLAB_ADMIN_KEY" \
  https://api.pidlab.app/admin/stats | jq .
```

**`scripts/telemetry-report.sh`**: Full report with all breakdowns
```bash
#!/bin/bash
API="https://api.pidlab.app/admin/stats"
KEY="X-Admin-Key: $PIDLAB_ADMIN_KEY"

echo "=== Summary ==="
curl -s -H "$KEY" "$API" | jq .

echo "=== BF Versions ==="
curl -s -H "$KEY" "$API/versions" | jq .

echo "=== Drone Sizes ==="
curl -s -H "$KEY" "$API/drones" | jq .

echo "=== Quality Scores ==="
curl -s -H "$KEY" "$API/quality" | jq .
```

## Implementation Tasks

### Task 1: TelemetryManager (Main Process)
- [ ] `src/main/telemetry/TelemetryManager.ts`
- [ ] Settings persistence (`telemetry-settings.json`)
- [ ] Installation ID generation (UUID v4)
- [ ] Bundle assembly from ProfileManager, SnapshotManager, TuningHistoryManager, BlackboxManager
- [ ] Anonymization (SHA-256 FC serial hashing)
- [ ] gzip compression
- [ ] Upload with retry logic
- [ ] Trigger scheduling (post-session, daily, stale data)

### Task 2: Settings UI
- [ ] Telemetry toggle in Settings panel
- [ ] "Send telemetry now" button
- [ ] Installation ID display (for support/data deletion requests)
- [ ] IPC handlers: `TELEMETRY_GET_SETTINGS`, `TELEMETRY_SET_ENABLED`, `TELEMETRY_SEND_NOW`

### Task 3: CF Worker — Upload Endpoint
- [ ] `POST /telemetry/upload` handler
- [ ] Installation ID validation (UUID format)
- [ ] Rate limiting (1/hour per installation, check R2 metadata timestamp)
- [ ] Payload validation (schema, max 10 MB)
- [ ] R2 write (`latest.json` + `metadata.json`)

### Task 4: CF Worker — Admin Stats Endpoints
- [ ] `GET /admin/stats` — aggregate summary
- [ ] `GET /admin/stats/versions` — BF version distribution
- [ ] `GET /admin/stats/drones` — drone size distribution
- [ ] `GET /admin/stats/quality` — quality score histogram
- [ ] `X-Admin-Key` authentication

### Task 5: Daily Email Report
- [ ] CF Worker Cron Trigger (07:00 UTC daily)
- [ ] R2 data aggregation
- [ ] Resend email formatting and delivery

### Task 6: Shell Scripts
- [ ] `scripts/telemetry-stats.sh`
- [ ] `scripts/telemetry-report.sh`

## Future: Paid Backup Extension

The telemetry infrastructure is designed to extend into a paid backup service:

- **Per-user auth**: JWT tokens tied to license key (Pro users only)
- **BBL log upload**: R2 storage for raw flight logs (larger payloads, per-user quota)
- **Restore endpoint**: Download backup bundle to new machine
- **Stripe subscription**: Monthly/yearly plan for cloud backup
- **Storage tiers**: Free (telemetry only), Pro (5 GB backup), Pro+ (50 GB)

This is intentionally deferred — telemetry-first validates the infrastructure before adding complexity.

## Risks

| Risk | Mitigation |
|------|------------|
| Users disable telemetry | Opt-out default maximizes participation; data still useful at lower rates |
| GDPR complaint | No PII collected, opt-out toggle, installation ID deletion on request |
| R2 costs spike | Overwrite-only strategy caps storage at 1 file per user (~5 KB) |
| Bundle too large | 10 MB limit + schema validation; typical bundle is 2-5 KB |
| Worker abuse | Rate limit per installation ID, payload validation, no auth needed (low-value data) |
