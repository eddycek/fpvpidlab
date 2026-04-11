import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SnapshotManager } from './SnapshotManager';

// Mock dependencies
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid'),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockFileStorage = vi.hoisted(() => ({
  ensureDirectory: vi.fn(),
  saveSnapshot: vi.fn(),
  loadSnapshot: vi.fn(),
  deleteSnapshot: vi.fn(),
  listSnapshots: vi.fn().mockResolvedValue([]),
  exportSnapshot: vi.fn(),
}));

vi.mock('./FileStorage', () => {
  return {
    FileStorage: class MockFileStorage {
      ensureDirectory = mockFileStorage.ensureDirectory;
      saveSnapshot = mockFileStorage.saveSnapshot;
      loadSnapshot = mockFileStorage.loadSnapshot;
      deleteSnapshot = mockFileStorage.deleteSnapshot;
      listSnapshots = mockFileStorage.listSnapshots;
      exportSnapshot = mockFileStorage.exportSnapshot;
    },
  };
});

describe('SnapshotManager', () => {
  let manager: SnapshotManager;
  let mockMspClient: any;
  let mockProfileManager: any;
  let mockStorage: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockMspClient = {
      isConnected: vi.fn().mockReturnValue(true),
      getFCInfo: vi.fn().mockResolvedValue({
        variant: 'BTFL',
        version: '4.5.0',
        target: 'STM32F405',
        boardName: 'TEST',
        apiVersion: { protocol: 0, major: 1, minor: 46 },
      }),
      exportCLIDiff: vi.fn().mockResolvedValue('# diff all'),
      exportCLIDiffAndDump: vi.fn().mockResolvedValue({
        cliDiff: '# diff all',
        cliDump: 'defaults nosave\nset gyro_lpf1_static_hz = 250\nsave',
      }),
    };

    mockProfileManager = {
      getCurrentProfileId: vi.fn().mockReturnValue('profile-1'),
      getCurrentProfile: vi.fn().mockResolvedValue({
        id: 'profile-1',
        snapshotIds: ['snap-1', 'snap-baseline'],
        baselineSnapshotId: 'snap-baseline',
      }),
      linkSnapshot: vi.fn(),
      unlinkSnapshot: vi.fn(),
    };

    manager = new SnapshotManager('/tmp/test-snapshots', mockMspClient);
    manager.setProfileManager(mockProfileManager);

    mockStorage = mockFileStorage;
  });

  describe('deleteSnapshot with force', () => {
    it('rejects baseline deletion without force', async () => {
      (manager as any).baselineId = 'snap-baseline';

      await expect(manager.deleteSnapshot('snap-baseline')).rejects.toThrow(
        'Cannot delete baseline snapshot'
      );
    });

    it('allows baseline deletion with force=true', async () => {
      (manager as any).baselineId = 'snap-baseline';
      mockStorage.deleteSnapshot.mockResolvedValue(undefined);

      await manager.deleteSnapshot('snap-baseline', true);

      expect(mockStorage.deleteSnapshot).toHaveBeenCalledWith('snap-baseline');
      expect((manager as any).baselineId).toBeNull();
    });

    it('clears baselineId when force-deleting the baseline', async () => {
      (manager as any).baselineId = 'snap-baseline';
      mockStorage.deleteSnapshot.mockResolvedValue(undefined);

      await manager.deleteSnapshot('snap-baseline', true);

      expect((manager as any).baselineId).toBeNull();
    });

    it('does not clear baselineId when force-deleting a non-baseline snapshot', async () => {
      (manager as any).baselineId = 'snap-baseline';
      mockStorage.deleteSnapshot.mockResolvedValue(undefined);

      await manager.deleteSnapshot('snap-1', true);

      expect((manager as any).baselineId).toBe('snap-baseline');
    });

    it('rejects profile baseline deletion without force', async () => {
      (manager as any).baselineId = null;

      await expect(manager.deleteSnapshot('snap-baseline')).rejects.toThrow(
        'Cannot delete baseline snapshot'
      );
    });

    it('allows profile baseline deletion with force=true', async () => {
      (manager as any).baselineId = null;
      mockStorage.deleteSnapshot.mockResolvedValue(undefined);

      await manager.deleteSnapshot('snap-baseline', true);

      expect(mockStorage.deleteSnapshot).toHaveBeenCalledWith('snap-baseline');
    });

    it('unlinks snapshot from profile after force delete', async () => {
      (manager as any).baselineId = 'snap-baseline';
      mockStorage.deleteSnapshot.mockResolvedValue(undefined);

      await manager.deleteSnapshot('snap-baseline', true);

      expect(mockProfileManager.unlinkSnapshot).toHaveBeenCalledWith('profile-1', 'snap-baseline');
    });
  });

  describe('createSnapshot', () => {
    it('stores both cliDiff and cliDump from combined export', async () => {
      const snapshot = await manager.createSnapshot('Test snapshot');

      expect(mockMspClient.exportCLIDiffAndDump).toHaveBeenCalled();
      expect(snapshot.configuration.cliDiff).toBe('# diff all');
      expect(snapshot.configuration.cliDump).toBe(
        'defaults nosave\nset gyro_lpf1_static_hz = 250\nsave'
      );
    });
  });
});
