/**
 * Rule-based PID recommendation engine.
 *
 * Analyzes step response profiles for each axis and produces
 * beginner-friendly PID tuning recommendations with safety bounds.
 */
import type { PIDConfiguration } from '@shared/types/pid.types';
import type {
  AxisStepProfile,
  FeedforwardContext,
  PIDRecommendation,
} from '@shared/types/analysis.types';
import type { FlightStyle } from '@shared/types/profile.types';
import type { TransferFunctionMetrics } from './TransferFunctionEstimator';
import {
  PID_STYLE_THRESHOLDS,
  P_GAIN_MIN,
  P_GAIN_MAX,
  D_GAIN_MIN,
  D_GAIN_MAX,
  I_GAIN_MIN,
  I_GAIN_MAX,
  DAMPING_RATIO_MIN,
  DAMPING_RATIO_MAX,
  DAMPING_RATIO_DEADZONE,
} from './constants';

/** Per-axis transfer function metrics for frequency-domain PID recommendations */
export interface TransferFunctionContext {
  roll?: TransferFunctionMetrics;
  pitch?: TransferFunctionMetrics;
  yaw?: TransferFunctionMetrics;
}

const AXIS_NAMES = ['roll', 'pitch', 'yaw'] as const;

/**
 * Generate PID recommendations from step response profiles.
 *
 * When `flightPIDs` is provided (extracted from the BBL header), targets are
 * anchored to the PIDs that were active during the recorded flight. This makes
 * recommendations convergent: applying the target and re-analyzing the same
 * session yields no further changes because `target == current`.
 *
 * Fallback: when `flightPIDs` is undefined (older firmware without PID headers),
 * targets are anchored to `currentPIDs` (non-convergent but functional).
 */
export function recommendPID(
  roll: AxisStepProfile,
  pitch: AxisStepProfile,
  yaw: AxisStepProfile,
  currentPIDs: PIDConfiguration,
  flightPIDs?: PIDConfiguration,
  feedforwardContext?: FeedforwardContext,
  flightStyle: FlightStyle = 'balanced',
  tfMetrics?: TransferFunctionContext
): PIDRecommendation[] {
  const recommendations: PIDRecommendation[] = [];
  const profiles = [roll, pitch, yaw] as const;
  const thresholds = PID_STYLE_THRESHOLDS[flightStyle];

  for (let axis = 0; axis < 3; axis++) {
    const profile = profiles[axis];
    const axisName = AXIS_NAMES[axis];
    const pids = currentPIDs[axisName];
    // Anchor to flight PIDs (from BBL header) when available, else fall back to current
    const base = flightPIDs ? flightPIDs[axisName] : pids;
    const axisTF = tfMetrics?.[axisName];

    // If we have transfer function metrics and no step data, use frequency-domain rules
    if (profile.responses.length === 0 && axisTF) {
      generateFrequencyDomainRecs(axisTF, axisName, pids, base, thresholds, recommendations);
      continue;
    }

    // Skip axes with no step data (and no TF metrics)
    if (profile.responses.length === 0) continue;

    // Check if overshoot on this axis is FF-dominated (majority of steps)
    const ffClassified = profile.responses.filter((r) => r.ffDominated !== undefined);
    const ffDominatedCount = ffClassified.filter((r) => r.ffDominated === true).length;
    const axisFFDominated = ffClassified.length > 0 && ffDominatedCount > ffClassified.length / 2;

    // Yaw is analyzed with relaxed thresholds
    const isYaw = axis === 2;
    const overshootThreshold = isYaw ? thresholds.overshootMax * 1.5 : thresholds.overshootMax;
    const moderateOvershoot = isYaw ? thresholds.overshootMax : thresholds.moderateOvershoot;
    const sluggishRiseMs = isYaw ? thresholds.sluggishRise * 1.5 : thresholds.sluggishRise;

    // FF-dominated overshoot: skip P/D rules, recommend FF adjustment instead
    if (axisFFDominated && profile.meanOvershoot > moderateOvershoot) {
      const boost = feedforwardContext?.boost;
      // Only emit feedforward_boost recommendation once (not per-axis)
      const existingFFRec = recommendations.find((r) => r.setting === 'feedforward_boost');
      if (!existingFFRec && boost !== undefined && boost > 0) {
        const targetBoost = Math.max(0, boost - 5);
        recommendations.push({
          setting: 'feedforward_boost',
          currentValue: boost,
          recommendedValue: targetBoost,
          reason: `Overshoot on ${axisName} appears to be caused by feedforward, not P/D imbalance (${Math.round(profile.meanOvershoot)}%). Reducing feedforward_boost will tame the overshoot without losing PID responsiveness.`,
          impact: 'stability',
          confidence: 'medium',
        });
      }
      // Skip P/D overshoot rules for this axis (continue to other rules)
      // Still check ringing and settling which are PID-related
    } else if (profile.meanOvershoot > overshootThreshold) {
      // Rule 1: Severe overshoot → D-first strategy (non-FF case)
      // Scale D step with overshoot severity for faster convergence
      const severity = profile.meanOvershoot / overshootThreshold;
      const dStep = severity > 4 ? 15 : severity > 2 ? 10 : 5;
      const targetD = clamp(base.D + dStep, D_GAIN_MIN, D_GAIN_MAX);
      if (targetD !== pids.D) {
        recommendations.push({
          setting: `pid_${axisName}_d`,
          currentValue: pids.D,
          recommendedValue: targetD,
          reason: `Significant overshoot detected on ${axisName} (${Math.round(profile.meanOvershoot)}%). Increasing D-term dampens the bounce-back for a smoother, more controlled feel.`,
          impact: 'both',
          confidence: 'high',
        });
      }
      // Reduce P when overshoot is extreme (>2x threshold) or D is already high
      if (severity > 2 || base.D >= D_GAIN_MAX * 0.6) {
        const pStep = severity > 4 ? 10 : 5;
        const targetP = clamp(base.P - pStep, P_GAIN_MIN, P_GAIN_MAX);
        if (targetP !== pids.P) {
          recommendations.push({
            setting: `pid_${axisName}_p`,
            currentValue: pids.P,
            recommendedValue: targetP,
            reason: `${severity > 4 ? 'Extreme' : 'Significant'} overshoot on ${axisName} (${Math.round(profile.meanOvershoot)}%). Reducing P-term helps prevent the quad from overshooting its target.`,
            impact: 'both',
            confidence: 'high',
          });
        }
      }
    } else if (profile.meanOvershoot > moderateOvershoot) {
      // Moderate overshoot (15-25%): increase D only
      const targetD = clamp(base.D + 5, D_GAIN_MIN, D_GAIN_MAX);
      if (targetD !== pids.D) {
        recommendations.push({
          setting: `pid_${axisName}_d`,
          currentValue: pids.D,
          recommendedValue: targetD,
          reason: `Your quad overshoots on ${axisName} stick inputs (${Math.round(profile.meanOvershoot)}%). Increasing D-term will dampen the response.`,
          impact: 'stability',
          confidence: 'medium',
        });
      }
    }

    // Rule 2: Sluggish response (low overshoot + slow rise) → increase P by 5 (FPVSIM guidance)
    if (
      profile.meanOvershoot < thresholds.overshootIdeal &&
      profile.meanRiseTimeMs > sluggishRiseMs
    ) {
      const targetP = clamp(base.P + 5, P_GAIN_MIN, P_GAIN_MAX);
      if (targetP !== pids.P) {
        recommendations.push({
          setting: `pid_${axisName}_p`,
          currentValue: pids.P,
          recommendedValue: targetP,
          reason: `Response is sluggish on ${axisName} (${Math.round(profile.meanRiseTimeMs)}ms rise time). A P increase will make your quad feel more locked in.`,
          impact: 'response',
          confidence: 'medium',
        });
      }
    }

    // Rule 3: Excessive ringing → increase D (BF: any visible bounce-back should be addressed)
    const maxRinging = Math.max(...profile.responses.map((r) => r.ringingCount));
    if (maxRinging > thresholds.ringingMax) {
      const targetD = clamp(base.D + 5, D_GAIN_MIN, D_GAIN_MAX);
      if (targetD !== pids.D) {
        // Don't duplicate if we already recommended D increase for overshoot
        const existingDRec = recommendations.find((r) => r.setting === `pid_${axisName}_d`);
        if (!existingDRec) {
          recommendations.push({
            setting: `pid_${axisName}_d`,
            currentValue: pids.D,
            recommendedValue: targetD,
            reason: `Oscillation detected on ${axisName} after stick moves (${maxRinging} cycles). More D-term will calm the wobble.`,
            impact: 'stability',
            confidence: 'medium',
          });
        }
      }
    }

    // Rule 4: Slow settling → might need more D or less I
    if (
      profile.meanSettlingTimeMs > thresholds.settlingMax &&
      profile.meanOvershoot < moderateOvershoot
    ) {
      // Only if overshoot isn't the problem (settling from other causes)
      const existingDRec = recommendations.find((r) => r.setting === `pid_${axisName}_d`);
      if (!existingDRec) {
        const targetD = clamp(base.D + 5, D_GAIN_MIN, D_GAIN_MAX);
        if (targetD !== pids.D) {
          recommendations.push({
            setting: `pid_${axisName}_d`,
            currentValue: pids.D,
            recommendedValue: targetD,
            reason: `${axisName.charAt(0).toUpperCase() + axisName.slice(1)} takes ${Math.round(profile.meanSettlingTimeMs)}ms to settle. A slight D increase will help it lock in faster.`,
            impact: 'stability',
            confidence: 'low',
          });
        }
      }
    }

    // Rule 5: I-term — steady-state tracking error
    const ssError = profile.meanSteadyStateError;
    if (ssError > thresholds.steadyStateErrorMax) {
      // High hold-phase error → I-term is too low (quad drifts from target)
      const iStep = ssError > thresholds.steadyStateErrorMax * 2 ? 10 : 5;
      const targetI = clamp(base.I + iStep, I_GAIN_MIN, I_GAIN_MAX);
      if (targetI !== pids.I) {
        recommendations.push({
          setting: `pid_${axisName}_i`,
          currentValue: pids.I,
          recommendedValue: targetI,
          reason: `${axisName.charAt(0).toUpperCase() + axisName.slice(1)} drifts from target during holds (${ssError.toFixed(1)}% error). Increasing I-term improves tracking accuracy and wind resistance.`,
          impact: 'stability',
          confidence: ssError > thresholds.steadyStateErrorMax * 2 ? 'high' : 'medium',
        });
      }
    } else if (
      ssError < thresholds.steadyStateErrorLow &&
      profile.meanSettlingTimeMs > thresholds.settlingMax &&
      profile.meanOvershoot > moderateOvershoot
    ) {
      // Low error but slow settling + overshoot → I may be causing slow oscillation
      const targetI = clamp(base.I - 5, I_GAIN_MIN, I_GAIN_MAX);
      if (targetI !== pids.I) {
        recommendations.push({
          setting: `pid_${axisName}_i`,
          currentValue: pids.I,
          recommendedValue: targetI,
          reason: `${axisName.charAt(0).toUpperCase() + axisName.slice(1)} has slow settling (${Math.round(profile.meanSettlingTimeMs)}ms) with overshoot. Reducing I-term can help the quad settle faster.`,
          impact: 'stability',
          confidence: 'low',
        });
      }
    }
  }

  // Post-process: validate D/P damping ratio for coordinated P/D recommendations.
  // Only applies to roll and pitch (yaw often has D=0).
  validateDampingRatio(recommendations, currentPIDs);

  return recommendations;
}

/**
 * Post-process recommendations to ensure P/D changes maintain a healthy damping
 * ratio (D/P). Catches three cases:
 *
 * 1. Underdamped (D/P too low) with no D recommendation → add D increase
 * 2. Overdamped (D/P too high) after D increase without P adjustment → add P
 * 3. Overdamped (D/P too high) with no recommendations → reduce D
 */
function validateDampingRatio(
  recommendations: PIDRecommendation[],
  currentPIDs: PIDConfiguration
): void {
  for (const axisName of ['roll', 'pitch'] as const) {
    const pids = currentPIDs[axisName];

    const pRec = recommendations.find((r) => r.setting === `pid_${axisName}_p`);
    const dRec = recommendations.find((r) => r.setting === `pid_${axisName}_d`);

    // Compute resulting P and D after applying any recommendations
    const resultP = pRec ? pRec.recommendedValue : pids.P;
    const resultD = dRec ? dRec.recommendedValue : pids.D;

    // Skip if P or D is zero (some setups run D=0)
    if (resultP <= 0 || resultD <= 0) continue;

    const ratio = resultD / resultP;

    if (ratio < DAMPING_RATIO_MIN && !dRec) {
      // Underdamped — need more D relative to P
      const targetD = clamp(Math.round(resultP * DAMPING_RATIO_MIN), D_GAIN_MIN, D_GAIN_MAX);
      if (Math.abs(targetD - pids.D) >= DAMPING_RATIO_DEADZONE) {
        recommendations.push({
          setting: `pid_${axisName}_d`,
          currentValue: pids.D,
          recommendedValue: targetD,
          reason: `D/P ratio on ${axisName} is low (${ratio.toFixed(2)}). Increasing D improves dampening and reduces bounce-back without sacrificing response.`,
          impact: 'stability',
          confidence: 'medium',
        });
      }
    } else if (ratio > DAMPING_RATIO_MAX && dRec && !pRec) {
      // D was increased by a rule but P wasn't adjusted — ratio pushed too high
      const targetP = clamp(Math.round(resultD / DAMPING_RATIO_MAX), P_GAIN_MIN, P_GAIN_MAX);
      if (targetP > pids.P && Math.abs(targetP - pids.P) >= DAMPING_RATIO_DEADZONE) {
        recommendations.push({
          setting: `pid_${axisName}_p`,
          currentValue: pids.P,
          recommendedValue: targetP,
          reason: `Adding a small P increase on ${axisName} to maintain healthy D/P balance (${ratio.toFixed(2)}) after the D-term adjustment.`,
          impact: 'response',
          confidence: 'low',
        });
      }
    } else if (ratio > DAMPING_RATIO_MAX && !dRec && !pRec) {
      // No existing recommendations but ratio is already too high — reduce D
      const targetD = clamp(Math.round(resultP * DAMPING_RATIO_MAX), D_GAIN_MIN, D_GAIN_MAX);
      if (Math.abs(targetD - pids.D) >= DAMPING_RATIO_DEADZONE) {
        recommendations.push({
          setting: `pid_${axisName}_d`,
          currentValue: pids.D,
          recommendedValue: targetD,
          reason: `D/P ratio on ${axisName} is high (${ratio.toFixed(2)}). Reducing D helps with motor temperature and noise without losing stability.`,
          impact: 'both',
          confidence: 'medium',
        });
      }
    }
  }
}

/**
 * Generate a beginner-friendly summary of the PID analysis.
 */
const STYLE_CONTEXT: Record<FlightStyle, string> = {
  smooth: 'for smooth flying preferences',
  balanced: '',
  aggressive: 'optimized for racing response',
};

export function generatePIDSummary(
  roll: AxisStepProfile,
  pitch: AxisStepProfile,
  yaw: AxisStepProfile,
  recommendations: PIDRecommendation[],
  flightStyle: FlightStyle = 'balanced'
): string {
  const totalSteps = roll.responses.length + pitch.responses.length + yaw.responses.length;
  const styleContext = STYLE_CONTEXT[flightStyle];
  const styleNote = styleContext ? ` ${styleContext}` : '';

  if (totalSteps === 0) {
    return 'No step inputs detected in this flight. Try flying with quick, decisive stick movements for better PID analysis.';
  }

  if (recommendations.length === 0) {
    return `Analyzed ${totalSteps} stick inputs${styleNote}. Your PID tune looks good — response is quick with minimal overshoot. No changes recommended.`;
  }

  const hasOvershoot = recommendations.some(
    (r) => r.reason.includes('overshoot') || r.reason.includes('Overshoot')
  );
  const hasSluggish = recommendations.some(
    (r) => r.reason.includes('sluggish') || r.reason.includes('Sluggish')
  );
  const hasRinging = recommendations.some(
    (r) => r.reason.includes('scillation') || r.reason.includes('wobble')
  );
  const hasTracking = recommendations.some(
    (r) => r.reason.includes('drifts') || r.reason.includes('I-term')
  );

  const issues: string[] = [];
  if (hasOvershoot) issues.push('overshoot');
  if (hasSluggish) issues.push('sluggish response');
  if (hasRinging) issues.push('oscillation');
  if (hasTracking) issues.push('tracking drift');

  const issueText = issues.length > 0 ? issues.join(' and ') : 'room for improvement';

  return `Analyzed ${totalSteps} stick inputs${styleNote} and found ${issueText}. ${recommendations.length} adjustment${recommendations.length === 1 ? '' : 's'} recommended — apply them for a tighter, more locked-in feel.`;
}

/**
 * Extract flight-time PIDs from a BBL log header.
 * Betaflight logs PIDs as "rollPID" → "P,I,D" (e.g. "45,80,30").
 * Returns undefined if any axis PID is missing from the header.
 */
export function extractFlightPIDs(rawHeaders: Map<string, string>): PIDConfiguration | undefined {
  const rollPID = rawHeaders.get('rollPID');
  const pitchPID = rawHeaders.get('pitchPID');
  const yawPID = rawHeaders.get('yawPID');

  if (!rollPID || !pitchPID || !yawPID) return undefined;

  const parse = (s: string): { P: number; I: number; D: number } => {
    const parts = s.split(',').map(Number);
    return { P: parts[0] || 0, I: parts[1] || 0, D: parts[2] || 0 };
  };

  return { roll: parse(rollPID), pitch: parse(pitchPID), yaw: parse(yawPID) };
}

/**
 * Extract feedforward context from BBL raw headers.
 *
 * BF 4.3+ logs feedforward parameters in the blackbox header.
 * FF is considered "active" when boost > 0 (BF default is 15).
 * Missing headers are treated as FF inactive (graceful fallback for older FW).
 */
export function extractFeedforwardContext(rawHeaders: Map<string, string>): FeedforwardContext {
  const boost = parseIntOr(rawHeaders.get('feedforward_boost'));
  const maxRateLimit = parseIntOr(rawHeaders.get('feedforward_max_rate_limit'));

  const active = (boost ?? 0) > 0;

  return {
    active,
    ...(boost !== undefined ? { boost } : {}),
    ...(maxRateLimit !== undefined ? { maxRateLimit } : {}),
  };
}

/** Parse an integer from a string, returning undefined if missing or NaN. */
function parseIntOr(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

// ---- Frequency-domain recommendation thresholds ----

/** Minimum bandwidth (Hz) below which we consider P too low */
const BANDWIDTH_LOW_HZ = 40;

/** Phase margin threshold below which we consider the system under-damped */
const PHASE_MARGIN_LOW_DEG = 45;

/** Phase margin threshold below which we consider the system critically under-damped */
const PHASE_MARGIN_CRITICAL_DEG = 30;

/**
 * Generate PID recommendations from transfer function metrics (frequency domain).
 *
 * Used when Wiener deconvolution produces TF metrics but no step responses exist.
 * Bandwidth indicates responsiveness (P), phase margin indicates damping (D).
 */
function generateFrequencyDomainRecs(
  tf: TransferFunctionMetrics,
  axisName: string,
  pids: { P: number; I: number; D: number },
  base: { P: number; I: number; D: number },
  thresholds: (typeof PID_STYLE_THRESHOLDS)[FlightStyle],
  recommendations: PIDRecommendation[]
): void {
  const isYaw = axisName === 'yaw';
  const overshootThreshold = isYaw ? thresholds.overshootMax * 1.5 : thresholds.overshootMax;
  const moderateOvershoot = isYaw ? thresholds.overshootMax : thresholds.moderateOvershoot;
  const bandwidthLow = isYaw ? BANDWIDTH_LOW_HZ * 0.7 : BANDWIDTH_LOW_HZ;

  // Rule TF-1: Low phase margin → increase D (under-damped system)
  if (tf.phaseMarginDeg < PHASE_MARGIN_LOW_DEG && tf.phaseMarginDeg > 0) {
    const dStep = tf.phaseMarginDeg < PHASE_MARGIN_CRITICAL_DEG ? 10 : 5;
    const targetD = clamp(base.D + dStep, D_GAIN_MIN, D_GAIN_MAX);
    if (targetD !== pids.D) {
      recommendations.push({
        setting: `pid_${axisName}_d`,
        currentValue: pids.D,
        recommendedValue: targetD,
        reason: `Transfer function shows low phase margin on ${axisName} (${Math.round(tf.phaseMarginDeg)}°). Increasing D-term adds damping to prevent oscillation.`,
        impact: 'stability',
        confidence: 'medium',
      });
    }
  }

  // Rule TF-2: Overshoot from synthetic step response
  if (tf.overshootPercent > overshootThreshold) {
    const severity = tf.overshootPercent / overshootThreshold;
    const dStep = severity > 4 ? 15 : severity > 2 ? 10 : 5;
    const existingDRec = recommendations.find((r) => r.setting === `pid_${axisName}_d`);
    if (!existingDRec) {
      const targetD = clamp(base.D + dStep, D_GAIN_MIN, D_GAIN_MAX);
      if (targetD !== pids.D) {
        recommendations.push({
          setting: `pid_${axisName}_d`,
          currentValue: pids.D,
          recommendedValue: targetD,
          reason: `Synthetic step response shows ${Math.round(tf.overshootPercent)}% overshoot on ${axisName}. Increasing D-term will dampen the response.`,
          impact: 'both',
          confidence: 'medium',
        });
      }
    }
    // Reduce P for extreme overshoot
    if (severity > 2 || base.D >= D_GAIN_MAX * 0.6) {
      const pStep = severity > 4 ? 10 : 5;
      const targetP = clamp(base.P - pStep, P_GAIN_MIN, P_GAIN_MAX);
      if (targetP !== pids.P) {
        recommendations.push({
          setting: `pid_${axisName}_p`,
          currentValue: pids.P,
          recommendedValue: targetP,
          reason: `High overshoot on ${axisName} (${Math.round(tf.overshootPercent)}%) from transfer function analysis. Reducing P-term helps prevent overshooting.`,
          impact: 'both',
          confidence: 'medium',
        });
      }
    }
  } else if (tf.overshootPercent > moderateOvershoot) {
    // Moderate overshoot
    const existingDRec = recommendations.find((r) => r.setting === `pid_${axisName}_d`);
    if (!existingDRec) {
      const targetD = clamp(base.D + 5, D_GAIN_MIN, D_GAIN_MAX);
      if (targetD !== pids.D) {
        recommendations.push({
          setting: `pid_${axisName}_d`,
          currentValue: pids.D,
          recommendedValue: targetD,
          reason: `Transfer function indicates moderate overshoot on ${axisName} (${Math.round(tf.overshootPercent)}%). A D-term increase will improve damping.`,
          impact: 'stability',
          confidence: 'medium',
        });
      }
    }
  }

  // Rule TF-3: Low bandwidth → increase P (sluggish system)
  if (
    tf.bandwidthHz < bandwidthLow &&
    tf.bandwidthHz > 0 &&
    tf.overshootPercent < thresholds.overshootIdeal
  ) {
    const targetP = clamp(base.P + 5, P_GAIN_MIN, P_GAIN_MAX);
    if (targetP !== pids.P) {
      const existingPRec = recommendations.find((r) => r.setting === `pid_${axisName}_p`);
      if (!existingPRec) {
        recommendations.push({
          setting: `pid_${axisName}_p`,
          currentValue: pids.P,
          recommendedValue: targetP,
          reason: `Low bandwidth on ${axisName} (${Math.round(tf.bandwidthHz)} Hz) suggests sluggish response. Increasing P-term will improve responsiveness.`,
          impact: 'response',
          confidence: 'medium',
        });
      }
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
