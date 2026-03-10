# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PIDlab is an Electron-based desktop application for managing FPV drone PID configurations. It uses MSP (MultiWii Serial Protocol) to communicate with Betaflight flight controllers over USB serial connection.

**Current Phase**: Phase 4 complete, Phase 6 complete (CI/CD, code quality, data quality scoring, flight quality score)

**Tech Stack**: Electron + TypeScript + React + Vite + serialport + fft.js

## Development Commands

### Essential Commands
```bash
# Start development with hot reload (includes debug server on port 9300)
npm run dev

# Run unit tests (watch mode)
npm test

# Run unit tests once (pre-commit)
npm run test:run

# Interactive test UI
npm run test:ui

# Run Playwright E2E tests (builds app first)
npm run test:e2e

# Build for production
npm run build

# Rebuild native modules (serialport)
npm run rebuild
```

### Demo Mode (Offline UX Testing)
```bash
# Start with simulated FC — no hardware needed (includes debug server)
npm run dev:demo
```
Boots the app with a mock flight controller that auto-connects on startup. Generates realistic BBL data, allows full tuning workflow testing (all 10 phases), and runs real analysis (FFT, step response). See `docs/OFFLINE_UX_TESTING.md` for details.

### Debug Server

Both `npm run dev` and `npm run dev:demo` start with `DEBUG_SERVER=true`, which launches an HTTP debug server on `http://127.0.0.1:9300`. The server exposes app state for tooling integration (e.g., Claude Code).

**Endpoints:**

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check (PID, uptime) |
| `GET /state` | Connection, profile, tuning session, blackbox info |
| `GET /screenshot` | Capture renderer screenshot (saves PNG, returns path) |
| `GET /logs` | Last N lines from electron-log (`?n=100` for count) |
| `GET /console` | Renderer console messages (`?level=error` to filter) |
| `GET /msp` | MSP connection details, CLI mode, FC info, filter/PID config |

**Configuration:**
- Controlled by `DEBUG_SERVER=true` environment variable (not active in production builds)
- Port override: `DEBUG_SERVER_PORT=9400` (default: 9300)
- Screenshots saved to `debug-screenshots/` (gitignored)
- Implementation: `src/main/debug/DebugServer.ts`

### After Native Module Changes
If serialport or other native modules fail:
```bash
npm run rebuild
```

## Architecture

### Electron Process Model

**Main Process** (`src/main/`)
- Entry point: `src/main/index.ts`
- Manages MSPClient, ProfileManager, SnapshotManager, BlackboxManager, TuningSessionManager
- Handles IPC communication via `src/main/ipc/handlers.ts`
- Event-driven architecture: MSPClient emits events → IPC sends to renderer
- Blackbox parsing: `src/main/blackbox/` (BBL binary log parser)
- FFT analysis: `src/main/analysis/` (noise analysis & filter tuning)
- Step response analysis: `src/main/analysis/` (PID tuning via step metrics)
- Debug server: `src/main/debug/DebugServer.ts` (HTTP endpoints for tooling, port 9300)

**Preload Script** (`src/preload/index.ts`)
- Exposes `window.betaflight` API to renderer
- Type-safe bridge using `@shared/types/ipc.types.ts`
- All main ↔ renderer communication goes through this API

**Renderer Process** (`src/renderer/`)
- React application with hooks-based state management
- No direct IPC access - uses `window.betaflight` API only
- Event subscriptions via `onConnectionChanged`, `onProfileChanged`, `onNewFCDetected`
- Tuning wizard: `src/renderer/components/TuningWizard/` (Deep Tune flow, mode='filter'/'pid' only)
- Analysis overview: `src/renderer/components/AnalysisOverview/` (read-only single-page analysis)

### Multi-Drone Profile System

**Profile Detection Flow**:
1. User connects FC via USB
2. MSPClient reads FC serial number (UID)
3. ProfileManager checks if profile exists for this serial
4. If exists → auto-select profile, create baseline snapshot if missing
5. If new FC → show ProfileWizard modal (cannot be cancelled)

**Profile-Snapshot Linking**:
- Each profile has `snapshotIds: string[]` array
- Snapshots are filtered by current profile
- Deleting profile deletes all associated snapshots
- Baseline snapshot created automatically on first connection

**Profile Locking**:
- When FC connected, profile switching is disabled in UI
- Prevents data corruption from profile mismatch
- Implemented in `ProfileSelector.tsx` using connection status

### MSP Communication

**MSP Protocol Layer** (`src/main/msp/`):
- `MSPProtocol.ts` - Low-level packet encoding/decoding. Jumbo frame support (frames >255 bytes: 2-byte size at offset+4)
- `MSPConnection.ts` - Serial port handling, CLI mode switching
- `MSPClient.ts` - High-level API with retry logic
- `cliUtils.ts` - CLI command response validation (`validateCLIResponse()` throws `CLICommandError` on error patterns: 'Invalid name/value', 'Unknown command', line-level `ERROR`). Used in tuning/snapshot/fcInfo IPC handlers

**Important MSP Behaviors**:
- FC may be stuck in CLI mode from previous session → `forceExitCLI()` on connect (resets local flag only)
- BF CLI `exit` command ALWAYS reboots FC (`systemReset()`) — no way to leave CLI without reboot
- `MSPConnection.close()` sends `exit` before closing if CLI was entered during the session (`fcEnteredCLI` flag)
- `exitCLI()`/`forceExitCLI()` only reset local `cliMode` flag — no commands sent to FC
- `clearFCRebootedFromCLI()` clears the flag after `save` (FC already reboots from save)
- Board name may be empty/invalid → fallback to target name
- Connection requires 500ms stabilization delay after port open
- Retry logic: 2 attempts with reset between failures
- **Version gate**: `validateFirmwareVersion()` checks API version on connect — rejects BF < 4.3 (API 1.44) with `UnsupportedVersionError`, auto-disconnects

### Betaflight Version Compatibility

**Minimum**: BF 4.3 (API 1.44) — **Recommended**: BF 4.5+ (API 1.46) — **Actively tested**: BF 4.5.x, 2025.12.x

- Version gate in `MSPClient.ts` auto-disconnects unsupported firmware on connect
- Constants in `src/shared/constants.ts`: `BETAFLIGHT.MIN_VERSION`, `BETAFLIGHT.MIN_API_VERSION`
- `UnsupportedVersionError` in `src/main/utils/errors.ts`
- **DEBUG_GYRO_SCALED**: Removed in BF 2025.12 (4.6+). Header validation and FCInfoDisplay skip debug mode check for 4.6+
- **CLI naming**: All `feedforward_*` (4.3+ naming only). No `ff_*` (4.2) support needed
- **MSP_FILTER_CONFIG**: 47-byte layout stable from 4.3 onward
- Full policy: `docs/BF_VERSION_POLICY.md`

### IPC Architecture (Modular Handlers)

IPC handlers are split into domain modules under `src/main/ipc/handlers/`:

| Module | Handlers | Purpose |
|--------|----------|---------|
| `types.ts` | — | `HandlerDependencies` interface, `createResponse`, `parseDiffSetting` |
| `events.ts` | — | 7 event broadcast functions |
| `connectionHandlers.ts` | 6 | Port scanning, connect, disconnect, status, demo mode, reset demo |
| `fcInfoHandlers.ts` | 5 | FC info, CLI export, BB settings, FF config, fix settings |
| `snapshotHandlers.ts` | 6 | Snapshot CRUD, export, restore |
| `profileHandlers.ts` | 10 | Profile CRUD, presets, FC serial |
| `pidHandlers.ts` | 3 | PID get/set/save |
| `blackboxHandlers.ts` | 9 | Info, download, list, delete, erase, folder, test, parse, import |
| `analysisHandlers.ts` | 3 | Filter, PID, and transfer function analysis |
| `tuningHandlers.ts` | 8 | Apply, session CRUD (deep + flash), history, update verification, update history verification |
| `index.ts` | — | DI container, `registerIPCHandlers()` |

**Request-Response Pattern**:
```typescript
// Renderer → Main
const response = await window.betaflight.someMethod(params);
// Returns: IPCResponse<T> = { success: boolean, data?: T, error?: string }
```

**Event Broadcasting**:
```typescript
// Main → Renderer
mspClient.on('connection-changed', (status) => {
  sendConnectionChanged(window, status);
});

// Renderer subscribes
window.betaflight.onConnectionChanged((status) => {
  // Handle status update
});
```

### Storage System

**Profile Storage** (`ProfileManager.ts`):
- Location: `{userData}/data/profiles/`
- One JSON file per profile: `{profileId}.json`
- Metadata index: `profiles.json` (list of all profiles)
- Current profile ID: `current-profile.txt`

**Snapshot Storage** (`SnapshotManager.ts`):
- Location: `{userData}/data/snapshots/`
- One JSON file per snapshot: `{snapshotId}.json`
- Contains: FC info, CLI diff, timestamp, label, type (baseline/manual/auto)
- Snapshots are linked to profiles via `snapshotIds` array

**Critical**: Snapshot filtering happens server-side (main process) based on current profile's `snapshotIds` array. This prevents snapshots from different profiles mixing in UI.

**Tuning History Storage** (`TuningHistoryManager.ts`):
- Location: `{userData}/data/tuning-history/{profileId}.json`
- Array of `CompletedTuningRecord[]` per profile (oldest-first on disk, newest-first in API)
- Archived from completed sessions with self-contained metrics + applied changes
- Deleted when profile is deleted
- Compact metrics: `FilterMetricsSummary` (noise floor, peaks, 128-bin spectrum), `PIDMetricsSummary` (step response)
- Spectrum downsampling: `downsampleSpectrum()` in `src/shared/utils/metricsExtract.ts`
- Design doc: `docs/TUNING_HISTORY_AND_COMPARISON.md`

### Blackbox Parser (`src/main/blackbox/`)

Parses Betaflight .bbl/.bfl binary log files into typed time series data.

**Pipeline**: StreamReader → HeaderParser → ValueDecoder → PredictorApplier → FrameParser → BlackboxParser

- 10 encoding types, 10 predictor types — validated against BF Explorer (see `docs/BBL_PARSER_VALIDATION.md`)
- Multi-session support (multiple flights per file)
- Corruption recovery aligned with BF Explorer (byte-by-byte, no forward-scan resync)
- **NEG_14BIT encoding**: Uses `-signExtend14Bit(readUnsignedVB())` matching BF Explorer. Sign-extends bit 13, then negates.
- **TAG8_8SVB count==1**: When only 1 field uses this encoding, reads signedVB directly (no tag byte) — matches BF encoder/decoder special case.
- **AVERAGE_2 predictor**: Uses `Math.trunc((prev + prev2) / 2)` for truncation toward zero (C integer division), matching BF Explorer.
- **LOG_END handling**: `parseEventFrame()` returns event type; LOG_END validates "End of log\0" string (anti-false-positive), then terminates session. Matches BF viewer behavior.
- **Event frame parsing**: Uses VB encoding (readUnsignedVB/readSignedVB) for all event data — NOT fixed skip(). SYNC_BEEP=1×UVB, DISARM=1×UVB, FLIGHT_MODE=2×UVB, LOGGING_RESUME=2×UVB, INFLIGHT_ADJUSTMENT=1×U8+conditional.
- **Frame validation** (aligned with BF viewer): structural size limit (256 bytes), iteration continuity (< 5000 jump), time continuity (< 10s jump). No sensor value thresholds — debug/motor fields can legitimately exceed any fixed range. No consecutive corrupt frame limit (matches BF Explorer).
- **Unknown bytes**: Silently skipped at frame boundaries (0x00, 0x02, 0x04 etc. are normal). No corruption counting.
- **Corrupt frame recovery**: Rewind to `frameStart + 1` and continue byte-by-byte (matches BF Explorer). No forward-scan resync.
- IPC: `BLACKBOX_PARSE_LOG` + `EVENT_BLACKBOX_PARSE_PROGRESS`
- Output: `BlackboxFlightData` with gyro, setpoint, PID, motor as `Float64Array` time series

### FFT Analysis Engine (`src/main/analysis/`)

Analyzes gyro noise spectra to produce filter tuning recommendations.

**Pipeline**: SegmentSelector → FFTCompute → NoiseAnalyzer → FilterRecommender → FilterAnalyzer

- **SegmentSelector**: Finds stable hover segments and throttle sweep segments (excludes takeoff/landing/acro)
- **FFTCompute**: Hanning window, Welch's method (50% overlap), power spectral density
- **NoiseAnalyzer**: Noise floor estimation, peak detection (prominence-based), source classification (frame resonance 80-200 Hz, motor harmonics, electrical >500 Hz)
- **FilterRecommender**: Absolute noise-based target computation (convergent), safety bounds, propwash-aware gyro LPF1 floor (100 Hz min, bypass at -15 dB extreme noise), beginner-friendly explanations
- **ThrottleSpectrogramAnalyzer**: Bins gyro data by throttle level (10 bands), per-band FFT spectra and noise floors. Returns `ThrottleSpectrogramResult`
- **GroupDelayEstimator**: Per-filter group delay estimation (PT1, biquad, notch). Returns `FilterGroupDelay` with gyroTotalMs, dtermTotalMs, warning if >2ms. Smart `dyn_notch_q` handling: `Q > 10 ? Q / 100 : Q` for BF internal storage quirk
- **FilterAnalyzer**: Orchestrator with async progress reporting. Returns throttle spectrogram + group delay in result
- IPC: `ANALYSIS_RUN_FILTER` + `EVENT_ANALYSIS_PROGRESS`
- Dependency: `fft.js`
- Constants in `src/main/analysis/constants.ts` (tunable thresholds)

### Step Response Analysis Engine (`src/main/analysis/`)

Analyzes step response metrics from setpoint/gyro data to produce PID tuning recommendations.

**Pipeline**: StepDetector → StepMetrics → PIDRecommender → PIDAnalyzer

- **StepDetector**: Derivative-based step input detection in setpoint data, hold/cooldown validation. Configurable window parameter (`windowMs?`)
- **StepMetrics**: Rise time, overshoot percentage, settling time, latency, ringing measurement. Adaptive two-pass window sizing (`computeAdaptiveWindowMs()` — median-based, clamped 150-500ms). Steady-state error tracking (`steadyStateErrorPercent`)
- **PIDRecommender**: Flight-PID-anchored P/D/I recommendations (convergent), `extractFlightPIDs()` from BBL header, proportional severity-based steps (D: +5/+10/+15, P: -5/-10), I-term rules based on `meanSteadyStateError` with flight-style thresholds, D/P damping ratio validation (0.45-0.85 range), safety bounds (P: 20-120, D: 15-80, I: 30-120). **D-term effectiveness gating**: 3-tier D-increase gating (>0.7 boost confidence, 0.3-0.7 allow+warn, <0.3 redirect to filters). **Prop wash integration**: severe prop wash (≥5×) boosts D-increase confidence or generates new D+5 recommendation on worst axis. **Rule TF-4**: DC gain deficit from transfer function → I-term increase recommendation (Flash Tune equivalent of steady-state error detection)
- **CrossAxisDetector**: Pearson correlation coupling detection between axis pairs. Thresholds: none (<0.15), mild (0.15-0.4), significant (≥0.4). Returns `CrossAxisCoupling`
- **PropWashDetector**: Throttle-down event detection, post-event FFT in 20-90 Hz band. Returns `PropWashAnalysis` with events, meanSeverity, worstAxis, dominantFrequencyHz. Passed to `recommendPID()` for prop wash-aware D recommendations
- **PIDAnalyzer**: Orchestrator with async progress reporting, threads `flightPIDs` through pipeline. Two-pass step detection (first 500ms, then adaptive). Passes both `dTermEffectiveness` and `propWash` to `recommendPID()` for integrated D-gain gating
- IPC: `ANALYSIS_RUN_PID` + `EVENT_ANALYSIS_PROGRESS`

### Transfer Function Analysis Engine (`src/main/analysis/`)

Analyzes system transfer function via Wiener deconvolution for PID recommendations from any flight data.

**Pipeline**: TransferFunctionEstimator (setpoint → gyro deconvolution → H(f) = S_xy(f) / S_xx(f))

- **TransferFunctionEstimator**: Cross-spectral density estimation, bandwidth/phase margin extraction, `dcGainDb` field for I-term approximation, PID recommendations based on frequency response characteristics
- Used in Flash Tune mode for combined filter + PID analysis from a single flight
- IPC: `ANALYSIS_RUN_TRANSFER_FUNCTION` + `EVENT_ANALYSIS_PROGRESS`

### Data Quality Scoring (`src/main/analysis/DataQualityScorer.ts`)

Rates flight data quality 0-100 before generating recommendations. Integrated into both FilterAnalyzer and PIDAnalyzer.

- **`scoreFilterDataQuality()`**: Sub-scores: segment count (0.20), hover time (0.35), throttle coverage (0.25), segment type (0.20)
- **`scorePIDDataQuality()`**: Sub-scores: step count (0.30), axis coverage (0.30), magnitude variety (0.20), hold quality (0.20)
- **`adjustFilterConfidenceByQuality()` / `adjustPIDConfidenceByQuality()`**: Downgrades recommendation confidence for fair/poor data
- Tier mapping: 80-100 excellent, 60-79 good, 40-59 fair, 0-39 poor
- Quality warnings: `few_segments`, `short_hover_time`, `narrow_throttle_coverage`, `few_steps_per_axis`, `missing_axis_coverage`, `low_step_magnitude`
- UI: quality pill in FilterAnalysisStep, PIDAnalysisStep, AnalysisOverview
- History: compact `dataQuality` in `FilterMetricsSummary` / `PIDMetricsSummary`
- **Flight quality score** (`src/shared/utils/tuneQualityScore.ts`): Composite 0-100 score with type-aware components. Deep Tune: noise floor, tracking RMS, overshoot (step response), settling time (4 components). Flash Tune: noise floor, overshoot (TF synthetic step response), phase margin, bandwidth (4 components). When both step data AND TF are present, 6 components are available. Optional Noise Delta component when verification present. Points redistributed evenly among available components. Displayed as badge in TuningCompletionSummary and TuningHistoryPanel. Trend chart (QualityTrendChart) shows progression across sessions.

### Stateful Tuning Session

Two tuning modes: **Deep Tune** (2-flight, filters then PIDs) and **Flash Tune** (1-flight, combined analysis via Wiener deconvolution).

**TuningType**: `'guided' | 'quick'` (internal values) — displayed as "Deep Tune" / "Flash Tune" via `TUNING_TYPE_LABELS`

**Deep Tune State Machine** (`TuningPhase`): filter_flight_pending → filter_log_ready → filter_analysis → filter_applied → pid_flight_pending → pid_log_ready → pid_analysis → pid_applied → verification_pending → completed

**Flash Tune State Machine** (`TuningPhase`): quick_flight_pending → quick_log_ready → quick_analysis → quick_applied → verification_pending → completed

- **TuningSessionManager** (`src/main/storage/`): CRUD for per-profile session files at `{userData}/data/tuning/{profileId}.json`
- **useTuningSession hook**: Manages session lifecycle with IPC and event subscription
- **TuningStatusBanner**: Dashboard banner showing current phase, 6-step indicator (Prepare → Filter Flight → Filter Tune → PID Flight → PID Tune → Verify), action buttons
- **TuningMode**: `'filter' | 'pid' | 'full' | 'quick'` — wizard components adapt UI/flow per mode
- **Verification flow**: After PID apply → "Erase & Verify" → erase flash → fly hover → download → analyze → completed. Or "Skip & Complete" to skip.
- **Archive on completion**: When phase transitions to `completed`, session is archived to `TuningHistoryManager` before becoming dismissable
- IPC: `TUNING_GET_SESSION`, `TUNING_START_SESSION`, `TUNING_UPDATE_PHASE`, `TUNING_RESET_SESSION`, `TUNING_GET_HISTORY`, `TUNING_UPDATE_VERIFICATION`, `TUNING_UPDATE_HISTORY_VERIFICATION` + `EVENT_TUNING_SESSION_CHANGED`
- Design doc: `docs/TUNING_WORKFLOW_REVISION.md`

### Analysis Overview (`src/renderer/components/AnalysisOverview/`)

Read-only single-page analysis view. Opened when user clicks "Analyze" on a downloaded log **without an active tuning session**.

- **useAnalysisOverview hook**: Auto-parses on mount, auto-runs both filter and PID analyses in parallel for single-session logs, session picker for multi-session logs
- **AnalysisOverview component**: Single scrollable page with filter section (noise spectrum, axis summary, observations) and PID section (step metrics, current PIDs, step response chart, observations)
- No wizard steps, no Apply button, no flight guide — purely informational
- Reuses SpectrumChart, StepResponseChart, RecommendationCard from TuningWizard
- Recommendations labeled as "Observations" (read-only context)

### Tuning Wizard (`src/renderer/components/TuningWizard/`)

Multi-step wizard for active tuning sessions (Deep Tune and Flash Tune). Supports mode-aware step routing.

**Steps by mode** (used only during active tuning sessions):
- `filter`: Flight Guide → Session → Filters → Summary (skips PIDs)
- `pid`: Flight Guide → Session → PIDs → Summary (skips Filters)
- `quick`: Session → Flash Tune Analysis (filter + TF in parallel, auto-runs) → Summary

- **useTuningWizard hook**: State management for parse/filter/PID analysis and apply lifecycle, mode-aware auto-advance and apply
- **WizardProgress**: Visual step indicator with done/current/upcoming states, dynamic step filtering by mode
- **FlightGuideContent**: Mode-specific flight phase instructions (filter: throttle sweeps, pid: stick snaps)
- **TuningSummaryStep**: Mode-specific button labels (Apply Filters/PIDs) and success messages
- **ApplyConfirmationModal**: Confirmation dialog before applying changes (snapshot option, reboot warning)
- **TuningWorkflowModal**: Standalone modal showing two-flight workflow with separate filter + PID guides
- Flight guide data in `src/shared/constants/flightGuide.ts`
- Triggered from TuningStatusBanner when active tuning session is at filter_analysis or pid_analysis phase

### Analysis Charts (`src/renderer/components/TuningWizard/charts/`)

Interactive visualization of analysis results using Recharts (SVG).

- **SpectrumChart**: FFT noise spectrum with per-axis color coding, noise floor reference lines, peak frequency markers. Integrated in FilterAnalysisStep noise details (collapsible).
- **StepResponseChart**: Setpoint vs gyro trace for individual steps, Prev/Next step navigation, metrics overlay (overshoot, rise time, settling, latency). Integrated in PIDAnalysisStep (collapsible).
- **TFStepResponseChart**: Synthetic step response from Transfer Function analysis (Wiener deconvolution). Single mode for Flash Analysis in QuickAnalysisStep, before/after comparison mode for verification in TuningCompletionSummary and TuningSessionDetail. Plasmatree PID-Analyzer inspired. Shows per-axis overshoot metrics and delta pill.
- **AxisTabs**: Shared tab selector (Roll/Pitch/Yaw/All) for both charts
- **chartUtils**: Data conversion utilities (Float64Array → Recharts format), downsampling, findBestStep scoring
- **StepResponseTrace**: Raw trace data (timeMs, setpoint, gyro arrays) extracted in `StepMetrics.computeStepResponse()` and attached to each `StepResponse`
- Dependency: `recharts`

### Tuning History & Comparison (`src/renderer/components/TuningHistory/`)

Completed tuning sessions are archived with self-contained metrics for comparison.

- **TuningCompletionSummary**: Shown when `session.phase === 'completed'` instead of the generic banner. Shows noise chart (if verification data available), applied changes, PID metrics, Dismiss/Start New buttons
- **NoiseComparisonChart**: Before/after spectrum overlay using Recharts. "Before" from filter hover flight, "After" from verification hover flight. Delta pill shows dB improvement/regression
- **AppliedChangesTable**: Reusable table of setting changes with old → new values and % change
- **TuningHistoryPanel**: Dashboard section below SnapshotManager. Expandable cards per completed tuning session (newest first). Includes quality score badge and trend chart.
- **QualityTrendChart**: Line chart showing flight quality score progression across tuning sessions (minimum 2 data points to render)
- **TuningSessionDetail**: Expanded view reusing NoiseComparisonChart and AppliedChangesTable
- **useTuningHistory hook**: Loads history for current profile, reloads on profile change and session dismissal
- Verification flight: optional hover after PID apply. Compare filter hover spectrum (before) vs verification hover spectrum (after)
- Types in `src/shared/types/tuning-history.types.ts` (CompactSpectrum, FilterMetricsSummary, PIDMetricsSummary, CompletedTuningRecord)
- Design doc: `docs/TUNING_HISTORY_AND_COMPARISON.md`

### Auto-Apply Recommendations

**Apply Flow** (orchestrated in `TUNING_APPLY_RECOMMENDATIONS` IPC handler):
1. Stage 1: Apply PID changes via MSP (must happen before CLI mode)
2. Stage 2: Enter CLI mode (no snapshot — Pre-tuning (auto) from Start Tuning covers rollback)
3. Stage 3: Apply filter changes via CLI `set` commands
4. Stage 4: Save to EEPROM and reboot FC

**MSP Filter Config** (`MSP_FILTER_CONFIG`, command 92):
- Reads current filter settings directly from FC (gyro LPF1/2, D-term LPF1/2, dynamic notch)
- Auto-read in analysis handlers when FC connected and settings not provided
- Byte layout verified against betaflight-configurator MSPHelper.js

**MSP Dataflash Read** (`MSP_DATAFLASH_READ`, command 0x46):
- Response format: `[4B readAddress LE][2B dataSize LE][1B isCompressed (BF4.1+)][flash data]`
- `MSPClient.extractFlashPayload()` strips the 6-7 byte header, returns only flash data
- Both 6-byte (no compression flag) and 7-byte (with compression flag) formats supported
- Huffman compression not yet implemented (logs warning if detected)

**SD Card Blackbox Support** (`MSP_SDCARD_SUMMARY`, command 79):
- `BlackboxInfo.storageType`: `'flash' | 'sdcard' | 'none'` — detection is automatic (flash first, SD card fallback)
- SD card logs cannot be read via MSP — download uses MSC (Mass Storage Class) mode
- MSC workflow: `MSP_REBOOT(type=2)` → FC re-enumerates as USB drive → copy .bbl files → eject → FC reboots
- `MSCManager` (`src/main/msc/`) orchestrates the full MSC download/erase cycle with progress reporting
- `driveDetector` handles cross-platform drive mount detection (macOS/Windows/Linux)
- MSC disconnect is expected — `mscModeActive` flag prevents profile clear on disconnect
- Smart reconnect: for SD card, auto-transition from `*_flight_pending` is skipped (user confirms via UI). If `eraseCompleted` is set, reconnect keeps phase but UI shows post-erase guide
- Multi-file download: SD card may have multiple .bbl files — handler always returns the latest (newest) metadata for API compatibility
- UI: BlackboxStatus shows same interface for both storage types (transparent to user)
- Design doc: `docs/SD_CARD_BLACKBOX_SUPPORT.md`

**Important**: Stage ordering matters — MSP commands must execute before CLI mode, because FC only processes CLI input while in CLI mode (MSP timeouts).

**Auto-Snapshot Strategy** (3 per tuning cycle):
- `Pre-tuning (auto)` — created by Start Tuning (rollback safety net)
- `Post-filter (auto)` — created on reconnect after filter apply (filter result / pre-PID state)
- `Post-tuning (auto)` — created on reconnect after PID apply (final tuned result)

**Snapshot Display**: Dynamic `#N` numbering (oldest=#1, newest=#N), adjusts on deletion.

**Diff Semantics**: Setting disappearing from CLI diff = "Changed to (default)", not "Removed" (BF restores factory default).

### Snapshot Restore (Rollback)

**Restore Flow** (orchestrated in `SNAPSHOT_RESTORE` IPC handler):
1. Load snapshot and parse `cliDiff` — extract restorable CLI commands
2. Stage 1 (backup): Create "Pre-restore (auto)" safety snapshot
3. Stage 2 (cli): Enter CLI mode, send each command
4. Stage 3 (save): Save and reboot FC

**Restorable commands**: `set`, `feature`, `serial`, `aux`, `beacon`, `map`, `resource`, `timer`, `dma` — everything except identity (`board_name`, `mcu_id`), control (`diff`, `batch`, `defaults`, `save`), and profile selection commands.

**CLI prompt detection** (`MSPConnection.sendCLICommand`): The real BF CLI prompt is `# ` (hash + space). Detection strips trailing `\r` from buffer (FC may send extra CR), then checks `endsWith('\n# ')`. Never use `trimEnd()` (it strips the space that distinguishes the prompt from section headers). **100ms debounce** in `sendCLICommand` — when the pattern matches, a timer starts. If more data arrives before it fires (e.g. `# master\r\n...`), the timer resets. Only when no data arrives for 100ms does it resolve as the real prompt. `enterCLI()` uses the same strip-CR + `endsWith('\n# ')` check but without debounce (no diff output during CLI entry).

## Testing Requirements

**Mandatory**: All UI changes require tests. Pre-commit hook enforces this.

**Important**: After adding or removing tests, update the test inventory in `TESTING.md`. Keep counts and file lists accurate.

### Playwright E2E Tests (Demo Mode)

E2E tests launch the real Electron app in demo mode via Playwright's `_electron.launch()`.

```bash
npm run test:e2e              # Build + run 22 E2E tests
npm run test:e2e:ui           # Build + Playwright UI
npm run demo:generate-history # Build + generate 5 tuning sessions (~2 min)
```

**Architecture:**
- `e2e/electron-app.ts` — Shared fixture: `launchDemoApp()`, isolated `.e2e-userdata/` dir, screenshot helpers
- `E2E_USER_DATA_DIR` env var → `app.setPath('userData', ...)` in `src/main/index.ts` for test isolation
- Clean state: `.e2e-userdata/` is wiped before each test file
- `test:e2e` uses `--grep-invert 'generate 5'` to exclude slow generator
- 4 spec files: smoke (4), Deep Tune cycle (11), Flash Tune cycle (7), history generator (1)
- `vitest.config.ts` excludes `e2e/` to prevent Vitest from picking up Playwright specs
- `advancePastVerification()` in MockMSPClient keeps flight type cycling correct when verification is skipped

### Test Coverage
- See `TESTING.md` for the authoritative test inventory (counts per file, descriptions)
- Test files are co-located with source: `Component.tsx` + `Component.test.tsx`

### Mock Setup
Tests use `src/renderer/test/setup.ts` which mocks `window.betaflight` API. Key points:
- Mock all API methods before each test with `vi.mocked(window.betaflight.method)`
- Mock event subscriptions return cleanup functions: `() => {}`
- Use `waitFor()` for async state updates
- Use `getByRole()` for accessibility-compliant queries

### Common Test Patterns
```typescript
// Component test
const user = userEvent.setup();
render(<Component />);
await waitFor(() => {
  expect(screen.getByText('Expected')).toBeInTheDocument();
});

// Hook test
const { result } = renderHook(() => useYourHook());
await waitFor(() => {
  expect(result.current.data).toBeDefined();
});
```

## Key Behaviors & Gotchas

### Connection Flow
1. **Port scanning** filters by Betaflight vendor IDs (fallback to all if none found)
2. **Auto port selection** - if selected port disappears, auto-select first available
3. **3-second cooldown** after disconnect to prevent "FC not responding" errors
4. **1-second backend delay** in disconnect for port release
5. **Port rescan** 1.5s after disconnect to detect new FC

### Profile Management
- **Cannot cancel ProfileWizard** - profile creation is mandatory for new FC
- **Active profile deletion** allowed - disconnects FC automatically
- **Profile switching** disabled when FC connected (UI lock with visual indicator)
- **Preset profiles** available in `@shared/constants.ts` (10 common drone types)

### Snapshot Behavior
- **Baseline** type cannot be deleted via UI
- **Auto-created baseline** when profile first connects
- **Export** downloads CLI diff as `.txt` file
- **Restore** sends `set` commands from snapshot CLI diff to FC via CLI, then saves and reboots
- **Restore safety backup** auto-creates "Pre-restore (auto)" snapshot before applying
- **Server-side filtering** by current profile's snapshotIds
- **Dynamic numbering** `#1` (oldest) through `#N` (newest) — recalculates on deletion
- **Compare** shows diff between snapshot and previous one (or empty config for oldest). Uses `snapshotDiffUtils.ts` to parse CLI diff, compute changes, and group by command type. Displayed in `SnapshotDiffModal` with GitHub-style color coding (green=added, yellow=changed). Settings reverted to factory default show as "Changed to (default)".

### BlackboxStatus Readonly Mode
- When a tuning session is active, `BlackboxStatus` enters readonly mode (`readonly={!!tuning.session}`)
- Readonly hides all action buttons: Download, Erase Flash, Test Read, Analyze
- Storage info and log list remain visible (information only)
- All actions are driven by `TuningStatusBanner` (single point of action UX pattern)
- When no tuning session is active, `BlackboxStatus` shows full functionality

### FC Info Blackbox Diagnostics
- `FCInfoDisplay` shows `debug_mode` and `logging_rate` on the right side with ✓/⚠ indicators
- Settings read from baseline snapshot CLI diff via `FC_GET_BLACKBOX_SETTINGS` IPC (not from live CLI session)
- If setting not in diff → at BF default (debug_mode=NONE → warning, blackbox_sample_rate=1 → 4kHz OK)
- Logging rate: `8000 / pid_process_denom / 2^blackbox_sample_rate`
- **Fix Settings button**: When warnings present, shows "Fix Settings" → `FixSettingsConfirmModal` → `FC_FIX_BLACKBOX_SETTINGS` IPC (CLI commands + save & reboot)
- **TuningStatusBanner pre-flight check**: During `*_flight_pending` phases, shows amber warning if `bbSettingsOk === false` with "Fix Settings" button
- Shared logic in `src/renderer/utils/bbSettingsUtils.ts` (`computeBBSettingsStatus`)

### Smart Reconnect Detection
- On reconnect with existing profile, checks if tuning session is in `*_flight_pending` phase (including `quick_flight_pending`)
- If flash has data (`bbInfo.hasLogs && bbInfo.usedSize > 0`), auto-transitions to `*_log_ready`
- Implemented in `src/main/index.ts` after `createBaselineIfMissing()`

### Dashboard Layout
- ConnectionPanel and ProfileSelector are side by side in `.top-row` flex container when connected
- When disconnected, ConnectionPanel takes full width (ProfileSelector not rendered)
- Post-erase UX: `erasedForPhase` (React state) tracks erase per-phase, banner shows flight guide after erase
- SD card erase: `eraseCompleted` (persisted in TuningSession) survives MSC disconnect/reconnect. `showErasedState` in banner checks both `flashUsedSize === 0` (flash) and `eraseCompleted` (SD card)
- SD card labels: `TuningStatusBanner` uses `storageType` prop — "Erase Logs" / "Erase Logs & Verify" instead of "Erase Flash"

### Event-Driven UI Updates
Renderer components subscribe to events:
- `onConnectionChanged` → reload snapshots after connect, clear on disconnect
- `onProfileChanged` → reload snapshots for new profile, clear if null
- `onNewFCDetected` → show ProfileWizard modal

## Configuration & Constants

### Important Files
- `src/shared/constants.ts` - MSP codes, Betaflight vendor IDs, preset profiles, size defaults
- `src/shared/types/*.types.ts` - Shared type definitions (common, profile, pid, blackbox, analysis)
- `src/shared/constants/flightGuide.ts` - Flight guide phases, tips, and tuning workflow steps
- `src/main/analysis/constants.ts` - FFT thresholds, peak detection, safety bounds, propwash floor, damping ratio, I-term bounds, adaptive window (tunable)
- `vitest.config.ts` - Test configuration with jsdom environment

### Size Defaults
When user selects drone size, defaults auto-populate:
- 1" → 25g, 19000KV, 1S
- 5" → 650g, 2400KV, 4S
- etc. (see `SIZE_DEFAULTS` in constants)

### Preset Profiles
10 presets available: tiny-whoop, micro-whoop, 4inch-toothpick, 5inch-freestyle, 5inch-race, 5inch-cinematic, 6inch-longrange, 7inch-longrange, 3inch-cinewhoop, 10inch-ultra-longrange

## Common Issues

### "FC not responding to MSP commands"
- Caused by immediate reconnect before port fully released
- Fixed with 3s cooldown + 1s backend delay
- User sees countdown timer in UI

### Board name showing as target
- BoardName field may be empty/corrupted from FC
- MSPClient filters null bytes and falls back to target
- UI shows Board only if different from Target

### Snapshots from wrong profile visible
- Caused by client-side filtering (old bug)
- Fixed: server-side filtering in `SNAPSHOT_LIST` IPC handler
- Uses `currentProfile.snapshotIds` array

### Tests failing with "not wrapped in act(...)"
- React state updates in tests need `waitFor()`
- Don't check loading state immediately after action
- Use `await waitFor(() => expect(loading).toBe(true))`

## Documentation Requirements

**MANDATORY: Every PR must update documentation.** Before merging any PR, ensure all affected documentation files are up-to-date:

1. **TESTING.md** — Update test inventory (counts, new/removed test files) whenever tests are added or removed
2. **ARCHITECTURE.md** — Update when architecture, handler counts, line counts, component structure, or test summary changes
3. **README.md** — Update test count, feature list, or usage instructions if affected
4. **SPEC.md** — Update progress summary (test count, PR range) and phase tracking
5. **CLAUDE.md** — Update architecture sections, IPC handler table, or gotchas when relevant code changes
6. **docs/README.md** — Update when design docs are added, completed, or status changes
7. **docs/*.md** — Update status headers when all tasks in a design doc are merged
8. **QUICK_START.md** — Update if development workflow or prerequisites change

**Key numbers to keep in sync across files:**
- Total test count and test file count (ARCHITECTURE.md, README.md, SPEC.md, TESTING.md, docs/README.md)
- Analysis module count (README.md project structure, feature bullet)
- IPC handler counts per module (ARCHITECTURE.md, CLAUDE.md)
- Hook count (ARCHITECTURE.md)
- PR merge range (SPEC.md)

**MANDATORY: Documentation subagent before merge.** After completing implementation and before merging the final PR, launch a background Agent (subagent_type=general-purpose) to review all changes in the PR branch (`git diff main...HEAD`) and update every affected MD file. The agent must:
1. Run `npm run test:run` to get exact test counts
2. Check `git log --oneline main..HEAD` for PR numbers
3. Read and update: README.md (features, known limitations, project structure, test counts), TESTING.md (test inventory), ARCHITECTURE.md (test summary, module counts), SPEC.md (PR range, test counts), CLAUDE.md (architecture sections), docs/README.md (design doc index)
4. Specifically audit README.md Known Limitations — remove items that are now implemented, add new ones
5. Verify feature descriptions match current implementation (no stale "planned" or "pending" language for completed work)

## Code Style

### File Organization
- Place test files next to components: `Component.tsx` + `Component.test.tsx`
- Separate CSS files: `Component.css`
- Hooks in `src/renderer/hooks/`
- Shared types in `src/shared/types/`

### Design Documents (`docs/`)

Design docs follow a lifecycle: **Proposed → Complete**. See `docs/README.md` for the full index.

**Workflow:**
1. Before implementing a non-trivial feature, create a design doc in `docs/` with `> **Status**: Proposed` header
2. The doc describes the problem, analysis, implementation plan with numbered tasks, and risk assessment
3. During implementation, reference the doc's task numbers in PR descriptions
4. After all tasks are merged, update the status header to `> **Status**: Complete (PRs #XX–#YY)` and update `docs/README.md` index

**Conventions:**
- Language: English only
- Status header format: `> **Status**: Complete/Proposed/Active` on line 3 of every doc
- Each doc is self-contained — problem statement, analysis, implementation plan, file list
- Completed docs are kept as historical records (don't delete — they explain *why* decisions were made)
- `docs/README.md` is the central index — update it whenever adding or completing a doc

### React Patterns
- Functional components with hooks
- Custom hooks for business logic (useConnection, useProfiles, useSnapshots)
- No prop drilling - use event subscriptions for cross-component communication
- Loading/error states in all async operations
- `ErrorBoundary` wraps `App` — class component crash recovery with "Try Again" button

### Error Handling
- Main process: throw descriptive errors with context
- IPC handlers: catch errors, return `IPCResponse` with error message
- Renderer: display errors in UI, log to console, ErrorBoundary for uncaught render errors
- MSP operations: retry logic with recovery attempts

### Code Quality
- **ESLint**: Flat config (`eslint.config.mjs`), `typescript-eslint` recommended, `react-hooks` rules
- **Prettier**: 100 char width, single quotes, trailing comma es5 (`.prettierrc.json`)
- **lint-staged**: Pre-commit runs `eslint --fix` + `prettier --write` + `vitest related` on changed files
- **TypeScript**: `tsc --noEmit` enforced in CI (zero errors)

## Claude Code Configuration

### Autonomous Repo Operations
Claude has **full autonomous access** exclusively to `eddycek/pidlab` repo:
- **NEVER push directly to main** — always create a feature branch, open a PR, then merge with `gh pr merge --admin`
- PR create, merge (with `--admin` flag to bypass branch protection), close
- All gh CLI operations allowed

**CRITICAL**: NEVER push, merge, or interact with any repository other than `eddycek/pidlab`. All git push/pull operations MUST target only `origin` remote (which points to `github.com/eddycek/pidlab`). Never add, modify, or push to other remotes. For `gh` commands, never specify `--repo` pointing to a different repository.

### Permissions Strategy
- **Allow**: git workflow, gh CLI, npm dev/build/test commands, filesystem ops, curated WebFetch domains
- **Deny**: Credentials, secrets, SSH keys, certificates, `node -e`/`python3` (arbitrary code exec)
- **Ask**: Destructive ops (`rm`, `git reset --hard`, `git clean`), package installations (`npm install`), lock files
- **Location**: `.claude/settings.json` (project-specific)

## Platform-Specific Notes

### macOS
- Serial ports: `/dev/tty.usbmodem*`
- Requires Xcode Command Line Tools for native modules
- Port permissions may need `chmod 666`

### Windows
- Serial ports: `COM*`
- Requires STM32 VCP drivers
- Visual Studio Build Tools needed for native modules

### Linux
- Serial ports: `/dev/ttyUSB*` or `/dev/ttyACM*`
- User may need to be in `dialout` group
- Requires `build-essential` package
