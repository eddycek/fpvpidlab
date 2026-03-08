# Prop Wash Detection & D-Term Effectiveness Diagnostics

> **Status**: Active (PRs #155, #160 — backend analysis complete, UI + history pending)

Diagnostic features inspired by FPVtune's AI-based analysis pipeline. Both analysis modules are implemented and integrated into PIDAnalyzer. UI visualization and tuning history integration remain as future work.

---

## Context

FPVtune (fpvtune.com) is a cloud-based neural-network PID tuning tool that extracts 28 features from blackbox logs, including prop wash oscillation detection and D-term noise-to-effectiveness ratio. These two features are diagnostically valuable independent of any ML approach and can be implemented as deterministic analysis modules within our existing pipeline.

**References**:
- [FPVtune — DEV Community](https://dev.to/fpvtune/i-built-an-auto-pid-tuning-tool-for-betaflight-heres-how-it-works-under-the-hood-okg)
- [Oscar Liang — Prop Wash](https://oscarliang.com/propwash-oscillation/)

---

## Feature 1: Prop Wash Event Detection

### Problem

Prop wash oscillation is the most common flight quality complaint in FPV. It manifests as low-frequency oscillation (30–80 Hz) during throttle-down events (descents, flip recoveries, sharp deceleration). The current pipeline has no ability to detect, quantify, or track prop wash behavior across tuning sessions.

The existing `SegmentSelector` actively **excludes** turbulent segments (acro maneuvers, descents) to find clean hover data for FFT analysis. This means prop wash events are systematically discarded from analysis.

### Solution

Add a `PropWashDetector` module that specifically targets throttle-down events and measures oscillation characteristics in the 30–80 Hz band.

### Detection Algorithm

1. **Throttle-down event detection**: Identify moments where throttle drops rapidly (derivative < threshold, e.g., -200 units/s sustained for >50ms)
2. **Post-event window**: Extract gyro data in a 200–500ms window after each throttle-down event
3. **Band-pass analysis**: Compute PSD in the 30–80 Hz prop wash band for each event window
4. **Severity scoring**: Compare prop wash band energy to baseline hover noise floor
   - Ratio < 2× baseline → minimal prop wash
   - Ratio 2–5× → moderate
   - Ratio > 5× → severe
5. **Per-axis breakdown**: Report prop wash severity per axis (roll/pitch typically worst)

### Outputs

```typescript
interface PropWashEvent {
  timestampMs: number;
  throttleDropRate: number;       // units/s
  durationMs: number;             // oscillation duration
  peakFrequencyHz: number;        // dominant oscillation frequency
  severityRatio: number;          // prop wash band energy / baseline
  axisEnergy: { roll: number; pitch: number; yaw: number };
}

interface PropWashAnalysis {
  events: PropWashEvent[];
  meanSeverity: number;           // average across all events
  worstAxis: 'roll' | 'pitch' | 'yaw';
  dominantFrequencyHz: number;    // most common peak frequency
  recommendation: string;         // human-readable guidance
}
```

### Integration Points

- **PIDAnalyzer**: Run `PropWashDetector` alongside existing `StepDetector` on the same flight data. No dedicated flight required — prop wash events occur naturally in any freestyle/acro flight.
- **PIDRecommender**: When prop wash is severe, factor into D-gain and I-term recommendations:
  - Severe prop wash + low D → suggest D increase
  - Severe prop wash + high D → mechanical issue or filter problem (D already maxed)
  - Prop wash concentrated on one axis → possible asymmetric issue
- **UI**: Prop wash severity pill in PIDAnalysisStep and AnalysisOverview. Event timeline visualization (optional future work).
- **Tuning History**: Compact `propWashSeverity: number` in `PIDMetricsSummary` for trend tracking across sessions.

### Data Requirements

- Requires flight data with throttle-down events (any freestyle/acro flight naturally contains these)
- Minimum: 3+ prop wash events for statistical reliability
- Does NOT require dedicated stick-snap flight (unlike current PID analysis)

### New Files

- `src/main/analysis/PropWashDetector.ts` — event detection + severity scoring
- `src/main/analysis/PropWashDetector.test.ts`

### Modified Files

- `src/main/analysis/PIDAnalyzer.ts` — orchestrate PropWashDetector
- `src/main/analysis/PIDRecommender.ts` — prop wash-aware D/I recommendations
- `src/shared/types/analysis.types.ts` — `PropWashEvent`, `PropWashAnalysis` types
- `src/shared/types/tuning-history.types.ts` — `propWashSeverity` in PIDMetricsSummary

---

## Feature 2: D-Term Noise-to-Effectiveness Ratio

### Problem

D-gain is the most sensitive PID parameter — too low and the quad overshoots/oscillates, too high and motors overheat from amplified noise. The current pipeline recommends D changes based solely on overshoot percentage from step response analysis. It has no measure of the noise cost of the current D-gain setting.

Pilots often struggle with the D-gain tradeoff: "My quad overshoots, should I increase D?" vs "My motors are hot, should I decrease D?" Without measuring both sides of this tradeoff, recommendations may push D higher when the real problem is noise (needing better filters) rather than insufficient damping.

### Solution

Compute a **D-term effectiveness ratio** that quantifies how much useful damping D provides relative to the noise it injects into motor outputs.

### Computation

1. **D-term noise energy**: Compute PSD of `D-term output` signal from blackbox (field `axisD[0-2]`) in the noise band (>150 Hz). This represents D amplifying gyro noise.
2. **D-term effectiveness energy**: Compute PSD of `D-term output` in the functional band (20–150 Hz). This represents D providing useful damping during maneuvers.
3. **Effectiveness ratio**: `functional_energy / noise_energy`
   - Ratio > 3.0 → D is mostly useful, safe to increase if needed
   - Ratio 1.0–3.0 → balanced, D is working but generating significant noise
   - Ratio < 1.0 → D is mostly amplifying noise, reduce D or improve filtering first

### Per-Axis Analysis

Compute ratio independently per axis. Common patterns:
- **Yaw D low ratio**: Normal — yaw has less D authority and more noise from motor asymmetry
- **Roll/Pitch asymmetric ratio**: May indicate damaged prop/motor or asymmetric frame flex
- **All axes low ratio**: Filter configuration insufficient — recommend filter tuning before PID adjustment

### Integration with PID Recommendations

Current `PIDRecommender` Rule 1 (overshoot → increase D):
```
IF overshoot > threshold AND D < max → increase D
```

Enhanced with effectiveness ratio:
```
IF overshoot > threshold AND D < max:
  IF dterm_ratio > 1.5 → increase D (D headroom exists)
  IF dterm_ratio < 1.0 → recommend filter improvement instead
  IF dterm_ratio 1.0–1.5 → increase D cautiously, warn about noise cost
```

This prevents the common failure mode: blindly increasing D when noise is the real problem, leading to hot motors and no improvement.

### Outputs

```typescript
interface DTermEffectiveness {
  axis: 'roll' | 'pitch' | 'yaw';
  noiseEnergy: number;            // PSD energy > 150 Hz
  functionalEnergy: number;       // PSD energy 20-150 Hz
  effectivenessRatio: number;     // functional / noise
  rating: 'efficient' | 'balanced' | 'noisy';
}

interface DTermDiagnostics {
  perAxis: DTermEffectiveness[];
  overallRatio: number;           // weighted average
  recommendation: string;         // "D-term is efficient, safe to increase" or "Reduce D or improve filters"
}
```

### Data Requirements

- Requires blackbox logging with `axisD[0-2]` fields (standard in BF 4.3+ with `debug_mode = GYRO_SCALED` or default debug)
- Works with any flight data (hover, freestyle, racing) — no dedicated flight needed
- Minimum ~2s of active flight data

### New Files

- `src/main/analysis/DTermAnalyzer.ts` — D-term PSD computation + ratio scoring
- `src/main/analysis/DTermAnalyzer.test.ts`

### Modified Files

- `src/main/analysis/PIDAnalyzer.ts` — orchestrate DTermAnalyzer
- `src/main/analysis/PIDRecommender.ts` — ratio-gated D recommendations
- `src/shared/types/analysis.types.ts` — `DTermEffectiveness`, `DTermDiagnostics` types
- `src/shared/types/tuning-history.types.ts` — `dtermEffectiveness` in PIDMetricsSummary

---

## Combined UI Presentation

Both features produce diagnostic data that fits naturally into the existing PID analysis UI:

### PIDAnalysisStep / AnalysisOverview

- **Prop wash section**: Severity pill (green/amber/red) + event count + dominant frequency
- **D-term effectiveness section**: Per-axis ratio bars (visual) + overall rating pill
- Both collapsible, similar to existing noise details and step response sections

### TuningHistoryPanel

- Prop wash severity trend across sessions (line in QualityTrendChart)
- D-term ratio trend (shows if filter tuning improved D headroom)

### Recommendations

Both features feed into existing `PIDRecommender` observations:
- "Prop wash moderate (3.2×) at 52 Hz — consider increasing D-gain on roll/pitch"
- "D-term mostly amplifying noise (ratio 0.7) — improve filter configuration before increasing D"

---

## Implementation Order

1. **D-Term Effectiveness Ratio** — simpler to implement (pure frequency-domain, no event detection), immediately useful for gating D recommendations
2. **Prop Wash Detection** — requires event detection logic, more complex but adds unique diagnostic capability

### Estimated Scope

| Feature | New files | Modified files | Tests |
|---------|-----------|---------------|-------|
| D-Term Effectiveness | 2 | 4 | ~15-20 |
| Prop Wash Detection | 2 | 4 | ~20-25 |

---

## Risk Assessment

- **D-term fields availability**: `axisD` fields require specific debug modes or logging configuration. Need to validate availability across BF versions and detect when fields are missing (graceful degradation).
- **Prop wash detection sensitivity**: Threshold tuning needed to distinguish prop wash from normal flight turbulence. False positives (labeling normal flight as prop wash) are worse than false negatives (missing mild prop wash).
- **No replacement for mechanical fixes**: Both features can diagnose problems but cannot fix mechanical issues (loose props, frame flex, unbalanced motors). Recommendations must clearly distinguish software-fixable issues from hardware problems.
