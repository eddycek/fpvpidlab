# Verification Flight Similarity & Tuning Loop Prevention

> **Status**: Proposed

## Problem

When a user completes a tuning session (Filter/PID/Flash) and flies a verification flight, the app analyzes the verification log using the **exact same pipeline** as the initial analysis — with no reference to the initial flight data. This creates two problems:

1. **Apples-to-oranges comparison**: If the verification flight has different throttle coverage, different segment types, or fundamentally different flight characteristics, the before/after comparison is meaningless. A user might see "regression" that's actually just different flight conditions.

2. **Tuning loop**: The user sees poor results → repeats tuning → flies differently again → poor results → repeat. There's no mechanism to detect that the user is stuck in a loop, and no guard against flights that are too dissimilar to compare.

### Current State

- `FilterAnalyzer.analyze()` takes no reference context — every analysis is independent
- `analysisHandlers.ts` calls the same analysis function for both initial and verification flights
- Verification metrics are stored alongside initial metrics (`TuningSession.filterMetrics` vs `verificationMetrics`) but no similarity check is performed
- The existing `NOISE_TARGET_DEADZONE_HZ = 5` (medium noise: 20 Hz) prevents micro-tweaks within a single analysis, but doesn't prevent cross-flight oscillation
- `TUNING_SESSION_EVALUATION.md` documents the **known limitation**: "Noise floor varies ±3-5 dB between flights due to wind, battery voltage, motor temperature, and flight style"

### What Changes Between Flights (and What Shouldn't)

| Property | Should be similar? | Why |
|----------|-------------------|-----|
| Peak frequencies (frame resonance, motor harmonics) | **Yes** | Mechanical properties of the drone — independent of filters/PIDs |
| Peak amplitudes | No | Filters attenuate peaks — that's the expected outcome |
| Noise floor level | No | That's what we're measuring as improvement |
| Throttle coverage / RPM range | **Yes** | Different RPM = completely different noise profile |
| Segment type (sweep vs hover) | **Yes** | Different segment types have different noise characteristics |
| Step input count & magnitude (PID) | **Yes** | Comparable sample size needed for valid comparison |
| Stick activity / coherence (Flash) | **Yes** | Transfer function quality depends on excitation |

---

## Solution: 4-Layer Anti-Loop Architecture

### Layer 1: Verification Flight Similarity Matching

**New module**: `src/main/analysis/VerificationMatcher.ts`

Compares verification flight characteristics against the initial analysis flight. Type-aware — each tuning mode has different similarity criteria.

#### Filter Tune Similarity

Inputs: initial `NoiseProfile` + `FlightSegment[]`, verification `NoiseProfile` + `FlightSegment[]`

**Sub-scores** (weighted 0-100):

| Sub-score | Weight | Calculation | Good threshold |
|-----------|--------|-------------|----------------|
| Throttle overlap | 0.35 | `overlap = min(refMax, verMax) - max(refMin, verMin); ratio = overlap / (refMax - refMin)` | ≥ 0.5 |
| Peak frequency match | 0.40 | For each ref mechanical peak (frame_resonance, motor_harmonic), find nearest ver peak within ±15 Hz. `matchRatio = matched / totalRefPeaks` | ≥ 0.5 |
| Segment type match | 0.25 | Both have sweeps → 100, both have hovers → 100, mismatch → 0 | Match |

**Peak matching algorithm**:
```typescript
function matchMechanicalPeaks(
  refPeaks: NoisePeak[],   // from initial analysis
  verPeaks: NoisePeak[],   // from verification analysis
  toleranceHz: number = 15
): { matchRatio: number; unmatchedRef: NoisePeak[]; unmatchedVer: NoisePeak[] }
```

1. Filter both peak arrays to mechanical types only (`frame_resonance`, `motor_harmonic`)
2. For each reference peak, find the closest verification peak by frequency
3. If `|refFreq - verFreq| ≤ peakMatchTolerance(refFreq)` → matched
4. Return `matched / totalRefMechanicalPeaks`
5. If reference has 0 mechanical peaks, return 1.0 (nothing to mismatch)
6. **Post-filter peak masking**: Peaks present in reference but absent in verification are classified as "filtered" (expected outcome of good filter tuning), NOT as "unmatched". Only penalize peaks that appear at a **different frequency** in verification — that indicates different flight conditions.

**Proportional tolerance**: Peak tolerance scales with frequency to handle higher harmonics correctly. Motor RPM varies ±5% between flights (battery voltage, temperature), so a 300 Hz harmonic can shift ±15 Hz, while a 600 Hz 2nd harmonic can shift ±30 Hz. Frame resonance (80-200 Hz) is stable to ±2-3 Hz.

```typescript
function peakMatchTolerance(frequencyHz: number): number {
  return Math.max(PEAK_MATCH_TOLERANCE_MIN_HZ, frequencyHz * MOTOR_HARMONIC_TOLERANCE_RATIO);
  // Reuses existing MOTOR_HARMONIC_TOLERANCE_RATIO = 0.05 from constants.ts
  // At 150 Hz: max(10, 7.5) = 10 Hz
  // At 300 Hz: max(10, 15) = 15 Hz
  // At 600 Hz: max(10, 30) = 30 Hz
}
```

**New constant**: `PEAK_MATCH_TOLERANCE_MIN_HZ = 10` (minimum tolerance floor for low-frequency peaks).

#### PID Tune Similarity

Inputs: initial `PIDMetricsSummary`, verification `PIDMetricsSummary`

| Sub-score | Weight | Calculation | Good threshold |
|-----------|--------|-------------|----------------|
| Step count ratio | 0.30 | `min(refSteps, verSteps) / max(refSteps, verSteps)` | ≥ 0.5 |
| Axis coverage match | 0.35 | Count axes with ≥3 steps in both ref and ver. `score = matchedAxes / 3 × 100` | All 3 axes |
| Magnitude range overlap | 0.35 | Compare step magnitude distributions (mean ± std). Overlap ratio of the two ranges. | ≥ 0.4 |

**No peak matching** — PID analysis doesn't use noise spectra.

#### Flash Tune Similarity

Inputs: initial and verification `TransferFunctionMetricsSummary` + `FilterMetricsSummary`

| Sub-score | Weight | Calculation | Good threshold |
|-----------|--------|-------------|----------------|
| Throttle overlap | 0.30 | Same as Filter Tune | ≥ 0.5 |
| Activity ratio | 0.35 | `min(refRMS, verRMS) / max(refRMS, verRMS)` where RMS is stick activity | ≥ 0.5 |
| Coherence ratio | 0.35 | Mean coherence comparison across axes | ≥ 0.5 |

#### Output Type

```typescript
interface VerificationSimilarity {
  /** Overall similarity score 0-100 */
  score: number;
  /** Classification tier */
  tier: 'good' | 'marginal' | 'poor';
  /** Action recommendation for the UI */
  recommendation: 'accept' | 'warn' | 'reject_reflight';
  /** Per-metric sub-scores */
  subScores: Array<{ name: string; score: number; weight: number }>;
  /** Human-readable warnings */
  warnings: AnalysisWarning[];
}
```

**Decision thresholds**:
- `score ≥ 70` → `accept` — comparison is valid, show normal results
- `score 40-69` → `warn` — "Results may be skewed because flight conditions differ. Consider flying again with similar throttle patterns."
- `score < 40` → `reject_reflight` — "Verification flight is too different from the initial analysis flight. Fly again with similar throttle coverage and style for a valid comparison."

#### Integration Point

`FilterAnalyzer.analyze()` gets an optional `referenceContext` parameter:

```typescript
export interface VerificationReferenceContext {
  /** Noise profile from initial analysis (Filter/Flash) */
  noiseProfile?: NoiseProfile;
  /** Segments from initial analysis (Filter/Flash) */
  segments?: FlightSegment[];
  /** PID metrics from initial analysis (PID) */
  pidMetrics?: PIDMetricsSummary;
  /** Transfer function metrics from initial analysis (Flash) */
  transferFunctionMetrics?: TransferFunctionMetricsSummary;
}
```

When `referenceContext` is provided, the analyzer runs the appropriate matcher after analysis completes and attaches the result to `FilterAnalysisResult.verificationSimilarity`.

**IPC flow**: `analysisHandlers.ts` checks if there's an active tuning session with initial metrics. If so, it constructs `referenceContext` from the session's stored metrics and passes it to the analyzer.

---

### Layer 2: Recommendation Hysteresis (Noise Floor Confidence Band)

**Problem**: The existing `NOISE_TARGET_DEADZONE_HZ = 5` (20 for medium noise) is a fixed value. It doesn't account for how variable the noise floor is within the current flight's segments.

**Solution**: Widen the deadzone dynamically based on noise floor variability across segments.

#### Algorithm

In `FilterAnalyzer.ts`, after computing per-segment FFT spectra and before calling `recommend()`:

```typescript
function computeNoiseFloorVariability(
  segmentSpectra: PowerSpectrum[][]  // [axis][segment]
): { mean: number; std: number } {
  // For each segment, estimate noise floor
  // Return mean and std of noise floors across segments
}
```

Pass `noiseFloorStd` to `FilterRecommender.recommend()` as part of a new optional `confidenceContext`:

```typescript
interface RecommenderConfidenceContext {
  /** Noise floor standard deviation across segments (dB) */
  noiseFloorStdDb?: number;
}
```

In `FilterRecommender.ts`, the deadzone calculation becomes:

```typescript
// Current: fixed deadzone
const gyroDeadzone = overallLevel === 'medium' ? 20 : NOISE_TARGET_DEADZONE_HZ;

// New: variability-aware deadzone
const variabilityBonus = Math.min(
  confidenceContext?.noiseFloorStdDb ?? 0,
  MAX_VARIABILITY_BONUS_HZ   // cap at 15 Hz
) * VARIABILITY_TO_HZ_SCALE;  // 2.0: each dB of std → 2 Hz wider deadzone

const gyroDeadzone = (overallLevel === 'medium' ? 20 : NOISE_TARGET_DEADZONE_HZ) + variabilityBonus;
```

**New constants** in `constants.ts`:

```typescript
/** Maximum additional deadzone from noise floor variability (Hz) */
export const MAX_VARIABILITY_BONUS_HZ = 15;

/** Scale factor: dB of noise floor std → Hz of additional deadzone.
 * Derived from computeNoiseBasedTarget() slope: 60 dB range → 225 Hz range = 3.75 Hz/dB.
 * Each dB of noise floor uncertainty maps to ~3.75 Hz of cutoff target uncertainty. */
export const VARIABILITY_TO_HZ_SCALE = 3.75;
```

**Effect**: If noise floor varies ±5 dB across segments (common in turbulent conditions), the deadzone widens by ~15 Hz (capped at MAX_VARIABILITY_BONUS_HZ). This prevents recommendations that are within the measurement uncertainty.

#### PID Equivalent

For PID recommendations, compute step response variability (std of overshoot across steps). Widen the `DAMPING_RATIO_DEADZONE` proportionally.

```typescript
const overshootStd = computeOvershootStd(axisResponses);
const pidDeadzone = DAMPING_RATIO_DEADZONE + Math.min(overshootStd * 0.5, 5);
```

---

### Layer 3: Convergence Detection

**New module**: `src/main/analysis/ConvergenceDetector.ts`

Called during verification completion to determine if further tuning would yield meaningful improvement.

#### Filter Convergence

```typescript
function detectFilterConvergence(
  initial: FilterMetricsSummary,
  verification: FilterMetricsSummary
): ConvergenceResult
```

**Metrics checked**:
- Per-axis noise floor delta: `verFloor - initFloor` (negative = improvement)
- Worst-axis delta (most important — weakest link)

**Thresholds** (calibrated against known ±3-5 dB flight-to-flight noise floor variation):
- `|worstAxisDelta| < 1.5 dB` → `converged` — "Filters are optimized. Further tuning won't produce measurable improvement."
- `|worstAxisDelta| < 3.0 dB` → `diminishing_returns` — "Improvement is within normal flight-to-flight variation (X dB). Another iteration is unlikely to help."
- Otherwise → `continue` — normal flow

#### PID Convergence

```typescript
function detectPIDConvergence(
  initial: PIDMetricsSummary,
  verification: PIDMetricsSummary
): ConvergenceResult
```

**Metrics checked**:
- Per-axis overshoot delta: `|verOvershoot - initOvershoot|`
- Per-axis settling time delta: `|verSettling - initSettling|`

**Thresholds**:
- Overshoot delta < 2% AND settling time delta < 5ms → `converged`
- Overshoot delta < 5% AND settling time delta < 15ms → `diminishing_returns`
- Otherwise → `continue`

#### Flash Convergence

```typescript
function detectFlashConvergence(
  initial: TransferFunctionMetricsSummary,
  verification: TransferFunctionMetricsSummary,
  initialFilter?: FilterMetricsSummary,
  verificationFilter?: FilterMetricsSummary
): ConvergenceResult
```

**Metrics checked**:
- Bandwidth delta: `|verBW - initBW|`
- Phase margin delta: `|verPM - initPM|`
- Noise floor delta (if filter metrics available)

**Thresholds**:
- BW delta < 2 Hz AND PM delta < 3° AND noise delta < 1 dB → `converged`
- BW delta < 5 Hz AND PM delta < 5° → `diminishing_returns`
- Otherwise → `continue`

#### Output Type

```typescript
interface ConvergenceResult {
  /** Whether tuning has converged */
  status: 'converged' | 'diminishing_returns' | 'continue';
  /** Actual improvement measured */
  improvementDelta: number;
  /** Minimum delta considered meaningful */
  meaningfulThreshold: number;
  /** Human-readable recommendation */
  message: string;
  /** Per-metric details */
  details: Array<{
    metric: string;
    initialValue: number;
    verificationValue: number;
    delta: number;
    unit: string;
  }>;
}
```

#### Integration

- Computed in `tuningHandlers.ts` when `TUNING_UPDATE_VERIFICATION` is called
- Stored on `CompletedTuningRecord.convergence?: ConvergenceResult`
- Displayed in `TuningCompletionSummary`:
  - `converged` → green banner: "Tuning complete — filters are optimized for this quad." Hide "Repeat" button.
  - `diminishing_returns` → amber banner: "Improvement is minimal. Another iteration is unlikely to help." Show "Repeat" as secondary action.
  - `continue` → normal flow (existing quality score gate)

---

### Layer 4: Iteration Tracking

**Extension to `TuningHistoryManager`**.

#### New Method

```typescript
function getRecentIterationCount(
  profileId: string,
  tuningType: TuningType,
  withinDays: number = 7
): number
```

Counts completed tuning records of the same type for the same profile within the last N days.

#### UI Integration

In `TuningStatusBanner` (when starting a new session) and `TuningCompletionSummary` (after completion):

| Iteration | Message | Severity |
|-----------|---------|----------|
| 1st | (none) | — |
| 2nd | "This is your 2nd filter tune this week. Check if the previous session improved your flight." | info |
| 3rd+ | "You've done {N} filter tunes in 7 days. If results aren't improving, the issue may be mechanical (worn props, loose motor screws, bent shaft)." | warning |

#### New Constant

```typescript
/** Number of recent same-type tuning sessions that triggers iteration warning */
export const ITERATION_WARNING_THRESHOLD = 3;

/** Lookback window for iteration counting (days) */
export const ITERATION_LOOKBACK_DAYS = 7;
```

---

## Telemetry

### New Fields on `TelemetrySessionRecord`

```typescript
interface TelemetrySessionRecord {
  // ... existing fields ...

  /** Verification flight similarity (if verification was performed) */
  verificationSimilarity?: {
    score: number;
    tier: 'good' | 'marginal' | 'poor';
    recommendation: 'accept' | 'warn' | 'reject_reflight';
    throttleOverlap?: number;
    peakMatchRatio?: number;
  };

  /** Convergence detection result */
  convergence?: {
    status: 'converged' | 'diminishing_returns' | 'continue';
    improvementDelta: number;
  };

  /** How many times this profile+type has been tuned in the last 7 days */
  iterationCount?: number;
}
```

### New Telemetry Events

```typescript
// When verification is rejected due to low similarity
{ type: 'workflow', name: 'verification_rejected', meta: { score, tier, tuningType } }

// When convergence is detected
{ type: 'workflow', name: 'tuning_converged', meta: { status, improvementDelta, tuningType } }

// When iteration warning is shown
{ type: 'workflow', name: 'iteration_warning', meta: { count, tuningType } }
```

### KPIs to Track

| KPI | Target | Measurement |
|-----|--------|-------------|
| Verification rejection rate | < 15% | `verification_rejected` events / total verifications |
| False rejection rate | < 5% | User manually re-runs after rejection and gets `accept` |
| Convergence detection rate | > 40% of sessions | `tuning_converged` where status ≠ `continue` |
| Iteration loop rate | < 10% | Sessions with `iterationCount ≥ 3` |
| Mean verification similarity | > 70 | Average `verificationSimilarity.score` |

---

## Implementation Plan

### Task 1: Types & Constants

**Files**:
- `src/shared/types/analysis.types.ts` — Add `VerificationSimilarity`, `ConvergenceResult`, `VerificationReferenceContext`
- `src/shared/types/tuning-history.types.ts` — Add `convergence?: ConvergenceResult` to `CompletedTuningRecord`
- `src/main/analysis/constants.ts` — Add new constants: `PEAK_MATCH_TOLERANCE_MIN_HZ`, `SIMILARITY_ACCEPT_THRESHOLD`, `SIMILARITY_REJECT_THRESHOLD`, `MAX_VARIABILITY_BONUS_HZ`, `VARIABILITY_TO_HZ_SCALE`, `FILTER_CONVERGENCE_DB`, `FILTER_DIMINISHING_DB`, `PID_CONVERGENCE_OVERSHOOT_PCT`, `PID_CONVERGENCE_SETTLING_MS`, `ITERATION_WARNING_THRESHOLD`, `ITERATION_LOOKBACK_DAYS`

**Tests**: Type compilation check only (no logic).

### Task 2: VerificationMatcher (`src/main/analysis/VerificationMatcher.ts`)

**New file** with 3 public functions:
- `matchFilterVerification(ref, ver): VerificationSimilarity`
- `matchPIDVerification(ref, ver): VerificationSimilarity`
- `matchFlashVerification(ref, ver): VerificationSimilarity`

Internal helpers:
- `matchMechanicalPeaks(refPeaks, verPeaks, toleranceHz): { matchRatio, unmatchedRef, unmatchedVer }`
- `computeThrottleOverlap(refSegments, verSegments): number`
- `computeStepCountRatio(refSteps, verSteps): number`
- `computeMagnitudeOverlap(refMags, verMags): number`
- `computeActivityRatio(refRMS, verRMS): number`
- `scoreTier(score): VerificationSimilarity['tier']`
- `scoreRecommendation(score): VerificationSimilarity['recommendation']`

**Test file**: `src/main/analysis/VerificationMatcher.test.ts`
- Test: identical flights → score 100, tier good, accept
- Test: same peaks different throttle → score ~60-70, warn
- Test: completely different peaks → score < 40, reject
- Test: no mechanical peaks in reference → score not penalized (matchRatio = 1.0)
- Test: PID — same axis coverage, similar step count → accept
- Test: PID — missing axis in verification → warn/reject
- Test: Flash — similar activity and coherence → accept
- Test: Flash — very different stick activity → reject
- Test: edge cases (empty peaks, 0 segments, single segment)

### Task 3: ConvergenceDetector (`src/main/analysis/ConvergenceDetector.ts`)

**New file** with 3 public functions:
- `detectFilterConvergence(initial, verification): ConvergenceResult`
- `detectPIDConvergence(initial, verification): ConvergenceResult`
- `detectFlashConvergence(initial, verification, initialFilter?, verificationFilter?): ConvergenceResult`

**Test file**: `src/main/analysis/ConvergenceDetector.test.ts`
- Test: filter — noise floor improved by 1.0 dB → converged
- Test: filter — noise floor improved by 2.5 dB → diminishing_returns
- Test: filter — noise floor improved by 5 dB → continue
- Test: filter — noise floor regressed → continue (not converged, despite small delta)
- Test: PID — overshoot changed by 1% → converged
- Test: PID — overshoot changed by 3% → diminishing_returns
- Test: PID — overshoot changed by 10% → continue
- Test: Flash — all metrics within thresholds → converged
- Test: Flash — bandwidth improved significantly → continue
- Test: edge cases (null metrics, partial data)

### Task 4: Recommendation Hysteresis Enhancement

**Files**:
- `src/main/analysis/FilterAnalyzer.ts` — Compute `noiseFloorStd` across segments, pass to recommender
- `src/main/analysis/FilterRecommender.ts` — Accept `confidenceContext`, widen deadzone
- `src/main/analysis/PIDRecommender.ts` — Accept overshoot variability, widen damping deadzone

**Test updates**:
- `src/main/analysis/FilterRecommender.test.ts` — Test that high variability suppresses marginal recommendations
- `src/main/analysis/PIDRecommender.test.ts` — Test damping deadzone widening

### Task 5: Iteration Tracking

**Files**:
- `src/main/storage/TuningHistoryManager.ts` — Add `getRecentIterationCount(profileId, type, days)`

**Test file**: `src/main/storage/TuningHistoryManager.test.ts` (extend existing)
- Test: 0 records → returns 0
- Test: 2 filter records in 7 days → returns 2
- Test: 3 filter + 1 pid record → filter returns 3, pid returns 1
- Test: old records (> 7 days) excluded

### Task 6: Pipeline Integration

**Files**:
- `src/main/ipc/handlers/analysisHandlers.ts` — Construct `referenceContext` from active session when analyzing verification log
- `src/main/ipc/handlers/tuningHandlers.ts` — Compute convergence result on `TUNING_UPDATE_VERIFICATION`, store on history record. Query iteration count on session start.
- `src/main/analysis/FilterAnalyzer.ts` — Add optional `referenceContext` param, run matcher, attach result
- `src/main/analysis/PIDAnalyzer.ts` — Same for PID
- `src/shared/types/analysis.types.ts` — Add `verificationSimilarity?: VerificationSimilarity` to `FilterAnalysisResult`, `PIDAnalysisResult`, `TransferFunctionAnalysisResult`

### Task 7: UI Updates

**Files**:
- `src/renderer/components/TuningHistory/TuningCompletionSummary.tsx`:
  - Show `VerificationSimilarity` banner (accept/warn/reject)
  - Show `ConvergenceResult` banner (converged/diminishing/continue)
  - Show iteration warning
  - Adjust "Repeat" button visibility based on convergence
- `src/renderer/components/TuningStatusBanner.tsx`:
  - Show iteration count warning when starting new session

**Test updates**:
- `TuningCompletionSummary.test.tsx` — Test all 3 similarity tiers, all 3 convergence states, iteration warnings

### Task 8: Telemetry

**Files**:
- `src/shared/types/telemetry.types.ts` — Extend `TelemetrySessionRecord` with new fields
- `src/main/telemetry/TelemetryManager.ts` — Emit new events
- `src/main/ipc/handlers/tuningHandlers.ts` — Populate telemetry fields on session completion

### Task 9: Documentation

- Update `TUNING_SESSION_EVALUATION.md` — Add convergence detection section, reference this doc
- Update `CLAUDE.md` — Note new modules in analysis section
- Update `ARCHITECTURE.md` — New analysis module count
- Update `TESTING.md` — New test files and counts

---

## Execution Order

```
Task 1 (Types & Constants)
    ↓
Task 2 (VerificationMatcher) ──┐
Task 3 (ConvergenceDetector) ──┼── parallel, independent
Task 4 (Hysteresis) ───────────┤
Task 5 (Iteration Tracking) ───┘
    ↓
Task 6 (Pipeline Integration) ─── depends on all above
    ↓
Task 7 (UI Updates) ─── depends on Task 6
Task 8 (Telemetry) ─── depends on Task 6
    ↓
Task 9 (Documentation)
```

Tasks 2-5 can be implemented in parallel. Tasks 7 and 8 can be parallel after Task 6.

---

## Tuning Advisor Review

**Reviewed**: 2026-04-05 | **Verdict**: ✅ Approved with adjustments (all applied above)

| # | Finding | Severity | Resolution |
|---|---------|----------|------------|
| 1 | Peak tolerance should be proportional to frequency | P1 | Changed to `max(10, freq × 0.05)` using existing `MOTOR_HARMONIC_TOLERANCE_RATIO` |
| 2 | Post-filter peak masking — filtered peaks shouldn't count as mismatches | P0 | Added "filtered vs unmatched" classification in peak matching algorithm |
| 3 | `VARIABILITY_TO_HZ_SCALE` should be derived from interpolation slope | P1 | Changed from 2.0 to 3.75 (225 Hz / 60 dB) |
| 4 | Filter convergence thresholds too tight vs ±3-5 dB natural variation | P2 | Raised to 1.5 dB converged, 3.0 dB diminishing_returns |
| 5 | PID magnitude overlap may penalize different pilot styles | P2 | Noted — will use coefficient of variation in implementation |
