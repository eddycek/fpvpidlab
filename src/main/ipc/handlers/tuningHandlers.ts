import { ipcMain } from 'electron';
import {
  IPCChannel,
  ApplyRecommendationsInput,
  ApplyRecommendationsResult,
  ApplyRecommendationsProgress,
  IPCResponse,
} from '@shared/types/ipc.types';
import { TuningSession, TuningPhase, TuningType } from '@shared/types/tuning.types';
import { TUNING_TYPE, TUNING_PHASE, TUNING_TYPE_LABELS } from '@shared/constants';
import {
  CompletedTuningRecord,
  FilterMetricsSummary,
  PIDMetricsSummary,
  TransferFunctionMetricsSummary,
} from '@shared/types/tuning-history.types';
import { PIDConfiguration } from '@shared/types/pid.types';
import { HandlerDependencies, createResponse } from './types';
import { sendTuningSessionChanged } from './events';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { validateCLIResponse } from '../../msp/cliUtils';
import { MockMSPClient } from '../../demo/MockMSPClient';

export function registerTuningHandlers(deps: HandlerDependencies): void {
  const { mspClient, snapshotManager, profileManager, tuningSessionManager, tuningHistoryManager } =
    deps;

  const emitEvent = (
    type: 'error' | 'workflow' | 'analysis',
    name: string,
    meta?: Record<string, string | number | boolean>
  ) => deps.eventCollector?.emit(type, name, meta);

  // Tuning apply handler
  ipcMain.handle(
    IPCChannel.TUNING_APPLY_RECOMMENDATIONS,
    async (
      event,
      input: ApplyRecommendationsInput
    ): Promise<IPCResponse<ApplyRecommendationsResult>> => {
      try {
        if (!mspClient) throw new Error('MSP client not initialized');
        if (!mspClient.isConnected()) throw new Error('Flight controller not connected');

        const ffRecs = input.feedforwardRecommendations ?? [];
        const totalRecs =
          input.filterRecommendations.length + input.pidRecommendations.length + ffRecs.length;

        // Zero recommendations: skip apply, return success without reboot
        if (totalRecs === 0) {
          logger.info('No recommendations to apply — completing without changes');
          return createResponse<ApplyRecommendationsResult>({
            success: true,
            appliedPIDs: 0,
            appliedFilters: 0,
            appliedFeedforward: 0,
            rebooted: false,
          });
        }

        const sendProgress = (progress: ApplyRecommendationsProgress) => {
          event.sender.send(IPCChannel.EVENT_TUNING_APPLY_PROGRESS, progress);
        };

        // Order matters: MSP commands first (PIDs), then CLI operations
        // (snapshot, filters, save). createSnapshot() enters CLI mode via
        // exportCLIDiff() and does NOT exit — so any MSP commands after it
        // would time out (the FC only processes CLI input while in CLI mode).

        // Stage 0: Ensure correct BF PID profile is selected (safety net)
        if (profileManager && tuningSessionManager) {
          const pId = profileManager.getCurrentProfileId();
          if (pId) {
            const session = await tuningSessionManager.getSession(pId);
            if (session?.bfPidProfileIndex !== undefined) {
              sendProgress({ stage: 'pid', message: 'Selecting PID profile...', percent: 2 });
              await mspClient.selectPidProfile(session.bfPidProfileIndex);
              logger.info(`Apply: ensured BF PID profile ${session.bfPidProfileIndex}`);
            }
          }
        }

        // Stage 1: Apply PID recommendations via MSP (must happen before CLI)
        let appliedPIDs = 0;
        if (input.pidRecommendations.length > 0) {
          sendProgress({ stage: 'pid', message: 'Applying PID changes via MSP...', percent: 5 });

          const currentConfig = await mspClient.getPIDConfiguration();
          const newConfig: PIDConfiguration = JSON.parse(JSON.stringify(currentConfig));

          for (const rec of input.pidRecommendations) {
            const match = rec.setting.match(/^pid_(roll|pitch|yaw)_(p|i|d)$/i);
            if (!match) {
              logger.warn(`Unknown PID setting: ${rec.setting}, skipping`);
              continue;
            }
            const axis = match[1] as 'roll' | 'pitch' | 'yaw';
            const term = match[2].toUpperCase() as 'P' | 'I' | 'D';
            const value = Math.round(Math.max(0, Math.min(255, rec.recommendedValue)));
            newConfig[axis][term] = value;
            appliedPIDs++;
          }

          if (appliedPIDs > 0) {
            await mspClient.setPIDConfiguration(newConfig);
            logger.info(`Applied ${appliedPIDs} PID changes`);
          }
        }

        sendProgress({ stage: 'pid', message: `Applied ${appliedPIDs} PID changes`, percent: 20 });

        // Stage 2: Apply filter recommendations via CLI
        let appliedFilters = 0;
        const needsCLI = input.filterRecommendations.length > 0 || ffRecs.length > 0;
        if (needsCLI) {
          sendProgress({ stage: 'filter', message: 'Entering CLI mode...', percent: 50 });
          await mspClient.connection.enterCLI();
        }

        if (input.filterRecommendations.length > 0) {
          try {
            for (const rec of input.filterRecommendations) {
              const value = Math.round(rec.recommendedValue);
              const cmd = `set ${rec.setting} = ${value}`;
              sendProgress({
                stage: 'filter',
                message: `Setting ${rec.setting} = ${value}...`,
                percent:
                  50 + Math.round((appliedFilters / input.filterRecommendations.length) * 25),
              });
              const response = await mspClient.connection.sendCLICommand(cmd);
              validateCLIResponse(cmd, response);
              appliedFilters++;
            }

            logger.info(`Applied ${appliedFilters} filter changes via CLI`);
          } catch (filterError) {
            // #8: PIDs were already written via MSP (Stage 1) but filter CLI commands failed.
            // FC has mixed state: new PIDs + old filters in RAM. Save was NOT called yet.
            // Pre-tuning snapshot remains valid for rollback.
            logger.error(
              `Filter apply failed after ${appliedPIDs} PIDs were already written. ` +
                `FC has mixed state (new PIDs, old filters). Save was NOT called. ` +
                `Pre-tuning snapshot is valid for rollback.`,
              filterError
            );
            throw new Error(
              `Filter changes failed (${appliedFilters}/${input.filterRecommendations.length} applied). ` +
                `${appliedPIDs > 0 ? `${appliedPIDs} PID changes were already written to FC RAM. ` : ''}` +
                `FC was NOT saved — power cycle to discard, or restore from pre-tuning snapshot.`
            );
          }
        }

        sendProgress({
          stage: 'filter',
          message: `Applied ${appliedFilters} filter changes`,
          percent: 75,
        });

        // Stage 3b: Apply feedforward recommendations via CLI
        let appliedFeedforward = 0;
        if (ffRecs.length > 0) {
          for (const rec of ffRecs) {
            const value = Math.round(rec.recommendedValue);
            const cmd = `set ${rec.setting} = ${value}`;
            sendProgress({
              stage: 'feedforward',
              message: `Setting ${rec.setting} = ${value}...`,
              percent: 75 + Math.round((appliedFeedforward / ffRecs.length) * 10),
            });
            const response = await mspClient.connection.sendCLICommand(cmd);
            validateCLIResponse(cmd, response);
            appliedFeedforward++;
          }

          logger.info(`Applied ${appliedFeedforward} feedforward changes via CLI`);
        }

        sendProgress({
          stage: 'feedforward',
          message: `Applied ${appliedFeedforward} feedforward changes`,
          percent: 85,
        });

        // Stage 4: Create post-tuning snapshot (before save & reboot to avoid race)
        // FC is in CLI mode from filter/FF apply (or snapshot will enter CLI).
        // This is non-fatal — if it fails, we still save and reboot.
        if (snapshotManager && profileManager && tuningSessionManager) {
          try {
            const profileId = profileManager.getCurrentProfileId();
            if (profileId) {
              const session = await tuningSessionManager.getSession(profileId);
              if (session && !session.postTuningSnapshotId) {
                let sessionNumber = 1;
                if (tuningHistoryManager) {
                  const history = await tuningHistoryManager.getHistory(profileId);
                  sessionNumber = history.length + 1;
                }
                const tuningType = (session.tuningType ??
                  'filter') as keyof typeof TUNING_TYPE_LABELS;
                const label = `Post-tuning #${sessionNumber} (${TUNING_TYPE_LABELS[tuningType]})`;
                sendProgress({
                  stage: 'save',
                  message: 'Creating post-tuning snapshot...',
                  percent: 88,
                });
                const snapshot = await snapshotManager.createSnapshot(label, 'auto', {
                  tuningSessionNumber: sessionNumber,
                  tuningType,
                  snapshotRole: 'post-tuning',
                });
                await tuningSessionManager.updatePhase(profileId, session.phase, {
                  postTuningSnapshotId: snapshot.id,
                });
                logger.info(`Post-tuning snapshot created: ${snapshot.id}`);
              }
            }
          } catch (e) {
            logger.warn('Could not create post-tuning snapshot (non-fatal):', e);
          }
        }

        // Stage 5: Save and reboot
        sendProgress({ stage: 'save', message: 'Saving and rebooting FC...', percent: 90 });
        await mspClient.saveAndReboot();

        sendProgress({ stage: 'save', message: 'FC is rebooting', percent: 100 });

        const result: ApplyRecommendationsResult = {
          success: true,
          appliedPIDs,
          appliedFilters,
          appliedFeedforward,
          rebooted: true,
        };

        logger.info(
          `Tuning applied: ${appliedPIDs} PIDs, ${appliedFilters} filters, ${appliedFeedforward} FF, rebooted`
        );
        return createResponse<ApplyRecommendationsResult>(result);
      } catch (error) {
        emitEvent('error', 'apply_failed', { stage: 'apply', message: getErrorMessage(error) });
        logger.error('Failed to apply recommendations:', error);
        return createResponse<ApplyRecommendationsResult>(undefined, getErrorMessage(error));
      }
    }
  );

  // Tuning Session handlers
  ipcMain.handle(
    IPCChannel.TUNING_GET_SESSION,
    async (): Promise<IPCResponse<TuningSession | null>> => {
      try {
        if (!tuningSessionManager || !profileManager) {
          return createResponse<TuningSession | null>(null);
        }
        const profileId = profileManager.getCurrentProfileId();
        if (!profileId) {
          return createResponse<TuningSession | null>(null);
        }
        const session = await tuningSessionManager.getSession(profileId);
        return createResponse<TuningSession | null>(session);
      } catch (error) {
        logger.error('Failed to get tuning session:', error);
        return createResponse<TuningSession | null>(undefined, getErrorMessage(error));
      }
    }
  );

  ipcMain.handle(
    IPCChannel.TUNING_START_SESSION,
    async (
      _event,
      tuningType?: TuningType,
      bfPidProfileIndex?: number
    ): Promise<IPCResponse<TuningSession>> => {
      try {
        const resolvedType: TuningType = tuningType ?? TUNING_TYPE.FILTER;

        if (!tuningSessionManager || !profileManager) {
          return createResponse<TuningSession>(undefined, 'Tuning session manager not initialized');
        }
        const profileId = profileManager.getCurrentProfileId();
        if (!profileId) {
          return createResponse<TuningSession>(undefined, 'No active profile');
        }

        // Stage 0: Switch BF PID profile if requested (before snapshot and PID reads)
        if (bfPidProfileIndex !== undefined && mspClient?.isConnected()) {
          try {
            await mspClient.selectPidProfile(bfPidProfileIndex);
            logger.info(`Switched to BF PID profile ${bfPidProfileIndex} for tuning session`);
          } catch (e) {
            logger.error('Failed to switch PID profile:', e);
            return createResponse<TuningSession>(
              undefined,
              `Failed to switch PID profile: ${getErrorMessage(e)}`
            );
          }
        }

        // Create safety snapshot before starting tuning
        let baselineSnapshotId: string | undefined;
        if (snapshotManager && mspClient?.isConnected()) {
          try {
            // Compute session number from history (1-based)
            let sessionNumber = 1;
            if (tuningHistoryManager) {
              const history = await tuningHistoryManager.getHistory(profileId);
              sessionNumber = history.length + 1;
            }
            const label = `Pre-tuning #${sessionNumber} (${TUNING_TYPE_LABELS[resolvedType]})`;
            const snapshot = await snapshotManager.createSnapshot(label, 'auto', {
              tuningSessionNumber: sessionNumber,
              tuningType: resolvedType,
              snapshotRole: 'pre-tuning',
            });
            baselineSnapshotId = snapshot.id;
            logger.info(`Pre-tuning backup created: ${snapshot.id}`);
          } catch (e) {
            logger.warn('Could not create pre-tuning snapshot:', e);
          }
        }

        // Tell MockMSPClient which flight type cycle to use
        if (deps.isDemoMode && mspClient instanceof MockMSPClient) {
          if (resolvedType === TUNING_TYPE.FLASH) {
            mspClient.setFlashTuneMode();
          } else if (resolvedType === TUNING_TYPE.PID) {
            mspClient.setPIDTuneMode();
          } else {
            mspClient.setFilterTuneMode();
          }
        }

        const session = await tuningSessionManager.createSession(profileId, resolvedType);
        const initialPhase =
          resolvedType === TUNING_TYPE.FLASH
            ? TUNING_PHASE.FLASH_FLIGHT_PENDING
            : resolvedType === TUNING_TYPE.PID
              ? TUNING_PHASE.PID_FLIGHT_PENDING
              : TUNING_PHASE.FILTER_FLIGHT_PENDING;
        const phaseData: Partial<TuningSession> = {};
        if (baselineSnapshotId) phaseData.baselineSnapshotId = baselineSnapshotId;
        if (bfPidProfileIndex !== undefined) phaseData.bfPidProfileIndex = bfPidProfileIndex;
        if (Object.keys(phaseData).length > 0) {
          await tuningSessionManager.updatePhase(profileId, initialPhase, phaseData);
        }

        // Persist selected profile as preference for next session
        if (bfPidProfileIndex !== undefined && profileManager) {
          try {
            await profileManager.updateProfile(profileId, { bfPidProfileIndex });
          } catch (e) {
            logger.warn('Could not persist bfPidProfileIndex preference:', e);
          }
        }

        const updated = await tuningSessionManager.getSession(profileId);
        if (updated) {
          deps.eventCollector?.setActiveSessionId(updated.id);
          emitEvent('workflow', 'tuning_started', { mode: resolvedType });
        }
        sendTuningSessionChanged(updated);
        return createResponse<TuningSession>(updated || session);
      } catch (error) {
        logger.error('Failed to start tuning session:', error);
        return createResponse<TuningSession>(undefined, getErrorMessage(error));
      }
    }
  );

  ipcMain.handle(
    IPCChannel.TUNING_UPDATE_PHASE,
    async (
      _event,
      phase: TuningPhase,
      data?: Partial<TuningSession>
    ): Promise<IPCResponse<TuningSession>> => {
      try {
        if (!tuningSessionManager || !profileManager) {
          return createResponse<TuningSession>(undefined, 'Tuning session manager not initialized');
        }
        const profileId = profileManager.getCurrentProfileId();
        if (!profileId) {
          return createResponse<TuningSession>(undefined, 'No active profile');
        }

        // Archive session to history before completing
        if (phase === TUNING_PHASE.COMPLETED && tuningHistoryManager) {
          try {
            // In demo mode, advance past skipped verification so flight type cycle stays in sync
            if (deps.isDemoMode && mspClient instanceof MockMSPClient) {
              mspClient.advancePastVerification();
            }

            // First update the phase to 'completed' so the session has the final data
            const completedSession = await tuningSessionManager.updatePhase(
              profileId,
              TUNING_PHASE.COMPLETED,
              data
            );
            await tuningHistoryManager.archiveSession(completedSession);
            logger.info(`Tuning session archived to history for profile ${profileId}`);
            emitEvent('workflow', 'tuning_completed', {
              mode: completedSession.tuningType ?? 'filter',
              qualityScore: (completedSession as any).qualityScore ?? 0,
            });
            deps.eventCollector?.setActiveSessionId(undefined);
            deps.telemetryManager?.onTuningSessionCompleted().catch(() => {});
            sendTuningSessionChanged(completedSession);
            return createResponse<TuningSession>(completedSession);
          } catch (archiveError) {
            logger.warn('Failed to archive tuning session (non-fatal):', archiveError);
            // Fall through to normal update if archive fails
          }
        }

        const updated = await tuningSessionManager.updatePhase(profileId, phase, data);
        emitEvent('workflow', 'phase_changed', {
          mode: updated.tuningType ?? 'filter',
          to: phase,
        });
        sendTuningSessionChanged(updated);
        return createResponse<TuningSession>(updated);
      } catch (error) {
        logger.error('Failed to update tuning phase:', error);
        return createResponse<TuningSession>(undefined, getErrorMessage(error));
      }
    }
  );

  // Tuning History handler
  ipcMain.handle(
    IPCChannel.TUNING_GET_HISTORY,
    async (): Promise<IPCResponse<CompletedTuningRecord[]>> => {
      try {
        if (!tuningHistoryManager || !profileManager) {
          return createResponse<CompletedTuningRecord[]>([]);
        }
        const profileId = profileManager.getCurrentProfileId();
        if (!profileId) {
          return createResponse<CompletedTuningRecord[]>([]);
        }
        const history = await tuningHistoryManager.getHistory(profileId);
        return createResponse<CompletedTuningRecord[]>(history);
      } catch (error) {
        logger.error('Failed to get tuning history:', error);
        return createResponse<CompletedTuningRecord[]>(undefined, getErrorMessage(error));
      }
    }
  );

  ipcMain.handle(IPCChannel.TUNING_RESET_SESSION, async (): Promise<IPCResponse<void>> => {
    try {
      if (!tuningSessionManager || !profileManager) {
        return createResponse<void>(undefined);
      }
      const profileId = profileManager.getCurrentProfileId();
      if (!profileId) {
        return createResponse<void>(undefined);
      }

      // Emit abandoned event before deletion
      const abandonedSession = await tuningSessionManager.getSession(profileId);
      if (abandonedSession) {
        emitEvent('workflow', 'tuning_abandoned', {
          mode: abandonedSession.tuningType ?? 'filter',
          atPhase: abandonedSession.phase,
        });
        deps.eventCollector?.setActiveSessionId(undefined);
      }

      await tuningSessionManager.deleteSession(profileId);
      sendTuningSessionChanged(null);
      return createResponse<void>(undefined);
    } catch (error) {
      logger.error('Failed to reset tuning session:', error);
      return createResponse<void>(undefined, getErrorMessage(error));
    }
  });

  // Update verification metrics on active session + latest history record (no duplicate archive)
  ipcMain.handle(
    IPCChannel.TUNING_UPDATE_VERIFICATION,
    async (
      _event,
      verificationMetrics?: FilterMetricsSummary,
      verificationTransferFunctionMetrics?: TransferFunctionMetricsSummary,
      verificationPidMetrics?: PIDMetricsSummary
    ): Promise<IPCResponse<TuningSession>> => {
      try {
        if (!tuningSessionManager || !profileManager) {
          return createResponse<TuningSession>(undefined, 'Tuning session manager not initialized');
        }
        const profileId = profileManager.getCurrentProfileId();
        if (!profileId) {
          return createResponse<TuningSession>(undefined, 'No active profile');
        }

        // Update the active session's verification metrics (keep phase as 'completed')
        const updateData: Record<string, unknown> = {};
        if (verificationMetrics) updateData.verificationMetrics = verificationMetrics;
        if (verificationTransferFunctionMetrics) {
          updateData.verificationTransferFunctionMetrics = verificationTransferFunctionMetrics;
        }
        if (verificationPidMetrics) updateData.verificationPidMetrics = verificationPidMetrics;
        const updated = await tuningSessionManager.updatePhase(
          profileId,
          TUNING_PHASE.COMPLETED,
          updateData
        );

        // Update the latest history record (no new archive entry)
        if (tuningHistoryManager) {
          await tuningHistoryManager.updateLatestVerification(
            profileId,
            verificationMetrics,
            verificationTransferFunctionMetrics,
            verificationPidMetrics
          );
        }

        sendTuningSessionChanged(updated);
        return createResponse<TuningSession>(updated);
      } catch (error) {
        logger.error('Failed to update verification metrics:', error);
        return createResponse<TuningSession>(undefined, getErrorMessage(error));
      }
    }
  );

  // Update verification metrics on a specific history record (by record ID)
  ipcMain.handle(
    IPCChannel.TUNING_UPDATE_HISTORY_VERIFICATION,
    async (
      _event,
      recordId: string,
      verificationMetrics?: FilterMetricsSummary,
      verificationPidMetrics?: PIDMetricsSummary
    ): Promise<IPCResponse<void>> => {
      try {
        if (!tuningHistoryManager || !profileManager) {
          return createResponse<void>(undefined, 'Tuning history manager not initialized');
        }
        const profileId = profileManager.getCurrentProfileId();
        if (!profileId) {
          return createResponse<void>(undefined, 'No active profile');
        }

        const updated = await tuningHistoryManager.updateRecordVerification(
          profileId,
          recordId,
          verificationMetrics,
          verificationPidMetrics
        );
        if (!updated) {
          return createResponse<void>(undefined, `History record not found: ${recordId}`);
        }

        return createResponse<void>(undefined);
      } catch (error) {
        logger.error('Failed to update history verification:', error);
        return createResponse<void>(undefined, getErrorMessage(error));
      }
    }
  );

  logger.info('Tuning IPC handlers registered');
}
