import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ProfileStorage } from './ProfileStorage';
import type { DroneProfile } from '@shared/types/profile.types';

function makeProfile(
  id: string,
  serial: string,
  overrides: Partial<DroneProfile> = {}
): DroneProfile {
  return {
    id,
    fcSerialNumber: serial,
    name: `Drone ${id}`,
    size: '5"',
    battery: '6S',
    weight: 650,
    flightStyle: 'balanced',
    fcInfo: {
      variant: 'BTFL',
      version: '4.5.1',
      target: 'STM32F7X2',
      boardName: 'SPEEDY',
      apiVersion: { protocol: 0, major: 1, minor: 46 },
    },
    createdAt: '2026-02-11T10:00:00.000Z',
    updatedAt: '2026-02-11T10:00:00.000Z',
    lastConnected: '2026-02-11T10:00:00.000Z',
    connectionCount: 1,
    snapshotIds: [],
    ...overrides,
  };
}

describe('ProfileStorage', () => {
  let storage: ProfileStorage;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `bfat-test-profstorage-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    storage = new ProfileStorage(tempDir);
    await storage.ensureDirectory();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ─── ensureDirectory ─────────────────────────────────────────

  it('creates storage dir and profiles.json if missing', async () => {
    const newDir = join(tempDir, 'sub');
    const s = new ProfileStorage(newDir);
    await s.ensureDirectory();

    const content = await fs.readFile(join(newDir, 'profiles.json'), 'utf-8');
    expect(JSON.parse(content)).toEqual({ profiles: {} });
  });

  it('does not overwrite existing profiles.json', async () => {
    const profile = makeProfile('p1', 'serial1');
    await storage.saveProfile(profile);

    // Re-initialize — should NOT reset data
    await storage.ensureDirectory();

    const loaded = await storage.loadProfile('p1');
    expect(loaded?.name).toBe('Drone p1');
  });

  // ─── saveProfile / loadProfile ───────────────────────────────

  it('saves and loads a profile', async () => {
    const profile = makeProfile('prof-1', 'SN-0001');
    await storage.saveProfile(profile);

    const loaded = await storage.loadProfile('prof-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('Drone prof-1');
    expect(loaded!.fcSerialNumber).toBe('SN-0001');
  });

  it('overwrites profile on re-save', async () => {
    await storage.saveProfile(makeProfile('p1', 'sn1', { name: 'First' }));
    await storage.saveProfile(makeProfile('p1', 'sn1', { name: 'Updated' }));

    const loaded = await storage.loadProfile('p1');
    expect(loaded!.name).toBe('Updated');
  });

  it('returns null for non-existent profile', async () => {
    const result = await storage.loadProfile('ghost');
    expect(result).toBeNull();
  });

  // ─── loadProfiles ────────────────────────────────────────────

  it('returns all profiles as a record', async () => {
    await storage.saveProfile(makeProfile('a', 'sn-a'));
    await storage.saveProfile(makeProfile('b', 'sn-b'));

    const all = await storage.loadProfiles();
    expect(Object.keys(all)).toHaveLength(2);
    expect(all['a'].name).toBe('Drone a');
    expect(all['b'].name).toBe('Drone b');
  });

  it('returns empty record if no profiles', async () => {
    const all = await storage.loadProfiles();
    expect(all).toEqual({});
  });

  // ─── deleteProfile ───────────────────────────────────────────

  it('removes profile from storage', async () => {
    await storage.saveProfile(makeProfile('del-me', 'sn'));
    await storage.deleteProfile('del-me');

    const loaded = await storage.loadProfile('del-me');
    expect(loaded).toBeNull();
  });

  it('preserves other profiles on delete', async () => {
    await storage.saveProfile(makeProfile('keep', 'sn1'));
    await storage.saveProfile(makeProfile('del', 'sn2'));
    await storage.deleteProfile('del');

    const all = await storage.loadProfiles();
    expect(Object.keys(all)).toHaveLength(1);
    expect(all['keep']).toBeDefined();
  });

  // ─── findProfileBySerial ─────────────────────────────────────

  it('finds profile by FC serial number', async () => {
    await storage.saveProfile(makeProfile('p1', 'ABC123'));
    await storage.saveProfile(makeProfile('p2', 'DEF456'));

    const found = await storage.findProfileBySerial('DEF456');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('p2');
  });

  it('returns null when serial not found', async () => {
    await storage.saveProfile(makeProfile('p1', 'ABC123'));
    const found = await storage.findProfileBySerial('UNKNOWN');
    expect(found).toBeNull();
  });

  // ─── exportProfile ───────────────────────────────────────────

  it('exports profile to file', async () => {
    await storage.saveProfile(makeProfile('exp', 'sn-exp'));
    const destPath = join(tempDir, 'export.json');

    await storage.exportProfile('exp', destPath);

    const content = JSON.parse(await fs.readFile(destPath, 'utf-8'));
    expect(content.id).toBe('exp');
    expect(content.fcSerialNumber).toBe('sn-exp');
  });

  it('exportProfile throws for non-existent profile', async () => {
    await expect(storage.exportProfile('ghost', '/tmp/out.json')).rejects.toThrow('not found');
  });

  // ─── backward compatibility (migration) ────────────────────

  it('migrates legacy profile missing weight and flightStyle', async () => {
    // Write a legacy profile directly to storage (bypassing typed API)
    const legacyProfiles = {
      profiles: {
        legacy: {
          id: 'legacy',
          fcSerialNumber: 'SN-LEGACY',
          name: 'Old Drone',
          size: '5"',
          battery: '4S',
          // no weight, no flightStyle
          fcInfo: {
            variant: 'BTFL',
            version: '4.4.0',
            target: 'STM32F405',
            boardName: 'MATEKF405',
            apiVersion: { protocol: 0, major: 1, minor: 46 },
          },
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          lastConnected: '2025-01-01T00:00:00.000Z',
          connectionCount: 3,
          snapshotIds: [],
        },
      },
    };
    await fs.writeFile(join(tempDir, 'profiles.json'), JSON.stringify(legacyProfiles));

    const loaded = await storage.loadProfile('legacy');
    expect(loaded).not.toBeNull();
    expect(loaded!.weight).toBe(650); // backfilled from SIZE_DEFAULTS['5"']
    expect(loaded!.flightStyle).toBe('balanced'); // default
  });

  it('migrates legacy profile with removed 2" size to 2.5"', async () => {
    const legacyProfiles = {
      profiles: {
        old2inch: {
          id: 'old2inch',
          fcSerialNumber: 'SN-2INCH',
          name: 'Old 2 inch',
          size: '2"',
          battery: '1S',
          fcInfo: {
            variant: 'BTFL',
            version: '4.4.0',
            target: 'STM32F405',
            boardName: 'MATEKF405',
            apiVersion: { protocol: 0, major: 1, minor: 46 },
          },
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          lastConnected: '2025-01-01T00:00:00.000Z',
          connectionCount: 1,
          snapshotIds: [],
        },
      },
    };
    await fs.writeFile(join(tempDir, 'profiles.json'), JSON.stringify(legacyProfiles));

    const loaded = await storage.loadProfile('old2inch');
    expect(loaded).not.toBeNull();
    expect(loaded!.size).toBe('2.5"'); // migrated from 2"
    expect(loaded!.weight).toBe(120); // SIZE_DEFAULTS['2.5"'].weight
    expect(loaded!.flightStyle).toBe('balanced');
  });

  it('migrates legacy profile with removed 10" size to 7"', async () => {
    const legacyProfiles = {
      profiles: {
        old10inch: {
          id: 'old10inch',
          fcSerialNumber: 'SN-10INCH',
          name: 'Old 10 inch',
          size: '10"',
          battery: '6S',
          weight: 1500,
          fcInfo: {
            variant: 'BTFL',
            version: '4.4.0',
            target: 'STM32F405',
            boardName: 'MATEKF405',
            apiVersion: { protocol: 0, major: 1, minor: 46 },
          },
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          lastConnected: '2025-01-01T00:00:00.000Z',
          connectionCount: 1,
          snapshotIds: [],
        },
      },
    };
    await fs.writeFile(join(tempDir, 'profiles.json'), JSON.stringify(legacyProfiles));

    const loaded = await storage.loadProfile('old10inch');
    expect(loaded).not.toBeNull();
    expect(loaded!.size).toBe('7"'); // migrated from 10"
    expect(loaded!.weight).toBe(1500); // preserved (was set)
    expect(loaded!.flightStyle).toBe('balanced');
  });
});
