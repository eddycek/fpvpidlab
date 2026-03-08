# Tuning Session History & Before/After Comparison

> **Status**: Complete (PRs #96–#99)
> **Date**: 2026-02-11
> **Scope**: Storage, IPC, Renderer, Types
> **Related**: UX Ideas #3 (Before/After Comparison), #5 (Verification Flight Guidance), #6 (Tuning Session History)

---

## 1. Problem Statement

### 1.1 Session Data Is Lost on Completion

When a tuning session reaches `completed`, the user clicks "Dismiss" which calls `resetSession()` — deleting `{userData}/data/tuning/{profileId}.json`. All session metadata is permanently lost:
- When the tuning was performed
- Which logs were used for analysis
- What settings were changed (the `AppliedChange[]` arrays)
- What the analysis found (noise levels, PID metrics)

The auto-snapshots (Pre-tuning, Post-filter, Post-tuning) survive because they're separate files, but the connection between them and the tuning context is severed.

### 1.2 No Completion Summary

The `completed` phase shows a generic banner ("Tuning complete! Your drone is dialed in.") with no details about what actually changed. The user gets no closure — no summary of the tuning outcome, no before/after comparison.

### 1.3 No Tuning Evolution Tracking

Users who tune iteratively (re-tune after changing props, after crashes, after firmware updates) have no way to see their tuning history. Questions like "when did I last tune?", "what did I change last time?", "is my noise getting better or worse?" are unanswerable.

### 1.4 Post-Apply Snapshot IDs Not Tracked

The current reconnect handler in `main/index.ts` creates Post-filter and Post-tuning auto-snapshots, but their IDs are **not saved** to the `TuningSession`. This means:
- The session doesn't know which snapshots correspond to which tuning cycle
- Comparison between pre-tuning and post-tuning snapshots requires manual detective work

---

## 2. Design

### 2.1 Overview

```
Current flow:                          New flow:

Start Tuning                           Start Tuning
  ↓                                      ↓
filter flight → analyze → apply        filter flight → analyze → apply
  ↓                                      ↓  (save FilterMetricsSummary = "before")
PID flight → analyze → apply           PID flight → analyze → apply
  ↓                                      ↓  (save PIDMetricsSummary)
"Complete Tuning"                      verification flight (optional hover)
  ↓                                      ↓  (save FilterMetricsSummary = "after")
"Tuning complete!"                     "Complete Tuning"
"Dismiss" → data DELETED                 ↓
                                       Archive session → TuningHistory
                                         ↓
                                       Show TuningCompletionSummary
                                         - Noise overlay chart (before/after)
                                         - Applied changes grouped
                                         - PID metrics
                                         ↓
                                       "Dismiss" → active session deleted
                                                   (history preserved)
```

Four key changes:
1. **Capture analysis metrics** at apply time (compact summaries, not full results)
2. **Track post-apply snapshot IDs** on reconnect
3. **Verification flight** — run filter analysis on an optional hover flight to get "after" noise spectrum
4. **Archive completed sessions** to a persistent history before clearing the active session

### 2.2 Before/After Noise Spectrum — Where Does "After" Data Come From?

The tuning cycle produces two mandatory logs plus one optional:
1. **Filter flight** (hover + throttle sweeps) → filter analysis → **BEFORE** spectrum (old filters)
2. **PID flight** (stick snaps) → PID analysis → step response metrics
3. **Verification flight** (hover, optional) → filter analysis → **AFTER** spectrum (new filters + new PIDs)

Why not compare filter flight vs PID flight? Because they use **different flight styles** — hover vs stick snaps produce fundamentally different noise profiles (throttle levels, motor loading, vibration patterns). Comparing them would be apples vs oranges.

The verification flight is the same type as the filter flight (hover), so the noise spectra are **directly comparable**. The `verification_pending` phase already exists in the tuning state machine but currently does nothing — this gives it real purpose.

**Data flow**:

```
Flight 1: Filter flight (hover)        → Filter analysis → "Before" spectrum
Flight 2: PID flight (stick snaps)     → PID analysis    → step response metrics
Flight 3: Verification flight (hover)  → Filter analysis → "After" spectrum
                                                             ↓
                                                  Overlay on one chart:
                                                  user sees noise change at a glance
```

**When to run the verification analysis**: When the user downloads the verification log and clicks "Analyze" in the `verification_pending` phase. The TuningWizard (or a dedicated verification flow) parses the log and runs `analyzeFilters()`. This reuses the existing filter analysis pipeline — no new analysis code needed.

**Verification flight is optional**: The user can skip it (dismiss/complete without verification). In that case, the completion summary shows applied changes and PID metrics but **no noise overlay chart**. The chart is the reward for flying the extra hover.

### 2.3 Compact Metrics Summaries

Full `FilterAnalysisResult` and `PIDAnalysisResult` contain `Float64Array` spectra (thousands of points) and step traces — unsuitable for JSON persistence. We store:
- **Numeric metrics** for text display (noise floor dB, overshoot %, etc.)
- **Downsampled spectra** (~128 bins) for comparison charts (~3 KB total)

```typescript
/** Downsampled spectrum for comparison charts (JSON-safe, ~1 KB per axis) */
export interface CompactSpectrum {
  /** Frequency bins in Hz (regularly spaced, typically 128 points from 0-4000 Hz) */
  frequencies: number[];
  /** Roll axis magnitude in dB */
  roll: number[];
  /** Pitch axis magnitude in dB */
  pitch: number[];
  /** Yaw axis magnitude in dB */
  yaw: number[];
}

/** Compact filter analysis metrics for history storage */
export interface FilterMetricsSummary {
  overallNoiseLevel: 'low' | 'medium' | 'high';
  roll: { noiseFloorDb: number; peakCount: number };
  pitch: { noiseFloorDb: number; peakCount: number };
  yaw: { noiseFloorDb: number; peakCount: number };
  segmentsUsed: number;
  rpmFilterActive?: boolean;
  summary: string;
  /** Downsampled FFT spectrum for overlay charts */
  spectrum?: CompactSpectrum;
}

/** Compact PID analysis metrics for history storage */
export interface PIDMetricsSummary {
  roll: { meanOvershoot: number; meanRiseTimeMs: number; meanSettlingTimeMs: number; meanLatencyMs: number };
  pitch: { meanOvershoot: number; meanRiseTimeMs: number; meanSettlingTimeMs: number; meanLatencyMs: number };
  yaw: { meanOvershoot: number; meanRiseTimeMs: number; meanSettlingTimeMs: number; meanLatencyMs: number };
  stepsDetected: number;
  currentPIDs: { roll: { P: number; I: number; D: number }; pitch: { P: number; I: number; D: number }; yaw: { P: number; I: number; D: number } };
  summary: string;
}
```

Spectrum downsampling uses linear interpolation from the full FFT output (typically 2048+ bins) to 128 regularly-spaced bins. This preserves the overall shape, peaks, and noise floor — enough for a meaningful comparison chart. Total storage: ~5 KB per record (numeric metrics + spectra).

### 2.4 Extended TuningSession Type

```typescript
export interface TuningSession {
  // --- existing fields (unchanged) ---
  profileId: string;
  phase: TuningPhase;
  startedAt: string;
  updatedAt: string;
  baselineSnapshotId?: string;        // "Pre-tuning (auto)" snapshot
  filterLogId?: string;
  appliedFilterChanges?: AppliedChange[];
  pidLogId?: string;
  appliedPIDChanges?: AppliedChange[];
  verificationLogId?: string;

  // --- NEW fields ---
  /** Snapshot ID of "Post-filter (auto)" — set on reconnect after filter apply */
  postFilterSnapshotId?: string;
  /** Snapshot ID of "Post-tuning (auto)" — set on reconnect after PID apply */
  postTuningSnapshotId?: string;
  /** Filter analysis from filter flight — "before" noise spectrum. Set at filter apply time. */
  filterMetrics?: FilterMetricsSummary;
  /** PID step response metrics — set at PID apply time */
  pidMetrics?: PIDMetricsSummary;
  /** Filter analysis from verification flight — "after" noise spectrum. Set during verification phase. */
  verificationMetrics?: FilterMetricsSummary;
}
```

The `filterMetrics` + `verificationMetrics` pair enables the visual before/after noise overlay chart. Both come from hover flights (same flight style), so the spectra are directly comparable. Both contain `CompactSpectrum` with ~128 frequency bins.

### 2.5 CompletedTuningRecord

When a session reaches `completed`, it gets archived as:

```typescript
export interface CompletedTuningRecord {
  /** Unique ID for this history record */
  id: string;
  /** Profile this belongs to */
  profileId: string;
  /** When tuning started */
  startedAt: string;
  /** When tuning completed */
  completedAt: string;

  // Snapshot references (may be null if snapshots were later deleted)
  preSnapshotId: string | null;
  postFilterSnapshotId: string | null;
  postTuningSnapshotId: string | null;

  // Log references
  filterLogId: string | null;
  pidLogId: string | null;
  verificationLogId: string | null;

  // What was changed (always available, self-contained)
  appliedFilterChanges: AppliedChange[];
  appliedPIDChanges: AppliedChange[];

  // Analysis metrics (always available, self-contained)
  /** "Before" noise spectrum — from filter flight (hover, old filters) */
  filterMetrics: FilterMetricsSummary | null;
  /** PID step response metrics */
  pidMetrics: PIDMetricsSummary | null;
  /** "After" noise spectrum — from verification flight (hover, new filters + PIDs). Null if user skipped verification. */
  verificationMetrics: FilterMetricsSummary | null;
}
```

Self-contained design: the `AppliedChange[]` arrays, metrics summaries, and compact spectra are stored directly in the record — no external references needed to show the core comparison, including the noise overlay chart. The `verificationMetrics` is null when the user skipped the optional verification flight.

### 2.6 Storage: TuningHistoryManager

**Location**: `{userData}/data/tuning-history/{profileId}.json`

Each file contains an array of `CompletedTuningRecord[]`, ordered by `completedAt` (newest last). Expected size: 3–10 records per profile over the drone's lifetime, each ~5–8 KB (with spectra). No pagination needed.

```typescript
export class TuningHistoryManager {
  private dataDir: string;  // {basePath}/tuning-history/

  constructor(basePath: string);
  async initialize(): Promise<void>;

  /** Archive a completed session and return the new record */
  async archiveSession(session: TuningSession): Promise<CompletedTuningRecord>;

  /** Get all history records for a profile (newest first) */
  async getHistory(profileId: string): Promise<CompletedTuningRecord[]>;

  /** Delete all history for a profile (when profile is deleted) */
  async deleteHistory(profileId: string): Promise<void>;
}
```

### 2.7 Snapshot ID Tracking Fix

Currently, `main/index.ts` creates post-apply snapshots without saving their IDs. Fix:

```typescript
// In reconnect handler, after creating post-apply snapshot:
const snapshot = await snapshotManager.createSnapshot(label, 'auto');

if (session.phase === 'filter_applied') {
  const updated = await tuningSessionManager.updatePhase(
    existingProfile.id, session.phase, { postFilterSnapshotId: snapshot.id }
  );
  sendTuningSessionChanged(updated);
} else if (session.phase === 'pid_applied') {
  const updated = await tuningSessionManager.updatePhase(
    existingProfile.id, session.phase, { postTuningSnapshotId: snapshot.id }
  );
  sendTuningSessionChanged(updated);
}
```

This doesn't change the phase — it adds data to the current phase.

### 2.8 Metrics Capture at Apply Time

The analysis results exist only in the renderer (`useTuningWizard` hook state). They need to be sent to the server at apply time.

**Flow**:
1. User clicks "Apply" in the wizard
2. `useTuningWizard` calls `TUNING_APPLY_RECOMMENDATIONS` (existing)
3. After successful apply, `handleApplyComplete` in `App.tsx` updates the phase:

```typescript
// Current:
await tuning.updatePhase('filter_applied', { appliedFilterChanges: changes.filterChanges });

// New:
await tuning.updatePhase('filter_applied', {
  appliedFilterChanges: changes.filterChanges,
  filterMetrics: changes.filterMetrics,  // NEW
});
```

4. The wizard extracts metrics from the full result before calling the callback:

```typescript
// In TuningWizard, after apply completes:
onApplyComplete({
  filterChanges: appliedFilterChanges,
  pidChanges: appliedPIDChanges,
  filterMetrics: filterResult ? extractFilterMetrics(filterResult) : undefined,
  pidMetrics: pidResult ? extractPIDMetrics(pidResult) : undefined,
});
```

**Extraction functions** (pure, shared):

```typescript
// src/shared/utils/metricsExtract.ts

/** Downsample Float64Array spectrum to ~128 regularly-spaced bins via linear interpolation */
export function downsampleSpectrum(
  frequencies: Float64Array,
  magnitudes: { roll: Float64Array; pitch: Float64Array; yaw: Float64Array },
  targetBins = 128,
  maxFreqHz = 4000
): CompactSpectrum {
  const step = maxFreqHz / targetBins;
  const freqs: number[] = [];
  const roll: number[] = [];
  const pitch: number[] = [];
  const yaw: number[] = [];

  for (let i = 0; i < targetBins; i++) {
    const targetHz = i * step;
    freqs.push(Math.round(targetHz * 10) / 10);
    roll.push(interpolateAt(frequencies, magnitudes.roll, targetHz));
    pitch.push(interpolateAt(frequencies, magnitudes.pitch, targetHz));
    yaw.push(interpolateAt(frequencies, magnitudes.yaw, targetHz));
  }
  return { frequencies: freqs, roll, pitch, yaw };
}

/** Linear interpolation lookup in sorted frequency array */
function interpolateAt(freqs: Float64Array, values: Float64Array, targetHz: number): number {
  if (targetHz <= freqs[0]) return values[0];
  if (targetHz >= freqs[freqs.length - 1]) return values[values.length - 1];
  let lo = 0, hi = freqs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (freqs[mid] <= targetHz) lo = mid; else hi = mid;
  }
  const t = (targetHz - freqs[lo]) / (freqs[hi] - freqs[lo]);
  return values[lo] + t * (values[hi] - values[lo]);
}

export function extractFilterMetrics(result: FilterAnalysisResult): FilterMetricsSummary {
  const spectrum = downsampleSpectrum(
    result.noise.frequencies,
    { roll: result.noise.roll.spectrum, pitch: result.noise.pitch.spectrum, yaw: result.noise.yaw.spectrum },
  );
  return {
    overallNoiseLevel: result.noise.overallLevel,
    roll: { noiseFloorDb: result.noise.roll.noiseFloorDb, peakCount: result.noise.roll.peaks.length },
    pitch: { noiseFloorDb: result.noise.pitch.noiseFloorDb, peakCount: result.noise.pitch.peaks.length },
    yaw: { noiseFloorDb: result.noise.yaw.noiseFloorDb, peakCount: result.noise.yaw.peaks.length },
    segmentsUsed: result.segmentsUsed,
    rpmFilterActive: result.rpmFilterActive,
    summary: result.summary,
    spectrum,
  };
}

export function extractPIDMetrics(result: PIDAnalysisResult): PIDMetricsSummary {
  return {
    roll: { meanOvershoot: result.roll.meanOvershoot, meanRiseTimeMs: result.roll.meanRiseTimeMs,
            meanSettlingTimeMs: result.roll.meanSettlingTimeMs, meanLatencyMs: result.roll.meanLatencyMs },
    pitch: { meanOvershoot: result.pitch.meanOvershoot, meanRiseTimeMs: result.pitch.meanRiseTimeMs,
             meanSettlingTimeMs: result.pitch.meanSettlingTimeMs, meanLatencyMs: result.pitch.meanLatencyMs },
    yaw: { meanOvershoot: result.yaw.meanOvershoot, meanRiseTimeMs: result.yaw.meanRiseTimeMs,
           meanSettlingTimeMs: result.yaw.meanSettlingTimeMs, meanLatencyMs: result.yaw.meanLatencyMs },
    stepsDetected: result.stepsDetected,
    currentPIDs: result.currentPIDs,
    summary: result.summary,
  };
}
```

### 2.9 Verification Flight Flow

The `verification_pending` phase currently shows a static "Tuning complete" message. With this change, it becomes an active phase:

**Phase UI (TuningStatusBanner)**:
```
✅ PID tuning applied! Fly a short hover to verify noise improvement.
[Download Log]  [Skip Verification]
```

**Flow**:
1. After PID apply, FC reboots → reconnect → phase transitions to `verification_pending`
2. Banner shows guidance: "Fly a 30-60 second hover, then download the log"
3. User flies, reconnects, downloads → banner shows [Analyze Verification]
4. On analyze: parse log, run `analyzeFilters()`, extract `FilterMetricsSummary` → save as `verificationMetrics`
5. Phase transitions to `completed` (with or without verification data)

**Skip path**: User clicks "Skip Verification" → phase goes directly to `completed` with `verificationMetrics: null`. The completion summary shows changes + PID metrics but no noise overlay chart.

**Download + analyze path**: Reuses existing `BlackboxStatus` download flow. After download, a dedicated verification analysis runs (filter analysis only, no PID analysis). The result is stored on the session and the noise overlay chart becomes available.

### 2.10 Archive on Completion

When `updateTuningPhase('completed')` is called:

1. Server loads the current session (which now has all data: changes, metrics, snapshot IDs)
2. Server calls `tuningHistoryManager.archiveSession(session)`:
   - Creates a `CompletedTuningRecord` from session fields
   - Appends to `{profileId}.json` history file
3. Phase updates to `completed` as before
4. When user clicks "Dismiss", `resetSession()` deletes the active session file — but history persists

### 2.11 Profile Deletion Cleanup

When a profile is deleted, also delete its tuning history:

```typescript
// In PROFILE_DELETE handler:
await tuningHistoryManager.deleteHistory(profileId);
```

---

## 3. UI Components

### 3.1 TuningCompletionSummary

Shown when `session.phase === 'completed'`. Replaces the current minimal banner with a detailed summary panel.

**Layout (with verification flight)**:
```
┌─────────────────────────────────────────────────────────────────┐
│ ✅ Tuning Complete                                    [Dismiss] │
│                                                                 │
│ Started: Feb 11, 2026 14:30                                     │
│ Duration: 25 min (3 flights)                                    │
│                                                                 │
│ ┌─ Noise Comparison ─────────────────────────────────────────┐ │
│ │                                                              │ │
│ │  dB                                                          │ │
│ │   0 ┬───────────────────────────────────────────────────     │ │
│ │ -10 │                                                        │ │
│ │ -20 │  ╲     ╱ Before (filter flight)                        │ │
│ │ -30 │   ╲╱╲╱                                                 │ │
│ │ -40 │       ╲                                                │ │
│ │ -50 │  ╲     ╲  After (verification flight)                  │ │
│ │ -60 │   ╲╲╱╱──────────────────                               │ │
│ │     └───────────────────────────────── Hz                    │ │
│ │      0   500  1000  1500  2000  2500  3000                   │ │
│ │                                                              │ │
│ │  [Roll] [Pitch] [Yaw]          Noise floor: -40→-52 dB      │ │
│ │                                 ↓ 12 dB improvement          │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─ Filter Changes (4) ────────────────────────────────────────┐ │
│ │ gyro_lpf1_static_hz    250 → 300   (+20%)                  │ │
│ │ gyro_lpf2_static_hz    500 → 450   (-10%)                  │ │
│ │ dterm_lpf1_static_hz   150 → 180   (+20%)                  │ │
│ │ dyn_notch_max_hz       600 → 500   (-17%)                  │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─ PID Changes (2) ──────────────────────────────────────────┐ │
│ │ pid_roll_p             45 → 50     (+11%)                   │ │
│ │ pid_roll_d             30 → 35     (+17%)                   │ │
│ │                                                              │ │
│ │ 12 steps • Overshoot: R 5% P 8% Y 3%                       │ │
│ │ Rise: R 20ms P 22ms Y 30ms                                  │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                 │
│        [Start New Tuning Cycle]              [Dismiss]          │
└─────────────────────────────────────────────────────────────────┘
```

**Layout (without verification — user skipped)**:
```
┌─────────────────────────────────────────────────────────────────┐
│ ✅ Tuning Complete                                    [Dismiss] │
│                                                                 │
│ Started: Feb 11, 2026 14:30                                     │
│ Duration: 20 min (2 flights)                                    │
│                                                                 │
│ ┌─ Filter Changes (4) ────────────────────────────────────────┐ │
│ │ gyro_lpf1_static_hz    250 → 300   (+20%)                  │ │
│ │ ...                                                          │ │
│ │ Noise: low • Roll -40 dB • Pitch -38 dB • Yaw -42 dB      │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─ PID Changes (2) ──────────────────────────────────────────┐ │
│ │ ...                                                          │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ℹ️ Fly a verification hover next time to see noise comparison  │
│                                                                 │
│        [Start New Tuning Cycle]              [Dismiss]          │
└─────────────────────────────────────────────────────────────────┘
```

The **Noise Comparison** chart is the hero element — it's what the user cares about most: "did my filters actually improve things?" One glance at the before/after overlay answers this question visually.

The chart appears **only when both `filterMetrics.spectrum` and `verificationMetrics.spectrum` are available** (user flew the verification hover). When verification was skipped, the filter section shows numeric-only metrics with a hint encouraging a verification flight next time.

**NoiseComparisonChart behavior**:
- Two overlaid line traces per axis: "Before" (semi-transparent, muted color) and "After" (solid, bright color)
- Both traces come from **hover flights** → directly comparable data
- Axis tabs (Roll / Pitch / Yaw) below the chart, defaulting to Roll
- Summary pill: shows noise floor delta (e.g., "↓ 12 dB improvement") or "↑ 3 dB regression" if worse
- Uses Recharts `<LineChart>` with `<Line>` for each trace — same rendering approach as existing `SpectrumChart`
- X axis: 0–4000 Hz, Y axis: dB scale (auto-ranged)

**Data sources**:
- Before spectrum: `session.filterMetrics.spectrum` (from filter hover flight)
- After spectrum: `session.verificationMetrics.spectrum` (from verification hover flight)
- Applied changes: `session.appliedFilterChanges` + `session.appliedPIDChanges`
- PID metrics: `session.pidMetrics`
- Timestamps: `session.startedAt` + `session.updatedAt`

This component renders from session data alone — no snapshot loading, no re-analysis.

### 3.2 TuningHistoryPanel

Dashboard section below SnapshotManager. Shows when profile is selected and history exists.

**Layout**:
```
┌─ Tuning History ──────────────────────────────────────────────┐
│                                                                │
│ ┌─ Feb 11, 2026 ──────────────────────────────────────── ▸ ─┐ │
│ │ 4 filter + 2 PID changes • Noise: low                     │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                │
│ ┌─ Jan 28, 2026 ──────────────────────────────────────── ▸ ─┐ │
│ │ 3 filter + 3 PID changes • Noise: medium                  │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

- Collapsed by default, expand for details
- Most recent first
- Each card is clickable → expands to show full `TuningSessionDetail`

### 3.3 TuningSessionDetail (Expanded View)

When a history card is expanded, shows the same layout as `TuningCompletionSummary` (reuses the same sub-components: `NoiseComparisonChart`, `AppliedChangesTable`). Optionally adds a "Compare Snapshots" button that opens `SnapshotDiffModal` with pre-tuning vs post-tuning snapshots (if both still exist).

**Layout (expanded, with verification data)**:
```
┌─ Feb 11, 2026 ──────────────────────────────────────── ▾ ───┐
│                                                               │
│  ┌─ Noise Comparison ──────────────────────────────────────┐ │
│  │  [Before/After overlay chart — same as CompletionSummary]│ │
│  │  Noise floor: -40 → -52 dB (↓ 12 dB)                    │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                               │
│  Filter Changes (4)                PID Changes (2)            │
│  gyro_lpf1_static_hz  250 → 300   pid_roll_p  45 → 50       │
│  gyro_lpf2_static_hz  500 → 450   pid_roll_d  30 → 35       │
│  dterm_lpf1_static_hz 150 → 180                              │
│  dyn_notch_max_hz     600 → 500                              │
│                                                               │
│  12 steps detected                                            │
│  Overshoot: R 5.0% P 8.0% Y 3.0%                            │
│  Rise time: R 20ms P 22ms Y 30ms                             │
│                                                               │
│  [Compare Snapshots]                                          │
└───────────────────────────────────────────────────────────────┘
```

When `verificationMetrics` is null (user skipped verification), the noise chart section is replaced with numeric-only filter metrics.

"Compare Snapshots" opens the existing `SnapshotDiffModal` comparing `preSnapshotId` vs `postTuningSnapshotId`. If either snapshot was deleted, button is disabled with tooltip.

---

## 4. IPC Changes

### 4.1 New Channels

```typescript
// IPCChannel enum additions:
TUNING_GET_HISTORY = 'tuning:get-history',

// BetaflightAPI additions:
getTuningHistory(): Promise<CompletedTuningRecord[]>;

// Preload bridge:
onTuningHistoryChanged?: (callback: (records: CompletedTuningRecord[]) => void) => () => void;
```

Only one new IPC channel. The archive happens server-side as part of `TUNING_UPDATE_PHASE` when phase is `completed`.

### 4.2 Modified Channels

**`TUNING_UPDATE_PHASE`** — when `phase === 'completed'`:
1. Archive session to history before updating phase
2. Emit `EVENT_TUNING_SESSION_CHANGED` as before

**`TUNING_APPLY_RECOMMENDATIONS`** — no changes (apply handler stays the same)

**`handleApplyComplete`** in `App.tsx` — extend to pass metrics alongside changes

---

## 5. Implementation Plan

### Step 1: Types and Metrics Extraction

**New file**: `src/shared/types/tuning-history.types.ts`
- `CompactSpectrum`, `FilterMetricsSummary`, `PIDMetricsSummary`, `CompletedTuningRecord`

**New file**: `src/shared/utils/metricsExtract.ts`
- `downsampleSpectrum()` — linear interpolation from full FFT to ~128 bins
- `extractFilterMetrics(result: FilterAnalysisResult): FilterMetricsSummary` (includes spectrum)
- `extractPIDMetrics(result: PIDAnalysisResult): PIDMetricsSummary`

**New file**: `src/shared/utils/metricsExtract.test.ts`

**Modify**: `src/shared/types/tuning.types.ts`
- Add `postFilterSnapshotId`, `postTuningSnapshotId`, `filterMetrics`, `pidMetrics`, `verificationMetrics` fields

### Step 2: TuningHistoryManager (Backend)

**New file**: `src/main/storage/TuningHistoryManager.ts`
- CRUD for `{userData}/data/tuning-history/{profileId}.json`
- `archiveSession()`, `getHistory()`, `deleteHistory()`

**New file**: `src/main/storage/TuningHistoryManager.test.ts`

### Step 3: Post-Apply Snapshot ID Tracking

**Modify**: `src/main/index.ts`
- After creating Post-filter/Post-tuning snapshot on reconnect, save snapshot ID to session
- Don't change phase — just add data via `updatePhase(currentPhase, { postFilterSnapshotId })`

### Step 4: Metrics Capture at Apply Time

**Modify**: `src/shared/types/tuning.types.ts` (AppliedChange callback type)
**Modify**: `src/renderer/components/TuningWizard/TuningWizard.tsx`
- After successful apply, extract metrics from analysis results
- Pass metrics in `onApplyComplete` callback

**Modify**: `src/renderer/App.tsx`
- `handleApplyComplete` receives and forwards metrics to `updatePhase`

### Step 5: Verification Flight Flow

**Modify**: `src/renderer/components/TuningStatusBanner/TuningStatusBanner.tsx`
- `verification_pending` phase: show guidance ("Fly a short hover to verify noise improvement")
- Show [Download Log] when FC connected with logs, [Analyze Verification] after download
- Show [Skip Verification] to bypass

**Modify**: `src/renderer/App.tsx`
- Handle verification analyze: parse log → `analyzeFilters()` → `extractFilterMetrics()` → save as `verificationMetrics`
- Handle skip verification: transition to `completed` without verification data

**Modify**: `src/main/ipc/handlers.ts`
- Accept `verificationMetrics` in `TUNING_UPDATE_PHASE` data payload

### Step 6: Archive on Completion (Backend)

**Modify**: `src/main/ipc/handlers.ts`
- In `TUNING_UPDATE_PHASE` handler: when `phase === 'completed'`, archive to history first
- Initialize `TuningHistoryManager` in main process startup

**Modify**: `src/main/index.ts`
- Initialize history manager alongside session manager
- Delete history when profile is deleted

### Step 7: IPC for History

**Modify**: `src/shared/types/ipc.types.ts` — add `TUNING_GET_HISTORY` channel
**Modify**: `src/main/ipc/handlers.ts` — add handler
**Modify**: `src/preload/index.ts` — expose `getTuningHistory()`

### Step 8: useTuningHistory Hook

**New file**: `src/renderer/hooks/useTuningHistory.ts`
- Loads history on mount for current profile
- Reloads when profile changes
- Reloads when tuning session completes

### Step 9: NoiseComparisonChart Component

**New file**: `src/renderer/components/TuningHistory/NoiseComparisonChart.tsx`
- Recharts `<LineChart>` with before/after overlay traces
- Props: `before: CompactSpectrum`, `after: CompactSpectrum`
- Axis tabs (Roll / Pitch / Yaw)
- Noise floor delta summary pill ("↓ 12 dB improvement")
- Reuses same rendering approach as existing `SpectrumChart`

**New file**: `src/renderer/components/TuningHistory/NoiseComparisonChart.test.tsx`

### Step 10: TuningCompletionSummary Component

**New files**:
- `src/renderer/components/TuningHistory/TuningCompletionSummary.tsx`
- `src/renderer/components/TuningHistory/TuningCompletionSummary.css`
- `src/renderer/components/TuningHistory/TuningCompletionSummary.test.tsx`

Uses `NoiseComparisonChart` (when verification data available) + `AppliedChangesTable`.

**Modify**: `src/renderer/App.tsx`
- When `session.phase === 'completed'`, show `TuningCompletionSummary` instead of the current banner

### Step 11: AppliedChangesTable Sub-component

**New file**: `src/renderer/components/TuningHistory/AppliedChangesTable.tsx`
- Reusable table of `AppliedChange[]` with setting name, old → new, % change
- Used by both TuningCompletionSummary and TuningSessionDetail

### Step 12: TuningHistoryPanel + TuningSessionDetail

**New files**:
- `src/renderer/components/TuningHistory/TuningHistoryPanel.tsx`
- `src/renderer/components/TuningHistory/TuningHistoryPanel.css`
- `src/renderer/components/TuningHistory/TuningHistoryPanel.test.tsx`
- `src/renderer/components/TuningHistory/TuningSessionDetail.tsx`

**Modify**: `src/renderer/App.tsx`
- Render `TuningHistoryPanel` on the dashboard when profile is selected

### Step 13: Tests

Tests are created incrementally alongside each step. Key test areas:

- **metricsExtract.ts**: Correct extraction from full results, spectrum downsampling, edge cases
- **TuningHistoryManager**: Creates/reads/deletes history files, handles missing files, orders by date
- **Snapshot ID tracking**: Reconnect handler saves IDs to session
- **Verification flow**: Banner shows correct UI per phase, analyze saves metrics, skip works
- **Archive on completion**: Phase → completed triggers archival
- **NoiseComparisonChart**: Renders overlay, axis tabs, delta pill, handles missing data
- **TuningCompletionSummary**: Renders with/without verification, changes, metrics
- **TuningHistoryPanel**: Renders list, expands/collapses, empty state
- **AppliedChangesTable**: Renders setting changes with correct formatting

### Step 14: Documentation and TESTING.md Update

**Modify**: `CLAUDE.md`, `TESTING.md`, `docs/README.md`

---

## 6. Implementation Order and Dependencies

```
Step 1 (types + metrics extraction)     ← foundation, no dependencies
  │
  ├── Step 2 (TuningHistoryManager)     ← depends on step 1
  │     │
  │     ├── Step 6 (archive on completion) ← depends on step 2
  │     │
  │     └── Step 7 (IPC for history)     ← depends on step 2
  │           │
  │           └── Step 8 (useTuningHistory) ← depends on step 7
  │                 │
  │                 └── Step 12 (HistoryPanel + Detail) ← depends on step 8, 9
  │
  ├── Step 3 (snapshot ID tracking)     ← depends on step 1 (types)
  │
  ├── Step 4 (metrics capture at apply) ← depends on step 1
  │
  ├── Step 5 (verification flight flow) ← depends on step 1
  │     │
  │     └── Step 9 (NoiseComparisonChart) ← depends on step 1 (CompactSpectrum type)
  │           │
  │           └── Step 10 (CompletionSummary) ← depends on steps 5, 6, 9, 11
  │                 │
  │                 └── Step 11 (AppliedChangesTable) ← depends on step 10
  │
  └── Step 13 (tests) — incremental alongside each step
      Step 14 (docs) — at the end
```

**Recommended waves**:
1. **Wave 1** (foundation): Steps 1, 2, 3
2. **Wave 2** (data flow): Steps 4, 5, 6, 7
3. **Wave 3** (UI): Steps 8, 9, 10, 11, 12
4. **Wave 4** (finalization): Steps 13, 14

---

## 7. Files Changed

| File | Change |
|------|--------|
| `src/shared/types/tuning-history.types.ts` | **NEW** — CompactSpectrum, FilterMetricsSummary, PIDMetricsSummary, CompletedTuningRecord |
| `src/shared/utils/metricsExtract.ts` | **NEW** — downsampleSpectrum, extractFilterMetrics, extractPIDMetrics |
| `src/shared/utils/metricsExtract.test.ts` | **NEW** — extraction + downsampling tests |
| `src/shared/types/tuning.types.ts` | Add postFilterSnapshotId, postTuningSnapshotId, filterMetrics, pidMetrics, verificationMetrics |
| `src/main/storage/TuningHistoryManager.ts` | **NEW** — history CRUD |
| `src/main/storage/TuningHistoryManager.test.ts` | **NEW** — history manager tests |
| `src/main/index.ts` | Save post-apply snapshot IDs to session, init history manager, cleanup on profile delete |
| `src/main/ipc/handlers.ts` | Archive on completed, accept verificationMetrics, add TUNING_GET_HISTORY handler |
| `src/shared/types/ipc.types.ts` | Add TUNING_GET_HISTORY channel |
| `src/preload/index.ts` | Expose getTuningHistory() |
| `src/renderer/hooks/useTuningHistory.ts` | **NEW** — hook for history data |
| `src/renderer/components/TuningWizard/TuningWizard.tsx` | Pass metrics in onApplyComplete |
| `src/renderer/components/TuningStatusBanner/TuningStatusBanner.tsx` | Verification phase UI: guidance, download, analyze, skip |
| `src/renderer/App.tsx` | Forward metrics, verification analyze/skip, render CompletionSummary + HistoryPanel |
| `src/renderer/components/TuningHistory/NoiseComparisonChart.tsx` | **NEW** — before/after spectrum overlay chart |
| `src/renderer/components/TuningHistory/NoiseComparisonChart.test.tsx` | **NEW** |
| `src/renderer/components/TuningHistory/TuningCompletionSummary.tsx` | **NEW** — completion view |
| `src/renderer/components/TuningHistory/TuningCompletionSummary.css` | **NEW** |
| `src/renderer/components/TuningHistory/TuningCompletionSummary.test.tsx` | **NEW** |
| `src/renderer/components/TuningHistory/AppliedChangesTable.tsx` | **NEW** — reusable changes table |
| `src/renderer/components/TuningHistory/TuningHistoryPanel.tsx` | **NEW** — dashboard panel |
| `src/renderer/components/TuningHistory/TuningHistoryPanel.css` | **NEW** |
| `src/renderer/components/TuningHistory/TuningHistoryPanel.test.tsx` | **NEW** |
| `src/renderer/components/TuningHistory/TuningSessionDetail.tsx` | **NEW** — expanded detail view |
| `TESTING.md` | Update counts |
| `CLAUDE.md` | Document history system |
| `docs/README.md` | Add this document |

**Summary**: ~15 new files, ~10 modified files

---

## 8. Edge Cases

| Scenario | Handling |
|----------|----------|
| User skips verification flight | `verificationMetrics: null` — completion summary shows changes + PID metrics but no noise overlay chart. Hint text encourages verification next time. |
| User deletes a snapshot referenced in history | "Compare Snapshots" button disabled with tooltip "Snapshot not available" |
| User deletes a log referenced in history | History record remains — it has self-contained changes and metrics |
| Session is reset/abandoned before completion | No archive — session data is simply deleted (intentional: only completed sessions are worth keeping) |
| Session completes but has no filter changes (skip filter phase — future feature) | `appliedFilterChanges: []`, `filterMetrics: null` |
| Verification flight has no usable hover segments | `SegmentSelector` returns 0 segments → analysis fails gracefully → user can retry or skip |
| History file gets corrupted | Treat as empty history (log warning, don't crash) |
| Profile deletion | Delete `{profileId}.json` from both `tuning/` and `tuning-history/` |
| Multiple tuning cycles | Each completed cycle adds a record — array grows. At typical 3-10 records per profile, no performance concern |
| Old sessions without metrics (before this feature) | History starts empty for all profiles. No migration needed since current sessions are deleted on dismiss. |

---

## 9. Risks and Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|:-:|:-:|---|
| Metrics not captured if wizard crashes before apply callback | Low | Low | Metrics are optional in CompletedTuningRecord; UI handles `null` gracefully |
| Post-apply snapshot fails (FC disconnect during CLI export) | Low | Medium | Snapshot ID stays null; history record still has applied changes and metrics |
| Large history files for frequent tuners | Very Low | Low | Each record is ~5-8 KB (with spectra); 100 records = 800 KB max — negligible |
| Most users skip verification flight | Medium | Low | Completion summary still shows changes + PID metrics; chart is a bonus. Hint encourages verification. |
| Verification hover too short for good FFT | Low | Low | `SegmentSelector` requires minimum segment length; if no segments found, show error + retry option |
| User confusion about history vs snapshots | Medium | Low | History shows tuning sessions (complete workflow); snapshots show configuration states. Different concerns. |
| Breaking change to TuningSession type | — | — | All new fields are optional. Old session files work without migration. |

---

## 10. Future Enhancements (Out of Scope)

- **Cross-session trend charts**: Plot noise floor or overshoot over time across tuning cycles
- **Export history**: Export tuning history as JSON/CSV for sharing
- **History deletion**: Allow deleting individual history records (not needed for MVP — records are small and informational)
- **Verification PID metrics**: Also run PID analysis on verification flight to compare step response before/after (would need stick snaps in verification — conflicts with hover-only design)
