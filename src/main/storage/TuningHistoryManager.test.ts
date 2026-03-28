import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TuningHistoryManager } from './TuningHistoryManager';
import type { TuningSession } from '@shared/types/tuning.types';
import { TUNING_TYPE, TUNING_PHASE } from '@shared/constants';

function makeCompletedSession(
  profileId: string,
  overrides?: Partial<TuningSession>
): TuningSession {
  return {
    profileId,
    phase: TUNING_PHASE.COMPLETED,
    tuningType: TUNING_TYPE.FILTER,
    startedAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T12:00:00.000Z',
    baselineSnapshotId: 'snap-baseline',
    filterLogId: 'log-filter',
    pidLogId: 'log-pid',
    appliedFilterChanges: [{ setting: 'gyro_lpf1_static_hz', previousValue: 250, newValue: 180 }],
    appliedPIDChanges: [{ setting: 'p_roll', previousValue: 45, newValue: 50 }],
    ...overrides,
  };
}

describe('TuningHistoryManager', () => {
  let manager: TuningHistoryManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'tuning-history-test-'));
    manager = new TuningHistoryManager(tempDir);
    await manager.initialize();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('creates the tuning-history directory', async () => {
      const historyDir = join(tempDir, 'tuning-history');
      const stat = await fs.stat(historyDir);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('archiveSession', () => {
    it('creates a record with unique ID', async () => {
      const session = makeCompletedSession('profile-1');
      const record = await manager.archiveSession(session);

      expect(record.id).toBeTruthy();
      expect(typeof record.id).toBe('string');
      expect(record.profileId).toBe('profile-1');
      expect(record.startedAt).toBe(session.startedAt);
      expect(record.completedAt).toBe(session.updatedAt);
    });

    it('persists record to disk', async () => {
      const session = makeCompletedSession('profile-1');
      await manager.archiveSession(session);

      const filePath = join(tempDir, 'tuning-history', 'profile-1.json');
      const json = await fs.readFile(filePath, 'utf-8');
      const records = JSON.parse(json);
      expect(records).toHaveLength(1);
      expect(records[0].profileId).toBe('profile-1');
    });

    it('appends multiple records (newest-first on getHistory)', async () => {
      const session1 = makeCompletedSession('profile-1', {
        startedAt: '2026-01-10T10:00:00.000Z',
        updatedAt: '2026-01-10T12:00:00.000Z',
      });
      const session2 = makeCompletedSession('profile-1', {
        startedAt: '2026-01-15T10:00:00.000Z',
        updatedAt: '2026-01-15T12:00:00.000Z',
      });

      await manager.archiveSession(session1);
      await manager.archiveSession(session2);

      const history = await manager.getHistory('profile-1');
      expect(history).toHaveLength(2);
      // Newest first
      expect(history[0].startedAt).toBe('2026-01-15T10:00:00.000Z');
      expect(history[1].startedAt).toBe('2026-01-10T10:00:00.000Z');
    });

    it('uses null defaults for missing optional fields', async () => {
      const session = makeCompletedSession('profile-1', {
        baselineSnapshotId: undefined,
        postFilterSnapshotId: undefined,
        postTuningSnapshotId: undefined,
        filterLogId: undefined,
        pidLogId: undefined,
        verificationLogId: undefined,
        appliedFilterChanges: undefined,
        appliedPIDChanges: undefined,
        filterMetrics: undefined,
        pidMetrics: undefined,
        verificationMetrics: undefined,
      });

      const record = await manager.archiveSession(session);
      expect(record.baselineSnapshotId).toBeNull();
      expect(record.postFilterSnapshotId).toBeNull();
      expect(record.postTuningSnapshotId).toBeNull();
      expect(record.filterLogId).toBeNull();
      expect(record.pidLogId).toBeNull();
      expect(record.verificationLogId).toBeNull();
      expect(record.appliedFilterChanges).toEqual([]);
      expect(record.appliedPIDChanges).toEqual([]);
      expect(record.filterMetrics).toBeNull();
      expect(record.pidMetrics).toBeNull();
      expect(record.verificationMetrics).toBeNull();
    });

    it('rejects non-completed sessions', async () => {
      const session: TuningSession = {
        profileId: 'profile-1',
        phase: TUNING_PHASE.FILTER_ANALYSIS,
        tuningType: TUNING_TYPE.FILTER,
        startedAt: '2026-01-15T10:00:00.000Z',
        updatedAt: '2026-01-15T11:00:00.000Z',
      };

      await expect(manager.archiveSession(session)).rejects.toThrow(
        'Cannot archive non-completed session'
      );
    });

    it('generates unique IDs for each record', async () => {
      const session = makeCompletedSession('profile-1');
      const record1 = await manager.archiveSession(session);
      const record2 = await manager.archiveSession(session);
      expect(record1.id).not.toBe(record2.id);
    });
  });

  describe('getHistory', () => {
    it('returns empty array for non-existent profile', async () => {
      const history = await manager.getHistory('nonexistent');
      expect(history).toEqual([]);
    });

    it('returns newest-first ordering', async () => {
      await manager.archiveSession(
        makeCompletedSession('profile-1', {
          startedAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T01:00:00Z',
        })
      );
      await manager.archiveSession(
        makeCompletedSession('profile-1', {
          startedAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T01:00:00Z',
        })
      );
      await manager.archiveSession(
        makeCompletedSession('profile-1', {
          startedAt: '2026-03-01T00:00:00Z',
          updatedAt: '2026-03-01T01:00:00Z',
        })
      );

      const history = await manager.getHistory('profile-1');
      expect(history).toHaveLength(3);
      expect(history[0].startedAt).toBe('2026-03-01T00:00:00Z');
      expect(history[2].startedAt).toBe('2026-01-01T00:00:00Z');
    });

    it('returns empty array for corrupted file', async () => {
      const filePath = join(tempDir, 'tuning-history', 'corrupt.json');
      await fs.writeFile(filePath, '{not valid json!!!', 'utf-8');
      const history = await manager.getHistory('corrupt');
      expect(history).toEqual([]);
    });

    it('isolates history between profiles', async () => {
      await manager.archiveSession(makeCompletedSession('profile-a'));
      await manager.archiveSession(makeCompletedSession('profile-b'));
      await manager.archiveSession(makeCompletedSession('profile-b'));

      const historyA = await manager.getHistory('profile-a');
      const historyB = await manager.getHistory('profile-b');
      expect(historyA).toHaveLength(1);
      expect(historyB).toHaveLength(2);
    });
  });

  describe('updateLatestVerification', () => {
    const verificationMetrics = {
      noiseLevel: 'low' as const,
      roll: { noiseFloorDb: -50, peakCount: 0 },
      pitch: { noiseFloorDb: -48, peakCount: 0 },
      yaw: { noiseFloorDb: -52, peakCount: 0 },
      segmentsUsed: 2,
      summary: 'Improved noise',
    };

    it('updates the most recent record', async () => {
      await manager.archiveSession(
        makeCompletedSession('profile-1', {
          startedAt: '2026-01-10T00:00:00Z',
          updatedAt: '2026-01-10T01:00:00Z',
        })
      );
      await manager.archiveSession(
        makeCompletedSession('profile-1', {
          startedAt: '2026-01-20T00:00:00Z',
          updatedAt: '2026-01-20T01:00:00Z',
        })
      );

      const result = await manager.updateLatestVerification('profile-1', verificationMetrics);
      expect(result).toBe(true);

      const history = await manager.getHistory('profile-1');
      // Newest first — index 0 should have verification
      expect(history[0].verificationMetrics).toEqual(verificationMetrics);
      // Older record should NOT have verification
      expect(history[1].verificationMetrics).toBeNull();
    });

    it('returns false for empty history', async () => {
      const result = await manager.updateLatestVerification('nonexistent', verificationMetrics);
      expect(result).toBe(false);
    });

    it('does not create a new record', async () => {
      await manager.archiveSession(makeCompletedSession('profile-1'));
      await manager.updateLatestVerification('profile-1', verificationMetrics);

      const history = await manager.getHistory('profile-1');
      expect(history).toHaveLength(1);
    });
  });

  describe('updateRecordVerification', () => {
    const verificationMetrics = {
      noiseLevel: 'low' as const,
      roll: { noiseFloorDb: -50, peakCount: 0 },
      pitch: { noiseFloorDb: -48, peakCount: 0 },
      yaw: { noiseFloorDb: -52, peakCount: 0 },
      segmentsUsed: 2,
      summary: 'Improved noise',
    };

    it('updates the correct record by ID', async () => {
      const r1 = await manager.archiveSession(
        makeCompletedSession('profile-1', {
          startedAt: '2026-01-10T00:00:00Z',
          updatedAt: '2026-01-10T01:00:00Z',
        })
      );
      const r2 = await manager.archiveSession(
        makeCompletedSession('profile-1', {
          startedAt: '2026-01-20T00:00:00Z',
          updatedAt: '2026-01-20T01:00:00Z',
        })
      );

      const result = await manager.updateRecordVerification(
        'profile-1',
        r1.id,
        verificationMetrics
      );
      expect(result).toBe(true);

      const history = await manager.getHistory('profile-1');
      // r1 is older — index 1 in newest-first
      const updated = history.find((h) => h.id === r1.id)!;
      const untouched = history.find((h) => h.id === r2.id)!;
      expect(updated.verificationMetrics).toEqual(verificationMetrics);
      expect(untouched.verificationMetrics).toBeNull();
    });

    it('returns false for unknown record ID', async () => {
      await manager.archiveSession(makeCompletedSession('profile-1'));

      const result = await manager.updateRecordVerification(
        'profile-1',
        'nonexistent-id',
        verificationMetrics
      );
      expect(result).toBe(false);
    });

    it('returns false for non-existent profile', async () => {
      const result = await manager.updateRecordVerification(
        'nonexistent',
        'any-id',
        verificationMetrics
      );
      expect(result).toBe(false);
    });

    it('does not create a new record', async () => {
      const r1 = await manager.archiveSession(makeCompletedSession('profile-1'));
      await manager.updateRecordVerification('profile-1', r1.id, verificationMetrics);

      const history = await manager.getHistory('profile-1');
      expect(history).toHaveLength(1);
    });
  });

  describe('quick tuning archive', () => {
    it('archives tuningType from session', async () => {
      const session = makeCompletedSession('profile-1', {
        tuningType: TUNING_TYPE.FLASH,
      });
      const record = await manager.archiveSession(session);
      expect(record.tuningType).toBe(TUNING_TYPE.FLASH);
    });

    it('archives quickLogId from session', async () => {
      const session = makeCompletedSession('profile-1', {
        tuningType: TUNING_TYPE.FLASH,
        quickLogId: 'quick-log-abc',
      });
      const record = await manager.archiveSession(session);
      expect(record.quickLogId).toBe('quick-log-abc');
    });

    it('archives transferFunctionMetrics from session', async () => {
      const tfMetrics = {
        roll: {
          bandwidthHz: 65,
          phaseMarginDeg: 55,
          gainMarginDb: 12,
          overshootPercent: 8,
          settlingTimeMs: 80,
          riseTimeMs: 12,
        },
        pitch: {
          bandwidthHz: 60,
          phaseMarginDeg: 50,
          gainMarginDb: 10,
          overshootPercent: 10,
          settlingTimeMs: 90,
          riseTimeMs: 14,
        },
        yaw: {
          bandwidthHz: 40,
          phaseMarginDeg: 45,
          gainMarginDb: 8,
          overshootPercent: 12,
          settlingTimeMs: 100,
          riseTimeMs: 18,
        },
      };
      const session = makeCompletedSession('profile-1', {
        tuningType: TUNING_TYPE.FLASH,
        transferFunctionMetrics: tfMetrics,
      });
      const record = await manager.archiveSession(session);
      expect(record.transferFunctionMetrics).toEqual(tfMetrics);
    });

    it('defaults quickLogId and transferFunctionMetrics to null', async () => {
      const session = makeCompletedSession('profile-1');
      const record = await manager.archiveSession(session);
      expect(record.quickLogId).toBeNull();
      expect(record.transferFunctionMetrics).toBeNull();
    });
  });

  describe('deleteHistory', () => {
    it('deletes all history for a profile', async () => {
      await manager.archiveSession(makeCompletedSession('profile-1'));
      await manager.archiveSession(makeCompletedSession('profile-1'));

      await manager.deleteHistory('profile-1');

      const history = await manager.getHistory('profile-1');
      expect(history).toEqual([]);
    });

    it('is a no-op for non-existent profile', async () => {
      // Should not throw
      await manager.deleteHistory('nonexistent');
    });

    it('does not affect other profiles', async () => {
      await manager.archiveSession(makeCompletedSession('profile-a'));
      await manager.archiveSession(makeCompletedSession('profile-b'));

      await manager.deleteHistory('profile-a');

      const historyA = await manager.getHistory('profile-a');
      const historyB = await manager.getHistory('profile-b');
      expect(historyA).toEqual([]);
      expect(historyB).toHaveLength(1);
    });
  });
});
