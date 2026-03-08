import { describe, it, expect } from 'vitest';
import {
  mapToSliders,
  computeSliderDelta,
  buildRecommendedPIDs,
  BF_REFERENCE_PIDS,
} from './SliderMapper';

describe('mapToSliders', () => {
  it('should return 1.0x multipliers for BF default PIDs', () => {
    const result = mapToSliders(BF_REFERENCE_PIDS);

    expect(result.masterMultiplier).toBe(1);
    expect(result.pdRatio).toBe(1);
    expect(result.axes.roll.pMultiplier).toBe(1);
    expect(result.axes.roll.iMultiplier).toBe(1);
    expect(result.axes.roll.dMultiplier).toBe(1);
    expect(result.axes.pitch.pMultiplier).toBe(1);
    expect(result.axes.pitch.dMultiplier).toBe(1);
  });

  it('should compute correct master multiplier for scaled PIDs', () => {
    const result = mapToSliders({
      roll: { P: 90, I: 160, D: 60 },
      pitch: { P: 94, I: 168, D: 64 },
      yaw: { P: 90, I: 160, D: 0 },
    });

    expect(result.masterMultiplier).toBe(2);
    expect(result.axes.roll.pMultiplier).toBe(2);
    expect(result.axes.roll.dMultiplier).toBe(2);
  });

  it('should detect D-heavy balance', () => {
    // Double D but keep P at default → PD ratio > 1
    const result = mapToSliders({
      roll: { P: 45, I: 80, D: 60 },
      pitch: { P: 47, I: 84, D: 64 },
      yaw: { P: 45, I: 80, D: 0 },
    });

    expect(result.pdRatio).toBe(2);
    expect(result.summary).toContain('D-heavy');
  });

  it('should detect P-heavy balance', () => {
    // Double P but keep D at default → PD ratio < 1
    const result = mapToSliders({
      roll: { P: 90, I: 80, D: 30 },
      pitch: { P: 94, I: 84, D: 32 },
      yaw: { P: 90, I: 80, D: 0 },
    });

    expect(result.pdRatio).toBe(0.5);
    expect(result.summary).toContain('P-heavy');
  });

  it('should report PIDs above BF defaults', () => {
    const result = mapToSliders({
      roll: { P: 68, I: 80, D: 45 },
      pitch: { P: 71, I: 84, D: 48 },
      yaw: { P: 68, I: 80, D: 0 },
    });

    expect(result.masterMultiplier).toBeGreaterThan(1.1);
    expect(result.summary).toContain('above BF defaults');
  });

  it('should report PIDs below BF defaults', () => {
    const result = mapToSliders({
      roll: { P: 30, I: 60, D: 20 },
      pitch: { P: 31, I: 63, D: 21 },
      yaw: { P: 30, I: 60, D: 0 },
    });

    expect(result.masterMultiplier).toBeLessThan(0.9);
    expect(result.summary).toContain('below BF defaults');
  });

  it('should handle yaw D=0 gracefully', () => {
    const result = mapToSliders(BF_REFERENCE_PIDS);

    expect(result.axes.yaw.dMultiplier).toBe(1);
  });
});

describe('computeSliderDelta', () => {
  it('should return zero delta for identical PIDs', () => {
    const delta = computeSliderDelta(BF_REFERENCE_PIDS, BF_REFERENCE_PIDS);

    expect(delta.masterMultiplierDelta).toBe(0);
    expect(delta.pdRatioDelta).toBe(0);
    expect(delta.summary).toContain('No significant slider change');
  });

  it('should detect master multiplier increase', () => {
    const delta = computeSliderDelta(BF_REFERENCE_PIDS, {
      roll: { P: 56, I: 100, D: 38 },
      pitch: { P: 59, I: 105, D: 40 },
      yaw: { P: 56, I: 100, D: 0 },
    });

    expect(delta.masterMultiplierDelta).toBeGreaterThan(0);
    expect(delta.summary).toContain('Master multiplier up');
  });

  it('should detect PD balance shift', () => {
    // Increase D more than P
    const delta = computeSliderDelta(BF_REFERENCE_PIDS, {
      roll: { P: 45, I: 80, D: 50 },
      pitch: { P: 47, I: 84, D: 53 },
      yaw: { P: 45, I: 80, D: 0 },
    });

    expect(delta.pdRatioDelta).toBeGreaterThan(0);
    expect(delta.summary).toContain('D-heavy');
  });

  it('should handle small changes as no significant slider change', () => {
    const delta = computeSliderDelta(BF_REFERENCE_PIDS, {
      roll: { P: 46, I: 81, D: 31 },
      pitch: { P: 48, I: 85, D: 33 },
      yaw: { P: 46, I: 81, D: 0 },
    });

    expect(delta.summary).toContain('No significant slider change');
  });
});

describe('buildRecommendedPIDs', () => {
  it('should return current PIDs when no recommendations', () => {
    const result = buildRecommendedPIDs(BF_REFERENCE_PIDS, []);

    expect(result.roll.P).toBe(45);
    expect(result.pitch.D).toBe(32);
    expect(result.yaw.I).toBe(80);
  });

  it('should apply single axis recommendation', () => {
    const result = buildRecommendedPIDs(BF_REFERENCE_PIDS, [
      { setting: 'pid_roll_p', recommendedValue: 55 },
    ]);

    expect(result.roll.P).toBe(55);
    expect(result.roll.I).toBe(80); // unchanged
    expect(result.roll.D).toBe(30); // unchanged
    expect(result.pitch.P).toBe(47); // other axis unchanged
  });

  it('should apply multiple recommendations across axes', () => {
    const result = buildRecommendedPIDs(BF_REFERENCE_PIDS, [
      { setting: 'pid_roll_p', recommendedValue: 55 },
      { setting: 'pid_roll_d', recommendedValue: 40 },
      { setting: 'pid_pitch_p', recommendedValue: 57 },
      { setting: 'pid_yaw_i', recommendedValue: 90 },
    ]);

    expect(result.roll.P).toBe(55);
    expect(result.roll.D).toBe(40);
    expect(result.pitch.P).toBe(57);
    expect(result.yaw.I).toBe(90);
  });

  it('should ignore non-PID settings', () => {
    const result = buildRecommendedPIDs(BF_REFERENCE_PIDS, [
      { setting: 'gyro_lpf1_static_hz', recommendedValue: 200 },
      { setting: 'dterm_lpf1_static_hz', recommendedValue: 100 },
    ]);

    expect(result).toEqual({
      roll: { P: 45, I: 80, D: 30 },
      pitch: { P: 47, I: 84, D: 32 },
      yaw: { P: 45, I: 80, D: 0 },
    });
  });

  it('should not mutate original PIDs', () => {
    const original = {
      roll: { P: 45, I: 80, D: 30 },
      pitch: { P: 47, I: 84, D: 32 },
      yaw: { P: 45, I: 80, D: 0 },
    };

    buildRecommendedPIDs(original, [{ setting: 'pid_roll_p', recommendedValue: 99 }]);

    expect(original.roll.P).toBe(45);
  });
});
