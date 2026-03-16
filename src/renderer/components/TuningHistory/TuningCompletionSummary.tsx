import React, { useMemo } from 'react';
import type { TuningSession } from '@shared/types/tuning.types';
import type { TransferFunctionMetricsSummary } from '@shared/types/tuning-history.types';
import { computeTuneQualityScore, TIER_LABELS } from '@shared/utils/tuneQualityScore';
import { TUNING_TYPE, TUNING_TYPE_LABELS } from '@shared/constants';
import { METRIC_TOOLTIPS } from '@shared/constants/metricTooltips';
import { NoiseComparisonChart } from './NoiseComparisonChart';
import { SpectrogramComparisonChart } from './SpectrogramComparisonChart';
import { StepResponseComparison } from './StepResponseComparison';
import { TFStepResponseChart } from '../TuningWizard/charts/TFStepResponseChart';
import { ThrottleSpectrogramChart } from '../TuningWizard/charts/ThrottleSpectrogramChart';
import { compactToPerAxisStepResponse } from '../TuningWizard/charts/chartUtils';
import { AppliedChangesTable } from './AppliedChangesTable';
import { ReportIssueButton } from '../DiagnosticReport/ReportIssueButton';
import './TuningCompletionSummary.css';

export function OvershootComparison({
  before,
  after,
}: {
  before: TransferFunctionMetricsSummary;
  after: TransferFunctionMetricsSummary;
}) {
  const axes = ['roll', 'pitch', 'yaw'] as const;
  const beforeAvg =
    (before.roll.overshootPercent + before.pitch.overshootPercent + before.yaw.overshootPercent) /
    3;
  const afterAvg =
    (after.roll.overshootPercent + after.pitch.overshootPercent + after.yaw.overshootPercent) / 3;
  const delta = afterAvg - beforeAvg;
  const improved = delta < -1;
  const regressed = delta > 1;

  return (
    <div className="completion-overshoot-comparison">
      <h4>PID Performance Comparison</h4>
      <div className="overshoot-delta-row">
        <span className="overshoot-delta-label">Overshoot</span>
        <span
          className={`overshoot-delta-pill ${improved ? 'improved' : regressed ? 'regressed' : 'neutral'}`}
        >
          {improved ? '' : regressed ? '+' : ''}
          {delta.toFixed(1)}%
        </span>
      </div>
      <div className="overshoot-axis-grid">
        {axes.map((axis) => {
          const b = before[axis].overshootPercent;
          const a = after[axis].overshootPercent;
          const d = a - b;
          return (
            <div key={axis} className="overshoot-axis-item">
              <span className="overshoot-axis-label">{axis}</span>
              <span className="overshoot-axis-values">
                {b.toFixed(1)}% → {a.toFixed(1)}%
              </span>
              <span
                className={`overshoot-axis-delta ${d < -1 ? 'improved' : d > 1 ? 'regressed' : 'neutral'}`}
              >
                {d < 0 ? '' : '+'}
                {d.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface TuningCompletionSummaryProps {
  session: TuningSession;
  onDismiss: () => void;
  onStartNew: () => void;
  onStartPidTune?: () => void;
  onReanalyzeVerification?: () => void;
  /** Record ID for diagnostic report (from latest history record) */
  historyRecordId?: string;
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
  const label = TUNING_TYPE_LABELS[session.tuningType ?? TUNING_TYPE.FILTER];
  return `${label} Complete`;
}

export function TuningCompletionSummary({
  session,
  onDismiss,
  onStartNew,
  onStartPidTune,
  onReanalyzeVerification,
  historyRecordId,
}: TuningCompletionSummaryProps) {
  const isFilterTune = session.tuningType === TUNING_TYPE.FILTER || !session.tuningType;
  const isPidTune = session.tuningType === TUNING_TYPE.PID;
  const isFlashTune = session.tuningType === TUNING_TYPE.FLASH;

  const hasFilterVerification = !!session.verificationMetrics && !!session.filterMetrics;
  const hasPidVerification = !!session.verificationPidMetrics && !!session.pidMetrics;
  const hasAnyVerification =
    hasFilterVerification || hasPidVerification || !!session.verificationLogId;

  const filterChanges = session.appliedFilterChanges ?? [];
  const pidChanges = session.appliedPIDChanges ?? [];
  const ffChanges = session.appliedFeedforwardChanges ?? [];
  const score = useMemo(
    () =>
      computeTuneQualityScore({
        filterMetrics: session.filterMetrics,
        pidMetrics: session.pidMetrics,
        verificationMetrics: session.verificationMetrics,
        transferFunctionMetrics: session.transferFunctionMetrics,
      }),
    [
      session.filterMetrics,
      session.verificationMetrics,
      session.pidMetrics,
      session.transferFunctionMetrics,
    ]
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

      {/* Filter Tune / Flash Tune: noise spectrum comparison */}
      {hasFilterVerification && session.filterMetrics && session.verificationMetrics && (
        <>
          <NoiseComparisonChart
            before={session.filterMetrics}
            after={session.verificationMetrics}
          />
          {/* Flash Tune only: TF step response comparison */}
          {isFlashTune &&
            session.transferFunctionMetrics &&
            session.verificationTransferFunctionMetrics &&
            (session.transferFunctionMetrics.stepResponse &&
            session.verificationTransferFunctionMetrics.stepResponse ? (
              <TFStepResponseChart
                stepResponse={compactToPerAxisStepResponse(
                  session.verificationTransferFunctionMetrics.stepResponse
                )}
                beforeStepResponse={compactToPerAxisStepResponse(
                  session.transferFunctionMetrics.stepResponse
                )}
              />
            ) : (
              <OvershootComparison
                before={session.transferFunctionMetrics}
                after={session.verificationTransferFunctionMetrics}
              />
            ))}
        </>
      )}

      {/* Filter Tune: spectrogram comparison (before/after) */}
      {isFilterTune &&
        hasFilterVerification &&
        session.filterMetrics?.throttleSpectrogram &&
        session.verificationMetrics?.throttleSpectrogram && (
          <SpectrogramComparisonChart
            before={session.filterMetrics.throttleSpectrogram}
            after={session.verificationMetrics.throttleSpectrogram}
          />
        )}

      {/* PID Tune: step response comparison (before/after) */}
      {isPidTune && hasPidVerification && session.pidMetrics && session.verificationPidMetrics && (
        <StepResponseComparison
          before={session.pidMetrics}
          after={session.verificationPidMetrics}
        />
      )}

      {/* Re-analyze button for any verification */}
      {hasAnyVerification && onReanalyzeVerification && session.verificationLogId && (
        <button className="completion-reanalyze-link" onClick={onReanalyzeVerification}>
          Re-analyze with different session
        </button>
      )}

      {/* Filter analysis numeric summary (no verification) */}
      {!hasFilterVerification && session.filterMetrics && (
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

      {/* Filter Tune only: single spectrogram (no verification) */}
      {isFilterTune && !hasFilterVerification && session.filterMetrics?.throttleSpectrogram && (
        <ThrottleSpectrogramChart compactData={session.filterMetrics.throttleSpectrogram} />
      )}

      <div className="completion-changes-row">
        <AppliedChangesTable title="Filter Changes" changes={filterChanges} />
        <AppliedChangesTable title="PID Changes" changes={pidChanges} />
        {ffChanges.length > 0 && (
          <AppliedChangesTable title="Feedforward Changes" changes={ffChanges} />
        )}
      </div>

      {/* PID metrics (shown when no PID verification — raw metrics before changes) */}
      {session.pidMetrics && !hasPidVerification && (
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
                  <span title={METRIC_TOOLTIPS.overshoot}>
                    Overshoot: {m.meanOvershoot.toFixed(1)}%
                  </span>
                  <span title={METRIC_TOOLTIPS.riseTime}>
                    Rise: {m.meanRiseTimeMs.toFixed(0)}ms
                  </span>
                  <span title={METRIC_TOOLTIPS.settlingTime}>
                    Settling: {m.meanSettlingTimeMs.toFixed(0)}ms
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="completion-actions">
        {isFilterTune && (
          <>
            {score && score.overall >= 60 ? (
              <>
                {onStartPidTune && (
                  <button className="wizard-btn wizard-btn-primary" onClick={onStartPidTune}>
                    Start PID Tune
                  </button>
                )}
                <button
                  className={`wizard-btn ${onStartPidTune ? 'wizard-btn-secondary' : 'wizard-btn-primary'}`}
                  onClick={onDismiss}
                >
                  Dismiss
                </button>
              </>
            ) : (
              <>
                <button className="wizard-btn wizard-btn-primary" onClick={onStartNew}>
                  Repeat Filter Tune
                </button>
                <button className="wizard-btn wizard-btn-secondary" onClick={onDismiss}>
                  Dismiss
                </button>
              </>
            )}
          </>
        )}
        {isPidTune && (
          <>
            {score && score.overall >= 60 ? (
              <button className="wizard-btn wizard-btn-primary" onClick={onDismiss}>
                Dismiss
              </button>
            ) : (
              <>
                <button className="wizard-btn wizard-btn-primary" onClick={onStartNew}>
                  Repeat PID Tune
                </button>
                <button className="wizard-btn wizard-btn-secondary" onClick={onDismiss}>
                  Dismiss
                </button>
              </>
            )}
          </>
        )}
        {isFlashTune && (
          <>
            <button className="wizard-btn wizard-btn-primary" onClick={onStartNew}>
              Start New Tuning Cycle
            </button>
            <button className="wizard-btn wizard-btn-secondary" onClick={onDismiss}>
              Dismiss
            </button>
          </>
        )}
        {historyRecordId && (
          <ReportIssueButton
            recordId={historyRecordId}
            variant="button"
            className="report-issue-btn"
          />
        )}
      </div>
    </div>
  );
}
