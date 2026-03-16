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

/** Per-session analytics record (from app v2 bundles) */
export interface TelemetrySessionRecord {
  mode: 'filter' | 'pid' | 'quick';
  durationSec: number;
  droneSize?: string;
  flightStyle?: string;
  bfVersion?: string;
  dataQualityScore?: number;
  dataQualityTier?: string;
  rules: Array<{
    ruleId: string;
    confidence: 'high' | 'medium' | 'low';
    applied: boolean;
    delta: number;
  }>;
  metrics: {
    noiseFloorDb?: { roll: number; pitch: number; yaw: number };
    meanOvershootPct?: { roll: number; pitch: number; yaw: number };
    meanRiseTimeMs?: { roll: number; pitch: number; yaw: number };
    bandwidthHz?: { roll: number; pitch: number; yaw: number };
    phaseMarginDeg?: { roll: number; pitch: number; yaw: number };
  };
  verification?: {
    noiseFloorDeltaDb?: { roll: number; pitch: number; yaw: number };
    overshootDeltaPct?: { roll: number; pitch: number; yaw: number };
    overallImprovement: number;
  };
  qualityScore?: number;
}

/** V2 bundle extends v1 with per-session data */
export interface TelemetryBundleV2 extends Omit<TelemetryBundle, 'schemaVersion'> {
  schemaVersion: 2;
  sessions: TelemetrySessionRecord[];
}

/** Union type for any supported bundle version */
export type AnyTelemetryBundle = TelemetryBundle | TelemetryBundleV2;

/** Rule effectiveness stats */
export interface RuleStats {
  fireCount: number;
  applyCount: number;
  applyRate: number;
  avgDelta: number;
  avgImprovement: number;
  sessionsWithVerification: number;
}

/** Histogram bucket counts */
export interface MetricBucket {
  [range: string]: number;
}

/** Metric distribution with histogram and summary stats */
export interface MetricDistribution {
  buckets: MetricBucket;
  mean: number;
  median: number;
  count: number;
}

/** Verification success rate stats */
export interface VerificationStats {
  totalVerified: number;
  improved: number;
  improvementRate: number;
  byMode: {
    [mode: string]: {
      count: number;
      improved: number;
      avgImprovement: number;
    };
  };
}

/** Quality score convergence stats across sessions */
export interface ConvergenceStats {
  installationsWithMultipleSessions: number;
  avgFirstSessionScore: number;
  avgSecondSessionScore: number;
  avgThirdPlusScore: number;
  convergenceRate: number;
}
