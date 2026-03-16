/**
 * Diagnostic Report Types
 *
 * Structured diagnostic data for investigating tuning issues.
 * Submitted by users via "Report Issue" button (Pro/Tester only).
 */

import type { TelemetryEvent } from './telemetry.types';

/** Compact peak info for diagnostic bundle */
export interface DiagnosticPeak {
  freq: number;
  magnitude: number;
  source: string;
}

/** Per-axis numeric values */
export interface AxisValues {
  roll: number;
  pitch: number;
  yaw: number;
}

/** Filter analysis summary in diagnostic bundle */
export interface DiagnosticFilterAnalysis {
  noiseLevel: string;
  axisNoise: AxisValues;
  peaks: DiagnosticPeak[];
  spectrum: number[];
  throttleSpectrogram?: Record<string, unknown>;
  groupDelay?: { gyroTotalMs: number; dtermTotalMs: number };
}

/** PID analysis summary in diagnostic bundle */
export interface DiagnosticPIDAnalysis {
  stepsDetected: number;
  axisMetrics: Record<
    string,
    {
      overshoot: number;
      riseTime: number;
      settling: number;
      latency: number;
    }
  >;
  dTermEffectiveness?: Record<string, number>;
  propWash?: { meanSeverity: number; worstAxis: string };
}

/** Transfer function analysis summary */
export interface DiagnosticTransferFunction {
  bandwidth: AxisValues;
  phaseMargin: AxisValues;
  dcGain: AxisValues;
}

/** Recommendation as captured in diagnostic bundle */
export interface DiagnosticRecommendation {
  ruleId: string;
  setting: string;
  currentValue: number;
  recommendedValue: number;
  confidence: string;
  explanation: string;
}

/** Verification summary */
export interface DiagnosticVerification {
  noiseFloorDelta?: AxisValues;
  overshootDelta?: AxisValues;
  overallImprovement: number;
}

/** Full diagnostic bundle sent to the server */
export interface DiagnosticBundle {
  reportId: string;
  installationId: string;
  sessionId?: string;
  timestamp: string;
  appVersion: string;

  // User input
  userEmail?: string;
  userNote?: string;

  // Context
  mode: string;
  droneSize?: string;
  flightStyle?: string;
  bfVersion?: string;
  boardTarget?: string;

  // Data quality
  dataQuality: {
    overall: number;
    tier: string;
    warnings: string[];
  };

  // Analysis results
  filterAnalysis?: DiagnosticFilterAnalysis;
  pidAnalysis?: DiagnosticPIDAnalysis;
  transferFunction?: DiagnosticTransferFunction;

  // Recommendations
  recommendations: DiagnosticRecommendation[];

  // FC configuration
  cliDiffBefore?: string;
  cliDiffAfter?: string;

  // Verification
  verification?: DiagnosticVerification;

  // Related telemetry events
  events: TelemetryEvent[];
}

/** Input from renderer to submit a diagnostic report */
export interface DiagnosticReportInput {
  /** Tuning history record ID to report */
  recordId: string;
  /** Optional user email for follow-up */
  userEmail?: string;
  /** Optional description of the issue */
  userNote?: string;
}

/** Result returned after submitting a report */
export interface DiagnosticReportResult {
  reportId: string;
  submitted: boolean;
}
