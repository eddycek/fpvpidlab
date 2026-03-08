/**
 * Types for tuning history records — compact summaries of completed tuning sessions.
 *
 * These types store JSON-safe metrics (no Float64Array) for persistence and comparison.
 */

import type { AppliedChange, TuningType } from './tuning.types';
import type { PIDConfiguration } from './pid.types';

/** Downsampled power spectrum safe for JSON serialization (128 bins) */
export interface CompactSpectrum {
  /** Frequency bins in Hz */
  frequencies: number[];
  /** Roll axis magnitudes in dB */
  roll: number[];
  /** Pitch axis magnitudes in dB */
  pitch: number[];
  /** Yaw axis magnitudes in dB */
  yaw: number[];
}

/** Per-axis noise summary */
export interface AxisNoiseSummary {
  noiseFloorDb: number;
  peakCount: number;
}

/** Compact filter analysis metrics for history storage */
export interface FilterMetricsSummary {
  /** Overall noise level */
  noiseLevel: 'low' | 'medium' | 'high';
  /** Per-axis noise summaries */
  roll: AxisNoiseSummary;
  pitch: AxisNoiseSummary;
  yaw: AxisNoiseSummary;
  /** Number of flight segments used for analysis */
  segmentsUsed: number;
  /** Whether RPM filter was active */
  rpmFilterActive?: boolean;
  /** 1-2 sentence summary */
  summary: string;
  /** Optional downsampled spectrum for chart rendering */
  spectrum?: CompactSpectrum;
  /** Data quality score summary */
  dataQuality?: { overall: number; tier: string };
  /** Wind/disturbance level during hover segments */
  windDisturbance?: { level: string; worstVariance: number };
}

/** Compact per-axis PID step response metrics */
export interface AxisPIDSummary {
  meanOvershoot: number;
  meanRiseTimeMs: number;
  meanSettlingTimeMs: number;
  meanLatencyMs: number;
  meanTrackingErrorRMS?: number;
}

/** A single component contributing to the tune quality score */
export interface TuneQualityComponent {
  label: string;
  score: number;
  maxPoints: number;
  rawValue: number;
}

/** Overall tune quality score computed from filter + PID metrics */
export interface TuneQualityScore {
  overall: number;
  tier: 'excellent' | 'good' | 'fair' | 'poor';
  components: TuneQualityComponent[];
}

/** Compact PID analysis metrics for history storage */
export interface PIDMetricsSummary {
  /** Per-axis step response summaries */
  roll: AxisPIDSummary;
  pitch: AxisPIDSummary;
  yaw: AxisPIDSummary;
  /** Total steps detected across all axes */
  stepsDetected: number;
  /** PID values used during the flight */
  currentPIDs: PIDConfiguration;
  /** 1-2 sentence summary */
  summary: string;
  /** Data quality score summary */
  dataQuality?: { overall: number; tier: string };
}

/** Per-axis transfer function metrics summary for history storage */
export interface AxisTransferFunctionSummary {
  bandwidthHz: number;
  phaseMarginDeg: number;
  gainMarginDb: number;
  overshootPercent: number;
  settlingTimeMs: number;
  riseTimeMs: number;
}

/** Compact transfer function metrics for history storage */
export interface TransferFunctionMetricsSummary {
  roll: AxisTransferFunctionSummary;
  pitch: AxisTransferFunctionSummary;
  yaw: AxisTransferFunctionSummary;
  /** Data quality score summary */
  dataQuality?: { overall: number; tier: string };
}

/** A completed tuning session archived for history/comparison */
export interface CompletedTuningRecord {
  /** Unique record ID */
  id: string;
  /** Profile this record belongs to */
  profileId: string;
  /** When the tuning session was started (ISO string) */
  startedAt: string;
  /** When the tuning session was completed (ISO string) */
  completedAt: string;

  /** Guided (2-flight) or Quick (1-flight). Defaults to 'guided' for old records. */
  tuningType?: TuningType;

  /** Snapshot IDs (nullable — may not exist if skipped or deleted) */
  baselineSnapshotId: string | null;
  postFilterSnapshotId: string | null;
  postTuningSnapshotId: string | null;

  /** Log IDs (nullable) */
  filterLogId: string | null;
  pidLogId: string | null;
  quickLogId: string | null;
  verificationLogId: string | null;

  /** Applied changes */
  appliedFilterChanges: AppliedChange[];
  appliedPIDChanges: AppliedChange[];
  appliedFeedforwardChanges: AppliedChange[];

  /** Analysis metrics (nullable — may not have been computed) */
  filterMetrics: FilterMetricsSummary | null;
  pidMetrics: PIDMetricsSummary | null;
  verificationMetrics: FilterMetricsSummary | null;

  /** Transfer function metrics from Wiener deconvolution (Quick Tune only) */
  transferFunctionMetrics: TransferFunctionMetricsSummary | null;
}
