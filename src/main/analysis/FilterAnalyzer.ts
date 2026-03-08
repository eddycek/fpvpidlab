/**
 * Top-level filter analysis orchestrator.
 *
 * Coordinates the full pipeline: segment selection → FFT → noise analysis → recommendations.
 * This is the main entry point for the analysis module.
 */
import type { BlackboxFlightData } from '@shared/types/blackbox.types';
import type {
  FilterAnalysisResult,
  AnalysisProgress,
  AnalysisWarning,
  CurrentFilterSettings,
  DataQualityScore,
  PowerSpectrum,
  ThrottleSpectrogramResult,
} from '@shared/types/analysis.types';
import { DEFAULT_FILTER_SETTINGS } from '@shared/types/analysis.types';
import { findSteadySegments, findThrottleSweepSegments } from './SegmentSelector';
import { computePowerSpectrum, trimSpectrum } from './FFTCompute';
import { analyzeAxisNoise, buildNoiseProfile } from './NoiseAnalyzer';
import { recommend, generateSummary, isRpmFilterActive } from './FilterRecommender';
import { scoreFilterDataQuality, adjustFilterConfidenceByQuality } from './DataQualityScorer';
import { computeThrottleSpectrogram } from './ThrottleSpectrogramAnalyzer';
import { estimateGroupDelay } from './GroupDelayEstimator';
import { FFT_WINDOW_SIZE, FREQUENCY_MIN_HZ, FREQUENCY_MAX_HZ } from './constants';

/** Maximum number of segments to use (more = slower but more accurate) */
const MAX_SEGMENTS = 5;

/**
 * Run the full filter analysis pipeline on parsed flight data.
 *
 * @param flightData - Parsed Blackbox flight data for one session
 * @param sessionIndex - Which session is being analyzed
 * @param currentSettings - Current filter settings from the FC
 * @param onProgress - Optional progress callback
 * @returns Complete analysis result with noise profile and recommendations
 */
export async function analyze(
  flightData: BlackboxFlightData,
  sessionIndex: number = 0,
  currentSettings: CurrentFilterSettings = DEFAULT_FILTER_SETTINGS,
  onProgress?: (progress: AnalysisProgress) => void
): Promise<FilterAnalysisResult> {
  const startTime = performance.now();

  // Step 1: Find flight segments — prefer throttle sweeps over steady hovers
  onProgress?.({ step: 'segmenting', percent: 5 });
  const sweepSegments = findThrottleSweepSegments(flightData);
  const steadySegments = findSteadySegments(flightData);

  // Prefer sweeps (higher quality noise data across RPM range), fall back to hovers
  const segments = sweepSegments.length > 0 ? sweepSegments : steadySegments;

  // Use up to MAX_SEGMENTS
  const usedSegments = segments.slice(0, MAX_SEGMENTS);

  // Score data quality
  const qualityResult = scoreFilterDataQuality({
    segments: usedSegments,
    hasSweepSegments: sweepSegments.length > 0,
    flightDurationS: flightData.durationSeconds,
  });

  if (usedSegments.length === 0) {
    // No steady segments found — analyze the entire flight as one segment (with warning)
    const warnings: AnalysisWarning[] = [
      {
        code: 'no_sweep_segments',
        message:
          'No hover or throttle sweep segments found. The entire flight was analyzed, which may include stick transients and reduce accuracy. For best results, fly gentle hovers with smooth throttle sweeps.',
        severity: 'warning',
      },
      ...qualityResult.warnings,
    ];
    return analyzeEntireFlight(
      flightData,
      sessionIndex,
      currentSettings,
      startTime,
      onProgress,
      warnings,
      qualityResult.score
    );
  }

  // Yield to event loop
  await yieldToEventLoop();

  // Step 2: Compute FFT for each segment per axis
  onProgress?.({ step: 'fft', percent: 20 });

  const rollSpectra: PowerSpectrum[] = [];
  const pitchSpectra: PowerSpectrum[] = [];
  const yawSpectra: PowerSpectrum[] = [];

  for (let s = 0; s < usedSegments.length; s++) {
    const seg = usedSegments[s];

    for (let axis = 0; axis < 3; axis++) {
      const gyroValues = flightData.gyro[axis].values.subarray(seg.startIndex, seg.endIndex);
      const spectrum = computePowerSpectrum(gyroValues, flightData.sampleRateHz, FFT_WINDOW_SIZE);
      const trimmed = trimSpectrum(spectrum, FREQUENCY_MIN_HZ, FREQUENCY_MAX_HZ);

      if (axis === 0) rollSpectra.push(trimmed);
      else if (axis === 1) pitchSpectra.push(trimmed);
      else yawSpectra.push(trimmed);
    }

    const fftPercent = 20 + ((s + 1) / usedSegments.length) * 40;
    onProgress?.({ step: 'fft', percent: Math.round(fftPercent) });

    await yieldToEventLoop();
  }

  // Step 3: Noise analysis
  onProgress?.({ step: 'analyzing', percent: 65 });
  const rollNoise = analyzeAxisNoise(rollSpectra);
  const pitchNoise = analyzeAxisNoise(pitchSpectra);
  const yawNoise = analyzeAxisNoise(yawSpectra);
  const noiseProfile = buildNoiseProfile(rollNoise, pitchNoise, yawNoise);

  await yieldToEventLoop();

  // Step 3b: Compute throttle spectrogram
  let throttleSpectrogram: ThrottleSpectrogramResult | undefined;
  if (flightData.setpoint[3]?.values.length > 0) {
    throttleSpectrogram = computeThrottleSpectrogram(flightData);
  }

  await yieldToEventLoop();

  // Step 4: Generate recommendations
  onProgress?.({ step: 'recommending', percent: 85 });
  const rpmActive = isRpmFilterActive(currentSettings);
  const rawRecommendations = recommend(noiseProfile, currentSettings);
  const recommendations = adjustFilterConfidenceByQuality(
    rawRecommendations,
    qualityResult.score.tier
  );
  const summary = generateSummary(noiseProfile, recommendations, rpmActive);

  // Step 5: Estimate group delay
  const groupDelay = estimateGroupDelay(currentSettings);

  onProgress?.({ step: 'recommending', percent: 100 });

  return {
    noise: noiseProfile,
    recommendations,
    summary,
    analysisTimeMs: Math.round(performance.now() - startTime),
    sessionIndex,
    segmentsUsed: usedSegments.length,
    rpmFilterActive: rpmActive,
    dataQuality: qualityResult.score,
    ...(qualityResult.warnings.length > 0 ? { warnings: qualityResult.warnings } : {}),
    ...(throttleSpectrogram?.bandsWithData ? { throttleSpectrogram } : {}),
    groupDelay,
  };
}

/**
 * Fallback: analyze the entire flight when no steady segments are found.
 */
async function analyzeEntireFlight(
  flightData: BlackboxFlightData,
  sessionIndex: number,
  currentSettings: CurrentFilterSettings,
  startTime: number,
  onProgress?: (progress: AnalysisProgress) => void,
  warnings?: AnalysisWarning[],
  dataQuality?: DataQualityScore
): Promise<FilterAnalysisResult> {
  onProgress?.({ step: 'fft', percent: 30 });

  const spectraByAxis: PowerSpectrum[][] = [[], [], []];

  for (let axis = 0; axis < 3; axis++) {
    const gyroValues = flightData.gyro[axis].values;
    if (gyroValues.length < 16) continue;

    const spectrum = computePowerSpectrum(gyroValues, flightData.sampleRateHz, FFT_WINDOW_SIZE);
    spectraByAxis[axis].push(trimSpectrum(spectrum, FREQUENCY_MIN_HZ, FREQUENCY_MAX_HZ));
  }

  await yieldToEventLoop();

  onProgress?.({ step: 'analyzing', percent: 65 });
  const rollNoise = analyzeAxisNoise(spectraByAxis[0]);
  const pitchNoise = analyzeAxisNoise(spectraByAxis[1]);
  const yawNoise = analyzeAxisNoise(spectraByAxis[2]);
  const noiseProfile = buildNoiseProfile(rollNoise, pitchNoise, yawNoise);

  // Compute throttle spectrogram
  let throttleSpectrogram: ThrottleSpectrogramResult | undefined;
  if (flightData.setpoint[3]?.values.length > 0) {
    throttleSpectrogram = computeThrottleSpectrogram(flightData);
  }

  onProgress?.({ step: 'recommending', percent: 85 });
  const rpmActive = isRpmFilterActive(currentSettings);
  const rawRecommendations = recommend(noiseProfile, currentSettings);
  const recommendations = dataQuality
    ? adjustFilterConfidenceByQuality(rawRecommendations, dataQuality.tier)
    : rawRecommendations;
  const summary = generateSummary(noiseProfile, recommendations, rpmActive);

  onProgress?.({ step: 'recommending', percent: 100 });

  const groupDelay = estimateGroupDelay(currentSettings);

  return {
    noise: noiseProfile,
    recommendations,
    summary,
    analysisTimeMs: Math.round(performance.now() - startTime),
    sessionIndex,
    segmentsUsed: 0,
    rpmFilterActive: rpmActive,
    warnings,
    dataQuality,
    ...(throttleSpectrogram?.bandsWithData ? { throttleSpectrogram } : {}),
    groupDelay,
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
