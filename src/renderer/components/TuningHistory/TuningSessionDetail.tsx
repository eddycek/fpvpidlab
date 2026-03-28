import React, { useMemo } from 'react';
import type { CompletedTuningRecord } from '@shared/types/tuning-history.types';
import { TUNING_TYPE } from '@shared/constants';
import { CHART_DESCRIPTIONS, METRIC_TOOLTIPS } from '@shared/constants/metricTooltips';
import { computeTuneQualityScore } from '@shared/utils/tuneQualityScore';
import { NoiseComparisonChart } from './NoiseComparisonChart';
import { SpectrogramComparisonChart } from './SpectrogramComparisonChart';
import { StepResponseComparison } from './StepResponseComparison';
import { OvershootComparison } from './TuningCompletionSummary';
import { TFStepResponseChart } from '../TuningWizard/charts/TFStepResponseChart';
import { ThrottleSpectrogramChart } from '../TuningWizard/charts/ThrottleSpectrogramChart';
import { compactToPerAxisStepResponse } from '../TuningWizard/charts/chartUtils';
import { AppliedChangesTable } from './AppliedChangesTable';
import { ReportIssueButton } from '../DiagnosticReport/ReportIssueButton';

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
  const isFilterTune = record.tuningType === TUNING_TYPE.FILTER;
  const isPidTune = record.tuningType === TUNING_TYPE.PID;
  const isFlashTune = record.tuningType === TUNING_TYPE.FLASH;

  const hasFilterComparison =
    !!record.filterMetrics?.spectrum && !!record.verificationMetrics?.spectrum;
  const hasPidComparison = !!record.pidMetrics && !!record.verificationPidMetrics;
  const hasAnyVerification = hasFilterComparison || hasPidComparison || !!record.verificationLogId;

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
        {record.bfPidProfileIndex != null && (
          <>
            <span className="completion-meta-sep">{'\u2022'}</span>
            <span>PID Profile {record.bfPidProfileIndex + 1}</span>
          </>
        )}
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

      {/* Filter Tune / Flash Tune: noise spectrum comparison */}
      {hasFilterComparison && record.filterMetrics && record.verificationMetrics && (
        <>
          <NoiseComparisonChart before={record.filterMetrics} after={record.verificationMetrics} />
          {/* Flash Tune only: TF step response comparison */}
          {isFlashTune &&
            record.transferFunctionMetrics &&
            record.verificationTransferFunctionMetrics &&
            (record.transferFunctionMetrics.stepResponse &&
            record.verificationTransferFunctionMetrics.stepResponse ? (
              <TFStepResponseChart
                stepResponse={compactToPerAxisStepResponse(
                  record.verificationTransferFunctionMetrics.stepResponse
                )}
                beforeStepResponse={compactToPerAxisStepResponse(
                  record.transferFunctionMetrics.stepResponse
                )}
              />
            ) : (
              <OvershootComparison
                before={record.transferFunctionMetrics}
                after={record.verificationTransferFunctionMetrics}
              />
            ))}
        </>
      )}

      {/* Filter Tune: spectrogram comparison (before/after) */}
      {isFilterTune &&
        hasFilterComparison &&
        record.filterMetrics?.throttleSpectrogram &&
        record.verificationMetrics?.throttleSpectrogram && (
          <SpectrogramComparisonChart
            before={record.filterMetrics.throttleSpectrogram}
            after={record.verificationMetrics.throttleSpectrogram}
          />
        )}

      {/* PID Tune: step response comparison (before/after) */}
      {isPidTune && hasPidComparison && record.pidMetrics && record.verificationPidMetrics && (
        <StepResponseComparison before={record.pidMetrics} after={record.verificationPidMetrics} />
      )}

      {/* Re-analyze button */}
      {hasAnyVerification && onReanalyzeVerification && (
        <button className="completion-reanalyze-link" onClick={onReanalyzeVerification}>
          Re-analyze with different session
        </button>
      )}

      {/* Filter analysis numeric summary (no verification) */}
      {!hasFilterComparison && record.filterMetrics && (
        <div className="completion-noise-numeric">
          <div className="completion-noise-stats">
            <span title={METRIC_TOOLTIPS.noiseLevel}>Noise: {record.filterMetrics.noiseLevel}</span>
            <span className="completion-meta-sep">{'\u2022'}</span>
            <span title={METRIC_TOOLTIPS.noiseFloor}>
              Roll {record.filterMetrics.roll.noiseFloorDb.toFixed(0)} dB
            </span>
            <span className="completion-meta-sep">{'\u2022'}</span>
            <span title={METRIC_TOOLTIPS.noiseFloor}>
              Pitch {record.filterMetrics.pitch.noiseFloorDb.toFixed(0)} dB
            </span>
            <span className="completion-meta-sep">{'\u2022'}</span>
            <span title={METRIC_TOOLTIPS.noiseFloor}>
              Yaw {record.filterMetrics.yaw.noiseFloorDb.toFixed(0)} dB
            </span>
          </div>
        </div>
      )}

      {/* Filter Tune only: single spectrogram (no verification) */}
      {isFilterTune && !hasFilterComparison && record.filterMetrics?.throttleSpectrogram && (
        <>
          <h4 className="chart-title">Throttle Spectrogram</h4>
          <p className="chart-description">{CHART_DESCRIPTIONS.throttleSpectrogram}</p>
          <ThrottleSpectrogramChart compactData={record.filterMetrics.throttleSpectrogram} />
        </>
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

      {/* PID metrics (no PID verification — raw metrics before changes) */}
      {record.pidMetrics && !hasPidComparison && (
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

      <div className="session-detail-actions">
        <ReportIssueButton recordId={record.id} variant="button" className="report-issue-btn" />
      </div>
    </div>
  );
}
