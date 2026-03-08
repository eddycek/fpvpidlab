import { describe, it, expect } from 'vitest';
import {
  pt1GroupDelay,
  biquadGroupDelay,
  notchGroupDelay,
  estimateGroupDelay,
  GROUP_DELAY_REFERENCE_HZ,
  GROUP_DELAY_WARNING_MS,
} from './GroupDelayEstimator';
import type { CurrentFilterSettings } from '@shared/types/analysis.types';
import { DEFAULT_FILTER_SETTINGS } from '@shared/types/analysis.types';

describe('GroupDelayEstimator', () => {
  describe('pt1GroupDelay', () => {
    it('should return 0 for disabled filter (cutoff=0)', () => {
      expect(pt1GroupDelay(0, 80)).toBe(0);
    });

    it('should return maximum delay at DC (0 Hz)', () => {
      // At DC, group delay = 1 / (2π * fc)
      const fc = 250;
      const delay = pt1GroupDelay(fc, 0);
      const expected = 1 / (2 * Math.PI * fc);
      expect(delay).toBeCloseTo(expected, 6);
    });

    it('should decrease delay as frequency increases', () => {
      const fc = 250;
      const delayLow = pt1GroupDelay(fc, 50);
      const delayHigh = pt1GroupDelay(fc, 200);
      expect(delayLow).toBeGreaterThan(delayHigh);
    });

    it('should return lower delay for higher cutoff at same frequency', () => {
      const freq = 80;
      const delayLowCutoff = pt1GroupDelay(150, freq);
      const delayHighCutoff = pt1GroupDelay(500, freq);
      expect(delayLowCutoff).toBeGreaterThan(delayHighCutoff);
    });

    it('should compute reasonable delay at typical drone frequencies', () => {
      // BF default gyro_lpf1 = 250 Hz, reference 80 Hz
      const delay = pt1GroupDelay(250, 80) * 1000; // ms
      // Should be well under 1ms for a 250 Hz PT1 at 80 Hz
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThan(1);
    });
  });

  describe('biquadGroupDelay', () => {
    it('should return 0 for disabled filter (cutoff=0)', () => {
      expect(biquadGroupDelay(0, 80)).toBe(0);
    });

    it('should have higher delay than PT1 at same cutoff and frequency', () => {
      const fc = 250;
      const freq = 80;
      const pt1Delay = pt1GroupDelay(fc, freq);
      const biquadDelay = biquadGroupDelay(fc, freq);
      // Biquad (2nd order) always has more delay than PT1 (1st order)
      expect(biquadDelay).toBeGreaterThan(pt1Delay);
    });

    it('should have significantly more delay near cutoff than far above it', () => {
      const fc = 250;
      // Biquad delay is highest around fc, much lower far above
      const delayNearFc = biquadGroupDelay(fc, fc * 0.8);
      const delayFarAbove = biquadGroupDelay(fc, fc * 3);
      expect(delayNearFc).toBeGreaterThan(delayFarAbove);
    });

    it('should compute reasonable delay at typical drone frequencies', () => {
      // BF default gyro_lpf2 = 500 Hz
      const delay = biquadGroupDelay(500, 80) * 1000; // ms
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThan(1);
    });
  });

  describe('notchGroupDelay', () => {
    it('should return 0 for disabled notch (center=0)', () => {
      expect(notchGroupDelay(0, 80)).toBe(0);
    });

    it('should have maximum delay near the notch frequency', () => {
      const notchHz = 150;
      const delayAtNotch = notchGroupDelay(notchHz, notchHz, 3);
      const delayFarAway = notchGroupDelay(notchHz, 50, 3);
      expect(delayAtNotch).toBeGreaterThan(delayFarAway);
    });

    it('should have minimal delay far from notch frequency', () => {
      const delay = notchGroupDelay(200, 80, 5) * 1000; // ms
      // At 80 Hz, a notch at 200 Hz should add very little delay
      expect(delay).toBeLessThan(0.5);
    });

    it('should increase with higher Q (narrower notch)', () => {
      const notchHz = 150;
      // Higher Q at the notch frequency means more phase distortion
      const delayLowQ = notchGroupDelay(notchHz, notchHz, 1);
      const delayHighQ = notchGroupDelay(notchHz, notchHz, 10);
      expect(delayHighQ).toBeGreaterThan(delayLowQ);
    });
  });

  describe('estimateGroupDelay', () => {
    it('should compute delay for default BF settings', () => {
      const result = estimateGroupDelay(DEFAULT_FILTER_SETTINGS);

      expect(result.filters.length).toBeGreaterThan(0);
      expect(result.gyroTotalMs).toBeGreaterThan(0);
      expect(result.dtermTotalMs).toBeGreaterThan(0);
      expect(result.referenceFreqHz).toBe(GROUP_DELAY_REFERENCE_HZ);
    });

    it('should identify gyro and dterm filter types', () => {
      const result = estimateGroupDelay(DEFAULT_FILTER_SETTINGS);

      const gyroFilters = result.filters.filter((f) => f.type.startsWith('gyro_'));
      const dtermFilters = result.filters.filter((f) => f.type.startsWith('dterm_'));

      expect(gyroFilters.length).toBeGreaterThanOrEqual(2); // LPF1 + LPF2
      expect(dtermFilters.length).toBeGreaterThanOrEqual(2); // LPF1 + LPF2
    });

    it('should return zero delay when all filters disabled', () => {
      const settings: CurrentFilterSettings = {
        gyro_lpf1_static_hz: 0,
        gyro_lpf2_static_hz: 0,
        dterm_lpf1_static_hz: 0,
        dterm_lpf2_static_hz: 0,
        dyn_notch_min_hz: 0,
        dyn_notch_max_hz: 0,
      };

      const result = estimateGroupDelay(settings);

      expect(result.gyroTotalMs).toBe(0);
      expect(result.dtermTotalMs).toBe(0);
      expect(result.filters.length).toBe(0);
    });

    it('should include dynamic notch in gyro delay', () => {
      const withNotch: CurrentFilterSettings = {
        ...DEFAULT_FILTER_SETTINGS,
        dyn_notch_min_hz: 100,
        dyn_notch_max_hz: 600,
        dyn_notch_count: 3,
        dyn_notch_q: 300,
      };

      const withoutNotch: CurrentFilterSettings = {
        ...DEFAULT_FILTER_SETTINGS,
        dyn_notch_min_hz: 0,
        dyn_notch_max_hz: 0,
      };

      const delayWith = estimateGroupDelay(withNotch);
      const delayWithout = estimateGroupDelay(withoutNotch);

      expect(delayWith.gyroTotalMs).toBeGreaterThan(delayWithout.gyroTotalMs);
    });

    it('should report higher delay with aggressive filter settings', () => {
      const aggressive: CurrentFilterSettings = {
        gyro_lpf1_static_hz: 100, // Very low cutoff = high delay
        gyro_lpf2_static_hz: 200,
        dterm_lpf1_static_hz: 80,
        dterm_lpf2_static_hz: 100,
        dyn_notch_min_hz: 100,
        dyn_notch_max_hz: 350,
      };

      const conservative: CurrentFilterSettings = {
        gyro_lpf1_static_hz: 400,
        gyro_lpf2_static_hz: 0, // Disabled
        dterm_lpf1_static_hz: 200,
        dterm_lpf2_static_hz: 0, // Disabled
        dyn_notch_min_hz: 0,
        dyn_notch_max_hz: 0,
      };

      const aggressiveDelay = estimateGroupDelay(aggressive);
      const conservativeDelay = estimateGroupDelay(conservative);

      expect(aggressiveDelay.gyroTotalMs).toBeGreaterThan(conservativeDelay.gyroTotalMs);
      expect(aggressiveDelay.dtermTotalMs).toBeGreaterThan(conservativeDelay.dtermTotalMs);
    });

    it('should warn when gyro delay exceeds threshold', () => {
      // Very aggressive filtering: extremely low cutoffs
      const settings: CurrentFilterSettings = {
        gyro_lpf1_static_hz: 50, // Very low
        gyro_lpf2_static_hz: 80,
        dterm_lpf1_static_hz: 50,
        dterm_lpf2_static_hz: 80,
        dyn_notch_min_hz: 80,
        dyn_notch_max_hz: 200,
        dyn_notch_count: 5,
      };

      const result = estimateGroupDelay(settings);

      // With such aggressive filtering, total delay should exceed warning threshold
      if (result.gyroTotalMs > GROUP_DELAY_WARNING_MS) {
        expect(result.warning).toBeDefined();
        expect(result.warning).toContain('delay');
      }
    });

    it('should not warn for moderate filter settings', () => {
      // Default BF settings should be well within safe range
      const result = estimateGroupDelay(DEFAULT_FILTER_SETTINGS);

      expect(result.warning).toBeUndefined();
    });

    it('should use custom reference frequency', () => {
      const result50 = estimateGroupDelay(DEFAULT_FILTER_SETTINGS, 50);
      const result200 = estimateGroupDelay(DEFAULT_FILTER_SETTINGS, 200);

      expect(result50.referenceFreqHz).toBe(50);
      expect(result200.referenceFreqHz).toBe(200);
      // Different reference frequencies should give different total delays
      expect(result50.gyroTotalMs).not.toBe(result200.gyroTotalMs);
    });

    it('should produce individual filter delays that sum to total', () => {
      const result = estimateGroupDelay(DEFAULT_FILTER_SETTINGS);

      const gyroSum = result.filters
        .filter((f) => f.type.startsWith('gyro_') || f.type === 'dyn_notch')
        .reduce((sum, f) => sum + f.delayMs, 0);

      const dtermSum = result.filters
        .filter((f) => f.type.startsWith('dterm_'))
        .reduce((sum, f) => sum + f.delayMs, 0);

      // Should be approximately equal (rounding)
      expect(Math.abs(gyroSum - result.gyroTotalMs)).toBeLessThan(0.1);
      expect(Math.abs(dtermSum - result.dtermTotalMs)).toBeLessThan(0.1);
    });
  });
});
