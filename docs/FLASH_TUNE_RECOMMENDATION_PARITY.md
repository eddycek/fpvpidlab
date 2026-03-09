# Flash Tune Recommendation Parity

> **Status**: Proposed

## Problem Statement

Flash Tune (Wiener deconvolution) currently produces significantly weaker PID recommendations than Deep Tune (step response analysis). The gap is not caused by mathematical limitations — the same flight data contains sufficient information for most analyses — but by incomplete integration during the initial Flash Tune implementation.

### Current State

| Analysis Module | Deep Tune | Flash Tune | Data Available? |
|----------------|-----------|------------|-----------------|
| FilterRecommender | Full | Full (identical) | Yes |
| PropWash detection | Full | **Missing** | **Yes** — throttle + gyro |
| D-term effectiveness | Full (3-tier gating) | **Missing** | **Yes** — gyro + pidD |
| Cross-axis coupling | Full | Missing | No — needs step events |
| Feedforward energy ratio | Full | Missing | No — needs step-local pidP/pidF |
| Feedforward context (headers) | Full | Partial (extracted, no FF recs) | **Yes** — raw headers |
| I-term rules | Full (steady-state error) | **Missing** | Partial — see Task 6 |
| Ringing detection | Full | Missing | No — needs individual steps |
| Damping ratio validation | Full | Full (identical) | Yes |
| Data quality scoring | Step-count based | Wiener-specific (exists) | Yes |
| Response vs throttle | N/A | **Missing** | **Yes** — throttle + TF |
| Quality score components | 4-5 (Noise, Tracking, OS, Settling, Delta) | 2-3 (Noise, OS, Delta) | Improvable |
| Confidence ceiling | HIGH | Capped at MEDIUM | Reviewable |

### Why It Matters

1. Flash Tune may recommend D increases on noisy quads (no D-term gating)
2. Flash Tune ignores prop wash — a common real-world issue
3. Quality score is structurally lower for Flash Tune (fewer components → less resolution)
4. Users choosing Flash Tune for convenience get meaningfully worse advice

## Reference: Plasmatree PID-Analyzer

Plasmatree is a **diagnostic/visualization tool** — it does NOT generate automatic recommendations. It displays:
- Step response via Wiener deconvolution (same math as our Flash Tune)
- Response vs throttle heatmap (we don't have this yet)
- Noise spectrum heatmap by throttle band

Our Flash Tune extends Plasmatree's technique by **extracting metrics and generating automatic recommendations**. This design doc brings those recommendations to parity with Deep Tune.

## Implementation Plan

### Task 1: Integrate PropWash + D-term Effectiveness into Flash Tune

**Files**: `src/main/analysis/PIDAnalyzer.ts`

In `analyzeTransferFunction()` (lines 275-398), add the missing analysis calls before `recommendPID()`:

```typescript
// Add before recommendPID() call (line 331):
const propWash = analyzePropWash(flightData);
const dTermEffectiveness = analyzeDTermEffectiveness(flightData);

// Update recommendPID() call to pass them:
const rawRecommendations = recommendPID(
  profiles.roll, profiles.pitch, profiles.yaw,
  currentPIDs, flightPIDs, feedforwardContext, flightStyle,
  { roll: tfResult.metrics.roll, pitch: tfResult.metrics.pitch, yaw: tfResult.metrics.yaw },
  dTermEffectiveness,  // NEW
  propWash             // NEW
);
```

Also include in the return object:
```typescript
...(propWash ? { propWash } : {}),
...(dTermEffectiveness ? { dTermEffectiveness } : {}),
```

**Impact**: Immediately enables D-term effectiveness 3-tier gating and prop wash confidence boosting for Flash Tune. No changes needed in PIDRecommender — it already supports these parameters.

**Tests**:
- Unit test: `PIDAnalyzer.test.ts` — new test case `analyzeTransferFunction passes propWash and dTermEffectiveness to recommendPID`
- Unit test: verify returned result includes `propWash` and `dTermEffectiveness` fields
- Existing `PIDRecommender.test.ts` tests already cover the gating logic

### Task 2: Feedforward Recommendations for Flash Tune

**Files**: `src/main/analysis/PIDAnalyzer.ts`, `src/main/analysis/FeedforwardAnalyzer.ts`

Currently `analyzeTransferFunction()` extracts `feedforwardContext` from headers but doesn't call `recommendFeedforward()`. The FF analyzer has two paths:
- Energy-ratio based (needs step responses) — not available for TF
- Header-based heuristics (FF boost too high, FF transition too aggressive) — **available**

Add after `recommendPID()`:
```typescript
// Header-based FF recommendations (no step data needed)
const ffRecommendations = recommendFeedforward(null, feedforwardContext);
rawRecommendations.push(...ffRecommendations);
```

Review `recommendFeedforward()` to ensure it gracefully handles `null` feedforward analysis (only apply header-based rules).

**Tests**:
- Unit test: `PIDAnalyzer.test.ts` — verify FF recommendations appear in TF result when FF headers indicate issues
- Unit test: `FeedforwardAnalyzer.test.ts` — verify `recommendFeedforward(null, context)` returns header-based recs only

### Task 3: Response vs Throttle (Per-Band Transfer Function)

**Files**: New `src/main/analysis/ThrottleTFAnalyzer.ts`, update `TransferFunctionEstimator.ts`

Inspired by Plasmatree's response-vs-throttle visualization. Bins flight data by throttle level and estimates TF per band. Reveals TPA tuning problems.

**Algorithm**:
1. Reuse `ThrottleSpectrogramAnalyzer.binByThrottle()` logic to segment data into 5-10 throttle bands
2. Per band with sufficient data (>= 2048 samples ≈ 0.5s at 4kHz):
   - Run `estimateTransferFunction()` on band's setpoint/gyro slice
   - Extract: bandwidth, overshoot, phase margin
3. Compute variance of metrics across bands
4. Flag: high variance = TPA misconfiguration or throttle-dependent instability

**Output type**:
```typescript
interface ThrottleTFResult {
  bands: ThrottleTFBand[];
  bandsWithData: number;
  metricsVariance: {
    bandwidthHz: number;     // std dev across bands
    overshootPercent: number;
    phaseMarginDeg: number;
  };
  tpaWarning?: string;  // If variance exceeds threshold
}

interface ThrottleTFBand {
  throttleMin: number;
  throttleMax: number;
  sampleCount: number;
  metrics?: TransferFunctionMetrics;  // null if insufficient data
}
```

**Integration**: Call from `analyzeTransferFunction()` after main TF estimation. Include in result. Optional — gracefully skipped if throttle data insufficient.

**Tests**:
- Unit test: `ThrottleTFAnalyzer.test.ts` — test binning, per-band TF, variance calculation
- Unit test: test with uniform response (low variance) vs throttle-dependent response (high variance)
- Unit test: test graceful skip when insufficient throttle coverage

### Task 4: Unified Quality Score — Add TF Components

**Files**: `src/shared/utils/tuneQualityScore.ts`

Current Flash Tune scores use only 2-3 components (Noise Floor, Overshoot, optional Noise Delta). Deep Tune uses 4-5. This structural imbalance makes Flash scores less granular.

**Add new components sourced from TF metrics**:

```typescript
// New component: Phase Margin (stability indicator)
{
  label: 'Phase Margin',
  getValue: (_f, _p, _v, tf) => {
    if (!tf) return undefined;
    return (tf.roll.phaseMarginDeg + tf.pitch.phaseMarginDeg + tf.yaw.phaseMarginDeg) / 3;
  },
  best: 60,   // 60° = very stable
  worst: 20,  // 20° = near instability
},

// New component: Bandwidth (responsiveness indicator)
{
  label: 'Bandwidth',
  getValue: (_f, _p, _v, tf) => {
    if (!tf) return undefined;
    return (tf.roll.bandwidthHz + tf.pitch.bandwidthHz + tf.yaw.bandwidthHz) / 3;
  },
  best: 80,   // 80 Hz = fast response
  worst: 20,  // 20 Hz = sluggish
},
```

**Result**: Flash Tune scores use 4-5 components (Noise Floor, Overshoot, Phase Margin, Bandwidth, optional Noise Delta) — matching Deep Tune's granularity with TF-native metrics instead of step-response metrics.

**Scoring parity across mixed history**:
- Deep Tune: Noise Floor (from filter flight) + Tracking RMS + Overshoot + Settling Time + [Noise Delta]
- Flash Tune: Noise Floor (from same flight) + Overshoot (TF) + Phase Margin + Bandwidth + [Noise Delta]
- Both modes produce 4-5 component scores on a 0-100 scale
- `QualityTrendChart` already handles mixed types — no chart changes needed
- Component breakdown tooltip will naturally show different component names per session type

**Tests**:
- Unit test: `tuneQualityScore.test.ts` — test Flash Tune with new TF components
- Unit test: verify component count parity (4-5 for both types)
- Unit test: verify mixed-type history produces valid trend data

### Task 5: Reassess Confidence Cap

**Files**: `src/main/analysis/PIDAnalyzer.ts` (lines 346-350)

Currently all Flash Tune recommendations are capped at MEDIUM:
```typescript
const recommendations = rawRecommendations.map((r) => ({
  ...r,
  confidence: r.confidence === 'high' ? ('medium' as const) : r.confidence,
}));
```

**With Tasks 1-3 complete**, this blanket cap is too conservative because:
- D-term effectiveness gating validates D recommendations independently
- PropWash detection provides real flight evidence
- Phase margin from TF is a rigorous stability metric

**New approach**: Conditional cap based on data quality + gating:
```typescript
// Only cap to medium if no supporting evidence exists
const recommendations = rawRecommendations.map((r) => {
  // If D-term effectiveness or propWash validated this rec → allow HIGH
  if (r.confidence === 'high' && r.supportedByGating) return r;
  // Otherwise cap synthetic-only recs at medium
  return {
    ...r,
    confidence: r.confidence === 'high' ? ('medium' as const) : r.confidence,
  };
});
```

This requires adding a `supportedByGating?: boolean` flag in `PIDRecommender` when `applyDTermEffectiveness()` or `applyPropWashContext()` boost a recommendation.

**Tests**:
- Unit test: verify high confidence when D-term effectiveness confirms D increase
- Unit test: verify medium cap when no gating evidence
- Unit test: verify prop wash boost allows high confidence

### Task 6: I-Term Approximation from Transfer Function

**Files**: `src/main/analysis/TransferFunctionEstimator.ts`, `src/main/analysis/PIDRecommender.ts`

Deep Tune I-term rules use `meanSteadyStateError` from step responses. For TF, we can approximate this from the DC gain characteristic:

- **DC gain < 1.0** (magnitude[0] < 0 dB): System doesn't fully track setpoint → I-term too low
- **DC gain ≈ 1.0** (magnitude[0] ≈ 0 dB): Good I-term tracking
- **Low-frequency roll-off**: If gain drops below -1 dB before 2 Hz → I-term insufficient

Add to `TransferFunctionMetrics`:
```typescript
/** DC gain in dB — 0 dB = perfect tracking */
dcGainDb: number;
/** Steady-state tracking quality derived from DC gain (0 = perfect, 1 = poor) */
steadyStateProxy: number;
```

In `PIDRecommender`, when `tfMetrics` is used and I-term rules are evaluated:
```typescript
// If TF shows DC gain deficit → approximate steady-state error
if (tfMetrics && tfMetrics[axis]?.dcGainDb < -1.0) {
  // Map DC gain deficit to approximate steady-state error percentage
  const approxSSE = Math.abs(tfMetrics[axis].dcGainDb) * 2; // rough mapping
  // Apply I-term increase rule
}
```

**Tests**:
- Unit test: `TransferFunctionEstimator.test.ts` — verify DC gain extraction
- Unit test: `PIDRecommender.test.ts` — verify I-term rec from TF DC gain deficit

### Task 7: Update Demo Data Generator

**Files**: `src/main/demo/DemoDataGenerator.ts`, `src/main/demo/DemoDataGenerator.test.ts`

The demo BBL generators must produce data that exercises the new analysis paths.

**Changes to `generateFlashDemoBBL(cycle)`**:
1. **PropWash injection**: Already present in filter demo BBL but missing from flash demo. Add 3-4 throttle punch-down events with decaying 45 Hz oscillation (copy pattern from `generateFilterDemoBBL`)
2. **Throttle variation**: Ensure sufficient throttle range for per-band TF analysis (current broadband setpoint uses fixed throttle — add throttle ramps between setpoint segments)
3. **D-term data**: Ensure `pidD` channels are generated with realistic values so `analyzeDTermEffectiveness` produces meaningful results

**Changes to `generateFlashVerificationDemoBBL(cycle)`**:
1. Same prop wash + throttle variation updates
2. Lower prop wash severity (post-tune improvement simulation)

**Verify progression**:
- Cycle 0: High prop wash severity, low D-term effectiveness, wide TF bandwidth variance across throttle
- Cycle 4: Low prop wash severity, high D-term effectiveness, stable TF across throttle bands

**Tests**:
- Update existing `DemoDataGenerator.test.ts` — verify flash BBL includes throttle variation and prop wash events
- Verify `analyzePropWash()` produces non-null results on flash demo data
- Verify `analyzeDTermEffectiveness()` produces non-null results on flash demo data

### Task 8: Update Tuning History Types and Archival

**Files**: `src/shared/types/tuning-history.types.ts`, `src/main/storage/TuningHistoryManager.ts`, `src/shared/utils/metricsExtract.ts`

Add new fields to `TransferFunctionMetricsSummary`:
```typescript
interface TransferFunctionMetricsSummary {
  // ... existing per-axis metrics ...

  // NEW: Per-band TF summary (from Task 3)
  throttleBands?: {
    bandsWithData: number;
    metricsVariance: {
      bandwidthHz: number;
      overshootPercent: number;
      phaseMarginDeg: number;
    };
    tpaWarning?: string;
  };

  // NEW: DC gain for I-term proxy (from Task 6)
  dcGain?: { roll: number; pitch: number; yaw: number };
}
```

Update `extractTransferFunctionSummary()` in `metricsExtract.ts` to capture the new fields when archiving.

**Backward compatibility**: All new fields are optional — existing history records parse without issue.

**Tests**:
- Unit test: `metricsExtract.test.ts` — verify new fields extracted
- Unit test: verify old records without new fields still load correctly

### Task 9: Update E2E Tests and History Generator

**Files**: `e2e/demo-quick-tune-cycle.spec.ts`, `e2e/demo-generate-history.spec.ts`

**E2E Quick Tune cycle** (`demo-quick-tune-cycle.spec.ts`):
- No flow changes expected (prop wash + D-term are automatic, no new UI steps)
- Add assertion: after analysis, check that prop wash info appears in wizard (if UI shows it)
- Add assertion: verify quality score badge appears with reasonable value

**E2E History Generator** (`demo-generate-history.spec.ts`):
- No flow changes expected
- After generating mixed sessions, verify:
  - `QualityTrendChart` renders (already checked via quality badge)
  - Flash Tune sessions show comparable score range to Deep Tune sessions
  - Mixed history trend chart has data points for all 5 sessions

**Regression check**: Run full E2E suite after implementation to ensure no flow breakage.

### Task 10: Update Documentation

**Files to update**:

1. **CLAUDE.md**:
   - Update PIDAnalyzer section: add prop wash + D-term for Flash Tune
   - Update TransferFunctionEstimator section: add per-band TF, DC gain
   - Update Quality Score section: add Phase Margin + Bandwidth components
   - Update Flash Tune confidence section: conditional cap

2. **ARCHITECTURE.md**:
   - Update analysis module descriptions
   - Update test counts

3. **TESTING.md**:
   - Add new test files and counts
   - Update totals

4. **SPEC.md**:
   - Update test count and PR range

5. **README.md**:
   - Update test count if changed

6. **docs/README.md**:
   - Add this design doc to index
   - Update status when complete

7. **docs/QUICK_TUNE_WIENER_DECONVOLUTION.md**:
   - Add reference to this doc for parity improvements

## Task Dependency Graph

```
Task 1 (PropWash + D-term)  ──┐
Task 2 (FF recommendations)   ├──→ Task 5 (Confidence cap)
Task 6 (I-term from DC gain) ─┘         │
                                         ▼
Task 3 (Response vs throttle) ──→ Task 4 (Quality score) ──→ Task 8 (History types)
                                                                      │
Task 7 (Demo data) ─────────────────────────────────────────→ Task 9 (E2E tests)
                                                                      │
                                                              Task 10 (Documentation)
```

**Suggested PR sequence**:
1. **PR A**: Tasks 1 + 2 (core parity — prop wash, D-term, FF in TF pipeline)
2. **PR B**: Task 6 (I-term from DC gain)
3. **PR C**: Task 3 (response vs throttle — new analyzer)
4. **PR D**: Tasks 4 + 5 (quality score + confidence cap)
5. **PR E**: Tasks 7 + 8 (demo data + history types)
6. **PR F**: Tasks 9 + 10 (E2E + documentation)

## Risk Assessment

### Low Risk
- **Tasks 1, 2**: Adding existing function calls to existing pipeline. PIDRecommender already handles the parameters. Minimal code change.
- **Task 8**: Optional fields added to existing types. Full backward compatibility.
- **Task 10**: Documentation only.

### Medium Risk
- **Task 4**: Changing quality score components affects scoring for all future Flash Tune sessions. Old history records unaffected (already archived). Need to verify score ranges remain comparable across modes.
- **Task 5**: Lifting confidence cap requires careful validation that gating logic is robust enough. Over-confident recommendations on edge cases could cause motor overheat.
- **Task 7**: Demo data changes must still produce valid BBL that parses and analyzes correctly. Regression in demo mode would break E2E tests.

### Higher Risk
- **Task 3**: New analysis module (ThrottleTFAnalyzer). Per-band TF estimation with small data windows may produce noisy/unreliable results. Need robust minimum-data thresholds and graceful degradation.
- **Task 6**: I-term approximation from DC gain is a heuristic, not a direct measurement. Risk of incorrect I-term recommendations on quads with non-standard I-term behavior. Mitigated by conservative thresholds and low confidence.

## Success Criteria

1. Flash Tune `analyzeTransferFunction()` returns `propWash`, `dTermEffectiveness`, and FF recommendations
2. Quality score uses 4-5 components for both Deep and Flash Tune
3. Mixed Deep/Flash history produces smooth `QualityTrendChart` with comparable score ranges
4. Flash Tune recommendations can achieve HIGH confidence when supported by D-term gating or prop wash evidence
5. Per-band TF analysis detects TPA misconfiguration in demo data
6. All existing E2E tests pass without modification
7. Demo data generates exercises all new analysis paths
