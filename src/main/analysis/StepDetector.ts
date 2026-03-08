/**
 * Detects step inputs in setpoint data and defines response windows.
 *
 * A "step" is a large, rapid change in the setpoint (stick input).
 * For each step, we define a response window in which to measure
 * how the gyro (actual rotation) tracks the commanded setpoint.
 */
import type { BlackboxFlightData } from '@shared/types/blackbox.types';
import type { StepEvent } from '@shared/types/analysis.types';
import {
  STEP_MIN_MAGNITUDE_DEG_S,
  STEP_DERIVATIVE_THRESHOLD,
  STEP_RESPONSE_WINDOW_MS,
  STEP_COOLDOWN_MS,
  STEP_MIN_HOLD_MS,
} from './constants';

/**
 * Detect step inputs in the setpoint across all axes.
 *
 * Algorithm:
 * 1. Compute setpoint derivative for each axis
 * 2. Find indices where |derivative| exceeds threshold
 * 3. Group consecutive high-derivative samples into step edges
 * 4. Validate: magnitude, hold time, cooldown between steps
 * 5. Return sorted by magnitude (largest first)
 *
 * @param windowMs - Override response window (ms). Default: STEP_RESPONSE_WINDOW_MS (300ms).
 */
export function detectSteps(flightData: BlackboxFlightData, windowMs?: number): StepEvent[] {
  const steps: StepEvent[] = [];
  const sampleRate = flightData.sampleRateHz;
  const cooldownSamples = Math.ceil((STEP_COOLDOWN_MS / 1000) * sampleRate);
  const holdSamples = Math.ceil((STEP_MIN_HOLD_MS / 1000) * sampleRate);
  const effectiveWindowMs = windowMs ?? STEP_RESPONSE_WINDOW_MS;
  const windowSamples = Math.ceil((effectiveWindowMs / 1000) * sampleRate);

  for (let axis = 0; axis < 3; axis++) {
    const setpoint = flightData.setpoint[axis].values;
    const numSamples = setpoint.length;

    if (numSamples < 2) continue;

    // Find step edges
    const axisSteps = detectAxisSteps(
      setpoint,
      numSamples,
      sampleRate,
      axis as 0 | 1 | 2,
      cooldownSamples,
      holdSamples,
      windowSamples
    );

    steps.push(...axisSteps);
  }

  // Sort by magnitude (largest first)
  steps.sort((a, b) => Math.abs(b.magnitude) - Math.abs(a.magnitude));

  return steps;
}

function detectAxisSteps(
  setpoint: Float64Array,
  numSamples: number,
  sampleRate: number,
  axis: 0 | 1 | 2,
  cooldownSamples: number,
  holdSamples: number,
  windowSamples: number
): StepEvent[] {
  const steps: StepEvent[] = [];
  let lastStepEnd = -cooldownSamples; // Allow first step immediately

  // Compute derivative: d[i] = (setpoint[i+1] - setpoint[i]) * sampleRate
  let i = 0;
  while (i < numSamples - 1) {
    const derivative = (setpoint[i + 1] - setpoint[i]) * sampleRate;

    if (Math.abs(derivative) < STEP_DERIVATIVE_THRESHOLD) {
      i++;
      continue;
    }

    // Found a potential step edge — group consecutive high-derivative samples
    const edgeStart = i;
    const direction = derivative > 0 ? 'positive' : 'negative';
    let edgeEnd = i;

    while (edgeEnd < numSamples - 1) {
      const d = (setpoint[edgeEnd + 1] - setpoint[edgeEnd]) * sampleRate;
      // Continue while derivative is in same direction and above a relaxed threshold
      if (
        (direction === 'positive' && d > STEP_DERIVATIVE_THRESHOLD * 0.3) ||
        (direction === 'negative' && d < -STEP_DERIVATIVE_THRESHOLD * 0.3)
      ) {
        edgeEnd++;
      } else {
        break;
      }
    }

    // Compute step magnitude
    const baselineValue = setpoint[edgeStart];
    const afterEdgeValue = setpoint[Math.min(edgeEnd + 1, numSamples - 1)];
    const magnitude = afterEdgeValue - baselineValue;

    // Advance past the edge
    i = edgeEnd + 1;

    // Validate minimum magnitude
    if (Math.abs(magnitude) < STEP_MIN_MAGNITUDE_DEG_S) continue;

    // Validate cooldown from previous step
    if (edgeStart - lastStepEnd < cooldownSamples) continue;

    // Validate hold time: setpoint should stay near the new value
    if (
      !validateHoldTime(setpoint, edgeEnd + 1, numSamples, afterEdgeValue, holdSamples, magnitude)
    )
      continue;

    // Define response window end
    const responseEnd = Math.min(edgeStart + windowSamples, numSamples);

    steps.push({
      axis,
      startIndex: edgeStart,
      endIndex: responseEnd,
      magnitude,
      direction: magnitude > 0 ? 'positive' : 'negative',
    });

    lastStepEnd = responseEnd;
  }

  return steps;
}

/**
 * Validate that the setpoint holds near the new value for at least holdSamples.
 */
function validateHoldTime(
  setpoint: Float64Array,
  startIdx: number,
  numSamples: number,
  targetValue: number,
  holdSamples: number,
  stepMagnitude: number
): boolean {
  const tolerance = Math.abs(stepMagnitude) * 0.5; // 50% of step size
  const end = Math.min(startIdx + holdSamples, numSamples);

  // Not enough samples to validate hold
  if (end - startIdx < holdSamples * 0.5) return true; // Be lenient at end of data

  for (let i = startIdx; i < end; i++) {
    if (Math.abs(setpoint[i] - targetValue) > tolerance) {
      return false;
    }
  }
  return true;
}
