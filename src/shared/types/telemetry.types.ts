/**
 * Telemetry Types
 *
 * Anonymous usage telemetry for understanding tuning patterns.
 */

/** Persisted telemetry settings */
export interface TelemetrySettings {
  /** Whether telemetry collection is enabled (opt-in) */
  enabled: boolean;
  /** Unique anonymous installation identifier (UUID v4) */
  installationId: string;
  /** ISO timestamp of last successful upload */
  lastUploadAt: string | null;
  /** Last upload error message (null if last upload succeeded) */
  lastUploadError: string | null;
}

/** Anonymous telemetry bundle sent to the cloud */
export interface TelemetryBundle {
  /** Schema version for forward compatibility */
  schemaVersion: 1;
  /** Installation ID (anonymous) */
  installationId: string;
  /** ISO timestamp when bundle was assembled */
  timestamp: string;
  /** App version */
  appVersion: string;
  /** Environment: 'production' (packaged) or 'development' */
  environment: 'production' | 'development';
  /** Platform (darwin, win32, linux) */
  platform: string;

  /** Profile summary */
  profiles: {
    count: number;
    sizes: string[];
    flightStyles: string[];
  };

  /** Tuning session summary */
  tuningSessions: {
    totalCompleted: number;
    byMode: {
      filter: number;
      pid: number;
      flash: number;
    };
    /** Last 10 quality scores (newest first) */
    recentQualityScores: number[];
  };

  /** Flight controller info (anonymized) */
  fcInfo: {
    /** Unique BF versions seen */
    bfVersions: string[];
    /** SHA-256 hashed FC serials (salted with installationId) */
    fcSerialHashes: string[];
    /** Unique board targets */
    boardTargets: string[];
    /** Unique rate types seen (BETAFLIGHT, ACTUAL, QUICK, etc.) */
    ratesTypes: string[];
  };

  /** Blackbox usage */
  blackbox: {
    totalLogsDownloaded: number;
    storageTypes: string[];
    compressionDetected: boolean;
  };

  /** Feature usage flags (derived from existing data) */
  features: {
    analysisOverviewUsed: boolean;
    snapshotRestoreUsed: boolean;
    snapshotCompareUsed: boolean;
    historyViewUsed: boolean;
  };
}

/** Structured telemetry event (error, workflow, or analysis) */
export interface TelemetryEvent {
  type: 'error' | 'workflow' | 'analysis';
  name: string;
  ts: string;
  sessionId?: string;
  meta?: Record<string, string | number | boolean>;
}

/** Per-session analytics record for telemetry (privacy-safe) */
export interface TelemetrySessionRecord {
  sessionId?: string;
  mode: 'filter' | 'pid' | 'flash';
  durationSec: number;
  droneSize?: string;
  flightStyle?: string;
  bfVersion?: string;

  dataQualityScore?: number;
  dataQualityTier?: string;

  /** Rules that fired during this session (compact) */
  rules: Array<{
    ruleId: string;
    confidence: 'high' | 'medium' | 'low';
    applied: boolean;
    delta: number;
  }>;

  /** RC rates configuration snapshot (full config for correlation analysis) */
  rates?: {
    type: string;
    roll: { rcRate: number; rate: number; expo: number; rateLimit: number };
    pitch: { rcRate: number; rate: number; expo: number; rateLimit: number };
    yaw: { rcRate: number; rate: number; expo: number; rateLimit: number };
  };

  /** Key metrics (NO absolute PID/filter values — only noise/response metrics) */
  metrics: {
    noiseFloorDb?: { roll: number; pitch: number; yaw: number };
    meanOvershootPct?: { roll: number; pitch: number; yaw: number };
    meanRiseTimeMs?: { roll: number; pitch: number; yaw: number };
    bandwidthHz?: { roll: number; pitch: number; yaw: number };
    phaseMarginDeg?: { roll: number; pitch: number; yaw: number };
  };

  /** Verification results (if verification flight was performed) */
  verification?: {
    noiseFloorDeltaDb?: { roll: number; pitch: number; yaw: number };
    overshootDeltaPct?: { roll: number; pitch: number; yaw: number };
    overallImprovement: number;
  };

  qualityScore?: number;
}

/** Telemetry bundle v2 with per-session analytics */
export interface TelemetryBundleV2 extends Omit<TelemetryBundle, 'schemaVersion'> {
  schemaVersion: 2;
  /** Per-session analytics records (all sessions, newest first) */
  sessions: TelemetrySessionRecord[];
}

/** Telemetry bundle v3 with structured events */
export interface TelemetryBundleV3 extends Omit<TelemetryBundleV2, 'schemaVersion'> {
  schemaVersion: 3;
  /** Structured events (max 200, newest first) */
  events: TelemetryEvent[];
}
