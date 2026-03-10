import type { AxisNoiseProfile, StepResponse } from '@shared/types/analysis.types';
import type { CompactStepResponse } from '@shared/types/tuning-history.types';

export type Axis = 'roll' | 'pitch' | 'yaw';

export const AXIS_COLORS: Record<Axis, string> = {
  roll: '#ff6b6b',
  pitch: '#51cf66',
  yaw: '#4dabf7',
};

export interface SpectrumDataPoint {
  frequency: number;
  roll?: number;
  pitch?: number;
  yaw?: number;
}

export interface TraceDataPoint {
  timeMs: number;
  setpoint: number;
  gyro: number;
}

/**
 * Convert PowerSpectrum Float64Arrays to Recharts-compatible data.
 * Filters to the specified frequency range.
 */
export function spectrumToRechartsData(
  profiles: Record<Axis, AxisNoiseProfile>,
  minHz: number = 20,
  maxHz: number = 1000
): SpectrumDataPoint[] {
  // Use the first axis to build frequency bins
  const refSpectrum = profiles.roll.spectrum;
  const data: SpectrumDataPoint[] = [];

  for (let i = 0; i < refSpectrum.frequencies.length; i++) {
    const freq = refSpectrum.frequencies[i];
    if (freq < minHz || freq > maxHz) continue;

    const point: SpectrumDataPoint = { frequency: Math.round(freq * 10) / 10 };

    for (const axis of ['roll', 'pitch', 'yaw'] as const) {
      const spectrum = profiles[axis].spectrum;
      if (i < spectrum.magnitudes.length) {
        point[axis] = Math.round(spectrum.magnitudes[i] * 100) / 100;
      }
    }

    data.push(point);
  }

  return data;
}

/**
 * Convert a StepResponseTrace to Recharts-compatible data.
 */
export function traceToRechartsData(response: StepResponse): TraceDataPoint[] {
  if (!response.trace) return [];

  const { timeMs, setpoint, gyro } = response.trace;
  const data: TraceDataPoint[] = [];

  for (let i = 0; i < timeMs.length; i++) {
    data.push({
      timeMs: Math.round(timeMs[i] * 100) / 100,
      setpoint: Math.round(setpoint[i] * 100) / 100,
      gyro: Math.round(gyro[i] * 100) / 100,
    });
  }

  return data;
}

/**
 * Find the most representative step for default visualization.
 * Prefers valid steps over degenerate ones (0ms rise or 500%+ overshoot).
 */
export function findBestStep(responses: StepResponse[]): number {
  if (responses.length === 0) return -1;

  let bestIdx = 0;
  let bestScore = -Infinity;

  for (let i = 0; i < responses.length; i++) {
    const r = responses[i];
    if (!r.trace) continue;

    const isDegenerate = r.riseTimeMs === 0 || r.overshootPercent >= 500;
    const score = isDegenerate ? -1000 : r.overshootPercent + r.ringingCount * 5;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Compute robust Y-axis domain using P1/P99 percentile bounds.
 * Excludes outlier spikes (e.g. corrupt 16866 deg/s setpoint values)
 * so they don't stretch the axis and hide real data.
 * Lines exceeding the domain are clipped at the boundary (BF Explorer style).
 */
export function computeRobustYDomain(values: number[]): [number, number] {
  if (values.length === 0) return [-100, 100];

  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.01)];
  const hi = sorted[Math.max(0, Math.ceil(sorted.length * 0.99) - 1)];

  const range = hi - lo || 1;
  const padding = range * 0.1;
  return [lo - padding, hi + padding];
}

/**
 * Downsample data arrays for chart performance.
 * Keeps every Nth point to limit total points to maxPoints.
 */
export function downsampleData<T>(data: T[], maxPoints: number): T[] {
  if (data.length <= maxPoints) return data;
  const step = Math.ceil(data.length / maxPoints);
  const result: T[] = [];
  for (let i = 0; i < data.length; i += step) {
    result.push(data[i]);
  }
  // Always include last point
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1]);
  }
  return result;
}

/**
 * Convert a CompactStepResponse (shared timeMs) to the per-axis format
 * used by TFStepResponseChart.
 */
export function compactToPerAxisStepResponse(compact: CompactStepResponse) {
  return {
    roll: { timeMs: compact.timeMs, response: compact.roll },
    pitch: { timeMs: compact.timeMs, response: compact.pitch },
    yaw: { timeMs: compact.timeMs, response: compact.yaw },
  };
}
