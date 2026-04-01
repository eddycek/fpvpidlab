# Config Health Check

> **Status**: Proposed

Read-only configuration audit that compares current FC settings against community best practices and size-specific recommendations. Does **not** require flight data — reads the existing CLI diff and MSP data, then produces categorized recommendations focused on general drone setup (safety, motors, RC link, power).

## Motivation

Many flight problems stem from misconfigured **general settings** — wrong arm angle, disabled bidirectional DShot, incorrect failsafe, missing dynamic idle. The Betaflight firmware-presets repository contains 11 categories of community presets, but most pilots overlook the non-tuning categories. This feature surfaces those configuration gaps.

**Sources**: Betaflight firmware-presets repo (11 categories, 100+ presets), Oscar Liang, Joshua Bardwell, Chris Rosser, official BF documentation.

---

## UX Flow

1. User connects FC (profile with drone size/battery/flight style already exists)
2. User clicks **"Health Check"** button on dashboard (visible when connected, no tuning session active)
3. App reads latest snapshot CLI diff + live MSP data (no CLI mode entry, no reboot)
4. Audit engine evaluates rules → produces categorized recommendations
5. Renderer shows single-page report with collapsible category sections
6. Each recommendation: setting name, current → recommended value, reason, severity badge
7. Overall **health score** (0–100) displayed at top
8. Optional: "Apply Selected" for auto-fixable settings (Phase 2)

**Entry point**: New dashboard button, gated on `isConnected && !tuning.session && currentProfile`.

---

## Audit Categories & Rules

### A. Safety & Arming (CRITICAL)

| Rule ID | Setting | Default | Recommended | Condition | Reason |
|---------|---------|---------|-------------|-----------|--------|
| `SAFETY-SMALL-ANGLE` | `small_angle` | 25 | **180** | All flight styles except smooth | Allows arming after crash when drone is upside down. Default 25° means you can't arm if tilted >25° |
| `SAFETY-FAILSAFE-PROCEDURE` | `failsafe_procedure` | 0 (DROP) | **1** (Landing) or **2** (GPS Rescue) | Quads ≥5" or with GPS | DROP cuts motors immediately — dangerous for heavy quads at altitude. Landing attempts controlled descent |
| `SAFETY-FAILSAFE-DELAY` | `failsafe_delay` | 4 (0.4s) | 4–10 | Warn if 0 or >15 | Too short = false triggers on brief signal loss. Too long = delayed response to real signal loss |
| `SAFETY-FAILSAFE-OFF-DELAY` | `failsafe_off_delay` | 10 (1s) | >0 | Warn if 0 | Zero means stage 2 never engages after guard time |
| `SAFETY-YAW-SPIN-RECOVERY` | `yaw_spin_recovery` | AUTO | **AUTO** or **ON** | Warn if OFF | Prevents uncontrolled yaw spin after collision. OFF is dangerous |
| `SAFETY-RECEIVER-CONFIG` | `serialrx_provider` | NONE | Any valid protocol | Warn if NONE | No receiver = no control |

### B. Motor & ESC (IMPORTANT)

| Rule ID | Setting | Default | Recommended | Size-Specific | Reason |
|---------|---------|---------|-------------|---------------|--------|
| `MOTOR-PROTOCOL` | `motor_pwm_protocol` | DSHOT600 | **DSHOT300** or **DSHOT600** | 1"–3": DSHOT300 OK; 5"+: DSHOT600 | Digital protocol required for modern BF features. DSHOT600 preferred for lower latency |
| `MOTOR-BIDIR-DSHOT` | `dshot_bidir` | OFF | **ON** | Critical for 5"+, important for 3–4", info for micros | Enables RPM filtering (36 surgical notch filters) + dynamic idle. Massive noise reduction |
| `MOTOR-POLES` | `motor_poles` | 14 | **Verify manually** | — | Wrong pole count = wrong RPM calculation = RPM filter targets wrong frequencies. Common: 14 (most 5" motors), 12 (some micro motors) |
| `MOTOR-DYN-IDLE` | `dyn_idle_min_rpm` | 0 | **Size-dependent** | 1": 60, 3": 40, 5": 20, 7": 15 | When BiDShot active, dynamic idle provides better low-throttle control and active braking. Without it, motors may desync on fast descents |
| `MOTOR-OUTPUT-LIMIT` | `motor_output_limit` | 100 | **100** | Warn if <100 (unless intentional) | Reduced output limit means less available thrust for recovery |
| `MOTOR-IDLE-VALUE` | `dshot_idle_value` | 550 | **550** (5.5%) | Warn if <300 or >800 | Too low = motor desync on punch. Too high = prop wash on descent |

### C. RC Link & Smoothing (IMPORTANT)

| Rule ID | Setting | Default | Recommended | Condition | Reason |
|---------|---------|---------|-------------|-----------|--------|
| `RC-SMOOTHING` | `rc_smoothing` | ON | **ON** | Warn if OFF | Without smoothing, motors get notchy signals → run hotter, more noise. Required for clean feedforward |
| `RC-FF-AVERAGING` | `feedforward_averaging` | OFF | **Match link rate** | ELRS 150Hz → 2_POINT, 500Hz → OFF | Mismatched FF averaging causes jitter or lag. Must match RC packet rate |
| `RC-FF-SMOOTH` | `feedforward_smooth_factor` | 25 | **Link-rate dependent** | Lower rate → higher smooth factor | Smooths feedforward for lower packet rate links |
| `RC-FF-JITTER` | `feedforward_jitter_factor` | 7 | **7–14** | Warn if 0 or >20 | Jitter reduction filters out packet timing noise in feedforward |

**Note**: RC link detection is limited — we can read `serialrx_provider` and `feedforward_averaging` from CLI diff, but exact link rate (150Hz, 250Hz, 500Hz) requires user input or inference from RC smoothing auto values.

### D. Power Management (IMPORTANT)

| Rule ID | Setting | Default | Recommended | Condition | Reason |
|---------|---------|---------|-------------|-----------|--------|
| `POWER-MIN-CELL` | `vbat_min_cell_voltage` | 330 | **330–340** | Warn if <320 or >360 | Too low = battery damage. Too high = premature landing |
| `POWER-MAX-CELL` | `vbat_max_cell_voltage` | 430 | **430** (LiPo) / **440** (LiHV) | Warn if >450 or <400 | Must match battery chemistry |
| `POWER-WARNING-CELL` | `vbat_warning_cell_voltage` | 350 | **340–360** | Warn if <330 or >380 | OSD warning trigger — too low means no warning before damage |
| `POWER-SAG-COMP` | `vbat_sag_compensation` | 0 | **0–100** | Info: suggest 80–100 for consistent throttle feel | Compensates for battery voltage sag under load, maintains consistent motor response throughout pack |
| `POWER-THRUST-LINEAR` | `thrust_linear` | 0 | **Size-dependent** | 5" freestyle: 0, Cine/LR: 20–40, Micros: 25 | Compensates nonlinear motor thrust curve. More useful for cinematic where smooth low-throttle matters |

### E. Size-Specific Recommendations (INFO)

Cross-reference current settings against community benchmarks per drone size:

| Size | Motor Protocol | BiDShot | Dyn Idle RPM | Thrust Linear | Motor Poles | Typical KV |
|------|---------------|---------|--------------|---------------|-------------|------------|
| 1" | DSHOT300 | Optional | 60 | 25 | 12 | 19000 |
| 2.5" | DSHOT300 | Recommended | 50 | 20 | 12–14 | 5500 |
| 3" | DSHOT600 | Recommended | 40 | 15 | 14 | 3600 |
| 4" | DSHOT600 | Recommended | 25 | 10 | 14 | 2550 |
| 5" | DSHOT600 | Critical | 20 | 0 | 14 | 1950 |
| 6" | DSHOT600 | Critical | 18 | 0 | 14 | 1550 |
| 7" | DSHOT600 | Critical | 15 | 0 | 14 | 1250 |

**Source**: Betaflight firmware-presets (aos_rc collection), Oscar Liang prop/motor tables, PID_TUNING_KNOWLEDGE.md quad archetypes.

---

## How to Read Settings

### Primary: CLI Diff from Latest Snapshot

The app captures `cliDiff` in every snapshot. Use `parseDiffSetting()` from `src/main/ipc/handlers/types.ts` to extract individual values.

**Key insight**: CLI diff only contains settings that differ from BF defaults. If a setting is absent, it's at the Betaflight default value. The audit engine must maintain a `BF_DEFAULTS` map for each audited setting.

### Secondary: Live MSP Reads

Already available at connection time: PID config, feedforward config, rates config, blackbox info. Use for higher accuracy where available.

### No CLI Mode Entry Required

The audit is entirely read-only. No need to enter CLI mode (which triggers FC reboot on exit). All data comes from existing snapshot + cached MSP reads.

---

## Health Score Calculation

```
healthScore = 100 - (criticalIssues × 15) - (importantIssues × 5) - (infoIssues × 1)
```

Clamped to 0–100. Displayed as a prominent badge with color coding:
- 90–100: Green (excellent)
- 70–89: Yellow (good, some improvements possible)
- 50–69: Orange (needs attention)
- <50: Red (significant issues)

---

## Architecture

### New Files

**Main process**:
```
src/main/configAudit/
├── ConfigAuditor.ts          # Orchestrator: reads config, runs rules, produces result
├── ConfigReader.ts           # Reads settings from CLI diff + MSP
├── constants.ts              # BF defaults, size-specific defaults, threshold tables
└── rules/
    ├── safetyRules.ts        # Category A
    ├── motorRules.ts         # Category B
    ├── rcLinkRules.ts        # Category C
    ├── powerRules.ts         # Category D
    └── sizeDefaultsRules.ts  # Category E
```

**Shared types**:
```
src/shared/types/configAudit.types.ts
```

**IPC**:
```
src/main/ipc/handlers/configAuditHandlers.ts  # 2 handlers: run + apply
```

**Renderer**:
```
src/renderer/components/ConfigAudit/
├── ConfigAuditPanel.tsx        # Main report view
├── ConfigAuditPanel.css
├── AuditCategorySection.tsx    # Collapsible category
└── AuditRecommendationCard.tsx # Individual recommendation
src/renderer/hooks/useConfigAudit.ts
```

### Key Types

```typescript
type AuditSeverity = 'critical' | 'important' | 'info';

type AuditCategory =
  | 'safety' | 'motor_esc' | 'rc_link'
  | 'power' | 'size_defaults';

interface ConfigAuditRecommendation {
  ruleId: string;
  category: AuditCategory;
  severity: AuditSeverity;
  setting: string;
  currentValue: string;
  recommendedValue: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  autoFixable: boolean;
  fixCommand?: string;  // e.g., "set small_angle = 180"
}

interface ConfigAuditResult {
  recommendations: ConfigAuditRecommendation[];
  healthScore: number;
  criticalCount: number;
  importantCount: number;
  infoCount: number;
  droneSize: DroneSize;
  timestamp: string;
  snapshotId: string;
}
```

### Rule Structure

Each rule is a pure function — trivial to unit test:

```typescript
interface AuditRule {
  ruleId: string;
  category: AuditCategory;
  severity: AuditSeverity;
  settings: string[];  // Which CLI diff settings this rule inspects
  evaluate(context: AuditContext): ConfigAuditRecommendation | null;
}

interface AuditContext {
  cliSettings: Map<string, string>;  // Parsed CLI diff
  profile: DroneProfile;              // Size, battery, flight style
  ffConfig?: FeedforwardConfiguration;
  pidConfig?: PIDConfiguration;
  bbSettings?: BlackboxSettings;
}
```

### Reusable Infrastructure

| Existing Asset | Reuse For |
|----------------|-----------|
| `parseDiffSetting()` | Core CLI diff parsing |
| `IPCResponse<T>` + `createResponse()` | IPC response pattern |
| `HandlerDependencies` DI | Handler registration |
| `FC_FIX_BLACKBOX_SETTINGS` handler flow | Apply fixes via CLI (Phase 2) |
| `BF_SETTING_RANGES` | Validation bounds for applied values |
| `SIZE_DEFAULTS` / `PRESET_PROFILES` | Size-aware defaults |
| `SnapshotManager.loadSnapshot()` | Reading latest CLI diff |
| `DataQualityScore` visual pattern | Health score visualization |

---

## Phased Implementation

### Phase 1 — MVP (Read-Only Audit)

- **~20 rules** across categories A–E
- Single-page report with collapsible category sections
- Health score badge
- "Copy CLI Command" button per recommendation (no auto-apply)
- Size-aware rules for 7 supported sizes
- Unit tests for all rules (pure functions)
- Component tests for UI

### Phase 2 — Apply Fixes

- Checkbox selection per recommendation
- "Apply Selected" button → enters CLI, sends `set` commands, saves, reboots
- Reuses `FC_FIX_BLACKBOX_SETTINGS` pattern from `fcInfoHandlers.ts`
- Post-apply verification (re-read settings, confirm changes applied)
- Auto-creates snapshot before applying (rollback safety)

### Phase 3 — Advanced

- **RC link detection**: Infer link rate from RC smoothing auto values or ask user
- **GPS Rescue audit**: If GPS features detected in CLI diff
- **OSD audit**: Essential elements check
- **Historical tracking**: Store audit results per profile, show improvement over time
- **Telemetry integration**: Include audit results in telemetry bundle
- **Community presets integration**: "Apply community preset for your size" one-click

---

## Community Preset Categories (Reference)

From Betaflight firmware-presets repository — categories the Health Check could eventually cover:

| BF Preset Category | Health Check Coverage | Phase |
|--------------------|----------------------|-------|
| RC_LINK | Category C (protocol + smoothing) | 1 |
| RC_SMOOTHING | Category C (smoothing + FF matching) | 1 |
| MODES | Category A (arm switch + safety modes) | 1 |
| OSD | Not in MVP (convenience, not safety) | 3 |
| RATES | Out of scope (subjective preference) | — |
| VTX | Out of scope (hardware-specific, legal) | — |
| LEDS | Out of scope (cosmetic) | — |
| BNF | N/A (full machine config) | — |

---

## Expert Sources

| Source | Focus | URL |
|--------|-------|-----|
| Oscar Liang | Comprehensive BF setup guides, size tables | [oscarliang.com](https://oscarliang.com) |
| Joshua Bardwell | Build guides, ESC/motor config | [fpvknowitall.com](https://fpvknowitall.com) |
| Chris Rosser (aos_rc) | Firmware presets, size-specific tunes | [aos-rc.com](https://aos-rc.com) |
| Betaflight Wiki | Official documentation | [betaflight.com/docs](https://betaflight.com/docs) |
| BF firmware-presets | Community preset repository | [github.com/betaflight/firmware-presets](https://github.com/betaflight/firmware-presets) |

---

## Open Questions

1. **Feature naming**: "Health Check" vs "Config Optimizer" vs "Setup Audit" — need user testing
2. **RC link rate input**: How to determine the user's actual RC link rate? Options: (a) ask in profile wizard, (b) infer from `feedforward_averaging` value, (c) read from BBL header `rc_smoothing_input_hz`
3. **BF version-specific defaults**: Some defaults changed between BF 4.3→4.4→4.5. Do we maintain per-version default maps or only support latest?
4. **Motor poles**: Cannot verify automatically — always flag as "verify manually"?
5. **Scope creep risk**: Feature could grow endlessly. Strict phase gating needed.
