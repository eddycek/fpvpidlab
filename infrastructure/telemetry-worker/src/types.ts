/** Cloudflare Worker environment bindings */
export interface Env {
  TELEMETRY_BUCKET: R2Bucket;
  ADMIN_KEY: string;
  RESEND_API_KEY: string;
  REPORT_EMAIL: string;
}

/** Telemetry bundle schema (mirrors client-side TelemetryBundle) */
export interface TelemetryBundle {
  schemaVersion: number;
  installationId: string;
  timestamp: string;
  appVersion: string;
  environment?: 'production' | 'development';
  platform: string;
  profiles: {
    count: number;
    sizes: string[];
    flightStyles: string[];
  };
  tuningSessions: {
    totalCompleted: number;
    byMode: { filter: number; pid: number; quick: number };
    recentQualityScores: number[];
  };
  fcInfo: {
    bfVersions: string[];
    fcSerialHashes: string[];
    boardTargets: string[];
  };
  blackbox: {
    totalLogsDownloaded: number;
    storageTypes: string[];
    compressionDetected: boolean;
  };
  features: {
    analysisOverviewUsed: boolean;
    snapshotRestoreUsed: boolean;
    snapshotCompareUsed: boolean;
    historyViewUsed: boolean;
  };
}

/** Per-installation metadata stored in R2 */
export interface InstallationMetadata {
  firstSeen: string;
  lastSeen: string;
  uploadCount: number;
}

/** Aggregated stats for admin endpoints */
export interface AggregatedStats {
  totalInstallations: number;
  active24h: number;
  active7d: number;
  active30d: number;
  modeDistribution: { filter: number; pid: number; quick: number };
  platformDistribution: Record<string, number>;
}

export interface VersionDistribution {
  versions: Record<string, number>;
}

export interface DroneDistribution {
  sizes: Record<string, number>;
  flightStyles: Record<string, number>;
}

export interface QualityHistogram {
  buckets: Record<string, number>;
  averageScore: number | null;
  totalScores: number;
}
