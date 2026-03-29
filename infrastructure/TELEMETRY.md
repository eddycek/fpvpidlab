# FPVPIDlab Telemetry

FPVPIDlab collects anonymous usage telemetry to understand how people tune their drones. This document describes what we collect, why, and how it works.

## What We Collect

| Category | Data | Example |
|----------|------|---------|
| **Profiles** | Count, drone sizes, flight styles | 2 profiles, `["5\"", "3\""]`, `["balanced", "smooth"]` |
| **Tuning sessions** | Total completed, count per mode, last 10 quality scores | 5 completed, filter: 2, pid: 1, quick: 2, scores: [85, 72, 68] |
| **Flight controllers** | BF versions, board targets, anonymized serial hashes | `["4.5.1"]`, `["STM32F405"]`, `["a1b2c3..."]` |
| **Blackbox** | Total logs downloaded, storage types, compression detected | 8 logs, `["flash"]`, false |
| **Feature usage** | Boolean flags for key features | analysis overview, snapshot restore, snapshot compare, history view |
| **App info** | App version, platform, timestamp, installation ID | `0.1.0`, `darwin`, `2026-03-15T10:00:00Z`, `a1b2c3d4-...` |

## What We Do NOT Collect

- No flight data, gyro traces, or blackbox log contents
- No PID values, filter settings, or tuning recommendations
- No profile names, snapshot labels, or user notes
- No file paths, system info, or hardware details beyond FC board target
- No email, name, IP address, or any personally identifiable information
- No raw FC serial numbers (only salted SHA-256 hash)

## Why We Collect

- **Tuning mode usage** — which modes are popular, which are underused
- **Drone types** — what sizes and flight styles people fly (helps prioritize presets)
- **Quality progression** — are users improving over tuning sessions
- **BF version distribution** — which versions to prioritize testing
- **Feature adoption** — which features are used, which can be simplified

## How It Works

```
App start → TelemetryManager.initialize()
  └─ First launch: generate UUID v4 installation ID, save to telemetry-settings.json
  └─ If enabled + last upload > 24h ago → upload bundle

Tuning session completed → TelemetryManager.onTuningSessionCompleted()
  └─ Upload bundle (if enabled + not uploaded recently)

Settings → "Send Now" button
  └─ Manual upload trigger
```

### Bundle Assembly

TelemetryManager reads from local managers (no network calls):
1. **ProfileManager** → profile count, sizes, flight styles, FC info
2. **TuningHistoryManager** → completed sessions per mode, quality scores
3. **BlackboxManager** → log count, storage types, compression
4. **SnapshotManager** → feature flags (restore used, compare used)

### Upload

- **Compression**: gzip (~70% size reduction, typical bundle 2-5 KB)
- **Transport**: Electron `net.fetch` HTTPS POST to Cloudflare Worker
- **Retry**: 3 attempts with exponential backoff (1s → 2s → 4s)
- **Silent failure**: telemetry never blocks or degrades the app
- **Rate limit**: Worker rejects uploads more frequent than 1/hour per installation

### Storage

Each installation overwrites a single file in R2:
```
pidlab-telemetry/
├── {installationId}/
│   ├── latest.json       ← most recent bundle (overwritten)
│   └── metadata.json     ← firstSeen, lastSeen, uploadCount
```

No historical data stored per installation — trends are derived from `recentQualityScores` array within the bundle.

## Privacy & Anonymization

| Data | Raw value | What we store |
|------|-----------|---------------|
| FC serial number | `0x1A2B3C4D` | `SHA-256("0x1A2B3C4D" + installationId)` — irreversible |
| Profile name | "My Race Quad" | Not collected (only count + size) |
| Snapshot label | "Pre-tuning #3" | Not collected (only boolean: restore used?) |
| File paths | `/Users/john/logs/` | Never collected |
| IP address | `1.2.3.4` | Not stored (Worker does not log IPs) |

- **Installation ID**: Random UUID v4, generated locally, never linked to any account or email
- **No cross-device tracking**: Each installation has its own independent ID
- **GDPR**: Opt-out toggle in Settings (gear icon). Data deletion by installation ID on request.

## Opt-Out

Telemetry is enabled by default. To disable:

1. Open FPVPIDlab → click gear icon (top right) → toggle off "Send anonymous usage data"
2. Or set `enabled: false` in `{userData}/telemetry-settings.json`

When disabled, no data is collected or sent. The installation ID is preserved (in case you re-enable later).

## Endpoints

| Environment | Upload URL | Health |
|-------------|-----------|--------|
| Dev | `https://telemetry.dev.fpvpidlab.app/v1/collect` | `/health` |
| Prod | `https://telemetry.fpvpidlab.app/v1/collect` | `/health` |

Admin stats (requires `X-Admin-Key` header):
- `GET /admin/stats` — summary (installs, active 24h/7d/30d, mode distribution)
- `GET /admin/stats/versions` — BF version distribution
- `GET /admin/stats/drones` — drone size + flight style distribution
- `GET /admin/stats/quality` — quality score histogram (5 buckets)

## Daily Report

Cloudflare Cron Trigger runs daily at 07:00 UTC (prod only). Aggregates all R2 data and sends email via Resend:

```
FPVPIDlab Telemetry Report — 2026-03-15
══════════════════════════════════════
New installations (24h):     3
Active users (24h):          47
Active users (7d):           182
Total installations:         1,234

Tuning Mode Distribution:
  Filter Tune:  45%
  PID Tune:     30%
  Flash Tune:   25%

Avg Quality Score: 72.3
Platforms: macOS 55%, Windows 35%, Linux 10%
```
