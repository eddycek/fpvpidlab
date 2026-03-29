/**
 * E2E Workflow Tests
 *
 * Tests the main user workflows end-to-end using real storage managers
 * with temp directories, a mocked MSP client, and direct IPC handler
 * invocation. Covers multi-step scenarios that cross handler boundaries.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Mocks (must be before source imports) ────────────────────────────────────

const registeredHandlers = new Map<string, (...args: any[]) => Promise<any>>();

let mockAppPath = '/tmp/test';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: any) => {
      registeredHandlers.set(channel, handler);
    }),
  },
  BrowserWindow: vi.fn(),
  app: {
    getPath: vi.fn(() => mockAppPath),
  },
  shell: { openPath: vi.fn().mockResolvedValue('') },
}));

vi.mock('../window', () => ({
  getMainWindow: vi.fn().mockReturnValue({
    webContents: { send: vi.fn() },
  }),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock heavy analysis modules — E2E tests cover workflow, not analysis internals
const mockParse = vi.fn();
vi.mock('../blackbox/BlackboxParser', () => ({
  BlackboxParser: { parse: (...args: any[]) => mockParse(...args) },
}));

vi.mock('../analysis/FilterAnalyzer', () => ({
  analyze: vi.fn().mockResolvedValue({
    noise: { overallLevel: 'medium' },
    recommendations: [],
    summary: 'Test',
    analysisTimeMs: 100,
    sessionIndex: 0,
    segmentsUsed: 1,
  }),
}));

vi.mock('../analysis/PIDAnalyzer', () => ({
  analyzePID: vi.fn().mockResolvedValue({
    roll: { responses: [], meanOvershoot: 10 },
    pitch: { responses: [], meanOvershoot: 12 },
    yaw: { responses: [], meanOvershoot: 8 },
    recommendations: [],
    summary: 'Test PID',
    analysisTimeMs: 100,
    sessionIndex: 0,
    stepsDetected: 10,
    currentPIDs: {
      roll: { P: 45, I: 80, D: 30 },
      pitch: { P: 47, I: 84, D: 32 },
      yaw: { P: 45, I: 80, D: 0 },
    },
  }),
}));

vi.mock('../analysis/PIDRecommender', () => ({
  extractFlightPIDs: vi.fn().mockReturnValue(null),
}));

vi.mock('../analysis/headerValidation', () => ({
  validateBBLHeader: vi.fn().mockReturnValue([]),
  enrichSettingsFromBBLHeaders: vi.fn().mockReturnValue(null),
}));

// ── Source imports ────────────────────────────────────────────────────────────

import {
  registerIPCHandlers,
  setMSPClient,
  setProfileManager,
  setSnapshotManager,
  setBlackboxManager,
  setTuningSessionManager,
} from '../ipc/handlers';
import { ProfileManager } from '../storage/ProfileManager';
import { SnapshotManager } from '../storage/SnapshotManager';
import { BlackboxManager } from '../storage/BlackboxManager';
import { TuningSessionManager } from '../storage/TuningSessionManager';
import { IPCChannel } from '@shared/types/ipc.types';
import type { IPCResponse } from '@shared/types/ipc.types';
import type { ProfileCreationInput } from '@shared/types/profile.types';
import type { PIDConfiguration } from '@shared/types/pid.types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockMSPClient(connected = true) {
  return {
    isConnected: vi.fn().mockReturnValue(connected),
    listPorts: vi
      .fn()
      .mockResolvedValue([
        { path: '/dev/ttyUSB0', manufacturer: 'STM', vendorId: '0483', productId: '5740' },
      ]),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getConnectionStatus: vi.fn().mockReturnValue({ connected: true, port: '/dev/ttyUSB0' }),
    getFCInfo: vi.fn().mockResolvedValue({
      variant: 'BTFL',
      version: '4.5.1',
      firmwareVersion: '4.5.1',
      target: 'STM32F7X2',
      boardName: 'SPEEDYBEE',
      apiVersion: { protocol: 0, major: 1, minor: 46 },
    }),
    getFCSerialNumber: vi.fn().mockResolvedValue('SN-E2E-001'),
    getPIDConfiguration: vi.fn().mockResolvedValue({
      roll: { P: 45, I: 80, D: 30 },
      pitch: { P: 47, I: 84, D: 32 },
      yaw: { P: 45, I: 80, D: 0 },
    }),
    setPIDConfiguration: vi.fn().mockResolvedValue(undefined),
    getFilterConfiguration: vi.fn().mockResolvedValue({
      gyro_lpf1_static_hz: 250,
      gyro_lpf2_static_hz: 500,
      dterm_lpf1_static_hz: 150,
      dterm_lpf2_static_hz: 250,
      gyro_lpf1_type: 0,
      dterm_lpf1_type: 0,
    }),
    getFeedforwardConfiguration: vi.fn().mockResolvedValue({
      feedforward_averaging: 0,
      feedforward_smooth_factor: 25,
      feedforward_jitter_factor: 7,
      feedforward_boost: 15,
      feedforward_max_rate_limit: 90,
    }),
    getBlackboxInfo: vi.fn().mockResolvedValue({
      flags: 0,
      totalSize: 2097152,
      usedSize: 0,
      device: 'FLASH',
      hasLogs: false,
    }),
    exportCLIDiff: vi
      .fn()
      .mockResolvedValue(
        'set gyro_lpf1_static_hz = 250\nset dterm_lpf1_static_hz = 150\n' +
          'set debug_mode = GYRO_SCALED\nset blackbox_sample_rate = 1'
      ),
    downloadBlackboxLog: vi.fn(),
    eraseBlackboxFlash: vi.fn().mockResolvedValue(undefined),
    saveAndReboot: vi.fn().mockResolvedValue(undefined),
    setRebootPending: vi.fn(),
    clearRebootPending: vi.fn(),
    getPidProcessDenom: vi.fn().mockResolvedValue(1),
    testBlackboxRead: vi.fn().mockResolvedValue({ success: true, message: 'OK' }),
    connection: {
      enterCLI: vi.fn().mockResolvedValue(undefined),
      sendCLICommand: vi.fn().mockResolvedValue(''),
      exitCLI: vi.fn(),
      clearFCRebootedFromCLI: vi.fn(),
      isInCLI: vi.fn().mockReturnValue(false),
    },
  };
}

function createMockEvent() {
  const sentEvents: Array<{ channel: string; data: any }> = [];
  return {
    event: {
      sender: {
        send: vi.fn((ch: string, ...data: any[]) => {
          sentEvents.push({ channel: ch, data: data.length === 1 ? data[0] : data });
        }),
      },
    },
    sentEvents,
  };
}

async function invoke(channel: string, ...args: any[]): Promise<IPCResponse<any>> {
  const handler = registeredHandlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  const { event } = createMockEvent();
  return handler(event, ...args);
}

async function invokeWithEvent(
  channel: string,
  event: any,
  ...args: any[]
): Promise<IPCResponse<any>> {
  const handler = registeredHandlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler(event, ...args);
}

function makeProfileInput(
  serial: string = 'SN-E2E-001',
  name: string = 'E2E Test Quad'
): ProfileCreationInput {
  return {
    fcSerialNumber: serial,
    name,
    size: '5"',
    battery: '6S',
    weight: 650,
    flightStyle: 'balanced',
    fcInfo: {
      variant: 'BTFL',
      version: '4.5.1',
      target: 'STM32F7X2',
      boardName: 'SPEEDYBEE',
      apiVersion: { protocol: 0, major: 1, minor: 46 },
    },
  };
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('E2E Tuning Workflow', () => {
  let tempBase: string;
  let profileManager: ProfileManager;
  let snapshotManager: SnapshotManager;
  let blackboxManager: BlackboxManager;
  let tuningSessionManager: TuningSessionManager;
  let mockMSP: ReturnType<typeof createMockMSPClient>;

  beforeEach(async () => {
    registeredHandlers.clear();

    // Create unique temp directory for each test
    tempBase = join(tmpdir(), `fpvpidlab-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempBase, { recursive: true });

    const profilesDir = join(tempBase, 'profiles');
    const snapshotsDir = join(tempBase, 'snapshots');

    // Point electron app.getPath to our temp dir so BlackboxManager uses it
    mockAppPath = tempBase;

    // Initialize real managers with temp directories
    profileManager = new ProfileManager(profilesDir);
    await profileManager.initialize();

    mockMSP = createMockMSPClient();

    // SnapshotManager needs a real MSPClient interface — use mock
    snapshotManager = new SnapshotManager(snapshotsDir, mockMSP as any);
    snapshotManager.setProfileManager(profileManager);
    await snapshotManager.initialize();

    blackboxManager = new BlackboxManager();
    await blackboxManager.initialize();

    tuningSessionManager = new TuningSessionManager(tempBase);
    await tuningSessionManager.initialize();

    // Inject managers into IPC handlers
    setMSPClient(mockMSP);
    setProfileManager(profileManager);
    setSnapshotManager(snapshotManager);
    setBlackboxManager(blackboxManager);
    setTuningSessionManager(tuningSessionManager);

    // Register handlers (populates registeredHandlers map)
    registerIPCHandlers();
  });

  afterEach(async () => {
    // Tear down managers
    setMSPClient(null);
    setProfileManager(null);
    setSnapshotManager(null);
    setBlackboxManager(null);
    setTuningSessionManager(null);

    // Clean up temp directory
    await fs.rm(tempBase, { recursive: true, force: true });

    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 1: Profile + Connection Workflow
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Profile + Connection Workflow', () => {
    it('list ports -> connect -> get FC info (sequential workflow)', async () => {
      // Step 1: List available ports
      const portsRes = await invoke(IPCChannel.CONNECTION_LIST_PORTS);
      expect(portsRes.success).toBe(true);
      expect(portsRes.data).toHaveLength(1);
      expect(portsRes.data[0].path).toBe('/dev/ttyUSB0');

      // Step 2: Connect
      const connectRes = await invoke(IPCChannel.CONNECTION_CONNECT, '/dev/ttyUSB0');
      expect(connectRes.success).toBe(true);
      expect(mockMSP.connect).toHaveBeenCalledWith('/dev/ttyUSB0');

      // Step 3: Get FC info
      const infoRes = await invoke(IPCChannel.FC_GET_INFO);
      expect(infoRes.success).toBe(true);
      expect(infoRes.data.variant).toBe('BTFL');
      expect(infoRes.data.version).toBe('4.5.1');
      expect(infoRes.data.boardName).toBe('SPEEDYBEE');
    });

    it('connect -> create profile for new FC', async () => {
      // Connect
      await invoke(IPCChannel.CONNECTION_CONNECT, '/dev/ttyUSB0');

      // Create profile with FC serial
      const profileRes = await invoke(
        IPCChannel.PROFILE_CREATE,
        makeProfileInput('SN-E2E-001', 'My FPV Quad')
      );
      expect(profileRes.success).toBe(true);
      expect(profileRes.data.fcSerialNumber).toBe('SN-E2E-001');
      expect(profileRes.data.name).toBe('My FPV Quad');

      // Verify profile is now current and has baseline snapshot
      // (createBaselineIfMissing runs after the profile is returned,
      //  so re-read to see the linked snapshot)
      const currentRes = await invoke(IPCChannel.PROFILE_GET_CURRENT);
      expect(currentRes.success).toBe(true);
      expect(currentRes.data.id).toBe(profileRes.data.id);
      expect(currentRes.data.snapshotIds.length).toBeGreaterThanOrEqual(1);
    });

    it('connect -> existing profile auto-selected via set current', async () => {
      // Create profile first
      const createRes = await invoke(
        IPCChannel.PROFILE_CREATE,
        makeProfileInput('SN-E2E-001', 'Existing Quad')
      );
      const profileId = createRes.data.id;

      // Simulate reconnect: set current profile
      const setRes = await invoke(IPCChannel.PROFILE_SET_CURRENT, profileId);
      expect(setRes.success).toBe(true);
      expect(setRes.data.id).toBe(profileId);

      // Verify it loads correctly
      const getRes = await invoke(IPCChannel.PROFILE_GET, profileId);
      expect(getRes.success).toBe(true);
      expect(getRes.data.name).toBe('Existing Quad');
    });

    it('disconnect -> reconnect preserves profile', async () => {
      // Create profile
      const createRes = await invoke(
        IPCChannel.PROFILE_CREATE,
        makeProfileInput('SN-E2E-001', 'Persistent Quad')
      );
      const profileId = createRes.data.id;

      // Disconnect
      await invoke(IPCChannel.CONNECTION_DISCONNECT);

      // Reconnect and set current profile
      await invoke(IPCChannel.CONNECTION_CONNECT, '/dev/ttyUSB0');
      const setRes = await invoke(IPCChannel.PROFILE_SET_CURRENT, profileId);
      expect(setRes.success).toBe(true);

      // Verify profile persisted
      const profileRes = await invoke(IPCChannel.PROFILE_GET_CURRENT);
      expect(profileRes.success).toBe(true);
      expect(profileRes.data.name).toBe('Persistent Quad');
      expect(profileRes.data.connectionCount).toBeGreaterThan(1);
    });

    it('create profile -> baseline snapshot auto-created', async () => {
      const createRes = await invoke(
        IPCChannel.PROFILE_CREATE,
        makeProfileInput('SN-E2E-001', 'Baseline Test')
      );
      expect(createRes.success).toBe(true);

      // Re-read profile to see the linked baseline snapshot
      // (createBaselineIfMissing links the snapshot after the handler returns the initial profile)
      const profileRes = await invoke(IPCChannel.PROFILE_GET_CURRENT);
      const profile = profileRes.data;
      expect(profile.snapshotIds.length).toBeGreaterThanOrEqual(1);
      expect(profile.baselineSnapshotId).toBeDefined();

      // Baseline snapshot should exist and be loadable
      const snapRes = await invoke(IPCChannel.SNAPSHOT_LOAD, profile.baselineSnapshotId);
      expect(snapRes.success).toBe(true);
      expect(snapRes.data.type).toBe('baseline');
      expect(snapRes.data.configuration.cliDiff).toContain('gyro_lpf1_static_hz');
    });

    it('delete active profile -> all snapshots deleted (cascading delete)', async () => {
      // Create profile
      const createRes = await invoke(
        IPCChannel.PROFILE_CREATE,
        makeProfileInput('SN-E2E-001', 'Delete Me')
      );
      const profileId = createRes.data.id;

      // Re-read profile to verify baseline was created
      const profileRes = await invoke(IPCChannel.PROFILE_GET_CURRENT);
      expect(profileRes.data.snapshotIds.length).toBeGreaterThanOrEqual(1);

      // Create an additional manual snapshot
      const snapRes = await invoke(IPCChannel.SNAPSHOT_CREATE, 'Manual backup');
      expect(snapRes.success).toBe(true);

      // Delete the profile
      const deleteRes = await invoke(IPCChannel.PROFILE_DELETE, profileId);
      expect(deleteRes.success).toBe(true);

      // Profile should be gone
      const listRes = await invoke(IPCChannel.PROFILE_LIST);
      expect(listRes.success).toBe(true);
      expect(listRes.data).toHaveLength(0);

      // FC should be disconnected after deleting active profile
      expect(mockMSP.disconnect).toHaveBeenCalled();
    });

    it('profile set current works when switching profiles', async () => {
      // Create two profiles
      const prof1Res = await invoke(
        IPCChannel.PROFILE_CREATE,
        makeProfileInput('SN-E2E-001', 'Quad A')
      );
      const prof2Res = await invoke(
        IPCChannel.PROFILE_CREATE,
        makeProfileInput('SN-E2E-002', 'Quad B')
      );
      expect(prof1Res.success).toBe(true);
      expect(prof2Res.success).toBe(true);

      // Switch to profile 1
      const switchRes = await invoke(IPCChannel.PROFILE_SET_CURRENT, prof1Res.data.id);
      expect(switchRes.success).toBe(true);

      const currentRes = await invoke(IPCChannel.PROFILE_GET_CURRENT);
      expect(currentRes.data.name).toBe('Quad A');
    });

    it('multiple FCs -> separate profiles', async () => {
      // Create profile for FC #1
      const prof1 = await invoke(
        IPCChannel.PROFILE_CREATE,
        makeProfileInput('SN-FC-001', 'Freestyle Quad')
      );
      expect(prof1.success).toBe(true);

      // Create profile for FC #2
      const prof2 = await invoke(
        IPCChannel.PROFILE_CREATE,
        makeProfileInput('SN-FC-002', 'Race Quad')
      );
      expect(prof2.success).toBe(true);

      // Both profiles exist
      const listRes = await invoke(IPCChannel.PROFILE_LIST);
      expect(listRes.success).toBe(true);
      expect(listRes.data).toHaveLength(2);

      const names = listRes.data.map((p: any) => p.name);
      expect(names).toContain('Freestyle Quad');
      expect(names).toContain('Race Quad');

      // They have different IDs and serial numbers
      expect(prof1.data.id).not.toBe(prof2.data.id);
      expect(prof1.data.fcSerialNumber).not.toBe(prof2.data.fcSerialNumber);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 2: Snapshot Workflow
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Snapshot Workflow', () => {
    beforeEach(async () => {
      // Create a profile for snapshot tests
      await invoke(IPCChannel.PROFILE_CREATE, makeProfileInput('SN-SNAP-001', 'Snapshot Test'));
    });

    it('create manual snapshot -> appears in list', async () => {
      const createRes = await invoke(IPCChannel.SNAPSHOT_CREATE, 'My manual snapshot');
      expect(createRes.success).toBe(true);
      expect(createRes.data.label).toBe('My manual snapshot');
      expect(createRes.data.type).toBe('manual');

      // Verify it appears in the list
      const listRes = await invoke(IPCChannel.SNAPSHOT_LIST);
      expect(listRes.success).toBe(true);

      const ids = listRes.data.map((s: any) => s.id);
      expect(ids).toContain(createRes.data.id);
    });

    it('snapshot restore applies CLI commands to FC', async () => {
      // Create a snapshot with known CLI diff
      mockMSP.exportCLIDiff.mockResolvedValue(
        'set gyro_lpf1_static_hz = 200\nset dterm_lpf1_static_hz = 120\nfeature TELEMETRY'
      );
      const snapRes = await invoke(IPCChannel.SNAPSHOT_CREATE, 'Restore source');
      expect(snapRes.success).toBe(true);

      // Restore the snapshot without backup
      const { event } = createMockEvent();
      const restoreRes = await invokeWithEvent(
        IPCChannel.SNAPSHOT_RESTORE,
        event,
        snapRes.data.id,
        false
      );
      expect(restoreRes.success).toBe(true);
      expect(restoreRes.data.appliedCommands).toBe(3);
      expect(restoreRes.data.rebooted).toBe(true);

      // Verify CLI commands were sent
      expect(mockMSP.connection.enterCLI).toHaveBeenCalled();
      expect(mockMSP.connection.sendCLICommand).toHaveBeenCalledWith(
        'set gyro_lpf1_static_hz = 200'
      );
      expect(mockMSP.connection.sendCLICommand).toHaveBeenCalledWith(
        'set dterm_lpf1_static_hz = 120'
      );
      expect(mockMSP.connection.sendCLICommand).toHaveBeenCalledWith('feature TELEMETRY');
      expect(mockMSP.saveAndReboot).toHaveBeenCalled();
    });

    it('snapshot filtering by profile — profile A snapshots invisible in profile B', async () => {
      // Create snapshot under profile A (already the current profile)
      const snap1Res = await invoke(IPCChannel.SNAPSHOT_CREATE, 'Profile A snap');
      expect(snap1Res.success).toBe(true);

      // Profile A list should include this snapshot
      const listA = await invoke(IPCChannel.SNAPSHOT_LIST);
      const idsA = listA.data.map((s: any) => s.id);
      expect(idsA).toContain(snap1Res.data.id);

      // Create profile B and switch to it
      const profBRes = await invoke(
        IPCChannel.PROFILE_CREATE,
        makeProfileInput('SN-SNAP-002', 'Profile B')
      );
      expect(profBRes.success).toBe(true);

      // Profile B list should NOT contain profile A's manual snapshot
      const listB = await invoke(IPCChannel.SNAPSHOT_LIST);
      const idsB = listB.data.map((s: any) => s.id);
      expect(idsB).not.toContain(snap1Res.data.id);
    });

    it('export snapshot -> valid file output', async () => {
      const snapRes = await invoke(IPCChannel.SNAPSHOT_CREATE, 'Export test');
      expect(snapRes.success).toBe(true);

      const exportPath = join(tempBase, 'export', 'test-snapshot.json');
      const exportRes = await invoke(IPCChannel.SNAPSHOT_EXPORT, snapRes.data.id, exportPath);
      expect(exportRes.success).toBe(true);

      // Verify file was created and has valid JSON
      const fileContent = await fs.readFile(exportPath, 'utf-8');
      const parsed = JSON.parse(fileContent);
      expect(parsed.id).toBe(snapRes.data.id);
      expect(parsed.label).toBe('Export test');
      expect(parsed.configuration.cliDiff).toBeTruthy();
    });

    it('cannot delete baseline snapshot', async () => {
      // Get the baseline snapshot created during profile creation
      const profile = await invoke(IPCChannel.PROFILE_GET_CURRENT);
      const baselineId = profile.data.baselineSnapshotId;
      expect(baselineId).toBeDefined();

      // Attempt to delete should fail
      const deleteRes = await invoke(IPCChannel.SNAPSHOT_DELETE, baselineId);
      expect(deleteRes.success).toBe(false);
      expect(deleteRes.error).toContain('baseline');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 3: Tuning Session Workflow
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Tuning Session Workflow', () => {
    let profileId: string;

    beforeEach(async () => {
      const res = await invoke(
        IPCChannel.PROFILE_CREATE,
        makeProfileInput('SN-TUNE-001', 'Tuning Test Quad')
      );
      profileId = res.data.id;
    });

    it('start tuning session -> filter_flight_pending', async () => {
      const res = await invoke(IPCChannel.TUNING_START_SESSION);
      expect(res.success).toBe(true);
      expect(res.data.phase).toBe('filter_flight_pending');
      expect(res.data.profileId).toBe(profileId);

      // Session should be retrievable
      const getRes = await invoke(IPCChannel.TUNING_GET_SESSION);
      expect(getRes.success).toBe(true);
      expect(getRes.data.phase).toBe('filter_flight_pending');
    });

    it('start tuning session creates pre-tuning backup snapshot', async () => {
      const snapshotsBefore = await invoke(IPCChannel.SNAPSHOT_LIST);
      const countBefore = snapshotsBefore.data.length;

      await invoke(IPCChannel.TUNING_START_SESSION);

      const snapshotsAfter = await invoke(IPCChannel.SNAPSHOT_LIST);
      // At least one more snapshot (the pre-tuning backup)
      expect(snapshotsAfter.data.length).toBeGreaterThan(countBefore);

      // One of the new snapshots should be the auto backup with session context
      const labels = snapshotsAfter.data.map((s: any) => s.label);
      expect(labels.some((l: string) => l.includes('Pre-tuning #'))).toBe(true);
    });

    it('erase flash during tuning session — phase unchanged', async () => {
      await invoke(IPCChannel.TUNING_START_SESSION);

      // Erase flash
      const eraseRes = await invoke(IPCChannel.BLACKBOX_ERASE_FLASH);
      expect(eraseRes.success).toBe(true);
      expect(mockMSP.eraseBlackboxFlash).toHaveBeenCalled();

      // Tuning phase should remain unchanged
      const session = await invoke(IPCChannel.TUNING_GET_SESSION);
      expect(session.data.phase).toBe('filter_flight_pending');
    });

    it('download log -> parse returns sessions', async () => {
      // Set up mock for download
      mockMSP.downloadBlackboxLog.mockImplementation(async (onProgress: any) => {
        if (onProgress) onProgress(100);
        return { data: Buffer.from('fake-bbl-data'), compressionDetected: false };
      });

      // Ensure profile has fcSerial
      const profileRes = await invoke(IPCChannel.PROFILE_GET_CURRENT);
      expect(profileRes.data.fcSerialNumber).toBe('SN-TUNE-001');

      // Download
      const { event: dlEvent } = createMockEvent();
      const dlRes = await invokeWithEvent(IPCChannel.BLACKBOX_DOWNLOAD_LOG, dlEvent);
      expect(dlRes.success).toBe(true);
      expect(dlRes.data.id).toBeDefined();

      // Set up mock parse result
      mockParse.mockResolvedValue({
        sessions: [
          {
            index: 0,
            header: { rawHeaders: new Map() },
            flightData: {
              gyro: {
                roll: new Float64Array(100),
                pitch: new Float64Array(100),
                yaw: new Float64Array(100),
              },
              setpoint: {
                roll: new Float64Array(100),
                pitch: new Float64Array(100),
                yaw: new Float64Array(100),
              },
              timeUs: new Float64Array(100),
            },
          },
        ],
        success: true,
        parseTimeMs: 50,
      });

      // Parse the downloaded log
      const { event: parseEvent } = createMockEvent();
      const parseRes = await invokeWithEvent(
        IPCChannel.BLACKBOX_PARSE_LOG,
        parseEvent,
        dlRes.data.id
      );
      expect(parseRes.success).toBe(true);
      expect(parseRes.data.sessions).toHaveLength(1);
    });

    it('apply recommendations — 3-stage ordering: MSP PID -> CLI -> save', async () => {
      await invoke(IPCChannel.TUNING_START_SESSION);

      const callOrder: string[] = [];
      mockMSP.setPIDConfiguration.mockImplementation(async () => {
        callOrder.push('setPID');
      });
      mockMSP.connection.enterCLI.mockImplementation(async () => {
        callOrder.push('enterCLI');
      });
      mockMSP.connection.sendCLICommand.mockImplementation(async () => {
        callOrder.push('sendCLI');
        return '';
      });
      mockMSP.saveAndReboot.mockImplementation(async () => {
        callOrder.push('save');
      });

      const input = {
        filterRecommendations: [
          {
            setting: 'gyro_lpf1_static_hz',
            currentValue: 250,
            recommendedValue: 200,
            reason: 'test',
            impact: 'noise' as const,
            confidence: 'high' as const,
          },
        ],
        pidRecommendations: [
          {
            setting: 'pid_roll_p',
            currentValue: 45,
            recommendedValue: 50,
            reason: 'test',
            impact: 'response' as const,
            confidence: 'high' as const,
          },
        ],
        createSnapshot: true,
      };

      const { event } = createMockEvent();
      const res = await invokeWithEvent(IPCChannel.TUNING_APPLY_RECOMMENDATIONS, event, input);
      expect(res.success).toBe(true);
      expect(res.data.appliedPIDs).toBe(1);
      expect(res.data.appliedFilters).toBe(1);
      expect(res.data.rebooted).toBe(true);

      // Verify ordering: PID via MSP -> CLI -> save (no snapshot in Apply)
      expect(callOrder).toEqual(['setPID', 'enterCLI', 'sendCLI', 'save']);
    });

    it('apply PID-only recommendations — MSP setPID called, no CLI for PID-only', async () => {
      await invoke(IPCChannel.TUNING_START_SESSION);

      const input = {
        filterRecommendations: [],
        pidRecommendations: [
          {
            setting: 'pid_roll_p',
            currentValue: 45,
            recommendedValue: 55,
            reason: 'test',
            impact: 'response' as const,
            confidence: 'high' as const,
          },
          {
            setting: 'pid_pitch_d',
            currentValue: 32,
            recommendedValue: 28,
            reason: 'test',
            impact: 'response' as const,
            confidence: 'high' as const,
          },
        ],
        createSnapshot: false,
      };

      const { event } = createMockEvent();
      const res = await invokeWithEvent(IPCChannel.TUNING_APPLY_RECOMMENDATIONS, event, input);
      expect(res.success).toBe(true);
      expect(res.data.appliedPIDs).toBe(2);
      expect(res.data.appliedFilters).toBe(0);

      // PID was set via MSP
      expect(mockMSP.setPIDConfiguration).toHaveBeenCalled();
      // CLI was NOT entered (no filter changes)
      expect(mockMSP.connection.enterCLI).not.toHaveBeenCalled();
    });

    it('update tuning phase transitions correctly', async () => {
      await invoke(IPCChannel.TUNING_START_SESSION);

      // Transition through filter phases
      const phase1 = await invoke(IPCChannel.TUNING_UPDATE_PHASE, 'filter_log_ready', {
        filterLogId: 'log-filter-1',
      });
      expect(phase1.success).toBe(true);
      expect(phase1.data.phase).toBe('filter_log_ready');
      expect(phase1.data.filterLogId).toBe('log-filter-1');

      const phase2 = await invoke(IPCChannel.TUNING_UPDATE_PHASE, 'filter_analysis');
      expect(phase2.success).toBe(true);
      expect(phase2.data.phase).toBe('filter_analysis');

      const phase3 = await invoke(IPCChannel.TUNING_UPDATE_PHASE, 'filter_applied');
      expect(phase3.success).toBe(true);
      expect(phase3.data.phase).toBe('filter_applied');

      // Transition to PID phases
      const phase4 = await invoke(IPCChannel.TUNING_UPDATE_PHASE, 'pid_flight_pending');
      expect(phase4.success).toBe(true);
      expect(phase4.data.phase).toBe('pid_flight_pending');

      const phase5 = await invoke(IPCChannel.TUNING_UPDATE_PHASE, 'pid_log_ready', {
        pidLogId: 'log-pid-1',
      });
      expect(phase5.success).toBe(true);
      expect(phase5.data.pidLogId).toBe('log-pid-1');

      // Verify data accumulates across phases
      expect(phase5.data.filterLogId).toBe('log-filter-1');
    });

    it('reset tuning session -> returns to no-session state', async () => {
      await invoke(IPCChannel.TUNING_START_SESSION);

      // Verify session exists
      const before = await invoke(IPCChannel.TUNING_GET_SESSION);
      expect(before.data).not.toBeNull();

      // Reset
      const resetRes = await invoke(IPCChannel.TUNING_RESET_SESSION);
      expect(resetRes.success).toBe(true);

      // Session should be gone
      const after = await invoke(IPCChannel.TUNING_GET_SESSION);
      expect(after.data).toBeNull();
    });

    it('tuning session per-profile isolation — different profiles have independent sessions', async () => {
      // Start session for profile A
      await invoke(IPCChannel.TUNING_START_SESSION);
      await invoke(IPCChannel.TUNING_UPDATE_PHASE, 'filter_log_ready');

      // Create profile B and switch to it
      const profBRes = await invoke(
        IPCChannel.PROFILE_CREATE,
        makeProfileInput('SN-TUNE-002', 'Tuning Quad B')
      );
      expect(profBRes.success).toBe(true);

      // Profile B should have no session
      const sessionB = await invoke(IPCChannel.TUNING_GET_SESSION);
      expect(sessionB.data).toBeNull();

      // Start a session for profile B
      const startB = await invoke(IPCChannel.TUNING_START_SESSION);
      expect(startB.success).toBe(true);
      expect(startB.data.phase).toBe('filter_flight_pending');

      // Switch back to profile A
      await invoke(IPCChannel.PROFILE_SET_CURRENT, profileId);

      // Profile A session should still be at filter_log_ready
      const sessionA = await invoke(IPCChannel.TUNING_GET_SESSION);
      expect(sessionA.data).not.toBeNull();
      expect(sessionA.data.phase).toBe('filter_log_ready');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 4: Error Recovery
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Error Recovery', () => {
    it('handler returns error when MSP not connected', async () => {
      setMSPClient(null);

      const res = await invoke(IPCChannel.FC_GET_INFO);
      expect(res.success).toBe(false);
      expect(res.error).toContain('not initialized');
    });

    it('concurrent blackbox download rejected', async () => {
      // Create a profile first (required for download)
      await invoke(IPCChannel.PROFILE_CREATE, makeProfileInput('SN-ERR-001', 'Error Test Quad'));

      // First download hangs
      let resolveDownload: (value: { data: Buffer; compressionDetected: boolean }) => void;
      mockMSP.downloadBlackboxLog.mockImplementation(
        () =>
          new Promise<{ data: Buffer; compressionDetected: boolean }>((resolve) => {
            resolveDownload = resolve;
          })
      );

      const { event: e1 } = createMockEvent();
      const promise1 = invokeWithEvent(IPCChannel.BLACKBOX_DOWNLOAD_LOG, e1);

      // Wait a tick for the flag to be set
      await new Promise((r) => setTimeout(r, 10));

      // Second download should be rejected
      const { event: e2 } = createMockEvent();
      const res2 = await invokeWithEvent(IPCChannel.BLACKBOX_DOWNLOAD_LOG, e2);
      expect(res2.success).toBe(false);
      expect(res2.error).toContain('already in progress');

      // Clean up: resolve first download
      resolveDownload!({ data: Buffer.from('data'), compressionDetected: false });
      await promise1;
    });

    it('invalid PID values rejected (out of 0-255 range)', async () => {
      const invalidConfig: PIDConfiguration = {
        roll: { P: 300, I: 80, D: 40 }, // P > 255
        pitch: { P: 52, I: 84, D: 43 },
        yaw: { P: 45, I: 80, D: 0 },
      };

      const res = await invoke(IPCChannel.PID_UPDATE_CONFIG, invalidConfig);
      expect(res.success).toBe(false);
      expect(res.error).toContain('out of range');
    });

    it('parse nonexistent log -> error', async () => {
      const res = await invoke(IPCChannel.BLACKBOX_PARSE_LOG, 'nonexistent-log-id');
      expect(res.success).toBe(false);
      expect(res.error).toContain('not found');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 5: Blackbox Settings Workflow
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Blackbox Settings Workflow', () => {
    beforeEach(async () => {
      await invoke(
        IPCChannel.PROFILE_CREATE,
        makeProfileInput('SN-BB-001', 'Blackbox Settings Quad')
      );
    });

    it('get blackbox settings from baseline snapshot CLI diff', async () => {
      // The baseline was created with the mock CLI diff that includes:
      // set debug_mode = GYRO_SCALED
      // set blackbox_sample_rate = 1
      const res = await invoke(IPCChannel.FC_GET_BLACKBOX_SETTINGS);
      expect(res.success).toBe(true);
      expect(res.data.debugMode).toBe('GYRO_SCALED');
      expect(res.data.sampleRate).toBe(1);
      // 8000 / 1 (pid_denom) / 2^1 = 4000
      expect(res.data.loggingRateHz).toBe(4000);
    });

    it('fix blackbox settings applies CLI commands and reboots', async () => {
      const fixRes = await invoke(IPCChannel.FC_FIX_BLACKBOX_SETTINGS, {
        commands: ['set debug_mode = GYRO_SCALED', 'set blackbox_sample_rate = 0'],
      });
      expect(fixRes.success).toBe(true);
      expect(fixRes.data.appliedCommands).toBe(2);
      expect(fixRes.data.rebooted).toBe(true);

      expect(mockMSP.connection.enterCLI).toHaveBeenCalled();
      expect(mockMSP.connection.sendCLICommand).toHaveBeenCalledTimes(2);
      expect(mockMSP.saveAndReboot).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Group 6: Full Tuning Flow (end-to-end multi-step)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Full Tuning Flow', () => {
    it('complete filter tuning cycle: create profile -> start session -> download -> apply', async () => {
      // Step 1: Create profile
      const profileRes = await invoke(
        IPCChannel.PROFILE_CREATE,
        makeProfileInput('SN-FULL-001', 'Full Flow Quad')
      );
      expect(profileRes.success).toBe(true);

      // Step 2: Start tuning session
      const startRes = await invoke(IPCChannel.TUNING_START_SESSION);
      expect(startRes.success).toBe(true);
      expect(startRes.data.phase).toBe('filter_flight_pending');

      // Step 3: Erase flash (pre-flight)
      const eraseRes = await invoke(IPCChannel.BLACKBOX_ERASE_FLASH);
      expect(eraseRes.success).toBe(true);

      // Step 4: (user flies, reconnects) Transition to log_ready
      await invoke(IPCChannel.TUNING_UPDATE_PHASE, 'filter_log_ready');

      // Step 5: Download blackbox log
      mockMSP.downloadBlackboxLog.mockImplementation(async (onProgress: any) => {
        if (onProgress) onProgress(100);
        return { data: Buffer.from('filter-flight-data'), compressionDetected: false };
      });

      const { event: dlEvent } = createMockEvent();
      const dlRes = await invokeWithEvent(IPCChannel.BLACKBOX_DOWNLOAD_LOG, dlEvent);
      expect(dlRes.success).toBe(true);

      // Step 6: Transition to analysis phase
      await invoke(IPCChannel.TUNING_UPDATE_PHASE, 'filter_analysis', {
        filterLogId: dlRes.data.id,
      });

      // Step 7: Apply filter recommendations
      const applyInput = {
        filterRecommendations: [
          {
            setting: 'gyro_lpf1_static_hz',
            currentValue: 250,
            recommendedValue: 180,
            reason: 'Noise reduction',
            impact: 'noise' as const,
            confidence: 'high' as const,
          },
        ],
        pidRecommendations: [],
        createSnapshot: true,
      };

      const { event: applyEvent } = createMockEvent();
      const applyRes = await invokeWithEvent(
        IPCChannel.TUNING_APPLY_RECOMMENDATIONS,
        applyEvent,
        applyInput
      );
      expect(applyRes.success).toBe(true);
      expect(applyRes.data.appliedFilters).toBe(1);
      expect(applyRes.data.rebooted).toBe(true);

      // Step 8: Transition to filter_applied -> pid_flight_pending
      await invoke(IPCChannel.TUNING_UPDATE_PHASE, 'filter_applied');
      await invoke(IPCChannel.TUNING_UPDATE_PHASE, 'pid_flight_pending');

      // Verify the full session state
      const finalSession = await invoke(IPCChannel.TUNING_GET_SESSION);
      expect(finalSession.data.phase).toBe('pid_flight_pending');
      expect(finalSession.data.filterLogId).toBe(dlRes.data.id);
    });

    it('snapshot restore with backup creates safety net then applies commands', async () => {
      // Create a profile
      await invoke(IPCChannel.PROFILE_CREATE, makeProfileInput('SN-RESTORE-001', 'Restore Test'));

      // Create a snapshot to restore
      mockMSP.exportCLIDiff.mockResolvedValue(
        'set gyro_lpf1_static_hz = 300\nset dterm_lpf1_static_hz = 180\nset motor_pwm_protocol = DSHOT600'
      );
      const snapRes = await invoke(IPCChannel.SNAPSHOT_CREATE, 'Restore target');
      expect(snapRes.success).toBe(true);

      // Count snapshots before restore
      const beforeList = await invoke(IPCChannel.SNAPSHOT_LIST);
      const countBefore = beforeList.data.length;

      // Restore with backup
      const { event } = createMockEvent();
      const restoreRes = await invokeWithEvent(
        IPCChannel.SNAPSHOT_RESTORE,
        event,
        snapRes.data.id,
        true // createBackup
      );
      expect(restoreRes.success).toBe(true);
      expect(restoreRes.data.backupSnapshotId).toBeDefined();
      expect(restoreRes.data.appliedCommands).toBe(3);

      // Should have one more snapshot (the pre-restore backup)
      const afterList = await invoke(IPCChannel.SNAPSHOT_LIST);
      expect(afterList.data.length).toBeGreaterThan(countBefore);
    });
  });
});
