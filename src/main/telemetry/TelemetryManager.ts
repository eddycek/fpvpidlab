import { join } from 'path';
import fs from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import { gzipSync } from 'zlib';
import { app, net } from 'electron';
import { APP_VERSION, TELEMETRY } from '@shared/constants';
import type { TelemetrySettings, TelemetryBundle } from '@shared/types/telemetry.types';
import { logger } from '../utils/logger';

const SETTINGS_FILE = 'telemetry-settings.json';

export class TelemetryManager {
  private basePath: string;
  private settings: TelemetrySettings | null = null;
  private profileManager: any = null;
  private tuningHistoryManager: any = null;
  private blackboxManager: any = null;
  private snapshotManager: any = null;
  private isDemoMode = false;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  setProfileManager(manager: any): void {
    this.profileManager = manager;
  }

  setTuningHistoryManager(manager: any): void {
    this.tuningHistoryManager = manager;
  }

  setBlackboxManager(manager: any): void {
    this.blackboxManager = manager;
  }

  setSnapshotManager(manager: any): void {
    this.snapshotManager = manager;
  }

  setDemoMode(value: boolean): void {
    this.isDemoMode = value;
  }

  private get settingsPath(): string {
    return join(this.basePath, SETTINGS_FILE);
  }

  async initialize(): Promise<void> {
    try {
      const raw = await fs.readFile(this.settingsPath, 'utf-8');
      this.settings = JSON.parse(raw);
    } catch {
      // File doesn't exist or is corrupt — create defaults
      this.settings = {
        enabled: true,
        installationId: randomUUID(),
        lastUploadAt: null,
        lastUploadError: null,
      };
      await this.persist();
    }

    // Heartbeat: upload if due
    if (this.settings!.enabled) {
      this.uploadIfDue().catch(() => {});
    }
  }

  getSettings(): TelemetrySettings {
    if (!this.settings) {
      throw new Error('TelemetryManager not initialized');
    }
    return { ...this.settings };
  }

  async setEnabled(enabled: boolean): Promise<TelemetrySettings> {
    if (!this.settings) throw new Error('TelemetryManager not initialized');
    this.settings.enabled = enabled;
    await this.persist();
    return { ...this.settings };
  }

  async sendNow(): Promise<void> {
    if (!this.settings) throw new Error('TelemetryManager not initialized');
    if (!this.settings.enabled) throw new Error('Telemetry is disabled');
    await this.upload();
  }

  async onTuningSessionCompleted(): Promise<void> {
    if (!this.settings?.enabled) return;
    await this.uploadIfDue();
  }

  async uploadIfDue(): Promise<void> {
    if (!this.settings?.enabled) return;

    const lastUpload = this.settings.lastUploadAt
      ? new Date(this.settings.lastUploadAt).getTime()
      : 0;
    const now = Date.now();

    if (now - lastUpload < TELEMETRY.STALE_THRESHOLD_MS) {
      return;
    }

    await this.upload();
  }

  async assembleBundle(): Promise<TelemetryBundle> {
    if (!this.settings) throw new Error('TelemetryManager not initialized');

    const bundle: TelemetryBundle = {
      schemaVersion: 1,
      installationId: this.settings.installationId,
      timestamp: new Date().toISOString(),
      appVersion: APP_VERSION,
      environment: app.isPackaged ? 'production' : 'development',
      platform: process.platform,
      profiles: { count: 0, sizes: [], flightStyles: [] },
      tuningSessions: {
        totalCompleted: 0,
        byMode: { filter: 0, pid: 0, quick: 0 },
        recentQualityScores: [],
      },
      fcInfo: { bfVersions: [], fcSerialHashes: [], boardTargets: [] },
      blackbox: { totalLogsDownloaded: 0, storageTypes: [], compressionDetected: false },
      features: {
        analysisOverviewUsed: false,
        snapshotRestoreUsed: false,
        snapshotCompareUsed: false,
        historyViewUsed: false,
      },
    };

    // Profiles
    if (this.profileManager) {
      try {
        const profiles = await this.profileManager.listProfiles();
        bundle.profiles.count = profiles.length;
        const sizes = new Set<string>();
        const styles = new Set<string>();
        const versions = new Set<string>();
        const targets = new Set<string>();
        const serialHashes = new Set<string>();

        for (const meta of profiles) {
          if (meta.size) sizes.add(meta.size);
          if (meta.flightStyle) styles.add(meta.flightStyle);

          // Full profile for FC info
          const profile = await this.profileManager.getProfile(meta.id);
          if (profile?.fcInfo) {
            if (profile.fcInfo.version) versions.add(profile.fcInfo.version);
            if (profile.fcInfo.target) targets.add(profile.fcInfo.target);
          }
          if (profile?.fcSerialNumber) {
            const hash = createHash('sha256')
              .update(profile.fcSerialNumber + this.settings!.installationId)
              .digest('hex')
              .substring(0, 16);
            serialHashes.add(hash);
          }
        }

        bundle.profiles.sizes = [...sizes];
        bundle.profiles.flightStyles = [...styles];
        bundle.fcInfo.bfVersions = [...versions];
        bundle.fcInfo.boardTargets = [...targets];
        bundle.fcInfo.fcSerialHashes = [...serialHashes];
      } catch (err) {
        logger.warn('Telemetry: failed to collect profile data:', err);
      }
    }

    // Tuning history
    if (this.profileManager && this.tuningHistoryManager) {
      try {
        const profiles = await this.profileManager.listProfiles();
        const recentScores: number[] = [];

        for (const meta of profiles) {
          const history = await this.tuningHistoryManager.getHistory(meta.id);
          bundle.tuningSessions.totalCompleted += history.length;

          for (const record of history) {
            if (record.tuningType === 'filter') bundle.tuningSessions.byMode.filter++;
            else if (record.tuningType === 'pid') bundle.tuningSessions.byMode.pid++;
            else if (record.tuningType === 'quick') bundle.tuningSessions.byMode.quick++;

            if (record.qualityScore != null) {
              recentScores.push(record.qualityScore);
            }
          }
        }

        // Keep last 10 scores (newest first — history is already newest-first from API)
        bundle.tuningSessions.recentQualityScores = recentScores.slice(0, 10);
      } catch (err) {
        logger.warn('Telemetry: failed to collect tuning history:', err);
      }
    }

    // Blackbox
    if (this.profileManager && this.blackboxManager) {
      try {
        const profiles = await this.profileManager.listProfiles();
        const storageTypes = new Set<string>();
        let totalLogs = 0;
        let compression = false;

        for (const meta of profiles) {
          // BlackboxManager requires profile context — set current profile temporarily
          const logs = await this.blackboxManager.listLogs(meta.id);
          totalLogs += logs.length;
          for (const log of logs) {
            if (log.compressionDetected) compression = true;
          }
        }

        bundle.blackbox.totalLogsDownloaded = totalLogs;
        bundle.blackbox.storageTypes = [...storageTypes];
        bundle.blackbox.compressionDetected = compression;
      } catch (err) {
        logger.warn('Telemetry: failed to collect blackbox data:', err);
      }
    }

    // Features (derived)
    if (this.profileManager && this.snapshotManager) {
      try {
        const profiles = await this.profileManager.listProfiles();
        for (const meta of profiles) {
          const snapshots = await this.snapshotManager.listSnapshots(meta.id);
          if (snapshots.length > 1) bundle.features.snapshotCompareUsed = true;
          for (const snap of snapshots) {
            if (snap.label?.includes('Pre-restore')) {
              bundle.features.snapshotRestoreUsed = true;
            }
          }
        }
      } catch (err) {
        logger.warn('Telemetry: failed to collect feature data:', err);
      }
    }

    // analysisOverviewUsed = any downloaded logs exist
    if (bundle.blackbox.totalLogsDownloaded > 0) {
      bundle.features.analysisOverviewUsed = true;
    }

    // historyViewUsed = any completed tuning sessions
    if (bundle.tuningSessions.totalCompleted > 0) {
      bundle.features.historyViewUsed = true;
    }

    return bundle;
  }

  private async upload(): Promise<void> {
    if (this.isDemoMode) {
      logger.info('Telemetry: skipping upload in demo mode');
      return;
    }

    try {
      const bundle = await this.assembleBundle();
      const json = JSON.stringify(bundle);
      const compressed = gzipSync(Buffer.from(json));

      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= TELEMETRY.RETRY_DELAYS.length; attempt++) {
        try {
          const uploadUrl = process.env.TELEMETRY_URL || TELEMETRY.UPLOAD_URL;
          const response = await net.fetch(uploadUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Encoding': 'gzip',
            },
            body: compressed,
          });

          if (response.ok) {
            this.settings!.lastUploadAt = new Date().toISOString();
            this.settings!.lastUploadError = null;
            await this.persist();
            logger.info('Telemetry: upload successful');
            return;
          }

          lastError = new Error(`HTTP ${response.status}`);
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
        }

        // Wait before retry (skip wait on last attempt)
        if (attempt < TELEMETRY.RETRY_DELAYS.length) {
          await new Promise((resolve) => setTimeout(resolve, TELEMETRY.RETRY_DELAYS[attempt]));
        }
      }

      this.settings!.lastUploadError = lastError?.message || 'Unknown error';
      await this.persist();
      logger.warn('Telemetry: upload failed after retries:', lastError?.message);
    } catch (err) {
      if (this.settings) {
        this.settings.lastUploadError = err instanceof Error ? err.message : String(err);
        await this.persist().catch(() => {});
      }
      logger.warn('Telemetry: upload error:', err);
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2));
  }
}
