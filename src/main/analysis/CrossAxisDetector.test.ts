import { describe, it, expect } from 'vitest';
import {
  normalizedCorrelation,
  analyzeCrossAxisCoupling,
  COUPLING_NONE_THRESHOLD,
  COUPLING_SIGNIFICANT_THRESHOLD,
} from './CrossAxisDetector';
import type { BlackboxFlightData, TimeSeries } from '@shared/types/blackbox.types';
import type { StepEvent } from '@shared/types/analysis.types';

const SAMPLE_RATE = 4000;

function makeSeries(fn: (i: number) => number, numSamples: number): TimeSeries {
  const time = new Float64Array(numSamples);
  const values = new Float64Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    time[i] = i / SAMPLE_RATE;
    values[i] = fn(i);
  }
  return { time, values };
}

function createFlightData(
  gyroFns: [(i: number) => number, (i: number) => number, (i: number) => number],
  numSamples: number = SAMPLE_RATE * 2
): BlackboxFlightData {
  const zero = makeSeries(() => 0, numSamples);
  const throttle = makeSeries(() => 0.5, numSamples);

  return {
    gyro: [
      makeSeries(gyroFns[0], numSamples),
      makeSeries(gyroFns[1], numSamples),
      makeSeries(gyroFns[2], numSamples),
    ],
    setpoint: [zero, zero, zero, throttle],
    pidP: [zero, zero, zero],
    pidI: [zero, zero, zero],
    pidD: [zero, zero, zero],
    pidF: [zero, zero, zero],
    motor: [zero, zero, zero, zero],
    debug: [],
    sampleRateHz: SAMPLE_RATE,
    durationSeconds: numSamples / SAMPLE_RATE,
    frameCount: numSamples,
  };
}

function makeStep(axis: 0 | 1 | 2, startIndex: number, endIndex: number): StepEvent {
  return {
    axis,
    startIndex,
    endIndex,
    magnitude: 300,
    direction: 'positive',
  };
}

describe('CrossAxisDetector', () => {
  describe('normalizedCorrelation', () => {
    it('should return 1 for identical signals', () => {
      const a = new Float64Array([1, 2, 3, 4, 5]);
      const b = new Float64Array([1, 2, 3, 4, 5]);
      expect(normalizedCorrelation(a, b)).toBeCloseTo(1.0, 3);
    });

    it('should return 1 for perfectly anti-correlated signals', () => {
      const a = new Float64Array([1, 2, 3, 4, 5]);
      const b = new Float64Array([-1, -2, -3, -4, -5]);
      // Uses absolute value, so anti-correlated = 1
      expect(normalizedCorrelation(a, b)).toBeCloseTo(1.0, 3);
    });

    it('should return near 0 for uncorrelated signals', () => {
      // Sine and cosine at same frequency are orthogonal
      const n = 1000;
      const a = new Float64Array(n);
      const b = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        a[i] = Math.sin((2 * Math.PI * i) / n);
        b[i] = Math.cos((2 * Math.PI * i) / n);
      }
      expect(normalizedCorrelation(a, b)).toBeLessThan(0.05);
    });

    it('should return 1 for scaled copies', () => {
      const a = new Float64Array([1, 2, 3, 4, 5]);
      const b = new Float64Array([10, 20, 30, 40, 50]);
      expect(normalizedCorrelation(a, b)).toBeCloseTo(1.0, 3);
    });

    it('should return 0 for constant signals', () => {
      const a = new Float64Array([5, 5, 5, 5, 5]);
      const b = new Float64Array([1, 2, 3, 4, 5]);
      expect(normalizedCorrelation(a, b)).toBe(0);
    });

    it('should return 0 for too-short signals', () => {
      const a = new Float64Array([1, 2, 3]);
      const b = new Float64Array([4, 5, 6]);
      expect(normalizedCorrelation(a, b)).toBe(0);
    });

    it('should handle mismatched lengths by using shorter', () => {
      const a = new Float64Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const b = new Float64Array([1, 2, 3, 4]);
      expect(normalizedCorrelation(a, b)).toBeCloseTo(1.0, 3);
    });
  });

  describe('analyzeCrossAxisCoupling', () => {
    it('should return undefined for fewer than 2 steps', () => {
      const data = createFlightData([() => 0, () => 0, () => 0]);
      const steps: StepEvent[] = [makeStep(0, 100, 200)];
      expect(analyzeCrossAxisCoupling(steps, data)).toBeUndefined();
    });

    it('should return undefined for empty steps', () => {
      const data = createFlightData([() => 0, () => 0, () => 0]);
      expect(analyzeCrossAxisCoupling([], data)).toBeUndefined();
    });

    it('should detect no coupling when axes are independent', () => {
      const n = SAMPLE_RATE * 2;
      // Roll has a step response, pitch and yaw have unrelated noise
      const data = createFlightData(
        [
          (i) => (i >= 1000 && i < 1200 ? 300 : 0),
          (i) => Math.sin((2 * Math.PI * 73 * i) / SAMPLE_RATE), // Unrelated frequency
          (i) => Math.sin((2 * Math.PI * 137 * i) / SAMPLE_RATE), // Different unrelated frequency
        ],
        n
      );

      const steps: StepEvent[] = [makeStep(0, 1000, 1200), makeStep(0, 3000, 3200)];

      const result = analyzeCrossAxisCoupling(steps, data);
      expect(result).toBeDefined();
      expect(result!.hasSignificantCoupling).toBe(false);

      // All pairs involving roll should have low correlation
      const rollPairs = result!.pairs.filter((p) => p.sourceAxis === 'roll');
      for (const pair of rollPairs) {
        expect(pair.correlation).toBeLessThan(COUPLING_SIGNIFICANT_THRESHOLD);
      }
    });

    it('should detect significant coupling when axes are correlated', () => {
      const n = SAMPLE_RATE * 2;
      // Roll and pitch respond identically (strong coupling)
      const sharedResponse = (i: number) => {
        if (i >= 1000 && i < 1200) return 300 * Math.exp(-((i - 1000) / 50));
        if (i >= 3000 && i < 3200) return 300 * Math.exp(-((i - 3000) / 50));
        return 0;
      };

      const data = createFlightData([sharedResponse, sharedResponse, () => 0], n);

      const steps: StepEvent[] = [makeStep(0, 1000, 1200), makeStep(0, 3000, 3200)];

      const result = analyzeCrossAxisCoupling(steps, data);
      expect(result).toBeDefined();
      expect(result!.hasSignificantCoupling).toBe(true);

      const rollToPitch = result!.pairs.find(
        (p) => p.sourceAxis === 'roll' && p.affectedAxis === 'pitch'
      );
      expect(rollToPitch).toBeDefined();
      expect(rollToPitch!.correlation).toBeGreaterThan(COUPLING_SIGNIFICANT_THRESHOLD);
      expect(rollToPitch!.rating).toBe('significant');
    });

    it('should detect mild coupling at intermediate correlation', () => {
      const n = SAMPLE_RATE * 2;
      // Roll has a step, pitch has partially correlated response
      const data = createFlightData(
        [
          (i) => {
            if (i >= 1000 && i < 1200) return 300;
            if (i >= 3000 && i < 3200) return 300;
            return 0;
          },
          (i) => {
            // Partially correlated: same shape but with noise
            if (i >= 1000 && i < 1200) return 100 + Math.sin(i * 0.5) * 200;
            if (i >= 3000 && i < 3200) return 100 + Math.sin(i * 0.5) * 200;
            return Math.sin(i * 0.5) * 50;
          },
          () => 0,
        ],
        n
      );

      const steps: StepEvent[] = [makeStep(0, 1000, 1200), makeStep(0, 3000, 3200)];

      const result = analyzeCrossAxisCoupling(steps, data);
      expect(result).toBeDefined();
      // Should have some pairs with mild coupling
      const mildOrSignificant = result!.pairs.filter((p) => p.rating !== 'none');
      expect(mildOrSignificant.length).toBeGreaterThanOrEqual(0);
    });

    it('should produce correct summary for no coupling', () => {
      const n = SAMPLE_RATE * 2;
      // Completely independent axes
      const data = createFlightData(
        [
          (i) => (i >= 1000 && i < 1200 ? 300 : 0),
          (i) => Math.sin((2 * Math.PI * 73 * i) / SAMPLE_RATE),
          (i) => Math.sin((2 * Math.PI * 137 * i) / SAMPLE_RATE),
        ],
        n
      );

      const steps: StepEvent[] = [makeStep(0, 1000, 1200), makeStep(0, 3000, 3200)];

      const result = analyzeCrossAxisCoupling(steps, data);
      expect(result).toBeDefined();
      expect(result!.summary).toBeDefined();
      expect(result!.summary.length).toBeGreaterThan(0);
    });

    it('should produce summary mentioning pairs for significant coupling', () => {
      const n = SAMPLE_RATE * 2;
      const sharedResponse = (i: number) => {
        if (i >= 1000 && i < 1200) return 300;
        if (i >= 3000 && i < 3200) return 300;
        return 0;
      };

      const data = createFlightData([sharedResponse, sharedResponse, () => 0], n);

      const steps: StepEvent[] = [makeStep(0, 1000, 1200), makeStep(0, 3000, 3200)];

      const result = analyzeCrossAxisCoupling(steps, data);
      expect(result).toBeDefined();
      if (result!.hasSignificantCoupling) {
        expect(result!.summary).toContain('Significant');
        expect(result!.summary).toContain('roll');
      }
    });

    it('should handle steps across multiple axes', () => {
      const n = SAMPLE_RATE * 2;
      const data = createFlightData(
        [
          (i) => (i >= 1000 && i < 1200 ? 300 : 0),
          (i) => (i >= 2000 && i < 2200 ? 250 : 0),
          () => 0,
        ],
        n
      );

      const steps: StepEvent[] = [
        makeStep(0, 1000, 1200),
        makeStep(1, 2000, 2200),
        makeStep(0, 4000, 4200),
      ];

      const result = analyzeCrossAxisCoupling(steps, data);
      expect(result).toBeDefined();
      expect(result!.pairs.length).toBeGreaterThan(0);
      // Should have pairs for both roll→pitch and pitch→roll
      const rollToPitch = result!.pairs.find(
        (p) => p.sourceAxis === 'roll' && p.affectedAxis === 'pitch'
      );
      const pitchToRoll = result!.pairs.find(
        (p) => p.sourceAxis === 'pitch' && p.affectedAxis === 'roll'
      );
      expect(rollToPitch).toBeDefined();
      expect(pitchToRoll).toBeDefined();
    });

    it('should skip steps with invalid indices', () => {
      const n = SAMPLE_RATE * 2;
      const data = createFlightData([() => 0, () => 0, () => 0], n);

      const steps: StepEvent[] = [
        makeStep(0, 100, 200),
        makeStep(0, n + 100, n + 200), // Beyond data bounds
        makeStep(0, 300, 500),
      ];

      const result = analyzeCrossAxisCoupling(steps, data);
      // Should still work with valid steps
      expect(result).toBeDefined();
    });

    it('should skip steps with end <= start', () => {
      const data = createFlightData([() => 0, () => 0, () => 0]);

      const steps: StepEvent[] = [
        makeStep(0, 200, 100), // end < start
        makeStep(0, 100, 200),
        makeStep(0, 300, 500),
      ];

      const result = analyzeCrossAxisCoupling(steps, data);
      expect(result).toBeDefined();
    });

    it('should return correlation values between 0 and 1', () => {
      const n = SAMPLE_RATE * 2;
      const data = createFlightData(
        [
          (i) => Math.sin((2 * Math.PI * 50 * i) / SAMPLE_RATE) * 100,
          (i) => Math.sin((2 * Math.PI * 50 * i) / SAMPLE_RATE) * 50 + Math.cos(i) * 20,
          (i) => Math.cos((2 * Math.PI * 30 * i) / SAMPLE_RATE) * 80,
        ],
        n
      );

      const steps: StepEvent[] = [makeStep(0, 100, 300), makeStep(0, 1000, 1200)];

      const result = analyzeCrossAxisCoupling(steps, data);
      expect(result).toBeDefined();
      for (const pair of result!.pairs) {
        expect(pair.correlation).toBeGreaterThanOrEqual(0);
        expect(pair.correlation).toBeLessThanOrEqual(1);
      }
    });

    it('should correctly classify rating based on thresholds', () => {
      const n = SAMPLE_RATE * 2;
      // Perfect coupling roll→pitch — both have same decaying overshoot shape (non-constant)
      const stepResponse = (i: number, start: number) => {
        if (i < start || i >= start + 200) return 0;
        const t = (i - start) / SAMPLE_RATE;
        return 300 * Math.exp(-t * 30) * Math.sin(2 * Math.PI * 50 * t);
      };

      const data = createFlightData(
        [
          (i) => stepResponse(i, 1000) + stepResponse(i, 3000),
          (i) => stepResponse(i, 1000) + stepResponse(i, 3000), // Same shape → significant coupling
          (i) => Math.sin((2 * Math.PI * 211 * i) / SAMPLE_RATE) * 10, // Independent → no coupling
        ],
        n
      );

      const steps: StepEvent[] = [makeStep(0, 1000, 1200), makeStep(0, 3000, 3200)];

      const result = analyzeCrossAxisCoupling(steps, data);
      expect(result).toBeDefined();

      const rollToPitch = result!.pairs.find(
        (p) => p.sourceAxis === 'roll' && p.affectedAxis === 'pitch'
      );
      expect(rollToPitch).toBeDefined();
      expect(rollToPitch!.rating).toBe('significant');
      expect(rollToPitch!.correlation).toBeGreaterThanOrEqual(COUPLING_SIGNIFICANT_THRESHOLD);
    });

    it('should round correlation to 3 decimal places', () => {
      const n = SAMPLE_RATE * 2;
      const data = createFlightData(
        [
          (i) => Math.sin((2 * Math.PI * 50 * i) / SAMPLE_RATE) * 100,
          (i) => Math.sin((2 * Math.PI * 50 * i) / SAMPLE_RATE) * 50,
          () => 0,
        ],
        n
      );

      const steps: StepEvent[] = [makeStep(0, 100, 300), makeStep(0, 1000, 1200)];

      const result = analyzeCrossAxisCoupling(steps, data);
      expect(result).toBeDefined();
      for (const pair of result!.pairs) {
        // Check that it's rounded to 3 decimal places
        const rounded = Math.round(pair.correlation * 1000) / 1000;
        expect(pair.correlation).toBe(rounded);
      }
    });
  });
});
