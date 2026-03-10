# PID Tuning Knowledge Base

> Reference document for the PID Tuning Advisor agent. Covers FPV drone tuning theory,
> Betaflight filter/PID architecture, and best practices used by PIDlab's analysis engine.

## PID Control Theory for FPV

### P-term (Proportional)
- Reacts to current error (setpoint − gyro)
- Higher P = faster response, sharper stick feel, but can cause oscillation
- Too high: high-frequency oscillation visible on bench, hot motors
- Too low: mushy/sluggish feel, slow to follow stick inputs
- Typical range: 30–100 (BF internal units)

### I-term (Integral)
- Accumulates past error over time — eliminates steady-state offset
- Higher I = better hover stability, tighter attitude hold in wind
- Too high: I-term windup → bounce-back after flips, slow wobble on hover
- Too low: drift on hover, poor wind rejection, attitude offset after maneuvers
- Typical range: 40–120
- Key metric: **steady-state error** — if gyro consistently undershoots setpoint by >3%, I is too low

### D-term (Derivative)
- Reacts to rate of change of error — dampens P oscillation
- Higher D = more damping, less overshoot, but amplifies high-frequency noise
- Too high: hot motors (noise amplification), vibration, motor desync risk
- Too low: overshoot after stick input, prop wash oscillation on descents
- Typical range: 20–70
- **Critical tradeoff**: D dampening vs noise amplification — measured by D-term effectiveness ratio

### D/P Damping Ratio
- Healthy range: 0.45–0.85 (D/P ratio)
- Below 0.45: under-damped, expect overshoot and oscillation
- Above 0.85: over-damped, sluggish response
- PIDlab validates this ratio and auto-corrects when out of range

### Feedforward
- Predicts future error from stick movement speed (derivative of setpoint)
- Improves tracking during fast moves without affecting hover stability
- `feedforward_boost`: amplifies FF on fast stick inputs (0–50, default 15)
- `feedforward_transition`: blends FF between roll/pitch and yaw (0–100)
- **Gotcha**: High FF can look like P overshoot in step response — check FF energy ratio before reducing P

## Filter Architecture (Betaflight)

### Signal Chain
```
Gyro sensor (8kHz)
  → Gyro LPF1 (static or dynamic lowpass)
  → Gyro LPF2 (static lowpass)
  → Dynamic Notch filters (1-5 notches, auto-tracking)
  → RPM Filter (motor harmonic notches, requires bidirectional DSHOT)
  → PID controller
    → D-term derivative
    → D-term LPF1 (static or dynamic lowpass)
    → D-term LPF2 (static lowpass)
  → Motor output
```

### Filter Types
- **PT1**: First-order lowpass. -3dB at cutoff, -20dB/decade rolloff. Low group delay.
- **Biquad (BiQuad LPF)**: Second-order. -6dB at cutoff, -40dB/decade. More filtering but more delay.
- **Notch**: Band-reject filter. Removes narrow frequency band. Used for motor harmonics.

### Key Filter Parameters

| Parameter | Default | What it does |
|-----------|---------|-------------|
| `gyro_lpf1_static_hz` | 250 | Main gyro lowpass cutoff |
| `gyro_lpf2_static_hz` | 500 | Second gyro lowpass cutoff |
| `dterm_lpf1_static_hz` | 150 | Main D-term lowpass cutoff |
| `dterm_lpf2_static_hz` | 150 | Second D-term lowpass cutoff |
| `dyn_notch_min_hz` | 100 | Dynamic notch minimum frequency |
| `dyn_notch_max_hz` | 600 | Dynamic notch maximum frequency |
| `dyn_notch_count` | 3 | Number of dynamic notch filters |
| `dyn_notch_q` | 300 | Dynamic notch Q factor (BF stores ×100) |
| `rpm_filter_harmonics` | 3 | Number of motor harmonics to filter |
| `rpm_filter_min_hz` | 100 | Minimum RPM filter frequency |

### Group Delay
- Every filter adds latency (group delay) between stick input and motor response
- More aggressive filtering = more delay = worse handling
- Target: total gyro chain < 2ms, D-term chain < 3ms
- If group delay warning fires, filters are too aggressive — raise cutoffs or reduce notch count

### RPM Filter
- Most effective filter — removes exact motor harmonics with minimal delay
- Requires bidirectional DSHOT (motor protocol feedback)
- Each motor × N harmonics = 4×N individual notch filters
- When RPM filter is active, other filters can be more relaxed (higher cutoffs)
- PIDlab detects RPM filter presence and widens safety bounds accordingly

## Noise Analysis

### Noise Sources (Frequency Bands)
| Source | Frequency | Characteristics |
|--------|-----------|----------------|
| **Prop wash** | 20–90 Hz | Appears during descents/deceleration, broadband |
| **Frame resonance** | 80–200 Hz | Fixed frequency, visible at all throttle levels |
| **Motor noise** | 150–400 Hz | Tracks with throttle (RPM), harmonic pattern |
| **Electrical noise** | >500 Hz | High frequency, often from ESC switching |
| **Bearing noise** | Variable | Broadband, gets worse with worn bearings |

### Noise Floor
- Background noise level across the spectrum (in dB)
- Measured per axis (roll, pitch, yaw)
- Lower = cleaner quad = can use less aggressive filters
- Typical healthy: -30 to -20 dB
- Problematic: above -15 dB

### Peak Detection
- Prominent peaks above noise floor indicate specific noise sources
- Peak frequency + throttle correlation → identifies source
- Fixed frequency peaks = frame/prop resonance
- Throttle-tracking peaks = motor harmonics

### Throttle Spectrogram
- FFT computed per throttle band (10 bands, 0–100%)
- Reveals how noise changes with throttle
- Motor harmonics appear as lines sweeping upward with throttle
- Frame resonance appears as vertical line (constant frequency)

## Step Response Analysis

### What Good Looks Like
- **Rise time**: 20–50ms (how fast gyro reaches setpoint)
- **Overshoot**: 5–15% (brief peak above setpoint)
- **Settling time**: 50–150ms (time to stay within ±5% of setpoint)
- **Ringing**: < 2 oscillations after initial overshoot
- **Latency**: < 20ms (delay before response starts)

### Problem Signatures
| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| High overshoot (>20%) | P too high or D too low | Reduce P or increase D |
| Slow rise time (>80ms) | P too low | Increase P |
| Long settling (>200ms) | D too low, poor damping | Increase D |
| Excessive ringing | D too low for the P level | Increase D, check D/P ratio |
| Steady-state offset | I too low | Increase I |
| Bounce-back after flips | I too high (windup) | Reduce I |
| Asymmetric response | Mechanical issue (bent prop, loose motor) | Check hardware |

### Prop Wash
- Oscillation during descents (quad flies through own turbulence)
- Appears as 20–90 Hz noise burst after throttle-down events
- Severity: mild (<3× noise floor) to severe (>5× noise floor)
- Primary fix: increase D-term (dampens oscillation)
- Secondary: adjust `iterm_relax` or flying style
- PIDlab measures prop wash severity per axis and factors it into D recommendations

## Transfer Function Analysis (Wiener Deconvolution)

### Concept
- Computes how the quad's control system transforms stick inputs into actual movement
- H(f) = S_xy(f) / (S_xx(f) + ε) where S_xy = cross-spectral density, S_xx = input power spectrum
- Works from any flight data (no dedicated maneuvers needed)
- Equivalent to Plasmatree PID-Analyzer approach

### Key Metrics
- **Bandwidth (-3dB)**: Frequency where response drops to 70.7% — higher = more responsive
- **Phase margin**: Phase difference from -180° at gain crossover — higher = more stable
- **DC gain**: Response at 0 Hz — should be ~0 dB (1:1 tracking)
- **Gain margin**: How much gain could increase before instability

### Interpretation
| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| Bandwidth | >30 Hz | 15–30 Hz | <15 Hz |
| Phase margin | >45° | 30–45° | <30° |
| DC gain | -0.5 to 0.5 dB | -1 to -0.5 dB | < -1 dB |

### Synthetic Step Response
- IFFT of transfer function → impulse response → cumulative sum → step response
- Allows step response estimation from any flight without dedicated stick snaps
- Less accurate than direct step measurement but works universally

## Quad Archetypes & Typical Values

### 5" Freestyle (650g, 2400KV, 4S)
- P: 45–65, I: 80–100, D: 35–55
- Gyro LPF1: 200–300 Hz, D-term LPF1: 120–170 Hz
- Goal: balanced response, good prop wash handling, moderate filtering

### 5" Race (400g, 2600KV, 6S)
- P: 50–80, I: 70–90, D: 30–50
- Gyro LPF1: 250–400 Hz (cleaner builds), D-term LPF1: 140–200 Hz
- Goal: maximum response, minimal filtering, low latency

### 3" Cinewhoop (300g, 3600KV, 4S)
- P: 55–85, I: 85–110, D: 40–65
- Gyro LPF1: 180–250 Hz, D-term LPF1: 100–150 Hz
- Goal: smooth video, good prop wash management, more filtering OK

### 7" Long Range (800g, 1700KV, 6S)
- P: 35–55, I: 70–90, D: 25–40
- Gyro LPF1: 150–250 Hz, D-term LPF1: 100–140 Hz
- Goal: efficiency, gentle response, cruise stability

### Tiny Whoop (25g, 19000KV, 1S)
- P: 70–120, I: 80–110, D: 50–80
- Gyro LPF1: 200–350 Hz, D-term LPF1: 130–180 Hz
- Goal: aggressive for the size, high P needed for low-authority motors

## Tuning Workflow Best Practices

### Order of Operations
1. **Always filters first, then PIDs** — PIDs can't work properly if noise is getting through
2. **Start with hover analysis** — stable throttle reveals noise spectrum cleanly
3. **Then test with stick inputs** — step response needs deliberate stick movements
4. **Iterate if needed** — one round usually sufficient, verify with a check flight

### Red Flags (Hardware, Not Software)
- Asymmetric noise between axes → bent prop, loose motor mount
- Very high noise floor on one axis only → damaged gyro or mounting issue
- Noise that doesn't respond to filter changes → mechanical resonance (needs physical fix)
- Sudden noise change between flights → prop damage, loose screw, bearing wear

### When NOT to Tune
- After a crash (check hardware first)
- With damaged props (noise data meaningless)
- On a brand new build (fly 5-10 packs first for break-in)
- In very windy conditions (wind adds noise that isn't representative)

### Convergence
- Good tuning should converge: each iteration improves or maintains quality
- If metrics oscillate between sessions → possible mechanical issue or edge case
- PIDlab's quality score trend chart reveals convergence/divergence patterns

## PIDlab-Specific Analysis Rules

### Filter Recommendations
- Noise-floor-based targeting: measure actual noise, set cutoffs to attenuate it
- Propwash floor: never push gyro LPF1 below 100 Hz (preserves low-frequency control)
- Bypass threshold: if noise is extremely low (<-15 dB), can bypass gyro LPF1 entirely
- RPM filter awareness: with RPM active, allow higher cutoffs (less delay)
- Safety bounds enforced on all recommendations

### PID Recommendations
- Flight-PID-anchored: reads current PIDs from BBL header, recommends deltas (not absolutes)
- Proportional severity: D changes of +5/+10/+15 based on overshoot severity
- D-term effectiveness gating: won't increase D if effectiveness ratio < 0.3 (noise too high)
- Prop wash integration: severe prop wash boosts D-increase confidence
- I-term rules: based on steady-state error with flight-style thresholds
- Damping ratio validation: auto-corrects if D/P ratio falls outside 0.45–0.85

### Data Quality Scoring
- 0–100 score rated before generating recommendations
- Sub-scores: segment count, hover time, throttle coverage, step count, axis coverage
- Poor data quality → confidence downgrade on all recommendations
- Quality warnings shown in UI (few_segments, short_hover_time, etc.)

### Flight Quality Score
- Composite 0–100 after tuning session completes
- Components vary by mode:
  - Deep Tune: noise floor, tracking RMS, overshoot, settling time
  - Flash Tune: noise floor, overshoot, phase margin, bandwidth
- Trend chart shows improvement across sessions
- Target: score should increase or stabilize with each tuning iteration
