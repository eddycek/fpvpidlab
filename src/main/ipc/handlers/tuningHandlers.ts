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
import { sendTuningSessionChanged, sendProfileChanged } from './events';
import { getMainWindow } from '../../window';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { validateCLIResponse } from '../../msp/cliUtils';
import { verifyAppliedConfig } from '../../utils/verifyAppliedConfig';
import { sendAutoReport } from '../../diagnostic/DiagnosticReportService';
import { MockMSPClient } from '../../demo/MockMSPClient';

/**
 * Betaflight-valid ranges for CLI filter/FF settings.
 * Used for pre-apply validation to catch recommender bugs before they reach the FC.
 */
const BF_SETTING_RANGES: Record<string, { min: number; max: number }> = {
  gyro_lpf1_static_hz: { min: 0, max: 1000 },
  gyro_lpf1_dyn_min_hz: { min: 0, max: 1000 },
  gyro_lpf1_dyn_max_hz: { min: 0, max: 1000 },
  gyro_lpf2_static_hz: { min: 0, max: 1000 },
  dterm_lpf1_static_hz: { min: 0, max: 1000 },
  dterm_lpf1_dyn_min_hz: { min: 0, max: 1000 },
  dterm_lpf1_dyn_max_hz: { min: 0, max: 1000 },
  dterm_lpf2_static_hz: { min: 0, max: 1000 },
  dterm_lpf1_dyn_expo: { min: 0, max: 10 },
  dyn_notch_min_hz: { min: 20, max: 1000 },
  dyn_notch_max_hz: { min: 20, max: 1000 },
  dyn_notch_count: { min: 0, max: 5 },
  dyn_notch_q: { min: 1, max: 1000 },
  rpm_filter_q: { min: 1, max: 1000 },
  feedforward_boost: { min: 0, max: 50 },
  d_min_gain: { min: 0, max: 250 },
  simplified_dmax_gain: { min: 0, max: 250 },
  iterm_relax: { min: 0, max: 2 },
  iterm_relax_cutoff: { min: 1, max: 100 },
  dyn_idle_min_rpm: { min: 0, max: 200 },
  pidsum_limit: { min: 100, max: 1000 },
  pidsum_limit_yaw: { min: 100, max: 1000 },
  feedforward_max_rate_limit: { min: 0, max: 150 },
  anti_gravity_gain: { min: 0, max: 250 },
  thrust_linear: { min: 0, max: 150 },
  tpa_rate: { min: 0, max: 100 },
  tpa_breakpoint: { min: 1000, max: 2000 },
  tpa_low_always: { min: 0, max: 1 },
};

/**
 * Validate all CLI recommendations are within Betaflight-valid ranges.
 * Throws before any MSP/CLI interaction if any value is out of range.
 */
function validateRecommendationBounds(
  recs: Array<{ setting: string; recommendedValue: number }>,
  label: string
): void {
  const violations: string[] = [];
  for (const rec of recs) {
    const range = BF_SETTING_RANGES[rec.setting];
    if (!range) continue; // Unknown setting — will be validated by CLI itself
    const value = Math.round(rec.recommendedValue);
    if (value < range.min || value > range.max) {
      violations.push(`${rec.setting} = ${value} (valid: ${range.min}-${range.max})`);
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `${label} validation failed — values out of Betaflight range: ${violations.join(', ')}`
    );
  }
}

/**
 * Compute the next tuning session number.
 * Uses max(history count, highest existing snapshot session number) + 1
 * to avoid duplicate numbers when sessions are reset without completing.
 */
async function getNextSessionNumber(deps: HandlerDependencies, profileId: string): Promise<number> {
  let sessionNumber = 1;
  const { tuningHistoryManager, snapshotManager, profileManager } = deps;
  if (tuningHistoryManager) {
    const history = await tuningHistoryManager.getHistory(profileId);
    sessionNumber = history.length + 1;
  }
  // Check existing snapshot numbers to avoid collisions from reset (orphaned) sessions
  if (snapshotManager && profileManager) {
    try {
      const profile = await profileManager.getProfile(profileId);
      if (profile) {
        const snapshots = await snapshotManager.listSnapshots();
        const profileSnaps = snapshots.filter((s: any) => profile.snapshotIds?.includes(s.id));
        for (const s of profileSnaps) {
          if (s.tuningSessionNumber && s.tuningSessionNumber >= sessionNumber) {
            sessionNumber = s.tuningSessionNumber + 1;
          }
        }
      }
    } catch {
      // Non-fatal — fall back to history-only count
    }
  }
  return sessionNumber;
}

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

        // Pre-apply validation: reject entire apply if any value is out of BF range
        const actionableFilters = input.filterRecommendations.filter((r) => !r.informational);
        validateRecommendationBounds(actionableFilters, 'Filter');
        validateRecommendationBounds(ffRecs, 'Feedforward');

        // Order matters: MSP commands first (PIDs), then CLI operations
        // (filters, save). The apply flow enters CLI explicitly for filter/FF
        // commands — exportCLIDiff() detects wasInCLI=true and skips exit.

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
        // Read current PID config before any changes — used for rollback on filter failure
        let currentConfig: PIDConfiguration | undefined;
        let appliedPIDs = 0;
        if (input.pidRecommendations.length > 0) {
          sendProgress({ stage: 'pid', message: 'Applying PID changes via MSP...', percent: 5 });

          currentConfig = await mspClient.getPIDConfiguration();
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
        // Filter out informational/advisory-only recommendations — they are for display only
        const actionableFilterRecs = input.filterRecommendations.filter((r) => !r.informational);
        const needsCLI = actionableFilterRecs.length > 0 || ffRecs.length > 0;
        if (needsCLI) {
          sendProgress({ stage: 'filter', message: 'Entering CLI mode...', percent: 50 });
          await mspClient.connection.enterCLI();
        }

        if (actionableFilterRecs.length > 0) {
          try {
            for (const rec of actionableFilterRecs) {
              const value = Math.round(rec.recommendedValue);
              const cmd = `set ${rec.setting} = ${value}`;
              sendProgress({
                stage: 'filter',
                message: `Setting ${rec.setting} = ${value}...`,
                percent: 50 + Math.round((appliedFilters / actionableFilterRecs.length) * 25),
              });
              const response = await mspClient.connection.sendCLICommand(cmd);
              logger.debug(`CLI: ${cmd} → ${JSON.stringify(response).slice(0, 200)}`);
              validateCLIResponse(cmd, response);
              appliedFilters++;
            }

            logger.info(`Applied ${appliedFilters} filter changes via CLI`);
          } catch (filterError) {
            // PIDs were already written via MSP (Stage 1) but filter CLI commands failed.
            // FC has mixed state: new PIDs + old filters in RAM. Save was NOT called yet.
            // Attempt automatic PID rollback before surfacing error.
            let pidRolledBack = false;
            if (appliedPIDs > 0 && currentConfig) {
              try {
                logger.info('Attempting PID rollback to pre-apply configuration...');
                // exitCLI() resets local cliMode flag only — does NOT send 'exit' to FC
                // (which would trigger a reboot). This allows MSP commands to work again.
                await mspClient.connection.exitCLI();
                await mspClient.setPIDConfiguration(currentConfig);
                pidRolledBack = true;
                logger.info('PID rollback successful — FC restored to pre-apply PID values');
              } catch (rollbackError) {
                logger.error('PID rollback failed — FC still has mixed state:', rollbackError);
              }
            }

            logger.error(
              `Filter apply failed after ${appliedPIDs} PIDs were already written. ` +
                `PID rollback ${pidRolledBack ? 'succeeded' : 'failed'}. Save was NOT called.`,
              filterError
            );
            throw new Error(
              `Filter changes failed (${appliedFilters}/${actionableFilterRecs.length} applied). ` +
                `${appliedPIDs > 0 ? (pidRolledBack ? 'PID values were automatically rolled back. ' : `${appliedPIDs} PID changes are still in FC RAM. `) : ''}` +
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
          try {
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
          } catch (ffError) {
            // Feedforward CLI commands failed. FC has PIDs + filters in RAM but save NOT called.
            // Attempt PID rollback before surfacing error.
            let pidRolledBack = false;
            if (appliedPIDs > 0 && currentConfig) {
              try {
                logger.info('Attempting PID rollback after feedforward failure...');
                // exitCLI() resets local cliMode flag only — does NOT send 'exit' to FC
                // (which would trigger a reboot). This allows MSP commands to work again.
                await mspClient.connection.exitCLI();
                await mspClient.setPIDConfiguration(currentConfig);
                pidRolledBack = true;
                logger.info('PID rollback successful — FC restored to pre-apply PID values');
              } catch (rollbackError) {
                logger.error('PID rollback failed — FC still has mixed state:', rollbackError);
              }
            }

            logger.error(
              `Feedforward apply failed after ${appliedPIDs} PIDs + ${appliedFilters} filters were already written. ` +
                `PID rollback ${pidRolledBack ? 'succeeded' : 'failed'}. Save was NOT called.`,
              ffError
            );
            throw new Error(
              `Feedforward changes failed (${appliedFeedforward}/${ffRecs.length} applied). ` +
                `${appliedPIDs > 0 ? (pidRolledBack ? 'PID values were automatically rolled back. ' : `${appliedPIDs} PID changes are still in FC RAM. `) : ''}` +
                `${appliedFilters > 0 ? `${appliedFilters} filter change${appliedFilters !== 1 ? 's are' : ' is'} still in FC RAM. ` : ''}` +
                `FC was NOT saved — power cycle to discard, or restore from pre-tuning snapshot.`
            );
          }
        }

        sendProgress({
          stage: 'feedforward',
          message: `Applied ${appliedFeedforward} feedforward changes`,
          percent: 85,
        });

        // Stage 5: Save and reboot — saveAndReboot() now blocks until FC reconnects
        sendProgress({ stage: 'save', message: 'Saving and rebooting FC...', percent: 85 });
        await mspClient.saveAndReboot();

        // FC is now reconnected (or failed to reconnect). Continue with verify+snapshot.
        sendProgress({ stage: 'reboot', message: 'FC reconnected', percent: 88 });

        // Stage 6: Post-apply verification — read back settings and compare
        const profileId = profileManager?.getCurrentProfileId();
        const currentSession = profileId ? await tuningSessionManager?.getSession(profileId) : null;

        if (mspClient.isConnected() && profileId && currentSession) {
          sendProgress({
            stage: 'verify',
            message: 'Verifying applied settings...',
            percent: 90,
          });
          try {
            const verifyResult = await verifyAppliedConfig(
              mspClient,
              currentSession.tuningType,
              currentSession.appliedPIDChanges,
              currentSession.appliedFilterChanges
            );
            await tuningSessionManager!.updatePhase(profileId, currentSession.phase, {
              applyVerified: verifyResult.verified,
              applyMismatches:
                verifyResult.mismatches.length > 0 ? verifyResult.mismatches : undefined,
              applyExpected: verifyResult.expected,
              applyActual: verifyResult.actual,
              applySuspicious: verifyResult.suspicious || undefined,
            });
            if (verifyResult.verified) {
              logger.info('Apply verify: all settings match FC');
            } else {
              logger.warn(
                `Apply verify: ${verifyResult.mismatches.length} mismatches`,
                verifyResult.mismatches
              );
              if (verifyResult.retried) {
                logger.info('Apply verify: PID retry was attempted');
              }

              // Fire-and-forget auto-report on verification failure
              const refreshedForReport = await tuningSessionManager!.getSession(profileId);
              if (refreshedForReport) {
                sendAutoReport(
                  {
                    profileManager: profileManager!,
                    snapshotManager: snapshotManager!,
                    telemetrySettings: deps.telemetryManager?.getSettings?.() ?? null,
                    eventCollector: deps.eventCollector ?? null,
                    licenseManager: deps.licenseManager ?? null,
                    isDemoMode: mspClient instanceof MockMSPClient,
                  },
                  refreshedForReport,
                  verifyResult.mismatches,
                  verifyResult.expected,
                  verifyResult.actual,
                  verifyResult.suspicious
                )
                  .then(async (autoReportId) => {
                    if (autoReportId && profileId) {
                      try {
                        // Reload current session to avoid regressing phase with a stale value
                        const latestSession = await tuningSessionManager!.getSession(profileId);
                        if (!latestSession) {
                          logger.warn('Auto-report ID not saved: tuning session no longer exists');
                          return;
                        }
                        await tuningSessionManager!.updatePhase(profileId, latestSession.phase, {
                          autoReportId,
                        });
                        logger.info(`Auto-report ID saved to session: ${autoReportId}`);
                      } catch (saveErr) {
                        logger.warn('Failed to save autoReportId to session:', saveErr);
                      }
                    }
                  })
                  .catch((err) => {
                    logger.warn('Auto-report submission failed:', err);
                  });
              }
            }
          } catch (verifyErr) {
            logger.warn('Apply verification failed (non-fatal):', verifyErr);
          }

          // Stage 7: Create post-tuning snapshot
          sendProgress({
            stage: 'snapshot',
            message: 'Creating post-tuning snapshot...',
            percent: 95,
          });
          try {
            const refreshedSession = await tuningSessionManager!.getSession(profileId);
            const tuningType = (refreshedSession?.tuningType ??
              currentSession.tuningType) as keyof typeof TUNING_TYPE_LABELS;
            // Use session number from TuningSession (set at creation) so Pre/Post pairs match.
            // Fallback chain: session → baseline snapshot → computed next number
            let sessionNumber = refreshedSession?.tuningSessionNumber;
            if (!sessionNumber && refreshedSession?.baselineSnapshotId && snapshotManager) {
              try {
                const baseline = await snapshotManager.loadSnapshot(
                  refreshedSession.baselineSnapshotId
                );
                if (baseline?.metadata?.tuningSessionNumber) {
                  sessionNumber = baseline.metadata.tuningSessionNumber;
                }
              } catch {
                // Fall back to computed number
              }
            }
            if (!sessionNumber) {
              sessionNumber = await getNextSessionNumber(deps, profileId);
            }
            const label = `Post-tuning #${sessionNumber} (${TUNING_TYPE_LABELS[tuningType]})`;
            // createSnapshot → exportCLIDiff → exit → FC reboots.
            // Guard with rebootPending so connected handler skips fallback work.
            mspClient.setRebootPending();
            let snapshot;
            try {
              snapshot = await snapshotManager!.createSnapshot(label, 'auto', {
                tuningSessionNumber: sessionNumber,
                tuningType,
                snapshotRole: 'post-tuning',
              });
            } finally {
              mspClient.clearRebootPending();
            }
            await tuningSessionManager!.updatePhase(profileId, currentSession.phase, {
              postTuningSnapshotId: snapshot.id,
            });
            logger.info(`Post-tuning snapshot created in apply handler: ${snapshot.id}`);

            // Emit profileChanged so renderer refreshes snapshot list
            const win = getMainWindow();
            if (win && profileManager) {
              const profile = await profileManager.getCurrentProfile();
              if (profile) {
                sendProfileChanged(win, profile);
              }
            }
          } catch (snapErr) {
            logger.warn('Could not create post-tuning snapshot (non-fatal):', snapErr);
          }

          // Re-emit session so UI picks up verify+snapshot changes
          const finalSession = await tuningSessionManager!.getSession(profileId);
          if (finalSession) {
            sendTuningSessionChanged(finalSession);
          }
        }

        sendProgress({ stage: 'done', message: 'Apply complete', percent: 100 });

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

        // Read rates BEFORE snapshot — snapshot enters CLI mode (exportCLIDiff),
        // and BF CLI exit triggers FC reboot, making MSP unavailable afterward
        let ratesConfig: TuningSession['ratesConfig'];
        if (mspClient?.isConnected()) {
          try {
            ratesConfig = await mspClient.getRatesConfiguration();
          } catch (e) {
            logger.warn('Could not read rates configuration:', e);
          }
        }

        // Create safety snapshot before starting tuning.
        // exportCLIDiff() enters CLI → reads diff → sends `exit` → FC REBOOTS.
        // On boards where USB re-enumerates, the disconnect handler fires.
        // Setting rebootPending prevents it from clearing the profile/session.
        // exportCLIDiff() handles the full reboot+reconnect cycle internally.
        let baselineSnapshotId: string | undefined;
        let computedSessionNumber: number | undefined;
        if (snapshotManager && mspClient?.isConnected()) {
          try {
            const sessionNumber = await getNextSessionNumber(deps, profileId);
            computedSessionNumber = sessionNumber;
            const label = `Pre-tuning #${sessionNumber} (${TUNING_TYPE_LABELS[resolvedType]})`;

            // Protect against disconnect handler clearing state during FC reboot
            mspClient.setRebootPending();

            const snapshot = await snapshotManager.createSnapshot(label, 'auto', {
              tuningSessionNumber: sessionNumber,
              tuningType: resolvedType,
              snapshotRole: 'pre-tuning',
            });
            baselineSnapshotId = snapshot.id;
            logger.info(`Pre-tuning backup created: ${snapshot.id}`);

            // exportCLIDiff() handles the full reboot cycle: waits for FC,
            // reconnects if USB re-enumerated, pings MSP until responsive.
            // Clear rebootPending after — FC is either reconnected or truly gone.
            mspClient.clearRebootPending();
          } catch (e) {
            mspClient.clearRebootPending();
            logger.warn('Could not create pre-tuning snapshot:', e);
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
        if (computedSessionNumber !== undefined)
          phaseData.tuningSessionNumber = computedSessionNumber;
        if (bfPidProfileIndex !== undefined) phaseData.bfPidProfileIndex = bfPidProfileIndex;
        if (ratesConfig) phaseData.ratesConfig = ratesConfig;
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

        // Emit profileChanged so the renderer refreshes the snapshot list
        // (pre-tuning snapshot was created above, UI needs to pick it up)
        if (baselineSnapshotId) {
          const win = getMainWindow();
          if (win && profileManager) {
            const profile = await profileManager.getCurrentProfile();
            if (profile) {
              sendProfileChanged(win, profile);
            }
          }
        }

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
              mode: completedSession.tuningType,
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
          mode: updated.tuningType,
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
          mode: abandonedSession.tuningType,
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
