import { EventEmitter } from 'events';
import type { FCInfo } from '@shared/types/common.types';
import type {
  PIDConfiguration,
  FeedforwardConfiguration,
  RatesConfiguration,
} from '@shared/types/pid.types';
import type { CurrentFilterSettings } from '@shared/types/analysis.types';
import type { BlackboxInfo, BlackboxSettings } from '@shared/types/blackbox.types';
import type { FCState, FCStateSlice } from '@shared/types/fcState.types';
import { EMPTY_FC_STATE } from '@shared/types/fcState.types';
import { parseDiffSetting } from '../ipc/handlers/types';
import { logger } from '../utils/logger';

/**
 * Minimal interface for the MSP client methods used by the cache.
 * Both MSPClient and MockMSPClient satisfy this contract.
 */
export interface CacheMSPClient {
  isConnected(): boolean;
  getFCInfo(): Promise<FCInfo>;
  getStatusEx(apiVersion?: any): Promise<{ pidProfileIndex: number; pidProfileCount: number }>;
  getPIDConfiguration(): Promise<PIDConfiguration>;
  getFilterConfiguration(): Promise<CurrentFilterSettings>;
  getFeedforwardConfiguration(): Promise<FeedforwardConfiguration>;
  getRatesConfiguration(): Promise<RatesConfiguration>;
  getTuningConfig(): Promise<Record<string, number>>;
  getBlackboxInfo(): Promise<BlackboxInfo>;
  getPidProcessDenom(): Promise<number>;
  /** Both MSPClient and MockMSPClient expose this public method. */
  isInCLI(): boolean;
}

/**
 * Minimal interface for reading blackbox settings from snapshots.
 * Matches the subset of SnapshotManager / ProfileManager used by the cache.
 */
export interface CacheSnapshotProvider {
  loadSnapshot(id: string): Promise<{ configuration?: { cliDiff?: string } } | null>;
}

export interface CacheProfileProvider {
  getCurrentProfile(): Promise<{ snapshotIds: string[] } | null>;
}

/**
 * Caches all MSP-readable FC state in memory. Emits 'state-changed' with the
 * full FCState whenever state is updated, so index.ts can forward to the renderer.
 *
 * Usage:
 *   const cache = new FCStateCache(mspClient);
 *   cache.setDependencies(snapshotManager, profileManager);
 *   cache.on('state-changed', (state) => win.webContents.send('fc-state', state));
 *   await cache.hydrate();
 */
export class FCStateCache extends EventEmitter {
  private state: FCState = { ...EMPTY_FC_STATE };
  private mspClient: CacheMSPClient;
  private snapshotProvider: CacheSnapshotProvider | null = null;
  private profileProvider: CacheProfileProvider | null = null;
  /** Incremented on hydrate/clear to detect stale async results */
  private hydrateGeneration = 0;

  constructor(mspClient: CacheMSPClient) {
    super();
    this.mspClient = mspClient;
  }

  /**
   * Set late-bound dependencies needed for blackboxSettings (snapshot-based reading).
   * May not be available at construction time.
   */
  setDependencies(
    snapshotProvider: CacheSnapshotProvider,
    profileProvider: CacheProfileProvider
  ): void {
    this.snapshotProvider = snapshotProvider;
    this.profileProvider = profileProvider;
  }

  /**
   * Full hydration — reads all FC state from MSP. Non-fatal on individual errors.
   */
  async hydrate(): Promise<void> {
    const generation = ++this.hydrateGeneration;
    // Capture previous blackboxInfo for flash->none guard on re-hydrate
    const previousBlackboxInfo = this.state.blackboxInfo;

    this.state = { ...EMPTY_FC_STATE, hydrating: true };
    this.notifyRenderer();

    // Phase 1: FCInfo (needed for statusEx apiVersion)
    let fcInfo: FCInfo | null = null;
    try {
      fcInfo = await this.mspClient.getFCInfo();
      if (this.hydrateGeneration !== generation) return;
      this.state.info = fcInfo;
    } catch (error) {
      logger.warn('FCStateCache: failed to read FCInfo', error);
    }

    if (this.hydrateGeneration !== generation) return;

    // Phase 2: StatusEx (needs apiVersion from FCInfo)
    try {
      const statusEx = await this.mspClient.getStatusEx(fcInfo?.apiVersion);
      if (this.hydrateGeneration !== generation) return;
      this.state.statusEx = statusEx;
    } catch (error) {
      logger.warn('FCStateCache: failed to read StatusEx', error);
    }

    if (this.hydrateGeneration !== generation) return;

    // Phase 3: Parallel reads (independent MSP commands)
    const [pidResult, filterResult, ratesResult, bbInfoResult] = await Promise.allSettled([
      this.mspClient.getPIDConfiguration(),
      this.mspClient.getFilterConfiguration(),
      this.mspClient.getRatesConfiguration(),
      this.mspClient.getBlackboxInfo(),
    ]);

    if (this.hydrateGeneration !== generation) return;

    if (pidResult.status === 'fulfilled') {
      this.state.pidConfig = pidResult.value;
    } else {
      logger.warn('FCStateCache: failed to read PIDConfiguration', pidResult.reason);
    }

    if (filterResult.status === 'fulfilled') {
      this.state.filterConfig = filterResult.value;
    } else {
      logger.warn('FCStateCache: failed to read FilterConfiguration', filterResult.reason);
    }

    if (ratesResult.status === 'fulfilled') {
      this.state.ratesConfig = ratesResult.value;
    } else {
      logger.warn('FCStateCache: failed to read RatesConfiguration', ratesResult.reason);
    }

    if (bbInfoResult.status === 'fulfilled') {
      const newBBInfo = bbInfoResult.value;
      // Flash->none guard: FC may briefly report 'none' during flash operations.
      // Apply on re-hydrate when previous state had flash storage.
      if (
        previousBlackboxInfo &&
        previousBlackboxInfo.storageType === 'flash' &&
        newBBInfo.storageType === 'none'
      ) {
        logger.warn('FCStateCache hydrate: flash->none guard triggered, preserving storageType');
        this.state.blackboxInfo = {
          ...newBBInfo,
          storageType: 'flash',
          totalSize: previousBlackboxInfo.totalSize,
          usedSize: 0,
          freeSize: previousBlackboxInfo.totalSize,
          usagePercent: 0,
          hasLogs: false,
        };
      } else {
        this.state.blackboxInfo = newBBInfo;
      }
    } else {
      logger.warn('FCStateCache: failed to read BlackboxInfo', bbInfoResult.reason);
    }

    if (this.hydrateGeneration !== generation) return;

    // Phase 4: Sequential reads (feedforward and tuning both use MSP_PID_ADVANCED)
    try {
      this.state.feedforwardConfig = await this.mspClient.getFeedforwardConfiguration();
    } catch (error) {
      logger.warn('FCStateCache: failed to read FeedforwardConfiguration', error);
    }

    if (this.hydrateGeneration !== generation) return;

    try {
      this.state.tuningConfig = await this.mspClient.getTuningConfig();
    } catch (error) {
      logger.warn('FCStateCache: failed to read TuningConfig', error);
    }

    if (this.hydrateGeneration !== generation) return;

    // Phase 5: BlackboxSettings from snapshot CLI diff
    try {
      this.state.blackboxSettings = await this.readBlackboxSettings();
    } catch (error) {
      logger.warn('FCStateCache: failed to read BlackboxSettings', error);
    }

    if (this.hydrateGeneration !== generation) return;

    this.state.hydratedAt = new Date().toISOString();
    this.state.hydrating = false;
    this.notifyRenderer();
  }

  /**
   * Re-read only specific slices from MSP. Skips if FC is in CLI mode.
   */
  async invalidate(slices: FCStateSlice[]): Promise<void> {
    if (this.isClientInCLI()) {
      logger.warn('FCStateCache.invalidate() skipped — FC is in CLI mode');
      return;
    }

    // Separate sequential slices (both use MSP_PID_ADVANCED) from parallel ones
    const parallelSlices = slices.filter((s) => s !== 'feedforwardConfig' && s !== 'tuningConfig');
    const hasFF = slices.includes('feedforwardConfig');
    const hasTuning = slices.includes('tuningConfig');

    // Parallel reads
    await Promise.all(parallelSlices.map((slice) => this.readSlice(slice)));

    // Sequential reads for MSP_PID_ADVANCED-dependent slices
    if (hasFF) await this.readSlice('feedforwardConfig');
    if (hasTuning) await this.readSlice('tuningConfig');

    this.notifyRenderer();
  }

  /**
   * Clear all cached state (e.g., on disconnect).
   */
  clear(): void {
    this.hydrateGeneration++;
    this.state = { ...EMPTY_FC_STATE };
    this.notifyRenderer();
  }

  /**
   * Return a frozen copy of the full state.
   */
  getState(): Readonly<FCState> {
    return Object.freeze({ ...this.state });
  }

  /**
   * Return a specific slice value.
   */
  getSlice<K extends FCStateSlice>(key: K): FCState[K] {
    return this.state[key];
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private notifyRenderer(): void {
    this.emit('state-changed', Object.freeze({ ...this.state }));
  }

  /**
   * Check if the MSP client is currently in CLI mode.
   */
  private isClientInCLI(): boolean {
    return this.mspClient.isInCLI();
  }

  /**
   * Read a single slice from MSP and update the cache. Includes flash->none guard.
   */
  private async readSlice(slice: FCStateSlice): Promise<void> {
    try {
      switch (slice) {
        case 'info':
          this.state.info = await this.mspClient.getFCInfo();
          break;
        case 'statusEx':
          this.state.statusEx = await this.mspClient.getStatusEx(this.state.info?.apiVersion);
          break;
        case 'pidConfig':
          this.state.pidConfig = await this.mspClient.getPIDConfiguration();
          break;
        case 'filterConfig':
          this.state.filterConfig = await this.mspClient.getFilterConfiguration();
          break;
        case 'feedforwardConfig':
          this.state.feedforwardConfig = await this.mspClient.getFeedforwardConfiguration();
          break;
        case 'ratesConfig':
          this.state.ratesConfig = await this.mspClient.getRatesConfiguration();
          break;
        case 'tuningConfig':
          this.state.tuningConfig = await this.mspClient.getTuningConfig();
          break;
        case 'blackboxInfo': {
          const oldInfo = this.state.blackboxInfo;
          const newInfo = await this.mspClient.getBlackboxInfo();
          // Flash->none guard: FC may briefly report 'none' during flash operations.
          // Preserve the storage type and zero out sizes instead of losing it.
          if (oldInfo && oldInfo.storageType === 'flash' && newInfo.storageType === 'none') {
            logger.warn('FCStateCache: flash->none guard triggered, preserving storageType');
            this.state.blackboxInfo = {
              ...newInfo,
              storageType: 'flash',
              totalSize: oldInfo.totalSize,
              usedSize: 0,
              freeSize: oldInfo.totalSize,
              usagePercent: 0,
              hasLogs: false,
            };
          } else {
            this.state.blackboxInfo = newInfo;
          }
          break;
        }
        case 'blackboxSettings':
          this.state.blackboxSettings = await this.readBlackboxSettings();
          break;
      }
    } catch (error) {
      logger.warn(`FCStateCache: failed to re-read ${slice}`, error);
    }
  }

  /**
   * Read blackbox settings from the latest snapshot's CLI diff.
   * Mirrors the logic in fcInfoHandlers FC_GET_BLACKBOX_SETTINGS.
   */
  private async readBlackboxSettings(): Promise<BlackboxSettings | null> {
    if (!this.profileProvider || !this.snapshotProvider) {
      return null;
    }

    const profile = await this.profileProvider.getCurrentProfile();
    if (!profile) return null;

    // Find the most recent snapshot with a CLI diff
    let cliDiff = '';
    const ids = profile.snapshotIds;
    for (let i = ids.length - 1; i >= 0; i--) {
      try {
        const snap = await this.snapshotProvider.loadSnapshot(ids[i]);
        if (snap?.configuration?.cliDiff) {
          cliDiff = snap.configuration.cliDiff;
          break;
        }
      } catch {
        // continue to next snapshot
      }
    }

    const debugMode = parseDiffSetting(cliDiff, 'debug_mode') || 'NONE';
    const sampleRateStr = parseDiffSetting(cliDiff, 'blackbox_sample_rate');
    const sampleRate = sampleRateStr !== undefined ? parseInt(sampleRateStr, 10) : 1;

    // Compute effective logging rate
    let pidDenom: number;
    const pidDenomFromDiff = () => {
      const s = parseDiffSetting(cliDiff, 'pid_process_denom');
      return s !== undefined ? parseInt(s, 10) : 1;
    };
    if (this.mspClient.isConnected()) {
      try {
        pidDenom = await this.mspClient.getPidProcessDenom();
      } catch {
        pidDenom = pidDenomFromDiff();
      }
    } else {
      pidDenom = pidDenomFromDiff();
    }

    const pidRate = 8000 / Math.max(pidDenom, 1);
    const loggingRateHz = Math.round(pidRate / Math.pow(2, sampleRate));

    return { debugMode, sampleRate, loggingRateHz };
  }
}
