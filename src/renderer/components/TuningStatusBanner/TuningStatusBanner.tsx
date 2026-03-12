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

/** All 3 modes share the same 4-step structure */
const STEP_LABELS = ['Prepare', 'Flight', 'Tune', 'Verify'];

function getPhaseUI(
  isSDCard: boolean
): Record<
  Exclude<
    TuningPhase,
    | 'filter_applied'
    | 'pid_applied'
    | 'filter_verification_pending'
    | 'pid_verification_pending'
    | 'verification_pending'
    | 'quick_applied'
  >,
  PhaseUI
> {
  const eraseLabel = isSDCard ? 'Erase Logs' : 'Erase Flash';
  const storageName = isSDCard ? 'SD card' : 'flash';
  return {
    // Filter Tune phases
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
    // PID Tune phases
    pid_flight_pending: {
      stepIndex: 0,
      text: `Erase Blackbox data from ${storageName}, then fly the PID test flight (stick snaps on all axes).`,
      buttonLabel: eraseLabel,
      action: 'erase_flash',
      guideTip: 'pid',
    },
    pid_log_ready: {
      stepIndex: 1,
      text: 'PID flight done! Download the Blackbox log to start analysis.',
      buttonLabel: 'Download Log',
      action: 'download_log',
    },
    pid_analysis: {
      stepIndex: 2,
      text: 'Log downloaded. Run the PID Wizard to analyze step response and apply PID changes.',
      buttonLabel: 'Open PID Wizard',
      action: 'open_pid_wizard',
    },
    // Flash Tune phases
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
      stepIndex: 3,
      text: 'Tuning complete! Your drone is dialed in.',
      buttonLabel: 'Dismiss',
      action: 'dismiss',
    },
  };
}

function getVerificationText(session: TuningSession): string {
  const isFilter = session.tuningType === TUNING_TYPE.FILTER;
  if (session.verificationLogId) {
    return isFilter
      ? 'Verification log ready. Analyze to compare noise before and after tuning.'
      : 'Verification log ready. Analyze to compare step response before and after tuning.';
  }
  return 'Download the verification log to complete your tune.';
}

function getAppliedText(session: TuningSession, isSDCard: boolean): string {
  const verifyLabel = isSDCard ? 'Erase Logs & Verify' : 'Erase & Verify';
  if (session.tuningType === TUNING_TYPE.FILTER) {
    return `Filters applied! Fly another throttle sweep to verify your changes. (${verifyLabel})`;
  }
  if (session.tuningType === TUNING_TYPE.PID) {
    return `PIDs applied! Fly stick snaps again to verify your changes. (${verifyLabel})`;
  }
  return `All changes applied! Fly a verification flight to score your tune. (${verifyLabel})`;
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

  const isFilterApplied = session.phase === TUNING_PHASE.FILTER_APPLIED;
  const isPidApplied = session.phase === TUNING_PHASE.PID_APPLIED;
  const isQuickApplied = session.phase === TUNING_PHASE.QUICK_APPLIED;
  const isApplied = isFilterApplied || isPidApplied || isQuickApplied;

  const isFilterVerification = session.phase === TUNING_PHASE.FILTER_VERIFICATION_PENDING;
  const isPidVerification = session.phase === TUNING_PHASE.PID_VERIFICATION_PENDING;
  const isLegacyVerification = session.phase === TUNING_PHASE.VERIFICATION_PENDING;
  const isVerification = isFilterVerification || isPidVerification || isLegacyVerification;

  const isFlightPending =
    session.phase === TUNING_PHASE.FILTER_FLIGHT_PENDING ||
    session.phase === TUNING_PHASE.PID_FLIGHT_PENDING ||
    session.phase === TUNING_PHASE.QUICK_FLIGHT_PENDING;
  const isFlashTune = session.tuningType === TUNING_TYPE.FLASH;

  // Determine step index and text
  let stepIndex: number;
  let text: string;
  let ui: PhaseUI | undefined;

  if (isApplied) {
    stepIndex = 2;
    text = getAppliedText(session, isSDCard);
  } else if (isVerification) {
    stepIndex = 3;
    text = getVerificationText(session);
  } else {
    ui =
      PHASE_UI[
        session.phase as Exclude<
          TuningPhase,
          | 'filter_applied'
          | 'pid_applied'
          | 'filter_verification_pending'
          | 'pid_verification_pending'
          | 'verification_pending'
          | 'quick_applied'
        >
      ];
    stepIndex = ui.stepIndex;
    text = ui.text;
  }

  if (session.phase === TUNING_PHASE.COMPLETED) {
    stepIndex = STEP_LABELS.length - 1;
  }

  const flashHasData = flashUsedSize != null && flashUsedSize > 0;
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
  const activeStepIndex = showErasedState && isFlightPending ? stepIndex + 1 : stepIndex;

  const showBBWarning =
    isFlightPending && !showErasedState && bbSettingsOk === false && !isDemoMode;

  const getVerificationGuideMode = (): FlightGuideMode => {
    if (session.tuningType === TUNING_TYPE.FILTER) return 'filter_verification';
    if (session.tuningType === TUNING_TYPE.PID) return 'pid_verification';
    if (isFlashTune) return 'flash_verification';
    return 'verification';
  };

  const renderActions = () => {
    // Flash erased state for flight pending / verification phases — show flight guide
    if (showErasedState && (ui?.guideTip || isVerification)) {
      const guideMode: FlightGuideMode = isVerification
        ? getVerificationGuideMode()
        : ui!.guideTip!;
      return (
        <>
          <button className="wizard-btn wizard-btn-primary" onClick={() => onViewGuide(guideMode)}>
            View Flight Guide
          </button>
        </>
      );
    }

    // Applied phases: Prepare Verification
    if (isApplied) {
      return (
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
      );
    }

    // Verification phases: dynamic based on verificationLogId
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
        <span
          className={`tuning-type-badge ${isFlashTune ? 'flash' : session.tuningType === TUNING_TYPE.PID ? 'pid' : 'filter'}`}
        >
          {TUNING_TYPE_LABELS[session.tuningType ?? TUNING_TYPE.FILTER]}
        </span>
        {session.bfPidProfileIndex != null && (
          <span className="tuning-profile-badge">Profile {session.bfPidProfileIndex + 1}</span>
        )}
        {STEP_LABELS.map((label, i) => {
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
              ? `${isSDCard ? 'Logs erased' : 'Flash erased'}! Disconnect and fly ${session.tuningType === TUNING_TYPE.FILTER ? 'throttle sweeps' : session.tuningType === TUNING_TYPE.PID ? 'stick snaps' : 'a 30-60s hover'} to verify improvement.`
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
