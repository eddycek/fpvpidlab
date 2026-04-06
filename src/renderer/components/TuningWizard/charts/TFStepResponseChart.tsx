import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from 'recharts';
import { AxisTabs, type AxisSelection } from './AxisTabs';
import { AXIS_COLORS, type Axis } from './chartUtils';
import type { CompactStepResponse } from '@shared/types/tuning-history.types';
import './TFStepResponseChart.css';

/** Full per-axis format from PIDAnalysisResult.transferFunction.syntheticStepResponse */
interface PerAxisStepResponse {
  roll: { timeMs: number[]; response: number[] };
  pitch: { timeMs: number[]; response: number[] };
  yaw: { timeMs: number[]; response: number[] };
}

type StepResponseData = PerAxisStepResponse | CompactStepResponse;

/** Per-axis overshoot values (from PID metrics, more accurate than trace-derived) */
interface AxisOvershoot {
  roll: number;
  pitch: number;
  yaw: number;
}

interface TFStepResponseChartProps {
  /** Current / "after" step response data */
  stepResponse: StepResponseData;
  /** Optional "before" step response data for comparison mode */
  beforeStepResponse?: StepResponseData;
  /** Override overshoot values (from PID metrics) instead of computing from trace */
  overshootAfterOverride?: AxisOvershoot;
  /** Override overshoot values for "before" data */
  overshootBeforeOverride?: AxisOvershoot;
  /** Hide the built-in h4 header (when parent already renders one) */
  hideHeader?: boolean;
}

interface ChartDataPoint {
  timeMs: number;
  roll?: number;
  pitch?: number;
  yaw?: number;
  beforeRoll?: number;
  beforePitch?: number;
  beforeYaw?: number;
}

const MIN_HEIGHT = 260;
const ASPECT_RATIO = 700 / 260;
const BEFORE_OPACITY = 0.35;
const MAX_CHART_POINTS = 500;

/** Check if data is in compact format (shared timeMs array) */
function isCompact(data: StepResponseData): data is CompactStepResponse {
  return 'timeMs' in data && Array.isArray((data as CompactStepResponse).timeMs);
}

/** Normalize to per-axis format */
function toPerAxis(data: StepResponseData): PerAxisStepResponse {
  if (!isCompact(data)) return data;
  return {
    roll: { timeMs: data.timeMs, response: data.roll },
    pitch: { timeMs: data.timeMs, response: data.pitch },
    yaw: { timeMs: data.timeMs, response: data.yaw },
  };
}

/** Compute overshoot % from a response array (max value above 1.0 for normalized data) */
function computeOvershoot(response: number[]): number {
  if (response.length === 0) return 0;
  const peak = Math.max(...response);
  return Math.max(0, (peak - 1) * 100);
}

function buildChartData(
  after: PerAxisStepResponse,
  before?: PerAxisStepResponse
): ChartDataPoint[] {
  const timeMap = new Map<number, ChartDataPoint>();

  // Add "after" data
  for (const axis of ['roll', 'pitch', 'yaw'] as const) {
    const { timeMs, response } = after[axis];
    for (let i = 0; i < timeMs.length; i++) {
      const t = Math.round(timeMs[i] * 100) / 100;
      if (!timeMap.has(t)) timeMap.set(t, { timeMs: t });
      timeMap.get(t)![axis] = Math.round(response[i] * 10000) / 10000;
    }
  }

  // Add "before" data if present
  if (before) {
    for (const axis of ['roll', 'pitch', 'yaw'] as const) {
      const { timeMs, response } = before[axis];
      const beforeKey = `before${axis[0].toUpperCase()}${axis.slice(1)}` as keyof ChartDataPoint;
      for (let i = 0; i < timeMs.length; i++) {
        const t = Math.round(timeMs[i] * 100) / 100;
        if (!timeMap.has(t)) timeMap.set(t, { timeMs: t });

        (timeMap.get(t)! as any)[beforeKey] = Math.round(response[i] * 10000) / 10000;
      }
    }
  }

  const sorted = Array.from(timeMap.values()).sort((a, b) => a.timeMs - b.timeMs);

  // Downsample if too many points
  if (sorted.length > MAX_CHART_POINTS) {
    const step = Math.ceil(sorted.length / MAX_CHART_POINTS);
    return sorted.filter((_, i) => i % step === 0);
  }

  return sorted;
}

export function TFStepResponseChart({
  stepResponse,
  beforeStepResponse,
  overshootAfterOverride,
  overshootBeforeOverride,
  hideHeader,
}: TFStepResponseChartProps) {
  const [selectedAxis, setSelectedAxis] = useState<AxisSelection>('all');

  const after = useMemo(() => toPerAxis(stepResponse), [stepResponse]);
  const before = useMemo(
    () => (beforeStepResponse ? toPerAxis(beforeStepResponse) : undefined),
    [beforeStepResponse]
  );
  const isComparison = !!before;

  const data = useMemo(() => buildChartData(after, before), [after, before]);

  const visibleAxes: Axis[] = selectedAxis === 'all' ? ['roll', 'pitch', 'yaw'] : [selectedAxis];

  // Compute Y-axis domain from data — constrained to a sensible step response range
  const yDomain = useMemo((): [number, number] => {
    let dataMin = Infinity;
    let dataMax = -Infinity;
    for (const pt of data) {
      for (const axis of ['roll', 'pitch', 'yaw'] as const) {
        if (pt[axis] !== undefined) {
          dataMin = Math.min(dataMin, pt[axis]!);
          dataMax = Math.max(dataMax, pt[axis]!);
        }
        const beforeKey = `before${axis[0].toUpperCase()}${axis.slice(1)}` as keyof ChartDataPoint;
        const bv = pt[beforeKey] as number | undefined;
        if (bv !== undefined) {
          dataMin = Math.min(dataMin, bv);
          dataMax = Math.max(dataMax, bv);
        }
      }
    }
    if (!isFinite(dataMin)) dataMin = -0.1;
    if (!isFinite(dataMax)) dataMax = 1.3;
    return [Math.min(-0.1, dataMin - 0.05), Math.max(1.3, dataMax + 0.05)];
  }, [data]);

  // Compute overshoot metrics — use overrides (from PID metrics) when provided,
  // fall back to trace-derived computation (works for TF synthetic step responses)
  const overshootAfter = useMemo(
    () =>
      overshootAfterOverride ?? {
        roll: computeOvershoot(after.roll.response),
        pitch: computeOvershoot(after.pitch.response),
        yaw: computeOvershoot(after.yaw.response),
      },
    [after, overshootAfterOverride]
  );

  const overshootBefore = useMemo(
    () =>
      overshootBeforeOverride ??
      (before
        ? {
            roll: computeOvershoot(before.roll.response),
            pitch: computeOvershoot(before.pitch.response),
            yaw: computeOvershoot(before.yaw.response),
          }
        : null),
    [before, overshootBeforeOverride]
  );

  // Delta pill for comparison mode
  const avgOvershootAfter = (overshootAfter.roll + overshootAfter.pitch + overshootAfter.yaw) / 3;
  const avgOvershootBefore = overshootBefore
    ? (overshootBefore.roll + overshootBefore.pitch + overshootBefore.yaw) / 3
    : 0;
  const delta = isComparison ? avgOvershootAfter - avgOvershootBefore : 0;
  const improved = delta < -1;
  const regressed = delta > 1;

  if (data.length === 0) {
    return <div className="tf-step-response-empty">No synthetic step response data available.</div>;
  }

  return (
    <div className="tf-step-response-chart">
      <div className="tf-step-response-header">
        {!hideHeader && (
          <h4>{isComparison ? 'Step Response Comparison' : 'Synthetic Step Response'}</h4>
        )}
        {isComparison && (
          <span
            className={`tf-overshoot-delta-pill ${improved ? 'improved' : regressed ? 'regressed' : 'neutral'}`}
          >
            {improved ? '' : regressed ? '+' : ''}
            {delta.toFixed(1)}% overshoot
          </span>
        )}
      </div>

      <AxisTabs selected={selectedAxis} onChange={setSelectedAxis} />

      {/* Overshoot metrics */}
      <div className="tf-step-metrics-overlay">
        {visibleAxes.map((axis) => (
          <span
            key={axis}
            className="tf-step-metric"
            style={{ borderLeft: `3px solid ${AXIS_COLORS[axis]}` }}
          >
            {axis} overshoot: <strong>{overshootAfter[axis].toFixed(1)}%</strong>
          </span>
        ))}
      </div>

      {/* Per-axis before → after overshoot comparison */}
      {isComparison && overshootBefore && (
        <div className="tf-step-axis-comparison">
          {visibleAxes.map((axis) => {
            const beforeVal = overshootBefore[axis];
            const afterVal = overshootAfter[axis];
            const change = afterVal - beforeVal;
            const sign = change > 0 ? '+' : '';
            return (
              <span key={axis} className="tf-step-axis-delta">
                {axis}: {beforeVal.toFixed(1)}%{' \u2192 '}
                {afterVal.toFixed(1)}%{' '}
                <span className={change < -1 ? 'improved' : change > 1 ? 'regressed' : 'neutral'}>
                  ({sign}
                  {change.toFixed(1)}%)
                </span>
              </span>
            );
          })}
        </div>
      )}

      <div className="tf-step-response-container">
        <ResponsiveContainer width="100%" aspect={ASPECT_RATIO} minHeight={MIN_HEIGHT}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="timeMs"
              type="number"
              tick={{ fontSize: 11, fill: '#aaa' }}
              label={{
                value: 'Time (ms)',
                position: 'insideBottom',
                offset: -2,
                style: { fontSize: 11, fill: '#888' },
              }}
            />
            <YAxis
              domain={yDomain}
              tick={{ fontSize: 11, fill: '#aaa' }}
              label={{
                value: 'Response',
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
              labelFormatter={(val) => `${val} ms`}
              formatter={
                ((value: number | undefined, name: string) => {
                  const capitalized = name.replace(/^\w/, (c) => c.toUpperCase());
                  return [`${(value ?? 0).toFixed(2)}`, capitalized];
                }) as any
              }
            />
            {isComparison && <Legend wrapperStyle={{ fontSize: 11 }} />}

            {/* Target reference line at y=1.0 */}
            <ReferenceLine
              y={1}
              stroke="#888"
              strokeDasharray="5 5"
              strokeOpacity={0.6}
              label={{ value: 'target', position: 'right', fill: '#888', fontSize: 10 }}
            />

            {/* Before lines (dashed, lower opacity) — comparison mode only */}
            {isComparison &&
              visibleAxes.map((axis) => {
                const beforeKey =
                  `before${axis[0].toUpperCase()}${axis.slice(1)}` as keyof ChartDataPoint;
                return (
                  <Line
                    key={`before-${axis}`}
                    dataKey={beforeKey}
                    stroke={AXIS_COLORS[axis]}
                    strokeWidth={1}
                    strokeOpacity={BEFORE_OPACITY}
                    strokeDasharray="6 4"
                    dot={false}
                    isAnimationActive={false}
                    name={`${axis} (before)`}
                  />
                );
              })}

            {/* After / current lines (solid) */}
            {visibleAxes.map((axis) => (
              <Line
                key={axis}
                dataKey={axis}
                stroke={AXIS_COLORS[axis]}
                strokeWidth={isComparison ? 2.5 : 2}
                dot={false}
                isAnimationActive={false}
                name={isComparison ? `${axis} (after)` : axis}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
