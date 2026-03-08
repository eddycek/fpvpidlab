/**
 * Top-level PID analysis orchestrator.
 *
 * Coordinates the full pipeline: step detection → metrics → recommendation.
 * This is the main entry point for PID step-response analysis.
 */
import type { BlackboxFlightData } from '@shared/types/blackbox.types';
import type { PIDConfiguration } from '@shared/types/pid.types';
import type { FlightStyle } from '@shared/types/profile.types';
import type {
  AnalysisProgress,
  AnalysisWarning,
  AxisStepProfile,
  BayesianSuggestion,
  PIDAnalysisResult,
  StepResponse,
} from '@shared/types/analysis.types';
import { detectSteps } from './StepDetector';
import {
  computeStepResponse,
  aggregateAxisMetrics,
  classifyFFContribution,
  computeFFEnergyRatio,
  computeAdaptiveWindowMs,
} from './StepMetrics';
import { recommendPID, generatePIDSummary, extractFeedforwardContext } from './PIDRecommender';
import { scorePIDDataQuality, adjustPIDConfidenceByQuality } from './DataQualityScorer';
import { estimateAllAxes, type TransferFunctionResult } from './TransferFunctionEstimator';
import { STEP_RESPONSE_WINDOW_MAX_MS } from './constants';
import { analyzeCrossAxisCoupling } from './CrossAxisDetector';
import { analyzePropWash } from './PropWashDetector';
import { suggestNextPID, type PIDObservation } from './BayesianPIDOptimizer';
import { analyzeDTermEffectiveness } from './DTermAnalyzer';
import { mapToSliders, computeSliderDelta, buildRecommendedPIDs } from './SliderMapper';

/** Default PID configuration if none provided */
const DEFAULT_PIDS: PIDConfiguration = {
  roll: { P: 45, I: 80, D: 30 },
  pitch: { P: 47, I: 84, D: 32 },
  yaw: { P: 45, I: 80, D: 0 },
};

/**
 * Run the full PID analysis pipeline on parsed flight data.
 *
 * @param flightData - Parsed Blackbox flight data for one session
 * @param sessionIndex - Which session is being analyzed
 * @param currentPIDs - Current PID configuration from the FC
 * @param onProgress - Optional progress callback
 * @param flightPIDs - PIDs from the BBL header (flight-time PIDs) for convergent recommendations
 * @param rawHeaders - BBL raw headers for feedforward context extraction
 * @param flightStyle - Pilot's flying style preference (affects thresholds)
 * @param historyObservations - Optional historical (PID gains -> quality score) data for Bayesian optimization
 * @returns Complete PID analysis result with recommendations
 */
export async function analyzePID(
  flightData: BlackboxFlightData,
  sessionIndex: number = 0,
  currentPIDs: PIDConfiguration = DEFAULT_PIDS,
  onProgress?: (progress: AnalysisProgress) => void,
  flightPIDs?: PIDConfiguration,
  rawHeaders?: Map<string, string>,
  flightStyle: FlightStyle = 'balanced',
  historyObservations?: PIDObservation[]
): Promise<PIDAnalysisResult> {
  const startTime = performance.now();

  // Step 1: Detect step inputs with generous window for adaptive sizing
  onProgress?.({ step: 'detecting', percent: 5 });
  const firstPassSteps = detectSteps(flightData, STEP_RESPONSE_WINDOW_MAX_MS);

  await yieldToEventLoop();

  // Step 1b: First-pass metrics to determine adaptive window
  const firstPassResponses: StepResponse[] = [];
  for (const step of firstPassSteps) {
    firstPassResponses.push(
      computeStepResponse(
        flightData.setpoint[step.axis],
        flightData.gyro[step.axis],
        step,
        flightData.sampleRateHz
      )
    );
  }
  const adaptiveWindowMs = computeAdaptiveWindowMs(firstPassResponses);

  await yieldToEventLoop();

  // Step 2: Re-detect with adaptive window (skip if same as first pass)
  onProgress?.({ step: 'detecting', percent: 10 });
  const steps =
    adaptiveWindowMs === STEP_RESPONSE_WINDOW_MAX_MS
      ? firstPassSteps
      : detectSteps(flightData, adaptiveWindowMs);

  await yieldToEventLoop();

  // Step 3: Compute metrics for each step with adaptive window
  onProgress?.({ step: 'measuring', percent: 30 });

  const rollResponses: StepResponse[] = [];
  const pitchResponses: StepResponse[] = [];
  const yawResponses: StepResponse[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const response = computeStepResponse(
      flightData.setpoint[step.axis],
      flightData.gyro[step.axis],
      step,
      flightData.sampleRateHz
    );

    // Classify FF contribution when pidP/pidF available
    if (flightData.pidP[step.axis] && flightData.pidF[step.axis]) {
      // Energy-based FF ratio (robust, uses entire response window)
      const energyRatio = computeFFEnergyRatio(
        step,
        flightData.pidP[step.axis],
        flightData.pidF[step.axis]
      );
      if (energyRatio !== undefined) {
        response.ffEnergyRatio = energyRatio;
        response.ffDominated = energyRatio > 0.6;
      } else {
        // Fallback: single-sample peak comparison (legacy)
        const ffResult = classifyFFContribution(
          response,
          flightData.pidP[step.axis],
          flightData.pidF[step.axis],
          flightData.gyro[step.axis]
        );
        if (ffResult !== undefined) {
          response.ffDominated = ffResult;
        }
      }
    }

    if (step.axis === 0) rollResponses.push(response);
    else if (step.axis === 1) pitchResponses.push(response);
    else yawResponses.push(response);

    // Report progress within measuring phase (30-70%)
    if (steps.length > 0) {
      const pct = 30 + ((i + 1) / steps.length) * 40;
      onProgress?.({ step: 'measuring', percent: Math.round(pct) });
    }

    // Yield periodically to avoid blocking
    if (i % 10 === 9) {
      await yieldToEventLoop();
    }
  }

  // Aggregate metrics per axis
  const roll = aggregateAxisMetrics(rollResponses);
  const pitch = aggregateAxisMetrics(pitchResponses);
  const yaw = aggregateAxisMetrics(yawResponses);

  await yieldToEventLoop();

  // Score data quality
  const qualityResult = scorePIDDataQuality({
    totalSteps: steps.length,
    axisResponses: { roll: rollResponses, pitch: pitchResponses, yaw: yawResponses },
  });

  // Detect cross-axis coupling
  const crossAxisCoupling = analyzeCrossAxisCoupling(steps, flightData);

  // Extract feedforward context before recommendations (needed for FF-aware rules)
  const feedforwardContext = rawHeaders ? extractFeedforwardContext(rawHeaders) : undefined;

  // Step 2b: Prop wash analysis (runs on any flight with throttle data)
  const propWash = analyzePropWash(flightData);

  // Step 2c: D-term effectiveness analysis
  const dTermEffectiveness = analyzeDTermEffectiveness(flightData);

  // Step 3: Generate recommendations
  onProgress?.({ step: 'scoring', percent: 80 });
  const rawRecommendations = recommendPID(
    roll,
    pitch,
    yaw,
    currentPIDs,
    flightPIDs,
    feedforwardContext,
    flightStyle,
    undefined, // tfMetrics
    dTermEffectiveness
  );
  const recommendations = adjustPIDConfidenceByQuality(
    rawRecommendations,
    qualityResult.score.tier
  );
  const summary = generatePIDSummary(roll, pitch, yaw, recommendations, flightStyle);

  onProgress?.({ step: 'scoring', percent: 100 });

  const warnings: AnalysisWarning[] = [...qualityResult.warnings];
  if (feedforwardContext?.active) {
    warnings.push({
      code: 'feedforward_active',
      message:
        'Feedforward is active on this flight. Overshoot and rise time measurements include feedforward contribution — some overshoot may be from FF rather than P/D imbalance.',
      severity: 'info',
    });
  }

  // Bayesian PID optimization (if history available)
  let bayesianSuggestion: BayesianSuggestion | undefined;
  if (historyObservations && historyObservations.length >= 3) {
    bayesianSuggestion = suggestNextPID(historyObservations) ?? undefined;
  }

  return {
    roll,
    pitch,
    yaw,
    recommendations,
    summary,
    analysisTimeMs: Math.round(performance.now() - startTime),
    sessionIndex,
    stepsDetected: steps.length,
    currentPIDs,
    feedforwardContext,
    flightStyle,
    dataQuality: qualityResult.score,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(crossAxisCoupling ? { crossAxisCoupling } : {}),
    ...(propWash ? { propWash } : {}),
    ...(bayesianSuggestion ? { bayesianSuggestion } : {}),
    ...(dTermEffectiveness ? { dTermEffectiveness } : {}),
    sliderPosition: mapToSliders(currentPIDs),
    ...(recommendations.length > 0
      ? {
          sliderDelta: computeSliderDelta(
            currentPIDs,
            buildRecommendedPIDs(currentPIDs, recommendations)
          ),
        }
      : {}),
  };
}

/**
 * Run PID analysis using Wiener deconvolution (transfer function estimation).
 *
 * Works with any flight data — no stick snaps required. Produces the same
 * PIDAnalysisResult shape as step-based analysis for downstream compatibility.
 *
 * @param flightData - Parsed Blackbox flight data for one session
 * @param sessionIndex - Which session is being analyzed
 * @param currentPIDs - Current PID configuration from the FC
 * @param onProgress - Optional progress callback
 * @param flightPIDs - PIDs from BBL header for convergent recommendations
 * @param rawHeaders - BBL raw headers for feedforward context
 * @param flightStyle - Pilot's flying style preference
 * @returns PID analysis result with analysisMethod='wiener_deconvolution'
 */
export async function analyzeTransferFunction(
  flightData: BlackboxFlightData,
  sessionIndex: number = 0,
  currentPIDs: PIDConfiguration = DEFAULT_PIDS,
  onProgress?: (progress: AnalysisProgress) => void,
  flightPIDs?: PIDConfiguration,
  rawHeaders?: Map<string, string>,
  flightStyle: FlightStyle = 'balanced'
): Promise<PIDAnalysisResult & { transferFunction: TransferFunctionResult }> {
  const startTime = performance.now();

  onProgress?.({ step: 'detecting', percent: 5 });

  // Estimate transfer function for all axes
  const tfResult = estimateAllAxes(
    {
      roll: flightData.setpoint[0].values,
      pitch: flightData.setpoint[1].values,
      yaw: flightData.setpoint[2].values,
    },
    {
      roll: flightData.gyro[0].values,
      pitch: flightData.gyro[1].values,
      yaw: flightData.gyro[2].values,
    },
    flightData.sampleRateHz,
    (p) => {
      // Map TF progress (0-100) to analysis progress (5-70)
      onProgress?.({ step: 'measuring', percent: 5 + Math.round(p.percent * 0.65) });
    }
  );

  await yieldToEventLoop();

  // Build AxisStepProfile from synthetic step response metrics
  const axes = ['roll', 'pitch', 'yaw'] as const;
  const profiles: Record<string, AxisStepProfile> = {};

  for (const axis of axes) {
    const m = tfResult.metrics[axis];
    profiles[axis] = {
      responses: [], // No individual step responses (Wiener produces a single synthetic response)
      meanOvershoot: m.overshootPercent,
      meanRiseTimeMs: m.riseTimeMs,
      meanSettlingTimeMs: m.settlingTimeMs,
      meanLatencyMs: 0, // Not directly measurable from transfer function
      meanTrackingErrorRMS: 0, // Not applicable for synthetic response
      meanSteadyStateError: 0, // Not applicable for synthetic response
    };
  }

  // Extract feedforward context
  const feedforwardContext = rawHeaders ? extractFeedforwardContext(rawHeaders) : undefined;

  // Generate recommendations using the same PIDRecommender with TF metrics
  onProgress?.({ step: 'scoring', percent: 80 });
  const rawRecommendations = recommendPID(
    profiles.roll as AxisStepProfile,
    profiles.pitch as AxisStepProfile,
    profiles.yaw as AxisStepProfile,
    currentPIDs,
    flightPIDs,
    feedforwardContext,
    flightStyle,
    {
      roll: tfResult.metrics.roll,
      pitch: tfResult.metrics.pitch,
      yaw: tfResult.metrics.yaw,
    }
  );

  // Cap confidence at 'medium' for Wiener-derived recommendations
  const recommendations = rawRecommendations.map((r) => ({
    ...r,
    confidence: r.confidence === 'high' ? ('medium' as const) : r.confidence,
  }));

  const summary = generatePIDSummary(
    profiles.roll as AxisStepProfile,
    profiles.pitch as AxisStepProfile,
    profiles.yaw as AxisStepProfile,
    recommendations,
    flightStyle
  );

  onProgress?.({ step: 'scoring', percent: 100 });

  const warnings: AnalysisWarning[] = [];
  if (feedforwardContext?.active) {
    warnings.push({
      code: 'feedforward_active',
      message:
        'Feedforward is active. Transfer function includes FF contribution — some overshoot may be from FF.',
      severity: 'info',
    });
  }

  return {
    roll: profiles.roll as AxisStepProfile,
    pitch: profiles.pitch as AxisStepProfile,
    yaw: profiles.yaw as AxisStepProfile,
    recommendations,
    summary,
    analysisTimeMs: Math.round(performance.now() - startTime),
    sessionIndex,
    stepsDetected: 0, // No actual steps detected
    currentPIDs,
    feedforwardContext,
    flightStyle,
    analysisMethod: 'wiener_deconvolution',
    ...(warnings.length > 0 ? { warnings } : {}),
    transferFunction: tfResult,
    sliderPosition: mapToSliders(currentPIDs),
    ...(recommendations.length > 0
      ? {
          sliderDelta: computeSliderDelta(
            currentPIDs,
            buildRecommendedPIDs(currentPIDs, recommendations)
          ),
        }
      : {}),
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
