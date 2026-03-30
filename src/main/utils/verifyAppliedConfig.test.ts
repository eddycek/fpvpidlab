import { describe, it, expect, vi } from 'vitest';
import { verifyAppliedConfig } from './verifyAppliedConfig';
import type { PIDConfiguration } from '@shared/types/pid.types';
import type { CurrentFilterSettings } from '@shared/types/analysis.types';
import type { AppliedChange } from '@shared/types/tuning.types';

function makePIDConfig(overrides?: Partial<Record<string, number>>): PIDConfiguration {
  const base: PIDConfiguration = {
    roll: { P: 45, I: 85, D: 30 },
    pitch: { P: 47, I: 89, D: 33 },
    yaw: { P: 35, I: 90, D: 0 },
  };
  if (overrides) {
    for (const [key, val] of Object.entries(overrides)) {
      const match = key.match(/^pid_(roll|pitch|yaw)_(p|i|d)$/i);
      if (match && val !== undefined) {
        const axis = match[1] as 'roll' | 'pitch' | 'yaw';
        const term = match[2].toUpperCase() as 'P' | 'I' | 'D';
        base[axis][term] = val;
      }
    }
  }
  return base;
}

function makeFilterConfig(overrides?: Partial<CurrentFilterSettings>): CurrentFilterSettings {
  return {
    gyro_lpf1_static_hz: 250,
    gyro_lpf2_static_hz: 500,
    dterm_lpf1_static_hz: 150,
    dterm_lpf2_static_hz: 250,
    dyn_notch_min_hz: 100,
    dyn_notch_max_hz: 600,
    dyn_notch_q: 300,
    dyn_notch_count: 3,
    ...overrides,
  };
}

function createMockMSPClient(pidConfig: PIDConfiguration, filterConfig: CurrentFilterSettings) {
  return {
    getPIDConfiguration: vi.fn().mockResolvedValue(pidConfig),
    getFilterConfiguration: vi.fn().mockResolvedValue(filterConfig),
    setPIDConfiguration: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
  };
}

describe('verifyAppliedConfig', () => {
  describe('PID mode', () => {
    it('returns verified=true when all PID values match', async () => {
      const pidConfig = makePIDConfig({ pid_roll_p: 50 });
      const msp = createMockMSPClient(pidConfig, makeFilterConfig());
      const applied: AppliedChange[] = [{ setting: 'pid_roll_p', previousValue: 45, newValue: 50 }];

      const result = await verifyAppliedConfig(msp, 'pid', applied);

      expect(result.verified).toBe(true);
      expect(result.mismatches).toHaveLength(0);
      expect(result.suspicious).toBe(false);
    });

    it('detects PID mismatch and retries', async () => {
      const badConfig = makePIDConfig({ pid_roll_p: 40 }); // Wrong value
      const goodConfig = makePIDConfig({ pid_roll_p: 50 }); // Correct after retry
      const msp = createMockMSPClient(badConfig, makeFilterConfig());
      // After setPIDConfiguration (retry), return correct config
      msp.getPIDConfiguration.mockResolvedValueOnce(badConfig).mockResolvedValueOnce(goodConfig);
      const applied: AppliedChange[] = [{ setting: 'pid_roll_p', previousValue: 45, newValue: 50 }];

      const result = await verifyAppliedConfig(msp, 'pid', applied);

      expect(result.verified).toBe(true);
      expect(result.retried).toBe(true);
      expect(msp.setPIDConfiguration).toHaveBeenCalled();
    });

    it('reports mismatch after failed retry', async () => {
      const badConfig = makePIDConfig({ pid_roll_p: 40 });
      const msp = createMockMSPClient(badConfig, makeFilterConfig());
      // Both reads return wrong value
      msp.getPIDConfiguration.mockResolvedValue(badConfig);
      const applied: AppliedChange[] = [{ setting: 'pid_roll_p', previousValue: 45, newValue: 50 }];

      const result = await verifyAppliedConfig(msp, 'pid', applied);

      expect(result.verified).toBe(false);
      expect(result.mismatches.some((m) => m.includes('pid_roll_p'))).toBe(true);
      expect(result.retried).toBe(true);
    });

    it('flags suspicious when I=0 on roll', async () => {
      const config = makePIDConfig({ pid_roll_i: 0 });
      const msp = createMockMSPClient(config, makeFilterConfig());

      const result = await verifyAppliedConfig(msp, 'pid');

      expect(result.suspicious).toBe(true);
      expect(result.mismatches.some((m) => m.includes('pid_roll_i = 0'))).toBe(true);
    });

    it('flags suspicious when P=0 on pitch', async () => {
      const config = makePIDConfig({ pid_pitch_p: 0 });
      const msp = createMockMSPClient(config, makeFilterConfig());

      const result = await verifyAppliedConfig(msp, 'pid');

      expect(result.suspicious).toBe(true);
    });

    it('does not check filter settings in PID mode', async () => {
      const msp = createMockMSPClient(makePIDConfig(), makeFilterConfig());

      await verifyAppliedConfig(msp, 'pid');

      expect(msp.getFilterConfiguration).not.toHaveBeenCalled();
    });

    it('marks unverifiable settings as unchecked and verified=false', async () => {
      const msp = createMockMSPClient(makePIDConfig(), makeFilterConfig());
      const applied: AppliedChange[] = [
        { setting: 'unknown_pid_setting', previousValue: 10, newValue: 20 },
      ];

      const result = await verifyAppliedConfig(msp, 'pid', applied);

      expect(result.verified).toBe(false);
      expect(result.unchecked).toContain('unknown_pid_setting');
      expect(result.mismatches).toHaveLength(0);
    });
  });

  describe('Filter mode', () => {
    it('skips CLI-only filter settings during verification (rpm_filter_q)', async () => {
      const msp = createMockMSPClient(makePIDConfig(), makeFilterConfig());
      const applied: AppliedChange[] = [
        { setting: 'rpm_filter_q', previousValue: 500, newValue: 600 },
      ];

      const result = await verifyAppliedConfig(msp, 'filter', undefined, applied);

      // CLI-only settings are silently skipped — they don't fail verification
      expect(result.verified).toBe(true);
      expect(result.unchecked).not.toContain('rpm_filter_q');
    });

    it('returns verified=true when all filter values match', async () => {
      const filterConfig = makeFilterConfig({ gyro_lpf1_static_hz: 200 });
      const msp = createMockMSPClient(makePIDConfig(), filterConfig);
      const applied: AppliedChange[] = [
        { setting: 'gyro_lpf1_static_hz', previousValue: 250, newValue: 200 },
      ];

      const result = await verifyAppliedConfig(msp, 'filter', undefined, applied);

      expect(result.verified).toBe(true);
    });

    it('detects filter mismatch', async () => {
      const filterConfig = makeFilterConfig({ gyro_lpf1_static_hz: 300 }); // Wrong
      const msp = createMockMSPClient(makePIDConfig(), filterConfig);
      const applied: AppliedChange[] = [
        { setting: 'gyro_lpf1_static_hz', previousValue: 250, newValue: 200 },
      ];

      const result = await verifyAppliedConfig(msp, 'filter', undefined, applied);

      expect(result.verified).toBe(false);
      expect(result.mismatches.some((m) => m.includes('gyro_lpf1_static_hz'))).toBe(true);
    });

    it('flags suspicious when gyro_lpf1_static_hz=0', async () => {
      const filterConfig = makeFilterConfig({ gyro_lpf1_static_hz: 0 });
      const msp = createMockMSPClient(makePIDConfig(), filterConfig);

      const result = await verifyAppliedConfig(msp, 'filter');

      expect(result.suspicious).toBe(true);
      expect(result.mismatches.some((m) => m.includes('gyro_lpf1_static_hz = 0'))).toBe(true);
    });

    it('does not check PID settings in filter mode', async () => {
      const msp = createMockMSPClient(makePIDConfig(), makeFilterConfig());

      await verifyAppliedConfig(msp, 'filter');

      expect(msp.getPIDConfiguration).not.toHaveBeenCalled();
    });

    it('does not retry filter mismatches (no MSP re-write for CLI settings)', async () => {
      const filterConfig = makeFilterConfig({ gyro_lpf1_static_hz: 300 });
      const msp = createMockMSPClient(makePIDConfig(), filterConfig);
      const applied: AppliedChange[] = [
        { setting: 'gyro_lpf1_static_hz', previousValue: 250, newValue: 200 },
      ];

      const result = await verifyAppliedConfig(msp, 'filter', undefined, applied);

      expect(result.retried).toBe(false);
      expect(msp.setPIDConfiguration).not.toHaveBeenCalled();
    });
  });

  describe('Flash mode (combined)', () => {
    it('checks both PID and filter settings', async () => {
      const msp = createMockMSPClient(makePIDConfig(), makeFilterConfig());

      await verifyAppliedConfig(msp, 'flash');

      expect(msp.getPIDConfiguration).toHaveBeenCalled();
      expect(msp.getFilterConfiguration).toHaveBeenCalled();
    });

    it('flags suspicious I=0 in flash mode', async () => {
      const config = makePIDConfig({ pid_pitch_i: 0 });
      const msp = createMockMSPClient(config, makeFilterConfig());

      const result = await verifyAppliedConfig(msp, 'flash');

      expect(result.suspicious).toBe(true);
    });

    it('flags suspicious gyro_lpf1=0 in flash mode', async () => {
      const filterConfig = makeFilterConfig({ gyro_lpf1_static_hz: 0 });
      const msp = createMockMSPClient(makePIDConfig(), filterConfig);

      const result = await verifyAppliedConfig(msp, 'flash');

      expect(result.suspicious).toBe(true);
    });

    it('records expected and actual values', async () => {
      const pidConfig = makePIDConfig({ pid_roll_p: 50 });
      const filterConfig = makeFilterConfig({ gyro_lpf1_static_hz: 200 });
      const msp = createMockMSPClient(pidConfig, filterConfig);

      const result = await verifyAppliedConfig(msp, 'flash');

      expect(result.expected.pid_roll_p).toBe(50);
      expect(result.actual.pid_roll_p).toBe(50);
      expect(result.expected.gyro_lpf1_static_hz).toBe(200);
      expect(result.actual.gyro_lpf1_static_hz).toBe(200);
    });
  });
});
