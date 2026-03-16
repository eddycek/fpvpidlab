import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelemetryManager } from './TelemetryManager';

// Mock fs/promises
const mockFs = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));
vi.mock('fs/promises', () => ({ default: mockFs }));

// Mock crypto
const mockCrypto = vi.hoisted(() => ({
  randomUUID: () => 'test-uuid-1234',
  createHash: () => ({
    update: () => ({
      digest: () => 'abcdef1234567890abcdef1234567890',
    }),
  }),
}));
vi.mock('crypto', () => ({ ...mockCrypto, default: mockCrypto }));

// Mock zlib
const mockZlib = vi.hoisted(() => ({
  gzipSync: (buf: Buffer) => buf,
}));
vi.mock('zlib', () => ({ ...mockZlib, default: mockZlib }));

// Mock electron
vi.mock('electron', () => ({
  app: { isPackaged: false },
  net: {
    fetch: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

describe('TelemetryManager', () => {
  let manager: TelemetryManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TelemetryManager('/tmp/test');
  });

  describe('initialize', () => {
    it('creates default settings when file does not exist', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await manager.initialize();

      const settings = manager.getSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.installationId).toBe('test-uuid-1234');
      expect(settings.lastUploadAt).toBeNull();
    });

    it('loads existing settings from file', async () => {
      const existing = {
        enabled: true,
        installationId: 'existing-id',
        lastUploadAt: '2026-01-01T00:00:00.000Z',
      };
      mockFs.readFile.mockResolvedValue(JSON.stringify(existing));

      await manager.initialize();

      const settings = manager.getSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.installationId).toBe('existing-id');
    });
  });

  describe('getSettings', () => {
    it('throws if not initialized', () => {
      expect(() => manager.getSettings()).toThrow('TelemetryManager not initialized');
    });

    it('returns a copy of settings', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await manager.initialize();

      const s1 = manager.getSettings();
      const s2 = manager.getSettings();
      expect(s1).toEqual(s2);
      expect(s1).not.toBe(s2);
    });
  });

  describe('setEnabled', () => {
    it('persists enabled state', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await manager.initialize();
      const result = await manager.setEnabled(true);

      expect(result.enabled).toBe(true);
      expect(mockFs.writeFile).toHaveBeenCalled();
    });
  });

  describe('sendNow', () => {
    it('throws if telemetry is disabled', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await manager.initialize();
      await manager.setEnabled(false);

      await expect(manager.sendNow()).rejects.toThrow('Telemetry is disabled');
    });
  });

  describe('assembleBundle', () => {
    it('returns bundle with defaults when no managers set', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await manager.initialize();
      const bundle = await manager.assembleBundle();

      expect(bundle.schemaVersion).toBe(2);
      expect(bundle.installationId).toBe('test-uuid-1234');
      expect(bundle.profiles.count).toBe(0);
      expect(bundle.tuningSessions.totalCompleted).toBe(0);
      expect(bundle.sessions).toEqual([]);
    });

    it('collects profile data from profileManager', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await manager.initialize();

      const mockProfileManager = {
        listProfiles: vi.fn().mockResolvedValue([
          { id: 'p1', size: '5"', flightStyle: 'balanced' },
          { id: 'p2', size: '3"', flightStyle: 'smooth' },
        ]),
        getProfile: vi.fn().mockImplementation((id: string) => {
          if (id === 'p1') {
            return { fcSerialNumber: 'SN1', fcInfo: { version: '4.5.1', target: 'STM32F405' } };
          }
          return { fcSerialNumber: 'SN2', fcInfo: { version: '4.5.1', target: 'STM32F411' } };
        }),
      };
      manager.setProfileManager(mockProfileManager);

      const bundle = await manager.assembleBundle();

      expect(bundle.profiles.count).toBe(2);
      expect(bundle.profiles.sizes).toContain('5"');
      expect(bundle.profiles.sizes).toContain('3"');
      expect(bundle.fcInfo.bfVersions).toEqual(['4.5.1']);
      expect(bundle.fcInfo.boardTargets).toContain('STM32F405');
      // Mock createHash returns same hash for all inputs, so deduped to 1
      expect(bundle.fcInfo.fcSerialHashes.length).toBe(1);
    });

    it('collects tuning history data', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await manager.initialize();

      const mockProfileManager = {
        listProfiles: vi.fn().mockResolvedValue([{ id: 'p1' }]),
        getProfile: vi.fn().mockResolvedValue({ fcSerialNumber: 'SN1', fcInfo: {} }),
      };
      const mockHistoryManager = {
        getHistory: vi.fn().mockResolvedValue([
          { tuningType: 'filter', qualityScore: 85 },
          { tuningType: 'quick', qualityScore: 72 },
        ]),
      };
      manager.setProfileManager(mockProfileManager);
      manager.setTuningHistoryManager(mockHistoryManager);

      const bundle = await manager.assembleBundle();

      expect(bundle.tuningSessions.totalCompleted).toBe(2);
      expect(bundle.tuningSessions.byMode.filter).toBe(1);
      expect(bundle.tuningSessions.byMode.quick).toBe(1);
      expect(bundle.tuningSessions.recentQualityScores).toEqual([85, 72]);
    });

    it('populates sessions from tuning history with metrics', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await manager.initialize();

      const mockProfileManager = {
        listProfiles: vi
          .fn()
          .mockResolvedValue([{ id: 'p1', size: '5"', flightStyle: 'balanced' }]),
        getProfile: vi.fn().mockResolvedValue({
          fcSerialNumber: 'SN1',
          size: '5"',
          flightStyle: 'balanced',
          fcInfo: { version: '4.5.1' },
        }),
      };
      const mockHistoryManager = {
        getHistory: vi.fn().mockResolvedValue([
          {
            tuningType: 'filter',
            startedAt: '2026-03-16T10:00:00.000Z',
            completedAt: '2026-03-16T10:30:00.000Z',
            appliedFilterChanges: [
              { setting: 'gyro_lpf1_static_hz', previousValue: 300, newValue: 250 },
            ],
            appliedPIDChanges: [],
            appliedFeedforwardChanges: [],
            filterMetrics: {
              noiseLevel: 'medium',
              roll: { noiseFloorDb: -25, peakCount: 2 },
              pitch: { noiseFloorDb: -22, peakCount: 1 },
              yaw: { noiseFloorDb: -30, peakCount: 0 },
              segmentsUsed: 3,
              summary: 'test',
              dataQuality: { overall: 75, tier: 'good' },
            },
            pidMetrics: null,
            transferFunctionMetrics: null,
            verificationMetrics: null,
            verificationPidMetrics: null,
          },
          {
            tuningType: 'quick',
            startedAt: '2026-03-16T11:00:00.000Z',
            completedAt: '2026-03-16T11:15:00.000Z',
            appliedFilterChanges: [],
            appliedPIDChanges: [{ setting: 'pid_roll_p', previousValue: 45, newValue: 50 }],
            appliedFeedforwardChanges: [],
            filterMetrics: null,
            pidMetrics: {
              roll: {
                meanOvershoot: 12,
                meanRiseTimeMs: 30,
                meanSettlingTimeMs: 80,
                meanLatencyMs: 5,
              },
              pitch: {
                meanOvershoot: 10,
                meanRiseTimeMs: 28,
                meanSettlingTimeMs: 75,
                meanLatencyMs: 4,
              },
              yaw: {
                meanOvershoot: 8,
                meanRiseTimeMs: 35,
                meanSettlingTimeMs: 90,
                meanLatencyMs: 6,
              },
              stepsDetected: 15,
              currentPIDs: {
                roll: { p: 45, i: 80, d: 30 },
                pitch: { p: 47, i: 82, d: 32 },
                yaw: { p: 35, i: 90, d: 0 },
              },
              summary: 'test',
            },
            transferFunctionMetrics: {
              roll: {
                bandwidthHz: 45,
                phaseMarginDeg: 55,
                gainMarginDb: 6,
                overshootPercent: 12,
                settlingTimeMs: 80,
                riseTimeMs: 30,
              },
              pitch: {
                bandwidthHz: 42,
                phaseMarginDeg: 50,
                gainMarginDb: 5,
                overshootPercent: 10,
                settlingTimeMs: 75,
                riseTimeMs: 28,
              },
              yaw: {
                bandwidthHz: 30,
                phaseMarginDeg: 60,
                gainMarginDb: 8,
                overshootPercent: 8,
                settlingTimeMs: 90,
                riseTimeMs: 35,
              },
            },
            verificationMetrics: null,
            verificationPidMetrics: null,
          },
        ]),
      };
      manager.setProfileManager(mockProfileManager);
      manager.setTuningHistoryManager(mockHistoryManager);

      const bundle = await manager.assembleBundle();

      expect(bundle.sessions).toHaveLength(2);

      // First session — filter tune
      const s0 = bundle.sessions[0];
      expect(s0.mode).toBe('filter');
      expect(s0.durationSec).toBe(1800); // 30 min
      expect(s0.droneSize).toBe('5"');
      expect(s0.flightStyle).toBe('balanced');
      expect(s0.bfVersion).toBe('4.5.1');
      expect(s0.dataQualityScore).toBe(75);
      expect(s0.dataQualityTier).toBe('good');
      expect(s0.rules).toHaveLength(1);
      expect(s0.rules[0].ruleId).toBe('gyro_lpf1_static_hz');
      expect(s0.rules[0].delta).toBe(-50);
      expect(s0.rules[0].applied).toBe(true);
      expect(s0.metrics.noiseFloorDb).toEqual({ roll: -25, pitch: -22, yaw: -30 });

      // Second session — quick tune with PID + TF metrics
      const s1 = bundle.sessions[1];
      expect(s1.mode).toBe('quick');
      expect(s1.durationSec).toBe(900); // 15 min
      expect(s1.metrics.meanOvershootPct).toEqual({ roll: 12, pitch: 10, yaw: 8 });
      expect(s1.metrics.bandwidthHz).toEqual({ roll: 45, pitch: 42, yaw: 30 });
      expect(s1.metrics.phaseMarginDeg).toEqual({ roll: 55, pitch: 50, yaw: 60 });
    });

    it('produces empty sessions array when no tuning history', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await manager.initialize();

      const mockProfileManager = {
        listProfiles: vi.fn().mockResolvedValue([{ id: 'p1', size: '5"' }]),
        getProfile: vi.fn().mockResolvedValue({ fcSerialNumber: 'SN1', fcInfo: {} }),
      };
      const mockHistoryManager = {
        getHistory: vi.fn().mockResolvedValue([]),
      };
      manager.setProfileManager(mockProfileManager);
      manager.setTuningHistoryManager(mockHistoryManager);

      const bundle = await manager.assembleBundle();
      expect(bundle.sessions).toEqual([]);
    });

    it('handles records without optional fields defensively', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await manager.initialize();

      const mockProfileManager = {
        listProfiles: vi.fn().mockResolvedValue([{ id: 'p1' }]),
        getProfile: vi.fn().mockResolvedValue({ fcSerialNumber: 'SN1', fcInfo: {} }),
      };
      const mockHistoryManager = {
        getHistory: vi.fn().mockResolvedValue([
          {
            // Minimal record — no tuningType, no metrics, no applied changes
            startedAt: '2026-03-16T10:00:00.000Z',
            completedAt: '2026-03-16T10:05:00.000Z',
            appliedFilterChanges: [],
            appliedPIDChanges: [],
            appliedFeedforwardChanges: [],
            filterMetrics: null,
            pidMetrics: null,
            transferFunctionMetrics: null,
            verificationMetrics: null,
            verificationPidMetrics: null,
          },
        ]),
      };
      manager.setProfileManager(mockProfileManager);
      manager.setTuningHistoryManager(mockHistoryManager);

      const bundle = await manager.assembleBundle();

      expect(bundle.sessions).toHaveLength(1);
      const s = bundle.sessions[0];
      expect(s.mode).toBe('filter'); // default for old records
      expect(s.durationSec).toBe(300);
      expect(s.rules).toEqual([]);
      expect(s.metrics).toEqual({});
      expect(s.verification).toBeUndefined();
      expect(s.qualityScore).toBeUndefined();
    });

    it('extracts verification deltas from filter verification', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await manager.initialize();

      const mockProfileManager = {
        listProfiles: vi.fn().mockResolvedValue([{ id: 'p1' }]),
        getProfile: vi.fn().mockResolvedValue({ fcSerialNumber: 'SN1', fcInfo: {} }),
      };
      const mockHistoryManager = {
        getHistory: vi.fn().mockResolvedValue([
          {
            tuningType: 'filter',
            startedAt: '2026-03-16T10:00:00.000Z',
            completedAt: '2026-03-16T10:30:00.000Z',
            appliedFilterChanges: [],
            appliedPIDChanges: [],
            appliedFeedforwardChanges: [],
            filterMetrics: {
              roll: { noiseFloorDb: -20, peakCount: 2 },
              pitch: { noiseFloorDb: -18, peakCount: 1 },
              yaw: { noiseFloorDb: -25, peakCount: 0 },
              noiseLevel: 'medium',
              segmentsUsed: 3,
              summary: 'test',
            },
            verificationMetrics: {
              roll: { noiseFloorDb: -26, peakCount: 1 },
              pitch: { noiseFloorDb: -24, peakCount: 0 },
              yaw: { noiseFloorDb: -30, peakCount: 0 },
              noiseLevel: 'low',
              segmentsUsed: 3,
              summary: 'improved',
            },
            pidMetrics: null,
            transferFunctionMetrics: null,
            verificationPidMetrics: null,
          },
        ]),
      };
      manager.setProfileManager(mockProfileManager);
      manager.setTuningHistoryManager(mockHistoryManager);

      const bundle = await manager.assembleBundle();
      const s = bundle.sessions[0];

      expect(s.verification).toBeDefined();
      expect(s.verification!.noiseFloorDeltaDb).toEqual({
        roll: -6,
        pitch: -6,
        yaw: -5,
      });
      // Negative noise delta = improvement, so overallImprovement should be positive
      expect(s.verification!.overallImprovement).toBeCloseTo(17 / 3);
    });

    it('detects snapshot restore usage', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await manager.initialize();

      const mockProfileManager = {
        listProfiles: vi.fn().mockResolvedValue([{ id: 'p1' }]),
        getProfile: vi.fn().mockResolvedValue({ fcSerialNumber: 'SN1', fcInfo: {} }),
      };
      const mockSnapshotManager = {
        listSnapshots: vi
          .fn()
          .mockResolvedValue([{ label: 'Baseline' }, { label: 'Pre-restore (auto)' }]),
      };
      manager.setProfileManager(mockProfileManager);
      manager.setSnapshotManager(mockSnapshotManager);

      const bundle = await manager.assembleBundle();

      expect(bundle.features.snapshotRestoreUsed).toBe(true);
      expect(bundle.features.snapshotCompareUsed).toBe(true);
    });
  });

  describe('uploadIfDue', () => {
    it('skips upload when disabled', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      manager.setDemoMode(true); // Prevent heartbeat upload on init
      await manager.initialize();
      await manager.setEnabled(false);
      await manager.uploadIfDue();
      // No error thrown — silent skip
    });
  });

  describe('onTuningSessionCompleted', () => {
    it('does nothing when disabled', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      manager.setDemoMode(true); // Prevent heartbeat upload on init
      await manager.initialize();
      await manager.setEnabled(false);
      await manager.onTuningSessionCompleted();
      // No error — just a no-op
    });
  });

  describe('demo mode', () => {
    it('skips upload in demo mode', async () => {
      const { net } = await import('electron');
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      manager.setDemoMode(true);
      await manager.initialize();
      await manager.sendNow();

      expect(net.fetch).not.toHaveBeenCalled();
    });
  });
});
