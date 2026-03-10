import { describe, it, expect } from 'vitest';
import {
  spectrumToRechartsData,
  traceToRechartsData,
  findBestStep,
  downsampleData,
  computeRobustYDomain,
  AXIS_COLORS,
} from './chartUtils';
import type { AxisNoiseProfile, StepResponse, StepEvent } from '@shared/types/analysis.types';

function makeSpectrum(freqs: number[], mags: number[]) {
  return {
    frequencies: new Float64Array(freqs),
    magnitudes: new Float64Array(mags),
  };
}

function makeAxisProfile(freqs: number[], mags: number[]): AxisNoiseProfile {
  return {
    spectrum: makeSpectrum(freqs, mags),
    noiseFloorDb: -40,
    peaks: [],
  };
}

function makeStep(overrides: Partial<StepEvent> = {}): StepEvent {
  return {
    axis: 0,
    startIndex: 0,
    endIndex: 100,
    magnitude: 300,
    direction: 'positive',
    ...overrides,
  };
}

function makeResponse(
  overshoot: number,
  ringing: number,
  hasTrace: boolean = true,
  riseTimeMs: number = 20
): StepResponse {
  return {
    step: makeStep(),
    riseTimeMs,
    overshootPercent: overshoot,
    settlingTimeMs: 50,
    latencyMs: 5,
    ringingCount: ringing,
    peakValue: 330,
    steadyStateValue: 300,
    trace: hasTrace
      ? { timeMs: [0, 1, 2], setpoint: [0, 300, 300], gyro: [0, 280, 300] }
      : undefined,
  };
}

describe('chartUtils', () => {
  describe('AXIS_COLORS', () => {
    it('provides colors for all axes', () => {
      expect(AXIS_COLORS.roll).toBe('#ff6b6b');
      expect(AXIS_COLORS.pitch).toBe('#51cf66');
      expect(AXIS_COLORS.yaw).toBe('#4dabf7');
    });
  });

  describe('spectrumToRechartsData', () => {
    it('converts spectrum data with frequency filtering', () => {
      const profiles = {
        roll: makeAxisProfile([10, 50, 100, 500, 1500], [-30, -25, -20, -15, -10]),
        pitch: makeAxisProfile([10, 50, 100, 500, 1500], [-32, -27, -22, -17, -12]),
        yaw: makeAxisProfile([10, 50, 100, 500, 1500], [-35, -30, -25, -20, -15]),
      };

      const data = spectrumToRechartsData(profiles, 20, 1000);

      // Should filter out 10 Hz (below min) and 1500 Hz (above max)
      expect(data.length).toBe(3); // 50, 100, 500
      expect(data[0].frequency).toBe(50);
      expect(data[0].roll).toBe(-25);
      expect(data[0].pitch).toBe(-27);
      expect(data[0].yaw).toBe(-30);
    });

    it('returns empty array for empty spectrum', () => {
      const profiles = {
        roll: makeAxisProfile([], []),
        pitch: makeAxisProfile([], []),
        yaw: makeAxisProfile([], []),
      };

      const data = spectrumToRechartsData(profiles);
      expect(data).toEqual([]);
    });

    it('uses default frequency range of 20-1000 Hz', () => {
      const profiles = {
        roll: makeAxisProfile([15, 25, 999, 1001], [-20, -25, -30, -35]),
        pitch: makeAxisProfile([15, 25, 999, 1001], [-20, -25, -30, -35]),
        yaw: makeAxisProfile([15, 25, 999, 1001], [-20, -25, -30, -35]),
      };

      const data = spectrumToRechartsData(profiles);
      expect(data.length).toBe(2); // 25, 999
    });
  });

  describe('traceToRechartsData', () => {
    it('converts trace data to recharts format', () => {
      const response = makeResponse(10, 1, true);
      const data = traceToRechartsData(response);

      expect(data.length).toBe(3);
      expect(data[0]).toEqual({ timeMs: 0, setpoint: 0, gyro: 0 });
      expect(data[1]).toEqual({ timeMs: 1, setpoint: 300, gyro: 280 });
      expect(data[2]).toEqual({ timeMs: 2, setpoint: 300, gyro: 300 });
    });

    it('returns empty array when no trace data', () => {
      const response = makeResponse(10, 1, false);
      const data = traceToRechartsData(response);
      expect(data).toEqual([]);
    });
  });

  describe('findBestStep', () => {
    it('returns index of step with highest score', () => {
      const responses = [
        makeResponse(5, 0), // score: 5
        makeResponse(20, 3), // score: 35 (best)
        makeResponse(10, 1), // score: 15
      ];

      expect(findBestStep(responses)).toBe(1);
    });

    it('returns -1 for empty array', () => {
      expect(findBestStep([])).toBe(-1);
    });

    it('returns 0 for single response', () => {
      expect(findBestStep([makeResponse(5, 0)])).toBe(0);
    });

    it('skips responses without trace when scoring', () => {
      const responses = [
        makeResponse(5, 0, false), // no trace, falls through
        makeResponse(20, 3, true), // has trace, scored
      ];

      expect(findBestStep(responses)).toBe(1);
    });

    it('prefers valid steps over degenerate ones', () => {
      const responses = [
        makeResponse(808, 0, true, 0), // degenerate: 0ms rise, 808% overshoot
        makeResponse(15, 1, true), // valid: moderate overshoot
        makeResponse(600, 2, true), // degenerate: 600% overshoot
      ];

      expect(findBestStep(responses)).toBe(1);
    });

    it('falls back to degenerate step if all are degenerate', () => {
      const responses = [makeResponse(808, 0, true, 0), makeResponse(600, 1, true, 0)];

      // Should still return a valid index (not -1)
      expect(findBestStep(responses)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('computeRobustYDomain', () => {
    it('returns default range for empty values', () => {
      expect(computeRobustYDomain([])).toEqual([-100, 100]);
    });

    it('computes domain from normal data with padding', () => {
      const values = Array.from({ length: 200 }, (_, i) => -100 + i); // -100 to 99
      const [lo, hi] = computeRobustYDomain(values);
      // P1 ≈ -98, P99 ≈ 97, range ≈ 195, padding ≈ 19.5
      expect(lo).toBeLessThan(-95);
      expect(hi).toBeGreaterThan(95);
    });

    it('excludes extreme outlier spikes like 16866 deg/s', () => {
      // Simulate yaw trace: mostly near 0 with one corrupt spike
      const values: number[] = [];
      for (let i = 0; i < 1200; i++) {
        values.push(Math.sin(i * 0.01) * 50); // normal gyro ±50
      }
      values.push(16866); // corrupt setpoint spike

      const [lo, hi] = computeRobustYDomain(values);
      // Domain should be based on the ±50 data, not stretched to 16866
      expect(hi).toBeLessThan(200);
      expect(lo).toBeGreaterThan(-200);
    });

    it('preserves legitimate step response range', () => {
      // Simulate step: 0 for first half, 300 for second half, with overshoot to 400
      const values: number[] = [];
      for (let i = 0; i < 500; i++) values.push(0); // baseline
      for (let i = 0; i < 50; i++) values.push(400); // overshoot
      for (let i = 0; i < 450; i++) values.push(300); // steady state

      const [lo, hi] = computeRobustYDomain(values);
      // Should capture the full 0-400 range (overshoot is legitimate)
      expect(lo).toBeLessThan(0);
      expect(hi).toBeGreaterThan(400);
    });

    it('handles data with negative spikes (corrupt gyro)', () => {
      const values = Array.from({ length: 500 }, () => 0);
      values[250] = -10000; // corrupt gyro spike

      const [lo, _hi] = computeRobustYDomain(values);
      // Should not stretch to -10000
      expect(lo).toBeGreaterThan(-500);
    });
  });

  describe('downsampleData', () => {
    it('returns original data when under maxPoints', () => {
      const data = [1, 2, 3, 4, 5];
      expect(downsampleData(data, 10)).toEqual(data);
    });

    it('downsamples data when over maxPoints', () => {
      const data = Array.from({ length: 100 }, (_, i) => i);
      const result = downsampleData(data, 10);

      expect(result.length).toBeLessThanOrEqual(12);
      expect(result[0]).toBe(0);
      expect(result[result.length - 1]).toBe(99);
    });

    it('always includes last point', () => {
      const data = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const result = downsampleData(data, 3);
      expect(result[result.length - 1]).toBe(9);
    });
  });
});
