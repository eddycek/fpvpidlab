import React from 'react';
import type { PIDMetricsSummary } from '@shared/types/tuning-history.types';
import { TFStepResponseChart } from '../TuningWizard/charts/TFStepResponseChart';

interface StepResponseComparisonProps {
  before: PIDMetricsSummary;
  after: PIDMetricsSummary;
}

const axes = ['roll', 'pitch', 'yaw'] as const;

function delta(a: number, b: number): string {
  const d = b - a;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}`;
}

function deltaClass(d: number, lowerIsBetter: boolean): string {
  const improved = lowerIsBetter ? d < -1 : d > 1;
  const regressed = lowerIsBetter ? d > 1 : d < -1;
  return improved ? 'improved' : regressed ? 'regressed' : 'neutral';
}

export function StepResponseComparison({ before, after }: StepResponseComparisonProps) {
  const beforeAvgOS =
    (before.roll.meanOvershoot + before.pitch.meanOvershoot + before.yaw.meanOvershoot) / 3;
  const afterAvgOS =
    (after.roll.meanOvershoot + after.pitch.meanOvershoot + after.yaw.meanOvershoot) / 3;
  const osDelta = afterAvgOS - beforeAvgOS;
  const osImproved = osDelta < -1;
  const osRegressed = osDelta > 1;

  return (
    <div className="completion-overshoot-comparison">
      <h4>Step Response Comparison</h4>
      {after.stepResponse && (
        <TFStepResponseChart
          stepResponse={after.stepResponse}
          beforeStepResponse={before.stepResponse}
          hideHeader
          overshootAfterOverride={{
            roll: after.roll.meanOvershoot,
            pitch: after.pitch.meanOvershoot,
            yaw: after.yaw.meanOvershoot,
          }}
          overshootBeforeOverride={{
            roll: before.roll.meanOvershoot,
            pitch: before.pitch.meanOvershoot,
            yaw: before.yaw.meanOvershoot,
          }}
        />
      )}

      <div className="overshoot-delta-row">
        <span className="overshoot-delta-label">Overshoot</span>
        <span
          className={`overshoot-delta-pill ${osImproved ? 'improved' : osRegressed ? 'regressed' : 'neutral'}`}
        >
          {osDelta > 0 ? '+' : ''}
          {osDelta.toFixed(1)}%
        </span>
      </div>
      <div className="overshoot-axis-grid">
        {axes.map((axis) => {
          const b = before[axis];
          const a = after[axis];
          return (
            <div key={axis} className="overshoot-axis-item">
              <span className="overshoot-axis-label">{axis}</span>
              <div className="step-comparison-metrics">
                <span className="step-comparison-row">
                  <span className="step-comparison-metric-label">Overshoot</span>
                  <span className="overshoot-axis-values">
                    {b.meanOvershoot.toFixed(1)}% → {a.meanOvershoot.toFixed(1)}%
                  </span>
                  <span
                    className={`overshoot-axis-delta ${deltaClass(a.meanOvershoot - b.meanOvershoot, true)}`}
                  >
                    {delta(b.meanOvershoot, a.meanOvershoot)}%
                  </span>
                </span>
                <span className="step-comparison-row">
                  <span className="step-comparison-metric-label">Rise</span>
                  <span className="overshoot-axis-values">
                    {b.meanRiseTimeMs.toFixed(0)}ms → {a.meanRiseTimeMs.toFixed(0)}ms
                  </span>
                  <span
                    className={`overshoot-axis-delta ${deltaClass(a.meanRiseTimeMs - b.meanRiseTimeMs, true)}`}
                  >
                    {delta(b.meanRiseTimeMs, a.meanRiseTimeMs)}ms
                  </span>
                </span>
                <span className="step-comparison-row">
                  <span className="step-comparison-metric-label">Settling</span>
                  <span className="overshoot-axis-values">
                    {b.meanSettlingTimeMs.toFixed(0)}ms → {a.meanSettlingTimeMs.toFixed(0)}ms
                  </span>
                  <span
                    className={`overshoot-axis-delta ${deltaClass(a.meanSettlingTimeMs - b.meanSettlingTimeMs, true)}`}
                  >
                    {delta(b.meanSettlingTimeMs, a.meanSettlingTimeMs)}ms
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
