import { ipcMain } from 'electron';
import { IPCChannel } from '@shared/types/ipc.types';
import type { PIDConfiguration, PIDTerm } from '@shared/types/pid.types';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { getMainWindow } from '../../window';
import { sendPIDChanged } from './events';
import type { HandlerDependencies } from './types';
import { createResponse } from './types';

/**
 * Validates that all PID values are numbers in the range 0-255.
 */
function validatePIDConfiguration(config: PIDConfiguration): void {
  const axes: Array<keyof PIDConfiguration> = ['roll', 'pitch', 'yaw'];
  const terms: Array<keyof PIDTerm> = ['P', 'I', 'D'];

  for (const axis of axes) {
    const term = config[axis];
    if (!term) throw new Error(`Missing ${axis} configuration`);

    for (const t of terms) {
      const value = term[t];
      if (typeof value !== 'number' || isNaN(value)) {
        throw new Error(`Invalid ${axis} ${t} value: ${value}`);
      }
      if (value < 0 || value > 255) {
        throw new Error(`${axis} ${t} value out of range (0-255): ${value}`);
      }
    }
  }
}

/**
 * Registers PID configuration IPC handlers.
 */
export function registerPIDHandlers(deps: HandlerDependencies): void {
  ipcMain.handle(IPCChannel.PID_GET_CONFIG, async () => {
    try {
      // Cache-first: return cached PID config if available
      const cached = deps.fcStateCache?.getSlice('pidConfig');
      if (cached) {
        return createResponse<PIDConfiguration>(cached);
      }

      if (!deps.mspClient) throw new Error('MSP client not initialized');
      if (!deps.mspClient.isConnected()) throw new Error('Flight controller not connected');

      const config = await deps.mspClient.getPIDConfiguration();
      return createResponse<PIDConfiguration>(config);
    } catch (error) {
      logger.error('Failed to get PID configuration:', error);
      return createResponse<PIDConfiguration>(undefined, getErrorMessage(error));
    }
  });

  ipcMain.handle(IPCChannel.PID_UPDATE_CONFIG, async (_, config: PIDConfiguration) => {
    try {
      if (!deps.mspClient) throw new Error('MSP client not initialized');
      if (!deps.mspClient.isConnected()) throw new Error('Flight controller not connected');

      // Validate config (0-255 range for all values)
      validatePIDConfiguration(config);

      await deps.mspClient.setPIDConfiguration(config);

      // Invalidate cached PID config so next read gets the fresh values
      await deps.fcStateCache?.invalidate(['pidConfig']);

      // Broadcast to all renderer windows
      const window = getMainWindow();
      if (window) {
        sendPIDChanged(window, config);
      }

      return createResponse<void>(undefined);
    } catch (error) {
      logger.error('Failed to update PID configuration:', error);
      return createResponse<void>(undefined, getErrorMessage(error));
    }
  });

  ipcMain.handle(IPCChannel.PID_SAVE_CONFIG, async () => {
    try {
      if (!deps.mspClient) throw new Error('MSP client not initialized');
      if (!deps.mspClient.isConnected()) throw new Error('Flight controller not connected');

      await deps.mspClient.saveAndReboot(); // Uses existing CLI save command

      return createResponse<void>(undefined);
    } catch (error) {
      logger.error('Failed to save PID configuration:', error);
      return createResponse<void>(undefined, getErrorMessage(error));
    }
  });
}
