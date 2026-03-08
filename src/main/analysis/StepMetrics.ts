/**
 * Compute step response metrics from gyro data aligned to a step event.
 *
 * For each detected step, we extract the gyro response window and measure:
 * - Rise time (10% → 90% of final value)
 * - Overshoot percentage
 * - Settling time (time to stay within ±2% of target)
 * - Latency (delay from setpoint change to first gyro movement)
 * - Ringing count (oscillations before settling)
 */
import type { TimeSeries } from '@shared/types/blackbox.types';
import type {
  StepEvent,
  StepResponse,
  StepResponseTrace,
  AxisStepProfile,
} from '@shared/types/analysis.types';
import {
  SETTLING_TOLERANCE,
  RISE_TIME_LOW,
  RISE_TIME_HIGH,
  LATENCY_THRESHOLD,
  STEP_RESPONSE_WINDOW_MS,
  STEP_RESPONSE_WINDOW_MIN_MS,
  STEP_RESPONSE_WINDOW_MAX_MS,
  ADAPTIVE_WINDOW_SETTLING_MULTIPLIER,
} from './constants';

/**
 * Compute response metrics for a single step event.
 */
export function computeStepResponse(
  setpoint: TimeSeries,
  gyro: TimeSeries,
  step: StepEvent,
  sampleRate: number
): StepResponse {
  const { startIndex, endIndex, magnitude } = step;
  const msPerSample = 1000 / sampleRate;

  // Extract baseline (gyro value just before the step)
  const baseline = startIndex > 0 ? gyro.values[startIndex - 1] : gyro.values[startIndex];

  // Compute steady state: average of last 20% of the response window
  const windowLen = endIndex - startIndex;
  const tailStart = startIndex + Math.floor(windowLen * 0.8);
  const tailEnd = endIndex;
  const steadyStateValue = mean(gyro.values, tailStart, tailEnd);

  // Use steadyState for metric computation (what the gyro actually converges to)
  const effectiveTarget = steadyStateValue;
  const effectiveMagnitude = effectiveTarget - baseline;

  // Handle near-zero magnitude (no meaningful response)
  if (Math.abs(effectiveMagnitude) < 1) {
    return {
      step,
      riseTimeMs: windowLen * msPerSample,
      overshootPercent: 0,
      settlingTimeMs: windowLen * msPerSample,
      latencyMs: windowLen * msPerSample,
      ringingCount: 0,
      peakValue: baseline,
      steadyStateValue,
      trackingErrorRMS: 1.0,
    };
  }

  // Latency: first sample where gyro moves > LATENCY_THRESHOLD * |magnitude| from baseline
  const latencyThreshold = LATENCY_THRESHOLD * Math.abs(magnitude);
  let latencyMs = windowLen * msPerSample; // default: entire window
  for (let i = startIndex; i < endIndex; i++) {
    if (Math.abs(gyro.values[i] - baseline) > latencyThreshold) {
      latencyMs = (i - startIndex) * msPerSample;
      break;
    }
  }

  // Rise time: time from RISE_TIME_LOW to RISE_TIME_HIGH of effectiveMagnitude
  const lowThreshold = baseline + effectiveMagnitude * RISE_TIME_LOW;
  const highThreshold = baseline + effectiveMagnitude * RISE_TIME_HIGH;
  let riseLowIdx = -1;
  let riseHighIdx = -1;

  for (let i = startIndex; i < endIndex; i++) {
    const val = gyro.values[i];
    if (riseLowIdx < 0 && crossedThreshold(val, baseline, lowThreshold, effectiveMagnitude > 0)) {
      riseLowIdx = i;
    }
    if (riseHighIdx < 0 && crossedThreshold(val, baseline, highThreshold, effectiveMagnitude > 0)) {
      riseHighIdx = i;
    }
    if (riseLowIdx >= 0 && riseHighIdx >= 0) break;
  }

  const riseTimeMs =
    riseLowIdx >= 0 && riseHighIdx >= 0
      ? (riseHighIdx - riseLowIdx) * msPerSample
      : windowLen * msPerSample;

  // Peak value: max deviation from baseline in the step direction
  let peakValue = baseline;
  for (let i = startIndex; i < endIndex; i++) {
    const val = gyro.values[i];
    if (effectiveMagnitude > 0) {
      if (val > peakValue) peakValue = val;
    } else {
      if (val < peakValue) peakValue = val;
    }
  }

  // Overshoot: how much the peak exceeds the target
  const overshootPercent =
    Math.abs(effectiveMagnitude) > 1
      ? Math.max(
          0,
          ((effectiveMagnitude > 0 ? peakValue - effectiveTarget : effectiveTarget - peakValue) /
            Math.abs(effectiveMagnitude)) *
            100
        )
      : 0;

  // Settling time: last time the signal exits the ±SETTLING_TOLERANCE band around steady state
  const settlingBand = Math.abs(effectiveMagnitude) * SETTLING_TOLERANCE;
  let settlingTimeMs = windowLen * msPerSample;
  // Scan from end to find last time outside the band
  for (let i = endIndex - 1; i >= startIndex; i--) {
    if (Math.abs(gyro.values[i] - effectiveTarget) > settlingBand) {
      settlingTimeMs = (i - startIndex + 1) * msPerSample;
      break;
    }
    if (i === startIndex) {
      settlingTimeMs = 0; // Never left the band
    }
  }

  // Ringing: count zero-crossings of (gyro - steadyState) in response tail
  // Start counting after the first rise
  const ringingStartIdx = riseHighIdx >= 0 ? riseHighIdx : startIndex + Math.floor(windowLen * 0.3);
  let ringingCount = 0;
  let prevSign = 0;
  for (let i = ringingStartIdx; i < endIndex; i++) {
    const diff = gyro.values[i] - effectiveTarget;
    const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0;
    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) {
      ringingCount++;
    }
    if (sign !== 0) prevSign = sign;
  }
  // Each full oscillation is 2 zero crossings, report oscillation count
  ringingCount = Math.floor(ringingCount / 2);

  // Extract trace data for chart visualization
  const trace: StepResponseTrace = {
    timeMs: [],
    setpoint: [],
    gyro: [],
  };
  for (let i = startIndex; i < endIndex; i++) {
    trace.timeMs.push((i - startIndex) * msPerSample);
    trace.setpoint.push(setpoint.values[i]);
    trace.gyro.push(gyro.values[i]);
  }

  // Compute tracking error RMS: normalized by |magnitude|
  let sumSqErr = 0;
  for (let i = startIndex; i < endIndex; i++) {
    const err = (setpoint.values[i] - gyro.values[i]) / Math.abs(magnitude);
    sumSqErr += err * err;
  }
  const trackingErrorRMS = Math.sqrt(sumSqErr / windowLen);

  // Compute steady-state error: mean |setpoint - gyro| / |magnitude| during hold phase (last 20%)
  const holdLen = tailEnd - tailStart;
  let sumAbsErr = 0;
  for (let i = tailStart; i < tailEnd; i++) {
    sumAbsErr += Math.abs(setpoint.values[i] - gyro.values[i]);
  }
  const steadyStateErrorPercent =
    holdLen > 0 ? (sumAbsErr / holdLen / Math.abs(magnitude)) * 100 : 0;

  return {
    step,
    riseTimeMs,
    overshootPercent,
    settlingTimeMs,
    latencyMs,
    ringingCount,
    peakValue,
    steadyStateValue,
    trace,
    trackingErrorRMS,
    steadyStateErrorPercent,
  };
}

/**
 * Aggregate step responses for one axis into an AxisStepProfile.
 */
export function aggregateAxisMetrics(responses: StepResponse[]): AxisStepProfile {
  if (responses.length === 0) {
    return {
      responses,
      meanOvershoot: 0,
      meanRiseTimeMs: 0,
      meanSettlingTimeMs: 0,
      meanLatencyMs: 0,
      meanTrackingErrorRMS: 0,
      meanSteadyStateError: 0,
    };
  }

  // Filter out degenerate steps (false positives or badly detected) for metric computation
  const valid = responses.filter((r) => r.riseTimeMs > 0 && r.overshootPercent < 500);
  const src = valid.length > 0 ? valid : responses;

  return {
    responses, // keep all for chart display
    meanOvershoot: mean(new Float64Array(src.map((r) => r.overshootPercent)), 0, src.length),
    meanRiseTimeMs: mean(new Float64Array(src.map((r) => r.riseTimeMs)), 0, src.length),
    meanSettlingTimeMs: mean(new Float64Array(src.map((r) => r.settlingTimeMs)), 0, src.length),
    meanLatencyMs: mean(new Float64Array(src.map((r) => r.latencyMs)), 0, src.length),
    meanTrackingErrorRMS: mean(
      new Float64Array(src.map((r) => r.trackingErrorRMS ?? 0)),
      0,
      src.length
    ),
    meanSteadyStateError: mean(
      new Float64Array(src.map((r) => r.steadyStateErrorPercent ?? 0)),
      0,
      src.length
    ),
    ...computeMeanFFEnergyRatio(src),
  };
}

/** Compute meanFFEnergyRatio from responses that have ffEnergyRatio defined. */
function computeMeanFFEnergyRatio(responses: StepResponse[]): { meanFFEnergyRatio?: number } {
  const withRatio = responses.filter((r) => r.ffEnergyRatio !== undefined);
  if (withRatio.length === 0) return {};
  const sum = withRatio.reduce((acc, r) => acc + r.ffEnergyRatio!, 0);
  return { meanFFEnergyRatio: sum / withRatio.length };
}

/**
 * Classify whether a step's overshoot is dominated by feedforward.
 *
 * Finds the peak index in the gyro response, then compares |pidF| vs |pidP|
 * at that point. If |pidF| > |pidP|, the overshoot is FF-dominated.
 *
 * Returns undefined if pidF or pidP data is not available or step has no
 * meaningful overshoot.
 */
export function classifyFFContribution(
  response: StepResponse,
  pidP: TimeSeries,
  pidF: TimeSeries,
  gyro: TimeSeries
): boolean | undefined {
  const { step, overshootPercent, steadyStateValue } = response;

  // Only classify if there's meaningful overshoot
  if (overshootPercent < 5) return undefined;

  const { startIndex, endIndex } = step;
  const baseline = startIndex > 0 ? gyro.values[startIndex - 1] : gyro.values[startIndex];
  const effectiveMagnitude = steadyStateValue - baseline;

  if (Math.abs(effectiveMagnitude) < 1) return undefined;

  // Find peak index (max deviation in step direction)
  let peakIdx = startIndex;
  let peakVal = gyro.values[startIndex];
  for (let i = startIndex; i < endIndex; i++) {
    const val = gyro.values[i];
    if (effectiveMagnitude > 0 ? val > peakVal : val < peakVal) {
      peakVal = val;
      peakIdx = i;
    }
  }

  // Compare pidF vs pidP magnitudes at peak
  if (peakIdx >= pidP.values.length || peakIdx >= pidF.values.length) return undefined;

  const pMag = Math.abs(pidP.values[peakIdx]);
  const fMag = Math.abs(pidF.values[peakIdx]);

  return fMag > pMag;
}

/**
 * Compute FF energy ratio over a step response window.
 *
 * Energy ratio = ffEnergy / (ffEnergy + pidPEnergy), where energy = sum(x[i]^2).
 * Returns undefined if pidF data is all zeros (no FF contribution) or data unavailable.
 */
export function computeFFEnergyRatio(
  step: StepEvent,
  pidP: TimeSeries,
  pidF: TimeSeries
): number | undefined {
  const { startIndex, endIndex } = step;

  if (startIndex >= pidP.values.length || startIndex >= pidF.values.length) return undefined;

  const safeEnd = Math.min(endIndex, pidP.values.length, pidF.values.length);

  let ffEnergy = 0;
  let pidPEnergy = 0;

  for (let i = startIndex; i < safeEnd; i++) {
    ffEnergy += pidF.values[i] * pidF.values[i];
    pidPEnergy += pidP.values[i] * pidP.values[i];
  }

  // If both are zero, no meaningful ratio
  if (ffEnergy + pidPEnergy === 0) return undefined;

  // If FF energy is zero, return undefined (no FF contribution to classify)
  if (ffEnergy === 0) return undefined;

  return ffEnergy / (ffEnergy + pidPEnergy);
}

/** Check if value has crossed a threshold in the correct direction */
function crossedThreshold(
  value: number,
  baseline: number,
  threshold: number,
  isPositive: boolean
): boolean {
  if (isPositive) {
    return value >= threshold;
  } else {
    return value <= threshold;
  }
}

/**
 * Compute an adaptive response window (ms) from first-pass step responses.
 *
 * Uses 2× median settling time, clamped to [MIN, MAX]. Falls back to the
 * default 300ms when there aren't enough valid settling measurements.
 *
 * @param responses - All step responses from the first-pass (generous window)
 * @param minResponses - Minimum steps required to compute adaptive window (default 3)
 * @returns Adaptive window in ms
 */
export function computeAdaptiveWindowMs(responses: StepResponse[], minResponses = 3): number {
  // Collect settling times, excluding degenerate cases where settling == full window
  const settlingTimes = responses.map((r) => r.settlingTimeMs).filter((s) => s > 0);

  if (settlingTimes.length < minResponses) {
    return STEP_RESPONSE_WINDOW_MS; // fallback
  }

  // Compute median settling time
  settlingTimes.sort((a, b) => a - b);
  const mid = Math.floor(settlingTimes.length / 2);
  const median =
    settlingTimes.length % 2 === 0
      ? (settlingTimes[mid - 1] + settlingTimes[mid]) / 2
      : settlingTimes[mid];

  // Adaptive window: 2× median settling, clamped to bounds
  const adaptive = Math.round(
    Math.max(
      STEP_RESPONSE_WINDOW_MIN_MS,
      Math.min(STEP_RESPONSE_WINDOW_MAX_MS, median * ADAPTIVE_WINDOW_SETTLING_MULTIPLIER)
    )
  );

  return adaptive;
}

/** Compute mean of a Float64Array slice */
function mean(arr: Float64Array, start: number, end: number): number {
  const len = end - start;
  if (len <= 0) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += arr[i];
  }
  return sum / len;
}
