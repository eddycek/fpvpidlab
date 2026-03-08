/**
 * Demo data generator for offline UX testing.
 *
 * Generates realistic BBL (Blackbox Log) binary data that:
 * - Parses successfully through the real BlackboxParser
 * - Produces meaningful results from FilterAnalyzer (FFT noise peaks)
 * - Produces meaningful results from PIDAnalyzer (step responses)
 *
 * Uses the same VB encoding functions as bf45-reference.ts fixture.
 *
 * IMPORTANT: iInterval must produce a sample rate matching the P interval header.
 * The parser computes sampleRateHz = 1e6 / (looptime * pInterval * pDenom).
 * With P interval:1/2 and looptime:125 → sampleRateHz = 4000 Hz → iInterval must be 2.
 * A mismatch causes StepDetector timing calculations to reject all steps.
 */

import { logger } from '../utils/logger';

// ── VB Encoding (matches bf45-reference.ts) ────────────────────────

/** Encode unsigned value as variable-byte */
function encodeUVB(value: number): number[] {
  const bytes: number[] = [];
  let v = value >>> 0;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7f);
  return bytes;
}

/** Encode signed value as zigzag VB */
function encodeSVB(value: number): number[] {
  const zigzag = (value << 1) ^ (value >> 31);
  return encodeUVB(zigzag >>> 0);
}

// ── Noise Generation ───────────────────────────────────────────────

/**
 * Generate Gaussian-distributed random noise using Box-Muller transform.
 */
function gaussianNoise(stddev: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return stddev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ── Demo BBL Builder ───────────────────────────────────────────────

interface DemoSessionConfig {
  /** Number of I-frames to generate */
  frameCount: number;
  /** Base gyro values [roll, pitch, yaw] in deg/s */
  gyroBase: [number, number, number];
  /** Noise RMS amplitude in deg/s */
  noiseAmplitude: number;
  /** Motor harmonic frequency in Hz (typically 120-200 Hz) */
  motorHarmonicHz: number;
  /** Motor harmonic amplitude in deg/s */
  motorHarmonicAmplitude: number;
  /** Electrical noise frequency in Hz (typically 500-800 Hz) */
  electricalNoiseHz: number;
  /** Electrical noise amplitude in deg/s */
  electricalNoiseAmplitude: number;
  /** Whether to inject step inputs into setpoint data (for PID analysis) */
  injectSteps: boolean;
  /** I-frame interval — must match P interval header for correct sample rate (default 2) */
  iInterval?: number;
  /** Per-axis step response parameters (overrides DEFAULT_RESPONSE_PARAMS) */
  responseParams?: [AxisResponseParams, AxisResponseParams, AxisResponseParams];
}

/** Step event for gyro response simulation */
interface StepEvent {
  startFrame: number;
  endFrame: number;
  axis: 0 | 1 | 2; // roll, pitch, yaw
  magnitude: number; // deg/s
}

/**
 * Second-order system parameters per axis for realistic step response.
 *
 * Model: G(s) = ωn² / (s² + 2ζωn·s + ωn²)
 * Step response: y(t) = 1 - (e^(-ζωnt) / √(1-ζ²)) · sin(ωd·t + φ)
 * where ωd = ωn·√(1-ζ²), φ = arccos(ζ)
 */
interface AxisResponseParams {
  /** Damping ratio (0 < ζ < 1 for underdamped) */
  zeta: number;
  /** Natural frequency in rad/s */
  wn: number;
  /** Transport + computation latency in seconds */
  latencyS: number;
}

/** Default step response parameters (used when no cycle-specific params provided) */
const DEFAULT_RESPONSE_PARAMS: [AxisResponseParams, AxisResponseParams, AxisResponseParams] = [
  { zeta: 0.48, wn: 85, latencyS: 0.012 },
  { zeta: 0.5, wn: 80, latencyS: 0.012 },
  { zeta: 0.65, wn: 50, latencyS: 0.012 },
];

/**
 * Compute cycle-dependent step response parameters.
 *
 * Progression from poorly tuned (cycle 0) to well tuned (cycle 4+):
 *   Cycle 0: ζ≈0.32, ωn≈55 → ~35% overshoot, ~230ms settling (Poor)
 *   Cycle 1: ζ≈0.53, ωn≈82 → ~14% overshoot, ~92ms settling (Fair)
 *   Cycle 2: ζ≈0.63, ωn≈96 → ~8% overshoot, ~66ms settling (Good)
 *   Cycle 3: ζ≈0.70, ωn≈105 → ~5% overshoot, ~55ms settling (Excellent)
 *   Cycle 4: ζ≈0.74, ωn≈110 → ~3% overshoot, ~49ms settling (Excellent)
 *
 * Uses inverted progressiveFactor for consistent exponential improvement curve.
 */
function computeCycleResponseParams(
  cycle: number
): [AxisResponseParams, AxisResponseParams, AxisResponseParams] {
  // t: 0 (untuned) → ~0.85 (fully optimized) via inverted progressive curve
  const t = 1 - progressiveFactor(cycle);

  const lerp = (a: number, b: number): number => a + (b - a) * t;

  // Base (cycle 0): poorly tuned — high overshoot, slow settling
  // Target (cycle 4+): optimally tuned — minimal overshoot, fast settling
  return [
    // Roll
    { zeta: lerp(0.32, 0.78), wn: lerp(55, 115), latencyS: lerp(0.016, 0.006) },
    // Pitch
    { zeta: lerp(0.34, 0.8), wn: lerp(50, 110), latencyS: lerp(0.016, 0.006) },
    // Yaw
    { zeta: lerp(0.45, 0.88), wn: lerp(32, 75), latencyS: lerp(0.016, 0.006) },
  ];
}

/**
 * Multi-phase throttle profile for realistic segment detection.
 *
 * Profile (as proportion of total duration):
 *   0-20%:  Low hover at 1350 (35%)
 *  20-50%:  Linear ramp 1350→1800 (35%→80%) — sweep segment
 *  50-70%:  High hover at 1800 (80%)
 *  70-100%: Linear ramp 1800→1350 (80%→35%) — sweep segment
 *
 * Result: 2 sweep segments + 2 hover segments = 4 segments, 45% throttle coverage.
 */
function computeThrottle(timeSec: number, durationSec: number): number {
  const t = timeSec / durationSec; // Normalized 0..1
  if (t < 0.2) {
    return 1350;
  } else if (t < 0.5) {
    // Ramp from 1350 to 1800
    const rampProgress = (t - 0.2) / 0.3;
    return 1350 + rampProgress * 450;
  } else if (t < 0.7) {
    return 1800;
  } else {
    // Ramp from 1800 to 1350
    const rampProgress = (t - 0.7) / 0.3;
    return 1800 - rampProgress * 450;
  }
}

/**
 * Build a single BBL session with realistic noise and optional step inputs.
 *
 * This generates only I-frames (no P-frames) for simplicity — the parser
 * handles I-only logs just fine, and the analysis engines work on the
 * extracted TimeSeries data regardless of frame type.
 *
 * The iInterval MUST match pDiv (pInterval * pDenom from the P interval header)
 * so that BlackboxParser.sampleRateHz equals the actual data rate.
 * Default: iInterval=2 with "P interval:1/2" → pDiv=2 → 4000 Hz.
 */
function buildDemoSession(config: DemoSessionConfig): Buffer {
  const {
    frameCount,
    gyroBase,
    noiseAmplitude,
    motorHarmonicHz,
    motorHarmonicAmplitude,
    electricalNoiseHz,
    electricalNoiseAmplitude,
    injectSteps,
    iInterval = 2,
    responseParams = DEFAULT_RESPONSE_PARAMS,
  } = config;

  const parts: Buffer[] = [];
  const looptime = 125; // µs (8 kHz)
  const sampleRateHz = 1_000_000 / (looptime * iInterval);

  // ── Headers ─────────────────────────────────────────────────────
  const headers = [
    'H Product:Blackbox flight data recorder by Nicholas Sherlock',
    'H Data version:2',
    `H I interval:${iInterval}`,
    'H P interval:1/2',
    'H Firmware type:Betaflight',
    'H Firmware revision:4.5.1',
    'H Firmware date:Jan  1 2025 00:00:00',
    `H looptime:${looptime}`,
    'H gyro_scale:0x3f800000',
    'H minthrottle:1070',
    'H maxthrottle:2000',
    'H vbatref:420',
    'H Board information:OMNIBUSF4SD',
    'H Log start datetime:2026-02-24T10:00:00.000',
    'H Craft name:DemoQuad',
    // PID settings in headers (used by extractFlightPIDs)
    'H rollPID:50,88,45',
    'H pitchPID:52,92,48',
    'H yawPID:45,90,0',
    'H feedforward_weight:120,130,80',
    'H debug_mode:GYRO_SCALED',
    'H pid_process_denom:2',
    'H blackbox_high_resolution:0',
    // RPM filter info
    'H dshot_bidir:1',
    'H rpm_filter_harmonics:3',
    'H rpm_filter_min_hz:100',
    // Dynamic notch
    'H dyn_notch_count:3',
    'H dyn_notch_q:300',
    'H dyn_notch_min_hz:100',
    'H dyn_notch_max_hz:600',
    // Field definitions
    'H Field I name:loopIteration,time,gyroADC[0],gyroADC[1],gyroADC[2],setpoint[0],setpoint[1],setpoint[2],setpoint[3]',
    'H Field I signed:0,0,1,1,1,1,1,1,1',
    'H Field I predictor:0,0,0,0,0,0,0,0,0',
    'H Field I encoding:1,1,0,0,0,0,0,0,0',
    'H Field P name:loopIteration,time,gyroADC[0],gyroADC[1],gyroADC[2],setpoint[0],setpoint[1],setpoint[2],setpoint[3]',
    'H Field P signed:0,0,1,1,1,1,1,1,1',
    'H Field P predictor:1,1,1,1,1,1,1,1,1',
    'H Field P encoding:0,0,0,0,0,0,0,0,0',
  ];
  parts.push(Buffer.from(headers.join('\n') + '\n'));

  // ── Step input schedule ─────────────────────────────────────────
  // Generate step events spread across the session for PID analysis.
  // Each step: sudden setpoint change → hold for ~400ms → return to 0.
  // 400ms hold ensures StepMetrics tail measurement (last 20% of 300ms window)
  // falls within the hold period, producing correct overshoot values.
  // 18 steps total (6 per axis) for robust PID analysis.
  const steps: StepEvent[] = [];
  if (injectSteps) {
    const holdFrames = Math.round(0.4 * sampleRateHz); // 400ms hold
    const cooldownFrames = Math.round(0.3 * sampleRateHz); // 300ms between steps (well above 100ms detector threshold)
    const stepMagnitudes = [
      200,
      -300,
      250, // roll, pitch, yaw
      -250,
      300,
      -200, // roll, pitch, yaw
      350,
      -200,
      300, // roll, pitch, yaw
      -300,
      250,
      -350, // roll, pitch, yaw
      200,
      -350,
      250, // roll, pitch, yaw
      -250,
      300,
      -200, // roll, pitch, yaw
    ];
    let nextStart = Math.round(0.5 * sampleRateHz); // Start 0.5s into the session

    for (let i = 0; i < stepMagnitudes.length && nextStart + holdFrames < frameCount - 10; i++) {
      const axis = (i % 3) as 0 | 1 | 2; // Cycle through roll, pitch, yaw
      steps.push({
        startFrame: nextStart,
        endFrame: nextStart + holdFrames,
        axis,
        magnitude: stepMagnitudes[i],
      });
      nextStart += holdFrames + cooldownFrames;
    }
  }

  // ── Frame generation ────────────────────────────────────────────
  for (let f = 0; f < frameCount; f++) {
    const frame: number[] = [0x49]; // I-frame marker

    const loopIter = f * iInterval;
    const time = loopIter * looptime; // µs
    const timeSec = time / 1_000_000;

    frame.push(...encodeUVB(loopIter));
    frame.push(...encodeUVB(time));

    // --- Gyro values: base + broadband noise + harmonic noise ---
    const gyroValues: number[] = [];
    for (let axis = 0; axis < 3; axis++) {
      let value = gyroBase[axis];

      // Broadband gyro noise (simulates natural vibration)
      value += gaussianNoise(noiseAmplitude);

      // Motor harmonic (strong peak in spectrum)
      value += motorHarmonicAmplitude * Math.sin(2 * Math.PI * motorHarmonicHz * timeSec + axis);

      // Second motor harmonic (2x frequency, lower amplitude)
      value +=
        motorHarmonicAmplitude *
        0.4 *
        Math.sin(2 * Math.PI * motorHarmonicHz * 2 * timeSec + axis * 0.5);

      // Electrical noise (high frequency)
      value +=
        electricalNoiseAmplitude * Math.sin(2 * Math.PI * electricalNoiseHz * timeSec + axis * 1.3);

      gyroValues.push(value);
    }

    // --- Simulated gyro response to step inputs ---
    // Second-order system model: y(t) = 1 - (e^(-ζωnt) / √(1-ζ²)) · sin(ωd·t + φ)
    if (injectSteps) {
      for (const step of steps) {
        const framesIn = f - step.startFrame;
        if (framesIn < 0) continue;
        // Stop contributing well after the step ends (decay is negligible)
        if (framesIn > step.endFrame - step.startFrame + Math.round(0.15 * sampleRateHz)) continue;

        const { zeta, wn, latencyS } = responseParams[step.axis];
        const latencyFrames = Math.round(latencyS * sampleRateHz);
        if (framesIn < latencyFrames) continue;

        const wd = wn * Math.sqrt(1 - zeta * zeta);
        const phi = Math.acos(zeta);
        const t = (framesIn - latencyFrames) / sampleRateHz; // seconds after latency
        const envelope = Math.exp(-zeta * wn * t) / Math.sqrt(1 - zeta * zeta);
        const response = 1 - envelope * Math.sin(wd * t + phi);

        if (f < step.endFrame) {
          // During step hold: tracking toward target via second-order dynamics
          gyroValues[step.axis] += step.magnitude * response;
        } else {
          // After step ends: decay back to 0
          const tAfterEnd = (f - step.endFrame) / sampleRateHz;
          const decayFactor = Math.exp(-tAfterEnd * 60);
          gyroValues[step.axis] += step.magnitude * decayFactor;
        }
      }
    }

    // Round gyro values after all contributions
    frame.push(...encodeSVB(Math.round(gyroValues[0])));
    frame.push(...encodeSVB(Math.round(gyroValues[1])));
    frame.push(...encodeSVB(Math.round(gyroValues[2])));

    // --- Setpoint: hover + step inputs ---
    const setpoints = [0, 0, 0]; // roll, pitch, yaw
    const activeStep = steps.find((s) => f >= s.startFrame && f < s.endFrame);
    if (activeStep) {
      setpoints[activeStep.axis] = activeStep.magnitude;
    }

    frame.push(...encodeSVB(setpoints[0])); // roll setpoint
    frame.push(...encodeSVB(setpoints[1])); // pitch setpoint
    frame.push(...encodeSVB(setpoints[2])); // yaw setpoint

    // Throttle: multi-phase profile for realistic segment detection
    const durationSec = frameCount / sampleRateHz;
    frame.push(...encodeSVB(Math.round(computeThrottle(timeSec, durationSec))));

    parts.push(Buffer.from(frame));
  }

  // ── LOG_END event ───────────────────────────────────────────────
  parts.push(Buffer.from([0x45, 0xff, ...Buffer.from('End of log\0', 'ascii')]));

  return Buffer.concat(parts);
}

// ── Progressive noise reduction ────────────────────────────────────

/**
 * Compute a progressive attenuation factor based on tuning cycle.
 *
 * 5 discrete steps from noisy baseline to fully optimized:
 *   Cycle 0 → 1.000 (untuned baseline)
 *   Cycle 1 → 0.284 (first tuning pass — big improvement)
 *   Cycle 2 → 0.088 (second pass — dramatic noise reduction)
 *   Cycle 3 → 0.035 (fine-tuning — near-optimal)
 *   Cycle 4 → 0.021 (fully optimized)
 *   Cycle 5+ → 0.015 (minimal achievable noise)
 *
 * Steep exponential decay drives quality score from "poor" (~35) through
 * "fair" → "good" → "excellent" (~85) across the 5-cycle demo progression.
 * Noise floor improves ~35 dB, settling time drops from ~300ms to ~55ms.
 */
export function progressiveFactor(cycle: number): number {
  if (cycle <= 0) return 1.0;
  if (cycle >= 5) return 0.015;
  // Steep exponential: 1.0 → 0.28 → 0.09 → 0.04 → 0.02 → 0.015
  return 0.015 + 0.985 * Math.exp(-1.3 * cycle);
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Generate a demo BBL buffer for filter analysis (pre-tuning flight).
 *
 * Contains one session with:
 * - ~10 seconds of flight data at 4000 Hz (I-frame only, iInterval=2)
 * - Noise floor dependent on cycle (high on first, lower after tuning)
 * - Motor harmonic at ~160 Hz with 2nd harmonic at ~320 Hz
 * - Electrical noise at ~600 Hz
 * - Multi-phase throttle profile for segment detection (4 segments, 45% range)
 *
 * @param cycle - Tuning cycle number (0 = first, higher = progressively cleaner)
 */
export function generateFilterDemoBBL(cycle = 0): Buffer {
  const f = progressiveFactor(cycle);
  logger.info(
    `[DEMO] Generating filter analysis demo BBL (cycle ${cycle}, factor ${f.toFixed(2)})...`
  );
  return buildDemoSession({
    frameCount: 40000, // 10s at 4000 Hz
    gyroBase: [2, -1, 0],
    noiseAmplitude: 15 * f,
    motorHarmonicHz: 160,
    motorHarmonicAmplitude: 40 * f,
    electricalNoiseHz: 600,
    electricalNoiseAmplitude: 8 * f,
    injectSteps: false,
    iInterval: 2,
  });
}

/**
 * Generate a demo BBL buffer for PID analysis (post-filter flight).
 *
 * Contains one session with:
 * - ~14 seconds of flight data at 4000 Hz (I-frame only, iInterval=2)
 * - Reduced noise floor (simulates applied filter tuning)
 * - 18 step inputs across all 3 axes (for step response detection)
 * - Cycle-dependent second-order step response model (cycle 0: ~35% overshoot → cycle 4: ~3%)
 * - Cycle-dependent latency (16ms → 6ms)
 * - 400ms step hold ensures correct overshoot measurement
 *
 * @param cycle - Tuning cycle number (0 = first, higher = progressively cleaner)
 */
export function generatePIDDemoBBL(cycle = 0): Buffer {
  const f = progressiveFactor(cycle);
  logger.info(
    `[DEMO] Generating PID analysis demo BBL (cycle ${cycle}, factor ${f.toFixed(2)})...`
  );
  return buildDemoSession({
    frameCount: 56000, // 14s at 4000 Hz — fits 18 steps × (400ms hold + 300ms cool) + 0.5s lead
    gyroBase: [0, 0, 0],
    noiseAmplitude: 5 * f,
    motorHarmonicHz: 160,
    motorHarmonicAmplitude: 8 * f,
    electricalNoiseHz: 600,
    electricalNoiseAmplitude: 2 * f,
    injectSteps: true,
    iInterval: 2,
    responseParams: computeCycleResponseParams(cycle),
  });
}

/**
 * Generate a demo BBL buffer for verification flight (post-all tuning).
 *
 * Contains one session with:
 * - ~10 seconds of hover data at 4000 Hz (I-frame only, iInterval=2)
 * - Low noise floor (simulates effect of applied filters + PID tuning)
 * - No step inputs (hover only, same structure as filter flight)
 * - Multi-phase throttle profile for segment detection
 *
 * Verification noise is always significantly lower than the corresponding filter flight:
 * - Base: noiseAmplitude=3, motorHarmonicAmplitude=5, electricalNoise=0.8
 * - Progressive: further reduced with each cycle
 *
 * @param cycle - Tuning cycle number (0 = first, higher = progressively cleaner)
 */
export function generateVerificationDemoBBL(cycle = 0): Buffer {
  const f = progressiveFactor(cycle);
  logger.info(
    `[DEMO] Generating verification demo BBL (cycle ${cycle}, factor ${f.toFixed(2)})...`
  );
  return buildDemoSession({
    frameCount: 40000, // 10s at 4000 Hz
    gyroBase: [2, -1, 0],
    noiseAmplitude: 3 * f,
    motorHarmonicHz: 160,
    motorHarmonicAmplitude: 5 * f,
    electricalNoiseHz: 600,
    electricalNoiseAmplitude: 0.8 * f,
    injectSteps: false,
    iInterval: 2,
  });
}

/**
 * Generate a demo BBL buffer for Quick Tune (single flight with hover + stick inputs).
 *
 * Contains one session with:
 * - ~15 seconds of flight data at 4000 Hz (I-frame only, iInterval=2)
 * - Moderate noise (for filter analysis from hover segments)
 * - 12 step inputs across all 3 axes (for transfer function / PID analysis)
 * - Cycle-dependent noise and step response quality
 * - Multi-phase throttle profile for segment detection
 *
 * @param cycle - Tuning cycle number (0 = first, higher = progressively cleaner)
 */
export function generateQuickDemoBBL(cycle = 0): Buffer {
  const f = progressiveFactor(cycle);
  logger.info(`[DEMO] Generating quick tune demo BBL (cycle ${cycle}, factor ${f.toFixed(2)})...`);
  return buildDemoSession({
    frameCount: 60000, // 15s at 4000 Hz — enough for hover segments + 12 steps
    gyroBase: [2, -1, 0],
    noiseAmplitude: 12 * f,
    motorHarmonicHz: 160,
    motorHarmonicAmplitude: 30 * f,
    electricalNoiseHz: 600,
    electricalNoiseAmplitude: 6 * f,
    injectSteps: true,
    iInterval: 2,
    responseParams: computeCycleResponseParams(cycle),
  });
}

/**
 * Generate a combined demo BBL with both filter-suitable and PID-suitable sessions.
 * Session 1: hover + noise (for filter analysis)
 * Session 2: stick snaps (for PID analysis)
 *
 * @param cycle - Tuning cycle number (0 = first, higher = progressively cleaner)
 */
export function generateCombinedDemoBBL(cycle = 0): Buffer {
  const f = progressiveFactor(cycle);
  logger.info(`[DEMO] Generating combined demo BBL (cycle ${cycle}, factor ${f.toFixed(2)})...`);

  const filterSession = buildDemoSession({
    frameCount: 40000,
    gyroBase: [2, -1, 0],
    noiseAmplitude: 15 * f,
    motorHarmonicHz: 160,
    motorHarmonicAmplitude: 40 * f,
    electricalNoiseHz: 600,
    electricalNoiseAmplitude: 8 * f,
    injectSteps: false,
    iInterval: 2,
  });

  // 50 bytes of garbage between sessions (normal in multi-session BBL files)
  const garbage = Buffer.alloc(50);
  for (let i = 0; i < 50; i++) {
    garbage[i] = [0x00, 0x02, 0x04, 0xab, 0xcd][i % 5];
  }

  const pidSession = buildDemoSession({
    frameCount: 56000,
    gyroBase: [0, 0, 0],
    noiseAmplitude: 5 * f,
    motorHarmonicHz: 160,
    motorHarmonicAmplitude: 8 * f,
    electricalNoiseHz: 600,
    electricalNoiseAmplitude: 2 * f,
    injectSteps: true,
    iInterval: 2,
    responseParams: computeCycleResponseParams(cycle),
  });

  return Buffer.concat([filterSession, garbage, pidSession]);
}
