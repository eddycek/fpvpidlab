import React, { useMemo } from 'react';
import type { CompletedTuningRecord } from '@shared/types/tuning-history.types';
import { computeTuneQualityScore } from '@shared/utils/tuneQualityScore';
import { NoiseComparisonChart } from './NoiseComparisonChart';
import { OvershootComparison } from './TuningCompletionSummary';
import { AppliedChangesTable } from './AppliedChangesTable';

interface TuningSessionDetailProps {
  record: CompletedTuningRecord;
  onReanalyzeVerification?: () => void;
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'less than a minute';
  return `${mins} min`;
}

function flightCount(record: CompletedTuningRecord): number {
  let count = 0;
  if (record.quickLogId) count++;
  if (record.filterLogId) count++;
  if (record.pidLogId) count++;
  if (record.verificationLogId) count++;
  return count;
}

export function TuningSessionDetail({ record, onReanalyzeVerification }: TuningSessionDetailProps) {
  const hasComparison = !!record.filterMetrics?.spectrum && !!record.verificationMetrics?.spectrum;
  const score = useMemo(
    () =>
      computeTuneQualityScore({
        filterMetrics: record.filterMetrics,
        pidMetrics: record.pidMetrics,
        verificationMetrics: record.verificationMetrics,
        transferFunctionMetrics: record.transferFunctionMetrics,
      }),
    [
      record.filterMetrics,
      record.verificationMetrics,
      record.pidMetrics,
      record.transferFunctionMetrics,
    ]
  );
  const flights = flightCount(record);

  return (
    <div className="session-detail">
      <div className="completion-summary-meta">
        <span>Duration: {formatDuration(record.startedAt, record.completedAt)}</span>
        <span className="completion-meta-sep">{'\u2022'}</span>
        <span>
          {flights} flight{flights !== 1 ? 's' : ''}
        </span>
      </div>

      {score && (
        <div className="session-detail-score-breakdown">
          {score.components.map((c) => (
            <div key={c.label} className="score-breakdown-row">
              <span className="score-breakdown-label">{c.label}</span>
              <div className="score-breakdown-bar-track">
                <div
                  className="score-breakdown-bar-fill"
                  style={{ width: `${(c.score / c.maxPoints) * 100}%` }}
                />
              </div>
              <span className="score-breakdown-value">
                {c.score}/{c.maxPoints}
              </span>
            </div>
          ))}
        </div>
      )}

      {hasComparison && record.filterMetrics && record.verificationMetrics && (
        <>
          <NoiseComparisonChart before={record.filterMetrics} after={record.verificationMetrics} />
          {record.transferFunctionMetrics && record.verificationTransferFunctionMetrics && (
            <OvershootComparison
              before={record.transferFunctionMetrics}
              after={record.verificationTransferFunctionMetrics}
            />
          )}
          {onReanalyzeVerification && (
            <button className="completion-reanalyze-link" onClick={onReanalyzeVerification}>
              Re-analyze with different session
            </button>
          )}
        </>
      )}

      {!hasComparison && record.filterMetrics && (
        <div className="completion-noise-numeric">
          <div className="completion-noise-stats">
            <span>Noise: {record.filterMetrics.noiseLevel}</span>
            <span className="completion-meta-sep">{'\u2022'}</span>
            <span>Roll {record.filterMetrics.roll.noiseFloorDb.toFixed(0)} dB</span>
            <span className="completion-meta-sep">{'\u2022'}</span>
            <span>Pitch {record.filterMetrics.pitch.noiseFloorDb.toFixed(0)} dB</span>
            <span className="completion-meta-sep">{'\u2022'}</span>
            <span>Yaw {record.filterMetrics.yaw.noiseFloorDb.toFixed(0)} dB</span>
          </div>
        </div>
      )}

      <div className="completion-changes-row">
        <AppliedChangesTable title="Filter Changes" changes={record.appliedFilterChanges} />
        <AppliedChangesTable title="PID Changes" changes={record.appliedPIDChanges} />
        {record.appliedFeedforwardChanges.length > 0 && (
          <AppliedChangesTable
            title="Feedforward Changes"
            changes={record.appliedFeedforwardChanges}
          />
        )}
      </div>

      {record.pidMetrics && (
        <div className="completion-pid-metrics">
          <h4>
            Step Response Metrics <span className="completion-pid-label">before PID changes</span>
          </h4>
          <div className="completion-pid-stats">
            <span>{record.pidMetrics.stepsDetected} steps detected</span>
          </div>
          <div className="completion-pid-axes">
            {(['roll', 'pitch', 'yaw'] as const).map((axis) => {
              const m = record.pidMetrics![axis];
              return (
                <div key={axis} className="completion-pid-axis">
                  <strong>{axis[0].toUpperCase() + axis.slice(1)}</strong>
                  <span>Overshoot: {m.meanOvershoot.toFixed(1)}%</span>
                  <span>Rise: {m.meanRiseTimeMs.toFixed(0)}ms</span>
                  <span>Settling: {m.meanSettlingTimeMs.toFixed(0)}ms</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
