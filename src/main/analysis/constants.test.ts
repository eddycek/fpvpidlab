import { describe, it, expect } from 'vitest';
import {
  PID_STYLE_THRESHOLDS,
  OVERSHOOT_IDEAL_PERCENT,
  OVERSHOOT_MAX_PERCENT,
  SETTLING_MAX_MS,
  RINGING_MAX_COUNT,
  ITERM_RELAX_CUTOFF_BY_STYLE,
  ITERM_RELAX_DEVIATION_THRESHOLD,
} from './constants';
import type { FlightStyle } from '@shared/types/profile.types';

describe('PID_STYLE_THRESHOLDS', () => {
  const styles: FlightStyle[] = ['smooth', 'balanced', 'aggressive'];

  it('has thresholds for all three flight styles', () => {
    for (const style of styles) {
      expect(PID_STYLE_THRESHOLDS[style]).toBeDefined();
    }
  });

  it('has all required threshold fields for each style', () => {
    const requiredKeys = [
      'overshootIdeal',
      'overshootMax',
      'settlingMax',
      'ringingMax',
      'moderateOvershoot',
      'sluggishRise',
    ];
    for (const style of styles) {
      for (const key of requiredKeys) {
        expect(PID_STYLE_THRESHOLDS[style]).toHaveProperty(key);
        expect(typeof (PID_STYLE_THRESHOLDS[style] as unknown as Record<string, number>)[key]).toBe(
          'number'
        );
      }
    }
  });

  it('balanced thresholds match existing individual constants', () => {
    const balanced = PID_STYLE_THRESHOLDS.balanced;
    expect(balanced.overshootIdeal).toBe(OVERSHOOT_IDEAL_PERCENT);
    expect(balanced.overshootMax).toBe(OVERSHOOT_MAX_PERCENT);
    expect(balanced.settlingMax).toBe(SETTLING_MAX_MS);
    expect(balanced.ringingMax).toBe(RINGING_MAX_COUNT);
  });

  it('smooth has stricter overshoot thresholds than balanced', () => {
    expect(PID_STYLE_THRESHOLDS.smooth.overshootIdeal).toBeLessThan(
      PID_STYLE_THRESHOLDS.balanced.overshootIdeal
    );
    expect(PID_STYLE_THRESHOLDS.smooth.overshootMax).toBeLessThan(
      PID_STYLE_THRESHOLDS.balanced.overshootMax
    );
  });

  it('aggressive has more permissive overshoot thresholds than balanced', () => {
    expect(PID_STYLE_THRESHOLDS.aggressive.overshootIdeal).toBeGreaterThan(
      PID_STYLE_THRESHOLDS.balanced.overshootIdeal
    );
    expect(PID_STYLE_THRESHOLDS.aggressive.overshootMax).toBeGreaterThan(
      PID_STYLE_THRESHOLDS.balanced.overshootMax
    );
  });

  it('smooth allows more settling time, aggressive demands less', () => {
    expect(PID_STYLE_THRESHOLDS.smooth.settlingMax).toBeGreaterThan(
      PID_STYLE_THRESHOLDS.balanced.settlingMax
    );
    expect(PID_STYLE_THRESHOLDS.aggressive.settlingMax).toBeLessThan(
      PID_STYLE_THRESHOLDS.balanced.settlingMax
    );
  });

  it('sluggish rise threshold scales inversely with aggression', () => {
    expect(PID_STYLE_THRESHOLDS.smooth.sluggishRise).toBeGreaterThan(
      PID_STYLE_THRESHOLDS.balanced.sluggishRise
    );
    expect(PID_STYLE_THRESHOLDS.aggressive.sluggishRise).toBeLessThan(
      PID_STYLE_THRESHOLDS.balanced.sluggishRise
    );
  });
});

describe('ITERM_RELAX_CUTOFF_BY_STYLE', () => {
  const styles: FlightStyle[] = ['smooth', 'balanced', 'aggressive'];

  it('has ranges for all three flight styles', () => {
    for (const style of styles) {
      const range = ITERM_RELAX_CUTOFF_BY_STYLE[style];
      expect(range).toBeDefined();
      expect(range.min).toBeLessThan(range.max);
      expect(range.typical).toBeGreaterThanOrEqual(range.min);
      expect(range.typical).toBeLessThanOrEqual(range.max);
    }
  });

  it('aggressive has higher cutoff than balanced, balanced higher than smooth', () => {
    expect(ITERM_RELAX_CUTOFF_BY_STYLE.aggressive.typical).toBeGreaterThan(
      ITERM_RELAX_CUTOFF_BY_STYLE.balanced.typical
    );
    expect(ITERM_RELAX_CUTOFF_BY_STYLE.balanced.typical).toBeGreaterThan(
      ITERM_RELAX_CUTOFF_BY_STYLE.smooth.typical
    );
  });

  it('ranges do not overlap between styles', () => {
    expect(ITERM_RELAX_CUTOFF_BY_STYLE.smooth.max).toBeLessThanOrEqual(
      ITERM_RELAX_CUTOFF_BY_STYLE.balanced.min
    );
    expect(ITERM_RELAX_CUTOFF_BY_STYLE.balanced.max).toBeLessThanOrEqual(
      ITERM_RELAX_CUTOFF_BY_STYLE.aggressive.min
    );
  });

  it('deviation threshold is between 0 and 1', () => {
    expect(ITERM_RELAX_DEVIATION_THRESHOLD).toBeGreaterThan(0);
    expect(ITERM_RELAX_DEVIATION_THRESHOLD).toBeLessThanOrEqual(1);
  });
});
