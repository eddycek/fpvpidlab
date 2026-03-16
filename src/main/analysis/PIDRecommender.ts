/**
 * Rule-based PID recommendation engine.
 *
 * Analyzes step response profiles for each axis and produces
 * beginner-friendly PID tuning recommendations with safety bounds.
 */
import type { PIDConfiguration } from '@shared/types/pid.types';
import type {
  AxisStepProfile,
  DTermEffectiveness,
  FeedforwardContext,
  PIDRecommendation,
  PropWashAnalysis,
} from '@shared/types/analysis.types';
import type { DroneSize, FlightStyle } from '@shared/types/profile.types';
import type { TransferFunctionMetrics } from './TransferFunctionEstimator';
import {
  PID_STYLE_THRESHOLDS,
  DAMPING_RATIO_MIN,
  DAMPING_RATIO_MAX,
  DAMPING_RATIO_DEADZONE,
  QUAD_SIZE_BOUNDS,
  DEFAULT_QUAD_SIZE_BOUNDS,
  BANDWIDTH_LOW_HZ_BY_STYLE,
  type QuadSizeBounds,
} from './constants';

/** Per-axis transfer function metrics for frequency-domain PID recommendations */
export interface TransferFunctionContext {
  roll?: TransferFunctionMetrics;
  pitch?: TransferFunctionMetrics;
  yaw?: TransferFunctionMetrics;
}

const AXIS_NAMES = ['roll', 'pitch', 'yaw'] as const;

/** Resolve PID bounds for a given drone size (falls back to 5" defaults) */
export function resolveBounds(droneSize?: DroneSize): QuadSizeBounds {
  if (!droneSize) return DEFAULT_QUAD_SIZE_BOUNDS;
  return QUAD_SIZE_BOUNDS[droneSize] ?? DEFAULT_QUAD_SIZE_BOUNDS;
}

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
  tfMetrics?: TransferFunctionContext,
  dTermEffectiveness?: DTermEffectiveness,
  propWash?: PropWashAnalysis,
  droneSize?: DroneSize,
  dMinContext?: DMinContext,
  tpaContext?: TPAContext
): PIDRecommendation[] {
  const recommendations: PIDRecommendation[] = [];
  const profiles = [roll, pitch, yaw] as const;
  const thresholds = PID_STYLE_THRESHOLDS[flightStyle];
  const bounds = resolveBounds(droneSize);

  for (let axis = 0; axis < 3; axis++) {
    const profile = profiles[axis];
    const axisName = AXIS_NAMES[axis];
    const pids = currentPIDs[axisName];
    // Anchor to flight PIDs (from BBL header) when available, else fall back to current
    const base = flightPIDs ? flightPIDs[axisName] : pids;
    const axisTF = tfMetrics?.[axisName];

    // If we have transfer function metrics and no step data, use frequency-domain rules
    if (profile.responses.length === 0 && axisTF) {
      generateFrequencyDomainRecs(
        axisTF,
        axisName,
        pids,
        base,
        thresholds,
        recommendations,
        bounds,
        flightStyle
      );
      continue;
    }

    // Skip axes with no step data (and no TF metrics)
    if (profile.responses.length === 0) continue;

    // Check if overshoot on this axis is FF-dominated (majority of steps)
    const ffClassified = profile.responses.filter((r) => r.ffDominated !== undefined);
    const ffDominatedCount = ffClassified.filter((r) => r.ffDominated === true).length;
    const axisFFDominated = ffClassified.length > 0 && ffDominatedCount > ffClassified.length / 2;

    // Compute mean FF energy ratio for this axis (used to modulate P recommendations)
    const meanFFEnergyRatio = profile.meanFFEnergyRatio;

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
        const targetBoost = Math.max(0, boost - 3);
        recommendations.push({
          setting: 'feedforward_boost',
          currentValue: boost,
          recommendedValue: targetBoost,
          reason: `Overshoot on ${axisName} appears to be caused by feedforward, not P/D imbalance (${Math.round(profile.meanOvershoot)}%). Reducing feedforward_boost will tame the overshoot without losing PID responsiveness.`,
          impact: 'stability',
          confidence: 'medium',
          ruleId: 'P-FF-BOOST',
        });
      }
      // Skip P/D overshoot rules for this axis (continue to other rules)
      // Still check ringing and settling which are PID-related
    } else if (profile.meanOvershoot > overshootThreshold) {
      // Rule 1: Severe overshoot → D-first strategy (non-FF case)
      // Scale D step with overshoot severity for faster convergence
      const severity = profile.meanOvershoot / overshootThreshold;
      const dStep = severity > 4 ? 15 : severity > 2 ? 10 : 5;
      const targetD = clamp(base.D + dStep, bounds.dMin, bounds.dMax);
      if (targetD !== pids.D) {
        recommendations.push({
          setting: `pid_${axisName}_d`,
          currentValue: pids.D,
          recommendedValue: targetD,
          reason: `Significant overshoot detected on ${axisName} (${Math.round(profile.meanOvershoot)}%). Increasing D-term dampens the bounce-back for a smoother, more controlled feel.`,
          impact: 'both',
          confidence: 'high',
          ruleId: `P-OS-D-${axisName}`,
        });
      }
      // Reduce P when overshoot is extreme (>2x threshold) or D is already high
      if (severity > 2 || base.D >= bounds.dMax * 0.6) {
        const pStep = severity > 4 ? 10 : 5;
        const targetP = clamp(base.P - pStep, bounds.pMin, bounds.pMax);
        if (targetP !== pids.P) {
          const ffNote =
            meanFFEnergyRatio !== undefined && meanFFEnergyRatio > 0.6
              ? ' Overshoot appears feedforward-dominated — consider reducing FF before lowering P.'
              : '';
          recommendations.push({
            setting: `pid_${axisName}_p`,
            currentValue: pids.P,
            recommendedValue: targetP,
            reason: `${severity > 4 ? 'Extreme' : 'Significant'} overshoot on ${axisName} (${Math.round(profile.meanOvershoot)}%). Reducing P-term helps prevent the quad from overshooting its target.${ffNote}`,
            impact: 'both',
            confidence: meanFFEnergyRatio !== undefined && meanFFEnergyRatio > 0.6 ? 'low' : 'high',
            ruleId: `P-OS-P-${axisName}`,
          });
        }
      }
    } else if (profile.meanOvershoot > moderateOvershoot) {
      // Moderate overshoot (15-25%): increase D only
      const targetD = clamp(base.D + 5, bounds.dMin, bounds.dMax);
      if (targetD !== pids.D) {
        recommendations.push({
          setting: `pid_${axisName}_d`,
          currentValue: pids.D,
          recommendedValue: targetD,
          reason: `Your quad overshoots on ${axisName} stick inputs (${Math.round(profile.meanOvershoot)}%). Increasing D-term will dampen the response.`,
          impact: 'stability',
          confidence: 'medium',
          ruleId: `P-OS-D-${axisName}`,
        });
      }
    }

    // Rule 2: Sluggish response (low overshoot + slow rise) → increase P (severity-scaled)
    if (
      profile.meanOvershoot < thresholds.overshootIdeal &&
      profile.meanRiseTimeMs > sluggishRiseMs
    ) {
      const slugSeverity = profile.meanRiseTimeMs / sluggishRiseMs;
      const pStep = slugSeverity > 2 ? 10 : 5;
      const targetP = clamp(base.P + pStep, bounds.pMin, bounds.pMax);
      if (targetP !== pids.P) {
        recommendations.push({
          setting: `pid_${axisName}_p`,
          currentValue: pids.P,
          recommendedValue: targetP,
          reason: `Response is sluggish on ${axisName} (${Math.round(profile.meanRiseTimeMs)}ms rise time). A P increase will make your quad feel more locked in.`,
          impact: 'response',
          confidence: 'medium',
          ruleId: `P-SLUG-P-${axisName}`,
        });
      }
    }

    // Rule 3: Excessive ringing → increase D (BF: any visible bounce-back should be addressed)
    const maxRinging = Math.max(...profile.responses.map((r) => r.ringingCount));
    if (maxRinging > thresholds.ringingMax) {
      const targetD = clamp(base.D + 5, bounds.dMin, bounds.dMax);
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
            ruleId: `P-RING-D-${axisName}`,
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
        const targetD = clamp(base.D + 5, bounds.dMin, bounds.dMax);
        if (targetD !== pids.D) {
          recommendations.push({
            setting: `pid_${axisName}_d`,
            currentValue: pids.D,
            recommendedValue: targetD,
            reason: `${axisName.charAt(0).toUpperCase() + axisName.slice(1)} takes ${Math.round(profile.meanSettlingTimeMs)}ms to settle. A slight D increase will help it lock in faster.`,
            impact: 'stability',
            confidence: 'low',
            ruleId: `P-SETT-D-${axisName}`,
          });
        }
      }
    }

    // Rule 5: I-term — steady-state tracking error
    const ssError = profile.meanSteadyStateError;
    if (ssError > thresholds.steadyStateErrorMax) {
      // High hold-phase error → I-term is too low (quad drifts from target)
      const iStep = ssError > thresholds.steadyStateErrorMax * 2 ? 10 : 5;
      const targetI = clamp(base.I + iStep, bounds.iMin, bounds.iMax);
      if (targetI !== pids.I) {
        recommendations.push({
          setting: `pid_${axisName}_i`,
          currentValue: pids.I,
          recommendedValue: targetI,
          reason: `${axisName.charAt(0).toUpperCase() + axisName.slice(1)} drifts from target during holds (${ssError.toFixed(1)}% error). Increasing I-term improves tracking accuracy and wind resistance.`,
          impact: 'stability',
          confidence: ssError > thresholds.steadyStateErrorMax * 2 ? 'high' : 'medium',
          ruleId: `P-SSE-I-${axisName}`,
        });
      }
    } else if (
      ssError < thresholds.steadyStateErrorLow &&
      profile.meanSettlingTimeMs > thresholds.settlingMax &&
      profile.meanOvershoot > moderateOvershoot
    ) {
      // Low error but slow settling + overshoot → I may be causing slow oscillation
      const targetI = clamp(base.I - 5, bounds.iMin, bounds.iMax);
      if (targetI !== pids.I) {
        recommendations.push({
          setting: `pid_${axisName}_i`,
          currentValue: pids.I,
          recommendedValue: targetI,
          reason: `${axisName.charAt(0).toUpperCase() + axisName.slice(1)} has slow settling (${Math.round(profile.meanSettlingTimeMs)}ms) with overshoot. Reducing I-term can help the quad settle faster.`,
          impact: 'stability',
          confidence: 'low',
          ruleId: `P-SSE-I-DEC-${axisName}`,
        });
      }
    }
  }

  // Post-process: validate D/P damping ratio for coordinated P/D recommendations.
  // Only applies to roll and pitch (yaw often has D=0).
  // Must run BEFORE informational P warnings so damping ratio recs take priority.
  validateDampingRatio(recommendations, currentPIDs, bounds);

  // Post-process: P informational warnings (after damping ratio to avoid conflicts)
  detectHighP(recommendations, currentPIDs, bounds);
  detectLowP(recommendations, currentPIDs, bounds);

  // Post-process: apply D-term effectiveness context to D recommendations
  // (runs after damping ratio to annotate all D recs including ratio-generated ones)
  if (dTermEffectiveness) {
    applyDTermEffectiveness(recommendations, dTermEffectiveness);
  }

  // Post-process: prop wash context — boost D confidence or suggest D when severe
  if (propWash) {
    applyPropWashContext(recommendations, propWash, currentPIDs, flightPIDs, bounds);
  }

  // Post-process: D-min/D-max advisory notes
  if (dMinContext?.active) {
    applyDMinAdvisory(recommendations, dMinContext);
  }

  // Post-process: TPA advisory notes
  if (tpaContext?.active) {
    applyTPAAdvisory(recommendations, tpaContext);
  }

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
/**
 * Detect P values significantly above the quad's typical range.
 * Emits an informational (low confidence) recommendation when P is high
 * but step response doesn't show problems — may cause hot motors/noise.
 */
function detectHighP(
  recommendations: PIDRecommendation[],
  currentPIDs: PIDConfiguration,
  bounds: QuadSizeBounds
): void {
  const highPThreshold = bounds.pTypical * 1.3; // 30% above typical

  for (const axisName of ['roll', 'pitch'] as const) {
    const pids = currentPIDs[axisName];

    // Skip if we already have a P recommendation for this axis
    const existingPRec = recommendations.find((r) => r.setting === `pid_${axisName}_p`);
    if (existingPRec) continue;

    if (pids.P > highPThreshold) {
      recommendations.push({
        setting: `pid_${axisName}_p`,
        currentValue: pids.P,
        recommendedValue: pids.P, // informational — same value
        reason:
          `P-term on ${axisName} (${pids.P}) is higher than typical for this quad size (${bounds.pTypical}). ` +
          'Step response looks fine, but monitor motor temperatures — high P amplifies noise and can cause motor heating.',
        impact: 'both',
        confidence: 'low',
        informational: true,
        ruleId: `P-HI-P-${axisName}`,
      });
    }
  }
}

/**
 * Detect P values significantly below the quad's typical range.
 * Emits an informational (low confidence) recommendation — counterpart to detectHighP.
 * Especially important for micro quads where P=20-25 is dangerously unresponsive.
 */
function detectLowP(
  recommendations: PIDRecommendation[],
  currentPIDs: PIDConfiguration,
  bounds: QuadSizeBounds
): void {
  const lowPThreshold = bounds.pTypical * 0.7; // 30% below typical

  for (const axisName of ['roll', 'pitch'] as const) {
    const pids = currentPIDs[axisName];

    // Skip if we already have a P recommendation for this axis
    const existingPRec = recommendations.find((r) => r.setting === `pid_${axisName}_p`);
    if (existingPRec) continue;

    if (pids.P < lowPThreshold) {
      recommendations.push({
        setting: `pid_${axisName}_p`,
        currentValue: pids.P,
        recommendedValue: pids.P, // informational — same value
        reason:
          `P-term on ${axisName} (${pids.P}) is lower than typical for this quad size (${bounds.pTypical}). ` +
          'The quad may feel sluggish or unresponsive. Consider increasing P for better stick feel.',
        impact: 'response',
        confidence: 'low',
        informational: true,
        ruleId: `P-LO-P-${axisName}`,
      });
    }
  }
}

function validateDampingRatio(
  recommendations: PIDRecommendation[],
  currentPIDs: PIDConfiguration,
  bounds: QuadSizeBounds
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
      const targetD = clamp(Math.round(resultP * DAMPING_RATIO_MIN), bounds.dMin, bounds.dMax);
      if (Math.abs(targetD - pids.D) >= DAMPING_RATIO_DEADZONE) {
        recommendations.push({
          setting: `pid_${axisName}_d`,
          currentValue: pids.D,
          recommendedValue: targetD,
          reason: `D/P ratio on ${axisName} is low (${ratio.toFixed(2)}). Increasing D improves dampening and reduces bounce-back without sacrificing response.`,
          impact: 'stability',
          confidence: 'medium',
          ruleId: `P-DR-UD-${axisName}`,
        });
      }
    } else if (ratio > DAMPING_RATIO_MAX && dRec && !pRec) {
      // D was increased by a rule but P wasn't adjusted — ratio pushed too high
      const targetP = clamp(Math.round(resultD / DAMPING_RATIO_MAX), bounds.pMin, bounds.pMax);
      if (targetP > pids.P && Math.abs(targetP - pids.P) >= DAMPING_RATIO_DEADZONE) {
        recommendations.push({
          setting: `pid_${axisName}_p`,
          currentValue: pids.P,
          recommendedValue: targetP,
          reason: `Adding a small P increase on ${axisName} to maintain healthy D/P balance (${ratio.toFixed(2)}) after the D-term adjustment.`,
          impact: 'response',
          confidence: 'low',
          ruleId: `P-DR-OD-${axisName}`,
        });
      }
    } else if (ratio > DAMPING_RATIO_MAX && !dRec && !pRec) {
      // No existing recommendations but ratio is already too high — reduce D
      const targetD = clamp(Math.round(resultP * DAMPING_RATIO_MAX), bounds.dMin, bounds.dMax);
      if (Math.abs(targetD - pids.D) >= DAMPING_RATIO_DEADZONE) {
        recommendations.push({
          setting: `pid_${axisName}_d`,
          currentValue: pids.D,
          recommendedValue: targetD,
          reason: `D/P ratio on ${axisName} is high (${ratio.toFixed(2)}). Reducing D helps with motor temperature and noise without losing stability.`,
          impact: 'both',
          confidence: 'medium',
          ruleId: `P-DR-OD-${axisName}`,
        });
      }
    }
  }
}

/**
 * Post-process D recommendations using D-term effectiveness data.
 *
 * Three tiers of D-increase gating:
 * - D ratio > 0.7 (dCritical) → D has headroom, boost confidence to high
 * - D ratio 0.3–0.7 → D increase OK, add caution note about noise cost
 * - D ratio < 0.3 → D is mostly noise, redirect to "improve filters first"
 *
 * For D decreases: annotate when D effectiveness is low.
 */
function applyDTermEffectiveness(
  recommendations: PIDRecommendation[],
  dte: DTermEffectiveness
): void {
  for (const rec of recommendations) {
    if (!rec.setting.includes('_d')) continue;

    const isIncrease = rec.recommendedValue > rec.currentValue;

    if (isIncrease) {
      if (dte.dCritical) {
        // D is highly effective — safe to increase
        rec.confidence = 'high';
      } else if (dte.overall < 0.3) {
        // D is mostly amplifying noise — redirect recommendation
        rec.confidence = 'low';
        rec.reason +=
          ' However, D-term is mostly amplifying noise (effectiveness ' +
          `${(dte.overall * 100).toFixed(0)}%) — improve filter configuration first for better results.`;
      } else {
        // Balanced range — allow increase but warn about noise cost
        rec.reason += ` D-term effectiveness is moderate (${(dte.overall * 100).toFixed(0)}%) — monitor motor temperatures after applying.`;
      }
    } else {
      // D decrease
      if (dte.overall < 0.3) {
        rec.reason += ' D-term effectiveness is low — D may not be doing much dampening work.';
      }
    }
  }
}

/** Prop wash severity thresholds for recommendation integration */
const PROPWASH_MODERATE_THRESHOLD = 2.0;
const PROPWASH_SEVERE_THRESHOLD = 5.0;

/**
 * Post-process recommendations with prop wash context.
 *
 * - Severe prop wash + existing D increase → boost confidence
 * - Severe prop wash + no D recommendation → suggest D increase on worst axis
 * - Prop wash concentrated on one axis → flag asymmetric issue
 */
function applyPropWashContext(
  recommendations: PIDRecommendation[],
  pw: PropWashAnalysis,
  currentPIDs: PIDConfiguration,
  flightPIDs?: PIDConfiguration,
  bounds: QuadSizeBounds = DEFAULT_QUAD_SIZE_BOUNDS
): void {
  if (pw.events.length < 3 || pw.meanSeverity < PROPWASH_MODERATE_THRESHOLD) return;

  const isSevere = pw.meanSeverity >= PROPWASH_SEVERE_THRESHOLD;
  const worstAxis = pw.worstAxis;

  // Boost confidence on existing D increase for worst axis
  const existingDRec = recommendations.find(
    (r) => r.setting === `pid_${worstAxis}_d` && r.recommendedValue > r.currentValue
  );

  if (existingDRec) {
    if (isSevere) {
      existingDRec.confidence = 'high';
      existingDRec.reason += ` Prop wash is severe on ${worstAxis} (${pw.meanSeverity.toFixed(1)}× baseline at ~${Math.round(pw.dominantFrequencyHz)} Hz) — D increase will help.`;
    }
    return;
  }

  // No D recommendation exists for worst axis — suggest one if prop wash is severe
  if (isSevere) {
    const pids = currentPIDs[worstAxis];
    const base = flightPIDs ? flightPIDs[worstAxis] : pids;
    const targetD = clamp(base.D + 5, bounds.dMin, bounds.dMax);
    if (targetD !== pids.D) {
      recommendations.push({
        setting: `pid_${worstAxis}_d`,
        currentValue: pids.D,
        recommendedValue: targetD,
        reason:
          `Severe prop wash detected on ${worstAxis} (${pw.meanSeverity.toFixed(1)}× baseline at ~${Math.round(pw.dominantFrequencyHz)} Hz). ` +
          'Increasing D-term will help dampen the oscillation during descents.',
        impact: 'stability',
        confidence: 'medium',
        ruleId: `P-PW-D-${worstAxis}`,
      });
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
  const smoothFactor = parseIntOr(rawHeaders.get('feedforward_smooth_factor'));
  const jitterFactor = parseIntOr(rawHeaders.get('feedforward_jitter_factor'));

  // Extract RC link rate from headers
  const rcSmoothingInputHz = parseIntOr(rawHeaders.get('rc_smoothing_input_hz'));
  const rcIntervalMs = parseIntOr(rawHeaders.get('rcIntervalMs'));
  const rcLinkRateHz =
    rcSmoothingInputHz !== undefined && rcSmoothingInputHz > 0
      ? rcSmoothingInputHz
      : rcIntervalMs !== undefined && rcIntervalMs > 0
        ? Math.round(1000 / rcIntervalMs)
        : undefined;

  const active = (boost ?? 0) > 0;

  return {
    active,
    ...(boost !== undefined ? { boost } : {}),
    ...(maxRateLimit !== undefined ? { maxRateLimit } : {}),
    ...(smoothFactor !== undefined ? { smoothFactor } : {}),
    ...(jitterFactor !== undefined ? { jitterFactor } : {}),
    ...(rcLinkRateHz !== undefined ? { rcLinkRateHz } : {}),
  };
}

/**
 * Extract D-min context from BBL raw headers (BF 4.3+).
 *
 * When d_min is active (d_min_roll/pitch > 0), the D value in PID config
 * represents d_max. The actual D varies between d_min and d_max based on
 * stick input. PIDlab's D recommendations target d_max only.
 */
export interface DMinContext {
  active: boolean;
  roll?: number;
  pitch?: number;
  yaw?: number;
}

export function extractDMinContext(rawHeaders: Map<string, string>): DMinContext {
  const dMinRoll = parseIntOr(rawHeaders.get('d_min_roll'));
  const dMinPitch = parseIntOr(rawHeaders.get('d_min_pitch'));
  const dMinYaw = parseIntOr(rawHeaders.get('d_min_yaw'));
  const active = (dMinRoll ?? 0) > 0 || (dMinPitch ?? 0) > 0;

  return {
    active,
    ...(dMinRoll !== undefined ? { roll: dMinRoll } : {}),
    ...(dMinPitch !== undefined ? { pitch: dMinPitch } : {}),
    ...(dMinYaw !== undefined ? { yaw: dMinYaw } : {}),
  };
}

/**
 * Extract TPA (Throttle PID Attenuation) context from BBL raw headers.
 *
 * TPA attenuates D (and optionally P) at high throttle. When active,
 * step responses at high throttle may show less damping than the configured
 * D value suggests, because effective D is reduced.
 */
export interface TPAContext {
  active: boolean;
  rate?: number; // 0-100, percentage of attenuation
  breakpoint?: number; // throttle value where TPA starts (0-2000)
}

export function extractTPAContext(rawHeaders: Map<string, string>): TPAContext {
  const tpaRate = parseIntOr(rawHeaders.get('tpa_rate'));
  const tpaBreakpoint = parseIntOr(rawHeaders.get('tpa_breakpoint'));
  const active = (tpaRate ?? 0) > 0;

  return {
    active,
    ...(tpaRate !== undefined ? { rate: tpaRate } : {}),
    ...(tpaBreakpoint !== undefined ? { breakpoint: tpaBreakpoint } : {}),
  };
}

/** Parse an integer from a string, returning undefined if missing or NaN. */
function parseIntOr(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

// ---- Frequency-domain recommendation thresholds ----

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
  recommendations: PIDRecommendation[],
  bounds: QuadSizeBounds = DEFAULT_QUAD_SIZE_BOUNDS,
  flightStyle: FlightStyle = 'balanced'
): void {
  const isYaw = axisName === 'yaw';
  const overshootThreshold = isYaw ? thresholds.overshootMax * 1.5 : thresholds.overshootMax;
  const moderateOvershoot = isYaw ? thresholds.overshootMax : thresholds.moderateOvershoot;
  const bandwidthLowBase = BANDWIDTH_LOW_HZ_BY_STYLE[flightStyle];
  const bandwidthLow = isYaw ? bandwidthLowBase * 0.7 : bandwidthLowBase;

  // Rule TF-1: Low phase margin → increase D (under-damped system)
  if (tf.phaseMarginDeg < PHASE_MARGIN_LOW_DEG && tf.phaseMarginDeg > 0) {
    const dStep = tf.phaseMarginDeg < PHASE_MARGIN_CRITICAL_DEG ? 10 : 5;
    const targetD = clamp(base.D + dStep, bounds.dMin, bounds.dMax);
    if (targetD !== pids.D) {
      recommendations.push({
        setting: `pid_${axisName}_d`,
        currentValue: pids.D,
        recommendedValue: targetD,
        reason: `Transfer function shows low phase margin on ${axisName} (${Math.round(tf.phaseMarginDeg)}°). Increasing D-term adds damping to prevent oscillation.`,
        impact: 'stability',
        confidence: 'medium',
        ruleId: `TF-1-D-${axisName}`,
      });
    }
  }

  // Rule TF-2: Overshoot from synthetic step response
  if (tf.overshootPercent > overshootThreshold) {
    const severity = tf.overshootPercent / overshootThreshold;
    const dStep = severity > 4 ? 15 : severity > 2 ? 10 : 5;
    const existingDRec = recommendations.find((r) => r.setting === `pid_${axisName}_d`);
    if (!existingDRec) {
      const targetD = clamp(base.D + dStep, bounds.dMin, bounds.dMax);
      if (targetD !== pids.D) {
        recommendations.push({
          setting: `pid_${axisName}_d`,
          currentValue: pids.D,
          recommendedValue: targetD,
          reason: `Synthetic step response shows ${Math.round(tf.overshootPercent)}% overshoot on ${axisName}. Increasing D-term will dampen the response.`,
          impact: 'both',
          confidence: 'medium',
          ruleId: `TF-2-D-${axisName}`,
        });
      }
    }
    // Reduce P for extreme overshoot
    if (severity > 2 || base.D >= bounds.dMax * 0.6) {
      const pStep = severity > 4 ? 10 : 5;
      const targetP = clamp(base.P - pStep, bounds.pMin, bounds.pMax);
      if (targetP !== pids.P) {
        recommendations.push({
          setting: `pid_${axisName}_p`,
          currentValue: pids.P,
          recommendedValue: targetP,
          reason: `High overshoot on ${axisName} (${Math.round(tf.overshootPercent)}%) from transfer function analysis. Reducing P-term helps prevent overshooting.`,
          impact: 'both',
          confidence: 'medium',
          ruleId: `TF-2-P-${axisName}`,
        });
      }
    }
  } else if (tf.overshootPercent > moderateOvershoot) {
    // Moderate overshoot
    const existingDRec = recommendations.find((r) => r.setting === `pid_${axisName}_d`);
    if (!existingDRec) {
      const targetD = clamp(base.D + 5, bounds.dMin, bounds.dMax);
      if (targetD !== pids.D) {
        recommendations.push({
          setting: `pid_${axisName}_d`,
          currentValue: pids.D,
          recommendedValue: targetD,
          reason: `Transfer function indicates moderate overshoot on ${axisName} (${Math.round(tf.overshootPercent)}%). A D-term increase will improve damping.`,
          impact: 'stability',
          confidence: 'medium',
          ruleId: `TF-2-D-${axisName}`,
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
    const targetP = clamp(base.P + 5, bounds.pMin, bounds.pMax);
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
          ruleId: `TF-3-P-${axisName}`,
        });
      }
    }
  }

  // Rule TF-4: DC gain deficit → I-term too low (poor steady-state tracking)
  if (tf.dcGainDb < -1.0) {
    // DC gain below -1 dB means system doesn't fully track setpoint at steady state
    const deficit = Math.abs(tf.dcGainDb);
    const iStep = deficit > 3 ? 10 : 5;
    const targetI = clamp(base.I + iStep, bounds.iMin, bounds.iMax);
    if (targetI !== pids.I) {
      const existingIRec = recommendations.find((r) => r.setting === `pid_${axisName}_i`);
      if (!existingIRec) {
        recommendations.push({
          setting: `pid_${axisName}_i`,
          currentValue: pids.I,
          recommendedValue: targetI,
          reason:
            `DC gain on ${axisName} is ${tf.dcGainDb.toFixed(1)} dB (below 0 dB), ` +
            'indicating the system does not fully track the target at steady state. ' +
            'Increasing I-term improves long-term tracking accuracy.',
          impact: 'response',
          confidence: deficit > 3 ? 'medium' : 'low',
          ruleId: `TF-4-I-${axisName}`,
        });
      }
    }
  }
}

/**
 * Annotate D recommendations when D-min/D-max is active.
 * PIDlab adjusts the D value (d_max in BF terms); d_min is separate.
 */
function applyDMinAdvisory(recommendations: PIDRecommendation[], dMin: DMinContext): void {
  for (const rec of recommendations) {
    if (!rec.setting.includes('_d')) continue;

    const axis = rec.setting.includes('roll')
      ? 'roll'
      : rec.setting.includes('pitch')
        ? 'pitch'
        : 'yaw';
    const dMinValue = dMin[axis as keyof Pick<DMinContext, 'roll' | 'pitch' | 'yaw'>];
    if (dMinValue && dMinValue > 0) {
      rec.reason += ` Note: D-min is active on ${axis} (d_min=${dMinValue}). This change adjusts the maximum D value — D-min may also need adjustment for consistent feel.`;
    }
  }
}

/**
 * Annotate D recommendations when TPA is active.
 * TPA reduces effective D at high throttle, which may affect step response analysis.
 */
function applyTPAAdvisory(recommendations: PIDRecommendation[], tpa: TPAContext): void {
  if (!tpa.rate || tpa.rate === 0) return;

  for (const rec of recommendations) {
    if (!rec.setting.includes('_d') || rec.recommendedValue <= rec.currentValue) continue;

    rec.reason += ` Note: TPA is active (${tpa.rate}% attenuation above ${tpa.breakpoint ?? 1350}). Effective D is reduced at high throttle — step responses from high-throttle maneuvers may show less damping than the configured D value.`;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
