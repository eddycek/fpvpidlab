import React, { useEffect, useRef } from 'react';
import { useTuningWizard } from '../../hooks/useTuningWizard';
import type { TuningMode, AppliedChange } from '@shared/types/tuning.types';
import type {
  FilterMetricsSummary,
  PIDMetricsSummary,
  TransferFunctionMetricsSummary,
} from '@shared/types/tuning-history.types';
import {
  extractFilterMetrics,
  extractPIDMetrics,
  extractTransferFunctionMetrics,
} from '@shared/utils/metricsExtract';
import { TUNING_MODE } from '@shared/constants';
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
  // Stable ref for onExit — prevents re-renders from invalidating the callback
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  // Timer ref for auto-close — survives re-renders (useEffect cleanup would cancel it)
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Notify parent when apply completes, then auto-close wizard
  useEffect(() => {
    if (wizard.applyState === 'done' && !applyCalled.current) {
      applyCalled.current = true;

      if (onApplyComplete) {
        const filterChanges =
          mode !== TUNING_MODE.PID
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
          mode === TUNING_MODE.FLASH
            ? wizard.tfResult
            : mode !== TUNING_MODE.FILTER
              ? wizard.pidResult
              : null;
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
          mode !== TUNING_MODE.PID && wizard.filterResult
            ? extractFilterMetrics(wizard.filterResult)
            : undefined;

        // Flash Tune uses transferFunctionMetrics for scoring (no step-based PID metrics)
        const pidMetricsSource =
          mode === TUNING_MODE.FLASH ? null : mode !== TUNING_MODE.FILTER ? wizard.pidResult : null;
        const pidMetrics = pidMetricsSource ? extractPIDMetrics(pidMetricsSource) : undefined;

        const transferFunctionMetrics =
          mode === TUNING_MODE.FLASH && wizard.tfResult?.transferFunctionMetrics
            ? extractTransferFunctionMetrics(
                wizard.tfResult.transferFunctionMetrics,
                undefined,
                wizard.tfResult.transferFunction?.syntheticStepResponse,
                wizard.tfResult.throttleTF
              )
            : undefined;

        onApplyComplete({
          filterChanges,
          pidChanges: pidChanges.length > 0 ? pidChanges : undefined,
          feedforwardChanges: feedforwardChanges.length > 0 ? feedforwardChanges : undefined,
          filterMetrics,
          pidMetrics,
          transferFunctionMetrics,
        });
      }

      // Auto-close wizard after apply completes — FC is already reconnected,
      // session phase is updated, user returns to dashboard with Erase & Verify banner.
      // Use ref (not useEffect cleanup) so re-renders don't cancel the timer.
      autoCloseTimer.current = setTimeout(() => onExitRef.current(), 500);
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

  // Cleanup auto-close timer on unmount only
  useEffect(() => {
    return () => {
      if (autoCloseTimer.current) clearTimeout(autoCloseTimer.current);
    };
  }, []);

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
                mode === TUNING_MODE.FLASH
                  ? 'flash_analysis'
                  : mode === TUNING_MODE.PID
                    ? 'pid'
                    : 'filter'
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
            onContinue={() => wizard.setStep(mode === TUNING_MODE.FILTER ? 'summary' : 'pid')}
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
      case 'flash_analysis':
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
