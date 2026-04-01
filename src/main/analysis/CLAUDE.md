# Analysis Engine

Noise analysis, step response, transfer function, and data quality scoring modules.

## FFT Analysis Engine

**Pipeline**: SegmentSelector → FFTCompute → NoiseAnalyzer → FilterRecommender → FilterAnalyzer

- **SegmentSelector**: Finds stable hover segments and throttle sweep segments (excludes takeoff/landing/acro)
- **FFTCompute**: Hanning window, Welch's method (50% overlap), power spectral density
- **NoiseAnalyzer**: Noise floor estimation, peak detection (prominence-based), source classification (frame resonance 80-200 Hz, motor harmonics, electrical >500 Hz)
- **FilterRecommender**: Absolute noise-based target computation (convergent), safety bounds, propwash-aware gyro LPF1 floor (100 Hz min, bypass at -15 dB extreme noise), beginner-friendly explanations. Medium noise handling (conditional LPF2 recommendations), notch-aware resonance (notch already covering peak suppresses LPF lowering), conditional dynamic notch Q based on noise severity. Dynamic-lowpass-aware: when `dyn_min_hz > 0`, all noise-floor and resonance rules target `dyn_min_hz`/`dyn_max_hz` instead of `static_hz`, proportionally adjusting max to maintain ratio. Exports `isGyroDynamicActive()`, `isDtermDynamicActive()`
- **ThrottleSpectrogramAnalyzer**: Bins gyro data by throttle level (10 bands), per-band FFT spectra and noise floors. Returns `ThrottleSpectrogramResult`
- **GroupDelayEstimator**: Per-filter group delay estimation (PT1, biquad, notch). Returns `FilterGroupDelay` with gyroTotalMs, dtermTotalMs, warning if >2ms. Smart `dyn_notch_q` handling: `Q > 10 ? Q / 100 : Q` for BF internal storage quirk. Uses `dyn_min_hz` when dynamic lowpass is active (worst-case delay at tightest cutoff point)
- **DynamicLowpassRecommender**: Analyzes throttle spectrogram for throttle-dependent noise (≥6 dB increase, Pearson ≥0.6). When dynamic is NOT active and throttle noise detected: recommends enabling dynamic lowpass (min = current × 0.6, max = current × 1.4). When dynamic IS already active: returns no recommendations (FilterRecommender handles tuning dyn_min/max directly). When dynamic IS active but NO throttle-dependent noise: recommends disabling (dyn_min → 0) with low confidence. Rules: F-DLPF-GYRO, F-DLPF-DTERM (enable), F-DLPF-GYRO-OFF, F-DLPF-DTERM-OFF (disable)
- **FilterAnalyzer**: Orchestrator with async progress reporting. Passes both `gyro_lpf1_static_hz` and `dterm_lpf1_static_hz` to dynamic lowpass recommender. Returns throttle spectrogram + group delay in result
- IPC: `ANALYSIS_RUN_FILTER` + `EVENT_ANALYSIS_PROGRESS`
- Dependency: `fft.js`
- Constants in `constants.ts` (tunable thresholds)

## Step Response Analysis Engine

**Pipeline**: StepDetector → StepMetrics → PIDRecommender → PIDAnalyzer

- **StepDetector**: Derivative-based step input detection in setpoint data, hold/cooldown validation. Configurable window parameter (`windowMs?`)
- **StepMetrics**: Rise time, overshoot percentage, settling time, latency, ringing measurement with SNR filter (`RINGING_MIN_AMPLITUDE_FRACTION` = 5% of step magnitude excludes gyro noise from ringing count). Adaptive two-pass window sizing (`computeAdaptiveWindowMs()` — median-based, clamped 150-500ms). Steady-state error tracking (`steadyStateErrorPercent`)
- **PIDRecommender**: Flight-PID-anchored P/D/I recommendations (convergent), `extractFlightPIDs()` from BBL header, proportional severity-based steps (D: +5/+10/+15, P: -5/-10), I-term rules based on `meanSteadyStateError` with flight-style thresholds, D/P damping ratio validation (0.45-0.85 range), safety bounds (P: 20-120, D: 15-80 for 5"/15-90 for 6"/15-100 for 7", I: 40-120). **Quad-size-aware bounds**: `droneSize` parameter narrows P/D/I bounds via `QUAD_SIZE_BOUNDS` (e.g., micro quads pMin=30 prevents dangerously low P). **Severity-scaled sluggish P**: P increase scales with rise time severity (+5/+10). **P-too-high warning**: when P > 1.3× pTypical, emits informational recommendation (`informational: true`). **P-too-low warning**: when P < 0.7× pTypical, emits informational warning (important for micros). **D-term effectiveness gating**: 3-tier D-increase gating (>0.7 boost confidence, 0.3-0.7 allow+warn, <0.3 redirect to filters). **Prop wash integration**: severe prop wash (≥5×) boosts D-increase confidence or generates new D+5 recommendation on worst axis. **Propwash iterm_relax**: two-tier progressive reduction — moderate propwash (2-5×) lowers cutoff by 5 with floor 15 (PW-IRELAX-CUTOFF-MOD), severe (≥5×) lowers with floor 10 (PW-IRELAX-CUTOFF). **Rule TF-4**: DC gain deficit from transfer function → I-term increase recommendation (Flash Tune equivalent of steady-state error detection). **D-min/TPA advisory**: `extractDMinContext()` and `extractTPAContext()` from BBL headers annotate D recommendations when D-min or TPA is active. **FF boost step**: reduced from 5 to 3 for finer convergence. **VBat sag advisory** (P-VBAT-SAG): recommends `vbat_sag_compensation=75` for freestyle/cinematic when disabled
- **CrossAxisDetector**: Pearson correlation coupling detection between axis pairs. Thresholds: none (<0.15), mild (0.15-0.4), significant (≥0.4). Returns `CrossAxisCoupling`
- **PropWashDetector**: Throttle-down event detection, post-event FFT in 20-90 Hz band. Returns `PropWashAnalysis` with events, meanSeverity, worstAxis, dominantFrequencyHz. Passed to `recommendPID()` for prop wash-aware D recommendations
- **PIDAnalyzer**: Orchestrator with async progress reporting, threads `flightPIDs` through pipeline. Two-pass step detection (first 500ms, then adaptive). Passes `dTermEffectiveness`, `propWash`, `dMinContext`, and `tpaContext` to `recommendPID()` for integrated D-gain gating and advisory annotations
- IPC: `ANALYSIS_RUN_PID` + `EVENT_ANALYSIS_PROGRESS`

### Additional Analysis Modules

- **DTermAnalyzer**: D-term effectiveness via FFT energy ratio in 20-150 Hz band. Used for D-increase gating
- **FeedforwardAnalyzer**: RC-link-aware FF baseline + step-response refinement (smooth/jitter factors)
- **MechanicalHealthChecker**: Pre-tuning diagnostics — extreme noise, axis asymmetry, motor imbalance. Produces mechanical-health flags consumed by analyzers (may lower confidence or add warnings)
- **WindDisturbanceDetector**: Gyro variance analysis for environmental disturbance. Computes and attaches `windDisturbance` metric to analysis result
- **BayesianPIDOptimizer**: Lightweight Gaussian Process surrogate for iterative PID tuning across sessions
- **ThrottleTFAnalyzer**: Per-throttle-band transfer function (Wiener deconvolution) for TPA diagnostics (5 bands)
- **SliderMapper**: Maps raw PID gains to Betaflight Configurator slider UI positions
- **headerValidation**: BBL header parsing/validation utilities, field name mapping

## Transfer Function Analysis Engine

**Pipeline**: TransferFunctionEstimator (setpoint → gyro deconvolution → H(f) = S_xy(f) / S_xx(f))

- **TransferFunctionEstimator**: Cross-spectral density estimation, bandwidth/phase margin extraction, `dcGainDb` field for I-term approximation, PID recommendations based on frequency response characteristics
- Used in Flash Tune mode for combined filter + PID analysis from a single flight
- IPC: `ANALYSIS_RUN_TRANSFER_FUNCTION` + `EVENT_ANALYSIS_PROGRESS`

## Data Quality Scoring (`DataQualityScorer.ts`)

Rates flight data quality 0-100 before generating recommendations. Integrated into both FilterAnalyzer and PIDAnalyzer.

- Computes 0-100 score from weighted sub-scores (segment/step count, coverage, hold quality)
- Downgrades recommendation confidence for fair/poor data quality
- Tier mapping: 80-100 excellent, 60-79 good, 40-59 fair, 0-39 poor

## Flight Quality Score (`src/shared/utils/tuneQualityScore.ts`)

Composite 0-100 score with type-aware components (noise floor, overshoot, settling, bandwidth, phase margin). Points redistributed evenly among available components. Displayed as badge in TuningCompletionSummary and TuningHistoryPanel.
