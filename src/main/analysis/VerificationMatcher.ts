/**
 * Verification flight similarity matching.
 *
 * Compares verification flight characteristics against the initial analysis flight
 * to ensure apples-to-apples comparison. Type-aware: each tuning mode has different
 * similarity criteria.
 */
import type {
  NoiseProfile,
  NoisePeak,
  FlightSegment,
  VerificationSimilarity,
  SimilaritySubScore,
  AnalysisWarning,
} from '@shared/types/analysis.types';
import type { PIDMetricsSummary } from '@shared/types/tuning-history.types';
import {
  PEAK_MATCH_TOLERANCE_MIN_HZ,
  MOTOR_HARMONIC_TOLERANCE_RATIO,
  SIMILARITY_ACCEPT_THRESHOLD,
  SIMILARITY_REJECT_THRESHOLD,
} from './constants';

// ---- Tier & Recommendation helpers ----

function scoreTier(score: number): VerificationSimilarity['tier'] {
  if (score >= SIMILARITY_ACCEPT_THRESHOLD) return 'good';
  if (score >= SIMILARITY_REJECT_THRESHOLD) return 'marginal';
  return 'poor';
}

function scoreRecommendation(score: number): VerificationSimilarity['recommendation'] {
  if (score >= SIMILARITY_ACCEPT_THRESHOLD) return 'accept';
  if (score >= SIMILARITY_REJECT_THRESHOLD) return 'warn';
  return 'reject_reflight';
}

function clamp100(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

// ---- Peak matching ----

/** Compute proportional tolerance for peak matching (Hz). */
function peakMatchTolerance(frequencyHz: number): number {
  return Math.max(PEAK_MATCH_TOLERANCE_MIN_HZ, frequencyHz * MOTOR_HARMONIC_TOLERANCE_RATIO);
}

/**
 * Match mechanical peaks between reference and verification flights.
 *
 * Only penalizes peaks that appear at a DIFFERENT frequency in verification.
 * Peaks that disappear entirely are classified as "filtered" (expected outcome
 * of good filter tuning), not "unmatched".
 */
export function matchMechanicalPeaks(
  refPeaks: NoisePeak[],
  verPeaks: NoisePeak[],
  toleranceMinHz: number = PEAK_MATCH_TOLERANCE_MIN_HZ
): { matchRatio: number; unmatchedRef: NoisePeak[]; filteredRef: NoisePeak[] } {
  // Filter to mechanical types only
  const mechanicalTypes: NoisePeak['type'][] = ['frame_resonance', 'motor_harmonic'];
  const refMech = refPeaks.filter((p) => mechanicalTypes.includes(p.type));
  const verMech = verPeaks.filter((p) => mechanicalTypes.includes(p.type));

  if (refMech.length === 0) {
    return { matchRatio: 1.0, unmatchedRef: [], filteredRef: [] };
  }

  // If verification has NO mechanical peaks, they were all filtered — not a mismatch
  if (verMech.length === 0) {
    return { matchRatio: 1.0, unmatchedRef: [], filteredRef: refMech };
  }

  let matched = 0;
  const unmatchedRef: NoisePeak[] = [];
  const filteredRef: NoisePeak[] = [];

  for (const rp of refMech) {
    const tolerance = Math.max(toleranceMinHz, rp.frequency * MOTOR_HARMONIC_TOLERANCE_RATIO);

    // Find closest verification peak
    let closest: NoisePeak | null = null;
    let closestDist = Infinity;
    for (const vp of verMech) {
      const dist = Math.abs(rp.frequency - vp.frequency);
      if (dist < closestDist) {
        closestDist = dist;
        closest = vp;
      }
    }

    if (closest && closestDist <= tolerance) {
      matched++;
    } else if (!closest || closestDist > tolerance * 3) {
      // Peak disappeared entirely or is very far — likely filtered
      filteredRef.push(rp);
    } else {
      // Peak present but at different frequency — genuine mismatch
      unmatchedRef.push(rp);
    }
  }

  // matchRatio: matched / (matched + genuinely unmatched). Filtered peaks don't penalize.
  const denominator = matched + unmatchedRef.length;
  const matchRatio = denominator === 0 ? 1.0 : matched / denominator;

  return { matchRatio, unmatchedRef, filteredRef };
}

// ---- Throttle overlap ----

/**
 * Compute throttle coverage overlap between reference and verification segments.
 * Returns 0-1 ratio (1 = perfect overlap).
 */
export function computeThrottleOverlap(
  refSegments: FlightSegment[],
  verSegments: FlightSegment[]
): number {
  if (refSegments.length === 0 || verSegments.length === 0) return 0;

  const refMin = Math.min(...refSegments.map((s) => s.minThrottle));
  const refMax = Math.max(...refSegments.map((s) => s.maxThrottle));
  const verMin = Math.min(...verSegments.map((s) => s.minThrottle));
  const verMax = Math.max(...verSegments.map((s) => s.maxThrottle));

  const refRange = refMax - refMin;
  if (refRange <= 0) return 0;

  const overlap = Math.min(refMax, verMax) - Math.max(refMin, verMin);
  if (overlap <= 0) return 0;

  return Math.min(1, overlap / refRange);
}

// ---- Step count ratio ----

export function computeStepCountRatio(refSteps: number, verSteps: number): number {
  if (refSteps === 0 && verSteps === 0) return 1;
  if (refSteps === 0 || verSteps === 0) return 0;
  return Math.min(refSteps, verSteps) / Math.max(refSteps, verSteps);
}

// ---- Activity ratio ----

export function computeActivityRatio(refRMS: number, verRMS: number): number {
  if (refRMS === 0 && verRMS === 0) return 1;
  if (refRMS === 0 || verRMS === 0) return 0;
  return Math.min(refRMS, verRMS) / Math.max(refRMS, verRMS);
}

// ---- Filter Tune Similarity ----

export interface FilterVerificationInput {
  noiseProfile: NoiseProfile;
  segments: FlightSegment[];
  hasSweepSegments: boolean;
}

/**
 * Match filter verification flight against initial analysis.
 */
export function matchFilterVerification(
  ref: FilterVerificationInput,
  ver: FilterVerificationInput
): VerificationSimilarity {
  const warnings: AnalysisWarning[] = [];

  // Sub-score 1: Throttle overlap
  const throttleOverlap = computeThrottleOverlap(ref.segments, ver.segments);
  const throttleScore = clamp100(throttleOverlap * 100);
  if (throttleOverlap < 0.5) {
    warnings.push({
      code: 'verification_dissimilar_throttle',
      message: `Throttle coverage overlap is only ${Math.round(throttleOverlap * 100)}%. Fly with similar throttle patterns as the initial analysis flight.`,
      severity: throttleOverlap < 0.25 ? 'error' : 'warning',
    });
  }

  // Sub-score 2: Peak frequency match (all axes combined)
  const allRefPeaks = [
    ...ref.noiseProfile.roll.peaks,
    ...ref.noiseProfile.pitch.peaks,
    ...ref.noiseProfile.yaw.peaks,
  ];
  const allVerPeaks = [
    ...ver.noiseProfile.roll.peaks,
    ...ver.noiseProfile.pitch.peaks,
    ...ver.noiseProfile.yaw.peaks,
  ];
  const peakResult = matchMechanicalPeaks(allRefPeaks, allVerPeaks);
  const peakScore = clamp100(peakResult.matchRatio * 100);
  if (peakResult.matchRatio < 0.5 && peakResult.unmatchedRef.length > 0) {
    warnings.push({
      code: 'verification_dissimilar_peaks',
      message: `${peakResult.unmatchedRef.length} mechanical peak(s) shifted frequency between flights. This may indicate different flight conditions or throttle range.`,
      severity: 'warning',
    });
  }

  // Sub-score 3: Segment type match
  const segTypeMatch = ref.hasSweepSegments === ver.hasSweepSegments;
  const segTypeScore = segTypeMatch ? 100 : 0;
  if (!segTypeMatch) {
    warnings.push({
      code: 'verification_dissimilar_segments',
      message: `Initial flight used ${ref.hasSweepSegments ? 'throttle sweeps' : 'hover segments'} but verification used ${ver.hasSweepSegments ? 'throttle sweeps' : 'hover segments'}. Fly with similar style for valid comparison.`,
      severity: 'warning',
    });
  }

  const subScores: SimilaritySubScore[] = [
    { name: 'Throttle overlap', score: throttleScore, weight: 0.35 },
    { name: 'Peak frequency match', score: peakScore, weight: 0.4 },
    { name: 'Segment type match', score: segTypeScore, weight: 0.25 },
  ];

  const overall = clamp100(subScores.reduce((sum, s) => sum + s.score * s.weight, 0));

  if (overall < SIMILARITY_REJECT_THRESHOLD) {
    warnings.push({
      code: 'verification_rejected',
      message:
        'Verification flight is too different from the initial analysis flight. Fly again with similar throttle coverage and style for a valid comparison.',
      severity: 'error',
    });
  }

  return {
    score: overall,
    tier: scoreTier(overall),
    recommendation: scoreRecommendation(overall),
    subScores,
    warnings,
  };
}

// ---- PID Tune Similarity ----

export interface PIDVerificationInput {
  stepsDetected: number;
  axisStepCounts: [number, number, number]; // [roll, pitch, yaw]
  meanMagnitude: number;
  magnitudeStd: number;
}

/** Extract PID verification input from PIDMetricsSummary. */
export function extractPIDVerificationInput(metrics: PIDMetricsSummary): PIDVerificationInput {
  // Step counts aren't stored per-axis in PIDMetricsSummary, so estimate from stepsDetected
  // and whether per-axis data has non-zero overshoot (indicates steps were found)
  const hasRoll = metrics.roll.meanOvershoot > 0 || metrics.roll.meanRiseTimeMs > 0;
  const hasPitch = metrics.pitch.meanOvershoot > 0 || metrics.pitch.meanRiseTimeMs > 0;
  const hasYaw = metrics.yaw.meanOvershoot > 0 || metrics.yaw.meanRiseTimeMs > 0;
  const activeAxes = [hasRoll, hasPitch, hasYaw].filter(Boolean).length;
  const perAxis = activeAxes > 0 ? Math.round(metrics.stepsDetected / activeAxes) : 0;

  return {
    stepsDetected: metrics.stepsDetected,
    axisStepCounts: [hasRoll ? perAxis : 0, hasPitch ? perAxis : 0, hasYaw ? perAxis : 0],
    meanMagnitude: 0, // Not stored in summary — use 0 (won't affect step count / axis scores)
    magnitudeStd: 0,
  };
}

/**
 * Match PID verification flight against initial analysis.
 */
export function matchPIDVerification(
  ref: PIDVerificationInput,
  ver: PIDVerificationInput
): VerificationSimilarity {
  const warnings: AnalysisWarning[] = [];

  // Sub-score 1: Step count ratio
  const stepRatio = computeStepCountRatio(ref.stepsDetected, ver.stepsDetected);
  const stepScore = clamp100(stepRatio * 100);
  if (stepRatio < 0.5) {
    warnings.push({
      code: 'verification_dissimilar_steps',
      message: `Verification flight has ${ver.stepsDetected} steps vs ${ref.stepsDetected} in initial. Perform a similar number of stick snaps.`,
      severity: 'warning',
    });
  }

  // Sub-score 2: Axis coverage match
  const refAxes = ref.axisStepCounts.filter((c) => c >= 3).length;
  const verAxes = ver.axisStepCounts.filter((c) => c >= 3).length;
  // Both should have same axes covered
  let axisMatch = 0;
  for (let i = 0; i < 3; i++) {
    const refHas = ref.axisStepCounts[i] >= 3;
    const verHas = ver.axisStepCounts[i] >= 3;
    if (refHas === verHas) axisMatch++;
  }
  const axisCoverageScore = clamp100((axisMatch / 3) * 100);
  if (axisMatch < 3) {
    const axisNames = ['Roll', 'Pitch', 'Yaw'];
    const missing = [];
    for (let i = 0; i < 3; i++) {
      if (ref.axisStepCounts[i] >= 3 && ver.axisStepCounts[i] < 3) {
        missing.push(axisNames[i]);
      }
    }
    if (missing.length > 0) {
      warnings.push({
        code: 'verification_dissimilar_steps',
        message: `Verification flight is missing steps on ${missing.join(', ')} axis. Include stick snaps on all axes tested in the initial flight.`,
        severity: 'warning',
      });
    }
  }

  // Sub-score 3: Magnitude range overlap (use coefficient of variation for style independence)
  let magnitudeScore = 50; // Default when magnitude data unavailable
  if (ref.meanMagnitude > 0 && ver.meanMagnitude > 0) {
    const ratio = computeActivityRatio(ref.meanMagnitude, ver.meanMagnitude);
    magnitudeScore = clamp100(ratio * 100);
  }

  const subScores: SimilaritySubScore[] = [
    { name: 'Step count ratio', score: stepScore, weight: 0.3 },
    { name: 'Axis coverage match', score: axisCoverageScore, weight: 0.35 },
    { name: 'Magnitude range overlap', score: magnitudeScore, weight: 0.35 },
  ];

  const overall = clamp100(subScores.reduce((sum, s) => sum + s.score * s.weight, 0));

  if (overall < SIMILARITY_REJECT_THRESHOLD) {
    warnings.push({
      code: 'verification_rejected',
      message:
        'Verification flight has very different stick input patterns. Fly again with similar stick snaps on all axes.',
      severity: 'error',
    });
  }

  return {
    score: overall,
    tier: scoreTier(overall),
    recommendation: scoreRecommendation(overall),
    subScores,
    warnings,
  };
}

// ---- Flash Tune Similarity ----

export interface FlashVerificationInput {
  throttleOverlapRef?: FlightSegment[];
  throttleOverlapVer?: FlightSegment[];
  setpointRMS: number;
  coherenceMean: number;
}

/**
 * Match Flash Tune verification flight against initial analysis.
 */
export function matchFlashVerification(
  ref: FlashVerificationInput,
  ver: FlashVerificationInput
): VerificationSimilarity {
  const warnings: AnalysisWarning[] = [];

  // Sub-score 1: Throttle overlap (if segments available)
  let throttleScore = 50; // default when no segment data
  if (ref.throttleOverlapRef && ver.throttleOverlapVer) {
    const overlap = computeThrottleOverlap(ref.throttleOverlapRef, ver.throttleOverlapVer);
    throttleScore = clamp100(overlap * 100);
    if (overlap < 0.5) {
      warnings.push({
        code: 'verification_dissimilar_throttle',
        message: `Throttle coverage overlap is only ${Math.round(overlap * 100)}%. Fly with similar throttle range.`,
        severity: 'warning',
      });
    }
  }

  // Sub-score 2: Activity ratio
  const activityRatio = computeActivityRatio(ref.setpointRMS, ver.setpointRMS);
  const activityScore = clamp100(activityRatio * 100);
  if (activityRatio < 0.5) {
    warnings.push({
      code: 'verification_dissimilar_activity',
      message: `Stick activity levels differ significantly between flights. Fly with similar intensity.`,
      severity: 'warning',
    });
  }

  // Sub-score 3: Coherence ratio
  const coherenceRatio = computeActivityRatio(ref.coherenceMean, ver.coherenceMean);
  const coherenceScore = clamp100(coherenceRatio * 100);

  const subScores: SimilaritySubScore[] = [
    { name: 'Throttle overlap', score: throttleScore, weight: 0.3 },
    { name: 'Stick activity ratio', score: activityScore, weight: 0.35 },
    { name: 'Coherence ratio', score: coherenceScore, weight: 0.35 },
  ];

  const overall = clamp100(subScores.reduce((sum, s) => sum + s.score * s.weight, 0));

  if (overall < SIMILARITY_REJECT_THRESHOLD) {
    warnings.push({
      code: 'verification_rejected',
      message:
        'Verification flight conditions differ too much from initial analysis. Fly again with similar stick activity and throttle range.',
      severity: 'error',
    });
  }

  return {
    score: overall,
    tier: scoreTier(overall),
    recommendation: scoreRecommendation(overall),
    subScores,
    warnings,
  };
}
