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

      expect(bundle.schemaVersion).toBe(1);
      expect(bundle.installationId).toBe('test-uuid-1234');
      expect(bundle.profiles.count).toBe(0);
      expect(bundle.tuningSessions.totalCompleted).toBe(0);
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
