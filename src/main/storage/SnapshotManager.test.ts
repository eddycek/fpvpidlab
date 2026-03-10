import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SnapshotManager } from './SnapshotManager';
import type { MSPClient } from '../msp/MSPClient';
import { ProfileManager } from './ProfileManager';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockFCInfo = {
  variant: 'BTFL',
  version: '4.5.1',
  target: 'STM32F7X2',
  boardName: 'SPEEDYBEEF7V3',
  apiVersion: { protocol: 0, major: 1, minor: 46 },
};

function createMockMSPClient(connected = true): MSPClient {
  return {
    isConnected: vi.fn().mockReturnValue(connected),
    getFCInfo: vi.fn().mockResolvedValue(mockFCInfo),
    exportCLIDiff: vi
      .fn()
      .mockResolvedValue('set gyro_lpf1_static_hz = 250\nset dterm_lpf1_static_hz = 150'),
  } as any;
}

describe('SnapshotManager', () => {
  let snapshotDir: string;
  let profileDir: string;
  let manager: SnapshotManager;
  let profileManager: ProfileManager;
  let mockMSP: MSPClient;

  beforeEach(async () => {
    const base = join(
      tmpdir(),
      `bfat-test-snapmgr-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    snapshotDir = join(base, 'snapshots');
    profileDir = join(base, 'profiles');

    mockMSP = createMockMSPClient();
    manager = new SnapshotManager(snapshotDir, mockMSP);
    await manager.initialize();

    profileManager = new ProfileManager(profileDir);
    await profileManager.initialize();
    manager.setProfileManager(profileManager);
  });

  afterEach(async () => {
    try {
      // Clean up both dirs
      const base = join(snapshotDir, '..');
      await fs.rm(base, { recursive: true, force: true });
    } catch {}
  });

  // ─── createSnapshot ──────────────────────────────────────────

  it('creates snapshot with FC info and CLI diff', async () => {
    // Create a profile so there's a current profile
    const profile = await profileManager.createProfile({
      fcSerialNumber: 'SN-001',
      fcInfo: mockFCInfo,
      name: 'Test',
      size: '5"',
      battery: '4S',
    });

    const snap = await manager.createSnapshot('My Backup', 'manual');

    expect(snap.id).toBeTruthy();
    expect(snap.label).toBe('My Backup');
    expect(snap.type).toBe('manual');
    expect(snap.fcInfo.version).toBe('4.5.1');
    expect(snap.configuration.cliDiff).toContain('gyro_lpf1_static_hz');
    expect(snap.metadata.createdBy).toBe('user');

    // Verify linked to profile
    const updatedProfile = await profileManager.getProfile(profile.id);
    expect(updatedProfile!.snapshotIds).toContain(snap.id);
  });

  it('creates auto snapshot with createdBy=auto', async () => {
    await profileManager.createProfile({
      fcSerialNumber: 'SN-002',
      fcInfo: mockFCInfo,
      name: 'Test',
      size: '5"',
      battery: '4S',
    });

    const snap = await manager.createSnapshot('Auto backup', 'auto');
    expect(snap.metadata.createdBy).toBe('auto');
  });

  it('creates baseline and sets baselineSnapshotId', async () => {
    const profile = await profileManager.createProfile({
      fcSerialNumber: 'SN-003',
      fcInfo: mockFCInfo,
      name: 'Test',
      size: '5"',
      battery: '4S',
    });

    const snap = await manager.createSnapshot('Baseline', 'baseline');

    const loaded = await profileManager.getProfile(profile.id);
    expect(loaded!.baselineSnapshotId).toBe(snap.id);
  });

  it('creates snapshot with tuning metadata', async () => {
    await profileManager.createProfile({
      fcSerialNumber: 'SN-META',
      fcInfo: mockFCInfo,
      name: 'Test',
      size: '5"',
      battery: '4S',
    });

    const snap = await manager.createSnapshot('Pre-tuning #1 (Deep Tune)', 'auto', {
      tuningSessionNumber: 1,
      tuningType: 'guided',
      snapshotRole: 'pre-tuning',
    });

    expect(snap.metadata.tuningSessionNumber).toBe(1);
    expect(snap.metadata.tuningType).toBe('guided');
    expect(snap.metadata.snapshotRole).toBe('pre-tuning');
  });

  it('propagates tuning metadata to listSnapshots', async () => {
    await profileManager.createProfile({
      fcSerialNumber: 'SN-LIST-META',
      fcInfo: mockFCInfo,
      name: 'Test',
      size: '5"',
      battery: '4S',
    });

    await manager.createSnapshot('Pre-tuning #2 (Flash Tune)', 'auto', {
      tuningSessionNumber: 2,
      tuningType: 'quick',
      snapshotRole: 'pre-tuning',
    });

    const list = await manager.listSnapshots();
    const meta = list.find((s) => s.label.includes('Pre-tuning #2'));
    expect(meta).toBeDefined();
    expect(meta!.tuningSessionNumber).toBe(2);
    expect(meta!.tuningType).toBe('quick');
    expect(meta!.snapshotRole).toBe('pre-tuning');
  });

  it('throws when MSP client not connected', async () => {
    const disconnectedMSP = createMockMSPClient(false);
    const mgr = new SnapshotManager(snapshotDir, disconnectedMSP);
    await mgr.initialize();

    await expect(mgr.createSnapshot('X')).rejects.toThrow('Not connected');
  });

  // ─── createBaselineIfMissing ─────────────────────────────────

  it('creates baseline when none exists', async () => {
    await profileManager.createProfile({
      fcSerialNumber: 'SN-BL',
      fcInfo: mockFCInfo,
      name: 'Test',
      size: '5"',
      battery: '4S',
    });

    await manager.createBaselineIfMissing();

    const snapshots = await manager.listSnapshots();
    expect(snapshots.some((s) => s.type === 'baseline')).toBe(true);
  });

  it('skips if baseline already exists', async () => {
    await profileManager.createProfile({
      fcSerialNumber: 'SN-BL2',
      fcInfo: mockFCInfo,
      name: 'Test',
      size: '5"',
      battery: '4S',
    });

    await manager.createSnapshot('Baseline', 'baseline');
    const callCountBefore = (mockMSP.exportCLIDiff as any).mock.calls.length;

    await manager.createBaselineIfMissing();

    // exportCLIDiff should NOT be called again
    expect((mockMSP.exportCLIDiff as any).mock.calls.length).toBe(callCountBefore);
  });

  // ─── loadSnapshot ────────────────────────────────────────────

  it('loads previously saved snapshot', async () => {
    await profileManager.createProfile({
      fcSerialNumber: 'SN-LD',
      fcInfo: mockFCInfo,
      name: 'Test',
      size: '5"',
      battery: '4S',
    });

    const created = await manager.createSnapshot('Test');
    const loaded = await manager.loadSnapshot(created.id);

    expect(loaded.id).toBe(created.id);
    expect(loaded.configuration.cliDiff).toBe(created.configuration.cliDiff);
  });

  it('throws for non-existent snapshot', async () => {
    await expect(manager.loadSnapshot('ghost')).rejects.toThrow();
  });

  // ─── deleteSnapshot ──────────────────────────────────────────

  it('deletes non-baseline snapshot', async () => {
    const profile = await profileManager.createProfile({
      fcSerialNumber: 'SN-DL',
      fcInfo: mockFCInfo,
      name: 'Test',
      size: '5"',
      battery: '4S',
    });

    const snap = await manager.createSnapshot('Deletable', 'manual');
    await manager.deleteSnapshot(snap.id);

    // Should be unlinked from profile
    const loaded = await profileManager.getProfile(profile.id);
    expect(loaded!.snapshotIds).not.toContain(snap.id);
  });

  it('prevents deleting baseline snapshot (tracked in manager)', async () => {
    await profileManager.createProfile({
      fcSerialNumber: 'SN-NB',
      fcInfo: mockFCInfo,
      name: 'Test',
      size: '5"',
      battery: '4S',
    });

    const baseline = await manager.createSnapshot('Baseline', 'baseline');
    await expect(manager.deleteSnapshot(baseline.id)).rejects.toThrow('Cannot delete baseline');
  });

  it('prevents deleting profile baseline snapshot', async () => {
    await profileManager.createProfile({
      fcSerialNumber: 'SN-PB',
      fcInfo: mockFCInfo,
      name: 'Test',
      size: '5"',
      battery: '4S',
    });

    const baseline = await manager.createSnapshot('Baseline', 'baseline');

    // Create a new manager without internal baseline tracking
    const freshMgr = new SnapshotManager(snapshotDir, mockMSP);
    await freshMgr.initialize();
    freshMgr.setProfileManager(profileManager);

    // Still should fail because profile.baselineSnapshotId is set
    await expect(freshMgr.deleteSnapshot(baseline.id)).rejects.toThrow('Cannot delete baseline');
  });

  // ─── listSnapshots ───────────────────────────────────────────

  it('lists snapshots filtered by current profile', async () => {
    await profileManager.createProfile({
      fcSerialNumber: 'SN-P1',
      fcInfo: mockFCInfo,
      name: 'Drone 1',
      size: '5"',
      battery: '4S',
    });

    const snap1 = await manager.createSnapshot('Snap A', 'manual');

    // Create second profile and switch to it
    await profileManager.createProfile({
      fcSerialNumber: 'SN-P2',
      fcInfo: mockFCInfo,
      name: 'Drone 2',
      size: '3"',
      battery: '4S',
    });

    const snap2 = await manager.createSnapshot('Snap B', 'manual');

    // Current profile is p2 → should only see snap2
    const list = await manager.listSnapshots();
    expect(list.map((s) => s.id)).toContain(snap2.id);
    expect(list.map((s) => s.id)).not.toContain(snap1.id);
  });

  it('returns snapshots sorted newest first', async () => {
    await profileManager.createProfile({
      fcSerialNumber: 'SN-SORT',
      fcInfo: mockFCInfo,
      name: 'Test',
      size: '5"',
      battery: '4S',
    });

    const first = await manager.createSnapshot('First', 'manual');
    await new Promise((r) => setTimeout(r, 10));
    const second = await manager.createSnapshot('Second', 'manual');

    const list = await manager.listSnapshots();
    expect(list[0].id).toBe(second.id);
    expect(list[1].id).toBe(first.id);
  });

  // ─── exportSnapshot ──────────────────────────────────────────

  it('exports snapshot to destination path', async () => {
    await profileManager.createProfile({
      fcSerialNumber: 'SN-EXP',
      fcInfo: mockFCInfo,
      name: 'Test',
      size: '5"',
      battery: '4S',
    });

    const snap = await manager.createSnapshot('Export Me');
    const destPath = join(snapshotDir, '..', 'exported.json');
    await manager.exportSnapshot(snap.id, destPath);

    const content = JSON.parse(await fs.readFile(destPath, 'utf-8'));
    expect(content.id).toBe(snap.id);
  });

  // ─── getBaseline ─────────────────────────────────────────────

  it('returns baseline via profile baselineSnapshotId', async () => {
    await profileManager.createProfile({
      fcSerialNumber: 'SN-GB',
      fcInfo: mockFCInfo,
      name: 'Test',
      size: '5"',
      battery: '4S',
    });

    const baseline = await manager.createSnapshot('Baseline', 'baseline');
    const result = await manager.getBaseline();

    expect(result).not.toBeNull();
    expect(result!.id).toBe(baseline.id);
  });

  it('returns null when no baseline exists', async () => {
    await profileManager.createProfile({
      fcSerialNumber: 'SN-NB2',
      fcInfo: mockFCInfo,
      name: 'Test',
      size: '5"',
      battery: '4S',
    });

    const result = await manager.getBaseline();
    expect(result).toBeNull();
  });
});
