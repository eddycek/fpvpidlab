import { ipcMain } from 'electron';
import { IPCChannel, IPCResponse } from '@shared/types/ipc.types';
import type { LicenseInfo } from '@shared/types/license.types';
import { HandlerDependencies, createResponse } from './types';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { sendLicenseChanged } from './events';
import { getMainWindow } from '../../window';

export function registerLicenseHandlers(deps: HandlerDependencies): void {
  ipcMain.handle(IPCChannel.LICENSE_GET_STATUS, async (): Promise<IPCResponse<LicenseInfo>> => {
    try {
      if (!deps.licenseManager) throw new Error('LicenseManager not initialized');
      const status = deps.licenseManager.getLicenseStatus();
      return createResponse(status);
    } catch (err) {
      logger.error('Failed to get license status:', err);
      return createResponse<LicenseInfo>(undefined, getErrorMessage(err));
    }
  });

  ipcMain.handle(
    IPCChannel.LICENSE_ACTIVATE,
    async (_event, key: string): Promise<IPCResponse<LicenseInfo>> => {
      try {
        if (!deps.licenseManager) throw new Error('LicenseManager not initialized');
        const status = await deps.licenseManager.activate(key);

        const window = getMainWindow();
        if (window) {
          sendLicenseChanged(window, status);
        }

        return createResponse(status);
      } catch (err) {
        logger.error('Failed to activate license:', err);
        return createResponse<LicenseInfo>(undefined, getErrorMessage(err));
      }
    }
  );

  ipcMain.handle(IPCChannel.LICENSE_REMOVE, async (): Promise<IPCResponse<void>> => {
    try {
      if (!deps.licenseManager) throw new Error('LicenseManager not initialized');
      await deps.licenseManager.removeLicense();

      const status = deps.licenseManager.getLicenseStatus();
      const window = getMainWindow();
      if (window) {
        sendLicenseChanged(window, status);
      }

      return createResponse(undefined);
    } catch (err) {
      logger.error('Failed to remove license:', err);
      return createResponse<void>(undefined, getErrorMessage(err));
    }
  });

  ipcMain.handle(IPCChannel.LICENSE_VALIDATE, async (): Promise<IPCResponse<void>> => {
    try {
      if (!deps.licenseManager) throw new Error('LicenseManager not initialized');
      await deps.licenseManager.validateOnline();

      // Validation may revoke key — notify renderer of current status
      const status = deps.licenseManager.getLicenseStatus();
      const window = getMainWindow();
      if (window) {
        sendLicenseChanged(window, status);
      }

      return createResponse(undefined);
    } catch (err) {
      logger.error('Failed to validate license:', err);
      return createResponse<void>(undefined, getErrorMessage(err));
    }
  });
}
