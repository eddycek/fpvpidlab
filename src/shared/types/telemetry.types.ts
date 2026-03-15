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
      quick: number;
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
