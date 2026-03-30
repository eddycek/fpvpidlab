# Tuning Session Evaluation Strategy

> **Status**: Active

How FPVPIDlab evaluates tuning sessions across all modes — what metrics drive recommendations, how success is measured, and when convergence is achieved.

## Size-Aware Noise Classification

Noise floor thresholds are adjusted per drone size. Smaller quads with higher KV motors have inherently higher noise floors — classifying them with 5" standards produces false "HIGH" readings.

Classification uses strict `>` comparisons: exactly on the boundary = the lower category.

| Size | HIGH (noisy) | MEDIUM | LOW (clean) | Typical KV |
|------|-------------|--------|-------------|------------|
| 1" | > -15 dB | > -30 and ≤ -15 | ≤ -30 | 19,000+ |
| 2.5" | > -20 dB | > -35 and ≤ -20 | ≤ -35 | 4,500+ |
| 3" | > -25 dB | > -40 and ≤ -25 | ≤ -40 | 3,000-4,500 |
| 4" | > -27 dB | > -40 and ≤ -27 | ≤ -40 | 2,500-3,500 |
| 5" | > -30 dB | > -50 and ≤ -30 | ≤ -50 | 1,750-2,100 |
| 6" | > -33 dB | > -50 and ≤ -33 | ≤ -50 | 1,300-1,500 |
| 7" | > -35 dB | > -55 and ≤ -35 | ≤ -55 | 1,100-1,300 |

**Source**: PIDToolBox -30 dB standard (5" reference), scaled by KV/prop-size relationship.

**Implementation**: `NOISE_LEVEL_BY_SIZE` in `src/main/analysis/constants.ts`, consumed by `NoiseAnalyzer.categorizeNoiseLevel()`.

## Filter Tune

**Analysis metric**: Gyro noise floor (dB) per axis, classified using size-aware thresholds.

**Recommendation basis**: Absolute noise-based target cutoff via `computeNoiseBasedTarget()`. When dynamic lowpass is active, tunes `dyn_min_hz`/`dyn_max_hz` with BF 2:1 ratio. Independent of current settings → convergent.

**Verification**: Before/after throttle spectrogram comparison. Delta in dB per axis.

**Success criteria**:
- Noise floor unchanged or improved (lower dB)
- No regression on any axis > 3 dB

**Convergence signal**: Recommended changes fall within deadzone:
- HIGH/LOW noise: 5 Hz deadzone (`NOISE_TARGET_DEADZONE_HZ`)
- MEDIUM noise: 20 Hz deadzone (wider to prevent micro-adjustments)

**Known limitation**: Noise floor varies ±3-5 dB between flights due to wind, battery voltage, motor temperature, and flight style. This can cause ping-pong recommendations when the quad operates near a classification threshold boundary.

## PID Tune

**Analysis metric**: Step response — overshoot %, settling time (ms), rise time (ms), ringing count, steady-state error %.

**Recommendation basis**: Flight-PID-anchored proportional adjustments. Severity-scaled steps (D: +5/+10/+15, P: -5/-10). D/P damping ratio validation (0.45-0.85).

**Verification**: Before/after step response comparison per axis. Delta in overshoot %, settling time.

**Success criteria**:
- Overshoot ≤ style threshold (aggressive: 35%, balanced: 25%, smooth: 12%)
- Settling time ≤ style threshold (aggressive: 150ms, balanced: 200ms, smooth: 250ms)
- Ringing ≤ style threshold (aggressive: 3, balanced: 2, smooth: 1)

**Convergence signal**: P/I/D changes < minimum step size (±5). Damping ratio within healthy range.

**Advantage over Filter Tune**: Step response metrics are less sensitive to external conditions (wind doesn't significantly affect overshoot measurement from stick snaps).

## Flash Tune

**Analysis metric**: Combined filter (noise floor) + PID (transfer function via Wiener deconvolution: bandwidth Hz, phase margin °, DC gain dB).

**Recommendation basis**: Noise analysis for filters + transfer function for PIDs. Single flight provides both.

**Verification**: Before/after noise spectrum + synthetic step response from transfer function.

**Success criteria**:
- Noise: unchanged or improved
- Bandwidth: ≥ style threshold (aggressive: 60 Hz, balanced: 40 Hz, smooth: 30 Hz)
- Phase margin: ≥ 30° (stability)
- DC gain: near 0 dB (tracking accuracy)

**Convergence signal**: Both filter and PID changes below respective deadzones.

## Quality Score Components

The flight quality score (0-100) uses type-aware components:

| Mode | Components | Weight Distribution |
|------|-----------|-------------------|
| Filter Tune | Noise floor | Even across available |
| PID Tune | Tracking RMS, overshoot, settling time | Even across available |
| Flash Tune | Noise floor, overshoot (TF), phase margin, bandwidth | Even across available |

When verification data is present, a **Noise Delta** component is added (improvement/regression dB).

**Implementation**: `src/shared/utils/tuneQualityScore.ts`

## Convergence Detection

A tuning mode is considered converged when:
1. Recommended changes are all within deadzone thresholds
2. Quality score is stable across 2+ sessions (±5 points)
3. Verification shows no regression

When convergence is detected, the recommendation engine should indicate "no changes needed" rather than suggesting micro-adjustments that could destabilize the tune.
