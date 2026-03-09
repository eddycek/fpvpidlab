import React, { useState, useEffect } from 'react';
import { ConnectionPanel } from './components/ConnectionPanel/ConnectionPanel';
import { FCInfoDisplay } from './components/FCInfo/FCInfoDisplay';
import { BlackboxStatus } from './components/BlackboxStatus/BlackboxStatus';
import { SnapshotManager } from './components/SnapshotManager/SnapshotManager';
import { ProfileWizard } from './components/ProfileWizard';
import type { FlightStyle } from '@shared/types/profile.types';
import { ProfileSelector } from './components/ProfileSelector';
import { TuningWizard } from './components/TuningWizard/TuningWizard';
import { AnalysisOverview } from './components/AnalysisOverview/AnalysisOverview';
import { TuningWorkflowModal } from './components/TuningWorkflowModal/TuningWorkflowModal';
import { TuningStatusBanner } from './components/TuningStatusBanner/TuningStatusBanner';
import { TuningCompletionSummary } from './components/TuningHistory/TuningCompletionSummary';
import { TuningHistoryPanel } from './components/TuningHistory/TuningHistoryPanel';
import { VerificationSessionModal } from './components/TuningHistory/VerificationSessionModal';
import { FixSettingsConfirmModal } from './components/FCInfo/FixSettingsConfirmModal';
import { StartTuningModal } from './components/StartTuningModal';
import { computeBBSettingsStatus } from './utils/bbSettingsUtils';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './contexts/ToastContext';
import { ToastContainer } from './components/Toast/ToastContainer';
import { useProfiles } from './hooks/useProfiles';
import { useTuningSession } from './hooks/useTuningSession';
import { useTuningHistory } from './hooks/useTuningHistory';
import { useToast } from './hooks/useToast';
import { useDemoMode } from './hooks/useDemoMode';
import { markIntentionalDisconnect } from './hooks/useConnection';
import type { FCInfo, ConnectionStatus } from '@shared/types/common.types';
import type { BlackboxSettings, BlackboxStorageType } from '@shared/types/blackbox.types';
import type { ProfileCreationInput } from '@shared/types/profile.types';
import type {
  TuningMode,
  TuningPhase,
  FlightGuideMode,
  AppliedChange,
} from '@shared/types/tuning.types';
import { TUNING_MODE, TUNING_PHASE, TUNING_TYPE } from '@shared/constants';
import type {
  CompletedTuningRecord,
  FilterMetricsSummary,
  PIDMetricsSummary,
  TransferFunctionMetricsSummary,
} from '@shared/types/tuning-history.types';
import { extractFilterMetrics, extractTransferFunctionMetrics } from '@shared/utils/metricsExtract';
import type { TuningAction } from './components/TuningStatusBanner/TuningStatusBanner';
import './App.css';

function AppContent() {
  const [showProfileWizard, setShowProfileWizard] = useState(false);
  const [newFCSerial, setNewFCSerial] = useState<string | null>(null);
  const [newFCInfo, setNewFCInfo] = useState<FCInfo | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);
  const [analysisLogId, setAnalysisLogId] = useState<string | null>(null);
  const [analysisLogName, setAnalysisLogName] = useState<string | null>(null);
  const [wizardMode, setWizardMode] = useState<TuningMode>('filter');
  const [showWorkflowHelp, setShowWorkflowHelp] = useState(false);
  const [showStartTuningModal, setShowStartTuningModal] = useState(false);
  const [showFlightGuideMode, setShowFlightGuideMode] = useState<FlightGuideMode | null>(null);
  const [erasedForPhase, setErasedForPhase] = useState<string | null>(null);
  const [flashUsedSize, setFlashUsedSize] = useState<number | null>(null);
  const [erasing, setErasing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [bbSettings, setBbSettings] = useState<BlackboxSettings | null>(null);
  const [fixingSettings, setFixingSettings] = useState(false);
  const [showBannerFixConfirm, setShowBannerFixConfirm] = useState(false);
  const [fcVersion, setFcVersion] = useState('');
  const [analyzingVerification, setAnalyzingVerification] = useState(false);
  const [bbRefreshKey, setBbRefreshKey] = useState(0);
  const [storageType, setStorageType] = useState<BlackboxStorageType>('flash');
  const [verificationPickerLogId, setVerificationPickerLogId] = useState<string | null>(null);
  const [isReanalyze, setIsReanalyze] = useState(false);
  const [reanalyzeHistoryRecordId, setReanalyzeHistoryRecordId] = useState<string | null>(null);
  const [availableLogIds, setAvailableLogIds] = useState<Set<string>>(new Set());
  const { createProfile, createProfileFromPreset, updateProfile, currentProfile } = useProfiles();
  const tuning = useTuningSession();
  const tuningHistory = useTuningHistory();
  const toast = useToast();
  const { isDemoMode } = useDemoMode();
  const [resettingDemo, setResettingDemo] = useState(false);

  const refreshAvailableLogIds = () => {
    window.betaflight
      .listBlackboxLogs()
      .then((logs) => setAvailableLogIds(new Set(logs.map((l) => l.id))))
      .catch(() => setAvailableLogIds(new Set()));
  };

  useEffect(() => {
    refreshAvailableLogIds();
    return window.betaflight.onProfileChanged(() => {
      refreshAvailableLogIds();
    });
  }, []);

  const fetchBBSettings = (connStatus: ConnectionStatus) => {
    if (connStatus.connected) {
      setFcVersion(connStatus.fcInfo?.version || '');
      window.betaflight
        .getBlackboxSettings()
        .then((s) => setBbSettings(s))
        .catch(() => setBbSettings(null));
    } else {
      setBbSettings(null);
      setFcVersion('');
    }
  };

  useEffect(() => {
    // Listen for connection changes
    const unsubscribeConnection = window.betaflight.onConnectionChanged((status) => {
      setIsConnected(status.connected);
      fetchBBSettings(status);
      if (status.connected) {
        window.betaflight
          .getBlackboxInfo()
          .then((info) => {
            setFlashUsedSize(info.usedSize);
            setStorageType(info.storageType);
          })
          .catch(() => setFlashUsedSize(null));
      } else {
        setFlashUsedSize(null);
      }
    });

    // Listen for new FC detection
    const unsubscribeNewFC = window.betaflight.onNewFCDetected((fcSerial, fcInfo) => {
      setNewFCSerial(fcSerial);
      setNewFCInfo(fcInfo);
      setShowProfileWizard(true);
    });

    return () => {
      unsubscribeConnection();
      unsubscribeNewFC();
    };
  }, []);

  const handleProfileWizardComplete = async (
    input:
      | ProfileCreationInput
      | { presetId: string; customName?: string; flightStyle?: FlightStyle }
  ) => {
    try {
      if ('presetId' in input) {
        // Create from preset
        const profile = await createProfileFromPreset(input.presetId, input.customName);
        // Apply flight style selection (may differ from preset default)
        if (input.flightStyle) {
          await updateProfile(profile.id, { flightStyle: input.flightStyle });
        }
      } else {
        // Create custom profile (flightStyle included in ProfileCreationInput)
        await createProfile(input);
      }
      setShowProfileWizard(false);
      setNewFCSerial(null);
      setNewFCInfo(null);
    } catch (error) {
      console.error('Failed to create profile:', error);
      const message = error instanceof Error ? error.message : 'Failed to create profile';
      toast.error(message);
      // Keep wizard open on error so user can retry
    }
  };

  const handleTuningAction = async (action: TuningAction) => {
    switch (action) {
      case 'erase_flash':
        try {
          setErasing(true);
          const currentPhase = tuning.session?.phase;

          // filter_applied "Continue" → transition to pid_flight_pending before erase
          if (currentPhase === TUNING_PHASE.FILTER_APPLIED) {
            await tuning.updatePhase(TUNING_PHASE.PID_FLIGHT_PENDING);
          }

          await window.betaflight.eraseBlackboxFlash();
          // Re-read phase after potential transition above
          const phaseForErase =
            currentPhase === TUNING_PHASE.FILTER_APPLIED
              ? TUNING_PHASE.PID_FLIGHT_PENDING
              : (tuning.session?.phase ?? null);
          setErasedForPhase(phaseForErase);
          setFlashUsedSize(0);
          setBbRefreshKey((k) => k + 1);

          // Persist eraseCompleted so the state survives MSC disconnect/reconnect.
          // For flash this is redundant (flashUsedSize===0 works), but it's harmless
          // and keeps the code path consistent.
          if (phaseForErase) {
            await tuning.updatePhase(phaseForErase as TuningPhase, { eraseCompleted: true });
          }

          toast.success(storageType === 'sdcard' ? 'Logs erased' : 'Flash memory erased');
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to erase');
        } finally {
          setErasing(false);
        }
        break;
      case 'skip_erase': {
        const currentPhaseSkip = tuning.session?.phase;
        if (currentPhaseSkip === TUNING_PHASE.FILTER_APPLIED) {
          await tuning.updatePhase(TUNING_PHASE.PID_FLIGHT_PENDING, { eraseSkipped: true });
        } else if (flashUsedSize != null && flashUsedSize > 0) {
          // Flash has data — advance directly to log_ready (user wants to use existing data)
          const logReadyPhase =
            currentPhaseSkip === TUNING_PHASE.QUICK_FLIGHT_PENDING
              ? TUNING_PHASE.QUICK_LOG_READY
              : currentPhaseSkip === TUNING_PHASE.FILTER_FLIGHT_PENDING
                ? TUNING_PHASE.FILTER_LOG_READY
                : TUNING_PHASE.PID_LOG_READY;
          await tuning.updatePhase(logReadyPhase);
        } else {
          // No data on flash — persist eraseSkipped flag, wait for reconnect after flight
          await tuning.updatePhase(tuning.session!.phase, { eraseSkipped: true });
        }
        setBbRefreshKey((k) => k + 1);
        break;
      }
      case 'import_log':
        try {
          const imported = await window.betaflight.importBlackboxLog();
          if (!imported) break; // User cancelled file dialog

          toast.success(`Log imported: ${imported.filename}`);

          // Transition session to *_analysis phase and store the log ID
          const importPhase = tuning.session?.phase;
          if (importPhase === TUNING_PHASE.FILTER_LOG_READY) {
            await tuning.updatePhase(TUNING_PHASE.FILTER_ANALYSIS, { filterLogId: imported.id });
          } else if (importPhase === TUNING_PHASE.PID_LOG_READY) {
            await tuning.updatePhase(TUNING_PHASE.PID_ANALYSIS, { pidLogId: imported.id });
          } else if (importPhase === TUNING_PHASE.QUICK_LOG_READY) {
            await tuning.updatePhase(TUNING_PHASE.QUICK_ANALYSIS, { quickLogId: imported.id });
          } else if (importPhase === TUNING_PHASE.VERIFICATION_PENDING) {
            await tuning.updatePhase(TUNING_PHASE.VERIFICATION_PENDING, {
              verificationLogId: imported.id,
            });
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to import log');
        }
        break;
      case 'download_log':
        try {
          setDownloading(true);
          setDownloadProgress(0);
          const metadata = await window.betaflight.downloadBlackboxLog((progress) => {
            setDownloadProgress(progress);
          });
          toast.success(`Log downloaded: ${metadata.filename}`);

          // Transition session to *_analysis phase and store the log ID.
          // Clear eraseCompleted — the phase is advancing past the erase step.
          const phase = tuning.session?.phase;
          if (phase === TUNING_PHASE.FILTER_LOG_READY) {
            await tuning.updatePhase(TUNING_PHASE.FILTER_ANALYSIS, {
              filterLogId: metadata.id,
              eraseCompleted: undefined,
            });
          } else if (phase === TUNING_PHASE.PID_LOG_READY) {
            await tuning.updatePhase(TUNING_PHASE.PID_ANALYSIS, {
              pidLogId: metadata.id,
              eraseCompleted: undefined,
            });
          } else if (phase === TUNING_PHASE.QUICK_LOG_READY) {
            await tuning.updatePhase(TUNING_PHASE.QUICK_ANALYSIS, {
              quickLogId: metadata.id,
              eraseCompleted: undefined,
            });
          } else if (phase === TUNING_PHASE.VERIFICATION_PENDING) {
            // Save verification log ID without changing phase
            await tuning.updatePhase(TUNING_PHASE.VERIFICATION_PENDING, {
              verificationLogId: metadata.id,
              eraseCompleted: undefined,
            });
          }
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to download log');
        } finally {
          setDownloading(false);
          setDownloadProgress(0);
        }
        break;
      case 'open_filter_wizard': {
        const filterLogId = tuning.session?.filterLogId;
        if (filterLogId) {
          setWizardMode('filter');
          setActiveLogId(filterLogId);
        } else {
          toast.info('Download a Blackbox log first');
        }
        break;
      }
      case 'open_pid_wizard': {
        const pidLogId = tuning.session?.pidLogId;
        if (pidLogId) {
          setWizardMode('pid');
          setActiveLogId(pidLogId);
        } else {
          toast.info('Download a Blackbox log first');
        }
        break;
      }
      case 'open_quick_wizard': {
        const quickLogId = tuning.session?.quickLogId;
        if (quickLogId) {
          setWizardMode(TUNING_MODE.FLASH);
          setActiveLogId(quickLogId);
        } else {
          toast.info('Download a Blackbox log first');
        }
        break;
      }
      case 'start_new_cycle':
        try {
          setErasedForPhase(null);
          await tuning.startSession();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to start new cycle');
        }
        break;
      case 'complete_session':
        try {
          setErasedForPhase(null);
          await tuning.updatePhase(TUNING_PHASE.COMPLETED);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to complete session');
        }
        break;
      case 'prepare_verification':
        try {
          setErasing(true);
          await tuning.updatePhase(TUNING_PHASE.VERIFICATION_PENDING);
          await window.betaflight.eraseBlackboxFlash();
          setErasedForPhase(TUNING_PHASE.VERIFICATION_PENDING);
          setFlashUsedSize(0);
          setBbRefreshKey((k) => k + 1);
          // Persist eraseCompleted for SD card MSC disconnect survival
          await tuning.updatePhase(TUNING_PHASE.VERIFICATION_PENDING, { eraseCompleted: true });
          toast.success(storageType === 'sdcard' ? 'Logs erased!' : 'Flash erased!');
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to prepare verification');
        } finally {
          setErasing(false);
        }
        break;
      case 'skip_verification':
        try {
          setErasedForPhase(null);
          await tuning.updatePhase(TUNING_PHASE.COMPLETED);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to complete session');
        }
        break;
      case 'analyze_verification': {
        const verLogId = tuning.session?.verificationLogId;
        if (!verLogId) {
          toast.info('Download a verification log first');
          break;
        }
        setIsReanalyze(false);
        setVerificationPickerLogId(verLogId);
        break;
      }
      case 'dismiss':
        try {
          setErasedForPhase(null);
          await tuning.resetSession();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed to reset session');
        }
        break;
    }
  };

  const handleApplyComplete = async (changes: {
    filterChanges?: AppliedChange[];
    pidChanges?: AppliedChange[];
    feedforwardChanges?: AppliedChange[];
    filterMetrics?: FilterMetricsSummary;
    pidMetrics?: PIDMetricsSummary;
    transferFunctionMetrics?: TransferFunctionMetricsSummary;
  }) => {
    const phase = tuning.session?.phase;
    if (phase === TUNING_PHASE.FILTER_ANALYSIS) {
      await tuning.updatePhase(TUNING_PHASE.FILTER_APPLIED, {
        appliedFilterChanges: changes.filterChanges,
        filterMetrics: changes.filterMetrics,
      });
    } else if (phase === TUNING_PHASE.PID_ANALYSIS) {
      await tuning.updatePhase(TUNING_PHASE.PID_APPLIED, {
        appliedPIDChanges: changes.pidChanges,
        appliedFeedforwardChanges: changes.feedforwardChanges,
        pidMetrics: changes.pidMetrics,
      });
    } else if (phase === TUNING_PHASE.QUICK_ANALYSIS) {
      await tuning.updatePhase(TUNING_PHASE.QUICK_APPLIED, {
        appliedFilterChanges: changes.filterChanges,
        appliedPIDChanges: changes.pidChanges,
        appliedFeedforwardChanges: changes.feedforwardChanges,
        filterMetrics: changes.filterMetrics,
        pidMetrics: changes.pidMetrics,
        transferFunctionMetrics: changes.transferFunctionMetrics,
      });
    }
  };

  const handleVerificationAnalyze = async (sessionIndex: number) => {
    const verLogId = verificationPickerLogId;
    const historyRecordId = reanalyzeHistoryRecordId;
    setVerificationPickerLogId(null);
    setReanalyzeHistoryRecordId(null);
    if (!verLogId) return;

    try {
      setAnalyzingVerification(true);
      const filterResult = await window.betaflight.analyzeFilters(verLogId, sessionIndex);
      const verificationMetrics = extractFilterMetrics(filterResult);

      // For Flash Tune sessions, also run TF analysis on verification flight
      const isFlashSession = tuning.session?.tuningType === TUNING_TYPE.FLASH;
      let verificationTFMetrics: TransferFunctionMetricsSummary | undefined;
      if (isFlashSession) {
        try {
          const tfResult = await window.betaflight.analyzeTransferFunction(verLogId, sessionIndex);
          if (tfResult.transferFunctionMetrics) {
            verificationTFMetrics = extractTransferFunctionMetrics(
              tfResult.transferFunctionMetrics
            );
          }
        } catch {
          // TF analysis failure is non-fatal — noise comparison still works
        }
      }

      if (historyRecordId) {
        // Re-analyze a historical record
        await window.betaflight.updateHistoryVerification(historyRecordId, verificationMetrics);
        await tuningHistory.reload();
      } else if (isReanalyze) {
        // Re-analyze — update session + history without duplicate archive
        await window.betaflight.updateVerificationMetrics(
          verificationMetrics,
          verificationTFMetrics
        );
      } else {
        // First-time — transition to completed (archives session)
        await tuning.updatePhase(TUNING_PHASE.COMPLETED, {
          verificationMetrics,
          verificationTransferFunctionMetrics: verificationTFMetrics,
        });
      }
      setErasedForPhase(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to analyze verification');
    } finally {
      setAnalyzingVerification(false);
    }
  };

  const handleReanalyzeVerification = () => {
    const verLogId = tuning.session?.verificationLogId;
    if (!verLogId) return;
    setIsReanalyze(true);
    setVerificationPickerLogId(verLogId);
  };

  const handleReanalyzeHistory = (record: CompletedTuningRecord) => {
    if (!record.verificationLogId) return;
    setReanalyzeHistoryRecordId(record.id);
    setVerificationPickerLogId(record.verificationLogId);
  };

  const handleResetDemo = async () => {
    try {
      setResettingDemo(true);
      await window.betaflight.resetDemo();
      setErasedForPhase(null);
      setBbRefreshKey((k) => k + 1);
      await tuningHistory.reload();
      toast.success('Demo reset — starting from cycle 0');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reset demo');
    } finally {
      setResettingDemo(false);
    }
  };

  const bbStatus = computeBBSettingsStatus(bbSettings, fcVersion);

  const handleBannerFixSettings = async () => {
    setShowBannerFixConfirm(false);
    setFixingSettings(true);
    try {
      markIntentionalDisconnect();
      await window.betaflight.fixBlackboxSettings({ commands: bbStatus.fixCommands });
      toast.success('Blackbox settings fixed, FC rebooting');
    } catch {
      // FC reboots — reconnect will re-fetch settings
    } finally {
      setFixingSettings(false);
    }
  };

  const handleAnalyze = (logId: string, logName?: string) => {
    if (tuning.session) {
      // Active tuning session — open wizard in mode matching current phase
      const phase = tuning.session.phase;
      if (phase === TUNING_PHASE.FILTER_ANALYSIS) {
        setWizardMode('filter');
      } else if (phase === TUNING_PHASE.PID_ANALYSIS) {
        setWizardMode('pid');
      } else if (phase === TUNING_PHASE.QUICK_ANALYSIS) {
        setWizardMode(TUNING_MODE.FLASH);
      } else {
        setWizardMode('filter');
      }
      setActiveLogId(logId);
    } else {
      // No tuning session — open read-only analysis overview
      setAnalysisLogId(logId);
      setAnalysisLogName(logName || null);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-left">
          <h1>PIDlab</h1>
          <span className="app-bf-compat">BF 4.3+</span>
        </div>
        <div className="app-header-right">
          <span className="version">v0.1.0</span>
          {isDemoMode && (
            <button
              className="demo-reset-btn"
              onClick={handleResetDemo}
              disabled={resettingDemo}
              title="Reset demo state to cycle 0"
            >
              {resettingDemo ? 'Resetting...' : 'Reset Demo'}
            </button>
          )}
          <button
            className="app-help-button"
            onClick={() => setShowWorkflowHelp(true)}
            title="How to prepare Blackbox data"
          >
            How to tune?
          </button>
        </div>
      </header>

      <main className="app-main">
        {analysisLogId ? (
          <AnalysisOverview
            logId={analysisLogId}
            logName={analysisLogName || analysisLogId}
            onExit={() => {
              setAnalysisLogId(null);
              setAnalysisLogName(null);
            }}
          />
        ) : activeLogId ? (
          <TuningWizard
            logId={activeLogId}
            mode={wizardMode}
            onExit={() => setActiveLogId(null)}
            onApplyComplete={handleApplyComplete}
          />
        ) : (
          <div className="main-content">
            <div className={`top-row ${isConnected && currentProfile ? 'top-row-connected' : ''}`}>
              <ConnectionPanel />
              {isConnected && currentProfile && <ProfileSelector />}
            </div>
            {isConnected &&
              currentProfile &&
              tuning.session &&
              tuning.session.phase === TUNING_PHASE.COMPLETED && (
                <TuningCompletionSummary
                  session={tuning.session}
                  onDismiss={() => handleTuningAction('dismiss')}
                  onStartNew={() => handleTuningAction('start_new_cycle')}
                  onReanalyzeVerification={handleReanalyzeVerification}
                />
              )}
            {isConnected &&
              currentProfile &&
              tuning.session &&
              tuning.session.phase !== TUNING_PHASE.COMPLETED && (
                <TuningStatusBanner
                  session={tuning.session}
                  flashErased={erasedForPhase === tuning.session.phase}
                  flashUsedSize={flashUsedSize}
                  storageType={storageType}
                  erasing={erasing}
                  downloading={downloading}
                  downloadProgress={downloadProgress}
                  analyzingVerification={analyzingVerification}
                  bbSettingsOk={bbStatus.allOk}
                  fixingSettings={fixingSettings}
                  isDemoMode={isDemoMode}
                  onFixSettings={() => setShowBannerFixConfirm(true)}
                  onAction={handleTuningAction}
                  onViewGuide={(mode) => setShowFlightGuideMode(mode)}
                  onReset={async () => {
                    try {
                      setErasedForPhase(null);
                      await tuning.resetSession();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Failed to reset');
                    }
                  }}
                />
              )}
            {isConnected && currentProfile && !tuning.session && !tuning.loading && (
              <div className="start-tuning-banner">
                <p>Ready to tune? Choose your tuning mode to get started.</p>
                <button
                  className="wizard-btn wizard-btn-primary"
                  onClick={() => setShowStartTuningModal(true)}
                >
                  Start Tuning Session
                </button>
              </div>
            )}
            {isConnected && <FCInfoDisplay />}
            {isConnected && (
              <BlackboxStatus
                onAnalyze={handleAnalyze}
                readonly={!!tuning.session}
                refreshKey={bbRefreshKey}
              />
            )}
            {isConnected && currentProfile && <SnapshotManager />}
            {isConnected && currentProfile && (
              <TuningHistoryPanel
                history={tuningHistory.history}
                loading={tuningHistory.loading}
                onReanalyzeHistory={handleReanalyzeHistory}
                availableLogIds={availableLogIds}
              />
            )}
          </div>
        )}
      </main>

      {showProfileWizard && newFCSerial && newFCInfo && (
        <ProfileWizard
          fcSerial={newFCSerial}
          fcInfo={newFCInfo}
          onComplete={handleProfileWizardComplete}
        />
      )}

      {showWorkflowHelp && <TuningWorkflowModal onClose={() => setShowWorkflowHelp(false)} />}

      {showStartTuningModal && (
        <StartTuningModal
          onStart={async (tuningType) => {
            setShowStartTuningModal(false);
            try {
              setErasedForPhase(null);
              await tuning.startSession(tuningType);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Failed to start tuning session');
            }
          }}
          onCancel={() => setShowStartTuningModal(false)}
        />
      )}

      {showFlightGuideMode && (
        <TuningWorkflowModal
          mode={showFlightGuideMode}
          onClose={() => setShowFlightGuideMode(null)}
        />
      )}

      {showBannerFixConfirm && bbStatus.fixCommands.length > 0 && (
        <FixSettingsConfirmModal
          commands={bbStatus.fixCommands}
          onConfirm={handleBannerFixSettings}
          onCancel={() => setShowBannerFixConfirm(false)}
        />
      )}

      {verificationPickerLogId && (
        <VerificationSessionModal
          logId={verificationPickerLogId}
          onAnalyze={handleVerificationAnalyze}
          onCancel={() => setVerificationPickerLogId(null)}
        />
      )}

      <ToastContainer />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
