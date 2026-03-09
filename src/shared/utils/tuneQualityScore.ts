/**
 * Compute a 0-100 tune quality score from filter, PID, and transfer function metrics.
 *
 * Up to 5 components, linear interpolation with clamp.
 * Missing components are redistributed evenly among available ones.
 *
 * Deep Tune (step response): Noise Floor, Tracking RMS, Overshoot, Settling Time, [Noise Delta]
 * Flash Tune (transfer function): Noise Floor, Overshoot (from TF synthetic step), [Noise Delta]
 *
 * Overshoot is a unified metric — Deep Tune sources it from step response measurements,
 * Flash Tune sources it from the TF-derived synthetic step response. Both measure the
 * same physical property (how much the system overshoots a target), making scores comparable.
 */

import type {
  FilterMetricsSummary,
  PIDMetricsSummary,
  TransferFunctionMetricsSummary,
  TuneQualityScore,
  TuneQualityComponent,
} from '../types/tuning-history.types';

export const TIER_LABELS: Record<TuneQualityScore['tier'], string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

interface ComponentDef {
  label: string;
  getValue: (
    filter: FilterMetricsSummary | null | undefined,
    pid: PIDMetricsSummary | null | undefined,
    verification?: FilterMetricsSummary | null | undefined,
    tf?: TransferFunctionMetricsSummary | null | undefined
  ) => number | undefined;
  /** Value that yields full score */
  best: number;
  /** Value that yields zero score */
  worst: number;
}

const COMPONENTS: ComponentDef[] = [
  {
    label: 'Noise Floor',
    getValue: (filter, _pid, verification) => {
      // Use verification noise floor (final state) when available
      const source = verification ?? filter;
      if (!source) return undefined;
      return (source.roll.noiseFloorDb + source.pitch.noiseFloorDb + source.yaw.noiseFloorDb) / 3;
    },
    best: -60,
    worst: -20,
  },
  {
    label: 'Tracking RMS',
    getValue: (_filter, pid) => {
      if (!pid || pid.stepsDetected === 0) return undefined;
      const vals = [
        pid.roll.meanTrackingErrorRMS,
        pid.pitch.meanTrackingErrorRMS,
        pid.yaw.meanTrackingErrorRMS,
      ];
      if (vals.every((v) => v === undefined)) return undefined;
      const valid = vals.filter((v): v is number => v !== undefined);
      if (valid.length === 0) return undefined;
      return valid.reduce((a, b) => a + b, 0) / valid.length;
    },
    best: 0,
    worst: 0.5,
  },
  {
    label: 'Overshoot',
    getValue: (_filter, pid, _verification, tf) => {
      // Deep Tune: step-based overshoot (preferred when available)
      if (pid && pid.stepsDetected > 0) {
        return (pid.roll.meanOvershoot + pid.pitch.meanOvershoot + pid.yaw.meanOvershoot) / 3;
      }
      // Flash Tune: TF-derived overshoot from synthetic step response
      if (tf) {
        return (tf.roll.overshootPercent + tf.pitch.overshootPercent + tf.yaw.overshootPercent) / 3;
      }
      return undefined;
    },
    best: 0,
    worst: 50,
  },
  {
    label: 'Settling Time',
    getValue: (_filter, pid) => {
      if (!pid || pid.stepsDetected === 0) return undefined;
      return (
        (pid.roll.meanSettlingTimeMs + pid.pitch.meanSettlingTimeMs + pid.yaw.meanSettlingTimeMs) /
        3
      );
    },
    best: 50,
    worst: 500,
  },
  {
    label: 'Noise Delta',
    getValue: (filter, _pid, verification) => {
      // Only available when both filter-flight and verification-flight data exist
      if (!filter || !verification) return undefined;
      const filterAvg =
        (filter.roll.noiseFloorDb + filter.pitch.noiseFloorDb + filter.yaw.noiseFloorDb) / 3;
      const verificationAvg =
        (verification.roll.noiseFloorDb +
          verification.pitch.noiseFloorDb +
          verification.yaw.noiseFloorDb) /
        3;
      // Negative delta = improvement (verification cleaner), positive = regression
      return verificationAvg - filterAvg;
    },
    // -10 dB improvement → full score, +5 dB regression → zero
    best: -10,
    worst: 5,
  },
];

function linearScore(value: number, best: number, worst: number, maxPoints: number): number {
  if (best === worst) return maxPoints;
  // Normalize: 0 = worst, 1 = best
  const t = (value - worst) / (best - worst);
  return Math.round(Math.max(0, Math.min(1, t)) * maxPoints);
}

function tierFromScore(score: number): TuneQualityScore['tier'] {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

export function computeTuneQualityScore(metrics: {
  filterMetrics: FilterMetricsSummary | null | undefined;
  pidMetrics?: PIDMetricsSummary | null | undefined;
  verificationMetrics?: FilterMetricsSummary | null | undefined;
  transferFunctionMetrics?: TransferFunctionMetricsSummary | null | undefined;
}): TuneQualityScore | null {
  const { filterMetrics, pidMetrics, verificationMetrics, transferFunctionMetrics } = metrics;

  if (!filterMetrics && !pidMetrics) return null;

  // Determine which components have data
  const available: { def: ComponentDef; rawValue: number }[] = [];
  for (const def of COMPONENTS) {
    const val = def.getValue(
      filterMetrics,
      pidMetrics,
      verificationMetrics,
      transferFunctionMetrics
    );
    if (val !== undefined) {
      available.push({ def, rawValue: val });
    }
  }

  if (available.length === 0) return null;

  // Redistribute 100 points evenly among available components
  const maxPerComponent = Math.round(100 / available.length);

  const components: TuneQualityComponent[] = available.map(({ def, rawValue }) => ({
    label: def.label,
    score: linearScore(rawValue, def.best, def.worst, maxPerComponent),
    maxPoints: maxPerComponent,
    rawValue: Math.round(rawValue * 100) / 100,
  }));

  const overall = Math.min(
    100,
    components.reduce((sum, c) => sum + c.score, 0)
  );

  return {
    overall,
    tier: tierFromScore(overall),
    components,
  };
}
