import React, { useEffect, useRef } from 'react';
import { useTuningWizard } from '../../hooks/useTuningWizard';
import type { TuningMode, AppliedChange } from '@shared/types/tuning.types';
import type {
  FilterMetricsSummary,
  PIDMetricsSummary,
  TransferFunctionMetricsSummary,
} from '@shared/types/tuning-history.types';
import { extractFilterMetrics, extractPIDMetrics } from '@shared/utils/metricsExtract';
import { WizardProgress } from './WizardProgress';
import { TestFlightGuideStep } from './TestFlightGuideStep';
import { SessionSelectStep } from './SessionSelectStep';
import { FilterAnalysisStep } from './FilterAnalysisStep';
import { PIDAnalysisStep } from './PIDAnalysisStep';
import { TuningSummaryStep } from './TuningSummaryStep';
import { QuickAnalysisStep } from './QuickAnalysisStep';
import { ApplyConfirmationModal } from './ApplyConfirmationModal';
import './TuningWizard.css';

interface TuningWizardProps {
  logId: string;
  mode?: TuningMode;
  onExit: () => void;
  onApplyComplete?: (changes: {
    filterChanges?: AppliedChange[];
    pidChanges?: AppliedChange[];
    feedforwardChanges?: AppliedChange[];
    filterMetrics?: FilterMetricsSummary;
    pidMetrics?: PIDMetricsSummary;
    transferFunctionMetrics?: TransferFunctionMetricsSummary;
  }) => void;
}

export function TuningWizard({ logId, mode = 'full', onExit, onApplyComplete }: TuningWizardProps) {
  const wizard = useTuningWizard(logId, mode);
  const applyCalled = useRef(false);

  // Notify parent when apply completes successfully
  useEffect(() => {
    if (wizard.applyState === 'done' && !applyCalled.current) {
      applyCalled.current = true;

      if (onApplyComplete) {
        const filterChanges =
          mode !== 'pid'
            ? wizard.filterResult?.recommendations
                .filter((r) => r.currentValue !== r.recommendedValue)
                .map((r) => ({
                  setting: r.setting,
                  previousValue: r.currentValue,
                  newValue: r.recommendedValue,
                }))
            : undefined;

        // In quick mode, PID recs come from transfer function analysis
        const pidSource =
          mode === 'quick' ? wizard.tfResult : mode !== 'filter' ? wizard.pidResult : null;
        const allPidRecs = pidSource?.recommendations ?? [];

        const pidChanges = allPidRecs
          .filter((r) => r.setting.startsWith('pid_'))
          .map((r) => ({
            setting: r.setting,
            previousValue: r.currentValue,
            newValue: r.recommendedValue,
          }));

        const feedforwardChanges = allPidRecs
          .filter((r) => r.setting.startsWith('feedforward_'))
          .map((r) => ({
            setting: r.setting,
            previousValue: r.currentValue,
            newValue: r.recommendedValue,
          }));

        const filterMetrics =
          mode !== 'pid' && wizard.filterResult
            ? extractFilterMetrics(wizard.filterResult)
            : undefined;

        // For quick mode, PID-like metrics come from transfer function analysis
        const pidMetricsSource =
          mode === 'quick' ? wizard.tfResult : mode !== 'filter' ? wizard.pidResult : null;
        const pidMetrics = pidMetricsSource ? extractPIDMetrics(pidMetricsSource) : undefined;

        // TODO: Extract full TF metrics once TransferFunctionEstimator exposes them on PIDAnalysisResult
        const transferFunctionMetrics = undefined;

        onApplyComplete({
          filterChanges,
          pidChanges: pidChanges.length > 0 ? pidChanges : undefined,
          feedforwardChanges: feedforwardChanges.length > 0 ? feedforwardChanges : undefined,
          filterMetrics,
          pidMetrics,
          transferFunctionMetrics,
        });
      }
    }

    if (wizard.applyState === 'idle' || wizard.applyState === 'error') {
      applyCalled.current = false;
    }
  }, [
    wizard.applyState,
    wizard.filterResult,
    wizard.pidResult,
    wizard.tfResult,
    mode,
    onApplyComplete,
  ]);

  const renderStep = () => {
    switch (wizard.step) {
      case 'guide':
        return <TestFlightGuideStep onContinue={() => wizard.setStep('session')} mode={mode} />;
      case 'session':
        return (
          <SessionSelectStep
            sessions={wizard.sessions}
            parsing={wizard.parsing}
            parseProgress={wizard.parseProgress}
            parseError={wizard.parseError}
            parseLog={wizard.parseLog}
            sessionIndex={wizard.sessionIndex}
            onSelectSession={(idx) => {
              wizard.selectSession(idx);
              wizard.setStep(
                mode === 'quick' ? 'quick_analysis' : mode === 'pid' ? 'pid' : 'filter'
              );
            }}
          />
        );
      case 'filter':
        return (
          <FilterAnalysisStep
            filterResult={wizard.filterResult}
            filterAnalyzing={wizard.filterAnalyzing}
            filterProgress={wizard.filterProgress}
            filterError={wizard.filterError}
            runFilterAnalysis={wizard.runFilterAnalysis}
            onContinue={() => wizard.setStep(mode === 'filter' ? 'summary' : 'pid')}
            mode={mode}
          />
        );
      case 'pid':
        return (
          <PIDAnalysisStep
            pidResult={wizard.pidResult}
            pidAnalyzing={wizard.pidAnalyzing}
            pidProgress={wizard.pidProgress}
            pidError={wizard.pidError}
            runPIDAnalysis={wizard.runPIDAnalysis}
            onContinue={() => wizard.setStep('summary')}
          />
        );
      case 'quick_analysis':
        return (
          <QuickAnalysisStep
            filterResult={wizard.filterResult}
            filterAnalyzing={wizard.filterAnalyzing}
            filterProgress={wizard.filterProgress}
            filterError={wizard.filterError}
            tfResult={wizard.tfResult}
            tfAnalyzing={wizard.tfAnalyzing}
            tfError={wizard.tfError}
            runQuickAnalysis={wizard.runQuickAnalysis}
            quickAnalyzing={wizard.quickAnalyzing}
            onContinue={() => wizard.setStep('summary')}
          />
        );
      case 'summary':
        return (
          <TuningSummaryStep
            filterResult={wizard.filterResult}
            pidResult={wizard.pidResult}
            tfResult={wizard.tfResult}
            mode={mode}
            onExit={onExit}
            onApply={wizard.startApply}
            applyState={wizard.applyState}
            applyProgress={wizard.applyProgress}
            applyResult={wizard.applyResult}
            applyError={wizard.applyError}
          />
        );
    }
  };

  return (
    <div className="tuning-wizard">
      <div className="tuning-wizard-header">
        <div className="tuning-wizard-header-left">
          <h2>Tuning Wizard</h2>
          <span className="tuning-wizard-log-id">
            Log: {logId.length > 8 ? `${logId.slice(0, 8)}...` : logId}
            {wizard.sessionSelected && wizard.sessions?.[wizard.sessionIndex] && (
              <>
                {' | '}Session {wizard.sessionIndex + 1}
                {' | '}
                {Math.round(wizard.sessions[wizard.sessionIndex].flightData.durationSeconds)}s
                {' | '}
                {wizard.sessions[wizard.sessionIndex].flightData.sampleRateHz} Hz
              </>
            )}
          </span>
        </div>
        <button className="wizard-btn wizard-btn-secondary" onClick={onExit}>
          Exit
        </button>
      </div>

      <WizardProgress currentStep={wizard.step} mode={mode} />

      <div className="tuning-wizard-content">{renderStep()}</div>

      {wizard.applyState === 'confirming' && (
        <ApplyConfirmationModal
          filterCount={wizard.filterResult?.recommendations.length ?? 0}
          pidCount={wizard.pidResult?.recommendations.length ?? 0}
          onConfirm={wizard.confirmApply}
          onCancel={wizard.cancelApply}
        />
      )}
    </div>
  );
}
