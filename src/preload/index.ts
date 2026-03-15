import { contextBridge, ipcRenderer } from 'electron';
import { IPCChannel, BetaflightAPI } from '@shared/types/ipc.types';
import type {
  PortInfo,
  FCInfo,
  ConfigurationSnapshot,
  SnapshotMetadata,
  ConnectionStatus,
} from '@shared/types/common.types';
import type {
  DroneProfile,
  DroneProfileMetadata,
  ProfileCreationInput,
  ProfileUpdateInput,
} from '@shared/types/profile.types';
import type { PIDConfiguration, FeedforwardConfiguration } from '@shared/types/pid.types';
import type {
  BlackboxInfo,
  BlackboxLogMetadata,
  BlackboxParseResult,
  BlackboxParseProgress,
  BlackboxSettings,
} from '@shared/types/blackbox.types';
import type {
  FilterAnalysisResult,
  PIDAnalysisResult,
  AnalysisProgress,
  CurrentFilterSettings,
} from '@shared/types/analysis.types';
import type {
  ApplyRecommendationsInput,
  ApplyRecommendationsResult,
  ApplyRecommendationsProgress,
  SnapshotRestoreResult,
  SnapshotRestoreProgress,
  FixBlackboxSettingsInput,
  FixBlackboxSettingsResult,
} from '@shared/types/ipc.types';
import type { TuningSession, TuningPhase, TuningType } from '@shared/types/tuning.types';
import type {
  CompletedTuningRecord,
  FilterMetricsSummary,
  PIDMetricsSummary,
  TransferFunctionMetricsSummary,
} from '@shared/types/tuning-history.types';
import type { TelemetrySettings } from '@shared/types/telemetry.types';
import type { LicenseInfo } from '@shared/types/license.types';

const betaflightAPI: BetaflightAPI = {
  // App
  async isDemoMode(): Promise<boolean> {
    const response = await ipcRenderer.invoke(IPCChannel.APP_IS_DEMO_MODE);
    if (!response.success) {
      return false;
    }
    return response.data;
  },

  async resetDemo(): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.APP_RESET_DEMO);
    if (!response.success) {
      throw new Error(response.error || 'Failed to reset demo');
    }
  },

  // Connection
  async listPorts(): Promise<PortInfo[]> {
    const response = await ipcRenderer.invoke(IPCChannel.CONNECTION_LIST_PORTS);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  },

  async connect(portPath: string): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.CONNECTION_CONNECT, portPath);
    if (!response.success) {
      throw new Error(response.error);
    }
  },

  async disconnect(): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.CONNECTION_DISCONNECT);
    if (!response.success) {
      throw new Error(response.error);
    }
  },

  async getConnectionStatus(): Promise<ConnectionStatus> {
    const response = await ipcRenderer.invoke(IPCChannel.CONNECTION_GET_STATUS);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  },

  onConnectionChanged(callback: (status: ConnectionStatus) => void): () => void {
    const listener = (_: any, status: ConnectionStatus) => callback(status);
    ipcRenderer.on(IPCChannel.EVENT_CONNECTION_CHANGED, listener);
    return () => {
      ipcRenderer.removeListener(IPCChannel.EVENT_CONNECTION_CHANGED, listener);
    };
  },

  // FC Info
  async getFCInfo(): Promise<FCInfo> {
    const response = await ipcRenderer.invoke(IPCChannel.FC_GET_INFO);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  },

  async exportCLI(format: 'diff' | 'dump'): Promise<string> {
    const response = await ipcRenderer.invoke(IPCChannel.FC_EXPORT_CLI, format);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  },

  async getBlackboxSettings(): Promise<BlackboxSettings> {
    const response = await ipcRenderer.invoke(IPCChannel.FC_GET_BLACKBOX_SETTINGS);
    if (!response.success) {
      throw new Error(response.error || 'Failed to get blackbox settings');
    }
    return response.data;
  },

  async getFeedforwardConfig(): Promise<FeedforwardConfiguration> {
    const response = await ipcRenderer.invoke(IPCChannel.FC_GET_FEEDFORWARD_CONFIG);
    if (!response.success) {
      throw new Error(response.error || 'Failed to get feedforward configuration');
    }
    return response.data;
  },

  async fixBlackboxSettings(input: FixBlackboxSettingsInput): Promise<FixBlackboxSettingsResult> {
    const response = await ipcRenderer.invoke(IPCChannel.FC_FIX_BLACKBOX_SETTINGS, input);
    if (!response.success) {
      throw new Error(response.error || 'Failed to fix blackbox settings');
    }
    return response.data;
  },

  async selectPidProfile(index: number): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.FC_SELECT_PID_PROFILE, index);
    if (!response.success) {
      throw new Error(response.error || 'Failed to select PID profile');
    }
  },

  // Snapshots
  async createSnapshot(label?: string): Promise<ConfigurationSnapshot> {
    const response = await ipcRenderer.invoke(IPCChannel.SNAPSHOT_CREATE, label);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  },

  async listSnapshots(): Promise<SnapshotMetadata[]> {
    const response = await ipcRenderer.invoke(IPCChannel.SNAPSHOT_LIST);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  },

  async deleteSnapshot(id: string): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.SNAPSHOT_DELETE, id);
    if (!response.success) {
      throw new Error(response.error);
    }
  },

  async exportSnapshot(id: string, filePath: string): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.SNAPSHOT_EXPORT, id, filePath);
    if (!response.success) {
      throw new Error(response.error);
    }
  },

  async loadSnapshot(id: string): Promise<ConfigurationSnapshot> {
    const response = await ipcRenderer.invoke(IPCChannel.SNAPSHOT_LOAD, id);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  },

  // Profiles
  async createProfile(input: ProfileCreationInput): Promise<DroneProfile> {
    const response = await ipcRenderer.invoke(IPCChannel.PROFILE_CREATE, input);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  },

  async createProfileFromPreset(presetId: string, customName?: string): Promise<DroneProfile> {
    const response = await ipcRenderer.invoke(
      IPCChannel.PROFILE_CREATE_FROM_PRESET,
      presetId,
      customName
    );
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  },

  async updateProfile(id: string, updates: ProfileUpdateInput): Promise<DroneProfile> {
    const response = await ipcRenderer.invoke(IPCChannel.PROFILE_UPDATE, id, updates);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  },

  async deleteProfile(id: string): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.PROFILE_DELETE, id);
    if (!response.success) {
      throw new Error(response.error);
    }
  },

  async listProfiles(): Promise<DroneProfileMetadata[]> {
    const response = await ipcRenderer.invoke(IPCChannel.PROFILE_LIST);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  },

  async getProfile(id: string): Promise<DroneProfile | null> {
    const response = await ipcRenderer.invoke(IPCChannel.PROFILE_GET, id);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  },

  async getCurrentProfile(): Promise<DroneProfile | null> {
    const response = await ipcRenderer.invoke(IPCChannel.PROFILE_GET_CURRENT);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  },

  async setCurrentProfile(id: string): Promise<DroneProfile> {
    const response = await ipcRenderer.invoke(IPCChannel.PROFILE_SET_CURRENT, id);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  },

  async exportProfile(id: string, filePath: string): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.PROFILE_EXPORT, id, filePath);
    if (!response.success) {
      throw new Error(response.error);
    }
  },

  async getFCSerialNumber(): Promise<string> {
    const response = await ipcRenderer.invoke(IPCChannel.PROFILE_GET_FC_SERIAL);
    if (!response.success) {
      throw new Error(response.error);
    }
    return response.data;
  },

  // Events
  onError(callback: (error: string) => void): () => void {
    const listener = (_: any, error: string) => callback(error);
    ipcRenderer.on(IPCChannel.EVENT_ERROR, listener);
    return () => {
      ipcRenderer.removeListener(IPCChannel.EVENT_ERROR, listener);
    };
  },

  onLog(callback: (message: string, level: string) => void): () => void {
    const listener = (_: any, message: string, level: string) => callback(message, level);
    ipcRenderer.on(IPCChannel.EVENT_LOG, listener);
    return () => {
      ipcRenderer.removeListener(IPCChannel.EVENT_LOG, listener);
    };
  },

  onProfileChanged(callback: (profile: DroneProfile | null) => void): () => void {
    const listener = (_: any, profile: DroneProfile | null) => callback(profile);
    ipcRenderer.on(IPCChannel.EVENT_PROFILE_CHANGED, listener);
    return () => {
      ipcRenderer.removeListener(IPCChannel.EVENT_PROFILE_CHANGED, listener);
    };
  },

  onNewFCDetected(callback: (fcSerial: string, fcInfo: FCInfo) => void): () => void {
    const listener = (_: any, fcSerial: string, fcInfo: FCInfo) => callback(fcSerial, fcInfo);
    ipcRenderer.on(IPCChannel.EVENT_NEW_FC_DETECTED, listener);
    return () => {
      ipcRenderer.removeListener(IPCChannel.EVENT_NEW_FC_DETECTED, listener);
    };
  },

  // PID Configuration
  async getPIDConfig(): Promise<PIDConfiguration> {
    const response = await ipcRenderer.invoke(IPCChannel.PID_GET_CONFIG);
    if (!response.success) {
      throw new Error(response.error || 'Failed to get PID configuration');
    }
    return response.data;
  },

  async updatePIDConfig(config: PIDConfiguration): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.PID_UPDATE_CONFIG, config);
    if (!response.success) {
      throw new Error(response.error || 'Failed to update PID configuration');
    }
  },

  async savePIDConfig(): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.PID_SAVE_CONFIG);
    if (!response.success) {
      throw new Error(response.error || 'Failed to save PID configuration');
    }
  },

  // Blackbox
  async getBlackboxInfo(): Promise<BlackboxInfo> {
    const response = await ipcRenderer.invoke(IPCChannel.BLACKBOX_GET_INFO);
    if (!response.success) {
      throw new Error(response.error || 'Failed to get Blackbox info');
    }
    return response.data;
  },

  async downloadBlackboxLog(onProgress?: (progress: number) => void): Promise<BlackboxLogMetadata> {
    // Set up progress listener if callback provided
    let progressListener: ((event: any, progress: number) => void) | null = null;
    if (onProgress) {
      progressListener = (_event: any, progress: number) => onProgress(progress);
      ipcRenderer.on(IPCChannel.EVENT_BLACKBOX_DOWNLOAD_PROGRESS, progressListener);
    }

    try {
      const response = await ipcRenderer.invoke(IPCChannel.BLACKBOX_DOWNLOAD_LOG);
      if (!response.success) {
        throw new Error(response.error || 'Failed to download Blackbox log');
      }
      return response.data;
    } finally {
      // Clean up progress listener
      if (progressListener) {
        ipcRenderer.removeListener(IPCChannel.EVENT_BLACKBOX_DOWNLOAD_PROGRESS, progressListener);
      }
    }
  },

  async listBlackboxLogs(): Promise<BlackboxLogMetadata[]> {
    const response = await ipcRenderer.invoke(IPCChannel.BLACKBOX_LIST_LOGS);
    if (!response.success) {
      throw new Error(response.error || 'Failed to list Blackbox logs');
    }
    return response.data;
  },

  async deleteBlackboxLog(logId: string): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.BLACKBOX_DELETE_LOG, logId);
    if (!response.success) {
      throw new Error(response.error || 'Failed to delete Blackbox log');
    }
  },

  async eraseBlackboxFlash(): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.BLACKBOX_ERASE_FLASH);
    if (!response.success) {
      throw new Error(response.error || 'Failed to erase Blackbox flash');
    }
  },

  async openBlackboxFolder(filepath: string): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.BLACKBOX_OPEN_FOLDER, filepath);
    if (!response.success) {
      throw new Error(response.error || 'Failed to open Blackbox folder');
    }
  },

  async testBlackboxRead(): Promise<{ success: boolean; message: string; data?: string }> {
    const response = await ipcRenderer.invoke(IPCChannel.BLACKBOX_TEST_READ);
    if (!response.success) {
      throw new Error(response.error || 'Failed to test Blackbox read');
    }
    return response.data;
  },

  async parseBlackboxLog(
    logId: string,
    onProgress?: (progress: BlackboxParseProgress) => void
  ): Promise<BlackboxParseResult> {
    let progressListener: ((event: any, progress: BlackboxParseProgress) => void) | null = null;
    if (onProgress) {
      progressListener = (_event: any, progress: BlackboxParseProgress) => onProgress(progress);
      ipcRenderer.on(IPCChannel.EVENT_BLACKBOX_PARSE_PROGRESS, progressListener);
    }

    try {
      const response = await ipcRenderer.invoke(IPCChannel.BLACKBOX_PARSE_LOG, logId);
      if (!response.success) {
        throw new Error(response.error || 'Failed to parse Blackbox log');
      }
      return response.data;
    } finally {
      if (progressListener) {
        ipcRenderer.removeListener(IPCChannel.EVENT_BLACKBOX_PARSE_PROGRESS, progressListener);
      }
    }
  },

  async importBlackboxLog(): Promise<BlackboxLogMetadata | null> {
    const response = await ipcRenderer.invoke(IPCChannel.BLACKBOX_IMPORT_LOG);
    if (!response.success) {
      throw new Error(response.error || 'Failed to import Blackbox log');
    }
    return response.data;
  },

  onBlackboxParseProgress(callback: (progress: BlackboxParseProgress) => void): () => void {
    const listener = (_: any, progress: BlackboxParseProgress) => callback(progress);
    ipcRenderer.on(IPCChannel.EVENT_BLACKBOX_PARSE_PROGRESS, listener);
    return () => {
      ipcRenderer.removeListener(IPCChannel.EVENT_BLACKBOX_PARSE_PROGRESS, listener);
    };
  },

  // Analysis
  async analyzeFilters(
    logId: string,
    sessionIndex?: number,
    currentSettings?: CurrentFilterSettings,
    onProgress?: (progress: AnalysisProgress) => void
  ): Promise<FilterAnalysisResult> {
    let progressListener: ((event: any, progress: AnalysisProgress) => void) | null = null;
    if (onProgress) {
      progressListener = (_event: any, progress: AnalysisProgress) => onProgress(progress);
      ipcRenderer.on(IPCChannel.EVENT_ANALYSIS_PROGRESS, progressListener);
    }

    try {
      const response = await ipcRenderer.invoke(
        IPCChannel.ANALYSIS_RUN_FILTER,
        logId,
        sessionIndex,
        currentSettings
      );
      if (!response.success) {
        throw new Error(response.error || 'Failed to run filter analysis');
      }
      return response.data;
    } finally {
      if (progressListener) {
        ipcRenderer.removeListener(IPCChannel.EVENT_ANALYSIS_PROGRESS, progressListener);
      }
    }
  },

  async analyzePID(
    logId: string,
    sessionIndex?: number,
    currentPIDs?: PIDConfiguration,
    onProgress?: (progress: AnalysisProgress) => void
  ): Promise<PIDAnalysisResult> {
    let progressListener: ((event: any, progress: AnalysisProgress) => void) | null = null;
    if (onProgress) {
      progressListener = (_event: any, progress: AnalysisProgress) => onProgress(progress);
      ipcRenderer.on(IPCChannel.EVENT_ANALYSIS_PROGRESS, progressListener);
    }

    try {
      const response = await ipcRenderer.invoke(
        IPCChannel.ANALYSIS_RUN_PID,
        logId,
        sessionIndex,
        currentPIDs
      );
      if (!response.success) {
        throw new Error(response.error || 'Failed to run PID analysis');
      }
      return response.data;
    } finally {
      if (progressListener) {
        ipcRenderer.removeListener(IPCChannel.EVENT_ANALYSIS_PROGRESS, progressListener);
      }
    }
  },

  async analyzeTransferFunction(
    logId: string,
    sessionIndex?: number,
    currentPIDs?: PIDConfiguration,
    onProgress?: (progress: AnalysisProgress) => void
  ): Promise<PIDAnalysisResult> {
    let progressListener: ((event: any, progress: AnalysisProgress) => void) | null = null;
    if (onProgress) {
      progressListener = (_event: any, progress: AnalysisProgress) => onProgress(progress);
      ipcRenderer.on(IPCChannel.EVENT_ANALYSIS_PROGRESS, progressListener);
    }

    try {
      const response = await ipcRenderer.invoke(
        IPCChannel.ANALYSIS_RUN_TRANSFER_FUNCTION,
        logId,
        sessionIndex,
        currentPIDs
      );
      if (!response.success) {
        throw new Error(response.error || 'Failed to run transfer function analysis');
      }
      return response.data;
    } finally {
      if (progressListener) {
        ipcRenderer.removeListener(IPCChannel.EVENT_ANALYSIS_PROGRESS, progressListener);
      }
    }
  },

  // Snapshot Restore
  async restoreSnapshot(id: string, createBackup: boolean): Promise<SnapshotRestoreResult> {
    const response = await ipcRenderer.invoke(IPCChannel.SNAPSHOT_RESTORE, id, createBackup);
    if (!response.success) {
      throw new Error(response.error || 'Failed to restore snapshot');
    }
    return response.data;
  },

  onRestoreProgress(callback: (progress: SnapshotRestoreProgress) => void): () => void {
    const listener = (_: any, progress: SnapshotRestoreProgress) => callback(progress);
    ipcRenderer.on(IPCChannel.EVENT_SNAPSHOT_RESTORE_PROGRESS, listener);
    return () => {
      ipcRenderer.removeListener(IPCChannel.EVENT_SNAPSHOT_RESTORE_PROGRESS, listener);
    };
  },

  // Tuning
  async applyRecommendations(
    input: ApplyRecommendationsInput
  ): Promise<ApplyRecommendationsResult> {
    const response = await ipcRenderer.invoke(IPCChannel.TUNING_APPLY_RECOMMENDATIONS, input);
    if (!response.success) {
      throw new Error(response.error || 'Failed to apply recommendations');
    }
    return response.data;
  },

  onApplyProgress(callback: (progress: ApplyRecommendationsProgress) => void): () => void {
    const listener = (_: any, progress: ApplyRecommendationsProgress) => callback(progress);
    ipcRenderer.on(IPCChannel.EVENT_TUNING_APPLY_PROGRESS, listener);
    return () => {
      ipcRenderer.removeListener(IPCChannel.EVENT_TUNING_APPLY_PROGRESS, listener);
    };
  },

  onPIDChanged(callback: (config: PIDConfiguration) => void): () => void {
    const listener = (_: any, config: PIDConfiguration) => callback(config);
    ipcRenderer.on(IPCChannel.EVENT_PID_CHANGED, listener);
    return () => {
      ipcRenderer.removeListener(IPCChannel.EVENT_PID_CHANGED, listener);
    };
  },

  // Tuning Session
  async getTuningSession(): Promise<TuningSession | null> {
    const response = await ipcRenderer.invoke(IPCChannel.TUNING_GET_SESSION);
    if (!response.success) {
      throw new Error(response.error || 'Failed to get tuning session');
    }
    return response.data;
  },

  async startTuningSession(
    tuningType?: TuningType,
    bfPidProfileIndex?: number
  ): Promise<TuningSession> {
    const response = await ipcRenderer.invoke(
      IPCChannel.TUNING_START_SESSION,
      tuningType,
      bfPidProfileIndex
    );
    if (!response.success) {
      throw new Error(response.error || 'Failed to start tuning session');
    }
    return response.data;
  },

  async updateTuningPhase(
    phase: TuningPhase,
    data?: Partial<TuningSession>
  ): Promise<TuningSession> {
    const response = await ipcRenderer.invoke(IPCChannel.TUNING_UPDATE_PHASE, phase, data);
    if (!response.success) {
      throw new Error(response.error || 'Failed to update tuning phase');
    }
    return response.data;
  },

  async resetTuningSession(): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.TUNING_RESET_SESSION);
    if (!response.success) {
      throw new Error(response.error || 'Failed to reset tuning session');
    }
  },

  onTuningSessionChanged(callback: (session: TuningSession | null) => void): () => void {
    const listener = (_: any, session: TuningSession | null) => callback(session);
    ipcRenderer.on(IPCChannel.EVENT_TUNING_SESSION_CHANGED, listener);
    return () => {
      ipcRenderer.removeListener(IPCChannel.EVENT_TUNING_SESSION_CHANGED, listener);
    };
  },

  // Telemetry
  async getTelemetrySettings(): Promise<TelemetrySettings> {
    const response = await ipcRenderer.invoke(IPCChannel.TELEMETRY_GET_SETTINGS);
    if (!response.success) {
      throw new Error(response.error || 'Failed to get telemetry settings');
    }
    return response.data;
  },

  async setTelemetryEnabled(enabled: boolean): Promise<TelemetrySettings> {
    const response = await ipcRenderer.invoke(IPCChannel.TELEMETRY_SET_ENABLED, enabled);
    if (!response.success) {
      throw new Error(response.error || 'Failed to set telemetry enabled');
    }
    return response.data;
  },

  async sendTelemetryNow(): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.TELEMETRY_SEND_NOW);
    if (!response.success) {
      throw new Error(response.error || 'Failed to send telemetry');
    }
  },

  // App Logs
  async getAppLogs(lines?: number): Promise<string[]> {
    const response = await ipcRenderer.invoke(IPCChannel.APP_GET_LOGS, lines);
    if (!response.success) {
      throw new Error(response.error || 'Failed to get app logs');
    }
    return response.data;
  },

  async exportAppLogs(): Promise<string> {
    const response = await ipcRenderer.invoke(IPCChannel.APP_EXPORT_LOGS);
    if (!response.success) {
      throw new Error(response.error || 'Failed to export logs');
    }
    return response.data;
  },

  // Auto-update
  async checkForUpdate(): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.UPDATE_CHECK);
    if (!response.success) {
      throw new Error(response.error || 'Failed to check for updates');
    }
  },

  async installUpdate(): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.UPDATE_INSTALL);
    if (!response.success) {
      throw new Error(response.error || 'Failed to install update');
    }
  },

  onUpdateAvailable(
    callback: (info: { version: string; releaseNotes?: string }) => void
  ): () => void {
    const listener = (_: any, info: { version: string; releaseNotes?: string }) => callback(info);
    ipcRenderer.on(IPCChannel.EVENT_UPDATE_AVAILABLE, listener);
    return () => {
      ipcRenderer.removeListener(IPCChannel.EVENT_UPDATE_AVAILABLE, listener);
    };
  },

  onUpdateDownloaded(
    callback: (info: { version: string; releaseNotes?: string }) => void
  ): () => void {
    const listener = (_: any, info: { version: string; releaseNotes?: string }) => callback(info);
    ipcRenderer.on(IPCChannel.EVENT_UPDATE_DOWNLOADED, listener);
    return () => {
      ipcRenderer.removeListener(IPCChannel.EVENT_UPDATE_DOWNLOADED, listener);
    };
  },

  // License
  async activateLicense(key: string): Promise<LicenseInfo> {
    const response = await ipcRenderer.invoke(IPCChannel.LICENSE_ACTIVATE, key);
    if (!response.success) {
      throw new Error(response.error || 'Failed to activate license');
    }
    return response.data;
  },

  async getLicenseStatus(): Promise<LicenseInfo> {
    const response = await ipcRenderer.invoke(IPCChannel.LICENSE_GET_STATUS);
    if (!response.success) {
      throw new Error(response.error || 'Failed to get license status');
    }
    return response.data;
  },

  async removeLicense(): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.LICENSE_REMOVE);
    if (!response.success) {
      throw new Error(response.error || 'Failed to remove license');
    }
  },

  async validateLicense(): Promise<void> {
    const response = await ipcRenderer.invoke(IPCChannel.LICENSE_VALIDATE);
    if (!response.success) {
      throw new Error(response.error || 'Failed to validate license');
    }
  },

  onLicenseChanged(callback: (info: LicenseInfo) => void): () => void {
    const listener = (_: any, info: LicenseInfo) => callback(info);
    ipcRenderer.on(IPCChannel.EVENT_LICENSE_CHANGED, listener);
    return () => {
      ipcRenderer.removeListener(IPCChannel.EVENT_LICENSE_CHANGED, listener);
    };
  },

  // Tuning History
  async getTuningHistory(): Promise<CompletedTuningRecord[]> {
    const response = await ipcRenderer.invoke(IPCChannel.TUNING_GET_HISTORY);
    if (!response.success) {
      throw new Error(response.error || 'Failed to get tuning history');
    }
    return response.data;
  },

  async updateVerificationMetrics(
    verificationMetrics?: FilterMetricsSummary,
    verificationTransferFunctionMetrics?: TransferFunctionMetricsSummary,
    verificationPidMetrics?: PIDMetricsSummary
  ): Promise<TuningSession> {
    const response = await ipcRenderer.invoke(
      IPCChannel.TUNING_UPDATE_VERIFICATION,
      verificationMetrics,
      verificationTransferFunctionMetrics,
      verificationPidMetrics
    );
    if (!response.success) {
      throw new Error(response.error || 'Failed to update verification metrics');
    }
    return response.data;
  },

  async updateHistoryVerification(
    recordId: string,
    verificationMetrics?: FilterMetricsSummary,
    verificationPidMetrics?: PIDMetricsSummary
  ): Promise<void> {
    const response = await ipcRenderer.invoke(
      IPCChannel.TUNING_UPDATE_HISTORY_VERIFICATION,
      recordId,
      verificationMetrics,
      verificationPidMetrics
    );
    if (!response.success) {
      throw new Error(response.error || 'Failed to update history verification');
    }
  },
};

contextBridge.exposeInMainWorld('betaflight', betaflightAPI);
