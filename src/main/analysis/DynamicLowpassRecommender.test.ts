import { describe, it, expect } from 'vitest';
import {
  analyzeDynamicLowpass,
  recommendDynamicLowpass,
  DYNAMIC_LOWPASS_NOISE_INCREASE_DB,
  DYNAMIC_LOWPASS_MIN_CORRELATION,
} from './DynamicLowpassRecommender';
import type { ThrottleSpectrogramResult, ThrottleBand } from '@shared/types/analysis.types';

function makeBand(
  throttleMin: number,
  throttleMax: number,
  noiseFloorDb: [number, number, number]
): ThrottleBand {
  return {
    throttleMin,
    throttleMax,
    sampleCount: 5000,
    noiseFloorDb,
  };
}

function makeSpectrogram(bands: ThrottleBand[]): ThrottleSpectrogramResult {
  return {
    bands,
    numBands: bands.length,
    minSamplesPerBand: 1000,
    bandsWithData: bands.filter((b) => b.noiseFloorDb).length,
  };
}

describe('analyzeDynamicLowpass', () => {
  it('should return undefined for undefined spectrogram', () => {
    expect(analyzeDynamicLowpass(undefined)).toBeUndefined();
  });

  it('should return undefined for insufficient bands', () => {
    const spec = makeSpectrogram([
      makeBand(0.0, 0.2, [-40, -40, -30]),
      makeBand(0.2, 0.4, [-35, -35, -25]),
    ]);
    expect(analyzeDynamicLowpass(spec)).toBeUndefined();
  });

  it('should recommend dynamic lowpass when noise increases with throttle', () => {
    const spec = makeSpectrogram([
      makeBand(0.0, 0.2, [-50, -50, -40]),
      makeBand(0.2, 0.4, [-45, -45, -35]),
      makeBand(0.4, 0.6, [-40, -40, -30]),
      makeBand(0.6, 0.8, [-35, -35, -25]),
      makeBand(0.8, 1.0, [-30, -30, -20]),
    ]);
    const result = analyzeDynamicLowpass(spec);

    expect(result).toBeDefined();
    expect(result!.recommended).toBe(true);
    expect(result!.noiseIncreaseDeltaDb).toBeGreaterThanOrEqual(DYNAMIC_LOWPASS_NOISE_INCREASE_DB);
    expect(result!.throttleNoiseCorrelation).toBeGreaterThanOrEqual(
      DYNAMIC_LOWPASS_MIN_CORRELATION
    );
    expect(result!.summary).toContain('Dynamic lowpass recommended');
  });

  it('should not recommend when noise is flat across throttle', () => {
    const spec = makeSpectrogram([
      makeBand(0.0, 0.2, [-40, -40, -30]),
      makeBand(0.2, 0.4, [-40, -41, -31]),
      makeBand(0.4, 0.6, [-41, -40, -30]),
      makeBand(0.6, 0.8, [-40, -40, -30]),
      makeBand(0.8, 1.0, [-41, -40, -31]),
    ]);
    const result = analyzeDynamicLowpass(spec);

    expect(result).toBeDefined();
    expect(result!.recommended).toBe(false);
    expect(result!.summary).toContain('Static lowpass is appropriate');
  });

  it('should not recommend when noise increase is below threshold', () => {
    const spec = makeSpectrogram([
      makeBand(0.0, 0.3, [-42, -42, -35]),
      makeBand(0.3, 0.6, [-40, -40, -33]),
      makeBand(0.6, 1.0, [-38, -38, -31]),
    ]);
    const result = analyzeDynamicLowpass(spec);

    expect(result).toBeDefined();
    expect(result!.noiseIncreaseDeltaDb).toBeLessThan(DYNAMIC_LOWPASS_NOISE_INCREASE_DB);
    expect(result!.recommended).toBe(false);
  });

  it('should use average of roll and pitch, excluding yaw', () => {
    // Yaw is very noisy but roll/pitch are flat
    const spec = makeSpectrogram([
      makeBand(0.0, 0.2, [-40, -40, -10]),
      makeBand(0.2, 0.4, [-40, -40, -15]),
      makeBand(0.4, 0.6, [-40, -40, -20]),
      makeBand(0.6, 0.8, [-40, -40, -25]),
    ]);
    const result = analyzeDynamicLowpass(spec);

    expect(result).toBeDefined();
    expect(result!.recommended).toBe(false);
  });

  it('should correctly report bands analyzed', () => {
    const spec = makeSpectrogram([
      makeBand(0.0, 0.25, [-50, -50, -40]),
      makeBand(0.25, 0.5, [-45, -45, -35]),
      makeBand(0.5, 0.75, [-38, -38, -28]),
      makeBand(0.75, 1.0, [-30, -30, -20]),
    ]);
    const result = analyzeDynamicLowpass(spec);

    expect(result).toBeDefined();
    expect(result!.bandsAnalyzed).toBe(4);
  });

  it('should skip bands without noise floor data', () => {
    const spec = makeSpectrogram([
      makeBand(0.0, 0.2, [-50, -50, -40]),
      { throttleMin: 0.2, throttleMax: 0.4, sampleCount: 10 }, // No data
      makeBand(0.4, 0.6, [-40, -40, -30]),
      makeBand(0.6, 0.8, [-35, -35, -25]),
      makeBand(0.8, 1.0, [-30, -30, -20]),
    ]);
    const result = analyzeDynamicLowpass(spec);

    expect(result).toBeDefined();
    expect(result!.bandsAnalyzed).toBe(4);
  });
});

describe('recommendDynamicLowpass', () => {
  it('should return empty array when analysis is undefined', () => {
    expect(recommendDynamicLowpass(undefined, 250)).toEqual([]);
  });

  it('should return empty array when not recommended', () => {
    const analysis = {
      recommended: false,
      noiseIncreaseDeltaDb: 3,
      throttleNoiseCorrelation: 0.3,
      bandsAnalyzed: 5,
      summary: 'Static lowpass is appropriate.',
    };
    expect(recommendDynamicLowpass(analysis, 250)).toEqual([]);
  });

  it('should return empty array when gyro LPF1 is disabled', () => {
    const analysis = {
      recommended: true,
      noiseIncreaseDeltaDb: 10,
      throttleNoiseCorrelation: 0.9,
      bandsAnalyzed: 5,
      summary: 'Dynamic lowpass recommended.',
    };
    expect(recommendDynamicLowpass(analysis, 0)).toEqual([]);
  });

  it('should generate min and max recommendations when appropriate', () => {
    const analysis = {
      recommended: true,
      noiseIncreaseDeltaDb: 10,
      throttleNoiseCorrelation: 0.9,
      bandsAnalyzed: 5,
      summary: 'Dynamic lowpass recommended.',
    };
    const recs = recommendDynamicLowpass(analysis, 250);

    expect(recs).toHaveLength(2);
    expect(recs[0].setting).toBe('gyro_lpf1_dyn_min_hz');
    expect(recs[0].recommendedValue).toBe(150); // 250 * 0.6
    expect(recs[1].setting).toBe('gyro_lpf1_dyn_max_hz');
    expect(recs[1].recommendedValue).toBe(350); // 250 * 1.4
  });

  it('should scale recommendations based on current LPF1 value', () => {
    const analysis = {
      recommended: true,
      noiseIncreaseDeltaDb: 12,
      throttleNoiseCorrelation: 0.95,
      bandsAnalyzed: 5,
      summary: 'Dynamic lowpass recommended.',
    };
    const recs = recommendDynamicLowpass(analysis, 200);

    expect(recs[0].recommendedValue).toBe(120); // 200 * 0.6
    expect(recs[1].recommendedValue).toBe(280); // 200 * 1.4
  });
});
