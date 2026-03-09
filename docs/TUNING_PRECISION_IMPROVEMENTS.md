# Tuning Precision Improvements

> **Status**: Active (PRs #119–#120, #137, #146–#152, #156–#160 — 15/15 implemented)

Research-based analysis of techniques to improve tuning recommendation accuracy. Prioritized by impact and implementation effort.

---

## Context

The current tuning pipeline uses:
- **Filter tuning**: FFT (Welch's method, Hanning window) on hover segments, prominence-based peak detection, absolute noise-based filter cutoff targets
- **PID tuning**: Time-domain step detection from stick snaps, per-step overshoot/rise-time/settling metrics, heuristic P/D recommendations with proportional severity-based step sizing
- **FF tuning**: `feedforward_boost` reduction when FF-dominated overshoot detected

This document catalogs improvements that would make recommendations more precise and robust.

---

## High Priority

### 1. ✅ Wiener Deconvolution (Transfer Function Estimation) — PRs #146–#152

**Problem**: Current PID analysis requires dedicated stick-snap flights and depends on step detection quality. General freestyle/race flights produce no PID recommendations.

**Solution**: Compute the system transfer function from any flight data using Wiener deconvolution:

```
H(f) = FFT(gyro) * conj(FFT(setpoint)) / (|FFT(setpoint)|^2 + noise_regularization)
```

This produces a Bode plot (magnitude + phase vs frequency) from which bandwidth, gain margin, and phase margin can be derived. IFFT of H(f) produces a synthetic step response averaged over the entire flight.

**Approach**: Additive layer, not replacement. Existing StepDetector/StepMetrics remain for per-step visualization and FF contribution detection. PIDRecommender gains frequency-domain inputs (bandwidth, margins) alongside time-domain metrics (overshoot %).

**Key design decisions**:
- Window size: 2s Hanning (Plasmatree PID-Analyzer uses this)
- Response length: 0.5s from 1.5s windowed region
- Regularization: noise-floor-based Wiener parameter
- Works with stick-snap flights (cross-validation with step metrics) AND general flights (standalone)

**New files**:
- `src/main/analysis/TransferFunctionEstimator.ts` — Wiener deconvolution, H(f) computation
- `src/renderer/components/TuningWizard/charts/BodePlot.tsx` — Bode magnitude/phase chart

**Modified files**:
- `src/main/analysis/PIDAnalyzer.ts` — orchestrate both methods
- `src/main/analysis/PIDRecommender.ts` — accept frequency-domain metrics
- `src/shared/types/analysis.types.ts` — new types for transfer function results

**References**:
- [Plasmatree PID-Analyzer](https://github.com/Plasmatree/PID-Analyzer)
- [GetFPV: Tuning with Plasmatree](https://www.getfpv.com/learn/fpv-essentials/tuning-your-fpv-drone-with-plasmatree-pid-analyzer/)

---

### 2. ✅ Throttle-Indexed Spectrogram — `ThrottleSpectrogramAnalyzer.ts`

**Problem**: Current FFT analysis produces a single averaged spectrum across hover segments. Noise characteristics change significantly with throttle level (motor RPM scaling), but this information is lost in the average.

**Solution**: Compute FFT per throttle bin (e.g., 10% increments) and present as a 2D throttle x frequency spectrogram. This reveals:
- Motor harmonic tracking (diagonal lines in spectrogram) even without RPM telemetry
- Throttle ranges with worst noise (target filter recommendations per range)
- Frame resonance (horizontal lines, constant frequency regardless of throttle)
- Electrical noise (vertical lines at fixed frequencies >500 Hz)

**Implementation**:
- Bin gyro data by throttle level (e.g., 10 bins: 0-10%, 10-20%, ..., 90-100%)
- Compute PSD per bin using existing `FFTCompute`
- Render as heatmap (frequency x throttle, color = magnitude dB)
- Optionally recommend dynamic lowpass (throttle-ramped cutoff) when noise is significantly throttle-dependent

**References**:
- [PIDtoolbox PTthrSpec](https://github.com/bw1129/PIDtoolbox) — Gaussian-smoothed throttle spectrograms
- [BlackBox Mate noise analysis](https://pitronic.gitbook.io/bbm/advance-topics/noise-analysis) — noise source patterns

---

### 3. Proportional PID Adjustment Scaling — ✅ Implemented (PR #137)

**Problem**: PIDRecommender used fixed +/-5 step for P and D regardless of metric severity. A quad with 50% overshoot got the same D increase as one with 20% overshoot. This made convergence slow for badly-tuned quads.

**Solution**: D step scales with overshoot severity (ratio of measured overshoot to threshold):
- Severity 1–2×: D +5 (baseline, consistent with FPVSIM guidance)
- Severity 2–4×: D +10, P -5
- Severity > 4×: D +15, P -10

P reduction now triggers at severity > 2× OR when D ≥ 60% of max (was D-only gating before). All changes clamped to safety bounds (P: 20–120, D: 15–80). Convergence property preserved.

**Modified files**:
- `src/main/analysis/PIDRecommender.ts` — severity-based step scaling in Rule 1

---

### 4. Data Quality Scoring — ✅ Implemented (PR #119)

**Problem**: Analysis quality depends on flight data quality, but the app doesn't validate this. Bad stick snaps, insufficient throttle coverage, or short flights produce unreliable recommendations with no warning.

**Solution**: Compute a quality score (0-100) before analysis and report specific issues. Tier mapping: 80-100 excellent, 60-79 good, 40-59 fair, 0-39 poor. Confidence adjustment: fair→downgrade high to medium; poor→downgrade high to medium + medium to low.

**Filter analysis quality** (4 weighted sub-scores):
- Segment count (0.20 weight): 3+ segments → 100, 0 → 0
- Total hover time (0.35 weight): 5s+ → 100, <0.5s → 0
- Throttle coverage (0.25 weight): 40%+ range → 100, <10% → 0
- Segment type (0.20 weight): Sweep segments → 100, fallback → 40

**PID analysis quality** (4 weighted sub-scores):
- Step count (0.30 weight): 15+ steps → 100, 0 → 0
- Axis coverage (0.30 weight): 3 axes with 3+ steps each → 100, 0 axes → 0
- Magnitude variety (0.20 weight): coefficient of variation scoring
- Hold quality (0.20 weight): mean hold duration vs threshold

**Warnings**: `few_segments`, `short_hover_time`, `narrow_throttle_coverage`, `few_steps_per_axis`, `missing_axis_coverage`, `low_step_magnitude`

**UI**: Quality pill (colored by tier) displayed in FilterAnalysisStep, PIDAnalysisStep, and AnalysisOverview. Existing warning UI renders quality warnings automatically.

**Files**:
- `src/main/analysis/DataQualityScorer.ts` — scoring module (22 tests)
- `src/main/analysis/FilterAnalyzer.ts` — integrated scoring + confidence adjustment
- `src/main/analysis/PIDAnalyzer.ts` — integrated scoring + confidence adjustment
- `src/shared/types/analysis.types.ts` — `DataQualityScore`, `DataQualitySubScore` types, extended warning codes
- `src/shared/types/tuning-history.types.ts` — compact `dataQuality` in history records
- `src/shared/utils/metricsExtract.ts` — quality score propagation to history
- UI: quality pill in 3 components + 4 CSS classes

---

### 5. ✅ Propwash-Aware Filter Targeting — `FilterRecommender.ts`, `constants.ts`

**Problem**: Current `FilterRecommender` uses a linear noise-floor-to-cutoff mapping. This can push gyro LPF1 below 100 Hz, killing propwash handling — the frequency range (50-100 Hz) where D-term must be responsive for flip/roll recovery.

**Solution**: Add a propwash floor to filter recommendations:

```typescript
// Never recommend gyro LPF1 below propwash floor unless noise is extreme
const PROPWASH_FLOOR_HZ = 100;
const recommendedCutoff = Math.max(noiseDerivedCutoff, PROPWASH_FLOOR_HZ);
// If noise requires going below 100 Hz, flag it as a mechanical issue
```

Also consider flight style: aggressive/race needs higher propwash floor (~120 Hz) vs smooth/cinematic can tolerate lower (~80 Hz).

**Modified files**:
- `src/main/analysis/FilterRecommender.ts` — propwash floor logic
- `src/main/analysis/constants.ts` — propwash floor per flight style

---

### 6. ✅ Extended Feedforward Tuning — `FeedforwardAnalyzer.ts`

**Problem**: Current FF tuning only adjusts `feedforward_boost`. Other FF parameters (`ff_smooth_factor`, `feedforward_jitter_factor`) significantly affect response quality but are ignored.

**Solution**: Extend FF analysis:

- **`ff_smooth_factor`**: When overshoot is concentrated on the leading edge of steps (initial spike, not settling oscillation), recommend increasing smooth factor instead of reducing boost. Detect by comparing overshoot at t=0-20ms vs t=20-100ms after step onset.
- **`feedforward_jitter_factor`**: When small-magnitude steps (<30% stick) show more FF overshoot than large steps, recommend increasing jitter factor. It selectively attenuates FF during slow movements.
- **RC link rate**: Extract RC interval from BBL headers. High-speed links (250 Hz+) benefit from stronger smoothing (50-75). Report detected rate and recommend accordingly.

**Modified files**:
- `src/main/analysis/StepMetrics.ts` — leading-edge vs settling overshoot separation
- `src/main/analysis/PIDRecommender.ts` — smooth_factor and jitter_factor recommendations
- `src/shared/types/analysis.types.ts` — new FF metric fields

---

## Medium Priority

### 7. Chirp Flight Analysis (BF 4.6+)

**Problem**: Step response and even Wiener deconvolution work with whatever stick inputs happen during a flight. A purpose-built excitation signal would give much more precise system identification.

**Solution**: BF 2025.12 added a built-in **chirp signal generator** — a swept-frequency oscillation injected into one axis at a time. This produces ideal data for frequency response estimation.

**Implementation**:
- Detect chirp mode from BBL headers or by identifying swept-sine pattern in setpoint
- Extract chirp input/output signals
- Compute transfer function via cross-spectral density: `H(f) = Sxy(f) / Sxx(f)`
- Present Bode magnitude/phase plot with bandwidth, gain margin, phase margin
- Compute optimal PID gains directly from measured plant dynamics

**References**:
- [BF Chirp - HackMD](https://hackmd.io/@nerdCopter/r1G2vsFQgl)
- [pichim/bf_controller_tuning](https://github.com/pichim/bf_controller_tuning)

---

### 8. ✅ Filter Group Delay Estimation — `GroupDelayEstimator.ts`

**Problem**: Users don't see the latency cost of their filter configuration. More filtering = less noise but more delay, worse propwash handling.

**Solution**: Compute total group delay of the active filter chain (gyro LPF1 + LPF2 + dynamic notch + RPM notches) at key frequency points (50, 100, 200 Hz). Present as:
- "Filter latency at propwash (80 Hz): 2.3 ms" with good/warning/bad indicators
- Compare before/after when recommending filter changes

---

### 9. ✅ Cross-Axis Coupling Detection — `CrossAxisDetector.ts`

**Problem**: Tuning axes independently assumes they're decoupled. In practice, roll inputs can produce pitch responses (and vice versa) due to asymmetric mass distribution, flex, or gyro mounting angle.

**Solution**: During step analysis, measure response on non-commanded axes. If a roll step produces >10% of its magnitude on pitch, flag cross-axis coupling and recommend addressing mechanical issues before fine-tuning PIDs.

---

### 10. ✅ Flight Quality Score — `tuneQualityScore.ts`

**Problem**: No holistic metric to track tuning progress across sessions. Flash Tune (Wiener deconvolution) produces no step response data, making scores incomparable with Deep Tune.

**Solution**: Compute a 0-100 "tune quality score" with unified overshoot scoring, redistributed evenly among available components:

**Deep Tune components** (4 components, step response data):
- Noise floor level (filter quality)
- Tracking error RMS (overall quality)
- Mean overshoot from step response (PID quality)
- Mean settling time (PID quality)

**Flash Tune components** (2 components, transfer function data):
- Noise floor level (filter quality)
- Overshoot from TF synthetic step response (PID quality)

**Optional 5th component** (when verification flight present): Noise Delta (before/after improvement)

Display as trend chart in TuningHistoryPanel across tuning sessions. Both tuning types use unified overshoot scoring for comparable 0-100 scores.

---

### 11. ✅ Multi-Flight Bayesian Optimization (Framework) — `BayesianPIDOptimizer.ts`

**Problem**: Single-flight heuristic recommendations may not converge to optimal gains. Each flight gives one data point, but the optimization landscape is complex.

**Solution**: Across multiple tuning sessions, build a Gaussian Process model mapping PID gains to performance metrics. Use Bayesian optimization (Expected Improvement acquisition function) to suggest the next set of gains that maximizes expected improvement.

**Prerequisites**: Requires tuning history with consistent metrics (already available via TuningHistoryManager).

**References**:
- [Multi-Objective PID Optimization (arXiv)](https://arxiv.org/html/2509.17423v1)
- [Adaptive PID Autotuner (arXiv)](https://arxiv.org/abs/2109.12797)

---

## Lower Priority

### 12. ✅ Slider-Aligned Recommendations — `SliderMapper.ts`

Map PID recommendations to Betaflight Configurator's slider positions (master multiplier, PD ratio) instead of raw values. More intuitive for users familiar with the configurator UI.

### 13. ✅ Mechanical Health Diagnostic — `MechanicalHealthChecker.ts`

Before PID tuning, check for extreme noise floor (>-20 dB), asymmetric per-axis noise (bent prop/damaged motor), or abnormal motor output variance. Flag mechanical issues and recommend inspection before tuning.

### 14. ✅ Dynamic Lowpass Recommendation — `DynamicLowpassRecommender.ts`

When throttle spectrogram shows noise significantly increasing with throttle, recommend dynamic lowpass (throttle-ramped cutoff) instead of static. Lower latency at low throttle, more filtering at high throttle.

### 15. ✅ Wind/Disturbance Detection — `WindDisturbanceDetector.ts`

Analyze gyro variance during steady hover to estimate wind level. High variance = lower confidence in recommendations. Report: "High disturbance detected — consider retesting in calmer conditions."

---

## Implementation Order

Recommended sequence based on dependencies and incremental value:

1. **#3 Proportional scaling** + **#4 Data quality scoring** — low effort, immediate accuracy improvement
2. **#5 Propwash-aware filtering** + **#6 Extended FF** — low effort, better filter/FF recommendations
3. **#1 Wiener deconvolution** — medium effort, biggest qualitative leap (works with any flight)
4. **#2 Throttle spectrogram** — medium effort, rich diagnostic data
5. **#7 Chirp analysis** — high effort, most precise (requires BF 4.6+)
6. **#8-11** — incrementally as needed

## External References

- [Plasmatree PID-Analyzer](https://github.com/Plasmatree/PID-Analyzer) — Wiener deconvolution reference implementation
- [PIDtoolbox](https://github.com/bw1129/PIDtoolbox) — MATLAB-based analysis (throttle spectrograms, LOESS smoothing)
- [BlackBox Mate](https://pitronic.gitbook.io/bbm/advance-topics/noise-analysis) — noise source patterns, PSD normalization
- [pichim/bf_controller_tuning](https://github.com/pichim/bf_controller_tuning) — BF 4.6 chirp analysis tools
- [BF 4.6 Chirp HackMD](https://hackmd.io/@nerdCopter/r1G2vsFQgl) — chirp implementation details
- [Oscar Liang tuning guide](https://oscarliang.com/fpv-drone-tuning/) — community best practices
- [BF Filtering Wiki](https://github.com/betaflight/betaflight/wiki/Gyro-&-Dterm-filtering-recommendations) — filter strategy
- [Adaptive PID Autotuner (arXiv:2109.12797)](https://arxiv.org/abs/2109.12797) — single-flight adaptive tuning
- [Multi-Objective PID Optimization (arXiv)](https://arxiv.org/html/2509.17423v1) — Bayesian optimization for PID
- [Black-Box System ID for Quadrotor (arXiv:2308.00723)](https://arxiv.org/pdf/2308.00723) — ARX/state-space identification
