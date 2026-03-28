# Preset Gap Analysis — Lessons from SupaflyFPV Betaflight Presets

> **Status**: Proposed

Gap analysis comparing FPVPIDlab recommendations against community Betaflight presets (SupaflyFPV). Identifies settings we don't currently touch but should, and validates where our data-driven approach already exceeds static presets.

---

## Context

SupaflyFPV maintains 4 official Betaflight 4.3 presets (3/4", 5", 6", 7") in the [betaflight/firmware-presets](https://github.com/betaflight/firmware-presets) repository. Each preset configures ~36 Betaflight settings across PIDs, filters, feedforward, RC link, and rates.

FPVPIDlab currently recommends ~22 settings (9 PID gains, 12 filter settings, 1 feedforward_boost). This document analyzes the gap and proposes concrete improvements.

### Source Presets Analyzed

| Preset | File |
|--------|------|
| 3/4" Freestyle | `presets/4.3/tune/SupaflyFPV_Freestyle_3_4_Inch_EasyTune.txt` |
| 5" Freestyle | `presets/4.3/tune/SupaflyFPV_Freestyle_5_Inch_EasyTune.txt` |
| 6" Freestyle | `presets/4.3/tune/SupaflyFPV_Freestyle_6_and_EasyTune.txt` |
| 7" Freestyle | `presets/4.3/tune/SupaflyFPV_Freestyle_7_Inch_EasyTune.txt` |

---

## Summary of Preset Settings vs FPVPIDlab Coverage

| Category | Preset Settings | FPVPIDlab Covers | Gap |
|----------|----------------|------------------|-----|
| PID gains (P/I/D per axis) | via simplified_tuning (7 sliders) | 9 raw PID values | Covered (we go deeper — per-axis) |
| Gyro filters (LPF1/2, dyn) | 7 settings | 7 settings | Covered |
| D-term filters (LPF1/2, dyn) | 5 settings | 5 settings | Covered |
| Dynamic notch (min/max/count/q) | 4 settings | 4 settings | Covered |
| RPM filter (harmonics/q/min/fade) | 4 settings | Read-only (detect active) | **Gap: RPM Q tuning** |
| Feedforward (averaging/smooth/jitter/boost) | 4 settings per RC link | boost only | **Gap: FF RC link tuning** |
| RC smoothing | 2 settings | Not touched | **Gap: RC smoothing** |
| Anti-gravity | 1 setting | Not touched | **Gap: Anti-gravity** |
| D-max gain | 1 setting (set to 0) | Not touched | **Gap: D-max awareness** |
| Rates | 9 settings | Not in scope | Out of scope (pilot preference) |
| DSHOT/bidir | 2 settings | Not in scope | Out of scope (hardware) |

---

## Proposed Changes

### Task 1: RC Link-Aware Feedforward Recommendations (HIGH priority)

**Problem**: Feedforward quality depends heavily on RC link type and packet rate. The SupaflyFPV presets define 5 distinct FF configurations per RC link. We currently only recommend `feedforward_boost` changes and have a basic `FeedforwardAnalyzer` that adjusts `smooth_factor` and `jitter_factor` based on step response analysis — but these recommendations are not RC-link-aware and don't cover `feedforward_averaging`.

**What presets set per RC link:**

| RC Link | ff_averaging | ff_smooth | ff_jitter | ff_boost |
|---------|-------------|-----------|-----------|----------|
| Crossfire Dynamic | OFF | 15 | 10 | 10 |
| Crossfire 50Hz | OFF | 0 | 10 | 5 |
| Crossfire 150Hz | OFF | 30 | 7 | — |
| Tracer/ELRS 250Hz | 2_POINT | 35 | 4 | 18 |
| ELRS 500Hz | 2_POINT | 65 | 3 | 18 |

**Key insight**: At 250Hz+ packet rates, `feedforward_averaging = 2_POINT` is critical. Without it, FF response is noisy. At lower rates (Crossfire), averaging must be OFF or it introduces lag.

**What we already have:**
- `FeedforwardAnalyzer.ts` — analyzes leading-edge overshoot and small-step ratio, recommends `smooth_factor` and `jitter_factor` adjustments
- `extractRCLinkRate()` — detects RC link rate from BBL headers (`rc_smoothing_input_hz` or `rcIntervalMs`)
- `FeedforwardContext` type with `rcLinkRateHz` field
- `HIGH_RC_RATE_HZ = 250` constant already used for step-size scaling

**Proposed changes:**

1. **Add RC link profile lookup table** in `src/main/analysis/constants.ts`:
   ```
   RC_LINK_PROFILES:
     ≤60 Hz:   { averaging: OFF, smoothBase: 0,  jitterBase: 10, boostBase: 5 }
     61-200 Hz: { averaging: OFF, smoothBase: 25, jitterBase: 8,  boostBase: 12 }
     201-300 Hz:{ averaging: 2_POINT, smoothBase: 35, jitterBase: 4, boostBase: 18 }
     301-500 Hz:{ averaging: 2_POINT, smoothBase: 55, jitterBase: 3, boostBase: 18 }
     501+ Hz:   { averaging: 2_POINT, smoothBase: 65, jitterBase: 3, boostBase: 18 }
   ```

2. **Extend `FeedforwardAnalyzer.recommendFeedforward()`** to:
   - Detect RC link rate from BBL headers (already implemented)
   - Look up baseline FF profile from the table above
   - Compare current FC settings against the baseline
   - Generate recommendations for `feedforward_averaging`, `feedforward_smooth_factor`, `feedforward_jitter_factor` when significantly off-target
   - Keep existing step-response-based analysis as a refinement layer on top of the baseline

3. **Add `feedforward_averaging` to writable settings** in `tuningHandlers.ts` (already supports arbitrary CLI `set` commands — just needs the recommendation to be generated)

4. **Read current `feedforward_averaging` from BBL headers** (`feedforward_averaging` header field) — add to `FeedforwardContext`

**Files to modify:**
- `src/main/analysis/constants.ts` — add `RC_LINK_PROFILES` lookup table
- `src/main/analysis/FeedforwardAnalyzer.ts` — extend `recommendFeedforward()` with RC-link-aware baseline
- `src/main/analysis/PIDRecommender.ts` — extract `feedforward_averaging` from BBL headers into `FeedforwardContext`
- `src/shared/types/analysis.types.ts` — add `averaging` field to `FeedforwardContext`
- Tests for all modified files

**Risk**: Low. Additive change — existing boost/smooth/jitter analysis remains, we layer RC-link awareness on top.

---

### Task 2: RPM Filter Q Tuning (MEDIUM priority)

**Problem**: RPM filter Q (bandwidth) affects how precisely motor noise harmonics are removed. Wider Q (lower number) catches more noise but adds phase delay. Narrower Q (higher number) is more precise but may miss spread-out harmonics. SupaflyFPV scales Q by drone size:

| Size | rpm_filter_q | Reasoning |
|------|-------------|-----------|
| 3/4" | 1000 | Small motors — narrow harmonics, tight Q sufficient |
| 5" | 1000 | Standard — narrow harmonics |
| 6" | 800 | Larger props — wider harmonic spread |
| 7" | 700 | Largest — widest harmonic spread, needs broad Q |

**What we currently do**: Detect `rpm_filter_harmonics > 0` and adjust other filter bounds accordingly. We never recommend changing RPM filter parameters themselves.

**Proposed changes:**

1. **Add RPM Q size lookup** in `src/main/analysis/constants.ts`:
   ```
   RPM_FILTER_Q_BY_SIZE:
     1-2":  1000
     3-4":  1000
     5":    1000
     6":    800
     7":    700
     10":   600
   ```

2. **Add optional RPM Q recommendation** in `FilterRecommender.ts`:
   - Only when RPM filter is active (`rpm_filter_harmonics > 0`)
   - Read current `rpm_filter_q` from FC (requires reading from BBL header or adding MSP field)
   - If current Q differs significantly from size-appropriate value (>20% difference), recommend adjustment
   - Rule ID: `F-RPM-Q`
   - Confidence: low (advisory — RPM Q is rarely the bottleneck)

3. **Add `rpm_filter_q` to `CurrentFilterSettings` type** — already partially available via MSP_FILTER_CONFIG byte 43 (currently not parsed as a named field)

**Files to modify:**
- `src/main/analysis/constants.ts` — add `RPM_FILTER_Q_BY_SIZE`
- `src/main/analysis/FilterRecommender.ts` — add RPM Q rule
- `src/shared/types/analysis.types.ts` — add `rpm_filter_q` to `CurrentFilterSettings`
- `src/main/msp/MSPClient.ts` — parse `rpm_filter_q` from MSP_FILTER_CONFIG (if not already)
- Tests for modified files

**Risk**: Low. Advisory-only recommendation with low confidence. Won't disrupt existing filter pipeline.

---

### Task 3: Anti-Gravity Gain Recommendation (MEDIUM priority)

**Problem**: `anti_gravity_gain` controls how much the I-term is boosted during rapid throttle changes (punchouts, dives). BF default is 3500, but SupaflyFPV and most tuners recommend 5000 for freestyle. Low anti-gravity → poor attitude hold during aggressive throttle changes.

**What we currently do**: Nothing. We don't read, analyze, or recommend anti-gravity settings.

**Detection opportunity**: In PID analysis, we already measure `steadyStateErrorPercent` per step. If we correlate high steady-state error with throttle activity during the step window, we can detect cases where anti-gravity would help.

**Proposed changes:**

1. **Read `anti_gravity_gain` from BBL header** in `extractFeedforwardContext()` or a new extraction function. BBL header key: `anti_gravity_gain`.

2. **Add simple rule in PIDRecommender** (or a new utility):
   - If `anti_gravity_gain < 5000` AND mean steady-state error is above threshold on multiple axes: recommend increasing to 5000
   - Rule ID: `P-AG`
   - Confidence: medium
   - Informational advisory text explaining what anti-gravity does

3. **Apply via CLI** in `tuningHandlers.ts` — `set anti_gravity_gain = 5000` (same mechanism as filter settings)

**Files to modify:**
- `src/main/analysis/PIDRecommender.ts` — add anti-gravity rule
- `src/main/analysis/constants.ts` — add `ANTI_GRAVITY_RECOMMENDED` = 5000
- `src/shared/types/analysis.types.ts` — add `antiGravityGain` to relevant context type
- Tests for modified files

**Risk**: Very low. Single advisory recommendation. Only triggers when error data supports it.

---

### Task 4: D-Max Gain Awareness (LOW priority)

**Problem**: Betaflight's `simplified_dmax_gain` (or raw `d_min_*` / `d_max_*` settings) controls adaptive D-gain. When active, D varies between d_min (calm flight) and d_max (aggressive maneuvers). SupaflyFPV sets `dmax_gain = 0` (disabling adaptive D) for predictable feel.

**What we currently do**: We detect d_min from BBL headers and add advisory notes to D recommendations (`applyDMinAdvisory`). But we don't:
- Detect `dmax_gain` value from simplified tuning
- Warn when D-max is active and may interfere with our D recommendations
- Suggest disabling D-max for more predictable tuning convergence

**Proposed changes:**

1. **Extract `simplified_dmax_gain` from BBL header** (if available) or detect from d_min vs d_max relationship:
   - When `d_min_roll > 0` AND `d_min_roll < pid_roll_d`, D-max is effectively active
   - Already partially covered by `DMinContext`

2. **Extend existing `applyDMinAdvisory()`** to include a note about D-max implications:
   - When D-max is active, our D-increase recommendation targets d_max
   - Low-throttle maneuvers will still use d_min (lower effective D)
   - Suggest considering `simplified_dmax_gain = 0` for consistent D behavior across all throttle levels

3. **Add informational recommendation** when D-max is active:
   - Rule ID: `P-DMAX-INFO`
   - Confidence: low (informational only)
   - Setting: `simplified_dmax_gain`
   - Recommended value: 0
   - Only emit once (not per-axis)

**Files to modify:**
- `src/main/analysis/PIDRecommender.ts` — extend `applyDMinAdvisory()`, add D-max informational rule
- `src/main/analysis/constants.ts` — add constant if needed
- Tests for modified files

**Risk**: Very low. Informational-only recommendation. No functional change to existing D-term logic.

---

### Task 5: RC Smoothing Factor Advisory (LOW priority)

**Problem**: SupaflyFPV sets `rc_smoothing_auto_factor = 45` (BF default = 50) across all presets. Lower value = smoother stick input but slightly more latency. This is a minor optimization but shows up in every preset.

**What we currently do**: Nothing. We don't read or recommend RC smoothing settings.

**Proposed change:**

1. **Read `rc_smoothing_auto_factor` from BBL header** (if available)
2. **Include as part of Task 1** (RC link FF recommendations) — when recommending FF settings for a specific RC link profile, also suggest `rc_smoothing_auto_factor = 45` if currently at default 50
3. Low confidence, informational advisory

**Files to modify:**
- Same files as Task 1 (bundled together)

**Risk**: Negligible. Informational advisory only.

---

## What We Already Do Better Than Presets

These areas require no changes — our data-driven approach is fundamentally superior:

| Area | Preset Approach | FPVPIDlab Approach | Advantage |
|------|----------------|-------------------|-----------|
| **Filter cutoffs** | Fixed per size category (e.g., gyro_filter_multiplier=120 for all 5") | Noise-floor-based targets from actual FFT analysis | Adapts to specific frame/build quality |
| **PID gains** | Simplified multiplier per category | Per-axis step response / transfer function analysis | Catches asymmetric issues (e.g., loose motor mount on one arm) |
| **Dynamic notch** | Fixed range (90-800 Hz for 5") | Peak detection extends range to actual resonances | Handles unusual resonance frequencies |
| **Resonance handling** | Not addressed (hopes RPM+notch covers it) | Explicit peak detection + targeted LPF lowering | Catches frame resonances RPM filter can't handle |
| **Verification** | None — "apply and hope" | Before/after comparison with metrics | Confirms improvement or flags regression |
| **Iterative convergence** | One-shot application | Each flight refines recommendations | Approaches optimal tune over 2-3 cycles |
| **D-term effectiveness** | Not considered | 3-tier gating prevents useless D increases | Avoids adding D when noise cost > stability benefit |
| **Propwash awareness** | Not addressed | Detection + severity-aware D boost | Targets the most impactful problem for freestyle |

---

## Implementation Priority & Effort

| Task | Priority | Effort | Settings Added | Impact |
|------|----------|--------|---------------|--------|
| 1. RC Link FF Tuning | HIGH | Medium (2-3 days) | 3 (averaging, smooth, jitter) | High — biggest gap, affects stick feel directly |
| 2. RPM Filter Q | MEDIUM | Small (1 day) | 1 (rpm_filter_q) | Medium — size-appropriate Q reduces phase delay |
| 3. Anti-Gravity | MEDIUM | Small (1 day) | 1 (anti_gravity_gain) | Medium — improves throttle stability |
| 4. D-Max Awareness | LOW | Small (0.5 day) | 1 (informational only) | Low — advisory, helps user understanding |
| 5. RC Smoothing | LOW | Tiny (bundled with T1) | 1 (rc_smoothing_auto_factor) | Low — minor optimization |

**Total new settings recommended**: 7 (from current 22 to 29)

---

## Value Proposition: Presets vs FPVPIDlab

**Presets are a great starting point** — safe, fast, community-tested. They solve the "I have no idea what to set" problem.

**FPVPIDlab is the next step** — it analyzes what's actually happening on *your specific drone* and makes targeted adjustments. Two 5" freestyle drones with identical components can have very different noise profiles due to build quality, prop balance, FC mounting, bearing wear, etc.

**Ideal user workflow**: Apply preset as baseline -> Fly with blackbox logging -> Analyze in FPVPIDlab -> Apply data-driven refinements -> Verify improvement.

After implementing the tasks above, FPVPIDlab will cover every meaningful setting that presets touch (except rates and hardware config), while adding the data-driven analysis layer that presets fundamentally cannot provide.
