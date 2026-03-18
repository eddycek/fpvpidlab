import { describe, it, expect } from 'vitest';
import { computeVerificationDelta, VerificationInput } from './verificationDelta';

const axis = (v: number) => ({ roll: v, pitch: v, yaw: v });

describe('computeVerificationDelta', () => {
  it('filter mode: noise floor improvement produces positive overallImprovement', () => {
    const input: VerificationInput = {
      mode: 'filter',
      before: { noiseFloorDb: axis(-20) },
      after: { noiseFloorDb: axis(-30) }, // 10 dB reduction = improvement
    };
    const result = computeVerificationDelta(input);

    expect(result.noiseFloorDeltaDb).toEqual(axis(-10));
    // -(-10) * 5 = 50
    expect(result.overallImprovement).toBe(50);
  });

  it('PID mode: overshoot + rise time improvement', () => {
    const input: VerificationInput = {
      mode: 'pid',
      before: {
        meanOvershootPct: axis(30),
        meanRiseTimeMs: axis(80),
      },
      after: {
        meanOvershootPct: axis(10), // 20% reduction
        meanRiseTimeMs: axis(50), // 30ms faster
      },
    };
    const result = computeVerificationDelta(input);

    expect(result.overshootDeltaPct).toEqual(axis(-20));
    expect(result.riseTimeDeltaMs).toEqual(axis(-30));
    // Overshoot: -(-20)*2 = 40, Rise time: -(-30) = 30 => avg = 35
    expect(result.overallImprovement).toBe(35);
  });

  it('Flash mode: bandwidth + phase margin improvement', () => {
    const input: VerificationInput = {
      mode: 'flash',
      before: {
        bandwidthHz: axis(100),
        phaseMarginDeg: axis(30),
      },
      after: {
        bandwidthHz: axis(130), // +30 Hz
        phaseMarginDeg: axis(50), // +20 deg
      },
    };
    const result = computeVerificationDelta(input);

    expect(result.bandwidthDeltaHz).toEqual(axis(30));
    expect(result.phaseMarginDeltaDeg).toEqual(axis(20));
    // Bandwidth: 30*2 = 60, Phase margin: 20*2 = 40 => avg = 50
    expect(result.overallImprovement).toBe(50);
  });

  it('mixed improvement/regression', () => {
    const input: VerificationInput = {
      mode: 'filter',
      before: {
        noiseFloorDb: axis(-20),
        meanOvershootPct: axis(10),
      },
      after: {
        noiseFloorDb: axis(-25), // 5 dB improvement
        meanOvershootPct: axis(20), // 10% regression
      },
    };
    const result = computeVerificationDelta(input);

    // Noise: -(-5)*5 = 25, Overshoot: -(10)*2 = -20 => avg = 3 (rounded)
    expect(result.overallImprovement).toBe(3);
  });

  it('missing metrics: only some fields present', () => {
    const input: VerificationInput = {
      mode: 'flash',
      before: {
        bandwidthHz: axis(100),
        // no noiseFloorDb, overshoot, riseTime, phaseMargin
      },
      after: {
        bandwidthHz: axis(150),
      },
    };
    const result = computeVerificationDelta(input);

    expect(result.noiseFloorDeltaDb).toBeUndefined();
    expect(result.overshootDeltaPct).toBeUndefined();
    expect(result.riseTimeDeltaMs).toBeUndefined();
    expect(result.phaseMarginDeltaDeg).toBeUndefined();
    expect(result.bandwidthDeltaHz).toEqual(axis(50));
    // Only bandwidth: 50*2 = 100
    expect(result.overallImprovement).toBe(100);
  });

  it('identical before/after produces overallImprovement = 0', () => {
    const input: VerificationInput = {
      mode: 'pid',
      before: {
        noiseFloorDb: axis(-25),
        meanOvershootPct: axis(15),
        meanRiseTimeMs: axis(60),
      },
      after: {
        noiseFloorDb: axis(-25),
        meanOvershootPct: axis(15),
        meanRiseTimeMs: axis(60),
      },
    };
    const result = computeVerificationDelta(input);

    expect(result.noiseFloorDeltaDb).toEqual(axis(0));
    expect(result.overshootDeltaPct).toEqual(axis(0));
    expect(result.riseTimeDeltaMs).toEqual(axis(0));
    expect(result.overallImprovement).toBe(0);
  });

  it('no metrics at all produces overallImprovement = 0', () => {
    const input: VerificationInput = {
      mode: 'filter',
      before: {},
      after: {},
    };
    const result = computeVerificationDelta(input);
    expect(result.overallImprovement).toBe(0);
  });

  it('rise time is only included for PID mode', () => {
    const input: VerificationInput = {
      mode: 'filter',
      before: { meanRiseTimeMs: axis(80) },
      after: { meanRiseTimeMs: axis(50) },
    };
    const result = computeVerificationDelta(input);

    // Filter mode should not include rise time
    expect(result.riseTimeDeltaMs).toBeUndefined();
    expect(result.overallImprovement).toBe(0);
  });

  it('clamps extreme values to -100..+100', () => {
    const input: VerificationInput = {
      mode: 'filter',
      before: { noiseFloorDb: axis(-10) },
      after: { noiseFloorDb: axis(-60) }, // 50 dB improvement, would be 250 unclamped
    };
    const result = computeVerificationDelta(input);

    // -(-50)*5 = 250, clamped to 100
    expect(result.overallImprovement).toBe(100);
  });

  it('per-axis deltas are computed correctly with different values', () => {
    const input: VerificationInput = {
      mode: 'filter',
      before: { noiseFloorDb: { roll: -20, pitch: -25, yaw: -30 } },
      after: { noiseFloorDb: { roll: -25, pitch: -30, yaw: -32 } },
    };
    const result = computeVerificationDelta(input);

    expect(result.noiseFloorDeltaDb).toEqual({ roll: -5, pitch: -5, yaw: -2 });
  });
});
