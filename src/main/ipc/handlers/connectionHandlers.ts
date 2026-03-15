import { ipcMain, dialog } from 'electron';
import fs from 'fs/promises';
import { IPCChannel, IPCResponse } from '@shared/types/ipc.types';
import type { PortInfo, ConnectionStatus } from '@shared/types/common.types';
import type { HandlerDependencies } from './types';
import { createResponse } from './types';
import { sendTuningSessionChanged, sendProfileChanged } from './events';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { getMainWindow } from '../../window';
import { MockMSPClient } from '../../demo/MockMSPClient';

/**
 * Registers all connection-related IPC handlers.
 * Handles port listing, connect/disconnect operations, and connection status.
 */
export function registerConnectionHandlers(deps: HandlerDependencies): void {
  ipcMain.handle(IPCChannel.APP_IS_DEMO_MODE, async (): Promise<IPCResponse<boolean>> => {
    return createResponse<boolean>(deps.isDemoMode);
  });

  ipcMain.handle(IPCChannel.APP_RESET_DEMO, async (): Promise<IPCResponse<void>> => {
    try {
      if (!deps.isDemoMode) {
        return createResponse<void>(undefined, 'Reset is only available in demo mode');
      }

      const profileId = deps.profileManager?.getCurrentProfileId();
      if (!profileId) {
        return createResponse<void>(undefined, 'No active profile');
      }

      // Reset MockMSPClient state (tuning cycle, flight type, applied settings, flash)
      (deps.mspClient as MockMSPClient).resetDemoState();

      // Delete tuning session
      await deps.tuningSessionManager?.deleteSession(profileId);
      sendTuningSessionChanged(null);

      // Delete tuning history
      await deps.tuningHistoryManager?.deleteHistory(profileId);

      // Delete blackbox logs
      await deps.blackboxManager?.deleteLogsForProfile(profileId);

      // Delete non-baseline snapshots
      const profile = await deps.profileManager.getProfile(profileId);
      if (profile) {
        const snapshotIds = [...profile.snapshotIds];
        for (const snapId of snapshotIds) {
          if (snapId === profile.baselineSnapshotId) continue;
          try {
            await deps.snapshotManager.deleteSnapshot(snapId);
          } catch {
            // Ignore errors (e.g. baseline guard)
          }
        }
      }

      // Broadcast profile changed to force full UI refresh
      // (snapshots, blackbox logs, tuning history, profiles)
      const mainWindow = getMainWindow();
      if (mainWindow && profile) {
        // Re-read profile after snapshot deletion (snapshotIds may have changed)
        const refreshedProfile = await deps.profileManager.getProfile(profileId);
        sendProfileChanged(mainWindow, refreshedProfile);
      }

      logger.info('[DEMO] Demo reset complete — ready for cycle 0');
      return createResponse<void>(undefined);
    } catch (error) {
      logger.error('Failed to reset demo:', error);
      return createResponse<void>(undefined, getErrorMessage(error));
    }
  });

  ipcMain.handle(IPCChannel.CONNECTION_LIST_PORTS, async (): Promise<IPCResponse<PortInfo[]>> => {
    try {
      if (!deps.mspClient) {
        throw new Error('MSP client not initialized');
      }
      const ports = await deps.mspClient.listPorts();
      return createResponse<PortInfo[]>(ports);
    } catch (error) {
      logger.error('Failed to list ports:', error);
      return createResponse<PortInfo[]>(undefined, getErrorMessage(error));
    }
  });

  ipcMain.handle(
    IPCChannel.CONNECTION_CONNECT,
    async (_, portPath: string): Promise<IPCResponse<void>> => {
      try {
        if (!deps.mspClient) {
          throw new Error('MSP client not initialized');
        }
        await deps.mspClient.connect(portPath);
        return createResponse<void>(undefined);
      } catch (error) {
        logger.error('Failed to connect:', error);
        return createResponse<void>(undefined, getErrorMessage(error));
      }
    }
  );

  ipcMain.handle(IPCChannel.CONNECTION_DISCONNECT, async (): Promise<IPCResponse<void>> => {
    try {
      if (!deps.mspClient) {
        throw new Error('MSP client not initialized');
      }
      await deps.mspClient.disconnect();
      return createResponse<void>(undefined);
    } catch (error) {
      logger.error('Failed to disconnect:', error);
      return createResponse<void>(undefined, getErrorMessage(error));
    }
  });

  ipcMain.handle(
    IPCChannel.CONNECTION_GET_STATUS,
    async (): Promise<IPCResponse<ConnectionStatus>> => {
      try {
        if (!deps.mspClient) {
          throw new Error('MSP client not initialized');
        }
        const status = deps.mspClient.getConnectionStatus();
        return createResponse<ConnectionStatus>(status);
      } catch (error) {
        logger.error('Failed to get connection status:', error);
        return createResponse<ConnectionStatus>(undefined, getErrorMessage(error));
      }
    }
  );

  // ── App Logs ────────────────────────────────────────────────────────

  ipcMain.handle(
    IPCChannel.APP_GET_LOGS,
    async (_event, lines?: number): Promise<IPCResponse<string[]>> => {
      try {
        const logPath = logger.getLogFilePath();
        const content = await fs.readFile(logPath, 'utf-8');
        const allLines = content.split('\n').filter((l) => l.trim());
        const count = lines || 30;
        return createResponse(allLines.slice(-count));
      } catch (err) {
        return createResponse<string[]>(undefined, getErrorMessage(err));
      }
    }
  );

  ipcMain.handle(IPCChannel.APP_EXPORT_LOGS, async (): Promise<IPCResponse<string>> => {
    try {
      const window = getMainWindow();
      if (!window) throw new Error('No window');

      const logPath = logger.getLogFilePath();
      const { filePath } = await dialog.showSaveDialog(window, {
        title: 'Export Application Logs',
        defaultPath: `pidlab-logs-${new Date().toISOString().slice(0, 10)}.log`,
        filters: [{ name: 'Log files', extensions: ['log', 'txt'] }],
      });

      if (!filePath) return createResponse('');

      await fs.copyFile(logPath, filePath);
      return createResponse(filePath);
    } catch (err) {
      return createResponse<string>(undefined, getErrorMessage(err));
    }
  });
}
