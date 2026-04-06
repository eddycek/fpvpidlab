/**
 * Data quality scoring for flight analysis input data.
 *
 * Computes a 0-100 quality score before analysis to communicate
 * confidence in results and generate specific warnings.
 */
import type {
  AnalysisWarning,
  DataQualityScore,
  DataQualitySubScore,
  FilterRecommendation,
  FlightSegment,
  PIDRecommendation,
  StepResponse,
} from '@shared/types/analysis.types';

// ---- Tier mapping ----

function tierFromScore(score: number): DataQualityScore['tier'] {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

/** Clamp a value to 0-100 */
function clamp100(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

// ---- Filter data quality ----

export interface FilterQualityInput {
  segments: FlightSegment[];
  hasSweepSegments: boolean;
  flightDurationS: number;
}

/**
 * Score the quality of filter analysis input data.
 *
 * Sub-scores:
 * - Segment count (weight 0.20): 3+ segments = 100, 0 = 0
 * - Total hover time (weight 0.35): 5s+ = 100, <0.5s = 0
 * - Throttle coverage (weight 0.25): 40%+ range = 100, <10% = 0
 * - Segment type (weight 0.20): sweep segments = 100, fallback = 0
 */
export function scoreFilterDataQuality(input: FilterQualityInput): {
  score: DataQualityScore;
  warnings: AnalysisWarning[];
} {
  const { segments, hasSweepSegments } = input;
  const warnings: AnalysisWarning[] = [];

  // Sub-score: segment count (0-3 → 0-100)
  const segCount = segments.length;
  const segCountScore = clamp100((segCount / 3) * 100);

  if (segCount < 2) {
    warnings.push({
      code: 'few_segments',
      message: `Only ${segCount} flight segment${segCount !== 1 ? 's' : ''} found. For best results, fly at least 3 stable hover periods of 2+ seconds each.`,
      severity: 'warning',
    });
  }

  // Sub-score: total hover time
  const totalHoverTime = segments.reduce((sum, s) => sum + s.durationSeconds, 0);
  // Linear 0.5s→0, 5s→100
  const hoverTimeScore = clamp100(((totalHoverTime - 0.5) / 4.5) * 100);

  if (totalHoverTime < 2) {
    warnings.push({
      code: 'short_hover_time',
      message: `Total hover time is ${totalHoverTime.toFixed(1)}s. At least 5 seconds of stable hover data is recommended for reliable filter analysis.`,
      severity: totalHoverTime < 0.5 ? 'error' : 'warning',
    });
  }

  // Sub-score: throttle coverage (use per-sample min/max, not segment averages)
  let throttleCoverage = 0;
  if (segments.length > 0) {
    const globalMin = Math.min(...segments.map((s) => s.minThrottle));
    const globalMax = Math.max(...segments.map((s) => s.maxThrottle));
    throttleCoverage = globalMax - globalMin;
  }
  // throttleCoverage is 0-1 range; convert to percentage for scoring/display
  const throttleCoveragePct = throttleCoverage * 100;
  // Linear 10%→0, 40%→100
  const throttleScore = clamp100(((throttleCoveragePct - 10) / 30) * 100);

  if (throttleCoveragePct < 20 && segments.length > 0) {
    warnings.push({
      code: 'narrow_throttle_coverage',
      message: `Throttle coverage is only ${throttleCoveragePct.toFixed(0)}%. Fly smooth throttle sweeps covering a wider range for noise analysis across different RPMs.`,
      severity: 'warning',
    });
  }

  // Sub-score: segment type (sweep vs fallback)
  const segTypeScore = hasSweepSegments ? 100 : 0;

  const subScores: DataQualitySubScore[] = [
    { name: 'Segment count', score: segCountScore, weight: 0.2 },
    { name: 'Hover time', score: hoverTimeScore, weight: 0.35 },
    { name: 'Throttle coverage', score: throttleScore, weight: 0.25 },
    { name: 'Segment type', score: segTypeScore, weight: 0.2 },
  ];

  const overall = clamp100(subScores.reduce((sum, s) => sum + s.score * s.weight, 0));

  return {
    score: { overall, tier: tierFromScore(overall), subScores },
    warnings,
  };
}

// ---- PID data quality ----

export interface PIDQualityInput {
  totalSteps: number;
  axisResponses: {
    roll: StepResponse[];
    pitch: StepResponse[];
    yaw: StepResponse[];
  };
}

/**
 * Score the quality of PID analysis input data.
 *
 * Sub-scores:
 * - Step count (weight 0.30): 15+ steps = 100, 0 = 0
 * - Axis coverage (weight 0.30): 3 axes with 3+ steps each = 100
 * - Magnitude variety (weight 0.20): varied step sizes = 100
 * - Hold quality (weight 0.20): sufficient hold duration = 100
 */
export function scorePIDDataQuality(input: PIDQualityInput): {
  score: DataQualityScore;
  warnings: AnalysisWarning[];
} {
  const { totalSteps, axisResponses } = input;
  const warnings: AnalysisWarning[] = [];

  // Sub-score: step count (0-15 → 0-100)
  const stepCountScore = clamp100((totalSteps / 15) * 100);

  if (totalSteps < 5) {
    warnings.push({
      code: 'few_steps',
      message: `Only ${totalSteps} step input${totalSteps !== 1 ? 's' : ''} detected. Perform at least 15 quick stick snaps across all axes for reliable PID analysis.`,
      severity: totalSteps === 0 ? 'error' : 'warning',
    });
  }

  // Sub-score: axis coverage
  const axesCounts = [
    axisResponses.roll.length,
    axisResponses.pitch.length,
    axisResponses.yaw.length,
  ];
  const axisNames = ['Roll', 'Pitch', 'Yaw'];
  const axesWithEnough = axesCounts.filter((c) => c >= 3).length;
  let axisCoverageScore = clamp100((axesWithEnough / 3) * 100);

  for (let i = 0; i < 3; i++) {
    if (axesCounts[i] === 0) {
      warnings.push({
        code: 'missing_axis_coverage',
        message: `No step inputs detected on ${axisNames[i]} axis. Include stick snaps on all axes for complete PID analysis.`,
        severity: 'warning',
      });
    } else if (axesCounts[i] < 3) {
      warnings.push({
        code: 'few_steps_per_axis',
        message: `Only ${axesCounts[i]} step${axesCounts[i] !== 1 ? 's' : ''} on ${axisNames[i]} axis. At least 3 steps per axis recommended.`,
        severity: 'warning',
      });
    }
  }

  // Sub-score: magnitude variety
  const allMagnitudes = [...axisResponses.roll, ...axisResponses.pitch, ...axisResponses.yaw].map(
    (r) => Math.abs(r.step.magnitude)
  );

  let magnitudeScore = 0;
  if (allMagnitudes.length > 0) {
    const meanMag = allMagnitudes.reduce((a, b) => a + b, 0) / allMagnitudes.length;

    if (meanMag < 200 && allMagnitudes.length > 0) {
      warnings.push({
        code: 'low_step_magnitude',
        message: `Average step magnitude is ${meanMag.toFixed(0)} deg/s. Harder stick snaps (200+ deg/s) produce clearer step responses.`,
        severity: 'warning',
      });
    }

    if (allMagnitudes.length >= 2) {
      const stdDev = Math.sqrt(
        allMagnitudes.reduce((sum, m) => sum + (m - meanMag) ** 2, 0) / allMagnitudes.length
      );
      // Coefficient of variation — 0.3+ is good variety
      const cv = meanMag > 0 ? stdDev / meanMag : 0;
      magnitudeScore = clamp100((cv / 0.3) * 100);
    } else {
      magnitudeScore = 0;
    }
  }

  // Sub-score: hold quality — based on settling time availability
  // If steps have valid (non-zero) settling times, hold was long enough
  const allResponses = [...axisResponses.roll, ...axisResponses.pitch, ...axisResponses.yaw];
  let holdScore = 0;
  if (allResponses.length > 0) {
    const validSettling = allResponses.filter((r) => r.settlingTimeMs > 0).length;
    holdScore = clamp100((validSettling / allResponses.length) * 100);
  }

  // Check for flat/empty step responses per axis — steps may be detected but
  // the response signal can be near-zero if steps were too weak or noisy.
  for (const [name, responses] of Object.entries(axisResponses) as [string, StepResponse[]][]) {
    if (responses.length >= 3) {
      const maxAbsOvershoot = Math.max(...responses.map((r) => Math.abs(r.overshootPercent)));
      const maxPeakRatio = Math.max(
        ...responses.map((r) =>
          r.step.magnitude !== 0 ? Math.abs(r.peakValue / r.step.magnitude) : 0
        )
      );
      if (maxAbsOvershoot < 1 && maxPeakRatio < 0.05) {
        warnings.push({
          code: 'flat_step_response',
          message: `${name.charAt(0).toUpperCase() + name.slice(1)} axis has ${responses.length} steps but the response signal is nearly flat. Try harder, more distinct stick snaps on this axis.`,
          severity: 'warning',
        });
        axisCoverageScore = clamp100(axisCoverageScore - 33);
      }
    }
  }

  const subScores: DataQualitySubScore[] = [
    { name: 'Step count', score: stepCountScore, weight: 0.3 },
    { name: 'Axis coverage', score: axisCoverageScore, weight: 0.3 },
    { name: 'Magnitude variety', score: magnitudeScore, weight: 0.2 },
    { name: 'Hold quality', score: holdScore, weight: 0.2 },
  ];

  const overall = clamp100(subScores.reduce((sum, s) => sum + s.score * s.weight, 0));

  return {
    score: { overall, tier: tierFromScore(overall), subScores },
    warnings,
  };
}

// ---- Wiener deconvolution data quality ----

export interface WienerQualityInput {
  /** Total number of samples in the signal */
  sampleCount: number;
  /** Sample rate in Hz */
  sampleRateHz: number;
  /** RMS of setpoint signal (should be > 0 for meaningful analysis) */
  setpointRMS: number;
  /** Per-axis coherence mean (0-1, higher = better signal-to-noise) */
  coherenceMean?: { roll: number; pitch: number; yaw: number };
}

/**
 * Score the quality of Wiener deconvolution input data.
 *
 * Sub-scores:
 * - Signal duration (weight 0.30): 10s+ = 100, <2s = 0
 * - Sample rate (weight 0.20): 4kHz+ = 100, <1kHz = 0
 * - Setpoint activity (weight 0.30): RMS > 50 deg/s = 100, 0 = 0
 * - Axis coverage (weight 0.20): all 3 axes active = 100
 */
export function scoreWienerDataQuality(input: WienerQualityInput): {
  score: DataQualityScore;
  warnings: AnalysisWarning[];
} {
  const { sampleCount, sampleRateHz, setpointRMS } = input;
  const warnings: AnalysisWarning[] = [];

  // Sub-score: signal duration
  const durationS = sampleCount / sampleRateHz;
  // Linear 2s→0, 10s→100
  const durationScore = clamp100(((durationS - 2) / 8) * 100);

  if (durationS < 5) {
    warnings.push({
      code: 'short_hover_time',
      message: `Flight data is only ${durationS.toFixed(1)}s long. At least 10 seconds of flight data is recommended for reliable transfer function estimation.`,
      severity: durationS < 2 ? 'error' : 'warning',
    });
  }

  // Sub-score: sample rate
  // Linear 1kHz→0, 4kHz→100
  const sampleRateScore = clamp100(((sampleRateHz - 1000) / 3000) * 100);

  if (sampleRateHz < 2000) {
    warnings.push({
      code: 'low_logging_rate',
      message: `Logging rate is ${sampleRateHz} Hz. At least 4 kHz is recommended for accurate transfer function estimation.`,
      severity: sampleRateHz < 1000 ? 'error' : 'warning',
    });
  }

  // Sub-score: setpoint activity (RMS of setpoint signal)
  // Linear 0→0, 50→100
  const activityScore = clamp100((setpointRMS / 50) * 100);

  if (setpointRMS < 10) {
    warnings.push({
      code: 'low_step_magnitude',
      message: `Very little stick activity detected (RMS: ${setpointRMS.toFixed(0)} deg/s). Fly more actively for better transfer function estimation.`,
      severity: setpointRMS < 1 ? 'error' : 'warning',
    });
  }

  // Sub-score: axis coverage from coherence
  let axisCoverageScore = 50; // default when coherence not available
  if (input.coherenceMean) {
    const axisCoherences = [
      { name: 'Roll', value: input.coherenceMean.roll },
      { name: 'Pitch', value: input.coherenceMean.pitch },
      { name: 'Yaw', value: input.coherenceMean.yaw },
    ];
    const activeAxes = axisCoherences.filter((c) => c.value > 0.3).length;
    axisCoverageScore = clamp100((activeAxes / 3) * 100);

    // Per-axis coherence warnings
    for (const axis of axisCoherences) {
      if (axis.value <= 0.3 && axis.value > 0) {
        warnings.push({
          code: 'low_coherence',
          message: `Low coherence on ${axis.name} axis (${(axis.value * 100).toFixed(0)}%). Transfer function estimate for this axis may be unreliable.`,
          severity: axis.value < 0.15 ? 'warning' : 'info',
        });
      }
    }
  }

  const subScores: DataQualitySubScore[] = [
    { name: 'Signal duration', score: durationScore, weight: 0.3 },
    { name: 'Sample rate', score: sampleRateScore, weight: 0.2 },
    { name: 'Stick activity', score: activityScore, weight: 0.3 },
    { name: 'Axis coverage', score: axisCoverageScore, weight: 0.2 },
  ];

  const overall = clamp100(subScores.reduce((sum, s) => sum + s.score * s.weight, 0));

  return {
    score: { overall, tier: tierFromScore(overall), subScores },
    warnings,
  };
}

// ---- Confidence adjustment ----

/**
 * Downgrade recommendation confidence when data quality is low.
 *
 * - excellent/good → no change
 * - fair → high→medium
 * - poor → high→medium, medium→low
 */
export function adjustFilterConfidenceByQuality(
  recommendations: FilterRecommendation[],
  tier: DataQualityScore['tier']
): FilterRecommendation[] {
  if (tier === 'excellent' || tier === 'good') return recommendations;

  return recommendations.map((rec) => {
    let confidence = rec.confidence;
    if (tier === 'fair') {
      if (confidence === 'high') confidence = 'medium';
    } else if (tier === 'poor') {
      if (confidence === 'high') confidence = 'medium';
      else if (confidence === 'medium') confidence = 'low';
    }
    return confidence !== rec.confidence ? { ...rec, confidence } : rec;
  });
}

export function adjustPIDConfidenceByQuality(
  recommendations: PIDRecommendation[],
  tier: DataQualityScore['tier']
): PIDRecommendation[] {
  if (tier === 'excellent' || tier === 'good') return recommendations;

  return recommendations.map((rec) => {
    let confidence = rec.confidence;
    if (tier === 'fair') {
      if (confidence === 'high') confidence = 'medium';
    } else if (tier === 'poor') {
      if (confidence === 'high') confidence = 'medium';
      else if (confidence === 'medium') confidence = 'low';
    }
    return confidence !== rec.confidence ? { ...rec, confidence } : rec;
  });
}
