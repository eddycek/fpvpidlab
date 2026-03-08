/**
 * Wind / disturbance detection module.
 *
 * Analyzes gyro variance during steady hover segments to estimate environmental
 * disturbance level. High variance during stable throttle indicates wind or
 * turbulence, which reduces confidence in tuning recommendations.
 */
import type { BlackboxFlightData } from '@shared/types/blackbox.types';
import type { DisturbanceLevel, WindDisturbanceResult } from '@shared/types/analysis.types';
import { THROTTLE_MIN_FLIGHT, THROTTLE_MAX_HOVER } from './constants';

export type { DisturbanceLevel, WindDisturbanceResult };

// ---- Constants ----

/** Minimum hover segment duration for disturbance analysis (seconds) */
const MIN_HOVER_DURATION_S = 2.0;

/** Gyro variance threshold (deg/s²) — below this is calm conditions */
export const DISTURBANCE_CALM_THRESHOLD = 25;

/** Gyro variance threshold (deg/s²) — above this is significant wind */
export const DISTURBANCE_WINDY_THRESHOLD = 200;

/** Minimum number of hover samples for reliable analysis */
const MIN_HOVER_SAMPLES = 500;

// ---- Implementation ----

/**
 * Compute variance of a Float64Array slice.
 */
function computeVariance(values: Float64Array, start: number, end: number): number {
  const n = end - start;
  if (n < 2) return 0;

  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += values[i];
  }
  const mean = sum / n;

  let sumSq = 0;
  for (let i = start; i < end; i++) {
    const diff = values[i] - mean;
    sumSq += diff * diff;
  }
  return sumSq / (n - 1);
}

/**
 * Find hover segment indices from throttle data.
 * Returns array of [startIdx, endIdx] pairs where throttle is in hover range.
 */
function findHoverSegments(throttle: Float64Array, sampleRateHz: number): Array<[number, number]> {
  const minSamples = Math.floor(MIN_HOVER_DURATION_S * sampleRateHz);
  const segments: Array<[number, number]> = [];
  let segStart = -1;

  for (let i = 0; i < throttle.length; i++) {
    const t = throttle[i];
    const inHover = t >= THROTTLE_MIN_FLIGHT && t <= THROTTLE_MAX_HOVER;

    if (inHover && segStart === -1) {
      segStart = i;
    } else if (!inHover && segStart !== -1) {
      if (i - segStart >= minSamples) {
        segments.push([segStart, i]);
      }
      segStart = -1;
    }
  }

  // Handle segment at end of data
  if (segStart !== -1 && throttle.length - segStart >= minSamples) {
    segments.push([segStart, throttle.length]);
  }

  return segments;
}

/**
 * Classify disturbance level from gyro variance.
 */
function classifyDisturbance(variance: number): DisturbanceLevel {
  if (variance <= DISTURBANCE_CALM_THRESHOLD) return 'calm';
  if (variance >= DISTURBANCE_WINDY_THRESHOLD) return 'windy';
  return 'moderate';
}

/**
 * Generate human-readable summary.
 */
function generateSummary(level: DisturbanceLevel, worstVariance: number): string {
  switch (level) {
    case 'calm':
      return `Calm conditions detected (gyro variance ${worstVariance.toFixed(0)} deg/s²). Tuning data is reliable.`;
    case 'moderate':
      return `Moderate disturbance detected (gyro variance ${worstVariance.toFixed(0)} deg/s²). Recommendations are usable but a calmer day would improve accuracy.`;
    case 'windy':
      return `High disturbance detected (gyro variance ${worstVariance.toFixed(0)} deg/s²). Consider retesting in calmer conditions for more reliable recommendations.`;
  }
}

/**
 * Analyze wind/disturbance level from flight data.
 *
 * Examines gyro variance during stable hover segments (throttle in flight range,
 * below max hover). High variance during stable throttle indicates external
 * disturbance rather than pilot input or mechanical issues.
 *
 * Returns undefined if insufficient hover data is available.
 */
export function analyzeWindDisturbance(
  flightData: BlackboxFlightData
): WindDisturbanceResult | undefined {
  const { gyro, setpoint, sampleRateHz } = flightData;

  // Need throttle data (4th setpoint channel)
  if (setpoint.length < 4 || setpoint[3].values.length === 0) {
    return undefined;
  }

  const throttle = setpoint[3].values;
  const segments = findHoverSegments(throttle, sampleRateHz);

  if (segments.length === 0) {
    return undefined;
  }

  // Accumulate gyro samples from all hover segments
  let totalSamples = 0;
  for (const [start, end] of segments) {
    totalSamples += end - start;
  }

  if (totalSamples < MIN_HOVER_SAMPLES) {
    return undefined;
  }

  // Compute per-axis variance across all hover segments
  const axisVariance: [number, number, number] = [0, 0, 0];

  for (let axis = 0; axis < 3; axis++) {
    const values = gyro[axis].values;
    let weightedVariance = 0;
    let totalWeight = 0;

    for (const [start, end] of segments) {
      const segLen = end - start;
      const v = computeVariance(values, start, end);
      weightedVariance += v * segLen;
      totalWeight += segLen;
    }

    axisVariance[axis] = totalWeight > 0 ? weightedVariance / totalWeight : 0;
  }

  // Worst case across roll and pitch (yaw is noisier by nature, less relevant)
  const worstVariance = Math.max(axisVariance[0], axisVariance[1]);
  const level = classifyDisturbance(worstVariance);
  const hoverDurationS = totalSamples / sampleRateHz;

  return {
    axisVariance,
    worstVariance,
    level,
    hoverDurationS,
    hoverSampleCount: totalSamples,
    summary: generateSummary(level, worstVariance),
  };
}
