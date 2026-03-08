/**
 * Cross-axis coupling detector.
 *
 * Detects when a step input on one axis causes oscillation on another axis.
 * This indicates mechanical issues (bent props, loose motors, asymmetric frame)
 * or PID tuning problems (I-term windup, D-term cross-talk).
 *
 * Algorithm:
 * 1. For each detected step event, extract the gyro response on ALL axes
 *    (not just the step's axis)
 * 2. Compute normalized cross-correlation between the step axis response
 *    and each non-step axis response
 * 3. Average correlation per axis pair across all steps
 * 4. Rate coupling severity
 */
import type { BlackboxFlightData } from '@shared/types/blackbox.types';
import type { StepEvent, AxisPairCoupling, CrossAxisCoupling } from '@shared/types/analysis.types';

const AXIS_NAMES = ['roll', 'pitch', 'yaw'] as const;

/** Correlation below this is considered no coupling */
export const COUPLING_NONE_THRESHOLD = 0.15;

/** Correlation above this is considered significant coupling */
export const COUPLING_SIGNIFICANT_THRESHOLD = 0.4;

/**
 * Compute normalized cross-correlation between two signals.
 * Returns a value between 0 and 1 (absolute correlation).
 *
 * Uses Pearson correlation coefficient (zero-lag).
 */
export function normalizedCorrelation(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length);
  if (n < 4) return 0;

  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let covAB = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    covAB += da * db;
    varA += da * da;
    varB += db * db;
  }

  if (varA === 0 || varB === 0) return 0;
  return Math.abs(covAB / Math.sqrt(varA * varB));
}

/**
 * Analyze cross-axis coupling from step events and gyro data.
 *
 * @param steps - Detected step events
 * @param flightData - Parsed Blackbox flight data
 * @returns Cross-axis coupling analysis, or undefined if insufficient steps
 */
export function analyzeCrossAxisCoupling(
  steps: StepEvent[],
  flightData: BlackboxFlightData
): CrossAxisCoupling | undefined {
  if (steps.length < 2) return undefined;

  // Accumulate correlations per axis pair
  const pairCorrelations: Record<string, number[]> = {};
  for (let src = 0; src < 3; src++) {
    for (let aff = 0; aff < 3; aff++) {
      if (src === aff) continue;
      pairCorrelations[`${src}-${aff}`] = [];
    }
  }

  for (const step of steps) {
    const srcAxis = step.axis;
    const start = step.startIndex;
    const end = step.endIndex;

    if (end <= start || end > flightData.gyro[0].values.length) continue;

    // Extract source axis gyro response during the step window
    const srcResponse = flightData.gyro[srcAxis].values.subarray(start, end);

    // Compute correlation with each non-source axis
    for (let affAxis = 0; affAxis < 3; affAxis++) {
      if (affAxis === srcAxis) continue;
      const affResponse = flightData.gyro[affAxis].values.subarray(start, end);
      const corr = normalizedCorrelation(srcResponse, affResponse);
      pairCorrelations[`${srcAxis}-${affAxis}`].push(corr);
    }
  }

  // Average correlations per pair
  const pairs: AxisPairCoupling[] = [];
  let hasSignificant = false;

  for (let src = 0; src < 3; src++) {
    for (let aff = 0; aff < 3; aff++) {
      if (src === aff) continue;
      const key = `${src}-${aff}`;
      const corrs = pairCorrelations[key];

      if (corrs.length === 0) continue;

      const meanCorr = corrs.reduce((s, c) => s + c, 0) / corrs.length;
      const rating =
        meanCorr >= COUPLING_SIGNIFICANT_THRESHOLD
          ? 'significant'
          : meanCorr >= COUPLING_NONE_THRESHOLD
            ? 'mild'
            : 'none';

      if (rating === 'significant') hasSignificant = true;

      pairs.push({
        sourceAxis: AXIS_NAMES[src],
        affectedAxis: AXIS_NAMES[aff],
        correlation: Math.round(meanCorr * 1000) / 1000,
        rating,
      });
    }
  }

  if (pairs.length === 0) return undefined;

  const summary = generateCrossAxisSummary(pairs, hasSignificant);

  return {
    pairs,
    hasSignificantCoupling: hasSignificant,
    summary,
  };
}

/**
 * Generate a human-readable summary of cross-axis coupling.
 */
function generateCrossAxisSummary(pairs: AxisPairCoupling[], hasSignificant: boolean): string {
  if (!hasSignificant) {
    const mildPairs = pairs.filter((p) => p.rating === 'mild');
    if (mildPairs.length === 0) {
      return 'No cross-axis coupling detected — axes are well-isolated.';
    }
    return `Mild cross-axis coupling detected on ${mildPairs.length} pair${mildPairs.length === 1 ? '' : 's'}, but within normal range.`;
  }

  const significantPairs = pairs.filter((p) => p.rating === 'significant');
  const descriptions = significantPairs.map(
    (p) => `${p.sourceAxis}→${p.affectedAxis} (${(p.correlation * 100).toFixed(0)}%)`
  );

  return `Significant cross-axis coupling: ${descriptions.join(', ')}. This may indicate mechanical issues (bent prop, loose motor mount) or need for PID retuning.`;
}
