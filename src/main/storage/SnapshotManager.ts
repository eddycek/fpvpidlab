import { v4 as uuidv4 } from 'uuid';
import { FileStorage } from './FileStorage';
import type { MSPClient } from '../msp/MSPClient';
import type { ProfileManager } from './ProfileManager';
import type { FCStateCache } from '../cache/FCStateCache';
import type { ConfigurationSnapshot, SnapshotMetadata } from '@shared/types/common.types';
import { SnapshotError } from '../utils/errors';
import { logger } from '../utils/logger';
import { APP_VERSION, SNAPSHOT } from '@shared/constants';

export class SnapshotManager {
  private storage: FileStorage;
  private mspClient: MSPClient;
  private profileManager: ProfileManager | null = null;
  private baselineId: string | null = null;
  private fcStateCache: FCStateCache | null = null;

  constructor(storagePath: string, mspClient: MSPClient) {
    this.storage = new FileStorage(storagePath);
    this.mspClient = mspClient;
  }

  setFCStateCache(cache: FCStateCache): void {
    this.fcStateCache = cache;
  }

  setProfileManager(profileManager: ProfileManager): void {
    this.profileManager = profileManager;
  }

  async initialize(): Promise<void> {
    await this.storage.ensureDirectory();
  }

  async createSnapshot(
    label?: string,
    type: 'baseline' | 'manual' | 'auto' = 'manual',
    extraMetadata?: { tuningSessionNumber?: number; tuningType?: string; snapshotRole?: string }
  ): Promise<ConfigurationSnapshot> {
    if (!this.mspClient.isConnected()) {
      throw new SnapshotError('Not connected to FC');
    }

    try {
      // Get FC info
      const fcInfo = await this.mspClient.getFCInfo();

      // Read MSP configuration BEFORE exportCLIDiff (which enters CLI → reboots FC).
      // These values may not appear in CLI diff (e.g. PIDs when simplified_pids_mode is ON).
      // Prefer cached values (fast, no MSP round-trips) with MSP fallback.
      let pidConfig: import('@shared/types/pid.types').PIDConfiguration | undefined;
      let filterConfig: import('@shared/types/analysis.types').CurrentFilterSettings | undefined;
      let feedforwardConfig: import('@shared/types/pid.types').FeedforwardConfiguration | undefined;
      let ratesConfig: import('@shared/types/pid.types').RatesConfiguration | undefined;

      if (this.fcStateCache) {
        const cached = this.fcStateCache.getState();
        if (cached.pidConfig) pidConfig = cached.pidConfig;
        if (cached.filterConfig) filterConfig = cached.filterConfig;
        if (cached.feedforwardConfig) feedforwardConfig = cached.feedforwardConfig;
        if (cached.ratesConfig) ratesConfig = cached.ratesConfig;
      }

      // Fall back to MSP reads for any slices not in cache
      if (!pidConfig || !filterConfig || !feedforwardConfig || !ratesConfig) {
        try {
          const [pid, filter, ff, rates] = await Promise.all([
            pidConfig ? Promise.resolve(pidConfig) : this.mspClient.getPIDConfiguration(),
            filterConfig ? Promise.resolve(filterConfig) : this.mspClient.getFilterConfiguration(),
            feedforwardConfig
              ? Promise.resolve(feedforwardConfig)
              : this.mspClient.getFeedforwardConfiguration(),
            ratesConfig ? Promise.resolve(ratesConfig) : this.mspClient.getRatesConfiguration(),
          ]);
          pidConfig = pid;
          filterConfig = filter;
          feedforwardConfig = ff;
          ratesConfig = rates;
        } catch (err) {
          logger.warn(
            'Snapshot: MSP config reads failed (non-fatal, CLI diff still captured):',
            err
          );
        }
      }

      // Export configuration (enters CLI → runs diff + dump → reboots FC)
      const { cliDiff, cliDump } = await this.mspClient.exportCLIDiffAndDump();

      // Create snapshot
      const snapshot: ConfigurationSnapshot = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        label: label || this.generateLabel(type),
        type,
        fcInfo,
        configuration: {
          cliDiff,
          cliDump,
          pidConfig,
          filterConfig,
          feedforwardConfig,
          ratesConfig,
        },
        metadata: {
          appVersion: APP_VERSION,
          createdBy: type === 'auto' ? 'auto' : 'user',
          ...(extraMetadata?.tuningSessionNumber != null && {
            tuningSessionNumber: extraMetadata.tuningSessionNumber,
          }),
          ...(extraMetadata?.tuningType != null && {
            tuningType: extraMetadata.tuningType as 'filter' | 'pid' | 'flash',
          }),
          ...(extraMetadata?.snapshotRole != null && {
            snapshotRole: extraMetadata.snapshotRole as 'pre-tuning' | 'post-tuning',
          }),
          ...(fcInfo.pidProfileIndex != null && {
            bfPidProfileIndex: fcInfo.pidProfileIndex,
          }),
        },
      };

      // Save to storage
      await this.storage.saveSnapshot(snapshot);

      // Link to current profile
      if (this.profileManager) {
        const currentProfileId = this.profileManager.getCurrentProfileId();
        if (currentProfileId) {
          await this.profileManager.linkSnapshot(
            currentProfileId,
            snapshot.id,
            type === 'baseline'
          );
        }
      }

      // Track baseline
      if (type === 'baseline') {
        this.baselineId = snapshot.id;
      }

      logger.info(`Snapshot created: ${snapshot.id} (${snapshot.label})`);
      return snapshot;
    } catch (error) {
      throw new SnapshotError('Failed to create snapshot', error);
    }
  }

  async createBaselineIfMissing(): Promise<void> {
    const snapshots = await this.listSnapshots();
    const hasBaseline = snapshots.some((s) => s.type === 'baseline');

    if (!hasBaseline) {
      logger.info('No baseline found, creating one...');
      const baseline = await this.createSnapshot(SNAPSHOT.BASELINE_LABEL, 'baseline');
      this.baselineId = baseline.id;
    }
  }

  async loadSnapshot(id: string): Promise<ConfigurationSnapshot> {
    try {
      return await this.storage.loadSnapshot(id);
    } catch (error) {
      throw new SnapshotError(`Failed to load snapshot ${id}`, error);
    }
  }

  async deleteSnapshot(id: string, force: boolean = false): Promise<void> {
    if (!force) {
      // Prevent deleting baseline
      if (id === this.baselineId) {
        throw new SnapshotError('Cannot delete baseline snapshot');
      }

      // Prevent deleting profile's baseline
      if (this.profileManager) {
        const currentProfile = await this.profileManager.getCurrentProfile();
        if (currentProfile?.baselineSnapshotId === id) {
          throw new SnapshotError('Cannot delete baseline snapshot');
        }
      }
    }

    try {
      await this.storage.deleteSnapshot(id);

      // Clear baselineId if force-deleting the baseline
      if (force && id === this.baselineId) {
        this.baselineId = null;
      }

      // Unlink from current profile
      if (this.profileManager) {
        const currentProfileId = this.profileManager.getCurrentProfileId();
        if (currentProfileId) {
          await this.profileManager.unlinkSnapshot(currentProfileId, id);
        }
      }
    } catch (error) {
      throw new SnapshotError(`Failed to delete snapshot ${id}`, error);
    }
  }

  async listSnapshots(): Promise<SnapshotMetadata[]> {
    try {
      let ids = await this.storage.listSnapshots();

      // Filter by current profile if profile manager is set
      if (this.profileManager) {
        const currentProfile = await this.profileManager.getCurrentProfile();
        if (currentProfile) {
          ids = ids.filter((id) => currentProfile.snapshotIds.includes(id));
        }
      }

      const snapshots: SnapshotMetadata[] = [];

      for (const id of ids) {
        const snapshot = await this.storage.loadSnapshot(id);
        snapshots.push({
          id: snapshot.id,
          timestamp: snapshot.timestamp,
          label: snapshot.label,
          type: snapshot.type,
          sizeBytes: new TextEncoder().encode(JSON.stringify(snapshot)).length,
          fcInfo: {
            variant: snapshot.fcInfo.variant,
            version: snapshot.fcInfo.version,
            boardName: snapshot.fcInfo.boardName,
          },
          ...(snapshot.metadata.tuningSessionNumber != null && {
            tuningSessionNumber: snapshot.metadata.tuningSessionNumber,
          }),
          ...(snapshot.metadata.tuningType != null && { tuningType: snapshot.metadata.tuningType }),
          ...(snapshot.metadata.snapshotRole != null && {
            snapshotRole: snapshot.metadata.snapshotRole,
          }),
          ...(snapshot.metadata.bfPidProfileIndex != null && {
            bfPidProfileIndex: snapshot.metadata.bfPidProfileIndex,
          }),
        });
      }

      // Sort by timestamp (newest first)
      return snapshots.sort((a, b) => {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });
    } catch (error) {
      throw new SnapshotError('Failed to list snapshots', error);
    }
  }

  async exportSnapshot(id: string, destinationPath: string): Promise<void> {
    try {
      await this.storage.exportSnapshot(id, destinationPath);
    } catch (error) {
      throw new SnapshotError(`Failed to export snapshot ${id}`, error);
    }
  }

  async getBaseline(): Promise<ConfigurationSnapshot | null> {
    if (this.profileManager) {
      const currentProfile = await this.profileManager.getCurrentProfile();
      if (currentProfile?.baselineSnapshotId) {
        return await this.loadSnapshot(currentProfile.baselineSnapshotId);
      }
    }

    return null;
  }

  private generateLabel(type: 'baseline' | 'manual' | 'auto'): string {
    const now = new Date();
    const dateStr = now.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    switch (type) {
      case 'baseline':
        return SNAPSHOT.BASELINE_LABEL;
      case 'manual':
        return `Manual backup - ${dateStr}`;
      case 'auto':
        return `Auto backup - ${dateStr}`;
    }
  }
}
