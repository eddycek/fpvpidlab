# Diagnostic Reports

> **Status**: Active

## Problem

When users get bad tuning recommendations, we have no way to investigate what went wrong. Telemetry gives aggregate metrics but not the specific analysis results, recommendations, or FC configuration that led to the problem.

## Solution

One-click "Report Issue" button that bundles diagnostic data from the tuning session and uploads it for investigation. Available only to users with a valid license key (Pro or Tester).

## Architecture

```
User clicks "Report Issue"
  → DiagnosticBundleBuilder assembles data
  → IPC handler uploads gzipped JSON to Worker
  → Worker stores in R2, sends email notification
  → Developer investigates via /diagnose skill
  → Resolves report → user gets email (if provided)
```

### R2 Layout

```
diagnostics/{reportId}/
  ├─ metadata.json    (status, preview, timestamps)
  └─ bundle.json      (full diagnostic data)
```

### Bundle Contents (~100 KB)

- Session context (mode, drone size, BF version, flight style)
- Analysis results (noise floors, peaks, spectrum, step response metrics)
- Full recommendation list with ruleId, confidence, explanation
- FC configuration (CLI diff before/after)
- Data quality score and warnings
- Verification results (if available)
- Related telemetry events
- User's email (optional) and note (optional)

### Worker Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/diagnostic` | Submit report (rate limit: 1/hr/install) |
| GET | `/admin/diagnostics` | List reports (?status=new) |
| GET | `/admin/diagnostics/{id}` | Full bundle + metadata |
| PATCH | `/admin/diagnostics/{id}` | Update status + send reply email |
| GET | `/admin/diagnostics/summary` | Counts for weekly report |

### Email Notifications

- **New report**: Sent to developer via Resend (subject, mode, preview, user note)
- **Resolution**: Sent to user (if email provided) with resolution message

### License Gating

Report button visible only when `licenseManager.isPro()` returns true:
- Pro license (paid) — yes
- Tester license — yes
- Free (no key) — no
- Demo/dev mode — yes (for testing)

### `/diagnose` Skill

Claude Code skill that fetches a diagnostic report, cross-references recommendations against analysis code (FilterRecommender, PIDRecommender, constants), identifies root cause, and proposes a fix + user reply.

## Implementation Plan

### Phase 1: Core (PRs #1–4)

1. Types + bundle builder + tests
2. IPC handler + upload + preload bridge
3. Worker endpoints + Resend notifications
4. UI (ReportIssueButton, ReportIssueModal, Pro gate)

### Phase 2: Tooling (PRs #5–6)

5. Admin scripts (list, review, resolve, note)
6. `/diagnose` skill + weekly report integration

### Phase 3: BBL Upload (if snapshots insufficient)

7. Worker presigned URL + chunked upload
8. UI toggle "Include flight data"
9. 30-day retention cron
