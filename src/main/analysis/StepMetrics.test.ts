import { describe, it, expect } from 'vitest';
import {
  computeStepResponse,
  aggregateAxisMetrics,
  classifyFFContribution,
  computeFFEnergyRatio,
  computeAdaptiveWindowMs,
} from './StepMetrics';
import type { TimeSeries } from '@shared/types/blackbox.types';
import type { StepEvent, StepResponse } from '@shared/types/analysis.types';

const SAMPLE_RATE = 4000;
const MS_PER_SAMPLE = 1000 / SAMPLE_RATE;

function makeSeries(fn: (i: number) => number, numSamples: number): TimeSeries {
  const time = new Float64Array(numSamples);
  const values = new Float64Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    time[i] = i / SAMPLE_RATE;
    values[i] = fn(i);
  }
  return { time, values };
}

function makeStep(
  startIndex: number,
  endIndex: number,
  magnitude: number,
  axis: 0 | 1 | 2 = 0
): StepEvent {
  return {
    axis,
    startIndex,
    endIndex,
    magnitude,
    direction: magnitude > 0 ? 'positive' : 'negative',
  };
}

describe('StepMetrics', () => {
  describe('computeStepResponse', () => {
    it('should compute 0% overshoot for a perfect step response', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;

      // Perfect step: gyro matches setpoint exactly after the step
      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const gyro = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 1200, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      expect(result.overshootPercent).toBeCloseTo(0, 0);
      expect(result.steadyStateValue).toBeCloseTo(stepMag, 0);
    });

    it('should detect correct overshoot for underdamped response', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;
      const overshootFraction = 0.2; // 20% overshoot

      // Underdamped: overshoots then settles
      const gyro = makeSeries((i) => {
        if (i < stepAt) return 0;
        const t = (i - stepAt) / SAMPLE_RATE;
        // Decaying oscillation around target
        return (
          stepMag * (1 + overshootFraction * Math.exp(-t * 30) * Math.cos(2 * Math.PI * 20 * t))
        );
      }, numSamples);
      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 1200, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      // Should detect overshoot around 20% (decaying oscillation with initial peak)
      expect(result.overshootPercent).toBeGreaterThan(10);
      expect(result.overshootPercent).toBeLessThan(30);
    });

    it('should detect slow rise time for overdamped response', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;

      // Overdamped: slow exponential approach, no overshoot
      const gyro = makeSeries((i) => {
        if (i < stepAt) return 0;
        const t = (i - stepAt) / SAMPLE_RATE;
        return stepMag * (1 - Math.exp(-t * 10)); // Slow rise with τ = 100ms
      }, numSamples);
      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 1200, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      // Rise time should be significant (exponential rise with τ = 100ms)
      expect(result.riseTimeMs).toBeGreaterThan(10);
      expect(result.overshootPercent).toBeLessThan(5);
      expect(result.ringingCount).toBe(0);
    });

    it('should count ringing correctly for oscillating response', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;

      // Oscillating response: sustained oscillation around target
      const gyro = makeSeries((i) => {
        if (i < stepAt) return 0;
        const t = (i - stepAt) / SAMPLE_RATE;
        // Damped oscillation with multiple cycles
        return stepMag + 30 * Math.exp(-t * 8) * Math.sin(2 * Math.PI * 40 * t);
      }, numSamples);
      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 1200, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      // Should detect multiple oscillation cycles
      expect(result.ringingCount).toBeGreaterThanOrEqual(2);
    });

    it('should detect latency when gyro is delayed', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;
      const delayMs = 10; // 10ms delay
      const delaySamples = Math.round((delayMs / 1000) * SAMPLE_RATE);

      // Delayed response
      const gyro = makeSeries((i) => {
        if (i < stepAt + delaySamples) return 0;
        return stepMag;
      }, numSamples);
      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 1200, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      // Latency should be around 10ms
      expect(result.latencyMs).toBeGreaterThanOrEqual(delayMs - 2);
      expect(result.latencyMs).toBeLessThanOrEqual(delayMs + 2);
    });

    it('should handle negative step correctly', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = -300;

      // Perfect negative step
      const gyro = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 1200, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      expect(result.overshootPercent).toBeCloseTo(0, 0);
      expect(result.steadyStateValue).toBeCloseTo(stepMag, 0);
    });

    it('should compute settling time correctly', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;

      // Response that oscillates then settles at sample ~600
      const settleAt = 600;
      const gyro = makeSeries((i) => {
        if (i < stepAt) return 0;
        if (i < settleAt) {
          // Oscillate around target
          const t = (i - stepAt) / SAMPLE_RATE;
          return stepMag + 50 * Math.sin(2 * Math.PI * 30 * t);
        }
        return stepMag; // Settled
      }, numSamples);
      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 1200, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      // Settling time should be around (settleAt - stepAt) * msPerSample = 100ms
      const expectedSettleMs = (settleAt - stepAt) * MS_PER_SAMPLE;
      expect(result.settlingTimeMs).toBeGreaterThan(expectedSettleMs * 0.5);
      expect(result.settlingTimeMs).toBeLessThan(expectedSettleMs * 1.5);
    });

    it('should return peak value correctly', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;
      const peakVal = 380;

      const gyro = makeSeries((i) => {
        if (i < stepAt) return 0;
        if (i === stepAt + 50) return peakVal; // Single peak
        return stepMag;
      }, numSamples);
      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 1200, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      expect(result.peakValue).toBeCloseTo(peakVal, 0);
    });

    it('should handle zero gyro response (no movement)', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;

      // Gyro doesn't respond at all
      const gyro = makeSeries(() => 0, numSamples);
      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 1200, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      // Should complete without error, with degraded metrics
      expect(result).toBeDefined();
      expect(result.overshootPercent).toBe(0);
    });

    it('should handle step starting at index 0', () => {
      const numSamples = 2000;
      const stepMag = 300;

      const gyro = makeSeries(() => stepMag, numSamples);
      const setpoint = makeSeries(() => stepMag, numSamples);
      const step = makeStep(0, 1200, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      expect(result).toBeDefined();
    });

    it('should handle very short response window', () => {
      const numSamples = 300;
      const stepAt = 100;
      const stepMag = 300;

      const gyro = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, 250, stepMag); // Only 150 samples

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      expect(result).toBeDefined();
      expect(result.riseTimeMs).toBeLessThan(1000);
    });

    it('should populate trace data with correct time, setpoint, and gyro arrays', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepEnd = stepAt + 400;
      const stepMag = 300;

      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const gyro = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepEnd, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      expect(result.trace).toBeDefined();
      expect(result.trace!.timeMs.length).toBe(stepEnd - stepAt);
      expect(result.trace!.setpoint.length).toBe(stepEnd - stepAt);
      expect(result.trace!.gyro.length).toBe(stepEnd - stepAt);

      // First sample time should be 0
      expect(result.trace!.timeMs[0]).toBe(0);
      // Last sample time should be (windowLen - 1) * msPerSample
      expect(result.trace!.timeMs[result.trace!.timeMs.length - 1]).toBeCloseTo(
        (stepEnd - stepAt - 1) * MS_PER_SAMPLE,
        2
      );

      // Setpoint should be stepMag for all samples (step started at stepAt)
      expect(result.trace!.setpoint[0]).toBe(stepMag);
      // Gyro should match
      expect(result.trace!.gyro[0]).toBe(stepMag);
    });

    it('should populate trace with pre-step baseline values at start', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepEnd = stepAt + 400;
      const stepMag = 300;
      const delaySamples = 20;

      // Gyro responds after a delay
      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const gyro = makeSeries((i) => (i >= stepAt + delaySamples ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepEnd, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      // First few gyro trace samples should be 0 (before response)
      expect(result.trace!.gyro[0]).toBe(0);
      expect(result.trace!.gyro[delaySamples - 1]).toBe(0);
      // After delay, gyro should be at target
      expect(result.trace!.gyro[delaySamples]).toBe(stepMag);
    });

    it('should measure fast rise time for instant response', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;

      // Instant response — gyro jumps to target immediately
      const gyro = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 1200, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      // Rise time should be ~0 since it jumps instantly
      expect(result.riseTimeMs).toBeLessThan(2);
    });

    it('should compute near-zero trackingErrorRMS for perfect tracking', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;

      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const gyro = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 1200, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      expect(result.trackingErrorRMS).toBeDefined();
      expect(result.trackingErrorRMS).toBeCloseTo(0, 1);
    });

    it('should compute non-zero trackingErrorRMS for offset response', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;
      const offset = 30; // constant 30 deg/s error = 10% of magnitude

      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const gyro = makeSeries((i) => (i >= stepAt ? stepMag - offset : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 1200, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      expect(result.trackingErrorRMS).toBeDefined();
      // Error = offset/|magnitude| = 30/300 = 0.1 for all samples after step
      // Before step: setpoint=0, gyro=0 → error=0. Combined RMS should be close to 0.1
      expect(result.trackingErrorRMS!).toBeGreaterThan(0.05);
      expect(result.trackingErrorRMS!).toBeLessThan(0.15);
    });

    it('should compute near-zero steadyStateErrorPercent for perfect hold', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;

      // Perfect step: gyro matches setpoint during hold
      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const gyro = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 1200, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      expect(result.steadyStateErrorPercent).toBeDefined();
      expect(result.steadyStateErrorPercent!).toBeCloseTo(0, 1);
    });

    it('should compute non-zero steadyStateErrorPercent for drifting hold', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepEnd = stepAt + 1200;
      const stepMag = 300;
      const drift = 15; // 15 deg/s constant drift during hold = 5% of magnitude

      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      // Gyro matches during rise, but drifts during hold phase (last 20%)
      const holdStart = stepAt + Math.floor((stepEnd - stepAt) * 0.8);
      const gyro = makeSeries((i) => {
        if (i < stepAt) return 0;
        if (i >= holdStart) return stepMag - drift;
        return stepMag;
      }, numSamples);
      const step = makeStep(stepAt, stepEnd, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      expect(result.steadyStateErrorPercent).toBeDefined();
      // Error ≈ drift / magnitude * 100 = 15/300*100 = 5%
      expect(result.steadyStateErrorPercent!).toBeCloseTo(5, 0);
    });

    it('should return trackingErrorRMS=1.0 for near-zero magnitude', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 0.5; // near-zero

      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const gyro = makeSeries(() => 0, numSamples);
      const step = makeStep(stepAt, stepAt + 400, stepMag);

      const result = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      expect(result.trackingErrorRMS).toBe(1.0);
    });
  });

  describe('aggregateAxisMetrics', () => {
    function makeResponse(
      overshoot: number,
      riseTime: number,
      settling: number,
      latency: number
    ): StepResponse {
      return {
        step: makeStep(0, 100, 300),
        riseTimeMs: riseTime,
        overshootPercent: overshoot,
        settlingTimeMs: settling,
        latencyMs: latency,
        ringingCount: 0,
        peakValue: 300,
        steadyStateValue: 300,
      };
    }

    it('should compute correct means from multiple responses', () => {
      const responses = [
        makeResponse(10, 20, 50, 5),
        makeResponse(20, 40, 100, 10),
        makeResponse(30, 60, 150, 15),
      ];

      const profile = aggregateAxisMetrics(responses);

      expect(profile.responses.length).toBe(3);
      expect(profile.meanOvershoot).toBeCloseTo(20, 0);
      expect(profile.meanRiseTimeMs).toBeCloseTo(40, 0);
      expect(profile.meanSettlingTimeMs).toBeCloseTo(100, 0);
      expect(profile.meanLatencyMs).toBeCloseTo(10, 0);
    });

    it('should return zeros for empty responses', () => {
      const profile = aggregateAxisMetrics([]);

      expect(profile.responses.length).toBe(0);
      expect(profile.meanOvershoot).toBe(0);
      expect(profile.meanRiseTimeMs).toBe(0);
      expect(profile.meanSettlingTimeMs).toBe(0);
      expect(profile.meanLatencyMs).toBe(0);
    });

    it('should handle single response', () => {
      const responses = [makeResponse(15, 30, 80, 7)];

      const profile = aggregateAxisMetrics(responses);

      expect(profile.responses.length).toBe(1);
      expect(profile.meanOvershoot).toBeCloseTo(15, 0);
      expect(profile.meanRiseTimeMs).toBeCloseTo(30, 0);
    });

    it('should exclude degenerate steps from mean computation', () => {
      const responses = [
        makeResponse(15, 25, 60, 5), // valid
        makeResponse(20, 30, 80, 8), // valid
        makeResponse(808, 0, 300, 0), // degenerate: 0ms rise, 808% overshoot
      ];

      const profile = aggregateAxisMetrics(responses);

      // All responses preserved for chart display
      expect(profile.responses.length).toBe(3);
      // Means computed only from the 2 valid responses
      expect(profile.meanOvershoot).toBeCloseTo(17.5, 0);
      expect(profile.meanRiseTimeMs).toBeCloseTo(27.5, 0);
      expect(profile.meanSettlingTimeMs).toBeCloseTo(70, 0);
      expect(profile.meanLatencyMs).toBeCloseTo(6.5, 0);
    });

    it('should fall back to all responses if all are degenerate', () => {
      const responses = [makeResponse(600, 0, 300, 0), makeResponse(900, 0, 300, 0)];

      const profile = aggregateAxisMetrics(responses);

      // No valid responses, so fall back to all
      expect(profile.meanOvershoot).toBeCloseTo(750, 0);
      expect(profile.meanRiseTimeMs).toBeCloseTo(0, 0);
    });

    it('should aggregate meanTrackingErrorRMS from responses', () => {
      const responses = [
        { ...makeResponse(10, 20, 50, 5), trackingErrorRMS: 0.1 },
        { ...makeResponse(20, 40, 100, 10), trackingErrorRMS: 0.2 },
        { ...makeResponse(30, 60, 150, 15), trackingErrorRMS: 0.3 },
      ];

      const profile = aggregateAxisMetrics(responses);

      expect(profile.meanTrackingErrorRMS).toBeCloseTo(0.2, 2);
    });

    it('should handle missing trackingErrorRMS (treat as 0)', () => {
      const responses = [
        makeResponse(10, 20, 50, 5), // no trackingErrorRMS
        { ...makeResponse(20, 40, 100, 10), trackingErrorRMS: 0.4 },
      ];

      const profile = aggregateAxisMetrics(responses);

      // (0 + 0.4) / 2 = 0.2
      expect(profile.meanTrackingErrorRMS).toBeCloseTo(0.2, 2);
    });

    it('should aggregate meanSteadyStateError from responses', () => {
      const responses = [
        { ...makeResponse(10, 20, 50, 5), steadyStateErrorPercent: 2.0 },
        { ...makeResponse(20, 40, 100, 10), steadyStateErrorPercent: 4.0 },
        { ...makeResponse(15, 30, 75, 7), steadyStateErrorPercent: 6.0 },
      ];

      const profile = aggregateAxisMetrics(responses);

      expect(profile.meanSteadyStateError).toBeCloseTo(4.0, 1);
    });

    it('should handle missing steadyStateErrorPercent (treat as 0)', () => {
      const responses = [
        makeResponse(10, 20, 50, 5), // no steadyStateErrorPercent
        { ...makeResponse(20, 40, 100, 10), steadyStateErrorPercent: 6.0 },
      ];

      const profile = aggregateAxisMetrics(responses);

      // (0 + 6) / 2 = 3
      expect(profile.meanSteadyStateError).toBeCloseTo(3.0, 1);
    });
  });

  describe('classifyFFContribution', () => {
    it('should return true when pidF dominates at peak (FF-dominated overshoot)', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;
      const peakAt = stepAt + 50; // peak 50 samples after step

      // Gyro with overshoot
      const gyro = makeSeries((i) => {
        if (i < stepAt) return 0;
        if (i === peakAt) return stepMag * 1.3; // 30% overshoot peak
        if (i >= stepAt) return stepMag;
        return 0;
      }, numSamples);

      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 400, stepMag);
      const response = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      // pidF much larger than pidP at peak
      const pidP = makeSeries((i) => (i === peakAt ? 20 : 10), numSamples);
      const pidF = makeSeries((i) => (i === peakAt ? 80 : 5), numSamples);

      const result = classifyFFContribution(response, pidP, pidF, gyro);
      expect(result).toBe(true);
    });

    it('should return false when pidP dominates at peak (P-dominated overshoot)', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;
      const peakAt = stepAt + 50;

      const gyro = makeSeries((i) => {
        if (i < stepAt) return 0;
        if (i === peakAt) return stepMag * 1.3;
        if (i >= stepAt) return stepMag;
        return 0;
      }, numSamples);

      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 400, stepMag);
      const response = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      // pidP much larger than pidF at peak
      const pidP = makeSeries((i) => (i === peakAt ? 80 : 10), numSamples);
      const pidF = makeSeries((i) => (i === peakAt ? 10 : 5), numSamples);

      const result = classifyFFContribution(response, pidP, pidF, gyro);
      expect(result).toBe(false);
    });

    it('should return undefined when overshoot is below threshold', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;

      // No overshoot — gyro matches setpoint exactly
      const gyro = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const step = makeStep(stepAt, stepAt + 400, stepMag);
      const response = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      const pidP = makeSeries(() => 10, numSamples);
      const pidF = makeSeries(() => 5, numSamples);

      const result = classifyFFContribution(response, pidP, pidF, gyro);
      expect(result).toBeUndefined();
    });
  });

  describe('computeFFEnergyRatio', () => {
    it('should return undefined when pidF data is all zeros', () => {
      const numSamples = 2000;
      const step = makeStep(200, 600, 300);
      const pidP = makeSeries(() => 50, numSamples);
      const pidF = makeSeries(() => 0, numSamples);

      const result = computeFFEnergyRatio(step, pidP, pidF);
      expect(result).toBeUndefined();
    });

    it('should compute ffEnergyRatio when pidF has non-zero data', () => {
      const numSamples = 2000;
      const step = makeStep(200, 600, 300);
      // Equal energy: pidP and pidF both have constant magnitude
      const pidP = makeSeries(() => 50, numSamples);
      const pidF = makeSeries(() => 50, numSamples);

      const result = computeFFEnergyRatio(step, pidP, pidF);
      expect(result).toBeDefined();
      // Equal energy → ratio = 0.5
      expect(result!).toBeCloseTo(0.5, 2);
    });

    it('should return a value between 0 and 1', () => {
      const numSamples = 2000;
      const step = makeStep(200, 600, 300);
      const pidP = makeSeries((i) => (i >= 200 ? 30 + Math.sin(i * 0.1) * 10 : 5), numSamples);
      const pidF = makeSeries((i) => (i >= 200 ? 70 + Math.cos(i * 0.1) * 10 : 2), numSamples);

      const result = computeFFEnergyRatio(step, pidP, pidF);
      expect(result).toBeDefined();
      expect(result!).toBeGreaterThanOrEqual(0);
      expect(result!).toBeLessThanOrEqual(1);
    });

    it('should return > 0.6 when FF energy dominates', () => {
      const numSamples = 2000;
      const step = makeStep(200, 600, 300);
      const pidP = makeSeries(() => 10, numSamples);
      const pidF = makeSeries(() => 80, numSamples);

      const result = computeFFEnergyRatio(step, pidP, pidF);
      expect(result).toBeDefined();
      expect(result!).toBeGreaterThan(0.6);
    });

    it('should return < 0.6 when PID-P energy dominates', () => {
      const numSamples = 2000;
      const step = makeStep(200, 600, 300);
      const pidP = makeSeries(() => 80, numSamples);
      const pidF = makeSeries(() => 10, numSamples);

      const result = computeFFEnergyRatio(step, pidP, pidF);
      expect(result).toBeDefined();
      expect(result!).toBeLessThan(0.6);
    });

    it('should return undefined when both pidP and pidF are all zeros', () => {
      const numSamples = 2000;
      const step = makeStep(200, 600, 300);
      const pidP = makeSeries(() => 0, numSamples);
      const pidF = makeSeries(() => 0, numSamples);

      const result = computeFFEnergyRatio(step, pidP, pidF);
      expect(result).toBeUndefined();
    });
  });

  describe('ffDominated with energy ratio', () => {
    it('should set ffDominated=true when ffEnergyRatio > 0.6', () => {
      // This tests the integration pattern: when ffEnergyRatio is available,
      // ffDominated should be derived from it (ratio > 0.6 → true)
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;
      const step = makeStep(stepAt, stepAt + 400, stepMag);

      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const gyro = makeSeries((i) => {
        if (i < stepAt) return 0;
        if (i === stepAt + 50) return stepMag * 1.3;
        return stepMag;
      }, numSamples);
      const response = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      // FF-dominated: large pidF, small pidP
      const pidP = makeSeries(() => 10, numSamples);
      const pidF = makeSeries(() => 80, numSamples);
      const ratio = computeFFEnergyRatio(step, pidP, pidF);

      expect(ratio).toBeDefined();
      expect(ratio!).toBeGreaterThan(0.6);
      // In the analyzer, this would set ffDominated = true
      response.ffEnergyRatio = ratio;
      response.ffDominated = ratio! > 0.6;
      expect(response.ffDominated).toBe(true);
    });

    it('should fall back to legacy classifyFFContribution when pidF is all zeros', () => {
      const numSamples = 2000;
      const stepAt = 200;
      const stepMag = 300;
      const step = makeStep(stepAt, stepAt + 400, stepMag);

      const setpoint = makeSeries((i) => (i >= stepAt ? stepMag : 0), numSamples);
      const gyro = makeSeries((i) => {
        if (i < stepAt) return 0;
        if (i === stepAt + 50) return stepMag * 1.3;
        return stepMag;
      }, numSamples);
      const response = computeStepResponse(setpoint, gyro, step, SAMPLE_RATE);

      const pidP = makeSeries(() => 50, numSamples);
      const pidF = makeSeries(() => 0, numSamples);

      // Energy ratio is undefined (pidF all zeros)
      const ratio = computeFFEnergyRatio(step, pidP, pidF);
      expect(ratio).toBeUndefined();

      // Legacy fallback should still work
      const legacy = classifyFFContribution(response, pidP, pidF, gyro);
      // With zero pidF at peak, pidP dominates → false
      expect(legacy).toBe(false);
    });
  });

  describe('aggregateAxisMetrics with meanFFEnergyRatio', () => {
    function makeResponseWithFF(
      overshoot: number,
      riseTime: number,
      settling: number,
      latency: number,
      ffEnergyRatio?: number
    ): StepResponse {
      return {
        step: makeStep(0, 100, 300),
        riseTimeMs: riseTime,
        overshootPercent: overshoot,
        settlingTimeMs: settling,
        latencyMs: latency,
        ringingCount: 0,
        peakValue: 300,
        steadyStateValue: 300,
        ffEnergyRatio,
      };
    }

    it('should compute meanFFEnergyRatio from responses', () => {
      const responses = [
        makeResponseWithFF(10, 20, 50, 5, 0.3),
        makeResponseWithFF(20, 40, 100, 10, 0.7),
        makeResponseWithFF(30, 60, 150, 15, 0.5),
      ];
      const profile = aggregateAxisMetrics(responses);
      expect(profile.meanFFEnergyRatio).toBeCloseTo(0.5, 2);
    });

    it('should be undefined when no responses have ffEnergyRatio', () => {
      const responses = [makeResponseWithFF(10, 20, 50, 5), makeResponseWithFF(20, 40, 100, 10)];
      const profile = aggregateAxisMetrics(responses);
      expect(profile.meanFFEnergyRatio).toBeUndefined();
    });

    it('should only average responses that have ffEnergyRatio', () => {
      const responses = [
        makeResponseWithFF(10, 20, 50, 5, 0.8),
        makeResponseWithFF(20, 40, 100, 10), // no ratio
        makeResponseWithFF(30, 60, 150, 15, 0.4),
      ];
      const profile = aggregateAxisMetrics(responses);
      // Only 0.8 and 0.4 → mean = 0.6
      expect(profile.meanFFEnergyRatio).toBeCloseTo(0.6, 2);
    });
  });

  describe('computeAdaptiveWindowMs', () => {
    function makeResponse(settlingTimeMs: number): StepResponse {
      return {
        step: makeStep(0, 1000, 300),
        riseTimeMs: 20,
        overshootPercent: 10,
        settlingTimeMs,
        latencyMs: 5,
        ringingCount: 1,
        peakValue: 330,
        steadyStateValue: 300,
        trackingErrorRMS: 0.1,
      };
    }

    it('returns 2× median settling time for normal data', () => {
      // Median of [80, 100, 120] = 100 → adaptive = 200ms
      const responses = [makeResponse(80), makeResponse(100), makeResponse(120)];
      expect(computeAdaptiveWindowMs(responses)).toBe(200);
    });

    it('clamps to minimum 150ms for fast-settling quads', () => {
      // Median of [40, 50, 60] = 50 → 2×50 = 100 → clamped to 150
      const responses = [makeResponse(40), makeResponse(50), makeResponse(60)];
      expect(computeAdaptiveWindowMs(responses)).toBe(150);
    });

    it('clamps to maximum 500ms for slow-settling quads', () => {
      // Median of [300, 350, 400] = 350 → 2×350 = 700 → clamped to 500
      const responses = [makeResponse(300), makeResponse(350), makeResponse(400)];
      expect(computeAdaptiveWindowMs(responses)).toBe(500);
    });

    it('falls back to 300ms when too few responses', () => {
      const responses = [makeResponse(100), makeResponse(120)];
      expect(computeAdaptiveWindowMs(responses)).toBe(300);
    });

    it('falls back to 300ms for empty input', () => {
      expect(computeAdaptiveWindowMs([])).toBe(300);
    });

    it('handles even number of responses (average of middle two)', () => {
      // Median of [80, 100, 120, 140] = (100+120)/2 = 110 → 220ms
      const responses = [makeResponse(80), makeResponse(100), makeResponse(120), makeResponse(140)];
      expect(computeAdaptiveWindowMs(responses)).toBe(220);
    });

    it('filters out zero settling time (degenerate steps)', () => {
      // Only 2 valid settling times → falls back to 300ms
      const responses = [makeResponse(0), makeResponse(100), makeResponse(120)];
      expect(computeAdaptiveWindowMs(responses)).toBe(300);
    });

    it('uses custom minResponses threshold', () => {
      const responses = [makeResponse(100), makeResponse(120)];
      // With minResponses=2, should compute adaptive: median=110 → 220ms
      expect(computeAdaptiveWindowMs(responses, 2)).toBe(220);
    });

    it('produces correct value for tiny whoop settling times', () => {
      // Tiny whoops: ~60-80ms settling → 2×70 = 140 → clamped to 150
      const responses = [
        makeResponse(60),
        makeResponse(70),
        makeResponse(80),
        makeResponse(65),
        makeResponse(75),
      ];
      expect(computeAdaptiveWindowMs(responses)).toBe(150);
    });

    it('produces correct value for 5-inch freestyle settling times', () => {
      // 5" freestyle: ~100-160ms settling → median ~130 → 260ms
      const responses = [
        makeResponse(100),
        makeResponse(120),
        makeResponse(130),
        makeResponse(150),
        makeResponse(160),
      ];
      expect(computeAdaptiveWindowMs(responses)).toBe(260);
    });

    it('produces correct value for 7-inch longrange settling times', () => {
      // 7" longrange: ~200-300ms settling → median ~250 → 500ms (capped)
      const responses = [
        makeResponse(200),
        makeResponse(230),
        makeResponse(250),
        makeResponse(280),
        makeResponse(300),
      ];
      expect(computeAdaptiveWindowMs(responses)).toBe(500);
    });
  });
});
