import { ipcMain } from 'electron';
import {
  IPCChannel,
  type IPCResponse,
  type SnapshotRestoreResult,
  type SnapshotRestoreProgress,
} from '@shared/types/ipc.types';
import type { ConfigurationSnapshot, SnapshotMetadata } from '@shared/types/common.types';
import { HandlerDependencies, createResponse } from './types';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { validateCLIResponse } from '../../msp/cliUtils';

export function registerSnapshotHandlers(deps: HandlerDependencies): void {
  // SNAPSHOT_CREATE
  ipcMain.handle(
    IPCChannel.SNAPSHOT_CREATE,
    async (_, label?: string): Promise<IPCResponse<ConfigurationSnapshot>> => {
      try {
        if (!deps.snapshotManager) {
          throw new Error('Snapshot manager not initialized');
        }
        const snapshot = await deps.snapshotManager.createSnapshot(label);
        return createResponse<ConfigurationSnapshot>(snapshot);
      } catch (error) {
        logger.error('Failed to create snapshot:', error);
        return createResponse<ConfigurationSnapshot>(undefined, getErrorMessage(error));
      }
    }
  );

  // SNAPSHOT_LIST (server-side filtering by current profile)
  ipcMain.handle(IPCChannel.SNAPSHOT_LIST, async (): Promise<IPCResponse<SnapshotMetadata[]>> => {
    try {
      if (!deps.snapshotManager) {
        throw new Error('Snapshot manager not initialized');
      }
      if (!deps.profileManager) {
        throw new Error('Profile manager not initialized');
      }

      // Get current profile to filter snapshots
      const currentProfile = await deps.profileManager.getCurrentProfile();
      if (!currentProfile) {
        // No profile selected, return empty list
        return createResponse<SnapshotMetadata[]>([]);
      }

      // Get all snapshots and filter by current profile's snapshot IDs
      const allSnapshots = await deps.snapshotManager.listSnapshots();
      const profileSnapshots = allSnapshots.filter((snapshot: SnapshotMetadata) =>
        currentProfile.snapshotIds.includes(snapshot.id)
      );

      return createResponse<SnapshotMetadata[]>(profileSnapshots);
    } catch (error) {
      logger.error('Failed to list snapshots:', error);
      return createResponse<SnapshotMetadata[]>(undefined, getErrorMessage(error));
    }
  });

  // SNAPSHOT_DELETE
  ipcMain.handle(IPCChannel.SNAPSHOT_DELETE, async (_, id: string): Promise<IPCResponse<void>> => {
    try {
      if (!deps.snapshotManager) {
        throw new Error('Snapshot manager not initialized');
      }
      await deps.snapshotManager.deleteSnapshot(id);
      return createResponse<void>(undefined);
    } catch (error) {
      logger.error('Failed to delete snapshot:', error);
      return createResponse<void>(undefined, getErrorMessage(error));
    }
  });

  // SNAPSHOT_EXPORT
  ipcMain.handle(
    IPCChannel.SNAPSHOT_EXPORT,
    async (_, id: string, filePath: string): Promise<IPCResponse<void>> => {
      try {
        if (!deps.snapshotManager) {
          throw new Error('Snapshot manager not initialized');
        }
        await deps.snapshotManager.exportSnapshot(id, filePath);
        return createResponse<void>(undefined);
      } catch (error) {
        logger.error('Failed to export snapshot:', error);
        return createResponse<void>(undefined, getErrorMessage(error));
      }
    }
  );

  // SNAPSHOT_LOAD
  ipcMain.handle(
    IPCChannel.SNAPSHOT_LOAD,
    async (_, id: string): Promise<IPCResponse<ConfigurationSnapshot>> => {
      try {
        if (!deps.snapshotManager) {
          throw new Error('Snapshot manager not initialized');
        }
        const snapshot = await deps.snapshotManager.loadSnapshot(id);
        return createResponse<ConfigurationSnapshot>(snapshot);
      } catch (error) {
        logger.error('Failed to load snapshot:', error);
        return createResponse<ConfigurationSnapshot>(undefined, getErrorMessage(error));
      }
    }
  );

  // SNAPSHOT_RESTORE (complex restore flow)
  ipcMain.handle(
    IPCChannel.SNAPSHOT_RESTORE,
    async (
      event,
      snapshotId: string,
      createBackup: boolean
    ): Promise<IPCResponse<SnapshotRestoreResult>> => {
      try {
        if (!deps.mspClient) throw new Error('MSP client not initialized');
        if (!deps.mspClient.isConnected()) throw new Error('Flight controller not connected');
        if (!deps.snapshotManager) throw new Error('Snapshot manager not initialized');

        const sendProgress = (progress: SnapshotRestoreProgress) => {
          event.sender.send(IPCChannel.EVENT_SNAPSHOT_RESTORE_PROGRESS, progress);
        };

        // Load snapshot
        const snapshot = await deps.snapshotManager.loadSnapshot(snapshotId);
        if (!snapshot) throw new Error(`Snapshot not found: ${snapshotId}`);

        // Parse CLI diff — extract restorable CLI commands
        // Safe commands: set, feature, serial, aux, beacon, map, resource, timer, dma
        // Skip: diff all, batch start/end, defaults nosave, save, board_name,
        //       manufacturer_id, mcu_id, signature, comments (#), profile/rateprofile selection
        const SKIP_PREFIXES = [
          'diff',
          'batch',
          'defaults',
          'save',
          'board_name',
          'manufacturer_id',
          'mcu_id',
          'signature',
          'profile',
          'rateprofile',
        ];
        const cliDiff: string = snapshot.configuration.cliDiff || '';
        const restorableCommands = cliDiff
          .split('\n')
          .map((line: string) => line.trim())
          .filter((line: string) => {
            if (!line || line.length < 3 || line.startsWith('#')) return false;
            const prefix = line.split(/\s/)[0].toLowerCase();
            return !SKIP_PREFIXES.includes(prefix);
          });

        if (restorableCommands.length === 0) {
          throw new Error('Snapshot contains no restorable settings');
        }

        logger.info(`Restoring snapshot ${snapshotId}: ${restorableCommands.length} CLI commands`);

        // Stage 1: Create backup snapshot (enters CLI mode via exportCLIDiff)
        let backupSnapshotId: string | undefined;
        if (createBackup) {
          sendProgress({ stage: 'backup', message: 'Creating pre-restore backup...', percent: 10 });
          const backupSnapshot = await deps.snapshotManager.createSnapshot('Pre-restore (auto)');
          backupSnapshotId = backupSnapshot.id;
          logger.info(`Pre-restore backup created: ${backupSnapshotId}`);
        }

        sendProgress({ stage: 'backup', message: 'Backup complete', percent: 20 });

        // Stage 2: Enter CLI and send set commands
        sendProgress({ stage: 'cli', message: 'Entering CLI mode...', percent: 25 });
        await deps.mspClient.connection.enterCLI();

        for (let i = 0; i < restorableCommands.length; i++) {
          const cmd = restorableCommands[i];
          sendProgress({
            stage: 'cli',
            message: `Applying: ${cmd}`,
            percent: 25 + Math.round((i / restorableCommands.length) * 55),
          });
          const response = await deps.mspClient.connection.sendCLICommand(cmd);
          validateCLIResponse(cmd, response);
        }

        logger.info(`Applied ${restorableCommands.length} CLI commands from snapshot`);

        // Stage 3: Save and reboot
        sendProgress({ stage: 'save', message: 'Saving and rebooting FC...', percent: 90 });
        await deps.mspClient.saveAndReboot();

        sendProgress({ stage: 'save', message: 'FC is rebooting', percent: 100 });

        const result: SnapshotRestoreResult = {
          success: true,
          backupSnapshotId,
          appliedCommands: restorableCommands.length,
          rebooted: true,
        };

        logger.info(`Snapshot restored: ${restorableCommands.length} commands applied, rebooted`);
        return createResponse<SnapshotRestoreResult>(result);
      } catch (error) {
        logger.error('Failed to restore snapshot:', error);
        return createResponse<SnapshotRestoreResult>(undefined, getErrorMessage(error));
      }
    }
  );
}
