import { ipcMain } from 'electron';
import { IPCChannel, IPCResponse } from '@shared/types/ipc.types';
import type {
  DroneProfile,
  DroneProfileMetadata,
  ProfileCreationInput,
  ProfileUpdateInput,
} from '@shared/types/profile.types';
import { PRESET_PROFILES, LICENSE } from '@shared/constants';
import { logger } from '../../utils/logger';
import { getErrorMessage, ProfileLimitError } from '../../utils/errors';
import { getMainWindow } from '../../window';
import type { HandlerDependencies } from './types';
import { createResponse } from './types';
import { sendConnectionChanged, sendProfileChanged, sendTuningSessionChanged } from './events';

export function registerProfileHandlers(deps: HandlerDependencies): void {
  ipcMain.handle(
    IPCChannel.PROFILE_CREATE,
    async (_, input: ProfileCreationInput): Promise<IPCResponse<DroneProfile>> => {
      try {
        if (!deps.profileManager) {
          throw new Error('Profile manager not initialized');
        }
        if (!deps.snapshotManager) {
          throw new Error('Snapshot manager not initialized');
        }

        // License enforcement: free tier = 1 profile max
        if (deps.licenseManager && !deps.licenseManager.isPro()) {
          const profiles = await deps.profileManager.listProfiles();
          if (profiles.length >= LICENSE.FREE_PROFILE_LIMIT) {
            throw new ProfileLimitError();
          }
        }

        const profile = await deps.profileManager.createProfile(input);

        // Create baseline snapshot for new profile BEFORE notifying UI
        // so snapshots are available when renderer reloads
        logger.info('Creating baseline snapshot for new profile...');
        try {
          await deps.snapshotManager.createBaselineIfMissing();
          logger.info('Baseline snapshot created successfully');
        } catch (err) {
          logger.error('Failed to create baseline snapshot:', err);
          // Don't fail profile creation if baseline fails
        }

        // Notify UI of the new profile (after baseline is ready)
        const window = getMainWindow();
        if (window) {
          sendProfileChanged(window, profile);
        }

        return createResponse<DroneProfile>(profile);
      } catch (error) {
        logger.error('Failed to create profile:', error);
        return createResponse<DroneProfile>(undefined, getErrorMessage(error));
      }
    }
  );

  ipcMain.handle(
    IPCChannel.PROFILE_CREATE_FROM_PRESET,
    async (_, presetId: string, customName?: string): Promise<IPCResponse<DroneProfile>> => {
      try {
        if (!deps.profileManager || !deps.mspClient) {
          throw new Error('Profile manager or MSP client not initialized');
        }
        if (!deps.snapshotManager) {
          throw new Error('Snapshot manager not initialized');
        }

        // License enforcement: free tier = 1 profile max
        if (deps.licenseManager && !deps.licenseManager.isPro()) {
          const profiles = await deps.profileManager.listProfiles();
          if (profiles.length >= LICENSE.FREE_PROFILE_LIMIT) {
            throw new ProfileLimitError();
          }
        }

        const preset = PRESET_PROFILES[presetId as keyof typeof PRESET_PROFILES];
        if (!preset) {
          throw new Error(`Preset ${presetId} not found`);
        }

        const fcSerial = await deps.mspClient.getFCSerialNumber();
        const fcInfo = await deps.mspClient.getFCInfo();

        const profile = await deps.profileManager.createProfileFromPreset(
          preset,
          fcSerial,
          fcInfo,
          customName
        );

        // Create baseline snapshot for new profile from preset BEFORE notifying UI
        // so snapshots are available when renderer reloads
        logger.info('Creating baseline snapshot for new profile from preset...');
        try {
          await deps.snapshotManager.createBaselineIfMissing();
          logger.info('Baseline snapshot created successfully');
        } catch (err) {
          logger.error('Failed to create baseline snapshot:', err);
          // Don't fail profile creation if baseline fails
        }

        // Notify UI of the new profile (after baseline is ready)
        const window = getMainWindow();
        if (window) {
          sendProfileChanged(window, profile);
        }

        return createResponse<DroneProfile>(profile);
      } catch (error) {
        logger.error('Failed to create profile from preset:', error);
        return createResponse<DroneProfile>(undefined, getErrorMessage(error));
      }
    }
  );

  ipcMain.handle(
    IPCChannel.PROFILE_UPDATE,
    async (_, id: string, updates: ProfileUpdateInput): Promise<IPCResponse<DroneProfile>> => {
      try {
        if (!deps.profileManager) {
          throw new Error('Profile manager not initialized');
        }
        const profile = await deps.profileManager.updateProfile(id, updates);
        return createResponse<DroneProfile>(profile);
      } catch (error) {
        logger.error('Failed to update profile:', error);
        return createResponse<DroneProfile>(undefined, getErrorMessage(error));
      }
    }
  );

  ipcMain.handle(IPCChannel.PROFILE_DELETE, async (_, id: string): Promise<IPCResponse<void>> => {
    try {
      if (!deps.profileManager) {
        throw new Error('Profile manager not initialized');
      }
      if (!deps.snapshotManager) {
        throw new Error('Snapshot manager not initialized');
      }
      if (!deps.blackboxManager) {
        throw new Error('Blackbox manager not initialized');
      }

      // Get profile before deleting to access snapshot IDs
      const profile = await deps.profileManager.getProfile(id);
      if (!profile) {
        throw new Error(`Profile ${id} not found`);
      }

      const wasActive = deps.profileManager.getCurrentProfileId() === id;

      // Delete all snapshots associated with this profile
      for (const snapshotId of profile.snapshotIds) {
        try {
          await deps.snapshotManager.deleteSnapshot(snapshotId);
          logger.info(`Deleted snapshot ${snapshotId} from profile ${id}`);
        } catch (err) {
          logger.error(`Failed to delete snapshot ${snapshotId}:`, err);
          // Continue deleting other snapshots even if one fails
        }
      }

      // Delete all Blackbox logs associated with this profile
      try {
        await deps.blackboxManager.deleteLogsForProfile(id);
        logger.info(`Deleted all Blackbox logs for profile ${id}`);
      } catch (err) {
        logger.error(`Failed to delete Blackbox logs for profile ${id}:`, err);
        // Continue with profile deletion even if log deletion fails
      }

      // Delete tuning history for this profile
      if (deps.tuningHistoryManager) {
        try {
          await deps.tuningHistoryManager.deleteHistory(id);
          logger.info(`Deleted tuning history for profile ${id}`);
        } catch (err) {
          logger.error(`Failed to delete tuning history for profile ${id}:`, err);
        }
      }

      // Delete active tuning session for this profile
      if (deps.tuningSessionManager) {
        try {
          await deps.tuningSessionManager.deleteSession(id);
          logger.info(`Deleted tuning session for profile ${id}`);
        } catch (err) {
          logger.error(`Failed to delete tuning session for profile ${id}:`, err);
        }
      }

      // Delete the profile
      await deps.profileManager.deleteProfile(id);

      // Notify UI that profile was deleted
      const window = getMainWindow();
      if (wasActive && window) {
        sendProfileChanged(window, null);
      }

      // If it was the active profile, disconnect
      if (wasActive && deps.mspClient) {
        try {
          await deps.mspClient.disconnect();
          logger.info('Disconnected after deleting active profile');

          // Send connection status update
          if (window) {
            sendConnectionChanged(window, {
              connected: false,
            });
          }
        } catch (err) {
          logger.error('Failed to disconnect after profile deletion:', err);
        }
      }

      return createResponse<void>(undefined);
    } catch (error) {
      logger.error('Failed to delete profile:', error);
      return createResponse<void>(undefined, getErrorMessage(error));
    }
  });

  ipcMain.handle(IPCChannel.PROFILE_WIPE, async (_, id: string): Promise<IPCResponse<void>> => {
    try {
      if (!deps.profileManager) {
        throw new Error('Profile manager not initialized');
      }
      if (!deps.snapshotManager) {
        throw new Error('Snapshot manager not initialized');
      }
      if (!deps.blackboxManager) {
        throw new Error('Blackbox manager not initialized');
      }

      // Validate profile exists
      const profile = await deps.profileManager.getProfile(id);
      if (!profile) {
        throw new Error(`Profile ${id} not found`);
      }

      // Delete all snapshots (force: true to include baseline)
      for (const snapshotId of profile.snapshotIds) {
        try {
          await deps.snapshotManager.deleteSnapshot(snapshotId, true);
          logger.info(`Wiped snapshot ${snapshotId} from profile ${id}`);
        } catch (err) {
          logger.error(`Failed to delete snapshot ${snapshotId} during wipe:`, err);
          // Continue wiping other data even if one snapshot fails
        }
      }

      // Delete all Blackbox logs
      try {
        await deps.blackboxManager.deleteLogsForProfile(id);
        logger.info(`Wiped all Blackbox logs for profile ${id}`);
      } catch (err) {
        logger.error(`Failed to delete Blackbox logs during wipe for profile ${id}:`, err);
      }

      // Delete tuning session
      if (deps.tuningSessionManager) {
        try {
          await deps.tuningSessionManager.deleteSession(id);
          logger.info(`Wiped tuning session for profile ${id}`);
        } catch (err) {
          logger.error(`Failed to delete tuning session during wipe for profile ${id}:`, err);
        }
      }

      // Delete tuning history
      if (deps.tuningHistoryManager) {
        try {
          await deps.tuningHistoryManager.deleteHistory(id);
          logger.info(`Wiped tuning history for profile ${id}`);
        } catch (err) {
          logger.error(`Failed to delete tuning history during wipe for profile ${id}:`, err);
        }
      }

      // Clear snapshot refs on profile
      await deps.profileManager.clearSnapshotRefs(id);

      // Notify UI — only send profile/session events if wiping the active profile
      const isCurrentProfile = deps.profileManager.getCurrentProfileId() === id;
      const window = getMainWindow();
      if (isCurrentProfile && window) {
        const updatedProfile = await deps.profileManager.getProfile(id);
        sendProfileChanged(window, updatedProfile);
        sendTuningSessionChanged(null);
      }

      logger.info(`Profile ${id} wiped successfully`);
      return createResponse<void>(undefined);
    } catch (error) {
      logger.error('Failed to wipe profile:', error);
      return createResponse<void>(undefined, getErrorMessage(error));
    }
  });

  ipcMain.handle(
    IPCChannel.PROFILE_LIST,
    async (): Promise<IPCResponse<DroneProfileMetadata[]>> => {
      try {
        if (!deps.profileManager) {
          throw new Error('Profile manager not initialized');
        }
        const profiles = await deps.profileManager.listProfiles();
        return createResponse<DroneProfileMetadata[]>(profiles);
      } catch (error) {
        logger.error('Failed to list profiles:', error);
        return createResponse<DroneProfileMetadata[]>(undefined, getErrorMessage(error));
      }
    }
  );

  ipcMain.handle(
    IPCChannel.PROFILE_GET,
    async (_, id: string): Promise<IPCResponse<DroneProfile | null>> => {
      try {
        if (!deps.profileManager) {
          throw new Error('Profile manager not initialized');
        }
        const profile = await deps.profileManager.getProfile(id);
        return createResponse<DroneProfile | null>(profile);
      } catch (error) {
        logger.error('Failed to get profile:', error);
        return createResponse<DroneProfile | null>(undefined, getErrorMessage(error));
      }
    }
  );

  ipcMain.handle(
    IPCChannel.PROFILE_GET_CURRENT,
    async (): Promise<IPCResponse<DroneProfile | null>> => {
      try {
        if (!deps.profileManager) {
          throw new Error('Profile manager not initialized');
        }
        const profile = await deps.profileManager.getCurrentProfile();
        return createResponse<DroneProfile | null>(profile);
      } catch (error) {
        logger.error('Failed to get current profile:', error);
        return createResponse<DroneProfile | null>(undefined, getErrorMessage(error));
      }
    }
  );

  ipcMain.handle(
    IPCChannel.PROFILE_SET_CURRENT,
    async (_, id: string): Promise<IPCResponse<DroneProfile>> => {
      try {
        if (!deps.profileManager) {
          throw new Error('Profile manager not initialized');
        }
        const profile = await deps.profileManager.setCurrentProfile(id);
        return createResponse<DroneProfile>(profile);
      } catch (error) {
        logger.error('Failed to set current profile:', error);
        return createResponse<DroneProfile>(undefined, getErrorMessage(error));
      }
    }
  );

  ipcMain.handle(
    IPCChannel.PROFILE_EXPORT,
    async (_, id: string, filePath: string): Promise<IPCResponse<void>> => {
      try {
        if (!deps.profileManager) {
          throw new Error('Profile manager not initialized');
        }
        await deps.profileManager.exportProfile(id, filePath);
        return createResponse<void>(undefined);
      } catch (error) {
        logger.error('Failed to export profile:', error);
        return createResponse<void>(undefined, getErrorMessage(error));
      }
    }
  );

  ipcMain.handle(IPCChannel.PROFILE_GET_FC_SERIAL, async (): Promise<IPCResponse<string>> => {
    try {
      if (!deps.mspClient) {
        throw new Error('MSP client not initialized');
      }
      const serial = await deps.mspClient.getFCSerialNumber();
      return createResponse<string>(serial);
    } catch (error) {
      logger.error('Failed to get FC serial:', error);
      return createResponse<string>(undefined, getErrorMessage(error));
    }
  });
}
