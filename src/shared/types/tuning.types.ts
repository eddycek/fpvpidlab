/**
 * Types for the stateful iterative tuning workflow.
 *
 * Three tuning modes:
 * - Filter Tune: hover + throttle sweeps → filter analysis → apply → optional verification
 * - PID Tune: stick snaps → PID analysis → apply → optional verification
 * - Flash Tune: any flight → combined filter + PID via Wiener deconvolution → apply
 *
 * A persistent TuningSession tracks progress across connect/disconnect cycles.
 */

import type {
  FilterMetricsSummary,
  PIDMetricsSummary,
  RecommendationTrace,
  TransferFunctionMetricsSummary,
} from './tuning-history.types';
import type { ConvergenceResult, VerificationSimilarity } from './analysis.types';
import type { RatesConfiguration } from './pid.types';

/** Which analysis mode the wizard is operating in */
export type TuningMode = 'filter' | 'pid' | 'full' | 'flash';

/** Extended mode for flight guide (includes verification flights) */
export type FlightGuideMode =
  | TuningMode
  | 'filter_verification'
  | 'pid_verification'
  | 'verification'
  | 'flash_verification';

/** Tuning session type: filter-only, pid-only, or flash (combined via Wiener deconvolution) */
export type TuningType = 'filter' | 'pid' | 'flash';

/** Phases of the tuning session state machine */
export type TuningPhase =
  // Filter Tune phases
  | 'filter_flight_pending' // Waiting for user to fly filter test flight
  | 'filter_log_ready' // FC reconnected, ready to download filter log
  | 'filter_analysis' // Filter log downloaded, analyzing
  | 'filter_applied' // Filters applied, ready for verification or PID flight
  | 'filter_verification_pending' // Filter Tune: waiting for verification throttle sweep flight
  // PID Tune phases
  | 'pid_flight_pending' // Waiting for user to fly PID test flight
  | 'pid_log_ready' // FC reconnected, ready to download PID log
  | 'pid_analysis' // PID log downloaded, analyzing
  | 'pid_applied' // PIDs applied, ready for verification
  | 'pid_verification_pending' // PID Tune: waiting for verification stick snap flight
  // Flash Tune phases
  | 'flash_flight_pending' // Flash Tune: waiting for user to fly any flight
  | 'flash_log_ready' // Flash Tune: FC reconnected, ready to download log
  | 'flash_analysis' // Flash Tune: log downloaded, analyzing (filter + Wiener in parallel)
  | 'flash_applied' // Flash Tune: all changes applied, ready for verification
  | 'flash_verification_pending' // Flash Tune: waiting for verification flight
  // Shared phases
  | 'completed'; // Tuning done

/** A single setting change applied during tuning */
export interface AppliedChange {
  setting: string;
  previousValue: number;
  newValue: number;
}

/** Persistent tuning session tracking progress across flights */
export interface TuningSession {
  /** Profile this session belongs to */
  profileId: string;

  /** Current phase of the tuning process */
  phase: TuningPhase;

  /** Filter, PID, or Flash tuning */
  tuningType: TuningType;

  /** When the session was started (ISO string) */
  startedAt: string;

  /** When the phase last changed (ISO string) */
  updatedAt: string;

  /** Snapshot ID created before tuning started (safety backup) */
  baselineSnapshotId?: string;

  /** Log ID of the filter test flight (after download) */
  filterLogId?: string;

  /** Summary of applied filter changes (for reference in PID phase) */
  appliedFilterChanges?: AppliedChange[];

  /** Log ID of the PID test flight (after download) */
  pidLogId?: string;

  /** Log ID of the quick tune flight (single flight, after download) */
  quickLogId?: string;

  /** Summary of applied PID changes */
  appliedPIDChanges?: AppliedChange[];

  /** Summary of applied feedforward changes */
  appliedFeedforwardChanges?: AppliedChange[];

  /** Log ID of the verification flight (after download) */
  verificationLogId?: string;

  /** Snapshot ID created after filter apply (on reconnect) */
  postFilterSnapshotId?: string;

  /** Snapshot ID created after PID apply (on reconnect) */
  postTuningSnapshotId?: string;

  /** Compact filter analysis metrics (saved for history) */
  filterMetrics?: FilterMetricsSummary;

  /** Compact PID analysis metrics (saved for history) */
  pidMetrics?: PIDMetricsSummary;

  /** Compact verification flight filter metrics — Filter Tune spectrogram comparison */
  verificationMetrics?: FilterMetricsSummary;

  /** Compact verification flight PID metrics — PID Tune step response comparison */
  verificationPidMetrics?: PIDMetricsSummary;

  /** Compact transfer function metrics from Wiener deconvolution (Quick Tune only) */
  transferFunctionMetrics?: TransferFunctionMetricsSummary;

  /** Compact verification TF metrics (Flash Tune only — for before/after PID comparison) */
  verificationTransferFunctionMetrics?: TransferFunctionMetricsSummary;

  /** True when user skipped erase (e.g. formatted SD card manually) — persists across restart */
  eraseSkipped?: boolean;

  /** True after erase completed (especially for SD card MSC erase). Cleared on next phase transition. */
  eraseCompleted?: boolean;

  /** Tuning session number — set at creation, used for pre/post snapshot pairing */
  tuningSessionNumber?: number;

  /** BF PID profile used in this tuning session (0-based). Undefined = FC default at session start. */
  bfPidProfileIndex?: number;

  /** Per-recommendation metadata for telemetry tracking */
  recommendationTraces?: RecommendationTrace[];

  /** Whether applied settings were verified on FC after reconnect */
  applyVerified?: boolean;

  /** Settings that didn't match after read-back verification */
  applyMismatches?: string[];

  /** Expected config values at time of apply (for diagnostic bundle) */
  applyExpected?: Record<string, number>;

  /** Actual config values read back from FC after apply (for diagnostic bundle) */
  applyActual?: Record<string, number>;

  /** Sanity check failed (e.g. P/I/D=0, filter bypassed) */
  applySuspicious?: boolean;

  /** Auto-generated diagnostic report ID (set when apply verification fails) */
  autoReportId?: string;

  /** RC rates configuration at time of tuning (for telemetry) */
  ratesConfig?: RatesConfiguration;

  /** Convergence detection result (set after verification flight analysis) */
  convergence?: ConvergenceResult;

  /** Verification flight similarity score (set after verification flight analysis) */
  verificationSimilarity?: VerificationSimilarity;

  /** Number of recent tuning iterations of this type (within lookback window) */
  iterationCount?: number;
}
