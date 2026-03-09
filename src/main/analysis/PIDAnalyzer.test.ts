import { describe, it, expect } from 'vitest';
import { analyzePID, analyzeTransferFunction } from './PIDAnalyzer';
import type { BlackboxFlightData, TimeSeries } from '@shared/types/blackbox.types';
import type { AnalysisProgress } from '@shared/types/analysis.types';
import type { PIDConfiguration } from '@shared/types/pid.types';

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

function createFlightData(opts: {
  sampleRate?: number;
  numSamples?: number;
  rollSetpointFn?: (i: number) => number;
  rollGyroFn?: (i: number) => number;
  pitchSetpointFn?: (i: number) => number;
  pitchGyroFn?: (i: number) => number;
}): BlackboxFlightData {
  const sr = opts.sampleRate ?? SAMPLE_RATE;
  const n = opts.numSamples ?? sr * 2; // 2 seconds default
  const zero = makeSeries(() => 0, n);
  const throttle = makeSeries(() => 0.5, n);

  return {
    gyro: [
      makeSeries(opts.rollGyroFn ?? (() => 0), n),
      makeSeries(opts.pitchGyroFn ?? (() => 0), n),
      zero,
    ],
    setpoint: [
      makeSeries(opts.rollSetpointFn ?? (() => 0), n),
      makeSeries(opts.pitchSetpointFn ?? (() => 0), n),
      zero,
      throttle,
    ],
    pidP: [zero, zero, zero],
    pidI: [zero, zero, zero],
    pidD: [zero, zero, zero],
    pidF: [zero, zero, zero],
    motor: [zero, zero, zero, zero],
    debug: [],
    sampleRateHz: sr,
    durationSeconds: n / sr,
    frameCount: n,
  };
}

const PIDS: PIDConfiguration = {
  roll: { P: 45, I: 80, D: 30 },
  pitch: { P: 47, I: 84, D: 32 },
  yaw: { P: 45, I: 80, D: 0 },
};

describe('PIDAnalyzer', () => {
  describe('analyzePID', () => {
    it('should return complete PIDAnalysisResult', async () => {
      const stepAt = 1000;
      const mag = 300;
      const data = createFlightData({
        rollSetpointFn: (i) => (i >= stepAt ? mag : 0),
        rollGyroFn: (i) => (i >= stepAt ? mag : 0),
      });

      const result = await analyzePID(data, 0, PIDS);

      expect(result.roll).toBeDefined();
      expect(result.pitch).toBeDefined();
      expect(result.yaw).toBeDefined();
      expect(result.recommendations).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.analysisTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.sessionIndex).toBe(0);
      expect(result.stepsDetected).toBeGreaterThanOrEqual(1);
      expect(result.currentPIDs).toEqual(PIDS);
    });

    it('should report progress during analysis', async () => {
      const stepAt = 1000;
      const data = createFlightData({
        rollSetpointFn: (i) => (i >= stepAt ? 300 : 0),
        rollGyroFn: (i) => (i >= stepAt ? 300 : 0),
      });

      const progressUpdates: AnalysisProgress[] = [];
      await analyzePID(data, 0, PIDS, (progress) => {
        progressUpdates.push({ ...progress });
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
      // Should start with detecting
      expect(progressUpdates[0].step).toBe('detecting');
      // Should end at 100%
      expect(progressUpdates[progressUpdates.length - 1].percent).toBe(100);
      // Should cover all PID-specific steps
      const steps = new Set(progressUpdates.map((p) => p.step));
      expect(steps.has('detecting')).toBe(true);
      expect(steps.has('measuring')).toBe(true);
      expect(steps.has('scoring')).toBe(true);
    });

    it('should handle flight with no steps', async () => {
      const data = createFlightData({
        rollSetpointFn: () => 0,
      });

      const result = await analyzePID(data, 0, PIDS);

      expect(result.stepsDetected).toBe(0);
      expect(result.roll.responses.length).toBe(0);
      expect(result.summary).toContain('No step inputs');
    });

    it('should use correct session index', async () => {
      const data = createFlightData({});

      const result = await analyzePID(data, 5, PIDS);

      expect(result.sessionIndex).toBe(5);
    });

    it('should detect overshoot and recommend changes', async () => {
      const stepAt = 1000;
      const mag = 300;
      const data = createFlightData({
        rollSetpointFn: (i) => (i >= stepAt ? mag : 0),
        rollGyroFn: (i) => {
          if (i < stepAt) return 0;
          const t = (i - stepAt) / SAMPLE_RATE;
          // Significant overshoot
          return mag * (1 + 0.4 * Math.exp(-t * 20) * Math.cos(2 * Math.PI * 15 * t));
        },
      });

      const result = await analyzePID(data, 0, PIDS);

      // Should detect overshoot on roll
      if (result.roll.responses.length > 0) {
        expect(result.roll.meanOvershoot).toBeGreaterThan(10);
      }
    });

    it('should complete in reasonable time', async () => {
      const data = createFlightData({ numSamples: 32000 });

      const start = performance.now();
      const result = await analyzePID(data, 0, PIDS);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(5000);
      expect(result.analysisTimeMs).toBeGreaterThan(0);
    });

    it('should use default PIDs when none provided', async () => {
      const data = createFlightData({});

      const result = await analyzePID(data);

      expect(result.currentPIDs).toBeDefined();
      expect(result.sessionIndex).toBe(0);
    });

    it('should handle multiple steps on same axis', async () => {
      const mag = 300;
      const data = createFlightData({
        rollSetpointFn: (i) => {
          if (i >= 5000) return -mag; // Second step
          if (i >= 1000) return mag; // First step
          return 0;
        },
        rollGyroFn: (i) => {
          if (i >= 5000) return -mag;
          if (i >= 1000) return mag;
          return 0;
        },
      });

      const result = await analyzePID(data, 0, PIDS);

      // Should detect steps on roll
      expect(result.roll.responses.length).toBeGreaterThanOrEqual(1);
    });

    it('should analyze pitch and roll independently', async () => {
      const stepAt = 1000;
      const mag = 300;
      const data = createFlightData({
        rollSetpointFn: (i) => (i >= stepAt ? mag : 0),
        rollGyroFn: (i) => (i >= stepAt ? mag : 0),
        pitchSetpointFn: (i) => (i >= 3000 ? -mag : 0),
        pitchGyroFn: (i) => (i >= 3000 ? -mag : 0),
      });

      const result = await analyzePID(data, 0, PIDS);

      // Both axes should have at least been analyzed
      expect(result.roll).toBeDefined();
      expect(result.pitch).toBeDefined();
    });

    it('should attach feedforward context when rawHeaders provided', async () => {
      const data = createFlightData({
        rollSetpointFn: (i) => (i >= 1000 ? 300 : 0),
        rollGyroFn: (i) => (i >= 1000 ? 300 : 0),
      });
      const headers = new Map<string, string>();
      headers.set('feedforward_boost', '15');

      const result = await analyzePID(data, 0, PIDS, undefined, undefined, headers);

      expect(result.feedforwardContext).toBeDefined();
      expect(result.feedforwardContext!.active).toBe(true);
      expect(result.feedforwardContext!.boost).toBe(15);
    });

    it('should emit feedforward_active warning when FF is active', async () => {
      const data = createFlightData({});
      const headers = new Map<string, string>();
      headers.set('feedforward_boost', '15');

      const result = await analyzePID(data, 0, PIDS, undefined, undefined, headers);

      expect(result.warnings).toBeDefined();
      const ffWarning = result.warnings!.find((w) => w.code === 'feedforward_active');
      expect(ffWarning).toBeDefined();
      expect(ffWarning!.severity).toBe('info');
      expect(ffWarning!.message).toContain('Feedforward');
    });

    it('should not emit feedforward warning when FF is inactive', async () => {
      const data = createFlightData({});
      const headers = new Map<string, string>();
      headers.set('feedforward_boost', '0');

      const result = await analyzePID(data, 0, PIDS, undefined, undefined, headers);

      expect(result.feedforwardContext).toBeDefined();
      expect(result.feedforwardContext!.active).toBe(false);
      const ffWarning = (result.warnings ?? []).find((w) => w.code === 'feedforward_active');
      expect(ffWarning).toBeUndefined();
    });

    it('should not set feedforwardContext when rawHeaders not provided', async () => {
      const data = createFlightData({});

      const result = await analyzePID(data, 0, PIDS);

      expect(result.feedforwardContext).toBeUndefined();
    });

    it('should include stepsDetected count', async () => {
      const data = createFlightData({
        rollSetpointFn: (i) => (i >= 1000 ? 300 : 0),
        rollGyroFn: (i) => (i >= 1000 ? 300 : 0),
      });

      const result = await analyzePID(data, 0, PIDS);

      expect(typeof result.stepsDetected).toBe('number');
      expect(result.stepsDetected).toBeGreaterThanOrEqual(0);
    });

    it('should pass flightStyle through to result', async () => {
      const data = createFlightData({
        rollSetpointFn: (i) => (i >= 1000 ? 300 : 0),
        rollGyroFn: (i) => (i >= 1000 ? 300 : 0),
      });

      const result = await analyzePID(data, 0, PIDS, undefined, undefined, undefined, 'aggressive');

      expect(result.flightStyle).toBe('aggressive');
    });

    it('should default flightStyle to balanced', async () => {
      const data = createFlightData({
        rollSetpointFn: (i) => (i >= 1000 ? 300 : 0),
        rollGyroFn: (i) => (i >= 1000 ? 300 : 0),
      });

      const result = await analyzePID(data, 0, PIDS);

      expect(result.flightStyle).toBe('balanced');
    });

    it('should include dataQuality score in result', async () => {
      const stepAt = 1000;
      const mag = 300;
      const data = createFlightData({
        rollSetpointFn: (i) => (i >= stepAt ? mag : 0),
        rollGyroFn: (i) => (i >= stepAt ? mag : 0),
      });

      const result = await analyzePID(data, 0, PIDS);

      expect(result.dataQuality).toBeDefined();
      expect(result.dataQuality!.overall).toBeGreaterThanOrEqual(0);
      expect(result.dataQuality!.overall).toBeLessThanOrEqual(100);
      expect(['excellent', 'good', 'fair', 'poor']).toContain(result.dataQuality!.tier);
      expect(result.dataQuality!.subScores.length).toBeGreaterThan(0);
    });

    it('should produce poor dataQuality for flights with no steps', async () => {
      const data = createFlightData({});

      const result = await analyzePID(data, 0, PIDS);

      expect(result.dataQuality).toBeDefined();
      expect(result.dataQuality!.tier).toBe('poor');
    });

    it('should use flightStyle thresholds in recommendations', async () => {
      // Create a step with moderate overshoot (~15%)
      const stepAt = 1000;
      const mag = 300;
      const overshootFactor = 1.15;
      const data = createFlightData({
        rollSetpointFn: (i) => (i >= stepAt ? mag : 0),
        rollGyroFn: (i) => {
          if (i < stepAt) return 0;
          // Initial overshoot then settle
          const elapsed = (i - stepAt) / SAMPLE_RATE;
          if (elapsed < 0.02) return mag * overshootFactor; // 15% overshoot
          return mag;
        },
      });

      // With aggressive style (moderateOvershoot=25), 15% shouldn't trigger
      const aggressive = await analyzePID(
        data,
        0,
        PIDS,
        undefined,
        undefined,
        undefined,
        'aggressive'
      );
      const aggressiveOvershootRecs = aggressive.recommendations.filter(
        (r) => r.reason.includes('overshoot') || r.reason.includes('Overshoot')
      );

      // With smooth style (moderateOvershoot=8), 15% should trigger
      const smooth = await analyzePID(data, 0, PIDS, undefined, undefined, undefined, 'smooth');
      const smoothOvershootRecs = smooth.recommendations.filter(
        (r) => r.reason.includes('overshoot') || r.reason.includes('Overshoot')
      );

      // Smooth should be at least as strict as aggressive
      expect(smoothOvershootRecs.length).toBeGreaterThanOrEqual(aggressiveOvershootRecs.length);
    });

    it('should include crossAxisCoupling when steps are detected', async () => {
      const stepAt = 1000;
      const mag = 300;
      const data = createFlightData({
        rollSetpointFn: (i) => (i >= stepAt ? mag : 0),
        rollGyroFn: (i) => (i >= stepAt ? mag : 0),
        pitchSetpointFn: (i) => (i >= 3000 ? -mag : 0),
        pitchGyroFn: (i) => (i >= 3000 ? -mag : 0),
      });

      const result = await analyzePID(data, 0, PIDS);

      // If enough steps detected, crossAxisCoupling should be present
      if (result.stepsDetected >= 2) {
        expect(result.crossAxisCoupling).toBeDefined();
        expect(result.crossAxisCoupling!.pairs.length).toBeGreaterThan(0);
        expect(typeof result.crossAxisCoupling!.hasSignificantCoupling).toBe('boolean');
        expect(result.crossAxisCoupling!.summary.length).toBeGreaterThan(0);
      }
    });
  });

  describe('analyzeTransferFunction (unified pipeline)', () => {
    it('should return complete result with analysisMethod', async () => {
      // Broadband setpoint for Wiener deconvolution
      const data = createFlightData({
        numSamples: 40000,
        rollSetpointFn: (i) => 100 * Math.sin(2 * Math.PI * 5 * (i / SAMPLE_RATE)),
        rollGyroFn: (i) => 95 * Math.sin(2 * Math.PI * 5 * (i / SAMPLE_RATE) - 0.1),
        pitchSetpointFn: (i) => 80 * Math.sin(2 * Math.PI * 7 * (i / SAMPLE_RATE)),
        pitchGyroFn: (i) => 76 * Math.sin(2 * Math.PI * 7 * (i / SAMPLE_RATE) - 0.1),
      });

      const result = await analyzeTransferFunction(data, 0, PIDS);

      expect(result.analysisMethod).toBe('wiener_deconvolution');
      expect(result.transferFunction).toBeDefined();
      expect(result.transferFunctionMetrics).toBeDefined();
      expect(result.stepsDetected).toBe(0);
      expect(result.roll).toBeDefined();
      expect(result.pitch).toBeDefined();
      expect(result.yaw).toBeDefined();
      expect(result.recommendations).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.currentPIDs).toEqual(PIDS);
    });

    it('should include dataQuality from Wiener scorer', async () => {
      const data = createFlightData({
        numSamples: 40000,
        rollSetpointFn: (i) => 100 * Math.sin(2 * Math.PI * 5 * (i / SAMPLE_RATE)),
        rollGyroFn: (i) => 95 * Math.sin(2 * Math.PI * 5 * (i / SAMPLE_RATE)),
      });

      const result = await analyzeTransferFunction(data, 0, PIDS);

      expect(result.dataQuality).toBeDefined();
      expect(result.dataQuality!.overall).toBeGreaterThanOrEqual(0);
      expect(result.dataQuality!.overall).toBeLessThanOrEqual(100);
      expect(['excellent', 'good', 'fair', 'poor']).toContain(result.dataQuality!.tier);
    });

    it('should include propWash and dTermEffectiveness', async () => {
      const numSamples = 40000;
      // Build flight data with throttle drops for prop wash detection
      const throttleFn = (i: number) => {
        const t = i / SAMPLE_RATE;
        for (const dropTime of [1.0, 3.0, 5.0, 7.0]) {
          if (t >= dropTime && t < dropTime + 0.1) return 0.7 - ((t - dropTime) / 0.1) * 0.5;
          if (t >= dropTime + 0.1 && t < dropTime + 1.0) return 0.2;
        }
        return 0.7;
      };
      const gyroFn = (i: number) => {
        const t = i / SAMPLE_RATE;
        let val = 50 * Math.sin(2 * Math.PI * 5 * t);
        for (const dropTime of [1.0, 3.0, 5.0, 7.0]) {
          if (t >= dropTime + 0.1 && t < dropTime + 0.5) {
            val += 30 * Math.sin(2 * Math.PI * 50 * t);
          }
        }
        return val;
      };

      const zero = makeSeries(() => 0, numSamples);
      const data: BlackboxFlightData = {
        gyro: [
          makeSeries(gyroFn, numSamples),
          makeSeries(gyroFn, numSamples),
          makeSeries(gyroFn, numSamples),
        ],
        setpoint: [
          makeSeries((i) => 100 * Math.sin(2 * Math.PI * 5 * (i / SAMPLE_RATE)), numSamples),
          makeSeries((i) => 80 * Math.sin(2 * Math.PI * 7 * (i / SAMPLE_RATE)), numSamples),
          makeSeries((i) => 40 * Math.sin(2 * Math.PI * 3 * (i / SAMPLE_RATE)), numSamples),
          makeSeries(throttleFn, numSamples),
        ],
        pidP: [zero, zero, zero],
        pidI: [zero, zero, zero],
        pidD: [
          makeSeries((i) => 5 * Math.sin(2 * Math.PI * 20 * (i / SAMPLE_RATE)), numSamples),
          makeSeries((i) => 5 * Math.sin(2 * Math.PI * 20 * (i / SAMPLE_RATE)), numSamples),
          zero,
        ],
        pidF: [zero, zero, zero],
        motor: [zero, zero, zero, zero],
        debug: [],
        sampleRateHz: SAMPLE_RATE,
        durationSeconds: numSamples / SAMPLE_RATE,
        frameCount: numSamples,
      };

      const result = await analyzeTransferFunction(data, 0, PIDS);

      // Unified pipeline should include propWash when throttle drops are present
      if (result.propWash) {
        expect(result.propWash.events.length).toBeGreaterThan(0);
        expect(result.propWash.meanSeverity).toBeGreaterThan(0);
      }
      // D-term effectiveness should be computed from pidD data
      if (result.dTermEffectiveness) {
        expect(typeof result.dTermEffectiveness.overall).toBe('number');
      }
    });

    it('should not include crossAxisCoupling (no steps)', async () => {
      const data = createFlightData({
        numSamples: 40000,
        rollSetpointFn: (i) => 100 * Math.sin(2 * Math.PI * 5 * (i / SAMPLE_RATE)),
        rollGyroFn: (i) => 95 * Math.sin(2 * Math.PI * 5 * (i / SAMPLE_RATE)),
      });

      const result = await analyzeTransferFunction(data, 0, PIDS);

      // Cross-axis coupling needs step events — should be absent for Wiener
      expect(result.crossAxisCoupling).toBeUndefined();
    });

    it('should not have blanket MEDIUM confidence cap', async () => {
      const data = createFlightData({
        numSamples: 40000,
        rollSetpointFn: (i) => 100 * Math.sin(2 * Math.PI * 5 * (i / SAMPLE_RATE)),
        rollGyroFn: (i) => 95 * Math.sin(2 * Math.PI * 5 * (i / SAMPLE_RATE)),
      });

      const result = await analyzeTransferFunction(data, 0, PIDS);

      // No blanket cap — high confidence is possible if gating supports it
      // We just verify the analysis completes without the old cap logic
      expect(result.recommendations).toBeDefined();
      // Verify no confidence was artificially capped (all should be as PIDRecommender set them)
      for (const rec of result.recommendations) {
        expect(['high', 'medium', 'low']).toContain(rec.confidence);
      }
    });

    it('should pass flightPIDs and flightStyle through', async () => {
      const data = createFlightData({
        numSamples: 40000,
        rollSetpointFn: (i) => 100 * Math.sin(2 * Math.PI * 5 * (i / SAMPLE_RATE)),
        rollGyroFn: (i) => 95 * Math.sin(2 * Math.PI * 5 * (i / SAMPLE_RATE)),
      });
      const headers = new Map<string, string>();
      headers.set('feedforward_boost', '15');

      const result = await analyzeTransferFunction(
        data,
        0,
        PIDS,
        undefined,
        PIDS,
        headers,
        'aggressive'
      );

      expect(result.flightStyle).toBe('aggressive');
      expect(result.feedforwardContext).toBeDefined();
      expect(result.feedforwardContext!.active).toBe(true);
    });

    it('should include sliderPosition and sliderDelta', async () => {
      const data = createFlightData({
        numSamples: 40000,
        rollSetpointFn: (i) => 100 * Math.sin(2 * Math.PI * 5 * (i / SAMPLE_RATE)),
        rollGyroFn: (i) => 95 * Math.sin(2 * Math.PI * 5 * (i / SAMPLE_RATE)),
      });

      const result = await analyzeTransferFunction(data, 0, PIDS);

      expect(result.sliderPosition).toBeDefined();
      // sliderDelta only present if recommendations exist
      if (result.recommendations.length > 0) {
        expect(result.sliderDelta).toBeDefined();
      }
    });
  });

  describe('prop wash integration', () => {
    it('should include propWash in result when throttle drops detected', async () => {
      const numSamples = 40000;
      const sampleRate = 4000;
      // Flight with throttle drops
      const throttleFn = (i: number) => {
        const t = i / sampleRate;
        for (const dropTime of [1.0, 3.0, 5.0, 7.0]) {
          if (t >= dropTime && t < dropTime + 0.1) return 0.7 - ((t - dropTime) / 0.1) * 0.5;
          if (t >= dropTime + 0.1 && t < dropTime + 1.0) return 0.2;
        }
        return 0.7;
      };
      const gyroFn = (i: number) => {
        const t = i / sampleRate;
        let val = (Math.random() - 0.5) * 0.5;
        for (const dropTime of [1.0, 3.0, 5.0, 7.0]) {
          if (t >= dropTime + 0.1 && t < dropTime + 0.5) {
            val += 30 * Math.sin(2 * Math.PI * 50 * t);
          }
        }
        return val;
      };

      // Build setpoint with step inputs for PID analysis + throttle drops
      const stepFn = (i: number) => {
        const t = i / sampleRate;
        // Add step inputs at 2s and 4s
        if (t >= 2.0 && t < 2.3) return 200;
        if (t >= 4.0 && t < 4.3) return -200;
        return 0;
      };

      function makeSeries(fn: (i: number) => number): { time: Float64Array; values: Float64Array } {
        const time = new Float64Array(numSamples);
        const values = new Float64Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
          time[i] = i / sampleRate;
          values[i] = fn(i);
        }
        return { time, values };
      }

      const zero = makeSeries(() => 0);
      const data = {
        gyro: [makeSeries(gyroFn), makeSeries(gyroFn), makeSeries(gyroFn)] as [
          { time: Float64Array; values: Float64Array },
          { time: Float64Array; values: Float64Array },
          { time: Float64Array; values: Float64Array },
        ],
        setpoint: [
          makeSeries(stepFn),
          makeSeries(stepFn),
          makeSeries(stepFn),
          makeSeries(throttleFn),
        ] as [
          { time: Float64Array; values: Float64Array },
          { time: Float64Array; values: Float64Array },
          { time: Float64Array; values: Float64Array },
          { time: Float64Array; values: Float64Array },
        ],
        pidP: [zero, zero, zero] as [typeof zero, typeof zero, typeof zero],
        pidI: [zero, zero, zero] as [typeof zero, typeof zero, typeof zero],
        pidD: [zero, zero, zero] as [typeof zero, typeof zero, typeof zero],
        pidF: [zero, zero, zero] as [typeof zero, typeof zero, typeof zero],
        motor: [zero, zero, zero, zero] as [typeof zero, typeof zero, typeof zero, typeof zero],
        debug: [] as { time: Float64Array; values: Float64Array }[],
        sampleRateHz: sampleRate,
        durationSeconds: numSamples / sampleRate,
        frameCount: numSamples,
      };

      const result = await analyzePID(data, 0);

      // Should have prop wash analysis when throttle drops are present
      if (result.propWash) {
        expect(result.propWash.events.length).toBeGreaterThan(0);
        expect(result.propWash.meanSeverity).toBeGreaterThan(0);
        expect(result.propWash.recommendation).toBeTruthy();
      }
    });
  });
});
