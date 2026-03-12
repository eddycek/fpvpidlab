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
  TransferFunctionMetricsSummary,
} from './tuning-history.types';

/** Which analysis mode the wizard is operating in */
export type TuningMode = 'filter' | 'pid' | 'full' | 'quick';

/** Extended mode for flight guide (includes verification flights) */
export type FlightGuideMode =
  | TuningMode
  | 'filter_verification'
  | 'pid_verification'
  | 'verification'
  | 'flash_verification';

/** Tuning session type: filter-only, pid-only, or flash (combined via Wiener deconvolution) */
export type TuningType = 'filter' | 'pid' | 'quick';

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
  | 'quick_flight_pending' // Quick Tune: waiting for user to fly any flight
  | 'quick_log_ready' // Quick Tune: FC reconnected, ready to download log
  | 'quick_analysis' // Quick Tune: log downloaded, analyzing (filter + Wiener in parallel)
  | 'quick_applied' // Quick Tune: all changes applied, ready for verification
  // Shared phases
  | 'verification_pending' // DEPRECATED — only for legacy sessions
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

  /** Filter, PID, or Flash (quick) tuning. Defaults to 'filter' for backward compat. */
  tuningType?: TuningType;

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

  /** BF PID profile used in this tuning session (0-based). Undefined = FC default at session start. */
  bfPidProfileIndex?: number;
}
