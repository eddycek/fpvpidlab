/**
 * Utilities for extracting compact, JSON-safe metrics from analysis results.
 *
 * Used to create history records from completed tuning sessions.
 */

import type { FilterAnalysisResult, PIDAnalysisResult } from '../types/analysis.types';
import type {
  CompactSpectrum,
  FilterMetricsSummary,
  PIDMetricsSummary,
  TransferFunctionMetricsSummary,
} from '../types/tuning-history.types';

/**
 * Downsample a full-resolution FFT spectrum to a fixed number of bins.
 *
 * Uses linear interpolation via binary search for accurate resampling.
 * Output values are rounded to 2 decimal places for compact JSON storage.
 *
 * @param frequencies - Original frequency bins (Hz), must be sorted ascending
 * @param magnitudes - Per-axis magnitude arrays (dB)
 * @param targetBins - Number of output bins (default 128)
 * @param maxFreqHz - Maximum frequency to include (default 4000 Hz)
 */
export function downsampleSpectrum(
  frequencies: Float64Array,
  magnitudes: { roll: Float64Array; pitch: Float64Array; yaw: Float64Array },
  targetBins = 128,
  maxFreqHz = 4000
): CompactSpectrum {
  if (frequencies.length === 0) {
    return { frequencies: [], roll: [], pitch: [], yaw: [] };
  }

  // Clamp maxFreqHz to actual data range
  const actualMax = Math.min(maxFreqHz, frequencies[frequencies.length - 1]);
  const step = actualMax / targetBins;

  const outFreqs: number[] = [];
  const outRoll: number[] = [];
  const outPitch: number[] = [];
  const outYaw: number[] = [];

  for (let i = 0; i < targetBins; i++) {
    const targetFreq = (i + 0.5) * step; // Center of each bin
    outFreqs.push(Math.round(targetFreq * 10) / 10);
    outRoll.push(interpolate(frequencies, magnitudes.roll, targetFreq));
    outPitch.push(interpolate(frequencies, magnitudes.pitch, targetFreq));
    outYaw.push(interpolate(frequencies, magnitudes.yaw, targetFreq));
  }

  return {
    frequencies: outFreqs,
    roll: outRoll,
    pitch: outPitch,
    yaw: outYaw,
  };
}

/** Linear interpolation with binary search on sorted frequency array */
function interpolate(frequencies: Float64Array, values: Float64Array, targetFreq: number): number {
  // Edge cases
  if (targetFreq <= frequencies[0]) {
    return round2(values[0]);
  }
  if (targetFreq >= frequencies[frequencies.length - 1]) {
    return round2(values[values.length - 1]);
  }

  // Binary search for the interval containing targetFreq
  let lo = 0;
  let hi = frequencies.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (frequencies[mid] <= targetFreq) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // Linear interpolation between lo and hi
  const fLo = frequencies[lo];
  const fHi = frequencies[hi];
  const t = (targetFreq - fLo) / (fHi - fLo);
  const interpolated = values[lo] + t * (values[hi] - values[lo]);
  return round2(interpolated);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Extract compact filter metrics from a full FilterAnalysisResult.
 *
 * Spectrum access: result.noise.roll.spectrum.frequencies (shared across axes)
 */
export function extractFilterMetrics(result: FilterAnalysisResult): FilterMetricsSummary {
  const spectrum = downsampleSpectrum(result.noise.roll.spectrum.frequencies, {
    roll: result.noise.roll.spectrum.magnitudes,
    pitch: result.noise.pitch.spectrum.magnitudes,
    yaw: result.noise.yaw.spectrum.magnitudes,
  });

  return {
    noiseLevel: result.noise.overallLevel,
    roll: {
      noiseFloorDb: round2(result.noise.roll.noiseFloorDb),
      peakCount: result.noise.roll.peaks.length,
    },
    pitch: {
      noiseFloorDb: round2(result.noise.pitch.noiseFloorDb),
      peakCount: result.noise.pitch.peaks.length,
    },
    yaw: {
      noiseFloorDb: round2(result.noise.yaw.noiseFloorDb),
      peakCount: result.noise.yaw.peaks.length,
    },
    segmentsUsed: result.segmentsUsed,
    rpmFilterActive: result.rpmFilterActive,
    summary: result.summary,
    spectrum,
    ...(result.dataQuality
      ? { dataQuality: { overall: result.dataQuality.overall, tier: result.dataQuality.tier } }
      : {}),
    ...(result.windDisturbance
      ? {
          windDisturbance: {
            level: result.windDisturbance.level,
            worstVariance: round2(result.windDisturbance.worstVariance),
          },
        }
      : {}),
  };
}

/** Per-axis transfer function metrics input (matches TransferFunctionEstimator.TransferFunctionMetrics) */
interface TFMetricsInput {
  bandwidthHz: number;
  phaseMarginDeg: number;
  gainMarginDb: number;
  overshootPercent: number;
  settlingTimeMs: number;
  riseTimeMs: number;
}

/**
 * Extract compact transfer function metrics for history storage.
 */
export function extractTransferFunctionMetrics(
  metrics: { roll: TFMetricsInput; pitch: TFMetricsInput; yaw: TFMetricsInput },
  dataQuality?: { overall: number; tier: string }
): TransferFunctionMetricsSummary {
  const extract = (m: TFMetricsInput) => ({
    bandwidthHz: round2(m.bandwidthHz),
    phaseMarginDeg: round2(m.phaseMarginDeg),
    gainMarginDb: round2(m.gainMarginDb),
    overshootPercent: round2(m.overshootPercent),
    settlingTimeMs: round2(m.settlingTimeMs),
    riseTimeMs: round2(m.riseTimeMs),
  });

  return {
    roll: extract(metrics.roll),
    pitch: extract(metrics.pitch),
    yaw: extract(metrics.yaw),
    ...(dataQuality ? { dataQuality } : {}),
  };
}

/**
 * Extract compact PID metrics from a full PIDAnalysisResult.
 */
export function extractPIDMetrics(result: PIDAnalysisResult): PIDMetricsSummary {
  return {
    roll: {
      meanOvershoot: round2(result.roll.meanOvershoot),
      meanRiseTimeMs: round2(result.roll.meanRiseTimeMs),
      meanSettlingTimeMs: round2(result.roll.meanSettlingTimeMs),
      meanLatencyMs: round2(result.roll.meanLatencyMs),
      meanTrackingErrorRMS: round2(result.roll.meanTrackingErrorRMS),
    },
    pitch: {
      meanOvershoot: round2(result.pitch.meanOvershoot),
      meanRiseTimeMs: round2(result.pitch.meanRiseTimeMs),
      meanSettlingTimeMs: round2(result.pitch.meanSettlingTimeMs),
      meanLatencyMs: round2(result.pitch.meanLatencyMs),
      meanTrackingErrorRMS: round2(result.pitch.meanTrackingErrorRMS),
    },
    yaw: {
      meanOvershoot: round2(result.yaw.meanOvershoot),
      meanRiseTimeMs: round2(result.yaw.meanRiseTimeMs),
      meanSettlingTimeMs: round2(result.yaw.meanSettlingTimeMs),
      meanLatencyMs: round2(result.yaw.meanLatencyMs),
      meanTrackingErrorRMS: round2(result.yaw.meanTrackingErrorRMS),
    },
    stepsDetected: result.stepsDetected,
    currentPIDs: result.currentPIDs,
    summary: result.summary,
    ...(result.dataQuality
      ? { dataQuality: { overall: result.dataQuality.overall, tier: result.dataQuality.tier } }
      : {}),
  };
}
