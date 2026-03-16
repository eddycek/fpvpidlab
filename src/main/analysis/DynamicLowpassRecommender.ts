/**
 * Dynamic lowpass recommendation module.
 *
 * When throttle spectrogram shows noise significantly increasing with throttle,
 * recommends dynamic lowpass (throttle-ramped cutoff) instead of static.
 * Lower latency at low throttle, more filtering at high throttle.
 *
 * Uses existing ThrottleSpectrogramResult data to detect throttle-dependent noise.
 */
import type { ThrottleSpectrogramResult, FilterRecommendation } from '@shared/types/analysis.types';

// ---- Constants ----

/** Minimum noise floor increase (dB) from low to high throttle to trigger recommendation */
export const DYNAMIC_LOWPASS_NOISE_INCREASE_DB = 6;

/** Minimum number of throttle bands with data for reliable analysis */
export const DYNAMIC_LOWPASS_MIN_BANDS = 3;

/** Minimum Pearson correlation between throttle level and noise floor to confirm trend */
export const DYNAMIC_LOWPASS_MIN_CORRELATION = 0.6;

// ---- Types ----

export interface DynamicLowpassAnalysis {
  /** Whether dynamic lowpass is recommended */
  recommended: boolean;
  /** Noise floor increase from low to high throttle bands (dB) */
  noiseIncreaseDeltaDb: number;
  /** Correlation between throttle and noise floor (0-1) */
  throttleNoiseCorrelation: number;
  /** Number of throttle bands analyzed */
  bandsAnalyzed: number;
  /** Human-readable summary */
  summary: string;
}

// ---- Implementation ----

/**
 * Analyze throttle-dependent noise characteristics and recommend dynamic lowpass.
 *
 * @param spectrogram - Throttle spectrogram from ThrottleSpectrogramAnalyzer
 * @returns Analysis result with recommendation
 */
export function analyzeDynamicLowpass(
  spectrogram: ThrottleSpectrogramResult | undefined
): DynamicLowpassAnalysis | undefined {
  if (!spectrogram || spectrogram.bandsWithData < DYNAMIC_LOWPASS_MIN_BANDS) {
    return undefined;
  }

  // Collect noise floors from bands with data (average across roll+pitch)
  const bandData: Array<{ throttleMid: number; noiseFloorDb: number }> = [];

  for (const band of spectrogram.bands) {
    if (!band.noiseFloorDb) continue;

    const throttleMid = (band.throttleMin + band.throttleMax) / 2;
    // Average roll and pitch noise floors (yaw excluded as it's noisier by nature)
    const avgFloor = (band.noiseFloorDb[0] + band.noiseFloorDb[1]) / 2;
    bandData.push({ throttleMid, noiseFloorDb: avgFloor });
  }

  if (bandData.length < DYNAMIC_LOWPASS_MIN_BANDS) {
    return undefined;
  }

  // Compute noise delta (last band - first band)
  const sortedByThrottle = [...bandData].sort((a, b) => a.throttleMid - b.throttleMid);
  const lowNoise = sortedByThrottle[0].noiseFloorDb;
  const highNoise = sortedByThrottle[sortedByThrottle.length - 1].noiseFloorDb;
  const noiseIncreaseDeltaDb = highNoise - lowNoise;

  // Compute Pearson correlation between throttle level and noise floor
  const throttleNoiseCorrelation = computeCorrelation(
    bandData.map((d) => d.throttleMid),
    bandData.map((d) => d.noiseFloorDb)
  );

  const recommended =
    noiseIncreaseDeltaDb >= DYNAMIC_LOWPASS_NOISE_INCREASE_DB &&
    throttleNoiseCorrelation >= DYNAMIC_LOWPASS_MIN_CORRELATION;

  const summary = recommended
    ? `Noise increases ${noiseIncreaseDeltaDb.toFixed(0)} dB from low to high throttle (correlation ${throttleNoiseCorrelation.toFixed(2)}). Dynamic lowpass recommended for lower latency at cruise and more filtering at full throttle.`
    : `Noise is relatively consistent across throttle range (${noiseIncreaseDeltaDb.toFixed(0)} dB change). Static lowpass is appropriate.`;

  return {
    recommended,
    noiseIncreaseDeltaDb: Math.round(noiseIncreaseDeltaDb * 10) / 10,
    throttleNoiseCorrelation: Math.round(throttleNoiseCorrelation * 100) / 100,
    bandsAnalyzed: bandData.length,
    summary,
  };
}

/**
 * Generate filter recommendations for dynamic lowpass if appropriate.
 *
 * Recommends both gyro LPF1 and D-term LPF1 dynamic lowpass when throttle-dependent
 * noise is detected. D-term benefits even more from dynamic filtering because D amplifies
 * high-frequency noise — ramping the cutoff with throttle reduces motor heating at high
 * throttle while preserving stick feel at cruise.
 *
 * @param analysis - Result from analyzeDynamicLowpass
 * @param currentGyroLpf1 - Current static gyro LPF1 cutoff (Hz)
 * @param currentDtermLpf1 - Current static D-term LPF1 cutoff (Hz), defaults to 0 (skip)
 * @returns Array of recommendations (may be empty)
 */
export function recommendDynamicLowpass(
  analysis: DynamicLowpassAnalysis | undefined,
  currentGyroLpf1: number,
  currentDtermLpf1: number = 0
): FilterRecommendation[] {
  if (!analysis || !analysis.recommended) return [];

  const recs: FilterRecommendation[] = [];
  const deltaNote = `${analysis.noiseIncreaseDeltaDb.toFixed(0)} dB`;

  // Gyro LPF1 dynamic lowpass
  if (currentGyroLpf1 > 0) {
    recs.push(
      {
        setting: 'gyro_lpf1_dyn_min_hz',
        currentValue: 0,
        recommendedValue: Math.round(currentGyroLpf1 * 0.6),
        reason:
          `Noise increases significantly with throttle (${deltaNote} from low to high). ` +
          'Enabling dynamic lowpass ramps the filter cutoff with throttle — lower cutoff at high throttle for more filtering, ' +
          'higher cutoff at low throttle for less latency. This gives you the best of both worlds.',
        impact: 'both',
        confidence: 'medium',
        ruleId: 'F-DLPF-GYRO',
      },
      {
        setting: 'gyro_lpf1_dyn_max_hz',
        currentValue: 0,
        recommendedValue: Math.round(currentGyroLpf1 * 1.4),
        reason:
          'Sets the upper limit of the dynamic lowpass range. At low throttle the filter operates near this value, ' +
          'giving minimal latency when noise is naturally lower.',
        impact: 'latency',
        confidence: 'medium',
        ruleId: 'F-DLPF-GYRO',
      }
    );
  }

  // D-term LPF1 dynamic lowpass — D amplifies noise, so dynamic filtering helps even more
  if (currentDtermLpf1 > 0) {
    recs.push(
      {
        setting: 'dterm_lpf1_dyn_min_hz',
        currentValue: 0,
        recommendedValue: Math.round(currentDtermLpf1 * 0.6),
        reason:
          `Throttle-dependent noise (${deltaNote} increase) also affects the D-term. ` +
          'Enabling dynamic D-term lowpass reduces motor heating at high throttle while keeping ' +
          'sharp stick response at cruise speeds.',
        impact: 'both',
        confidence: 'medium',
        ruleId: 'F-DLPF-DTERM',
      },
      {
        setting: 'dterm_lpf1_dyn_max_hz',
        currentValue: 0,
        recommendedValue: Math.round(currentDtermLpf1 * 1.4),
        reason:
          'Upper limit of the D-term dynamic lowpass range. At low throttle the filter uses this higher cutoff ' +
          'for minimal latency in the D-term path.',
        impact: 'latency',
        confidence: 'medium',
        ruleId: 'F-DLPF-DTERM',
      }
    );
  }

  return recs;
}

/**
 * Pearson correlation coefficient between two arrays.
 */
function computeCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0,
    sumY2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (den === 0) return 0;
  return num / den;
}
