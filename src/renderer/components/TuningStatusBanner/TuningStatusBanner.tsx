import React from 'react';
import type {
  TuningSession,
  TuningPhase,
  TuningMode,
  FlightGuideMode,
} from '@shared/types/tuning.types';
import type { BlackboxStorageType } from '@shared/types/blackbox.types';
import { TUNING_TYPE, TUNING_MODE, TUNING_PHASE, TUNING_TYPE_LABELS } from '@shared/constants';
import './TuningStatusBanner.css';

export type TuningAction =
  | 'erase_flash'
  | 'skip_erase'
  | 'download_log'
  | 'import_log'
  | 'open_filter_wizard'
  | 'open_pid_wizard'
  | 'start_new_cycle'
  | 'complete_session'
  | 'skip_verification'
  | 'prepare_verification'
  | 'analyze_verification'
  | 'open_quick_wizard'
  | 'dismiss';

interface TuningStatusBannerProps {
  session: TuningSession;
  flashErased?: boolean;
  flashUsedSize?: number | null;
  storageType?: BlackboxStorageType;
  erasing?: boolean;
  downloading?: boolean;
  downloadProgress?: number;
  analyzingVerification?: boolean;
  bbSettingsOk?: boolean;
  fixingSettings?: boolean;
  isDemoMode?: boolean;
  onAction: (action: TuningAction) => void;
  onViewGuide: (mode: FlightGuideMode) => void;
  onReset: () => void;
  onFixSettings?: () => void;
}

interface PhaseUI {
  stepIndex: number;
  text: string;
  buttonLabel: string;
  action: TuningAction;
  guideTip?: TuningMode;
}

const DEEP_STEP_LABELS = [
  'Prepare',
  'Filter Flight',
  'Filter Tune',
  'PID Flight',
  'PID Tune',
  'Verify',
];
const FLASH_STEP_LABELS = ['Prepare', 'Flight', 'Tune', 'Verify'];

function getPhaseUI(
  isSDCard: boolean
): Record<Exclude<TuningPhase, 'pid_applied' | 'verification_pending' | 'quick_applied'>, PhaseUI> {
  const eraseLabel = isSDCard ? 'Erase Logs' : 'Erase Flash';
  const storageName = isSDCard ? 'SD card' : 'flash';
  return {
    filter_flight_pending: {
      stepIndex: 0,
      text: `Erase Blackbox data from ${storageName}, then fly the filter test flight (hover + throttle sweeps).`,
      buttonLabel: eraseLabel,
      action: 'erase_flash',
      guideTip: 'filter',
    },
    filter_log_ready: {
      stepIndex: 1,
      text: 'Filter flight done! Download the Blackbox log to start analysis.',
      buttonLabel: 'Download Log',
      action: 'download_log',
    },
    filter_analysis: {
      stepIndex: 2,
      text: 'Log downloaded. Run the Filter Wizard to analyze noise and apply filter changes.',
      buttonLabel: 'Open Filter Wizard',
      action: 'open_filter_wizard',
    },
    filter_applied: {
      stepIndex: 2,
      text: 'Filters applied! Prepare for the PID test flight.',
      buttonLabel: 'Continue',
      action: 'erase_flash',
      guideTip: 'pid',
    },
    pid_flight_pending: {
      stepIndex: 3,
      text: `Erase Blackbox data from ${storageName}, then fly the PID test flight (stick snaps on all axes).`,
      buttonLabel: eraseLabel,
      action: 'erase_flash',
      guideTip: 'pid',
    },
    pid_log_ready: {
      stepIndex: 3,
      text: 'PID flight done! Download the Blackbox log to start analysis.',
      buttonLabel: 'Download Log',
      action: 'download_log',
    },
    pid_analysis: {
      stepIndex: 4,
      text: 'Log downloaded. Run the PID Wizard to analyze step response and apply PID changes.',
      buttonLabel: 'Open PID Wizard',
      action: 'open_pid_wizard',
    },
    quick_flight_pending: {
      stepIndex: 0,
      text: `Erase Blackbox data from ${storageName}, then rip a pack — any flight style works.`,
      buttonLabel: eraseLabel,
      action: 'erase_flash',
      guideTip: TUNING_MODE.FLASH,
    },
    quick_log_ready: {
      stepIndex: 1,
      text: `Flight done! Download the Blackbox log to start ${TUNING_TYPE_LABELS[TUNING_TYPE.FLASH]} analysis.`,
      buttonLabel: 'Download Log',
      action: 'download_log',
    },
    quick_analysis: {
      stepIndex: 2,
      text: `Log downloaded. Run the ${TUNING_TYPE_LABELS[TUNING_TYPE.FLASH]} Wizard to analyze and apply all changes.`,
      buttonLabel: `Open ${TUNING_TYPE_LABELS[TUNING_TYPE.FLASH]} Wizard`,
      action: 'open_quick_wizard',
    },
    completed: {
      stepIndex: 5,
      text: 'Tuning complete! Your drone is dialed in.',
      buttonLabel: 'Dismiss',
      action: 'dismiss',
    },
  };
}

function getVerificationUI(session: TuningSession): { stepIndex: number; text: string } {
  if (session.verificationLogId) {
    return {
      stepIndex: 5,
      text: 'Verification log ready. Analyze to compare noise before and after tuning.',
    };
  }
  return {
    stepIndex: 5,
    text: 'Download the verification hover log, or skip verification.',
  };
}

export function TuningStatusBanner({
  session,
  flashErased,
  flashUsedSize,
  storageType,
  erasing,
  downloading,
  downloadProgress,
  analyzingVerification,
  bbSettingsOk,
  fixingSettings,
  isDemoMode,
  onAction,
  onViewGuide,
  onReset,
  onFixSettings,
}: TuningStatusBannerProps) {
  const isSDCard = storageType === 'sdcard';
  const PHASE_UI = getPhaseUI(isSDCard);
  const downloadLabel =
    downloadProgress && downloadProgress > 0
      ? `Downloading... ${downloadProgress}%`
      : 'Downloading...';
  const isPidApplied = session.phase === TUNING_PHASE.PID_APPLIED;
  const isQuickApplied = session.phase === TUNING_PHASE.QUICK_APPLIED;
  const isVerification = session.phase === TUNING_PHASE.VERIFICATION_PENDING;
  const isFlightPending =
    session.phase === TUNING_PHASE.FILTER_FLIGHT_PENDING ||
    session.phase === TUNING_PHASE.PID_FLIGHT_PENDING ||
    session.phase === TUNING_PHASE.QUICK_FLIGHT_PENDING;
  const isFlashTune = session.tuningType === TUNING_TYPE.FLASH;
  const stepLabels = isFlashTune ? FLASH_STEP_LABELS : DEEP_STEP_LABELS;

  // Determine step index and text
  let stepIndex: number;
  let text: string;
  let ui: PhaseUI | undefined;

  if (isPidApplied || isQuickApplied) {
    stepIndex = isQuickApplied ? 2 : 4;
    text = isQuickApplied
      ? 'All changes applied! Fly a short hover to verify noise improvement, or skip.'
      : 'PIDs applied! Fly a short hover to verify noise improvement, or skip.';
  } else if (isVerification) {
    const vui = getVerificationUI(session);
    stepIndex = isFlashTune ? 3 : vui.stepIndex;
    text = vui.text;
  } else {
    ui =
      PHASE_UI[
        session.phase as Exclude<
          TuningPhase,
          'pid_applied' | 'verification_pending' | 'quick_applied'
        >
      ];
    stepIndex = ui.stepIndex;
    text = ui.text;
  }

  // For completed phase, use the last step index
  if (session.phase === TUNING_PHASE.COMPLETED) {
    stepIndex = stepLabels.length - 1;
  }

  const flashHasData = flashUsedSize != null && flashUsedSize > 0;
  // For SD card: flashUsedSize is always > 0 (filesystem overhead), so rely on
  // eraseCompleted (persisted in session) or eraseSkipped instead of flashUsedSize === 0.
  const showErasedState =
    ((isFlightPending || isVerification) &&
      !flashHasData &&
      (flashErased || flashUsedSize === 0)) ||
    (isFlightPending && !!session.eraseSkipped) ||
    ((isFlightPending || isVerification) && !!session.eraseCompleted);
  const flightType =
    session.phase === TUNING_PHASE.QUICK_FLIGHT_PENDING
      ? TUNING_TYPE_LABELS[TUNING_TYPE.FLASH]
      : session.phase === TUNING_PHASE.FILTER_FLIGHT_PENDING
        ? 'filter'
        : 'PID';
  const storageName = isSDCard ? 'SD card' : 'flash';
  const activeStepIndex = showErasedState && isFlightPending ? stepIndex + 1 : stepIndex;

  const showBBWarning =
    isFlightPending && !showErasedState && bbSettingsOk === false && !isDemoMode;

  const renderActions = () => {
    // Flash erased state for flight pending / verification phases — show flight guide
    if (showErasedState && (ui?.guideTip || isVerification)) {
      const guideMode: FlightGuideMode = isVerification
        ? isFlashTune
          ? 'flash_verification'
          : 'verification'
        : ui!.guideTip!;
      return (
        <>
          <button className="wizard-btn wizard-btn-primary" onClick={() => onViewGuide(guideMode)}>
            View Flight Guide
          </button>
          {isVerification && (
            <button
              className="wizard-btn wizard-btn-secondary"
              onClick={() => onAction('skip_verification')}
            >
              Skip & Complete
            </button>
          )}
        </>
      );
    }

    // pid_applied / quick_applied: Prepare Verification + Skip
    if (isPidApplied || isQuickApplied) {
      return (
        <>
          <button
            className="wizard-btn wizard-btn-primary"
            onClick={() => onAction('prepare_verification')}
            disabled={erasing}
          >
            {erasing ? (
              <>
                <span className="spinner" />
                Preparing...
              </>
            ) : isSDCard ? (
              'Erase Logs & Verify'
            ) : (
              'Erase & Verify'
            )}
          </button>
          <button
            className="wizard-btn wizard-btn-secondary"
            onClick={() => onAction('skip_verification')}
            disabled={erasing}
          >
            Skip & Complete
          </button>
        </>
      );
    }

    // verification_pending: dynamic based on verificationLogId
    if (isVerification) {
      if (session.verificationLogId) {
        return (
          <>
            <button
              className="wizard-btn wizard-btn-primary"
              onClick={() => onAction('analyze_verification')}
              disabled={analyzingVerification}
            >
              {analyzingVerification ? (
                <>
                  <span className="spinner" />
                  Analyzing...
                </>
              ) : (
                'Analyze Verification'
              )}
            </button>
            <button
              className="wizard-btn wizard-btn-secondary"
              onClick={() => onAction('skip_verification')}
              disabled={analyzingVerification}
            >
              Skip & Complete
            </button>
          </>
        );
      }
      return (
        <>
          <button
            className="wizard-btn wizard-btn-primary"
            onClick={() => onAction('download_log')}
            disabled={downloading}
          >
            {downloading ? (
              <>
                <span className="spinner" />
                {downloadLabel}
              </>
            ) : (
              'Download Log'
            )}
          </button>
          <button
            className="wizard-btn wizard-btn-secondary"
            onClick={() => onAction('import_log')}
            disabled={downloading}
          >
            Import File
          </button>
          <button
            className="wizard-btn wizard-btn-secondary"
            onClick={() => onAction('skip_verification')}
            disabled={downloading}
          >
            Skip & Complete
          </button>
        </>
      );
    }

    // Default: static PHASE_UI action
    const isEraseAction = ui!.action === 'erase_flash';
    const isDownloadAction = ui!.action === 'download_log';
    return (
      <>
        <button
          className="wizard-btn wizard-btn-primary"
          onClick={() => onAction(ui!.action)}
          disabled={erasing || downloading}
        >
          {erasing ? (
            <>
              <span className="spinner" />
              Erasing...
            </>
          ) : downloading ? (
            <>
              <span className="spinner" />
              {downloadLabel}
            </>
          ) : (
            ui!.buttonLabel
          )}
        </button>
        {isDownloadAction && !downloading && (
          <button
            className="wizard-btn wizard-btn-secondary"
            onClick={() => onAction('import_log')}
          >
            Import File
          </button>
        )}
        {isEraseAction && !erasing && !downloading && (
          <button
            className="wizard-btn wizard-btn-secondary"
            onClick={() => onAction('skip_erase')}
          >
            Skip Erase
          </button>
        )}
        {ui!.guideTip && !erasing && !downloading && (
          <button
            className="wizard-btn wizard-btn-secondary"
            onClick={() => onViewGuide(ui!.guideTip!)}
          >
            View Flight Guide
          </button>
        )}
      </>
    );
  };

  return (
    <div className="tuning-status-banner">
      <div className="tuning-status-steps">
        <span className={`tuning-type-badge ${isFlashTune ? 'flash' : 'deep'}`}>
          {TUNING_TYPE_LABELS[session.tuningType ?? TUNING_TYPE.DEEP]}
        </span>
        {stepLabels.map((label, i) => {
          const isDone = i < activeStepIndex;
          const isCurrent = i === activeStepIndex;
          const className = isDone ? 'done' : isCurrent ? 'current' : 'upcoming';
          return (
            <React.Fragment key={label}>
              {i > 0 && <div className={`tuning-status-line ${isDone ? 'done' : ''}`} />}
              <div className={`tuning-status-step ${className}`}>
                <div className="tuning-status-indicator">{isDone ? '\u2713' : i + 1}</div>
                <span className="tuning-status-label">{label}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      <div className="tuning-status-body">
        {showBBWarning && (
          <div className="tuning-bb-warning">
            <span>Blackbox settings need to be fixed before flying. Data may be unusable.</span>
            {onFixSettings && (
              <button
                className="wizard-btn wizard-btn-warning"
                onClick={onFixSettings}
                disabled={fixingSettings}
              >
                {fixingSettings ? 'Fixing...' : 'Fix Settings'}
              </button>
            )}
          </div>
        )}
        <p className="tuning-status-text">
          {showErasedState
            ? isVerification
              ? `${isSDCard ? 'Logs erased' : 'Flash erased'}! Disconnect and fly a 30-60s hover to verify noise improvement.`
              : `${isSDCard ? 'Logs erased' : 'Flash erased'}! Disconnect your drone and fly the ${flightType} test flight.`
            : text}
        </p>
        <div className="tuning-status-actions">
          {renderActions()}
          <button className="wizard-btn wizard-btn-text" onClick={onReset}>
            Reset Session
          </button>
        </div>
      </div>
    </div>
  );
}
