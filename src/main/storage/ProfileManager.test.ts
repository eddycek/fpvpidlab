import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ProfileManager } from './ProfileManager';
import type { ProfileCreationInput } from '@shared/types/profile.types';

const mockFCInfo = {
  variant: 'BTFL',
  version: '4.5.1',
  target: 'STM32F7X2',
  boardName: 'SPEEDYBEEF7V3',
  apiVersion: { protocol: 0, major: 1, minor: 46 },
};

function makeInput(serial: string, name = 'Test Drone'): ProfileCreationInput {
  return {
    fcSerialNumber: serial,
    fcInfo: mockFCInfo,
    name,
    size: '5"',
    battery: '6S',
    weight: 650,
    flightStyle: 'balanced',
  };
}

describe('ProfileManager', () => {
  let manager: ProfileManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `bfat-test-profmgr-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    manager = new ProfileManager(tempDir);
    await manager.initialize();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ─── createProfile ───────────────────────────────────────────

  it('creates profile with UUID and timestamps', async () => {
    const profile = await manager.createProfile(makeInput('SN-001'));

    expect(profile.id).toBeTruthy();
    expect(profile.id.length).toBeGreaterThan(0);
    expect(profile.fcSerialNumber).toBe('SN-001');
    expect(profile.name).toBe('Test Drone');
    expect(profile.snapshotIds).toEqual([]);
    expect(profile.createdAt).toBeTruthy();
    expect(profile.connectionCount).toBe(1);
  });

  it('persists profile to storage', async () => {
    const created = await manager.createProfile(makeInput('SN-002'));
    const loaded = await manager.getProfile(created.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('Test Drone');
  });

  it('sets current profile on creation', async () => {
    const profile = await manager.createProfile(makeInput('SN-003'));
    expect(manager.getCurrentProfileId()).toBe(profile.id);
  });

  // ─── createProfileFromPreset ─────────────────────────────────

  it('maps preset fields correctly', async () => {
    const preset = {
      name: '5" Freestyle',
      description: 'Standard 5-inch freestyle quad',
      size: '5"' as const,
      battery: '6S' as const,
      weight: 650,
      flightStyle: 'balanced' as const,
      motorKV: 1950,
      propSize: '5.1"',
    };

    const profile = await manager.createProfileFromPreset(preset, 'SN-PRESET', mockFCInfo);

    expect(profile.name).toBe('5" Freestyle');
    expect(profile.size).toBe('5"');
    expect(profile.weight).toBe(650);
    expect(profile.motorKV).toBe(1950);
  });

  it('uses custom name when provided', async () => {
    const preset = {
      name: 'Default',
      description: '',
      size: '3"' as const,
      battery: '4S' as const,
      weight: 180,
      flightStyle: 'balanced' as const,
    };
    const profile = await manager.createProfileFromPreset(
      preset,
      'SN-X',
      mockFCInfo,
      'My Custom Name'
    );
    expect(profile.name).toBe('My Custom Name');
  });

  // ─── updateProfile ───────────────────────────────────────────

  it('merges updates and bumps updatedAt', async () => {
    const created = await manager.createProfile(makeInput('SN-UPD'));
    const originalUpdatedAt = created.updatedAt;

    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 10));

    const updated = await manager.updateProfile(created.id, { name: 'Renamed' });

    expect(updated.name).toBe('Renamed');
    expect(updated.fcSerialNumber).toBe('SN-UPD'); // Unchanged
    expect(updated.updatedAt).not.toBe(originalUpdatedAt);
  });

  it('throws for unknown profile ID', async () => {
    await expect(manager.updateProfile('ghost', { name: 'X' })).rejects.toThrow('not found');
  });

  // ─── deleteProfile ───────────────────────────────────────────

  it('removes profile from storage', async () => {
    const profile = await manager.createProfile(makeInput('SN-DEL'));
    await manager.deleteProfile(profile.id);

    const loaded = await manager.getProfile(profile.id);
    expect(loaded).toBeNull();
  });

  it('clears current profile if deleting active one', async () => {
    const profile = await manager.createProfile(makeInput('SN-ACTIVE'));
    expect(manager.getCurrentProfileId()).toBe(profile.id);

    await manager.deleteProfile(profile.id);
    expect(manager.getCurrentProfileId()).toBeNull();
  });

  it('throws for non-existent profile', async () => {
    await expect(manager.deleteProfile('ghost')).rejects.toThrow('not found');
  });

  // ─── listProfiles ────────────────────────────────────────────

  it('returns metadata array for all profiles', async () => {
    await manager.createProfile(makeInput('SN-A', 'Alpha'));
    await manager.createProfile(makeInput('SN-B', 'Beta'));

    const list = await manager.listProfiles();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.name)).toContain('Alpha');
    expect(list.map((p) => p.name)).toContain('Beta');
    // Metadata only — no fcInfo or snapshotIds
    expect((list[0] as any).fcInfo).toBeUndefined();
  });

  // ─── getProfile ──────────────────────────────────────────────

  it('returns null for unknown ID', async () => {
    expect(await manager.getProfile('ghost')).toBeNull();
  });

  // ─── findProfileBySerial ─────────────────────────────────────

  it('finds profile by FC serial number', async () => {
    await manager.createProfile(makeInput('SN-FIND-ME', 'Target'));
    await manager.createProfile(makeInput('SN-OTHER', 'Other'));

    const found = await manager.findProfileBySerial('SN-FIND-ME');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Target');
  });

  it('returns null when serial not found', async () => {
    expect(await manager.findProfileBySerial('UNKNOWN')).toBeNull();
  });

  // ─── setCurrentProfile / getCurrentProfile ───────────────────

  it('sets current profile and increments connection count', async () => {
    const profile = await manager.createProfile(makeInput('SN-SET'));
    const initialCount = profile.connectionCount;

    // Clear and re-set to simulate reconnect
    manager.clearCurrentProfile();
    const updated = await manager.setCurrentProfile(profile.id);

    expect(manager.getCurrentProfileId()).toBe(profile.id);
    expect(updated.connectionCount).toBe(initialCount + 1);
  });

  it('getCurrentProfile returns null when no profile set', async () => {
    manager.clearCurrentProfile();
    expect(await manager.getCurrentProfile()).toBeNull();
  });

  it('setCurrentProfile throws for unknown ID', async () => {
    await expect(manager.setCurrentProfile('ghost')).rejects.toThrow('not found');
  });

  // ─── clearCurrentProfile ─────────────────────────────────────

  it('clears current profile ID', async () => {
    await manager.createProfile(makeInput('SN-CLR'));
    expect(manager.getCurrentProfileId()).not.toBeNull();

    manager.clearCurrentProfile();
    expect(manager.getCurrentProfileId()).toBeNull();
  });

  // ─── linkSnapshot / unlinkSnapshot ───────────────────────────

  it('links snapshot to profile', async () => {
    const profile = await manager.createProfile(makeInput('SN-LINK'));
    await manager.linkSnapshot(profile.id, 'snap-001');

    const loaded = await manager.getProfile(profile.id);
    expect(loaded!.snapshotIds).toContain('snap-001');
  });

  it('sets baseline when linking with isBaseline=true', async () => {
    const profile = await manager.createProfile(makeInput('SN-BASE'));
    await manager.linkSnapshot(profile.id, 'snap-base', true);

    const loaded = await manager.getProfile(profile.id);
    expect(loaded!.baselineSnapshotId).toBe('snap-base');
  });

  it('does not duplicate snapshot ID on re-link', async () => {
    const profile = await manager.createProfile(makeInput('SN-DUP'));
    await manager.linkSnapshot(profile.id, 'snap-x');
    await manager.linkSnapshot(profile.id, 'snap-x');

    const loaded = await manager.getProfile(profile.id);
    expect(loaded!.snapshotIds.filter((id) => id === 'snap-x')).toHaveLength(1);
  });

  it('unlinks snapshot and clears baseline if matched', async () => {
    const profile = await manager.createProfile(makeInput('SN-UNLINK'));
    await manager.linkSnapshot(profile.id, 'snap-rm', true);

    await manager.unlinkSnapshot(profile.id, 'snap-rm');

    const loaded = await manager.getProfile(profile.id);
    expect(loaded!.snapshotIds).not.toContain('snap-rm');
    expect(loaded!.baselineSnapshotId).toBeUndefined();
  });

  // ─── exportProfile ───────────────────────────────────────────

  it('exports profile to file', async () => {
    const profile = await manager.createProfile(makeInput('SN-EXP'));
    const destPath = join(tempDir, 'export.json');

    await manager.exportProfile(profile.id, destPath);

    const content = JSON.parse(await fs.readFile(destPath, 'utf-8'));
    expect(content.id).toBe(profile.id);
  });
});
