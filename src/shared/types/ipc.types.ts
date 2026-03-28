import type {
  PortInfo,
  FCInfo,
  ConfigurationSnapshot,
  SnapshotMetadata,
  ConnectionStatus,
} from './common.types';
import type {
  DroneProfile,
  DroneProfileMetadata,
  ProfileCreationInput,
  ProfileUpdateInput,
} from './profile.types';
import type { PIDConfiguration, FeedforwardConfiguration, RatesConfiguration } from './pid.types';
import type {
  BlackboxInfo,
  BlackboxLogMetadata,
  BlackboxParseResult,
  BlackboxParseProgress,
  BlackboxSettings,
} from './blackbox.types';
import type {
  FilterAnalysisResult,
  PIDAnalysisResult,
  AnalysisProgress,
  CurrentFilterSettings,
  FilterRecommendation,
  PIDRecommendation,
} from './analysis.types';
import type { TuningSession, TuningPhase, TuningType } from './tuning.types';
import type {
  CompletedTuningRecord,
  FilterMetricsSummary,
  PIDMetricsSummary,
  TransferFunctionMetricsSummary,
} from './tuning-history.types';
import type { TelemetrySettings } from './telemetry.types';
import type { LicenseInfo } from './license.types';
import type { DiagnosticReportInput, DiagnosticReportResult } from './diagnostic.types';

/** Progress during snapshot restore */
export interface SnapshotRestoreProgress {
  stage: 'backup' | 'cli' | 'save';
  message: string;
  percent: number;
}

/** Result of restoring a snapshot */
export interface SnapshotRestoreResult {
  success: boolean;
  backupSnapshotId?: string;
  appliedCommands: number;
  rebooted: boolean;
}

/** Input for fixing blackbox settings on the FC */
export interface FixBlackboxSettingsInput {
  commands: string[];
}

/** Result of fixing blackbox settings */
export interface FixBlackboxSettingsResult {
  success: boolean;
  appliedCommands: number;
  rebooted: boolean;
}

/** Input for applying tuning recommendations to the FC */
export interface ApplyRecommendationsInput {
  filterRecommendations: FilterRecommendation[];
  pidRecommendations: PIDRecommendation[];
  feedforwardRecommendations: PIDRecommendation[];
}

/** Progress during recommendation application */
export interface ApplyRecommendationsProgress {
  stage: 'pid' | 'filter' | 'feedforward' | 'save';
  message: string;
  percent: number;
}

/** Result of applying recommendations */
export interface ApplyRecommendationsResult {
  success: boolean;
  appliedPIDs: number;
  appliedFilters: number;
  appliedFeedforward: number;
  rebooted: boolean;
}

export enum IPCChannel {
  // App
  APP_IS_DEMO_MODE = 'app:is-demo-mode',
  APP_RESET_DEMO = 'app:reset-demo',

  // Connection
  CONNECTION_LIST_PORTS = 'connection:list-ports',
  CONNECTION_CONNECT = 'connection:connect',
  CONNECTION_DISCONNECT = 'connection:disconnect',
  CONNECTION_GET_STATUS = 'connection:get-status',

  // FC Info
  FC_GET_INFO = 'fc:get-info',
  FC_EXPORT_CLI = 'fc:export-cli',
  FC_GET_BLACKBOX_SETTINGS = 'fc:get-blackbox-settings',
  FC_GET_FEEDFORWARD_CONFIG = 'fc:get-feedforward-config',
  FC_GET_RATES_CONFIG = 'fc:get-rates-config',
  FC_FIX_BLACKBOX_SETTINGS = 'fc:fix-blackbox-settings',
  FC_SELECT_PID_PROFILE = 'fc:select-pid-profile',

  // Snapshots
  SNAPSHOT_CREATE = 'snapshot:create',
  SNAPSHOT_LIST = 'snapshot:list',
  SNAPSHOT_DELETE = 'snapshot:delete',
  SNAPSHOT_EXPORT = 'snapshot:export',
  SNAPSHOT_LOAD = 'snapshot:load',

  // Profiles
  PROFILE_CREATE = 'profile:create',
  PROFILE_CREATE_FROM_PRESET = 'profile:create-from-preset',
  PROFILE_UPDATE = 'profile:update',
  PROFILE_DELETE = 'profile:delete',
  PROFILE_LIST = 'profile:list',
  PROFILE_GET = 'profile:get',
  PROFILE_GET_CURRENT = 'profile:get-current',
  PROFILE_SET_CURRENT = 'profile:set-current',
  PROFILE_EXPORT = 'profile:export',
  PROFILE_GET_FC_SERIAL = 'profile:get-fc-serial',

  // PID Configuration
  PID_GET_CONFIG = 'pid:get-config',
  PID_UPDATE_CONFIG = 'pid:update-config',
  PID_SAVE_CONFIG = 'pid:save-config',

  // Blackbox
  BLACKBOX_GET_INFO = 'blackbox:get-info',
  BLACKBOX_DOWNLOAD_LOG = 'blackbox:download-log',
  BLACKBOX_LIST_LOGS = 'blackbox:list-logs',
  BLACKBOX_DELETE_LOG = 'blackbox:delete-log',
  BLACKBOX_ERASE_FLASH = 'blackbox:erase-flash',
  BLACKBOX_OPEN_FOLDER = 'blackbox:open-folder',
  BLACKBOX_TEST_READ = 'blackbox:test-read',
  BLACKBOX_PARSE_LOG = 'blackbox:parse-log',
  BLACKBOX_IMPORT_LOG = 'blackbox:import-log',

  // Analysis
  ANALYSIS_RUN_FILTER = 'analysis:run-filter',
  ANALYSIS_RUN_PID = 'analysis:run-pid',
  ANALYSIS_RUN_TRANSFER_FUNCTION = 'analysis:run-transfer-function',

  // Snapshot Restore
  SNAPSHOT_RESTORE = 'snapshot:restore',

  // Tuning
  TUNING_APPLY_RECOMMENDATIONS = 'tuning:apply-recommendations',
  TUNING_GET_SESSION = 'tuning:get-session',
  TUNING_START_SESSION = 'tuning:start-session',
  TUNING_UPDATE_PHASE = 'tuning:update-phase',
  TUNING_RESET_SESSION = 'tuning:reset-session',
  TUNING_GET_HISTORY = 'tuning:get-history',
  TUNING_UPDATE_VERIFICATION = 'tuning:update-verification',
  TUNING_UPDATE_HISTORY_VERIFICATION = 'tuning:update-history-verification',

  // Telemetry
  TELEMETRY_GET_SETTINGS = 'telemetry:get-settings',
  TELEMETRY_SET_ENABLED = 'telemetry:set-enabled',
  TELEMETRY_SEND_NOW = 'telemetry:send-now',

  // App Logs
  APP_GET_LOGS = 'app:get-logs',
  APP_EXPORT_LOGS = 'app:export-logs',

  // Auto-update
  UPDATE_CHECK = 'update:check',
  UPDATE_INSTALL = 'update:install',

  // Diagnostic Reports
  DIAGNOSTIC_SEND_REPORT = 'diagnostic:send-report',

  // License
  LICENSE_ACTIVATE = 'license:activate',
  LICENSE_GET_STATUS = 'license:get-status',
  LICENSE_REMOVE = 'license:remove',
  LICENSE_VALIDATE = 'license:validate',

  // Events (main -> renderer)
  EVENT_CONNECTION_CHANGED = 'event:connection-changed',
  EVENT_PROFILE_CHANGED = 'event:profile-changed',
  EVENT_NEW_FC_DETECTED = 'event:new-fc-detected',
  EVENT_PID_CHANGED = 'event:pid-changed',
  EVENT_BLACKBOX_DOWNLOAD_PROGRESS = 'event:blackbox-download-progress',
  EVENT_BLACKBOX_PARSE_PROGRESS = 'event:blackbox-parse-progress',
  EVENT_ANALYSIS_PROGRESS = 'event:analysis-progress',
  EVENT_TUNING_APPLY_PROGRESS = 'event:tuning-apply-progress',
  EVENT_SNAPSHOT_RESTORE_PROGRESS = 'event:snapshot-restore-progress',
  EVENT_TUNING_SESSION_CHANGED = 'event:tuning-session-changed',
  EVENT_LICENSE_CHANGED = 'event:license-changed',
  EVENT_UPDATE_AVAILABLE = 'event:update-available',
  EVENT_UPDATE_DOWNLOADED = 'event:update-downloaded',
  EVENT_ERROR = 'event:error',
  EVENT_LOG = 'event:log',
}

export interface IPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface BetaflightAPI {
  // App
  isDemoMode(): Promise<boolean>;
  resetDemo(): Promise<void>;

  // Connection
  listPorts(): Promise<PortInfo[]>;
  connect(portPath: string): Promise<void>;
  disconnect(): Promise<void>;
  getConnectionStatus(): Promise<ConnectionStatus>;
  onConnectionChanged(callback: (status: ConnectionStatus) => void): () => void;

  // FC Info
  getFCInfo(): Promise<FCInfo>;
  exportCLI(format: 'diff' | 'dump'): Promise<string>;
  getBlackboxSettings(): Promise<BlackboxSettings>;
  getFeedforwardConfig(): Promise<FeedforwardConfiguration>;
  getRatesConfig(): Promise<RatesConfiguration>;
  fixBlackboxSettings(input: FixBlackboxSettingsInput): Promise<FixBlackboxSettingsResult>;
  selectPidProfile(index: number): Promise<void>;

  // Snapshots
  createSnapshot(label?: string): Promise<ConfigurationSnapshot>;
  listSnapshots(): Promise<SnapshotMetadata[]>;
  deleteSnapshot(id: string): Promise<void>;
  exportSnapshot(id: string, filePath: string): Promise<void>;
  loadSnapshot(id: string): Promise<ConfigurationSnapshot>;

  // Profiles
  createProfile(input: ProfileCreationInput): Promise<DroneProfile>;
  createProfileFromPreset(presetId: string, customName?: string): Promise<DroneProfile>;
  updateProfile(id: string, updates: ProfileUpdateInput): Promise<DroneProfile>;
  deleteProfile(id: string): Promise<void>;
  listProfiles(): Promise<DroneProfileMetadata[]>;
  getProfile(id: string): Promise<DroneProfile | null>;
  getCurrentProfile(): Promise<DroneProfile | null>;
  setCurrentProfile(id: string): Promise<DroneProfile>;
  exportProfile(id: string, filePath: string): Promise<void>;
  getFCSerialNumber(): Promise<string>;

  // PID Configuration
  getPIDConfig(): Promise<PIDConfiguration>;
  updatePIDConfig(config: PIDConfiguration): Promise<void>;
  savePIDConfig(): Promise<void>;

  // Blackbox
  getBlackboxInfo(): Promise<BlackboxInfo>;
  downloadBlackboxLog(onProgress?: (progress: number) => void): Promise<BlackboxLogMetadata>;
  listBlackboxLogs(): Promise<BlackboxLogMetadata[]>;
  deleteBlackboxLog(logId: string): Promise<void>;
  eraseBlackboxFlash(): Promise<void>;
  openBlackboxFolder(filepath: string): Promise<void>;
  testBlackboxRead(): Promise<{ success: boolean; message: string; data?: string }>;
  parseBlackboxLog(
    logId: string,
    onProgress?: (progress: BlackboxParseProgress) => void
  ): Promise<BlackboxParseResult>;
  importBlackboxLog(): Promise<BlackboxLogMetadata | null>;
  onBlackboxParseProgress(callback: (progress: BlackboxParseProgress) => void): () => void;

  // Analysis
  analyzeFilters(
    logId: string,
    sessionIndex?: number,
    currentSettings?: CurrentFilterSettings,
    onProgress?: (progress: AnalysisProgress) => void
  ): Promise<FilterAnalysisResult>;
  analyzePID(
    logId: string,
    sessionIndex?: number,
    currentPIDs?: PIDConfiguration,
    onProgress?: (progress: AnalysisProgress) => void
  ): Promise<PIDAnalysisResult>;
  analyzeTransferFunction(
    logId: string,
    sessionIndex?: number,
    currentPIDs?: PIDConfiguration,
    onProgress?: (progress: AnalysisProgress) => void
  ): Promise<PIDAnalysisResult>;

  // Snapshot Restore
  restoreSnapshot(id: string, createBackup: boolean): Promise<SnapshotRestoreResult>;
  onRestoreProgress(callback: (progress: SnapshotRestoreProgress) => void): () => void;

  // Tuning
  applyRecommendations(input: ApplyRecommendationsInput): Promise<ApplyRecommendationsResult>;
  onApplyProgress(callback: (progress: ApplyRecommendationsProgress) => void): () => void;

  // Tuning Session
  getTuningSession(): Promise<TuningSession | null>;
  startTuningSession(tuningType?: TuningType, bfPidProfileIndex?: number): Promise<TuningSession>;
  updateTuningPhase(phase: TuningPhase, data?: Partial<TuningSession>): Promise<TuningSession>;
  resetTuningSession(): Promise<void>;
  onTuningSessionChanged(callback: (session: TuningSession | null) => void): () => void;

  // Tuning History
  getTuningHistory(): Promise<CompletedTuningRecord[]>;
  updateVerificationMetrics(
    verificationMetrics?: FilterMetricsSummary,
    verificationTransferFunctionMetrics?: TransferFunctionMetricsSummary,
    verificationPidMetrics?: PIDMetricsSummary
  ): Promise<TuningSession>;
  updateHistoryVerification(
    recordId: string,
    verificationMetrics?: FilterMetricsSummary,
    verificationPidMetrics?: PIDMetricsSummary
  ): Promise<void>;

  // Telemetry
  getTelemetrySettings(): Promise<TelemetrySettings>;
  setTelemetryEnabled(enabled: boolean): Promise<TelemetrySettings>;
  sendTelemetryNow(): Promise<void>;

  // App Logs
  getAppLogs(lines?: number): Promise<string[]>;
  exportAppLogs(): Promise<string>;

  // Auto-update
  checkForUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateAvailable(
    callback: (info: { version: string; releaseNotes?: string }) => void
  ): () => void;
  onUpdateDownloaded(
    callback: (info: { version: string; releaseNotes?: string }) => void
  ): () => void;

  // Diagnostic Reports
  sendDiagnosticReport(input: DiagnosticReportInput): Promise<DiagnosticReportResult>;

  // License
  activateLicense(key: string): Promise<LicenseInfo>;
  getLicenseStatus(): Promise<LicenseInfo>;
  removeLicense(): Promise<void>;
  validateLicense(): Promise<void>;
  onLicenseChanged(callback: (info: LicenseInfo) => void): () => void;

  // Events
  onError(callback: (error: string) => void): () => void;
  onLog(callback: (message: string, level: string) => void): () => void;
  onProfileChanged(callback: (profile: DroneProfile | null) => void): () => void;
  onNewFCDetected(callback: (fcSerial: string, fcInfo: FCInfo) => void): () => void;
  onPIDChanged(callback: (config: PIDConfiguration) => void): () => void;
}

declare global {
  interface Window {
    betaflight: BetaflightAPI;
  }
}
