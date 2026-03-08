# Quick Tune: Single-Flight Tuning via Wiener Deconvolution

> **Status**: Proposed
> **Date**: 2026-03-07
> **Scope**: Analysis Engine, Tuning Session State Machine, UI Components, History, E2E Tests
> **Prerequisite**: TUNING_PRECISION_IMPROVEMENTS.md #1 (Wiener Deconvolution)

---

## 1. Problem Statement

The current tuning workflow requires **two dedicated flights** with specific maneuvers:

1. **Filter flight** — hover + throttle sweeps (30-45s)
2. **PID flight** — stick snaps on all axes (20-40s)

This is optimal for accuracy, but creates friction for experienced pilots who:
- Already have a rough tune and want quick iteration
- Fly freestyle/race and want PID analysis from their normal flights
- Don't want to perform dedicated stick-snap maneuvers
- Want faster iteration cycles (one flight instead of two)

Additionally, the **AnalysisOverview** (diagnostic read-only view) currently shows an empty PID section when no stick snaps are detected, making it useless for general flight logs.

---

## 2. Solution Overview

Add a **Quick Tune** mode that analyzes **both filters and PIDs from a single flight** using:
- **FFT noise analysis** (existing) on hover/cruise segments for filter recommendations
- **Wiener deconvolution** (new) on the entire flight for PID recommendations via transfer function estimation

The user chooses between two tuning modes when starting a session:

| Mode | Flights | Filter Data | PID Data | Target |
|------|---------|------------|----------|--------|
| **Guided** (existing) | 2 | Throttle sweep hover | Stick snaps (StepDetector) | Beginners, max accuracy |
| **Quick Tune** (new) | 1 | Hover/cruise segments from any flight | Wiener deconvolution (any flight) | Experienced pilots, fast iteration |

Both modes share the same apply flow, history system, and verification step.

---

## 3. Wiener Deconvolution Engine

### 3.1 Core Algorithm

Compute the closed-loop transfer function H(f) from setpoint → gyro:

```
H(f) = S_xy(f) / S_xx(f)
```

Where:
- `S_xy(f)` = cross-spectral density of (setpoint, gyro) — averaged over windows
- `S_xx(f)` = auto-spectral density of setpoint — averaged over windows
- Regularization: `S_xx(f) + epsilon` where epsilon is noise-floor-based

### 3.2 Pipeline

```
gyro[], setpoint[] → WindowSlicer (2s Hanning, 50% overlap)
    → per-window FFT → S_xy accumulator, S_xx accumulator
    → H(f) = S_xy / (S_xx + epsilon)
    → BodeResult { magnitude[], phase[], frequencies[] }
    → IFFT(H(f)) → syntheticStepResponse (0.5s from 1.5s region)
    → TransferFunctionMetrics { bandwidth, gainMargin, phaseMargin, overshoot, settlingTime }
```

### 3.3 Output Types

```typescript
/** Transfer function estimation result from Wiener deconvolution */
export interface TransferFunctionResult {
  /** Per-axis Bode plot data */
  roll: BodeResult;
  pitch: BodeResult;
  yaw: BodeResult;
  /** Per-axis synthetic step response (derived from IFFT of H(f)) */
  syntheticStepResponse: {
    roll: SyntheticStepResponse;
    pitch: SyntheticStepResponse;
    yaw: SyntheticStepResponse;
  };
  /** Per-axis metrics derived from transfer function */
  metrics: {
    roll: TransferFunctionMetrics;
    pitch: TransferFunctionMetrics;
    yaw: TransferFunctionMetrics;
  };
}

export interface BodeResult {
  /** Frequency bins in Hz */
  frequencies: Float64Array;
  /** Magnitude in dB */
  magnitude: Float64Array;
  /** Phase in degrees */
  phase: Float64Array;
}

export interface SyntheticStepResponse {
  /** Time in ms */
  timeMs: number[];
  /** Normalized response (0 = no response, 1 = full tracking) */
  response: number[];
}

export interface TransferFunctionMetrics {
  /** -3dB bandwidth in Hz (where magnitude drops below -3dB) */
  bandwidthHz: number;
  /** Gain margin in dB (how much gain can increase before instability) */
  gainMarginDb: number;
  /** Phase margin in degrees (how much phase lag before instability) */
  phaseMarginDeg: number;
  /** Overshoot from synthetic step response (%) */
  overshootPercent: number;
  /** Settling time from synthetic step response (ms) */
  settlingTimeMs: number;
  /** Rise time from synthetic step response (ms) */
  riseTimeMs: number;
}
```

### 3.4 New File

- `src/main/analysis/TransferFunctionEstimator.ts`
  - `estimateTransferFunction(gyro, setpoint, sampleRateHz, onProgress?)` → `TransferFunctionResult`
  - Uses existing `fft.js` dependency
  - Window: 2s Hanning (matches Plasmatree PID-Analyzer)
  - Response extraction: 0.5s from 1.5s windowed impulse response
  - Regularization: noise-floor-based Wiener parameter

### 3.5 Integration into PIDAnalyzer

`PIDAnalyzer.ts` gains a new method alongside the existing `analyze()`:

```typescript
/** Analyze using Wiener deconvolution (works with any flight data) */
async analyzeTransferFunction(
  flightData: BlackboxFlightData,
  currentPIDs: PIDConfiguration,
  options?: { flightStyle?: FlightStyle; filterSettings?: CurrentFilterSettings }
): Promise<PIDAnalysisResult>
```

This produces a `PIDAnalysisResult` with the same shape as the step-based analysis, enabling full reuse of downstream UI and history. Key differences:
- `stepsDetected` = 0 (no actual steps)
- Per-axis `responses[]` = empty (no individual step traces)
- Per-axis mean metrics derived from synthetic step response
- New optional field: `transferFunction?: TransferFunctionResult` for Bode plot visualization
- `analysisMethod: 'step_response' | 'wiener_deconvolution'` — new field on `PIDAnalysisResult`

### 3.6 PIDRecommender Changes

`PIDRecommender.ts` currently takes `AxisStepProfile` per axis. It needs to also accept `TransferFunctionMetrics`:

- If `TransferFunctionMetrics` provided: use bandwidth/margins for recommendations
  - Low bandwidth → increase P
  - Low phase margin → increase D (more damping)
  - High overshoot (from synthetic step) → same logic as current step-based
- Confidence is capped at `medium` for Wiener-derived recommendations (less precise than dedicated steps)

---

## 4. Tuning Session State Machine Changes

### 4.1 New TuningMode Value

```typescript
// Current
export type TuningMode = 'filter' | 'pid' | 'full';

// New
export type TuningMode = 'filter' | 'pid' | 'full' | 'quick';
```

### 4.2 New TuningPhase Values

```typescript
// Add to existing TuningPhase union:
| 'quick_flight_pending'   // Waiting for user to fly any flight
| 'quick_log_ready'        // FC reconnected, ready to download log
| 'quick_analysis'         // Log downloaded, analyzing (filter + Wiener in parallel)
| 'quick_applied'          // All changes applied, ready for verification
```

Full Quick Tune state machine:

```
User starts Quick Tune
        |
        v
+------------------------+
| quick_flight_pending   |  "Erase flash, disconnect, fly any flight (30-60s)."
+----------+-------------+
           |  FC reconnects (smart reconnect detects flash data)
           v
+------------------------+
| quick_log_ready        |  "Flight done! Download the Blackbox log."
+----------+-------------+
           |  Log downloaded
           v
+------------------------+
| quick_analysis         |  Wizard opens with mode='quick'.
|                        |  Runs FFT + Wiener in parallel.
|                        |  Shows combined results.
|                        |  User clicks "Apply All".
+----------+-------------+
           |  Changes applied, FC reboots
           v
+------------------------+
| quick_applied          |  "Changes applied! Fly to verify, or skip."
+----------+-------------+
           |  (same verification flow as guided)
           v
+------------------------+
| verification_pending   |  (reuses existing phase)
+----------+-------------+
           v
+------------------------+
| completed              |  (reuses existing phase)
+------------------------+
```

### 4.3 TuningSession Type Changes

```typescript
export interface TuningSession {
  // ... existing fields ...

  /** Which tuning mode was used (default: 'guided' for backward compatibility) */
  tuningType?: 'guided' | 'quick';

  /** Log ID for quick tune flight (single log for both analyses) */
  quickLogId?: string;

  /** Compact Wiener deconvolution metrics (saved for history) */
  transferFunctionMetrics?: TransferFunctionMetricsSummary;
}
```

Note: `tuningType` is optional with `undefined` treated as `'guided'` for backward compatibility with existing session files.

### 4.4 Smart Reconnect Changes

In `src/main/index.ts`, the smart reconnect logic needs to handle the new phases:

```typescript
if (
  session.phase === 'filter_flight_pending' ||
  session.phase === 'pid_flight_pending' ||
  session.phase === 'quick_flight_pending'  // NEW
) {
  // ... existing flash data detection logic ...
  const nextPhase =
    session.phase === 'filter_flight_pending' ? 'filter_log_ready' :
    session.phase === 'pid_flight_pending' ? 'pid_log_ready' :
    'quick_log_ready';  // NEW
}
```

### 4.5 Session Creation Changes

`TUNING_START_SESSION` IPC handler needs a parameter to choose mode:

```typescript
// Current
ipcMain.handle(IPCChannel.TUNING_START_SESSION, async (): Promise<...>)

// New
ipcMain.handle(IPCChannel.TUNING_START_SESSION, async (_event, tuningType?: 'guided' | 'quick'): Promise<...>)
```

When `tuningType === 'quick'`, initial phase is `quick_flight_pending` instead of `filter_flight_pending`.

---

## 5. UI Changes

### 5.1 Start Tuning Modal (New Component)

Currently, "Start Tuning Session" button directly starts. We need a mode selector:

**New component**: `StartTuningModal`

```
+------------------------------------------+
|  Start Tuning Session                     |
|                                           |
|  [Guided Tuning]        [Quick Tune]      |
|  2 dedicated flights    1 flight (any)    |
|  Max accuracy           Fast iteration    |
|  Recommended for        For experienced   |
|  first tune             pilots            |
|                                           |
|  [Cancel]                                 |
+------------------------------------------+
```

- `src/renderer/components/StartTuningModal/StartTuningModal.tsx`
- `src/renderer/components/StartTuningModal/StartTuningModal.css`
- `src/renderer/components/StartTuningModal/StartTuningModal.test.tsx`

### 5.2 TuningStatusBanner Changes

Add Quick Tune phases to `getPhaseUI()`:

```typescript
const STEP_LABELS_GUIDED = ['Prepare', 'Filter Flight', 'Filter Tune', 'PID Flight', 'PID Tune', 'Verify'];
const STEP_LABELS_QUICK = ['Prepare', 'Fly', 'Analyze & Apply', 'Verify'];
```

New phase UI entries:
```typescript
quick_flight_pending: {
  stepIndex: 0,
  text: `Erase Blackbox data from ${storageName}, then fly any flight (30-60 seconds).`,
  buttonLabel: eraseLabel,
  action: 'erase_flash',
  guideTip: 'quick',  // new FlightGuideMode
},
quick_log_ready: {
  stepIndex: 1,
  text: 'Flight done! Download the Blackbox log to start analysis.',
  buttonLabel: 'Download Log',
  action: 'download_log',
},
quick_analysis: {
  stepIndex: 2,
  text: 'Log downloaded. Open the Tuning Wizard to analyze and apply changes.',
  buttonLabel: 'Open Wizard',
  action: 'open_quick_wizard',  // new TuningAction
},
quick_applied: {
  stepIndex: 2,
  text: 'Changes applied! Fly a hover to verify, or skip.',
  buttonLabel: 'Erase & Verify',
  action: 'prepare_verification',
},
```

The banner dynamically selects step labels based on `session.tuningType`:
```typescript
const stepLabels = session.tuningType === 'quick' ? STEP_LABELS_QUICK : STEP_LABELS_GUIDED;
```

### 5.3 TuningWizard Changes (mode='quick')

When `mode='quick'`, the wizard runs both analyses in parallel and shows a combined view:

**Step routing for mode='quick'**:
```
Session Select → Quick Analysis → Summary
```

**New component**: `QuickAnalysisStep`
- Runs FFT filter analysis + Wiener deconvolution in parallel
- Shows combined results: filter section (noise spectrum, recommendations) + PID section (Bode plot, synthetic step response, recommendations)
- Single "Continue to Summary" button
- `src/renderer/components/TuningWizard/QuickAnalysisStep.tsx`
- `src/renderer/components/TuningWizard/QuickAnalysisStep.test.tsx`

**WizardProgress** update:
```typescript
// Add mode='quick' step mapping
const QUICK_STEPS: WizardStep[] = ['session', 'quick', 'summary'];
```

**TuningSummaryStep** update:
- When `mode='quick'`: button label = "Apply All Changes" (instead of "Apply Filters"/"Apply PIDs")
- Shows both filter and PID changes in summary

### 5.4 Flight Guide (mode='quick')

New flight guide constants in `src/shared/constants/flightGuide.ts`:

```typescript
export const QUICK_FLIGHT_PHASES: FlightPhase[] = [
  {
    title: 'Take off & Hover',
    duration: '10-15 sec',
    description: 'Hover steadily at mid-throttle for baseline noise data.',
  },
  {
    title: 'Throttle Sweep',
    duration: '1-2 times',
    description: 'Slowly sweep throttle from hover to full power and back.',
  },
  {
    title: 'Free Flight',
    duration: '15-30 sec',
    description: 'Fly normally — freestyle, cruising, or stick snaps. Any stick input helps PID analysis.',
  },
  {
    title: 'Land',
    duration: '',
    description: 'Done! Total flight: 30-60 seconds.',
  },
];

export const QUICK_FLIGHT_TIPS: string[] = [
  'Any flight style works — freestyle, race, cruising, or dedicated stick snaps',
  'Include at least 10 seconds of hover for noise analysis',
  'More varied stick inputs = better PID analysis',
  'Throttle sweeps help identify motor noise patterns',
  'Make sure Blackbox logging is enabled with 2 kHz rate',
  'After landing, check motor temperatures',
];
```

**FlightGuideMode** update:
```typescript
export type FlightGuideMode = TuningMode | 'verification';
// 'quick' is now a valid TuningMode, so FlightGuideMode already includes it
```

### 5.5 FlightGuideContent Changes

`FlightGuideContent.tsx` needs a `mode='quick'` case to render the quick flight guide phases and tips.

### 5.6 TuningWorkflowModal Changes

Add Quick Tune tab/section explaining the single-flight workflow. Show both workflows side-by-side or as tabs.

### 5.7 Bode Plot Chart (New Component)

New visualization for Wiener deconvolution results:

- `src/renderer/components/TuningWizard/charts/BodePlot.tsx`
- `src/renderer/components/TuningWizard/charts/BodePlot.test.tsx`

Dual Y-axis chart (Recharts):
- Top: Magnitude (dB) vs Frequency (Hz) — shows bandwidth, gain margin
- Bottom: Phase (degrees) vs Frequency (Hz) — shows phase margin
- Per-axis color coding (reuses existing axis colors)
- Vertical markers for bandwidth frequency and gain/phase crossover points

### 5.8 AnalysisOverview Enhancement

`AnalysisOverview` currently runs step-based PID analysis which often finds 0 steps for general flights. With Wiener deconvolution:

- Always run Wiener deconvolution alongside step detection
- If steps found → show both (step-based primary, Wiener secondary)
- If no steps found → show Wiener results (Bode plot + synthetic step response)
- New section: "Transfer Function" with BodePlot chart
- Label: "Frequency Response Analysis" (beginner-friendly)

---

## 6. Tuning History Changes

### 6.1 CompletedTuningRecord Changes

```typescript
export interface CompletedTuningRecord {
  // ... existing fields ...

  /** Which tuning mode was used */
  tuningType: 'guided' | 'quick';

  /** Log ID for quick tune (null for guided) */
  quickLogId: string | null;

  /** Transfer function metrics from Wiener deconvolution (quick tune only) */
  transferFunctionMetrics: TransferFunctionMetricsSummary | null;
}
```

### 6.2 TransferFunctionMetricsSummary (New Type)

Compact version for history storage:

```typescript
export interface TransferFunctionMetricsSummary {
  roll: { bandwidthHz: number; phaseMarginDeg: number; overshootPercent: number };
  pitch: { bandwidthHz: number; phaseMarginDeg: number; overshootPercent: number };
  yaw: { bandwidthHz: number; phaseMarginDeg: number; overshootPercent: number };
}
```

### 6.3 TuningHistoryPanel Changes

- Show tuning type badge: "Guided" or "Quick" next to date
- `recordSummary()` adapts: quick tune shows "X filter + Y PID changes (Quick Tune)"
- `TuningSessionDetail` shows Bode plot if `transferFunctionMetrics` available

### 6.4 TuningCompletionSummary Changes

- Show "Quick Tune Complete" vs "Tuning Complete" based on `session.tuningType`
- `flightCount()` adapts: quick tune has 1 main flight + optional verification
- Show bandwidth/margin metrics instead of step count for quick tune

### 6.5 Quality Score Compatibility

`computeTuneQualityScore()` already handles missing `pidMetrics` gracefully (redistributes points). For quick tune with Wiener-derived synthetic step metrics, the existing PID metric fields (overshoot, settling time) are populated from the synthetic response, so the score computation works unchanged.

### 6.6 TuningHistoryManager.archiveSession Changes

Add new fields to archive mapping:

```typescript
const record: CompletedTuningRecord = {
  // ... existing mappings ...
  tuningType: session.tuningType ?? 'guided',
  quickLogId: session.quickLogId ?? null,
  transferFunctionMetrics: session.transferFunctionMetrics ?? null,
};
```

---

## 7. Demo Mode Changes

### 7.1 MockMSPClient Flight Type Cycling

Current cycle: `filter_hover → pid_snaps → verification_hover → filter_hover → ...`

New `_nextFlightType` value: `'quick'` — added to the existing union type.

**Guided cycle** (unchanged): `filter → pid → verification → filter → ...`
**Quick cycle** (new): `quick → verification → quick → ...`

The flight type is determined by checking the active tuning session's `tuningType`:
- On `eraseBlackboxFlash()`, read the active session from `TuningSessionManager`
- If `session.tuningType === 'quick'`: use quick cycle
- If `session.tuningType === 'guided'` (or undefined): use guided cycle

`advancePastVerification()` update:
```typescript
// Current: always resets to 'filter'
// New: resets based on last session type
advancePastVerification() {
  if (this._nextFlightType === 'verification') {
    this._tuningCycle++;
    this._nextFlightType = this._lastSessionType === 'quick' ? 'quick' : 'filter';
  }
}
```

### 7.2 Demo BBL Data for Quick Tune

`MockBBLGenerator` (or equivalent) needs a `quick` flight type that generates:
- Hover segment (10-15s) — for FFT
- Mixed stick inputs with varying intensity — for Wiener deconvolution
- Throttle variation — for throttle coverage

---

## 8. IPC Changes

### 8.1 Modified Channels

| Channel | Change |
|---------|--------|
| `TUNING_START_SESSION` | Add `tuningType?: 'guided' \| 'quick'` parameter |
| `ANALYSIS_RUN_PID` | Add `method?: 'step' \| 'wiener'` parameter |

### 8.2 New Channel

| Channel | Purpose |
|---------|---------|
| `ANALYSIS_RUN_QUICK` | Runs both filter + Wiener analysis in parallel, returns combined result |

### 8.3 New TuningAction

```typescript
export type TuningAction =
  | ... // existing
  | 'open_quick_wizard';  // Opens wizard with mode='quick'
```

### 8.4 window.betaflight API Additions

```typescript
// Preload bridge additions
startTuningSession(tuningType?: 'guided' | 'quick'): Promise<TuningSession>;
runQuickAnalysis(logId: string, sessionIndex: number): Promise<QuickAnalysisResult>;
```

---

## 9. Snapshot Strategy for Quick Tune

Quick Tune uses **2 auto-snapshots** per cycle (vs 3 for guided):

| Snapshot | When | Purpose |
|----------|------|---------|
| Pre-tuning (auto) | Start Quick Tune | Rollback safety net |
| Post-tuning (auto) | Reconnect after apply | Final tuned state |

No "Post-filter" snapshot because filter + PID changes are applied together.

---

## 10. App.tsx Integration

### 10.1 handleApplyComplete Changes

`App.tsx` currently routes apply completion based on `session.phase`:

```typescript
// Current
if (phase === 'filter_analysis') → updatePhase('filter_applied', { appliedFilterChanges, filterMetrics })
if (phase === 'pid_analysis') → updatePhase('pid_applied', { appliedPIDChanges, pidMetrics })

// New — add quick_analysis branch
if (phase === 'quick_analysis') → updatePhase('quick_applied', {
  appliedFilterChanges, appliedPIDChanges, appliedFeedforwardChanges,
  filterMetrics, pidMetrics, transferFunctionMetrics
})
```

### 10.2 handleAnalyze Changes

Currently opens wizard in `mode='filter'` or `mode='pid'` based on session phase. Add:

```typescript
if (phase === 'quick_analysis') {
  setWizardMode('quick');
}
```

### 10.3 Post-Apply Snapshot in index.ts

Smart reconnect after `quick_applied` creates a single "Post-tuning (auto)" snapshot (same as `pid_applied`):

```typescript
if (session.phase === 'filter_applied' || session.phase === 'pid_applied' || session.phase === 'quick_applied') {
  const snapshotLabel = session.phase === 'filter_applied'
    ? 'Post-filter (auto)'
    : 'Post-tuning (auto)';  // covers both pid_applied and quick_applied
  const snapshotField = session.phase === 'filter_applied'
    ? 'postFilterSnapshotId'
    : 'postTuningSnapshotId';  // covers both pid_applied and quick_applied
  // ... existing snapshot creation logic
}
```

After snapshot, transition `quick_applied → verification_pending` (reuses existing verification flow).

---

## 11. Backward Compatibility

### 10.1 Existing Sessions

- `TuningSession.tuningType` is optional — `undefined` maps to `'guided'`
- Existing session files (without `tuningType`) continue to work unchanged
- All `quick_*` phase checks are additive — existing phase logic untouched

### 10.2 Existing History Records

- `CompletedTuningRecord.tuningType` defaults to `'guided'` when missing
- `quickLogId` and `transferFunctionMetrics` default to `null`
- Existing records display exactly as before

### 10.3 IPC Compatibility

- `TUNING_START_SESSION` parameter is optional — omitting it starts guided mode
- `ANALYSIS_RUN_PID` continues to work unchanged (step-based default)

---

## 12. Implementation Plan

### Phase A: Core Engine (no UI changes)

| # | Task | Files | Tests |
|---|------|-------|-------|
| A1 | ✅ TransferFunctionEstimator core | `src/main/analysis/TransferFunctionEstimator.ts` | Unit tests: window slicing, FFT, H(f) computation, synthetic step extraction, edge cases (silent input, single window) |
| A2 | ✅ New analysis types | `src/shared/types/analysis.types.ts` | Type-only, no runtime tests |
| A3 | ✅ PIDAnalyzer.analyzeTransferFunction | `src/main/analysis/PIDAnalyzer.ts` | Unit tests: orchestration, progress reporting, result shape |
| A4 | ✅ PIDRecommender frequency-domain input | `src/main/analysis/PIDRecommender.ts` | Unit tests: bandwidth-based P recommendation, margin-based D recommendation, confidence capping |
| A5 | ✅ DataQualityScorer for Wiener | `src/main/analysis/DataQualityScorer.ts` | Unit tests: quality scoring for mixed-flight data |

### Phase B: AnalysisOverview Enhancement (quick win, no session changes)

| # | Task | Files | Tests |
|---|------|-------|-------|
| B1 | ✅ BodePlot chart component | `src/renderer/components/TuningWizard/charts/BodePlot.tsx` | Component test: renders axes, handles empty data |
| B2 | ✅ AnalysisOverview Wiener integration | `src/renderer/components/AnalysisOverview/AnalysisOverview.tsx`, `useAnalysisOverview.ts` | Component test: shows Bode plot when no steps, shows both when steps found |
| B3 | ✅ ANALYSIS_RUN_TRANSFER_FUNCTION handler | `src/main/ipc/handlers/analysisHandlers.ts` | Integration test: method parameter routing |

### Phase C: Session & State Machine

| # | Task | Files | Tests |
|---|------|-------|-------|
| C1 | ✅ TuningPhase + TuningSession type updates | `src/shared/types/tuning.types.ts`, `src/shared/types/tuning-history.types.ts` | Type-only |
| C2 | ✅ TuningSessionManager quick support | `src/main/storage/TuningSessionManager.ts` | Unit test: createSession with quick type, phase transitions |
| C3 | ✅ TuningHistoryManager quick archive | `src/main/storage/TuningHistoryManager.ts` | Unit test: archive with tuningType + transferFunctionMetrics |
| C4 | ✅ TUNING_START_SESSION tuningType param | `src/main/ipc/handlers/tuningHandlers.ts` | Unit test: guided vs quick session creation |
| C5 | ✅ Smart reconnect quick_flight_pending | `src/main/index.ts` | Covered by smart reconnect logic |
| C6 | ANALYSIS_RUN_QUICK handler | `src/main/ipc/handlers/analysisHandlers.ts` | Unit test: parallel filter + Wiener execution |
| C7 | ✅ metricsExtract for TransferFunction | `src/shared/utils/metricsExtract.ts` | Unit test: extractTransferFunctionMetrics |

### Phase D: UI — Start Flow

| # | Task | Files | Tests |
|---|------|-------|-------|
| D1 | ✅ StartTuningModal component | `src/renderer/components/StartTuningModal/StartTuningModal.tsx`, `.css`, `.test.tsx` | Component test: mode selection, cancel, triggers correct start |
| D2 | ✅ Dashboard integration | `src/renderer/components/Dashboard/Dashboard.tsx` (or equivalent) | Component test: modal opens on "Start Tuning", passes tuningType |
| D3 | ✅ useTuningSession.startSession update | `src/renderer/hooks/useTuningSession.ts` | Hook test: passes tuningType parameter |

### Phase E: UI — Banner & Wizard

| # | Task | Files | Tests |
|---|------|-------|-------|
| E1 | ✅ TuningStatusBanner quick phases | `src/renderer/components/TuningStatusBanner/TuningStatusBanner.tsx`, `.test.tsx` | Component test: correct step labels, text, buttons for all quick_* phases |
| E2 | ✅ Quick flight guide constants | `src/shared/constants/flightGuide.ts` | No runtime tests (constants) |
| E3 | ✅ FlightGuideContent quick mode | `src/renderer/components/TuningWizard/FlightGuideContent.tsx`, `.test.tsx` | Component test: renders quick flight phases |
| E4 | ✅ QuickAnalysisStep component | `src/renderer/components/TuningWizard/QuickAnalysisStep.tsx`, `.test.tsx` | Component test: parallel analysis, combined results display |
| E5 | ✅ WizardProgress quick steps | `src/renderer/components/TuningWizard/WizardProgress.tsx`, `.test.tsx` | Component test: 3-step progress for quick mode |
| E6 | ✅ TuningSummaryStep quick mode | `src/renderer/components/TuningWizard/TuningSummaryStep.tsx`, `.test.tsx` | Component test: "Apply All Changes" label, combined changes |
| E7 | ✅ TuningWizard mode='quick' routing | `src/renderer/components/TuningWizard/TuningWizard.tsx`, `.test.tsx` | Component test: step routing for quick mode |
| E8 | ✅ TuningWorkflowModal dual mode | `src/renderer/components/TuningWorkflowModal/TuningWorkflowModal.tsx`, `.test.tsx` | Component test: shows both workflows |

### Phase F: UI — History & Completion

| # | Task | Files | Tests |
|---|------|-------|-------|
| F1 | ✅ TuningCompletionSummary quick mode | `src/renderer/components/TuningHistory/TuningCompletionSummary.tsx`, `.test.tsx` | Component test: "Quick Tune Complete", 1 flight count |
| F2 | ✅ TuningHistoryPanel tuning type badge | `src/renderer/components/TuningHistory/TuningHistoryPanel.tsx`, `.test.tsx` | Component test: "(Quick Tune)" summary suffix |
| F3 | ✅ TuningSessionDetail quick flight count | `src/renderer/components/TuningHistory/TuningSessionDetail.tsx` | quickLogId counted in flight total |
| F4 | ✅ Quality score with TF metrics | `src/shared/utils/tuneQualityScore.ts` | Existing dynamic redistribution already handles missing PID metrics — no changes needed |

### Phase G: Demo Mode & E2E

| # | Task | Files | Tests |
|---|------|-------|-------|
| G1 | MockMSPClient quick tune support | `src/main/demo/MockMSPClient.ts` | Unit test: flight type cycling for quick mode |
| G2 | Mock BBL data for quick flights | `src/main/demo/MockBBLGenerator.ts` (or equivalent) | Unit test: generates mixed hover + freestyle data |
| G3 | E2E: Quick Tune full cycle | `e2e/demo-quick-tune-cycle.spec.ts` | E2E test: Start Quick → Erase → Download → Wizard → Apply → Skip → Complete → History |
| G4 | E2E: Guided still works | Existing `e2e/demo-tuning-cycle.spec.ts` | Verify no regressions (may need small updates for StartTuningModal) |
| G5 | E2E: History shows both types | `e2e/demo-generate-history.spec.ts` | Update to generate mix of guided + quick sessions |

### Phase H: Documentation

| # | Task | Files |
|---|------|-------|
| H1 | Update CLAUDE.md | Architecture sections, TuningMode, TuningPhase, IPC handlers |
| H2 | Update ARCHITECTURE.md | Handler counts, component list, test summary |
| H3 | Update TESTING.md | New test files, updated counts |
| H4 | Update README.md | Feature list, test count |
| H5 | Update SPEC.md | Progress, PR range |
| H6 | Update docs/README.md | This doc status |
| H7 | Update TUNING_PRECISION_IMPROVEMENTS.md | Mark Wiener (#1) as implemented |

---

## 13. Risk Assessment

### 12.1 Wiener Deconvolution Accuracy

**Risk**: Wiener-derived recommendations may be less accurate than step-based for some flight styles.

**Mitigation**:
- Confidence capped at `medium` for Wiener results
- Clear UI labeling: "Estimated from flight data" vs "Measured from stick snaps"
- Guided mode remains the recommended default for first-time tuning
- Data quality scorer adapted for Wiener (penalizes low stick activity, short flights)

### 12.2 Regularization Tuning

**Risk**: Noise-floor-based regularization may not generalize across all FC/frame combinations.

**Mitigation**:
- Start with Plasmatree PID-Analyzer's proven parameters
- Data quality score warns if input signal is too weak (low setpoint energy)
- Configurable epsilon in analysis constants

### 12.3 State Machine Complexity

**Risk**: Adding 4 new phases increases state machine complexity and test surface.

**Mitigation**:
- Quick phases are fully parallel to guided phases (no cross-paths)
- Verification and completion phases are shared (no duplication)
- `tuningType` field explicitly gates phase interpretation
- Each phase has dedicated unit tests

### 12.4 UI Complexity

**Risk**: Users might be confused by two tuning modes.

**Mitigation**:
- Clear mode selector with descriptions at start
- Guided is the default/recommended option
- Quick Tune clearly labeled as "for experienced pilots"
- Both modes show tuning type throughout (banner, completion, history)

---

## 14. File Change Summary

### New Files (~16)

| File | Purpose |
|------|---------|
| `src/main/analysis/TransferFunctionEstimator.ts` | Wiener deconvolution engine |
| `src/main/analysis/TransferFunctionEstimator.test.ts` | Unit tests |
| `src/renderer/components/TuningWizard/charts/BodePlot.tsx` | Bode plot chart |
| `src/renderer/components/TuningWizard/charts/BodePlot.test.tsx` | Chart tests |
| `src/renderer/components/TuningWizard/QuickAnalysisStep.tsx` | Combined analysis step |
| `src/renderer/components/TuningWizard/QuickAnalysisStep.test.tsx` | Step tests |
| `src/renderer/components/StartTuningModal/StartTuningModal.tsx` | Mode selector modal |
| `src/renderer/components/StartTuningModal/StartTuningModal.css` | Modal styles |
| `src/renderer/components/StartTuningModal/StartTuningModal.test.tsx` | Modal tests |
| `e2e/demo-quick-tune-cycle.spec.ts` | E2E: full quick tune cycle |

### Modified Files (~25)

| File | Change |
|------|--------|
| `src/shared/types/tuning.types.ts` | Add `'quick'` to TuningMode, new phases, `tuningType` field |
| `src/shared/types/tuning-history.types.ts` | Add `tuningType`, `quickLogId`, `transferFunctionMetrics` fields |
| `src/shared/types/analysis.types.ts` | Add `TransferFunctionResult`, `BodeResult`, `TransferFunctionMetrics`, `analysisMethod` |
| `src/shared/types/ipc.types.ts` | Add `ANALYSIS_RUN_QUICK` channel, update `startTuningSession` signature |
| `src/shared/constants/flightGuide.ts` | Add `QUICK_FLIGHT_PHASES`, `QUICK_FLIGHT_TIPS` |
| `src/shared/utils/tuneQualityScore.ts` | Handle synthetic step metrics (likely no changes needed) |
| `src/shared/utils/metricsExtract.ts` | Add `extractTransferFunctionMetrics()` |
| `src/main/analysis/PIDAnalyzer.ts` | Add `analyzeTransferFunction()` method |
| `src/main/analysis/PIDRecommender.ts` | Accept frequency-domain inputs |
| `src/main/analysis/DataQualityScorer.ts` | Add `scoreQuickDataQuality()` |
| `src/main/ipc/handlers/tuningHandlers.ts` | `TUNING_START_SESSION` param, `ANALYSIS_RUN_QUICK` handler |
| `src/main/ipc/handlers/analysisHandlers.ts` | `ANALYSIS_RUN_PID` method option |
| `src/main/storage/TuningSessionManager.ts` | Handle quick session creation |
| `src/main/storage/TuningHistoryManager.ts` | Archive quick sessions with new fields |
| `src/main/index.ts` | Smart reconnect for `quick_flight_pending` |
| `src/main/demo/MockMSPClient.ts` | Quick tune flight type cycling |
| `src/preload/index.ts` | Expose new API methods |
| `src/renderer/hooks/useTuningSession.ts` | `startSession(tuningType?)` |
| `src/renderer/hooks/useTuningWizard.ts` | mode='quick' logic |
| `src/renderer/hooks/useAnalysisOverview.ts` | Run Wiener alongside step analysis |
| `src/renderer/components/TuningStatusBanner/TuningStatusBanner.tsx` | Quick phase UI, dynamic step labels |
| `src/renderer/components/TuningWizard/TuningWizard.tsx` | mode='quick' step routing |
| `src/renderer/components/TuningWizard/WizardProgress.tsx` | Quick step labels |
| `src/renderer/components/TuningWizard/TuningSummaryStep.tsx` | "Apply All" for quick mode |
| `src/renderer/components/TuningWizard/FlightGuideContent.tsx` | Quick flight guide |
| `src/renderer/components/TuningWizard/TuningWorkflowModal.tsx` | Dual mode display |
| `src/renderer/components/TuningHistory/TuningCompletionSummary.tsx` | Quick mode display |
| `src/renderer/components/TuningHistory/TuningHistoryPanel.tsx` | Tuning type badge |
| `src/renderer/components/TuningHistory/TuningSessionDetail.tsx` | Bode plot display |
| `src/renderer/components/AnalysisOverview/AnalysisOverview.tsx` | Wiener fallback |
| `e2e/demo-tuning-cycle.spec.ts` | Update for StartTuningModal (select Guided) |
| `e2e/demo-generate-history.spec.ts` | Mix guided + quick sessions |

### Estimated Test Count

- New unit tests: ~40-50 (TransferFunctionEstimator, PIDRecommender freq-domain, DataQualityScorer, metricsExtract)
- New component tests: ~25-30 (BodePlot, QuickAnalysisStep, StartTuningModal, updated existing components)
- New E2E tests: ~8-10 (quick tune cycle, history with both types)
- Updated existing tests: ~15-20 (TuningStatusBanner, TuningWizard, TuningCompletionSummary, etc.)
- **Total new/modified tests: ~90-110**
