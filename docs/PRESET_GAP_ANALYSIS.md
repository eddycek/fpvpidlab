# Preset Gap Analysis — Community Presets vs FPVPIDlab

> **Status**: Active (Tasks 1-2 complete PRs #314-#316, Tasks 6-7 complete)

Gap analysis comparing FPVPIDlab recommendations against community Betaflight presets (SupaflyFPV, UAV Tech, Karate/sugarK, QuadMcFly, ctzsnooze, AOS/Chris Rosser). Identifies settings we don't currently recommend but should, ordered by implementation feasibility.

---

## Context

Community preset authors maintain tuning profiles for BF 4.5+ across multiple drone sizes. Each preset configures 30-40 settings across PIDs, filters, feedforward, RC link, motor output, and rates.

FPVPIDlab currently recommends ~22 settings (9 PID gains, 12 filter settings, 1 feedforward_boost). This document identifies gaps and proposes concrete implementation tasks.

For detailed community preset values, see `docs/PID_TUNING_KNOWLEDGE.md`:
- Section 1 → RC Link-Aware FF Profiles table
- Section 2 → RPM Filter Q and Weights table
- Section 9 → Quad Archetypes with D-max notes
- Section 10 → TPA, Anti-Gravity, Thrust Linearization, PID Sum Limits, D-term LPF Dynamic Expo

### Source Presets Analyzed

| Author | Sizes | BF Version |
|--------|-------|------------|
| SupaflyFPV | 3/4", 5", 6", 7" | 4.5 |
| UAV Tech | Whoop, 5" FS, 5" Race, 7" LR | 4.5 |
| Karate/sugarK | 5" Race | 4.5 |
| QuadMcFly | 5" FS | 4.5 |
| ctzsnooze | 5" General | 4.5 |
| AOS/Chris Rosser | 5" Race | 4.5 |

---

## Gap Analysis Table

| Setting(s) | Category | Current Coverage | Gap Type | Priority |
|------------|----------|-----------------|----------|----------|
| `feedforward_averaging`, `feedforward_smooth_factor`, `feedforward_jitter_factor` | Feedforward | boost only, basic smooth/jitter | RC-link-aware profiles | HIGH |
| `iterm_relax_cutoff` | PID | Not touched | Flight-style-aware recommendation | HIGH |
| `anti_gravity_gain` | PID | Not touched | Size/weight-based advisory | MEDIUM |
| `rpm_filter_q`, `rpm_filter_weights` | Filters | Read-only (detect active) | Size-based Q tuning | MEDIUM |
| `thrust_linear` | Motor | Not touched | Size-based recommendation | MEDIUM |
| `simplified_dmax_gain` | PID | Advisory only (d_min context) | Disable recommendation | MEDIUM |
| `tpa_mode`, `tpa_rate`, `tpa_breakpoint` | PID | Not touched | Size/noise-aware advisory | LOW |
| `tpa_low_always`, `tpa_low_breakpoint` | PID | Not touched | SupaflyFPV pattern advisory | LOW |
| `dyn_idle_min_rpm` | Motor | Not touched | Size-based advisory | LOW |
| `rc_smoothing_auto_factor` | RC | Not touched | Flight-style advisory | LOW |
| `dterm_lpf1_dyn_expo` | Filters | Not touched | Race build advisory | LOW |
| `pidsum_limit`, `pidsum_limit_yaw` | PID | Not touched | Power headroom advisory | LOW |
| `feedforward_max_rate_limit` | Feedforward | Not touched | Race build advisory | LOW |

---

## Implementation Tasks (ordered by priority)

### Task 1: RC Link-Aware Feedforward Recommendations

- **What**: Recommend `feedforward_averaging`, `feedforward_smooth_factor`, `feedforward_jitter_factor` based on detected RC link rate. See KB Section 1 for the full RC link profile table.
- **Detection**: RC link rate from BBL header (`rc_smoothing_input_hz` or `rcIntervalMs`). Already extracted via `extractRCLinkRate()`. Current `feedforward_averaging` from BBL header field.
- **Logic**:
  - Look up baseline FF profile from RC link rate bands (≤60, 61-150, 151-249, 250-499, ≥500 Hz)
  - Compare current FC settings against baseline
  - Generate recommendations when significantly off-target (>30% deviation or wrong averaging mode)
  - Keep existing step-response-based analysis as refinement layer on top of baseline
  - Bundle `rc_smoothing_auto_factor` advisory (45 if currently at default 30)
- **Files to modify**:
  - `src/main/analysis/constants.ts` — add `RC_LINK_PROFILES` lookup table
  - `src/main/analysis/FeedforwardAnalyzer.ts` — extend `recommendFeedforward()` with RC-link-aware baseline
  - `src/main/analysis/PIDRecommender.ts` — extract `feedforward_averaging` from BBL headers into `FeedforwardContext`
  - `src/shared/types/analysis.types.ts` — add `averaging` field to `FeedforwardContext`
  - Tests for all modified files
- **Effort**: Medium (2-3 days)
- **Risk**: Low — additive change, existing FF analysis remains

---

### Task 2: Flight-Style-Aware I-term Relax Cutoff

- **What**: Recommend `iterm_relax_cutoff` based on detected flight style and current value.
- **Detection**: Flight style from user profile (`profile.flightStyle`: smooth/balanced/aggressive). Current `iterm_relax_cutoff` from BBL header. Profile flight style is more reliable than inferring from step response data.
- **Logic**:
  - If `profile.flightStyle` is aggressive (race): recommend 20-30
  - If `profile.flightStyle` is balanced (freestyle): recommend 10-15 (BF default)
  - If `profile.flightStyle` is smooth (cinematic): recommend 5-10
  - Only recommend if current value is >50% away from style-appropriate range
  - Rule ID: `P-IRELAX`, confidence: medium
- **Files to modify**:
  - `src/main/analysis/PIDRecommender.ts` — add iterm_relax rule using profile flight style and BBL header value
  - `src/main/analysis/constants.ts` — add `ITERM_RELAX_CUTOFF_BY_STYLE` ranges
  - `src/shared/types/analysis.types.ts` — add `itermRelaxCutoff` to relevant context
  - Tests for modified files
- **Effort**: Medium (1-2 days)
- **Risk**: Low — informational advisory, uses profile flight style as primary source

---

### Task 3: Anti-Gravity Gain Recommendation

- **What**: Recommend `anti_gravity_gain` based on drone weight/size and detected steady-state error during throttle transitions. Uses BF 4.5 scale (0-250, default 80). See KB Section 10 for community values.
- **Detection**: Current `anti_gravity_gain` from BBL header. Steady-state error from existing PID analysis (`meanSteadyStateError`). Drone size from user profile.
- **Logic**:
  - If `anti_gravity_gain < 100` AND mean steady-state error is above threshold on multiple axes AND drone carries camera weight: recommend 110-120
  - Lightweight/race builds: keep at default 80
  - Rule ID: `P-AG`, confidence: medium
  - Apply via CLI: `set anti_gravity_gain = <value>`
- **Files to modify**:
  - `src/main/analysis/PIDRecommender.ts` — add anti-gravity rule
  - `src/main/analysis/constants.ts` — add `ANTI_GRAVITY_BY_STYLE` lookup
  - `src/shared/types/analysis.types.ts` — add `antiGravityGain` to context type
  - Tests for modified files
- **Effort**: Small (1 day)
- **Risk**: Low — single advisory recommendation, only triggers when error data supports it

---

### Task 4: RPM Filter Q Tuning

- **What**: Recommend `rpm_filter_q` (and optionally `rpm_filter_weights` on BF 4.5+) based on drone size. See KB Section 2 for the Q/weights table.
- **Detection**: RPM filter active from `rpm_filter_harmonics > 0` (already detected). Current `rpm_filter_q` from MSP_FILTER_CONFIG byte 43 (needs parsing as named field). Drone size from user profile.
- **Logic**:
  - Only when RPM filter is active
  - If current Q differs >20% from size-appropriate value, recommend adjustment
  - Rule ID: `F-RPM-Q`, confidence: low (advisory)
  - Weights recommendation only if current values are all 100 (BF default) and size > 5"
- **Files to modify**:
  - `src/main/analysis/constants.ts` — add `RPM_FILTER_Q_BY_SIZE`
  - `src/main/analysis/FilterRecommender.ts` — add RPM Q rule
  - `src/shared/types/analysis.types.ts` — add `rpm_filter_q` to `CurrentFilterSettings`
  - `src/main/msp/MSPClient.ts` — parse `rpm_filter_q` from MSP_FILTER_CONFIG
  - Tests for modified files
- **Effort**: Small (1 day)
- **Risk**: Low — advisory-only, won't disrupt existing filter pipeline

---

### Task 5: Thrust Linearization Advisory

- **What**: Recommend `thrust_linear` based on drone size. See KB Section 10 for size-based values.
- **Detection**: Current `thrust_linear` from BBL header. Drone size from user profile. ESC PWM frequency from BBL header (if available).
- **Logic**:
  - Size-based lookup: 3-4" → 40, 5" → 30, 6" → 20, 7" → 10
  - Note: ESC PWM frequency also matters — UAV Tech uses 0 for 24K PWM, 20 for 48K. Size table is for 48K (standard modern ESCs)
  - If current value is 0 (disabled) and drone is ≤5": recommend enabling
  - If current value differs >50% from size-appropriate: advisory
  - Rule ID: `P-THRUST-LIN`, confidence: low (informational)
  - Requires user to confirm drone size (from profile)
- **Files to modify**:
  - `src/main/analysis/PIDRecommender.ts` — add thrust linearization rule
  - `src/main/analysis/constants.ts` — add `THRUST_LINEAR_BY_SIZE`
  - Tests for modified files
- **Effort**: Small (0.5 day)
- **Risk**: Low — informational advisory only

---

### Task 6: D-Max Gain Awareness

- **What**: Recommend disabling `simplified_dmax_gain` for predictable tuning convergence. See KB Section 9 for per-archetype D-max notes.
- **Detection**: Already have `DMinContext` from BBL headers. Detect from d_min vs d_max relationship: when `d_min_roll > 0` AND `d_min_roll < pid_roll_d`, D-max is effectively active. Drone size from user profile.
- **Logic**:
  - For ≤5" and whoops: recommend `simplified_dmax_gain = 0` (community consensus)
  - For 7"+: informational only (mixed community opinion)
  - Extend existing `applyDMinAdvisory()` with explicit disable recommendation
  - Rule ID: `P-DMAX-INFO`, confidence: low (informational)
  - Only emit once (not per-axis)
- **Files to modify**:
  - `src/main/analysis/PIDRecommender.ts` — extend `applyDMinAdvisory()`, add D-max rule
  - `src/main/analysis/constants.ts` — add constant if needed
  - Tests for modified files
- **Effort**: Small (0.5 day)
- **Risk**: Low — informational-only, no functional change to D-term logic

---

### Task 7: Dynamic Idle Min RPM Advisory

- **What**: Recommend `dyn_idle_min_rpm` based on drone size and motor KV.
- **Detection**: Current `dyn_idle_min_rpm` from BBL header. Motor KV and size from user profile. RPM filter status (already detected).
- **Logic**:
  - If RPM filter active and `dyn_idle_min_rpm` is 0: recommend enabling (20-40 range)
  - Size-based: smaller quads (1-3") → 40-60, 5" → 20-35, 7"+ → 15-25
  - Higher KV motors benefit from higher min RPM (more prone to desync at zero throttle)
  - Rule ID: `P-DYN-IDLE`, confidence: low (advisory)
  - User must provide: nothing extra if profile has size/KV
- **Files to modify**:
  - `src/main/analysis/PIDRecommender.ts` — add dynamic idle rule
  - `src/main/analysis/constants.ts` — add `DYN_IDLE_MIN_RPM_BY_SIZE`
  - Tests for modified files
- **Effort**: Small (0.5 day)
- **Risk**: Low — advisory only

---

### Task 8: TPA Tuning Advisory

- **What**: Recommend `tpa_mode`, `tpa_rate`, `tpa_breakpoint`, and BF 4.5+ low-throttle TPA settings based on drone size and noise profile. See KB Section 10 for community values.
- **Detection**: Current TPA settings from BBL header. Noise profile from existing filter analysis (throttle-dependent noise detected by `DynamicLowpassRecommender`). Drone size from user profile.
- **Logic**:
  - If throttle-dependent noise is severe AND `tpa_mode` is D-only: suggest PD mode (SupaflyFPV pattern for 5")
  - Larger quads (6-7"): recommend higher `tpa_rate` (80) with lower breakpoint (1250)
  - If BF 4.5+ and `tpa_low_always` is OFF: advisory to enable (SupaflyFPV pattern)
  - Rule ID: `P-TPA`, confidence: low (advisory)
- **Files to modify**:
  - `src/main/analysis/PIDRecommender.ts` or new `TPAAdvisor.ts`
  - `src/main/analysis/constants.ts` — add TPA lookup tables
  - Tests for modified files
- **Effort**: Medium (1 day)
- **Risk**: Low — advisory only, no auto-apply risk

---

### Task 9: D-term LPF Dynamic Expo Advisory

- **What**: Recommend `dterm_lpf1_dyn_expo` for race builds. See KB Section 10.
- **Detection**: D-term dynamic LPF active (already detected). Flight style from step response data. Current expo from BBL header (if available).
- **Logic**:
  - Only when D-term dynamic LPF is active
  - Racing pattern detected: recommend expo 7-10 (less D filtering at high throttle)
  - Freestyle: keep default (5)
  - Rule ID: `F-DEXP`, confidence: low (advisory)
- **Files to modify**:
  - `src/main/analysis/FilterRecommender.ts` — add expo rule
  - `src/main/analysis/constants.ts` — add expo constants
  - Tests for modified files
- **Effort**: Small (0.5 day)
- **Risk**: Low — advisory only, race builds benefit most

---

### Task 10: PID Sum Limit Advisory

- **What**: Recommend increasing `pidsum_limit` and `pidsum_limit_yaw` for heavy/powerful quads. See KB Section 10.
- **Detection**: Current limits from BBL header. Drone weight from user profile. Motor saturation events detectable from motor output data (if motors hit max during analysis flight).
- **Logic**:
  - If drone weight > 800g OR motor output regularly hits limits: recommend 1000/1000
  - Default (500/400) is fine for ≤5" standard builds
  - Rule ID: `P-PIDLIM`, confidence: low (informational)
  - Only recommend when evidence of PID saturation exists
- **Files to modify**:
  - `src/main/analysis/PIDRecommender.ts` — add pidsum limit check
  - Tests for modified files
- **Effort**: Small (0.5 day)
- **Risk**: Low — informational advisory, requires evidence of saturation

---

### Task 11: Feedforward Max Rate Limit Advisory

- **What**: Recommend `feedforward_max_rate_limit` for race builds. Karate race presets set 100 (default 90), ctzsnooze/AOS use 95.
- **Detection**: Current value from BBL header. Flight style from user profile.
- **Logic**:
  - Racing (aggressive flight style): recommend 95-100
  - Freestyle/cinematic: keep default 90
  - Rule ID: `P-FF-RATELIM`, confidence: low (advisory)
- **Files to modify**:
  - `src/main/analysis/PIDRecommender.ts` — add FF rate limit rule
  - Tests for modified files
- **Effort**: Tiny (0.5 day, bundle with Task 1)
- **Risk**: Low — minor advisory

---

## Data Source Summary

| Data Source | What it provides | Available today? |
|-------------|-----------------|-----------------|
| BBL header | FF settings, RC link rate, anti_gravity_gain, iterm_relax_cutoff, d_min/d_max, dyn_idle_min_rpm, TPA settings, thrust_linear, pidsum_limit | Yes (extraction needed for some) |
| MSP_FILTER_CONFIG | rpm_filter_q (byte 43) | Partially (needs named field) |
| User profile | Drone size, weight, KV, battery | Yes |
| Filter analysis | Throttle-dependent noise, noise floor, spectrum | Yes |
| PID analysis | Step response, steady-state error, flight style | Yes |

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

## Value Proposition: Presets vs FPVPIDlab

**Presets are a great starting point** — safe, fast, community-tested. They solve the "I have no idea what to set" problem.

**FPVPIDlab is the next step** — it analyzes what's actually happening on *your specific drone* and makes targeted adjustments. Two 5" freestyle drones with identical components can have very different noise profiles due to build quality, prop balance, FC mounting, bearing wear, etc.

**Ideal user workflow**: Apply preset as baseline -> Fly with blackbox logging -> Analyze in FPVPIDlab -> Apply data-driven refinements -> Verify improvement.

After implementing the tasks above, FPVPIDlab will cover every meaningful setting that presets touch (except rates and hardware config), while adding the data-driven analysis layer that presets fundamentally cannot provide.
