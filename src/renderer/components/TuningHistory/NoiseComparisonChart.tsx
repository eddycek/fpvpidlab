import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { AxisTabs, type AxisSelection } from '../TuningWizard/charts/AxisTabs';
import { AXIS_COLORS, type Axis } from '../TuningWizard/charts/chartUtils';
import type { CompactSpectrum, FilterMetricsSummary } from '@shared/types/tuning-history.types';
import './NoiseComparisonChart.css';

interface NoiseComparisonChartProps {
  before: FilterMetricsSummary;
  after: FilterMetricsSummary;
}

interface ComparisonDataPoint {
  frequency: number;
  beforeRoll?: number;
  beforePitch?: number;
  beforeYaw?: number;
  afterRoll?: number;
  afterPitch?: number;
  afterYaw?: number;
}

const BEFORE_OPACITY = 0.45;
const AFTER_OPACITY = 1;
const MIN_HEIGHT = 260;
const ASPECT_RATIO = 700 / 260;
const DB_FLOOR = -80;

function buildChartData(before: CompactSpectrum, after: CompactSpectrum): ComparisonDataPoint[] {
  const data: ComparisonDataPoint[] = [];
  const len = Math.min(before.frequencies.length, after.frequencies.length);

  for (let i = 0; i < len; i++) {
    data.push({
      frequency: before.frequencies[i],
      beforeRoll: before.roll[i],
      beforePitch: before.pitch[i],
      beforeYaw: before.yaw[i],
      afterRoll: after.roll[i],
      afterPitch: after.pitch[i],
      afterYaw: after.yaw[i],
    });
  }

  return data;
}

/** Noise floor below this threshold is treated as "no data" (sentinel -240 dB) */
const NOISE_FLOOR_VALID_MIN = -100;

/** Estimate noise floor from compact spectrum data (25th percentile, same as NoiseAnalyzer) */
function estimateFromSpectrum(values: number[]): number | null {
  const valid = values.filter((v) => v > DB_FLOOR);
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.25)];
}

/** Get effective noise floor for an axis — use analysis value, or fallback to spectrum estimate */
function getNoiseFloorDb(metrics: FilterMetricsSummary, axis: Axis): number | null {
  const db = metrics[axis].noiseFloorDb;
  if (db > NOISE_FLOOR_VALID_MIN) return db;
  // Fallback: estimate from spectrum data
  if (!metrics.spectrum) return null;
  return estimateFromSpectrum(metrics.spectrum[axis]);
}

function computeDelta(
  before: FilterMetricsSummary,
  after: FilterMetricsSummary,
  axis: Axis
): number | null {
  const bDb = getNoiseFloorDb(before, axis);
  const aDb = getNoiseFloorDb(after, axis);
  if (bDb === null || aDb === null) return null;
  return aDb - bDb;
}

function avgNoiseFloor(metrics: FilterMetricsSummary): number | null {
  const vals = (['roll', 'pitch', 'yaw'] as const).map((a) => getNoiseFloorDb(metrics, a));
  const valid = vals.filter((v): v is number => v !== null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export function NoiseComparisonChart({ before, after }: NoiseComparisonChartProps) {
  const [selectedAxis, setSelectedAxis] = useState<AxisSelection>('roll');

  const { data, yDomain } = useMemo(() => {
    if (!before.spectrum || !after.spectrum) {
      return { data: [], yDomain: [-60, 0] as [number, number] };
    }

    const raw = buildChartData(before.spectrum, after.spectrum);

    let yMin = 0;
    let yMax = -Infinity;

    for (const p of raw) {
      const vals = [
        p.beforeRoll,
        p.beforePitch,
        p.beforeYaw,
        p.afterRoll,
        p.afterPitch,
        p.afterYaw,
      ];
      for (const v of vals) {
        if (v !== undefined && v > DB_FLOOR) {
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
        }
      }
    }

    if (yMax === -Infinity) {
      yMax = 0;
      yMin = -60;
    }

    return {
      data: raw,
      yDomain: [Math.max(yMin - 5, DB_FLOOR), yMax + 5] as [number, number],
    };
  }, [before, after]);

  const avgBefore = avgNoiseFloor(before);
  const avgAfter = avgNoiseFloor(after);
  const hasDelta = avgBefore !== null && avgAfter !== null;
  const delta = hasDelta ? Math.round(avgAfter - avgBefore) : 0;
  const improved = delta < 0;

  const visibleAxes: Axis[] = selectedAxis === 'all' ? ['roll', 'pitch', 'yaw'] : [selectedAxis];

  if (data.length === 0) {
    return <div className="noise-comparison-empty">No spectrum data available for comparison.</div>;
  }

  return (
    <div className="noise-comparison-chart">
      <div className="noise-comparison-header">
        <h4>Noise Comparison</h4>
        {hasDelta && (
          <span className={`noise-delta-pill ${improved ? 'improved' : 'regressed'}`}>
            {improved ? '\u2193' : '\u2191'} {Math.abs(delta)} dB{' '}
            {improved ? 'improvement' : 'regression'}
          </span>
        )}
      </div>

      <AxisTabs selected={selectedAxis} onChange={setSelectedAxis} />

      <div className="noise-comparison-container">
        <ResponsiveContainer width="100%" aspect={ASPECT_RATIO} minHeight={MIN_HEIGHT}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="frequency"
              type="number"
              tick={{ fontSize: 11, fill: '#aaa' }}
              label={{
                value: 'Frequency (Hz)',
                position: 'insideBottom',
                offset: -2,
                style: { fontSize: 11, fill: '#888' },
              }}
            />
            <YAxis
              domain={yDomain}
              allowDataOverflow
              tickFormatter={(v: number) => (Number.isFinite(v) ? v.toFixed(0) : '')}
              tick={{ fontSize: 11, fill: '#aaa' }}
              label={{
                value: 'Noise (dB)',
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 11, fill: '#888' },
              }}
            />
            <Tooltip
              contentStyle={{
                background: '#1a1a1a',
                border: '1px solid #444',
                borderRadius: 4,
                fontSize: 12,
              }}
              labelFormatter={(val) => `${val} Hz`}
              formatter={
                ((value: number | undefined, name: string) => [
                  `${(value ?? 0).toFixed(1)} dB`,
                  name,
                ]) as any
              }
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />

            {visibleAxes.map((axis) => {
              const beforeKey =
                `before${axis[0].toUpperCase()}${axis.slice(1)}` as keyof ComparisonDataPoint;
              const afterKey =
                `after${axis[0].toUpperCase()}${axis.slice(1)}` as keyof ComparisonDataPoint;

              return (
                <React.Fragment key={axis}>
                  <Line
                    dataKey={beforeKey}
                    stroke={AXIS_COLORS[axis]}
                    strokeWidth={1.5}
                    strokeOpacity={BEFORE_OPACITY}
                    strokeDasharray="4 2"
                    dot={false}
                    isAnimationActive={false}
                    name={`${axis} (before)`}
                  />
                  <Line
                    dataKey={afterKey}
                    stroke={AXIS_COLORS[axis]}
                    strokeWidth={2}
                    strokeOpacity={AFTER_OPACITY}
                    dot={false}
                    isAnimationActive={false}
                    name={`${axis} (after)`}
                  />
                </React.Fragment>
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="noise-comparison-floors">
        {(['roll', 'pitch', 'yaw'] as const).map((axis) => {
          const bDb = getNoiseFloorDb(before, axis);
          const aDb = getNoiseFloorDb(after, axis);
          const d = computeDelta(before, after, axis);
          return (
            <span key={axis} className="noise-floor-item" style={{ color: AXIS_COLORS[axis] }}>
              {axis}: {bDb !== null ? bDb.toFixed(0) : '—'}
              {'\u2192'}
              {aDb !== null ? aDb.toFixed(0) : '—'} dB
              {d !== null && ` (${d < 0 ? '\u2193' : '\u2191'}${Math.abs(Math.round(d))})`}
            </span>
          );
        })}
      </div>
    </div>
  );
}
