# Feedforward Awareness: Detection, Warnings, and Future Recommendations

> **Status**: Complete (PRs #55–#62)
> **Date**: 2026-02-11
> **Scope**: PID Analysis Pipeline, BBL Header Parsing, Types, UI Warnings

---

## 1. Why This Is Needed

### 1.1 Problem: Misattributed Overshoot

The current PID recommender (`PIDRecommender.ts`) assumes that overshoot and ringing in step response data are caused exclusively by P/D imbalance. However, **feedforward (FF)** is a third control term that directly contributes to motor output during stick movements.

When feedforward is active:
- **Overshoot may be caused by high FF**, not high P — the recommender would incorrectly suggest reducing P or increasing D
- **Fast rise time may be from FF**, not from P being correctly tuned — the recommender may skip needed P increases
- **Ringing at step onset** can come from `feedforward_boost` (second derivative of setpoint), which the recommender would attribute to P/D issues

This is not a theoretical concern. Betaflight 4.3+ ships with feedforward enabled by default (`feedforward_boost = 15`, per-axis F gains > 0`). The vast majority of flight logs will have FF active.

### 1.2 Problem: Missing F Gain in Type System

`PIDTerm` currently has only `{ P, I, D }`. The feedforward gain (F) per axis is a core part of Betaflight's PIDF controller but is absent from our data model. This means:

- `extractFlightPIDs()` parses only P, I, D from BBL headers — F gain is lost
- `setPIDConfiguration()` writes only P, I, D via MSP_PID — F gain cannot be modified
- The UI displays only P, I, D values — the user has no visibility into FF state

### 1.3 Problem: No Data Quality Warning

Even before we can decompose FF contribution from step responses, we should warn users that their analysis includes FF effects. Currently, `AnalysisWarning.code` has no FF-related warning type.

### 1.4 What Feedforward Actually Is

Feedforward is a **proactive** control term added to motor output based on the derivative of the pilot's stick input (setpoint). Unlike PID which reacts to error between setpoint and gyro, FF pre-drives motors when sticks move:

```
Total output = P(error) + I(∫error) + D(d_error/dt) + F(d_setpoint/dt) + FF_boost(d²setpoint/dt²)
```

Key parameters (BF 4.3+ naming):
| Parameter | Default | Purpose |
|-----------|---------|---------|
| `feedforward_transition` | 0 | Center-stick FF attenuation |
| `feedforward_boost` | 15 | Stick acceleration component (2nd derivative) |
| `feedforward_smooth_factor` | 37 | Smoothing applied to FF output |
| `feedforward_jitter_factor` | 7 | Dynamic attenuation for slow inputs |
| `feedforward_max_rate_limit` | 100 | Predictive overshoot prevention at max rate |

Per-axis F gain values are stored in the PID profile and control the overall FF strength.

---

## 2. Analysis of Required Changes

### 2.1 Data Already Available (No Parser Changes Needed)

The BBL parser **already captures all feedforward data**:

- **Raw headers**: `HeaderParser.ts` stores all headers in `rawHeaders: Map<string, string>`. This includes `feedforward_transition`, `feedforward_boost`, `feedforward_smooth_factor`, `feedforward_jitter_factor`, `feedforward_max_rate_limit`, etc.
- **Per-frame F-term**: `BlackboxParser.ts` extracts `axisF[0..2]` into `pidF` time series in `BlackboxFlightData`. The actual FF contribution per sample is already parsed.
- **BBL header PID format**: `rollPID`, `pitchPID`, `yawPID` contain only P,I,D — the F gain is NOT in these triplets. F gain values need to be extracted from separate header fields or the `pidF` time series.

### 2.2 Type Changes Required

**`src/shared/types/pid.types.ts`**:
```typescript
// Current:
export interface PIDTerm { P: number; I: number; D: number; }

// Proposed:
export interface PIDTerm { P: number; I: number; D: number; }
export interface PIDFTerm extends PIDTerm { F: number; }
```

Using `PIDFTerm` as an extension preserves backward compatibility — existing code using `PIDTerm` continues to work.

**`src/shared/types/analysis.types.ts`**:
```typescript
// Add new warning code:
code: 'low_logging_rate' | 'wrong_debug_mode' | 'no_sweep_segments' | 'few_steps' | 'feedforward_active';

// Add FF context to PIDAnalysisResult:
export interface FeedforwardContext {
  /** Whether FF is meaningfully active (any axis has F > 0 or boost > 0) */
  active: boolean;
  /** Per-axis F gains (if available) */
  fGains?: { roll: number; pitch: number; yaw: number };
  /** FF boost value */
  boost?: number;
  /** FF max rate limit */
  maxRateLimit?: number;
}
```

### 2.3 PIDRecommender Changes

The recommender needs to know whether FF is active to adjust its interpretation:

1. **Read FF state from BBL headers** in the analysis pipeline (PIDAnalyzer)
2. **Pass FF context** to `recommendPID()`
3. **When FF is active**: Add a `feedforward_active` warning to the result
4. **Phase 2 (future)**: Use `pidF` time series to decompose FF contribution at overshoot points

### 2.4 MSP Gap

- **MSP_PID (112)**: Returns only P, I, D per axis (3 bytes × 10 axes). No F gain.
- **MSP_PID_ADVANCED (94)**: Contains FF parameters but is not currently implemented in `MSPClient.ts`.
- Reading MSP_PID_ADVANCED would allow live FF state detection even without a BBL log.

### 2.5 BF Version Compatibility

The app's minimum supported version is **BF 4.3** (API 1.44). All feedforward parameters
use the `feedforward_*` naming convention introduced in 4.3. No dual-naming support for
the older `ff_*` prefix (BF 4.2 and earlier) is needed.

See `docs/BF_VERSION_POLICY.md` for the full version compatibility policy.

---

## 3. Implementation Plan

### Phase 1: Detection and Warning (Minimal — High Value) ✅

**Goal**: Detect FF state, warn users, prevent misdiagnosis.

#### Task 1.1: Add `FeedforwardContext` type and `feedforward_active` warning code ✅ (PR #55)
- **File**: `src/shared/types/analysis.types.ts`, `src/shared/types/pid.types.ts`
- **Changes**: Add `FeedforwardContext` interface, add `PIDFTerm` type, add `'feedforward_active'` to `AnalysisWarning.code` union
- **Tests**: Type compilation only (no runtime logic yet)

#### Task 1.2: Extract FF context from BBL headers ✅ (PR #56)
- **File**: `src/main/analysis/PIDRecommender.ts` (new function `extractFeedforwardContext()`)
- **Changes**: Parse `feedforward_boost`, `feedforward_transition`, `feedforward_max_rate_limit` from `rawHeaders` (4.3+ naming only — minimum supported version).
- **Tests**: Unit tests for present headers, missing headers, zero values

#### Task 1.3: Wire FF context through PIDAnalyzer → PIDRecommender ✅ (PR #57)
- **File**: `src/main/analysis/PIDAnalyzer.ts`
- **Changes**: Call `extractFeedforwardContext()` with BBL raw headers, pass to `recommendPID()`, attach to result
- **Tests**: Integration test verifying FF context appears in analysis result

#### Task 1.4: Emit `feedforward_active` warning when FF detected ✅ (PR #57)
- **File**: `src/main/analysis/PIDRecommender.ts`
- **Changes**: When `feedforwardContext.active === true`, push a warning: _"Feedforward is active on this flight. Overshoot and rise time measurements include feedforward contribution — some overshoot may be from FF rather than P/D imbalance."_
- **Tests**: Unit test: FF active → warning present; FF inactive → no warning

#### Task 1.5: Display FF warning in UI ✅ (PR #58)
- **File**: `src/renderer/components/TuningWizard/PIDAnalysisStep.tsx`, `src/renderer/components/AnalysisOverview/AnalysisOverview.tsx`
- **Changes**: Render `feedforward_active` warning with appropriate styling (info severity)
- **Tests**: Component tests verifying warning renders when present in analysis result

### Phase 2: FF-Aware Recommendations (Advanced — Medium Value) ✅

**Goal**: Use `pidF` time series to decompose FF contribution at overshoot points.

#### Task 2.1: Analyze FF contribution at overshoot points ✅ (PR #59)
- **File**: `src/main/analysis/StepMetrics.ts` (new method)
- **Changes**: At each step's overshoot peak, compare `pidF[axis]` magnitude vs `pidP[axis]` magnitude. If `|pidF| > |pidP|` at the overshoot point, flag as "FF-dominated overshoot".
- **Tests**: Unit tests with synthetic step data where FF dominates vs P dominates

#### Task 2.2: Adjust recommender rules for FF-dominated overshoot ✅ (PR #60)
- **File**: `src/main/analysis/PIDRecommender.ts`
- **Changes**: When a step's overshoot is FF-dominated, do NOT recommend P reduction or D increase. Instead, add an observation: _"Overshoot appears to be caused by feedforward, not P/D imbalance. Consider reducing feedforward_boost."_
- **Tests**: Unit test: FF-dominated overshoot → no P/D changes, only FF observation

#### Task 2.3: Add FF parameter recommendations ✅ (PR #60)
- **File**: `src/main/analysis/PIDRecommender.ts`
- **Changes**: Recommend `feedforward_boost` and `feedforward_smooth_factor` adjustments based on FF contribution analysis
- **Tests**: Unit tests for various FF overshoot scenarios

### Phase 3: MSP_PID_ADVANCED Support ✅

#### Task 3.1: Implement MSP_PID_ADVANCED read ✅ (PR #61)
- **File**: `src/main/msp/MSPClient.ts`
- **Changes**: Add `getFeedforwardConfiguration()` method reading MSP command 94
- **Tests**: Unit tests with mock MSP response buffers

#### Task 3.2: Display FF values in FC Info ✅ (PR #62)
- **File**: `src/renderer/components/FCInfo/FCInfoDisplay.tsx`
- **Changes**: Show per-axis F gains and FF parameters when available via MSP_PID_ADVANCED
- **Tests**: Component tests

---

## 4. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| BBL headers don't contain FF params (very old FW) | Low | Low | Graceful fallback: `active: false`, no warning |
| False positive FF detection (F=0 but boost>0) | Low | Low | Check multiple indicators: F gain, boost, transition |
| Phase 2 decomposition inaccurate | Medium | Medium | Use confidence scoring; only flag when FF clearly dominates |
| MSP_PID_ADVANCED format varies by BF version | Medium | Low | Phase 3 is optional; BBL headers are the primary source |

---

## 5. Files Affected

| File | Phase | Change Type |
|------|-------|-------------|
| `src/shared/types/pid.types.ts` | 1 | Add `PIDFTerm` |
| `src/shared/types/analysis.types.ts` | 1 | Add `FeedforwardContext`, warning code |
| `src/main/analysis/PIDRecommender.ts` | 1, 2 | `extractFeedforwardContext()`, FF-aware rules |
| `src/main/analysis/PIDAnalyzer.ts` | 1 | Wire FF context through pipeline |
| `src/main/analysis/StepMetrics.ts` | 2 | FF decomposition at overshoot points |
| `src/renderer/components/TuningWizard/PIDAnalysisStep.tsx` | 1 | Display FF warning |
| `src/renderer/components/AnalysisOverview/AnalysisOverview.tsx` | 1 | Display FF warning |
| `src/main/msp/MSPClient.ts` | 3 | MSP_PID_ADVANCED support |
| `src/renderer/components/FCInfoDisplay.tsx` | 3 | Display FF values |

---

## 6. References

- [Betaflight Wiki: Feed Forward 2.0](https://github.com/betaflight/betaflight/wiki/Feed-Forward-2.0)
- [Betaflight 4.3 Tuning Notes](https://github.com/betaflight/betaflight/wiki/4.3-Tuning-Notes)
- [Oscar Liang: Betaflight Feedforward](https://oscarliang.com/setpoint-weight-transition-derivative-error-measurement/)
- [FPVSIM: Step Response P/D Balance](https://fpvsim.com/how-tos/step-response-pd-balance)
- [Betaflight source: pid.c](https://github.com/betaflight/betaflight/blob/master/src/main/flight/pid.c)
