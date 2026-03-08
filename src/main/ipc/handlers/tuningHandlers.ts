import { ipcMain } from 'electron';
import {
  IPCChannel,
  ApplyRecommendationsInput,
  ApplyRecommendationsResult,
  ApplyRecommendationsProgress,
  IPCResponse,
} from '@shared/types/ipc.types';
import { TuningSession, TuningPhase, TuningType } from '@shared/types/tuning.types';
import { CompletedTuningRecord, FilterMetricsSummary } from '@shared/types/tuning-history.types';
import { PIDConfiguration } from '@shared/types/pid.types';
import { HandlerDependencies, createResponse } from './types';
import { sendTuningSessionChanged } from './events';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { MockMSPClient } from '../../demo/MockMSPClient';

export function registerTuningHandlers(deps: HandlerDependencies): void {
  const { mspClient, snapshotManager, profileManager, tuningSessionManager, tuningHistoryManager } =
    deps;

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
        if (totalRecs === 0) throw new Error('No recommendations to apply');

        const sendProgress = (progress: ApplyRecommendationsProgress) => {
          event.sender.send(IPCChannel.EVENT_TUNING_APPLY_PROGRESS, progress);
        };

        // Order matters: MSP commands first (PIDs), then CLI operations
        // (snapshot, filters, save). createSnapshot() enters CLI mode via
        // exportCLIDiff() and does NOT exit — so any MSP commands after it
        // would time out (the FC only processes CLI input while in CLI mode).

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

        // Stage 2: Create pre-apply snapshot if requested (enters CLI via exportCLIDiff)
        let snapshotId: string | undefined;
        if (input.createSnapshot && snapshotManager) {
          try {
            sendProgress({
              stage: 'snapshot',
              message: 'Creating pre-apply snapshot...',
              percent: 25,
            });
            const snapshot = await snapshotManager.createSnapshot('Pre-apply (auto)', 'auto');
            snapshotId = snapshot.id;
            logger.info(`Pre-apply snapshot created: ${snapshotId}`);
          } catch (e) {
            logger.warn('Could not create pre-apply snapshot (non-fatal):', e);
          }
        }

        // Stage 3: Apply filter recommendations via CLI
        let appliedFilters = 0;
        const needsCLI = input.filterRecommendations.length > 0 || ffRecs.length > 0;
        if (needsCLI) {
          // createSnapshot() enters CLI via exportCLIDiff() and does NOT exit,
          // so we may already be in CLI mode — only enter if not already there.
          if (!mspClient.connection.isInCLI()) {
            sendProgress({ stage: 'filter', message: 'Entering CLI mode...', percent: 50 });
            await mspClient.connection.enterCLI();
          }
        }

        if (input.filterRecommendations.length > 0) {
          for (const rec of input.filterRecommendations) {
            const value = Math.round(rec.recommendedValue);
            const cmd = `set ${rec.setting} = ${value}`;
            sendProgress({
              stage: 'filter',
              message: `Setting ${rec.setting} = ${value}...`,
              percent: 50 + Math.round((appliedFilters / input.filterRecommendations.length) * 25),
            });
            await mspClient.connection.sendCLICommand(cmd);
            appliedFilters++;
          }

          logger.info(`Applied ${appliedFilters} filter changes via CLI`);
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
            await mspClient.connection.sendCLICommand(cmd);
            appliedFeedforward++;
          }

          logger.info(`Applied ${appliedFeedforward} feedforward changes via CLI`);
        }

        sendProgress({
          stage: 'feedforward',
          message: `Applied ${appliedFeedforward} feedforward changes`,
          percent: 85,
        });

        // Stage 4: Save and reboot
        sendProgress({ stage: 'save', message: 'Saving and rebooting FC...', percent: 90 });
        await mspClient.saveAndReboot();

        sendProgress({ stage: 'save', message: 'FC is rebooting', percent: 100 });

        const result: ApplyRecommendationsResult = {
          success: true,
          snapshotId,
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
    async (_event, tuningType?: TuningType): Promise<IPCResponse<TuningSession>> => {
      try {
        const resolvedType: TuningType = tuningType ?? 'guided';

        if (!tuningSessionManager || !profileManager) {
          return createResponse<TuningSession>(undefined, 'Tuning session manager not initialized');
        }
        const profileId = profileManager.getCurrentProfileId();
        if (!profileId) {
          return createResponse<TuningSession>(undefined, 'No active profile');
        }

        // Create safety snapshot before starting tuning
        let baselineSnapshotId: string | undefined;
        if (snapshotManager && mspClient?.isConnected()) {
          try {
            const snapshot = await snapshotManager.createSnapshot('Pre-tuning (auto)', 'auto');
            baselineSnapshotId = snapshot.id;
            logger.info(`Pre-tuning backup created: ${snapshot.id}`);
          } catch (e) {
            logger.warn('Could not create pre-tuning snapshot:', e);
          }
        }

        // Tell MockMSPClient to generate quick BBL data when quick mode is selected
        if (resolvedType === 'quick' && deps.isDemoMode && mspClient instanceof MockMSPClient) {
          mspClient.setQuickTuneMode();
        }

        const session = await tuningSessionManager.createSession(profileId, resolvedType);
        const initialPhase =
          resolvedType === 'quick' ? 'quick_flight_pending' : 'filter_flight_pending';
        if (baselineSnapshotId) {
          await tuningSessionManager.updatePhase(profileId, initialPhase, {
            baselineSnapshotId,
          });
        }

        const updated = await tuningSessionManager.getSession(profileId);
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
        if (phase === 'completed' && tuningHistoryManager) {
          try {
            // In demo mode, advance past skipped verification so flight type cycle stays in sync
            if (deps.isDemoMode && mspClient instanceof MockMSPClient) {
              mspClient.advancePastVerification();
            }

            // First update the phase to 'completed' so the session has the final data
            const completedSession = await tuningSessionManager.updatePhase(profileId, phase, data);
            await tuningHistoryManager.archiveSession(completedSession);
            logger.info(`Tuning session archived to history for profile ${profileId}`);
            sendTuningSessionChanged(completedSession);
            return createResponse<TuningSession>(completedSession);
          } catch (archiveError) {
            logger.warn('Failed to archive tuning session (non-fatal):', archiveError);
            // Fall through to normal update if archive fails
          }
        }

        const updated = await tuningSessionManager.updatePhase(profileId, phase, data);
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
      verificationMetrics: FilterMetricsSummary
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
        const updated = await tuningSessionManager.updatePhase(profileId, 'completed', {
          verificationMetrics,
        });

        // Update the latest history record (no new archive entry)
        if (tuningHistoryManager) {
          await tuningHistoryManager.updateLatestVerification(profileId, verificationMetrics);
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
      verificationMetrics: FilterMetricsSummary
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
          verificationMetrics
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
