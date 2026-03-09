/**
 * Types for the stateful iterative tuning workflow (Deep Tune + Flash Tune).
 *
 * The tuning process is split into two flights:
 * 1. Filter flight (hover + throttle sweeps) → filter analysis → apply
 * 2. PID flight (stick snaps) → PID analysis → apply
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

/** Extended mode for flight guide (includes verification hover) */
export type FlightGuideMode = TuningMode | 'verification' | 'flash_verification';

/** Whether this is a guided (2-flight) or quick (1-flight) tuning session */
export type TuningType = 'guided' | 'quick';

/** Phases of the tuning session state machine */
export type TuningPhase =
  | 'filter_flight_pending' // Waiting for user to fly filter test flight
  | 'filter_log_ready' // FC reconnected, ready to download filter log
  | 'filter_analysis' // Filter log downloaded, analyzing
  | 'filter_applied' // Filters applied, flash erased, ready for PID flight
  | 'pid_flight_pending' // Waiting for user to fly PID test flight
  | 'pid_log_ready' // FC reconnected, ready to download PID log
  | 'pid_analysis' // PID log downloaded, analyzing
  | 'pid_applied' // PIDs applied, flash erased, ready for verification
  | 'quick_flight_pending' // Quick Tune: waiting for user to fly any flight
  | 'quick_log_ready' // Quick Tune: FC reconnected, ready to download log
  | 'quick_analysis' // Quick Tune: log downloaded, analyzing (filter + Wiener in parallel)
  | 'quick_applied' // Quick Tune: all changes applied, ready for verification
  | 'verification_pending' // Waiting for verification flight
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

  /** Guided (2-flight) or Quick (1-flight) tuning. Defaults to 'guided' for backward compat. */
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

  /** Compact verification flight metrics (saved for history) */
  verificationMetrics?: FilterMetricsSummary;

  /** Compact transfer function metrics from Wiener deconvolution (Quick Tune only) */
  transferFunctionMetrics?: TransferFunctionMetricsSummary;

  /** Compact verification TF metrics (Flash Tune only — for before/after PID comparison) */
  verificationTransferFunctionMetrics?: TransferFunctionMetricsSummary;

  /** True when user skipped erase (e.g. formatted SD card manually) — persists across restart */
  eraseSkipped?: boolean;

  /** True after erase completed (especially for SD card MSC erase). Cleared on next phase transition. */
  eraseCompleted?: boolean;
}
