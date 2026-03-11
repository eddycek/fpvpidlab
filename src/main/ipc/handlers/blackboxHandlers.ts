import { ipcMain, shell, dialog } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IPCChannel } from '@shared/types/ipc.types';
import type {
  BlackboxInfo,
  BlackboxLogMetadata,
  BlackboxParseResult,
} from '@shared/types/blackbox.types';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { BlackboxParser } from '../../blackbox/BlackboxParser';
import { MSCProgress } from '../../msc/MSCManager';
import type { HandlerDependencies } from './types';
import { createResponse } from './types';

/**
 * Registers Blackbox-related IPC handlers.
 */
export function registerBlackboxHandlers(deps: HandlerDependencies): void {
  ipcMain.handle(IPCChannel.BLACKBOX_GET_INFO, async () => {
    try {
      if (!deps.mspClient) {
        return createResponse<BlackboxInfo>(undefined, 'MSP client not initialized');
      }

      const info = await deps.mspClient.getBlackboxInfo();
      return createResponse<BlackboxInfo>(info);
    } catch (error) {
      logger.error('Failed to get Blackbox info:', error);
      return createResponse<BlackboxInfo>(undefined, getErrorMessage(error));
    }
  });

  ipcMain.handle(IPCChannel.BLACKBOX_DOWNLOAD_LOG, async (event) => {
    try {
      if (!deps.mspClient) {
        logger.error('MSPClient not initialized');
        return createResponse<BlackboxLogMetadata>(undefined, 'MSPClient not initialized');
      }
      if (!deps.blackboxManager) {
        logger.error('BlackboxManager not initialized');
        return createResponse<BlackboxLogMetadata>(undefined, 'BlackboxManager not initialized');
      }
      if (!deps.profileManager) {
        logger.error('ProfileManager not initialized');
        return createResponse<BlackboxLogMetadata>(undefined, 'ProfileManager not initialized');
      }

      // Get current profile
      const currentProfile = await deps.profileManager.getCurrentProfile();
      if (!currentProfile) {
        return createResponse<BlackboxLogMetadata>(undefined, 'No active profile selected');
      }

      // Prevent concurrent downloads
      if (deps.isDownloadingBlackbox) {
        return createResponse<BlackboxLogMetadata>(undefined, 'Download already in progress');
      }

      deps.isDownloadingBlackbox = true;

      try {
        // Branch on storage type
        const storageType = deps.mspClient.lastStorageType;

        if (storageType === 'sdcard') {
          // --- SD Card: MSC mode download ---
          logger.info('Starting SD card download via MSC mode...');

          if (!deps.mscManager) {
            return createResponse<BlackboxLogMetadata>(undefined, 'MSC manager not initialized');
          }

          // Get FC info before MSC reboot (FC won't be available during MSC)
          const fcInfo = await deps.mspClient.getFCInfo();

          const copiedFiles = await deps.mscManager.downloadLogs(
            deps.blackboxManager.getLogsDir(),
            (progress: MSCProgress) => {
              // Map MSC progress stages to percentage for renderer
              event.sender.send(IPCChannel.EVENT_BLACKBOX_DOWNLOAD_PROGRESS, progress.percent);
            }
          );

          if (copiedFiles.length === 0) {
            return createResponse<BlackboxLogMetadata>(undefined, 'No log files found on SD card');
          }

          // Register each copied file in BlackboxManager
          const allMetadata: BlackboxLogMetadata[] = [];
          for (const file of copiedFiles) {
            const metadata = await deps.blackboxManager.saveLogFromFile(
              file.destPath,
              file.originalName,
              file.size,
              currentProfile.id,
              currentProfile.fcSerialNumber,
              {
                variant: fcInfo.variant,
                version: fcInfo.version,
                target: fcInfo.target,
              }
            );
            allMetadata.push(metadata);
          }

          logger.info(`SD card download complete: ${allMetadata.length} logs saved`);

          // Always return the last (newest) metadata for API compatibility.
          // The preload API signature is Promise<BlackboxLogMetadata> (single object).
          // Tuning workflow needs only the most recent flight log.
          // All files are still saved to disk.
          const latest = allMetadata[allMetadata.length - 1];
          return createResponse<BlackboxLogMetadata>(latest);
        } else {
          // --- Flash: existing MSP_DATAFLASH_READ path ---
          logger.info('Starting flash download via MSP...');

          const downloadResult = await deps.mspClient.downloadBlackboxLog((progress: number) => {
            event.sender.send(IPCChannel.EVENT_BLACKBOX_DOWNLOAD_PROGRESS, progress);
          });

          const fcInfo = await deps.mspClient.getFCInfo();

          const metadata = await deps.blackboxManager.saveLog(
            downloadResult.data,
            currentProfile.id,
            currentProfile.fcSerialNumber,
            {
              variant: fcInfo.variant,
              version: fcInfo.version,
              target: fcInfo.target,
            },
            { compressionDetected: downloadResult.compressionDetected }
          );

          if (downloadResult.compressionDetected) {
            logger.warn(
              `Huffman compression detected in Blackbox log ${metadata.filename} — data cannot be analyzed`
            );
          }

          logger.info(`Blackbox log saved: ${metadata.filename} (${metadata.size} bytes)`);
          return createResponse<BlackboxLogMetadata>(metadata);
        }
      } finally {
        deps.isDownloadingBlackbox = false;
      }
    } catch (error) {
      logger.error('Failed to download Blackbox log:', error);
      return createResponse<BlackboxLogMetadata>(undefined, getErrorMessage(error));
    }
  });

  ipcMain.handle(IPCChannel.BLACKBOX_OPEN_FOLDER, async (_event, filepath: string) => {
    try {
      // Extract directory from filepath
      const directory = path.dirname(filepath);

      logger.info(`Opening Blackbox folder: ${directory}`);

      // Open folder in file manager
      const result = await shell.openPath(directory);

      if (result) {
        throw new Error(`Failed to open folder: ${result}`);
      }

      return createResponse<void>(undefined);
    } catch (error) {
      logger.error('Failed to open Blackbox folder:', error);
      return createResponse<void>(undefined, getErrorMessage(error));
    }
  });

  ipcMain.handle(IPCChannel.BLACKBOX_TEST_READ, async () => {
    try {
      if (!deps.mspClient) {
        return createResponse<{ success: boolean; message: string }>(
          undefined,
          'MSP client not initialized'
        );
      }

      const result = await deps.mspClient.testBlackboxRead();
      return createResponse<{ success: boolean; message: string; data?: string }>(result);
    } catch (error) {
      logger.error('Failed to test Blackbox read:', error);
      return createResponse<{ success: boolean; message: string }>(
        undefined,
        getErrorMessage(error)
      );
    }
  });

  ipcMain.handle(IPCChannel.BLACKBOX_LIST_LOGS, async () => {
    try {
      if (!deps.blackboxManager || !deps.profileManager) {
        return createResponse<BlackboxLogMetadata[]>(undefined, 'Services not initialized');
      }

      const currentProfile = await deps.profileManager.getCurrentProfile();
      if (!currentProfile) {
        // No profile selected, return empty array
        return createResponse<BlackboxLogMetadata[]>([]);
      }

      const logs = await deps.blackboxManager.listLogs(currentProfile.id);
      return createResponse<BlackboxLogMetadata[]>(logs);
    } catch (error) {
      logger.error('Failed to list Blackbox logs:', error);
      return createResponse<BlackboxLogMetadata[]>(undefined, getErrorMessage(error));
    }
  });

  ipcMain.handle(IPCChannel.BLACKBOX_DELETE_LOG, async (_event, logId: string) => {
    try {
      if (!deps.blackboxManager) {
        return createResponse<void>(undefined, 'BlackboxManager not initialized');
      }

      await deps.blackboxManager.deleteLog(logId);
      logger.info(`Deleted Blackbox log: ${logId}`);

      return createResponse<void>(undefined);
    } catch (error) {
      logger.error('Failed to delete Blackbox log:', error);
      return createResponse<void>(undefined, getErrorMessage(error));
    }
  });

  ipcMain.handle(IPCChannel.BLACKBOX_ERASE_FLASH, async (event) => {
    try {
      if (!deps.mspClient) {
        return createResponse<void>(undefined, 'MSP client not initialized');
      }

      const storageType = deps.mspClient.lastStorageType;

      if (storageType === 'sdcard') {
        // --- SD Card: erase via MSC mode ---
        logger.warn('Erasing SD card logs via MSC mode...');
        if (!deps.mscManager) {
          return createResponse<void>(undefined, 'MSC manager not initialized');
        }

        await deps.mscManager.eraseLogs((progress: MSCProgress) => {
          event.sender.send(IPCChannel.EVENT_BLACKBOX_DOWNLOAD_PROGRESS, progress.percent);
        });

        logger.info('SD card logs erased successfully');
      } else {
        // --- Flash: existing erase path ---
        logger.warn('Erasing Blackbox flash memory...');
        await deps.mspClient.eraseBlackboxFlash();
        logger.info('Blackbox flash erased successfully');
      }

      return createResponse<void>(undefined);
    } catch (error) {
      logger.error('Failed to erase Blackbox storage:', error);
      return createResponse<void>(undefined, getErrorMessage(error));
    }
  });

  // Blackbox import handler — user picks a .bbl/.bfl file from disk
  ipcMain.handle(IPCChannel.BLACKBOX_IMPORT_LOG, async () => {
    try {
      if (!deps.blackboxManager) {
        return createResponse<BlackboxLogMetadata>(undefined, 'BlackboxManager not initialized');
      }
      if (!deps.profileManager) {
        return createResponse<BlackboxLogMetadata>(undefined, 'ProfileManager not initialized');
      }

      const currentProfile = await deps.profileManager.getCurrentProfile();
      if (!currentProfile) {
        return createResponse<BlackboxLogMetadata>(undefined, 'No active profile selected');
      }

      const result = await dialog.showOpenDialog({
        title: 'Import Blackbox Log',
        filters: [{ name: 'Blackbox Logs', extensions: ['bbl', 'bfl'] }],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        // User cancelled — not an error
        return createResponse<BlackboxLogMetadata | null>(null);
      }

      const sourcePath = result.filePaths[0];
      const data = await fs.readFile(sourcePath);

      const fcInfo = currentProfile.fcInfo || {
        variant: 'BTFL',
        version: 'unknown',
        target: 'unknown',
      };

      const metadata = await deps.blackboxManager.saveLog(
        data,
        currentProfile.id,
        currentProfile.fcSerialNumber,
        {
          variant: fcInfo.variant,
          version: fcInfo.version || 'unknown',
          target: fcInfo.target,
        }
      );

      logger.info(
        `Imported Blackbox log: ${path.basename(sourcePath)} → ${metadata.filename} (${metadata.size} bytes)`
      );
      return createResponse<BlackboxLogMetadata>(metadata);
    } catch (error) {
      logger.error('Failed to import Blackbox log:', error);
      return createResponse<BlackboxLogMetadata>(undefined, getErrorMessage(error));
    }
  });

  // Blackbox parse handler
  ipcMain.handle(IPCChannel.BLACKBOX_PARSE_LOG, async (event, logId: string) => {
    try {
      if (!deps.blackboxManager) {
        return createResponse<BlackboxParseResult>(undefined, 'BlackboxManager not initialized');
      }

      const logMeta = await deps.blackboxManager.getLog(logId);
      if (!logMeta) {
        return createResponse<BlackboxParseResult>(undefined, `Blackbox log not found: ${logId}`);
      }

      logger.info(`Parsing Blackbox log: ${logMeta.filename} (${logMeta.size} bytes)`);

      // Read the raw log file
      const data = await fs.readFile(logMeta.filepath);

      // Parse with progress reporting
      const result = await BlackboxParser.parse(data, (progress) => {
        event.sender.send(IPCChannel.EVENT_BLACKBOX_PARSE_PROGRESS, progress);
      });

      logger.info(
        `Blackbox log parsed: ${result.sessions.length} sessions, ${result.parseTimeMs}ms`
      );

      return createResponse<BlackboxParseResult>(result);
    } catch (error) {
      logger.error('Failed to parse Blackbox log:', error);
      return createResponse<BlackboxParseResult>(undefined, getErrorMessage(error));
    }
  });
}
