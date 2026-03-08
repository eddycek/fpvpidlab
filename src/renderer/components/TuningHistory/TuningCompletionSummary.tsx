import React, { useMemo } from 'react';
import type { TuningSession } from '@shared/types/tuning.types';
import { computeTuneQualityScore, TIER_LABELS } from '@shared/utils/tuneQualityScore';
import { TUNING_TYPE_LABELS } from '@shared/constants';
import { NoiseComparisonChart } from './NoiseComparisonChart';
import { AppliedChangesTable } from './AppliedChangesTable';
import './TuningCompletionSummary.css';

interface TuningCompletionSummaryProps {
  session: TuningSession;
  onDismiss: () => void;
  onStartNew: () => void;
  onReanalyzeVerification?: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'less than a minute';
  return `${mins} min`;
}

function flightCount(session: TuningSession): number {
  let count = 0;
  if (session.quickLogId) count++;
  if (session.filterLogId) count++;
  if (session.pidLogId) count++;
  if (session.verificationLogId) count++;
  return count;
}

function completionTitle(session: TuningSession): string {
  const label = TUNING_TYPE_LABELS[session.tuningType ?? 'guided'];
  return `${label} Complete`;
}

export function TuningCompletionSummary({
  session,
  onDismiss,
  onStartNew,
  onReanalyzeVerification,
}: TuningCompletionSummaryProps) {
  const hasVerification = !!session.verificationMetrics && !!session.filterMetrics;
  const filterChanges = session.appliedFilterChanges ?? [];
  const pidChanges = session.appliedPIDChanges ?? [];
  const ffChanges = session.appliedFeedforwardChanges ?? [];
  const score = useMemo(
    () =>
      computeTuneQualityScore({
        filterMetrics: session.filterMetrics,
        pidMetrics: session.pidMetrics,
        verificationMetrics: session.verificationMetrics,
      }),
    [session.filterMetrics, session.verificationMetrics, session.pidMetrics]
  );

  return (
    <div className="completion-summary">
      <div className="completion-summary-header">
        <div>
          <h3 className="completion-summary-title">
            {'\u2705'} {completionTitle(session)}
            {score && (
              <span className={`quality-score-badge quality-score-${score.tier}`}>
                {score.overall} {TIER_LABELS[score.tier]}
              </span>
            )}
          </h3>
          <div className="completion-summary-meta">
            <span>Started: {formatDate(session.startedAt)}</span>
            <span className="completion-meta-sep">{'\u2022'}</span>
            <span>Duration: {formatDuration(session.startedAt, session.updatedAt)}</span>
            <span className="completion-meta-sep">{'\u2022'}</span>
            <span>
              {flightCount(session)} flight{flightCount(session) !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {hasVerification && session.filterMetrics && session.verificationMetrics && (
        <>
          <NoiseComparisonChart
            before={session.filterMetrics}
            after={session.verificationMetrics}
          />
          {onReanalyzeVerification && session.verificationLogId && (
            <button className="completion-reanalyze-link" onClick={onReanalyzeVerification}>
              Re-analyze with different session
            </button>
          )}
        </>
      )}

      {!hasVerification && session.filterMetrics && (
        <div className="completion-noise-numeric">
          <h4>Filter Analysis</h4>
          <div className="completion-noise-stats">
            <span>Noise: {session.filterMetrics.noiseLevel}</span>
            <span className="completion-meta-sep">{'\u2022'}</span>
            <span>Roll {session.filterMetrics.roll.noiseFloorDb.toFixed(0)} dB</span>
            <span className="completion-meta-sep">{'\u2022'}</span>
            <span>Pitch {session.filterMetrics.pitch.noiseFloorDb.toFixed(0)} dB</span>
            <span className="completion-meta-sep">{'\u2022'}</span>
            <span>Yaw {session.filterMetrics.yaw.noiseFloorDb.toFixed(0)} dB</span>
          </div>
        </div>
      )}

      <div className="completion-changes-row">
        <AppliedChangesTable title="Filter Changes" changes={filterChanges} />
        <AppliedChangesTable title="PID Changes" changes={pidChanges} />
        {ffChanges.length > 0 && (
          <AppliedChangesTable title="Feedforward Changes" changes={ffChanges} />
        )}
      </div>

      {session.pidMetrics && (
        <div className="completion-pid-metrics">
          <h4>
            Step Response Metrics <span className="completion-pid-label">before PID changes</span>
          </h4>
          <div className="completion-pid-stats">
            <span>{session.pidMetrics.stepsDetected} steps detected</span>
          </div>
          <div className="completion-pid-axes">
            {(['roll', 'pitch', 'yaw'] as const).map((axis) => {
              const m = session.pidMetrics![axis];
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

      {!hasVerification && (
        <p className="completion-hint">
          Fly a verification hover next time to see a noise comparison chart.
        </p>
      )}

      <div className="completion-actions">
        <button className="wizard-btn wizard-btn-primary" onClick={onStartNew}>
          Start New Tuning Cycle
        </button>
        <button className="wizard-btn wizard-btn-secondary" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
