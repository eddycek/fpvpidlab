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
} from 'recharts';
import { AxisTabs, type AxisSelection } from './AxisTabs';
import {
  traceToRechartsData,
  downsampleData,
  findBestStep,
  computeRobustYDomain,
  AXIS_COLORS,
  type Axis,
} from './chartUtils';
import type { AxisStepProfile } from '@shared/types/analysis.types';
import './StepResponseChart.css';

interface StepResponseChartProps {
  roll: AxisStepProfile;
  pitch: AxisStepProfile;
  yaw: AxisStepProfile;
}

const MAX_CHART_POINTS = 600;
const MIN_HEIGHT = 300;
const ASPECT_RATIO = 7 / 3;

export function StepResponseChart({ roll, pitch, yaw }: StepResponseChartProps) {
  const profiles: Record<Axis, AxisStepProfile> = useMemo(
    () => ({ roll, pitch, yaw }),
    [roll, pitch, yaw]
  );
  const [selectedAxis, setSelectedAxis] = useState<AxisSelection>('roll');
  const [stepIndices, setStepIndices] = useState<Record<Axis, number>>(() => ({
    roll: findBestStep(roll.responses),
    pitch: findBestStep(pitch.responses),
    yaw: findBestStep(yaw.responses),
  }));

  // For "all" mode, we need to show the selected step for each axis
  const _visibleAxes: Axis[] = selectedAxis === 'all' ? ['roll', 'pitch', 'yaw'] : [selectedAxis];

  // Get trace data and robust Y-domain for single-axis mode
  const { chartData, singleYDomain } = useMemo(() => {
    if (selectedAxis === 'all') return { chartData: null, singleYDomain: undefined };
    const axis = selectedAxis;
    const idx = stepIndices[axis];
    const responses = profiles[axis].responses;
    if (idx < 0 || idx >= responses.length || !responses[idx].trace) {
      return { chartData: null, singleYDomain: undefined };
    }
    const data = downsampleData(traceToRechartsData(responses[idx]), MAX_CHART_POINTS);
    const values: number[] = [];
    for (const p of data) {
      if (p.setpoint !== undefined) values.push(p.setpoint);
      if (p.gyro !== undefined) values.push(p.gyro);
    }
    return { chartData: data, singleYDomain: computeRobustYDomain(values) as [number, number] };
  }, [selectedAxis, stepIndices, profiles]);

  // For "all" mode, show gyro traces overlaid (no setpoint to reduce clutter)
  // Negative steps are normalized (sign flipped) so all responses go upward for visual consistency
  const { allAxisData, allYDomain } = useMemo(() => {
    if (selectedAxis !== 'all') return { allAxisData: null, allYDomain: undefined };
    // Build merged dataset keyed by timeMs
    const timeMap = new Map<number, Record<string, number>>();
    for (const axis of ['roll', 'pitch', 'yaw'] as const) {
      const idx = stepIndices[axis];
      const responses = profiles[axis].responses;
      if (idx < 0 || idx >= responses.length || !responses[idx].trace) continue;
      const trace = responses[idx].trace!;
      // Flip sign for negative steps so all responses go in the same direction
      const sign = responses[idx].step.magnitude < 0 ? -1 : 1;
      for (let i = 0; i < trace.timeMs.length; i++) {
        const t = Math.round(trace.timeMs[i] * 100) / 100;
        if (!timeMap.has(t)) timeMap.set(t, { timeMs: t });
        timeMap.get(t)![axis] = Math.round(trace.gyro[i] * sign * 100) / 100;
      }
    }
    const raw = Array.from(timeMap.values()).sort((a, b) => a.timeMs - b.timeMs);
    const data = downsampleData(raw, MAX_CHART_POINTS);
    const values: number[] = [];
    for (const p of data) {
      for (const key of ['roll', 'pitch', 'yaw']) {
        const v = (p as Record<string, number>)[key];
        if (v !== undefined) values.push(v);
      }
    }
    return { allAxisData: data, allYDomain: computeRobustYDomain(values) as [number, number] };
  }, [selectedAxis, stepIndices, profiles]);

  const currentAxis = selectedAxis === 'all' ? 'roll' : selectedAxis;
  const currentResponses = profiles[currentAxis].responses;
  const currentIdx = stepIndices[currentAxis];
  const currentResponse =
    currentIdx >= 0 && currentIdx < currentResponses.length ? currentResponses[currentIdx] : null;

  const hasAnyTraces = ['roll', 'pitch', 'yaw'].some((axis) => {
    const p = profiles[axis as Axis];
    return p.responses.some((r) => r.trace);
  });

  if (!hasAnyTraces) {
    return <div className="step-chart-empty">No step response trace data available.</div>;
  }

  function navigateStep(axis: Axis, delta: number) {
    setStepIndices((prev) => {
      const responses = profiles[axis].responses;
      const newIdx = Math.max(0, Math.min(responses.length - 1, prev[axis] + delta));
      return { ...prev, [axis]: newIdx };
    });
  }

  return (
    <div className="step-response-chart">
      <AxisTabs selected={selectedAxis} onChange={setSelectedAxis} />

      {/* Step navigator */}
      {selectedAxis !== 'all' && currentResponses.length > 0 && (
        <div className="step-navigator">
          <button
            className="step-nav-btn"
            disabled={currentIdx <= 0}
            onClick={() => navigateStep(selectedAxis, -1)}
          >
            Prev
          </button>
          <span className="step-nav-label">
            Step {currentIdx + 1} / {currentResponses.length}
          </span>
          <button
            className="step-nav-btn"
            disabled={currentIdx >= currentResponses.length - 1}
            onClick={() => navigateStep(selectedAxis, 1)}
          >
            Next
          </button>
        </div>
      )}

      {/* Metrics overlay for single axis */}
      {selectedAxis !== 'all' && currentResponse && (
        <div className="step-metrics-overlay">
          <span className="step-metric">
            Overshoot: <strong>{currentResponse.overshootPercent.toFixed(1)}%</strong>
          </span>
          <span className="step-metric">
            Rise: <strong>{currentResponse.riseTimeMs.toFixed(0)} ms</strong>
          </span>
          <span className="step-metric">
            Settling: <strong>{currentResponse.settlingTimeMs.toFixed(0)} ms</strong>
          </span>
          <span className="step-metric">
            Latency: <strong>{currentResponse.latencyMs.toFixed(1)} ms</strong>
          </span>
        </div>
      )}

      <div className="step-chart-container">
        {selectedAxis !== 'all' && chartData && chartData.length > 0 ? (
          <ResponsiveContainer width="100%" aspect={ASPECT_RATIO} minHeight={MIN_HEIGHT}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
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
                domain={singleYDomain}
                allowDataOverflow={true}
                tick={{ fontSize: 11, fill: '#aaa' }}
                label={{
                  value: 'deg/s',
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
                  ((value: number | undefined, name: string) => [
                    `${(value ?? 0).toFixed(1)} deg/s`,
                    name,
                  ]) as any
                }
              />

              {/* Setpoint line (dashed white) */}
              <Line
                dataKey="setpoint"
                stroke="#fff"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                dot={false}
                isAnimationActive={false}
                name="setpoint"
              />

              {/* Gyro response (solid axis color) */}
              <Line
                dataKey="gyro"
                stroke={AXIS_COLORS[selectedAxis]}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                name="gyro"
              />

              {/* Steady state reference line */}
              {currentResponse && (
                <ReferenceLine
                  y={currentResponse.steadyStateValue}
                  stroke="#888"
                  strokeDasharray="5 5"
                  strokeOpacity={0.5}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        ) : selectedAxis === 'all' && allAxisData && allAxisData.length > 0 ? (
          <ResponsiveContainer width="100%" aspect={ASPECT_RATIO} minHeight={MIN_HEIGHT}>
            <LineChart data={allAxisData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
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
                domain={allYDomain}
                allowDataOverflow={true}
                tick={{ fontSize: 11, fill: '#aaa' }}
                label={{
                  value: 'deg/s',
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
              />

              {['roll', 'pitch', 'yaw'].map((axis) => (
                <Line
                  key={axis}
                  dataKey={axis}
                  stroke={AXIS_COLORS[axis as Axis]}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  name={axis}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="step-chart-empty">No trace data for this axis/step.</div>
        )}
      </div>
    </div>
  );
}
