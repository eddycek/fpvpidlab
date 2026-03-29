# Chirp Flight Analysis (BF 4.6+)

> **Status**: Proposed

## Problem

Current transfer function estimation uses Wiener deconvolution on arbitrary stick inputs. While this works, the quality depends heavily on input signal richness — freestyle flights may not excite all frequencies equally, and stick snaps are narrowband impulses. The resulting Bode plot has noisy regions where the pilot never provided input energy.

Betaflight 4.6 (2025.12) introduced a built-in **chirp signal generator** — an exponential frequency sweep injected directly into the PID loop. This is the gold standard for system identification: uniform energy across all frequencies, controlled amplitude, per-axis isolation. It produces transfer functions with dramatically higher coherence and accuracy than any manual flight.

## Solution

Add a **Chirp Tune** mode that detects chirp excitation in BBL data, extracts the chirp input/output signals, and computes high-precision transfer functions. Reuses the existing `TransferFunctionEstimator` math but with chirp-quality inputs and adds coherence validation.

## BF Chirp Implementation Details

### CLI Configuration

```
set debug_mode = CHIRP
set blackbox_high_resolution = ON
set chirp_frequency_start_deci_hz = 2       # 0.2 Hz (in 0.1 Hz units)
set chirp_frequency_end_deci_hz = 6000      # 600 Hz
set chirp_time_seconds = 20                 # Duration of sweep
set chirp_lag_freq_hz = 3                   # Leadlag filter: lag pole
set chirp_lead_freq_hz = 30                 # Leadlag filter: lead zero
```

### Excitation Signal

- **Type**: Exponential frequency sweep (chirp) from 0.2 Hz to 600 Hz over 20 seconds
- **Injection point**: Added to `currentPidSetpoint` in BF's `pid.c` — pilot retains manual control during measurement
- **Amplitude**: Configurable per axis (default: roll/pitch 230 deg/s, yaw 180 deg/s)
- **Signal shaping**: Leadlag filter (lag 3 Hz, lead 30 Hz) compensates for rate-controller's differentiating behavior at low frequencies

### Per-Axis Sequential Execution

Chirp runs **one axis at a time**, not simultaneously:
1. First CHIRP mode activation → **roll** axis
2. Second toggle → **pitch** axis
3. Third toggle → **yaw** axis
4. Cycles back to roll

This means a complete chirp measurement requires **3 sequential chirp activations** (or 3 flights). Each activation produces ~20 seconds of data for that axis.

### BBL Data Layout

When `debug_mode = CHIRP`:
- `debug[0]` — chirp excitation signal (the swept sine injected into setpoint)
- `debug[1]` — chirp response (gyro output during excitation)
- `debug[2]` — chirp state/axis indicator
- `debug[3]` — reserved

The `setpoint[]` channels contain the sum of pilot input + chirp excitation. For clean system identification, `debug[0]` should be used as the input (excitation only, no pilot contamination).

### BBL Header Detection

- `Firmware revision` contains version ≥ 4.6.0
- `debug_mode` header value = `CHIRP`
- Presence of `debug[0..3]` channels in field definitions

## Architecture

### Detection Flow

```
BBL file loaded
  → HeaderParser extracts rawHeaders
  → ChirpDetector checks:
      1. debug_mode == 'CHIRP' (from rawHeaders)
      2. firmwareRevision >= 4.6.0 (from parseFirmwareVersion)
      3. debug[] channels present in field definitions
  → Returns ChirpDetectionResult (detected, axis, frequencyRange, duration)
```

### Analysis Flow

```
Chirp detected in BBL
  → Extract chirp excitation from debug[0] (input signal)
  → Extract gyro response from gyro[] (output signal)
  → Identify active axis from debug[2] state channel
  → Segment data into per-axis chirp windows (20s each)
  → For each axis:
      → Compute H(f) = S_xy(f) / S_xx(f) via existing TransferFunctionEstimator
      → Compute coherence: γ²(f) = |S_xy(f)|² / (S_xx(f) × S_yy(f))
      → Extract metrics: bandwidth, phase margin, gain margin, DC gain
      → Compute synthetic step response via IFFT
  → Aggregate per-axis results
  → Generate PID recommendations (same PIDRecommender, higher confidence due to chirp quality)
```

### Tuning Mode Integration

Two approaches considered:

**Option A: New TuningType `'chirp'`** — separate state machine, dedicated wizard flow. Most explicit but highest implementation effort (new phases, wizard steps, E2E tests).

**Option B: Reuse Flash Tune with chirp detection** — Flash Tune already runs `analyzeTransferFunction()`. When chirp is detected in the BBL, the analysis uses `debug[0]` as input instead of `setpoint[]`, adds coherence metrics, and flags results as chirp-quality. No new tuning mode needed.

**Recommended: Option B** — Flash Tune's 2-flight flow (analysis + verification) is exactly right for chirp. The difference is the input signal quality, not the workflow. UI shows a "Chirp detected" badge when chirp data is found in the BBL.

### Key Design Decisions

1. **Input signal source**: Use `debug[0]` (chirp excitation only) as the transfer function input, NOT `setpoint[]` (which includes pilot stick input). This isolates the system response from pilot contamination.

2. **Per-axis segmentation**: Since chirp runs one axis at a time, the analysis must detect which axis is active in each time segment (via `debug[2]` state channel) and run transfer function estimation only on the matching axis data.

3. **Coherence threshold**: Compute coherence at each frequency. Frequencies with coherence < 0.8 are flagged as unreliable. If mean coherence < 0.9, warn that measurement quality is degraded (likely insufficient chirp amplitude or external disturbance).

4. **Fallback to Wiener**: If `debug_mode = CHIRP` is set in headers but chirp signal is not detected in the data (e.g., user forgot to activate chirp mode in flight), fall back to standard Wiener deconvolution on `setpoint[]`/`gyro[]` with a warning.

5. **Confidence boost**: Recommendations from chirp-quality transfer functions get a confidence boost — high coherence means the measurement is trustworthy, so PIDRecommender can use tighter thresholds and larger step sizes.

## New Types

```typescript
/** Chirp detection result from BBL headers + data */
interface ChirpDetectionResult {
  detected: boolean;
  /** Which axis was chirped (null if multi-axis or not detected) */
  activeAxis?: 'roll' | 'pitch' | 'yaw';
  /** Detected frequency sweep range [startHz, endHz] */
  frequencyRangeHz?: [number, number];
  /** Chirp duration in seconds */
  durationSec?: number;
  /** Number of chirp segments found (1 per axis activation) */
  segmentCount: number;
}

/** Per-frequency coherence for chirp quality validation */
interface CoherenceResult {
  frequencies: Float64Array;
  /** Coherence values 0-1 at each frequency */
  coherence: Float64Array;
  /** Mean coherence across analysis bandwidth */
  meanCoherence: number;
}

/** Extended transfer function result with chirp-specific data */
interface ChirpTransferFunctionResult extends TransferFunctionResult {
  chirpDetected: true;
  coherence: Record<'roll' | 'pitch' | 'yaw', CoherenceResult>;
  chirpInfo: ChirpDetectionResult;
}
```

## New / Modified Files

### New Files

| File | Purpose |
|------|---------|
| `src/main/analysis/ChirpDetector.ts` | Detect chirp mode from BBL headers + data, segment per-axis windows |
| `src/main/analysis/ChirpDetector.test.ts` | Tests for chirp detection logic |
| `src/main/analysis/CoherenceEstimator.ts` | Compute frequency-domain coherence γ²(f) |
| `src/main/analysis/CoherenceEstimator.test.ts` | Tests for coherence estimation |

### Modified Files

| File | Change |
|------|--------|
| `src/main/analysis/TransferFunctionEstimator.ts` | Accept optional `inputOverride` (debug[0] instead of setpoint), return coherence |
| `src/main/analysis/PIDAnalyzer.ts` | Add `extractViaChirp()` path, `analyzeChirp()` public method |
| `src/main/analysis/PIDRecommender.ts` | Accept `chirpQuality: boolean` flag for confidence boost |
| `src/main/analysis/headerValidation.ts` | Add `detectChirpMode(header)` using existing `parseFirmwareVersion()` |
| `src/main/ipc/handlers/analysisHandlers.ts` | Modify `ANALYSIS_RUN_TRANSFER_FUNCTION` handler to auto-detect chirp and use chirp path |
| `src/shared/types/analysis.types.ts` | Add `ChirpDetectionResult`, `CoherenceResult`, extend `AnalysisWarning.code` |
| `src/renderer/components/TuningWizard/steps/QuickAnalysisStep.tsx` | Show "Chirp detected" badge, coherence indicator |
| `src/shared/constants/flightGuide.ts` | Add chirp-specific flight guide (BF 4.6+ only) |
| `src/main/analysis/constants.ts` | Add `CHIRP_COHERENCE_THRESHOLD`, `CHIRP_MIN_SEGMENT_SECONDS` |

## Implementation Plan

### Phase 1: Detection + Analysis Core (PRs #1-2)

**PR 1: Chirp detection + coherence estimation**
1. `ChirpDetector.ts` — detect `debug_mode = CHIRP` from BBL header `rawHeaders`, identify active axis from debug[2] state channel, segment per-axis chirp windows by finding contiguous regions where chirp is active
2. `CoherenceEstimator.ts` — compute γ²(f) = |S_xy(f)|² / (S_xx(f) × S_yy(f)) using Welch's method (same windowing as TransferFunctionEstimator)
3. `headerValidation.ts` — add `detectChirpMode(header: BBLLogHeader): ChirpDetectionResult`
4. Types in `analysis.types.ts` — `ChirpDetectionResult`, `CoherenceResult`
5. Constants: `CHIRP_COHERENCE_THRESHOLD = 0.8`, `CHIRP_COHERENCE_WARN = 0.9`, `CHIRP_MIN_SEGMENT_SECONDS = 10`
6. Tests for all of the above

**PR 2: Transfer function with chirp input**
1. `TransferFunctionEstimator.ts` — add optional `inputOverride?: TimeSeries` parameter to `estimateTransferFunction()`. When provided, use this as the input signal (debug[0]) instead of setpoint. Return coherence alongside Bode result
2. `PIDAnalyzer.ts` — add `extractViaChirp()` extraction path using `ChirpDetector` + chirp-overridden TF estimation. Add `analyzeChirp()` public method
3. `analysisHandlers.ts` — modify `ANALYSIS_RUN_TRANSFER_FUNCTION` handler to auto-detect chirp: if chirp detected, use chirp path; otherwise fall back to standard Wiener
4. `PIDRecommender.ts` — accept `chirpQuality?: boolean`, boost confidence for chirp-quality data
5. Tests

### Phase 2: UI + Flight Guide (PRs #3-4)

**PR 3: Chirp UI indicators**
1. `QuickAnalysisStep.tsx` — "Chirp detected" badge when `transferFunction.chirpDetected` is true
2. Coherence indicator (green/amber/red based on meanCoherence vs thresholds)
3. Coherence chart component (optional — line chart showing coherence vs frequency)
4. Flight guide update: chirp-specific instructions for BF 4.6+ users

**PR 4: Flight guide + documentation**
1. `flightGuide.ts` — add chirp flight guide phase: "Enable CHIRP debug mode, arm, hover steady, activate chirp mode 3 times (roll → pitch → yaw), land"
2. `FCInfoDisplay` — show chirp-related settings when debug_mode = CHIRP
3. `bbSettingsUtils.ts` — validate chirp settings (high_resolution = ON, appropriate frequency range)
4. Design doc status update, CLAUDE.md update

### Phase 3: Advanced (Future)

5. **Multi-segment stitching** — when user provides separate flights for each axis, stitch the 3 single-axis results into a complete 3-axis transfer function
6. **Plant identification** — extract open-loop plant dynamics by dividing out the known PID controller transfer function: `G_plant(f) = G_closed(f) / (G_pid(f) × (1 - G_closed(f)))`
7. **Optimal PID computation** — given measured plant dynamics, compute optimal PID gains directly via loop-shaping (target bandwidth, phase margin constraints)

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| BF chirp BBL format changes in future versions | Use `rawHeaders` for header detection, validate debug channel presence before using. Feature-gate on known BF versions |
| User flies without activating chirp mode | Fallback to standard Wiener deconvolution with warning. ChirpDetector checks actual data, not just headers |
| Per-axis sequential requires 3 activations | Clear flight guide instructions. Detect missing axes and warn |
| Chirp amplitude too low for noisy quads | Coherence metric detects this. Warn user to increase amplitude |
| `debug[0]` channel assignment changes | Validate chirp signal shape (exponential sweep pattern) before using as input |
| Pilot interference during chirp | Use `debug[0]` (pure chirp) not `setpoint[]` (chirp + pilot). Instruct pilot to hover steady |

## External References

- [BF Chirp — HackMD](https://hackmd.io/@nerdCopter/r1G2vsFQgl) — BF chirp signal generator design and CLI settings
- [pichim/bf_controller_tuning](https://github.com/pichim/bf_controller_tuning) — MATLAB scripts for chirp-based system identification
- [Plasmatree PID-Analyzer](https://github.com/Plasmatree/PID-Analyzer) — Wiener deconvolution reference (what we already implement)
- [Betaflight Source — pid.c chirp injection](https://github.com/betaflight/betaflight) — chirp added to `currentPidSetpoint`
