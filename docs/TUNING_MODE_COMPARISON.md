# Tuning Mode Comparison: Filter Tune + PID Tune vs Flash Tune

> **Status**: Active — preliminary findings from offline validation (April 2026). Awaiting real-world validation flights with current algorithms.

## Background

FPVPIDlab offers three tuning modes:

| Mode | Flights | Technique | What it tunes |
|------|---------|-----------|---------------|
| **Filter Tune** | 1 (throttle sweeps, hovers) | FFT noise analysis | Gyro/D-term LPF, dynamic notch, RPM Q |
| **PID Tune** | 1 (step inputs, maneuvers) | Step response (time domain) | P/I/D gains, FF, iterm_relax |
| **Flash Tune** | 1 (fly anything) | FFT noise + Wiener deconvolution (frequency domain) | Filters + PIDs in one shot |

The question: **Does Flash Tune produce results comparable to the dedicated 2-flight approach?**

## Preliminary Findings (April 2026)

Based on offline cross-validation using 4 real BBL logs from a VX3.5 quad (BF 4.5.2, 3.5", 4S). Tests in `src/main/analysis/OfflineTuning.pipeline.test.ts`, PRs #407 and #408.

### Caveat: Test Data Quality

These BBL logs were recorded when the algorithms were **not yet working correctly** (faulty header extraction and recommendations). The logs serve as diverse real-world input for validating the current pipeline, but:

- Applied changes between flights were based on incorrect analysis
- We **cannot** treat the 4 flights as a valid before/after tuning sequence
- Conclusions about algorithm accuracy are **preliminary** — real-world validation is needed

### Finding 1: Filter Analysis Works on Any Flight Type

Filter target values converge within **7%** regardless of whether the input is a dedicated filter flight (throttle sweeps) or a PID flight (step inputs):

| Setting | Filter flight target | PID flight target | Divergence |
|---------|---------------------|-------------------|------------|
| `dterm_lpf1_dyn_min_hz` | 150 Hz | 140 Hz | 7% |
| `dterm_lpf1_dyn_max_hz` | 300 Hz | 280 Hz | 7% |

**Conclusion**: Dedicated filter flights add no meaningful precision. Flash Tune's "fly anything" approach is sufficient for filter analysis. Noise profile from normal flying is representative enough for the FFT pipeline.

### Finding 2: PID — Step Response vs Wiener Agree on 75% of Settings

On the same flight data (LOG3, dedicated PID flight), step response and Wiener deconvolution produce overlapping PID recommendations:

| Setting | Step Response | Wiener | Agreement |
|---------|-------------|--------|-----------|
| `pid_roll_i` | agree | agree | ✓ |
| `pid_roll_p` | agree | agree | ✓ |
| `pid_yaw_i` | agree | agree | ✓ |
| `pid_pitch_p` | ↓ 42 | ↑ 52 | ✗ |

The `pid_pitch_p` disagreement reveals a fundamental tradeoff:

- **Step response** sees overshoot → recommends **lowering P** (prioritizes stability)
- **Wiener** sees low bandwidth → recommends **raising P** (prioritizes responsiveness)

Both are "correct" from their respective analytical perspectives. The difference is in what they optimize for.

### Finding 3: Wiener Provides Unique Metrics

Flash Tune (Wiener deconvolution) produces frequency-domain metrics unavailable from step response:

| Axis | Bandwidth | Phase Margin | DC Gain |
|------|-----------|-------------|---------|
| Roll | 21.5 Hz | 172.3° | -1.13 dB |
| Pitch | 10.4 Hz | 167.8° | 0.32 dB |
| Yaw | 3.3 Hz | 182.5° | -1.37 dB |

These metrics enable:
- Bandwidth-based P recommendations (TF-3 rule)
- DC gain-based I recommendations (TF-4 rule) — equivalent of steady-state error detection
- TPA diagnostics via per-throttle-band transfer functions

Step response cannot compute bandwidth or phase margin — it only sees time-domain metrics (overshoot %, rise time, settling time).

### Finding 4: Data Quality Scorer Doesn't Distinguish Flight Types

Both the dedicated filter flight and the PID flight scored **100/100** on filter data quality. The scorer currently evaluates segment count, throttle coverage, and hover time — but doesn't penalize the absence of throttle sweeps.

**Impact**: Flash Tune users may get high confidence ratings on filter recommendations even when the flight data isn't ideal for FFT analysis. This could be misleading.

**Action item**: Consider adding flight-type-aware quality sub-scores (throttle sweep detection, segment type weighting).

### Finding 5: Convergence Properties Are Solid

Both approaches converge reliably on real data:

| Property | Filter | PID |
|----------|--------|-----|
| Fixpoint reached | ≤ 3 iterations | 1 iteration |
| Oscillation | None detected | None detected |
| Determinism | Bitwise identical | Bitwise identical |

## Summary: Which Mode Is Better?

| Aspect | Filter + PID Tune | Flash Tune |
|--------|-------------------|------------|
| **Filter precision** | Same | Same |
| **PID precision (stability)** | Better — step response directly measures overshoot | Good — 75% agreement |
| **PID precision (responsiveness)** | Limited — no bandwidth metric | Better — bandwidth + phase margin |
| **Flights required** | 2 (filter + PID) | 1 |
| **Flying technique** | Throttle sweeps + step inputs | Anything |
| **Unique metrics** | Overshoot, rise time, settling | Bandwidth, phase margin, DC gain |
| **Best for** | Fine-tuning stability | Quick baseline + responsiveness insight |

**Practical recommendation for users:**
1. **Flash Tune first** — quick baseline from one flight (filters + PIDs)
2. **PID Tune second (optional)** — if the quad still overshoots, step response fine-tunes stability
3. **Filter Tune alone is not needed** — no advantage over Flash Tune for filters

## Real-World Validation Plan

The findings above are based on offline analysis of historical BBL logs recorded with faulty algorithms. To properly validate all three tuning modes, we need:

### Phase 1: Collect Fresh BBL Logs with Current Algorithms

Fly 5 flights on the **same quad, same day, same conditions**:

1. **Baseline flight** — factory/reset settings, fly normally (~60s)
2. **Filter Tune flight** — dedicated throttle sweeps, steady hovers (~60s)
3. **PID Tune flight** — dedicated step inputs, sharp maneuvers (~60s)
4. **Flash Tune flight** — normal freestyle flying (~60s)
5. **Validation flight** — fly all 4 configs back-to-back on fresh settings for subjective feel comparison

### Phase 2: Run All Three Analysis Modes

On flights 2-4, run the full analysis pipeline:

| Input | Analysis | Output |
|-------|----------|--------|
| Flight 2 (filter) | `analyzeFilters()` | Filter recs A |
| Flight 3 (PID) | `analyzePID()` | PID recs B |
| Flight 4 (flash) | `analyzeFilters()` + `analyzeTransferFunction()` | Filter recs C + PID recs D |

### Phase 3: Compare

1. **Filter recs A vs C** — same pipeline, different flight types. Expect ≤10% target divergence (confirmed by offline test).
2. **PID recs B vs D** — step response vs Wiener. Document agreement rate, direction conflicts, and magnitude differences.
3. **Apply each set of recommendations** and fly validation flights to subjectively assess:
   - Which approach produced better "feel"?
   - Did the pid_pitch_p disagreement matter in practice?
   - Is Wiener's bandwidth-based P recommendation too aggressive or just right?

### Phase 4: Update Tests

- Add the fresh BBL logs as new test fixtures (replace or supplement current ones)
- Update cross-validation tests with expected ranges from real tuning data
- Tighten data quality scorer to distinguish flight types
- Document final conclusions in this file

### Success Criteria

- Filter recs from Flash Tune match Filter Tune targets within 10%
- PID recs from Flash Tune agree with PID Tune on ≥80% of settings
- Validation flights confirm subjective improvement from all three modes
- Data quality scorer reliably distinguishes dedicated vs casual flights

## References

- **Offline validation tests**: `src/main/analysis/OfflineTuning.pipeline.test.ts` (44 tests)
- **Wiener deconvolution design**: `docs/complete/QUICK_TUNE_WIENER_DECONVOLUTION.md`
- **Plasmatree PID-Analyzer**: Inspiration for TF approach (handles PIDs only, not filters)
- **PID tuning knowledge base**: `docs/PID_TUNING_KNOWLEDGE.md`
- **PRs**: #407 (offline validation), #408 (cross-validation)
