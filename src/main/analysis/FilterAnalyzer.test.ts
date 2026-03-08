import { describe, it, expect, vi } from 'vitest';
import { analyze } from './FilterAnalyzer';
import type { BlackboxFlightData, TimeSeries } from '@shared/types/blackbox.types';
import type { AnalysisProgress, CurrentFilterSettings } from '@shared/types/analysis.types';
import { DEFAULT_FILTER_SETTINGS } from '@shared/types/analysis.types';

/**
 * Create flight data with controllable noise characteristics.
 */
function createFlightData(opts: {
  sampleRate: number;
  durationS: number;
  throttle?: number;
  noiseFreqHz?: number;
  noiseAmplitude?: number;
  backgroundNoise?: number;
}): BlackboxFlightData {
  const {
    sampleRate,
    durationS,
    throttle = 0.5,
    noiseFreqHz = 0,
    noiseAmplitude = 0,
    backgroundNoise = 0,
  } = opts;
  const numSamples = Math.floor(sampleRate * durationS);

  function makeSeries(fn: (i: number) => number): TimeSeries {
    const time = new Float64Array(numSamples);
    const values = new Float64Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      time[i] = i / sampleRate;
      values[i] = fn(i);
    }
    return { time, values };
  }

  const gyroFn = (i: number) => {
    let v = 0;
    if (noiseFreqHz > 0) {
      v += noiseAmplitude * Math.sin((2 * Math.PI * noiseFreqHz * i) / sampleRate);
    }
    if (backgroundNoise > 0) {
      v += (Math.random() - 0.5) * backgroundNoise;
    }
    return v;
  };

  const zeroSeries = makeSeries(() => 0);
  const throttleSeries = makeSeries(() => throttle);

  return {
    gyro: [makeSeries(gyroFn), makeSeries(gyroFn), makeSeries(gyroFn)],
    setpoint: [zeroSeries, zeroSeries, zeroSeries, throttleSeries],
    pidP: [zeroSeries, zeroSeries, zeroSeries],
    pidI: [zeroSeries, zeroSeries, zeroSeries],
    pidD: [zeroSeries, zeroSeries, zeroSeries],
    pidF: [zeroSeries, zeroSeries, zeroSeries],
    motor: [zeroSeries, zeroSeries, zeroSeries, zeroSeries],
    debug: [],
    sampleRateHz: sampleRate,
    durationSeconds: durationS,
    frameCount: numSamples,
  };
}

describe('analyze', () => {
  it('should return a complete FilterAnalysisResult', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 2,
      backgroundNoise: 1,
    });

    const result = await analyze(data, 0);

    expect(result.noise).toBeDefined();
    expect(result.noise.roll).toBeDefined();
    expect(result.noise.pitch).toBeDefined();
    expect(result.noise.yaw).toBeDefined();
    expect(result.noise.overallLevel).toMatch(/low|medium|high/);
    expect(result.recommendations).toBeDefined();
    expect(Array.isArray(result.recommendations)).toBe(true);
    expect(result.summary).toBeDefined();
    expect(result.summary.length).toBeGreaterThan(10);
    expect(result.analysisTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.sessionIndex).toBe(0);
    expect(result.segmentsUsed).toBeGreaterThanOrEqual(0);
  });

  it('should report progress during analysis', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 2,
      backgroundNoise: 0.5,
    });

    const progressUpdates: AnalysisProgress[] = [];
    await analyze(data, 0, DEFAULT_FILTER_SETTINGS, (progress) => {
      progressUpdates.push({ ...progress });
    });

    expect(progressUpdates.length).toBeGreaterThan(0);
    // Should start with segmenting
    expect(progressUpdates[0].step).toBe('segmenting');
    // Should end at 100%
    expect(progressUpdates[progressUpdates.length - 1].percent).toBe(100);
    // Should cover all steps
    const steps = new Set(progressUpdates.map((p) => p.step));
    expect(steps.has('segmenting')).toBe(true);
    expect(steps.has('fft')).toBe(true);
    expect(steps.has('recommending')).toBe(true);
  });

  it('should detect noise peaks from synthetic signal', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 3,
      noiseFreqHz: 150,
      noiseAmplitude: 10,
      backgroundNoise: 0.1,
    });

    const result = await analyze(data, 0);

    // Should detect a peak near 150 Hz on at least one axis
    const allPeaks = [...result.noise.roll.peaks, ...result.noise.pitch.peaks];
    const peak150 = allPeaks.find((p) => Math.abs(p.frequency - 150) < 30);
    expect(peak150).toBeDefined();
  });

  it('should handle very short flight data', async () => {
    // Only 0.1 seconds of data
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 0.1,
      backgroundNoise: 0.5,
    });

    // Should not throw
    const result = await analyze(data, 0);
    expect(result).toBeDefined();
    // Will fall back to analyzing entire flight since no segments meet min duration
    expect(result.segmentsUsed).toBe(0);
  });

  it('should use correct session index in result', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 1,
      backgroundNoise: 0.5,
    });

    const result = await analyze(data, 3);
    expect(result.sessionIndex).toBe(3);
  });

  it('should accept custom filter settings', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 2,
      noiseFreqHz: 150,
      noiseAmplitude: 10,
      backgroundNoise: 0.5,
    });

    const customSettings: CurrentFilterSettings = {
      ...DEFAULT_FILTER_SETTINGS,
      gyro_lpf1_static_hz: 100, // Already very low
    };

    const result = await analyze(data, 0, customSettings);
    // Shouldn't recommend going below minimum
    const gyroRec = result.recommendations.find((r) => r.setting === 'gyro_lpf1_static_hz');
    if (gyroRec) {
      expect(gyroRec.recommendedValue).toBeGreaterThanOrEqual(100);
    }
  });

  it('should complete analysis in reasonable time', async () => {
    const data = createFlightData({
      sampleRate: 8000,
      durationS: 5, // 40,000 samples
      backgroundNoise: 1,
    });

    const start = performance.now();
    const result = await analyze(data, 0);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(15000); // CI runners may be slower than local
    expect(result.analysisTimeMs).toBeGreaterThan(0);
  });

  it('should handle flight with no hover segments (all ground)', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 2,
      throttle: 0.05, // Below hover threshold
      backgroundNoise: 0.5,
    });

    const result = await analyze(data, 0);
    expect(result.segmentsUsed).toBe(0);
    // Should still produce a result (fallback to entire flight)
    expect(result.noise).toBeDefined();
  });

  it('should include no_sweep_segments warning when falling back to entire flight', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 2,
      throttle: 0.05, // Below hover threshold — no segments found
      backgroundNoise: 0.5,
    });

    const result = await analyze(data, 0);
    expect(result.segmentsUsed).toBe(0);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBeGreaterThan(0);
    expect(result.warnings![0].code).toBe('no_sweep_segments');
    expect(result.warnings![0].severity).toBe('warning');
  });

  it('should not include no_sweep_segments warning when segments are found', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 3,
      throttle: 0.5,
      backgroundNoise: 0.5,
    });

    const result = await analyze(data, 0);
    const sweepWarning = (result.warnings ?? []).find((w) => w.code === 'no_sweep_segments');
    expect(sweepWarning).toBeUndefined();
  });

  it('should produce deterministic noise levels for clean vs noisy signals', async () => {
    const cleanData = createFlightData({
      sampleRate: 4000,
      durationS: 2,
      backgroundNoise: 0.01,
    });

    const noisyData = createFlightData({
      sampleRate: 4000,
      durationS: 2,
      backgroundNoise: 100,
    });

    const cleanResult = await analyze(cleanData, 0);
    const noisyResult = await analyze(noisyData, 0);

    // Noisy signal should have higher noise floor
    expect(noisyResult.noise.roll.noiseFloorDb).toBeGreaterThan(
      cleanResult.noise.roll.noiseFloorDb
    );
  });

  it('should propagate rpmFilterActive=true when RPM filter settings present', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 2,
      backgroundNoise: 0.5,
    });

    const settings: CurrentFilterSettings = {
      ...DEFAULT_FILTER_SETTINGS,
      rpm_filter_harmonics: 3,
      rpm_filter_min_hz: 100,
    };

    const result = await analyze(data, 0, settings);
    expect(result.rpmFilterActive).toBe(true);
  });

  it('should propagate rpmFilterActive=false when RPM filter is disabled', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 2,
      backgroundNoise: 0.5,
    });

    const settings: CurrentFilterSettings = {
      ...DEFAULT_FILTER_SETTINGS,
      rpm_filter_harmonics: 0,
    };

    const result = await analyze(data, 0, settings);
    expect(result.rpmFilterActive).toBe(false);
  });

  it('should propagate rpmFilterActive=false when RPM data is undefined', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 2,
      backgroundNoise: 0.5,
    });

    const result = await analyze(data, 0, DEFAULT_FILTER_SETTINGS);
    expect(result.rpmFilterActive).toBe(false);
  });

  it('should include dataQuality score in result', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 3,
      backgroundNoise: 0.5,
    });

    const result = await analyze(data, 0);
    expect(result.dataQuality).toBeDefined();
    expect(result.dataQuality!.overall).toBeGreaterThanOrEqual(0);
    expect(result.dataQuality!.overall).toBeLessThanOrEqual(100);
    expect(['excellent', 'good', 'fair', 'poor']).toContain(result.dataQuality!.tier);
    expect(result.dataQuality!.subScores.length).toBeGreaterThan(0);
  });

  it('should include dataQuality in fallback (no segments) result', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 2,
      throttle: 0.05,
      backgroundNoise: 0.5,
    });

    const result = await analyze(data, 0);
    expect(result.dataQuality).toBeDefined();
    expect(result.dataQuality!.tier).toBe('poor');
  });

  it('should include throttleSpectrogram when throttle data has sufficient samples', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 5,
      backgroundNoise: 1,
    });

    const result = await analyze(data, 0);

    // With constant 50% throttle and 20000 samples, all in one band ≥ 512
    expect(result.throttleSpectrogram).toBeDefined();
    expect(result.throttleSpectrogram!.bands.length).toBe(10);
    expect(result.throttleSpectrogram!.bandsWithData).toBeGreaterThan(0);
  });

  it('should omit throttleSpectrogram when no band has sufficient data', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 0.1, // Very short → ~400 samples total, ~40 per band
      backgroundNoise: 0.5,
    });

    const result = await analyze(data, 0);

    // Too few samples per band → no spectrogram
    expect(result.throttleSpectrogram).toBeUndefined();
  });

  it('should include groupDelay with default settings', async () => {
    const data = createFlightData({
      sampleRate: 4000,
      durationS: 2,
      backgroundNoise: 0.5,
    });

    const result = await analyze(data, 0);

    expect(result.groupDelay).toBeDefined();
    expect(result.groupDelay!.gyroTotalMs).toBeGreaterThan(0);
    expect(result.groupDelay!.dtermTotalMs).toBeGreaterThan(0);
    expect(result.groupDelay!.filters.length).toBeGreaterThan(0);
    expect(result.groupDelay!.referenceFreqHz).toBe(80);
  });
});
