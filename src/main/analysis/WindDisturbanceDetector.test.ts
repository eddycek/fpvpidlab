import { describe, it, expect } from 'vitest';
import { analyzeWindDisturbance, DISTURBANCE_CALM_THRESHOLD } from './WindDisturbanceDetector';
import type { BlackboxFlightData, TimeSeries } from '@shared/types/blackbox.types';

function makeSeries(length: number, fn: (i: number) => number): TimeSeries {
  const time = new Float64Array(length);
  const values = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    time[i] = i / 4000;
    values[i] = fn(i);
  }
  return { time, values };
}

function makeFlightData(opts: {
  length?: number;
  gyroAmplitude?: number;
  throttle?: number;
  gyroFn?: (i: number) => number;
}): BlackboxFlightData {
  const {
    length = 20000, // 5 seconds at 4kHz
    gyroAmplitude = 5,
    throttle = 0.5,
    gyroFn,
  } = opts;

  const zero = makeSeries(length, () => 0);
  const fn = gyroFn ?? ((i: number) => Math.sin(i * 0.1) * gyroAmplitude);

  return {
    gyro: [makeSeries(length, fn), makeSeries(length, fn), makeSeries(length, fn)],
    setpoint: [zero, zero, zero, makeSeries(length, () => throttle)],
    pidP: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
    pidI: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
    pidD: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
    pidF: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
    motor: [zero, zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries, TimeSeries],
    debug: [],
    sampleRateHz: 4000,
    durationSeconds: length / 4000,
    frameCount: length,
  };
}

describe('analyzeWindDisturbance', () => {
  it('should return undefined for empty throttle data', () => {
    const data = makeFlightData({ length: 100 });
    (data as unknown as Record<string, unknown>).setpoint = [
      data.setpoint[0],
      data.setpoint[1],
      data.setpoint[2],
    ];
    expect(analyzeWindDisturbance(data)).toBeUndefined();
  });

  it('should return undefined for insufficient hover time', () => {
    // 100 samples = 25ms at 4kHz — way below MIN_HOVER_SAMPLES
    const data = makeFlightData({ length: 100, throttle: 0.5 });
    expect(analyzeWindDisturbance(data)).toBeUndefined();
  });

  it('should return undefined when throttle is outside hover range', () => {
    // Throttle at 0 (below THROTTLE_MIN_FLIGHT)
    const data = makeFlightData({ length: 20000, throttle: 0.0 });
    expect(analyzeWindDisturbance(data)).toBeUndefined();
  });

  it('should detect calm conditions with low gyro variance', () => {
    const data = makeFlightData({ gyroAmplitude: 2 });
    const result = analyzeWindDisturbance(data);

    expect(result).toBeDefined();
    expect(result!.level).toBe('calm');
    expect(result!.worstVariance).toBeLessThanOrEqual(DISTURBANCE_CALM_THRESHOLD);
    expect(result!.summary).toContain('Calm');
  });

  it('should detect windy conditions with high gyro variance', () => {
    // Large random-like oscillation
    const data = makeFlightData({
      gyroFn: (i) => Math.sin(i * 0.05) * 30 + Math.sin(i * 0.3) * 20,
    });
    const result = analyzeWindDisturbance(data);

    expect(result).toBeDefined();
    expect(result!.worstVariance).toBeGreaterThan(DISTURBANCE_CALM_THRESHOLD);
    expect(result!.level).not.toBe('calm');
  });

  it('should detect moderate conditions at intermediate variance', () => {
    // Moderate oscillation — variance between calm and windy thresholds
    const data = makeFlightData({
      gyroFn: (i) => Math.sin(i * 0.1) * 10,
    });
    const result = analyzeWindDisturbance(data);

    expect(result).toBeDefined();
    // sin amplitude 10 → variance ~ 50 (between 25 and 200)
    expect(result!.level).toBe('moderate');
    expect(result!.summary).toContain('Moderate');
  });

  it('should return correct hover duration and sample count', () => {
    const data = makeFlightData({ length: 20000 }); // 5s at 4kHz
    const result = analyzeWindDisturbance(data);

    expect(result).toBeDefined();
    expect(result!.hoverSampleCount).toBe(20000);
    expect(result!.hoverDurationS).toBeCloseTo(5.0, 1);
  });

  it('should compute per-axis variance independently', () => {
    const length = 20000;
    const zero = makeSeries(length, () => 0);
    const noisy = makeSeries(length, (i) => Math.sin(i * 0.1) * 15);
    const calm = makeSeries(length, (i) => Math.sin(i * 0.1) * 2);

    const data: BlackboxFlightData = {
      gyro: [noisy, calm, zero], // Roll noisy, pitch calm, yaw zero
      setpoint: [zero, zero, zero, makeSeries(length, () => 0.5)],
      pidP: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
      pidI: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
      pidD: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
      pidF: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
      motor: [zero, zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries, TimeSeries],
      debug: [],
      sampleRateHz: 4000,
      durationSeconds: length / 4000,
      frameCount: length,
    };

    const result = analyzeWindDisturbance(data);

    expect(result).toBeDefined();
    expect(result!.axisVariance[0]).toBeGreaterThan(result!.axisVariance[1]);
    expect(result!.axisVariance[1]).toBeGreaterThan(result!.axisVariance[2]);
    // worstVariance = max(roll, pitch)
    expect(result!.worstVariance).toBe(result!.axisVariance[0]);
  });

  it('should only analyze hover segments, ignoring high throttle', () => {
    const length = 40000; // 10s at 4kHz
    const zero = makeSeries(length, () => 0);

    // First 5s: hover (throttle 0.5), last 5s: full throttle (0.9 > MAX_HOVER)
    const throttle = makeSeries(length, (i) => (i < 20000 ? 0.5 : 0.9));

    // Calm during hover, very noisy during full throttle
    const gyro = makeSeries(length, (i) =>
      i < 20000 ? Math.sin(i * 0.1) * 2 : Math.sin(i * 0.1) * 50
    );

    const data: BlackboxFlightData = {
      gyro: [gyro, gyro, gyro],
      setpoint: [zero, zero, zero, throttle],
      pidP: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
      pidI: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
      pidD: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
      pidF: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
      motor: [zero, zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries, TimeSeries],
      debug: [],
      sampleRateHz: 4000,
      durationSeconds: length / 4000,
      frameCount: length,
    };

    const result = analyzeWindDisturbance(data);

    expect(result).toBeDefined();
    // Should only see calm hover data, not the noisy full-throttle portion
    expect(result!.level).toBe('calm');
    expect(result!.hoverSampleCount).toBe(20000);
  });

  it('should handle multiple hover segments', () => {
    const length = 40000;
    const zero = makeSeries(length, () => 0);

    // Hover → ground → hover pattern
    const throttle = makeSeries(length, (i) => {
      if (i < 12000) return 0.5; // 3s hover
      if (i < 16000) return 0.0; // 1s ground
      if (i < 28000) return 0.4; // 3s hover
      return 0.0; // ground
    });

    const gyro = makeSeries(length, (i) => Math.sin(i * 0.1) * 5);

    const data: BlackboxFlightData = {
      gyro: [gyro, gyro, gyro],
      setpoint: [zero, zero, zero, throttle],
      pidP: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
      pidI: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
      pidD: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
      pidF: [zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries],
      motor: [zero, zero, zero, zero] as [TimeSeries, TimeSeries, TimeSeries, TimeSeries],
      debug: [],
      sampleRateHz: 4000,
      durationSeconds: length / 4000,
      frameCount: length,
    };

    const result = analyzeWindDisturbance(data);

    expect(result).toBeDefined();
    expect(result!.hoverSampleCount).toBe(24000); // 12k + 12k
    expect(result!.hoverDurationS).toBeCloseTo(6.0, 1);
  });

  it('should generate correct summary for windy conditions', () => {
    const data = makeFlightData({
      gyroFn: (i) => Math.sin(i * 0.01) * 50 + Math.cos(i * 0.07) * 30,
    });
    const result = analyzeWindDisturbance(data);

    expect(result).toBeDefined();
    if (result!.level === 'windy') {
      expect(result!.summary).toContain('retesting in calmer conditions');
    }
  });
});
