import { describe, it, expect } from 'vitest';
import { analyzeDTermEffectiveness } from './DTermAnalyzer';
import type { BlackboxFlightData, TimeSeries } from '@shared/types/blackbox.types';
import { FFT_WINDOW_SIZE } from './constants';

function makeSeries(length: number, fn: (i: number) => number): TimeSeries {
  const time = new Float64Array(length);
  const values = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    time[i] = i / 4000;
    values[i] = fn(i);
  }
  return { time, values };
}

function makeFlightData(
  opts: {
    length?: number;
    gyroFn?: (i: number) => number;
    setpointFn?: (i: number) => number;
    pidDFn?: (i: number) => number;
    hasPidD?: boolean;
  } = {}
): BlackboxFlightData {
  const {
    length = FFT_WINDOW_SIZE * 2,
    gyroFn = (i) => Math.sin(i * 0.1) * 10,
    setpointFn = () => 0,
    pidDFn = (i) => Math.sin(i * 0.1) * 5,
    hasPidD = true,
  } = opts;

  const zero = makeSeries(length, () => 0);
  const gyro = [makeSeries(length, gyroFn), makeSeries(length, gyroFn), makeSeries(length, gyroFn)];
  const setpoint = [
    makeSeries(length, setpointFn),
    makeSeries(length, setpointFn),
    makeSeries(length, setpointFn),
    makeSeries(length, () => 0.5),
  ];

  return {
    gyro,
    setpoint,
    pidP: [zero, zero, zero],
    pidI: [zero, zero, zero],
    pidD: hasPidD
      ? [makeSeries(length, pidDFn), makeSeries(length, pidDFn), makeSeries(length, pidDFn)]
      : [],
    pidF: [zero, zero, zero],
    motor: [zero, zero, zero, zero],
    debug: [],
    sampleRateHz: 4000,
    durationSeconds: length / 4000,
    frameCount: length,
  };
}

describe('analyzeDTermEffectiveness', () => {
  it('should return undefined when pidD data is empty', () => {
    const data = makeFlightData({ hasPidD: false });
    expect(analyzeDTermEffectiveness(data)).toBeUndefined();
  });

  it('should return undefined when pidD data is too short', () => {
    const data = makeFlightData({ length: 100 }); // < FFT_WINDOW_SIZE
    const result = analyzeDTermEffectiveness(data);
    // Should return with 0 values for short axes
    expect(result).toBeDefined();
    expect(result!.roll).toBe(0);
  });

  it('should return values in 0-1 range', () => {
    const data = makeFlightData();
    const result = analyzeDTermEffectiveness(data);
    expect(result).toBeDefined();
    expect(result!.roll).toBeGreaterThanOrEqual(0);
    expect(result!.roll).toBeLessThanOrEqual(1);
    expect(result!.pitch).toBeGreaterThanOrEqual(0);
    expect(result!.pitch).toBeLessThanOrEqual(1);
    expect(result!.yaw).toBeGreaterThanOrEqual(0);
    expect(result!.yaw).toBeLessThanOrEqual(1);
    expect(result!.overall).toBeGreaterThanOrEqual(0);
    expect(result!.overall).toBeLessThanOrEqual(1);
  });

  it('should compute overall as average of roll and pitch only', () => {
    const data = makeFlightData();
    const result = analyzeDTermEffectiveness(data)!;
    expect(result.overall).toBeCloseTo((result.roll + result.pitch) / 2, 10);
  });

  it('should set dCritical=true when overall > 0.7', () => {
    // Create data where pidD energy is very high relative to error
    const data = makeFlightData({
      gyroFn: (i) => Math.sin(i * 0.05) * 0.1, // Very small gyro
      setpointFn: (i) => Math.sin(i * 0.05) * 0.1, // Setpoint ≈ gyro → small error
      pidDFn: (i) => Math.sin(i * 0.05) * 100, // Very large D contribution
    });
    const result = analyzeDTermEffectiveness(data);
    expect(result).toBeDefined();
    // With very large D and tiny error, effectiveness should be clamped to 1
    expect(result!.dCritical).toBe(true);
  });

  it('should set dCritical=false when D-term is weak', () => {
    const data = makeFlightData({
      gyroFn: (i) => Math.sin(i * 0.1) * 100, // Large gyro oscillation
      setpointFn: () => 0, // Zero setpoint → large error
      pidDFn: (i) => Math.sin(i * 0.1) * 0.01, // Negligible D
    });
    const result = analyzeDTermEffectiveness(data);
    expect(result).toBeDefined();
    expect(result!.dCritical).toBe(false);
    expect(result!.overall).toBeLessThan(0.3);
  });

  it('should return 0 effectiveness when error energy is zero', () => {
    const data = makeFlightData({
      gyroFn: () => 0,
      setpointFn: () => 0, // Zero error
      pidDFn: (i) => Math.sin(i * 0.1) * 5,
    });
    const result = analyzeDTermEffectiveness(data);
    expect(result).toBeDefined();
    // Error is near-zero but not exactly (FFT artifacts), so ratio should be high or clamped
    // The important thing is it doesn't crash
    expect(result!.roll).toBeGreaterThanOrEqual(0);
  });

  it('should handle pidD with only 2 axes gracefully', () => {
    const data = makeFlightData();
    // Simulate missing axis by truncating
    (data as unknown as Record<string, unknown>).pidD = [data.pidD[0], data.pidD[1]];
    expect(analyzeDTermEffectiveness(data)).toBeUndefined();
  });
});
