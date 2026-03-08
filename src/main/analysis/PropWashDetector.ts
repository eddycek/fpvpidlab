/**
 * Prop wash event detector and analyzer.
 *
 * Detects throttle-down events and measures gyro oscillation energy in the
 * prop wash frequency band (20-90 Hz) during the post-event window.
 * Prop wash manifests as low-frequency oscillation when descending through
 * own propwash turbulence.
 *
 * Algorithm:
 * 1. Scan throttle derivative for sustained drops
 * 2. Extract gyro data in post-event window
 * 3. Compute PSD in prop wash band per axis
 * 4. Score severity against baseline noise floor
 */
import type { BlackboxFlightData } from '@shared/types/blackbox.types';
import type { PropWashEvent, PropWashAnalysis } from '@shared/types/analysis.types';
import { computePowerSpectrum, trimSpectrum } from './FFTCompute';
import { estimateNoiseFloor } from './NoiseAnalyzer';
import {
  PROPWASH_THROTTLE_DROP_RATE,
  PROPWASH_MIN_DROP_DURATION_MS,
  PROPWASH_ANALYSIS_WINDOW_MS,
  PROPWASH_FREQ_MIN_HZ,
  PROPWASH_FREQ_MAX_HZ,
  PROPWASH_SEVERITY_MINIMAL,
  PROPWASH_SEVERITY_SEVERE,
  PROPWASH_MIN_EVENTS,
} from './constants';

/**
 * Normalize a raw throttle value to 0-1 range.
 */
function normalizeThrottle(value: number): number {
  if (value > 1000) return (value - 1000) / 1000;
  if (value > 100) return value / 1000;
  if (value > 1) return value / 100;
  return value;
}

interface ThrottleDropEvent {
  /** Sample index where the drop starts */
  startIndex: number;
  /** Sample index where the drop ends */
  endIndex: number;
  /** Mean throttle derivative during the drop (negative, normalized units/s) */
  dropRate: number;
  /** Timestamp in ms */
  timestampMs: number;
}

/**
 * Detect throttle-down events in the flight data.
 *
 * A throttle-down event is a sustained period where throttle derivative
 * is below -PROPWASH_THROTTLE_DROP_RATE for at least PROPWASH_MIN_DROP_DURATION_MS.
 */
export function detectThrottleDrops(
  throttleValues: Float64Array,
  throttleTime: Float64Array,
  sampleRate: number
): ThrottleDropEvent[] {
  const events: ThrottleDropEvent[] = [];
  const minSamples = Math.max(2, Math.floor((PROPWASH_MIN_DROP_DURATION_MS / 1000) * sampleRate));

  let dropStart = -1;
  let dropSum = 0;

  for (let i = 1; i < throttleValues.length; i++) {
    const dt = 1 / sampleRate;
    const normCur = normalizeThrottle(throttleValues[i]);
    const normPrev = normalizeThrottle(throttleValues[i - 1]);
    const derivative = (normCur - normPrev) / dt;

    if (derivative < -PROPWASH_THROTTLE_DROP_RATE) {
      if (dropStart === -1) {
        dropStart = i;
        dropSum = derivative;
      } else {
        dropSum += derivative;
      }
    } else {
      if (dropStart !== -1 && i - dropStart >= minSamples) {
        const dropCount = i - dropStart;
        events.push({
          startIndex: dropStart,
          endIndex: i,
          dropRate: dropSum / dropCount,
          timestampMs: throttleTime[dropStart] * 1000,
        });
      }
      dropStart = -1;
      dropSum = 0;
    }
  }

  // Handle trailing drop
  if (dropStart !== -1 && throttleValues.length - dropStart >= minSamples) {
    const dropCount = throttleValues.length - dropStart;
    events.push({
      startIndex: dropStart,
      endIndex: throttleValues.length,
      dropRate: dropSum / dropCount,
      timestampMs: throttleTime[dropStart] * 1000,
    });
  }

  return events;
}

/**
 * Compute band energy from a power spectrum in a given frequency range.
 * Magnitudes are in dB, so convert to linear domain for summation.
 */
function bandEnergy(
  frequencies: Float64Array,
  magnitudes: Float64Array,
  minHz: number,
  maxHz: number
): number {
  let energy = 0;
  for (let i = 0; i < frequencies.length; i++) {
    if (frequencies[i] >= minHz && frequencies[i] <= maxHz) {
      energy += Math.pow(10, magnitudes[i] / 10);
    }
  }
  return energy;
}

/**
 * Compute baseline noise floor energy in the prop wash band.
 * Uses the entire flight's gyro data as baseline.
 */
function computeBaselineEnergy(gyroValues: Float64Array, sampleRate: number): number {
  if (gyroValues.length < 256) return 1; // Prevent division by zero
  const spectrum = computePowerSpectrum(gyroValues, sampleRate);
  const trimmed = trimSpectrum(spectrum, PROPWASH_FREQ_MIN_HZ, PROPWASH_FREQ_MAX_HZ);
  const energy = bandEnergy(
    trimmed.frequencies,
    trimmed.magnitudes,
    PROPWASH_FREQ_MIN_HZ,
    PROPWASH_FREQ_MAX_HZ
  );
  return Math.max(energy, 1e-10); // Prevent division by zero
}

/**
 * Find the peak frequency in a spectrum (frequency with highest magnitude).
 */
function findPeakFrequency(frequencies: Float64Array, magnitudes: Float64Array): number {
  let maxMag = -Infinity;
  let peakFreq = 0;
  for (let i = 0; i < frequencies.length; i++) {
    if (magnitudes[i] > maxMag) {
      maxMag = magnitudes[i];
      peakFreq = frequencies[i];
    }
  }
  return peakFreq;
}

/**
 * Analyze prop wash events in flight data.
 *
 * @param flightData - Parsed Blackbox flight data
 * @returns Prop wash analysis or undefined if insufficient data
 */
export function analyzePropWash(flightData: BlackboxFlightData): PropWashAnalysis | undefined {
  const throttle = flightData.setpoint[3];
  if (!throttle || throttle.values.length < 256) return undefined;

  const sampleRate = flightData.sampleRateHz;
  const windowSamples = Math.floor((PROPWASH_ANALYSIS_WINDOW_MS / 1000) * sampleRate);

  // Step 1: Detect throttle-down events
  const drops = detectThrottleDrops(throttle.values, throttle.time, sampleRate);
  if (drops.length === 0) return undefined;

  // Step 2: Compute baseline energy per axis (whole flight)
  const baselineEnergy: [number, number, number] = [
    computeBaselineEnergy(flightData.gyro[0].values, sampleRate),
    computeBaselineEnergy(flightData.gyro[1].values, sampleRate),
    computeBaselineEnergy(flightData.gyro[2].values, sampleRate),
  ];

  // Step 3: Analyze each event
  const events: PropWashEvent[] = [];

  for (const drop of drops) {
    // Post-event window starts at end of throttle drop
    const windowStart = drop.endIndex;
    const windowEnd = Math.min(windowStart + windowSamples, flightData.gyro[0].values.length);

    if (windowEnd - windowStart < 128) continue; // Too few samples for FFT

    const axisEnergy = { roll: 0, pitch: 0, yaw: 0 };
    const axisNames = ['roll', 'pitch', 'yaw'] as const;
    let combinedPeakFreq = 0;
    let maxAxisEnergy = 0;

    for (let axis = 0; axis < 3; axis++) {
      const gyroSlice = flightData.gyro[axis].values.subarray(windowStart, windowEnd);
      const spectrum = computePowerSpectrum(gyroSlice, sampleRate);
      const trimmed = trimSpectrum(spectrum, PROPWASH_FREQ_MIN_HZ, PROPWASH_FREQ_MAX_HZ);

      const energy = bandEnergy(
        trimmed.frequencies,
        trimmed.magnitudes,
        PROPWASH_FREQ_MIN_HZ,
        PROPWASH_FREQ_MAX_HZ
      );

      axisEnergy[axisNames[axis]] = energy;

      if (energy > maxAxisEnergy) {
        maxAxisEnergy = energy;
        combinedPeakFreq = findPeakFrequency(trimmed.frequencies, trimmed.magnitudes);
      }
    }

    // Severity = ratio of event energy to baseline
    const totalEventEnergy = axisEnergy.roll + axisEnergy.pitch + axisEnergy.yaw;
    const totalBaselineEnergy = baselineEnergy[0] + baselineEnergy[1] + baselineEnergy[2];
    const severityRatio = totalEventEnergy / totalBaselineEnergy;

    const durationMs = ((windowEnd - windowStart) / sampleRate) * 1000;

    events.push({
      timestampMs: drop.timestampMs,
      throttleDropRate: drop.dropRate,
      durationMs,
      peakFrequencyHz: combinedPeakFreq,
      severityRatio,
      axisEnergy,
    });
  }

  if (events.length === 0) return undefined;

  // Step 4: Aggregate results
  const meanSeverity = events.reduce((s, e) => s + e.severityRatio, 0) / events.length;

  // Find worst axis across all events
  const axisTotals = { roll: 0, pitch: 0, yaw: 0 };
  for (const event of events) {
    axisTotals.roll += event.axisEnergy.roll;
    axisTotals.pitch += event.axisEnergy.pitch;
    axisTotals.yaw += event.axisEnergy.yaw;
  }
  const worstAxis =
    axisTotals.roll >= axisTotals.pitch && axisTotals.roll >= axisTotals.yaw
      ? 'roll'
      : axisTotals.pitch >= axisTotals.yaw
        ? 'pitch'
        : 'yaw';

  // Dominant frequency: frequency that appears most across events
  const freqBuckets = new Map<number, number>();
  for (const event of events) {
    const bucket = Math.round(event.peakFrequencyHz / 5) * 5; // 5 Hz buckets
    freqBuckets.set(bucket, (freqBuckets.get(bucket) || 0) + 1);
  }
  let dominantFrequencyHz = events[0].peakFrequencyHz;
  let maxCount = 0;
  for (const [freq, count] of freqBuckets) {
    if (count > maxCount) {
      maxCount = count;
      dominantFrequencyHz = freq;
    }
  }

  // Generate recommendation
  const recommendation = generateRecommendation(meanSeverity, worstAxis, events.length);

  return {
    events,
    meanSeverity,
    worstAxis,
    dominantFrequencyHz,
    recommendation,
  };
}

/**
 * Generate a human-readable prop wash recommendation.
 */
function generateRecommendation(
  meanSeverity: number,
  worstAxis: string,
  eventCount: number
): string {
  if (eventCount < PROPWASH_MIN_EVENTS) {
    return `Only ${eventCount} prop wash event${eventCount === 1 ? '' : 's'} detected — fly more aggressive descents for reliable analysis.`;
  }

  if (meanSeverity < PROPWASH_SEVERITY_MINIMAL) {
    return 'Prop wash handling looks good — minimal oscillation detected during descents.';
  }

  if (meanSeverity >= PROPWASH_SEVERITY_SEVERE) {
    return `Severe prop wash detected (${meanSeverity.toFixed(1)}x baseline), worst on ${worstAxis}. Consider increasing D-term or checking for mechanical issues (loose props, damaged frame arms).`;
  }

  return `Moderate prop wash detected (${meanSeverity.toFixed(1)}x baseline), mostly on ${worstAxis}. A slight D-term increase may help tame the oscillation.`;
}
