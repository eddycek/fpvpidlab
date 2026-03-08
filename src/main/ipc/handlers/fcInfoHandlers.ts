import { ipcMain } from 'electron';
import { IPCChannel } from '@shared/types/ipc.types';
import type { BlackboxSettings } from '@shared/types/blackbox.types';
import type { FeedforwardConfiguration } from '@shared/types/pid.types';
import type { FCInfo } from '@shared/types/common.types';
import type { FixBlackboxSettingsInput, FixBlackboxSettingsResult } from '@shared/types/ipc.types';
import type { HandlerDependencies } from './types';
import { createResponse, parseDiffSetting } from './types';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { validateCLIResponse } from '../../msp/cliUtils';
import type { IPCResponse } from '@shared/types/ipc.types';

/**
 * Register FC info IPC handlers.
 * Extracts FC info, CLI export, blackbox settings, feedforward config, and settings fix handlers.
 */
export function registerFCInfoHandlers(deps: HandlerDependencies): void {
  // FC_GET_INFO
  ipcMain.handle(IPCChannel.FC_GET_INFO, async (): Promise<IPCResponse<FCInfo>> => {
    try {
      if (!deps.mspClient) {
        throw new Error('MSP client not initialized');
      }
      const info = await deps.mspClient.getFCInfo();
      return createResponse<FCInfo>(info);
    } catch (error) {
      logger.error('Failed to get FC info:', error);
      return createResponse<FCInfo>(undefined, getErrorMessage(error));
    }
  });

  // FC_EXPORT_CLI
  ipcMain.handle(
    IPCChannel.FC_EXPORT_CLI,
    async (_, format: 'diff' | 'dump'): Promise<IPCResponse<string>> => {
      try {
        if (!deps.mspClient) {
          throw new Error('MSP client not initialized');
        }
        const cli =
          format === 'diff'
            ? await deps.mspClient.exportCLIDiff()
            : await deps.mspClient.exportCLIDump();
        return createResponse<string>(cli);
      } catch (error) {
        logger.error('Failed to export CLI:', error);
        return createResponse<string>(undefined, getErrorMessage(error));
      }
    }
  );

  // FC_GET_BLACKBOX_SETTINGS
  ipcMain.handle(
    IPCChannel.FC_GET_BLACKBOX_SETTINGS,
    async (): Promise<IPCResponse<BlackboxSettings>> => {
      try {
        if (!deps.profileManager || !deps.snapshotManager) {
          throw new Error('Profile/Snapshot manager not initialized');
        }
        // Parse blackbox settings from the baseline snapshot's CLI diff.
        // This avoids entering CLI mode (BF CLI 'exit' reboots the FC).
        const currentProfile = await deps.profileManager.getCurrentProfile();
        if (!currentProfile) {
          throw new Error('No active profile');
        }

        // Use the most recent snapshot (last in array) for the freshest settings.
        // Falls back to baseline if no other snapshots exist.
        let cliDiff = '';
        const ids = currentProfile.snapshotIds;
        for (let i = ids.length - 1; i >= 0; i--) {
          try {
            const snap = await deps.snapshotManager.loadSnapshot(ids[i]);
            if (snap?.configuration?.cliDiff) {
              cliDiff = snap.configuration.cliDiff;
              break;
            }
          } catch {}
        }

        // Parse settings from CLI diff output.
        // If a setting is not in the diff, it's at the BF default.
        const debugMode = parseDiffSetting(cliDiff, 'debug_mode') || 'NONE';
        const sampleRateStr = parseDiffSetting(cliDiff, 'blackbox_sample_rate');

        const sampleRate = sampleRateStr !== undefined ? parseInt(sampleRateStr, 10) : 1;

        // Read pid_process_denom from MSP for accuracy — CLI diff may omit target defaults.
        let pidDenom = 1;
        if (deps.mspClient?.isConnected()) {
          try {
            pidDenom = await deps.mspClient.getPidProcessDenom();
          } catch {
            const pidDenomStr = parseDiffSetting(cliDiff, 'pid_process_denom');
            pidDenom = pidDenomStr !== undefined ? parseInt(pidDenomStr, 10) : 1;
          }
        } else {
          const pidDenomStr = parseDiffSetting(cliDiff, 'pid_process_denom');
          pidDenom = pidDenomStr !== undefined ? parseInt(pidDenomStr, 10) : 1;
        }

        // Effective logging rate: 8kHz gyro / pid_denom / 2^sample_rate
        // BF blackbox_sample_rate is a power-of-2 index: 0=1:1, 1=1:2, 2=1:4
        const pidRate = 8000 / Math.max(pidDenom, 1);
        const loggingRateHz = Math.round(pidRate / Math.pow(2, sampleRate));

        return createResponse<BlackboxSettings>({ debugMode, sampleRate, loggingRateHz });
      } catch (error) {
        logger.error('Failed to get blackbox settings:', error);
        return createResponse<BlackboxSettings>(undefined, getErrorMessage(error));
      }
    }
  );

  // FC_GET_FEEDFORWARD_CONFIG
  ipcMain.handle(
    IPCChannel.FC_GET_FEEDFORWARD_CONFIG,
    async (): Promise<IPCResponse<FeedforwardConfiguration>> => {
      try {
        if (!deps.mspClient) throw new Error('MSP client not initialized');
        if (!deps.mspClient.isConnected()) throw new Error('Flight controller not connected');

        const config = await deps.mspClient.getFeedforwardConfiguration();
        return createResponse<FeedforwardConfiguration>(config);
      } catch (error) {
        logger.error('Failed to get feedforward configuration:', error);
        return createResponse<FeedforwardConfiguration>(undefined, getErrorMessage(error));
      }
    }
  );

  // FC_FIX_BLACKBOX_SETTINGS
  ipcMain.handle(
    IPCChannel.FC_FIX_BLACKBOX_SETTINGS,
    async (_, input: FixBlackboxSettingsInput): Promise<IPCResponse<FixBlackboxSettingsResult>> => {
      try {
        if (!deps.mspClient) throw new Error('MSP client not initialized');
        if (!deps.mspClient.isConnected()) throw new Error('Flight controller not connected');

        if (!input.commands || input.commands.length === 0) {
          throw new Error('No commands to apply');
        }

        logger.info(`Fixing blackbox settings: ${input.commands.length} commands`);

        await deps.mspClient.connection.enterCLI();

        for (const cmd of input.commands) {
          const response = await deps.mspClient.connection.sendCLICommand(cmd);
          validateCLIResponse(cmd, response);
        }

        // Flag for clean snapshot creation on reconnect (after FC reboots).
        // Creating a snapshot mid-CLI is unreliable (MSP/CLI mode conflicts),
        // so we defer it to the next 'connected' event.
        deps.pendingSettingsSnapshot = true;

        await deps.mspClient.saveAndReboot();

        logger.info('Blackbox settings fixed, FC rebooting');
        return createResponse<FixBlackboxSettingsResult>({
          success: true,
          appliedCommands: input.commands.length,
          rebooted: true,
        });
      } catch (error) {
        logger.error('Failed to fix blackbox settings:', error);
        return createResponse<FixBlackboxSettingsResult>(undefined, getErrorMessage(error));
      }
    }
  );
}
