import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FCStateCache,
  CacheMSPClient,
  CacheSnapshotProvider,
  CacheProfileProvider,
} from './FCStateCache';
import type { FCInfo } from '@shared/types/common.types';
import type {
  PIDConfiguration,
  FeedforwardConfiguration,
  RatesConfiguration,
} from '@shared/types/pid.types';
import type { CurrentFilterSettings } from '@shared/types/analysis.types';
import type { BlackboxInfo } from '@shared/types/blackbox.types';
import { EMPTY_FC_STATE } from '@shared/types/fcState.types';

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../ipc/handlers/types', () => ({
  parseDiffSetting: vi.fn((diff: string, key: string) => {
    const match = diff.match(new RegExp(`^set\\s+${key}\\s*=\\s*(.+)`, 'im'));
    return match ? match[1].trim() : undefined;
  }),
}));

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeFCInfo(overrides: Partial<FCInfo> = {}): FCInfo {
  return {
    variant: 'BTFL',
    version: '4.5.0',
    target: 'STM32F405',
    boardName: 'TestBoard',
    apiVersion: { protocol: 0, major: 1, minor: 46 },
    ...overrides,
  };
}

function makePIDConfig(): PIDConfiguration {
  return {
    roll: { P: 45, I: 80, D: 40 },
    pitch: { P: 47, I: 84, D: 43 },
    yaw: { P: 45, I: 80, D: 0 },
  };
}

function makeFilterConfig(): CurrentFilterSettings {
  return {
    gyro_lpf1_static_hz: 250,
    gyro_lpf2_static_hz: 500,
    dterm_lpf1_static_hz: 150,
    dterm_lpf2_static_hz: 150,
    dyn_notch_min_hz: 100,
    dyn_notch_max_hz: 600,
  };
}

function makeRatesConfig(): RatesConfiguration {
  return {
    ratesType: 'ACTUAL',
    roll: { rcRate: 200, rate: 200, rcExpo: 0, rateLimit: 1998 },
    pitch: { rcRate: 200, rate: 200, rcExpo: 0, rateLimit: 1998 },
    yaw: { rcRate: 200, rate: 200, rcExpo: 0, rateLimit: 1998 },
  };
}

function makeFFConfig(): FeedforwardConfiguration {
  return {
    transition: 0,
    rollGain: 100,
    pitchGain: 100,
    yawGain: 100,
    boost: 15,
    smoothFactor: 37,
    jitterFactor: 7,
    maxRateLimit: 100,
  };
}

function makeBBInfo(overrides: Partial<BlackboxInfo> = {}): BlackboxInfo {
  return {
    supported: true,
    storageType: 'flash',
    totalSize: 16 * 1024 * 1024,
    usedSize: 1024 * 1024,
    hasLogs: true,
    freeSize: 15 * 1024 * 1024,
    usagePercent: 6.25,
    ...overrides,
  };
}

function makeTuningConfig(): Record<string, number> {
  return { vbat_sag_compensation: 100, thrust_linear: 0, tpa_rate: 65 };
}

// ---------------------------------------------------------------------------
// Mock MSP client
// ---------------------------------------------------------------------------

function createMockMSPClient(): CacheMSPClient & {
  _cliMode: boolean;
  getFCInfo: ReturnType<typeof vi.fn>;
  getStatusEx: ReturnType<typeof vi.fn>;
  getPIDConfiguration: ReturnType<typeof vi.fn>;
  getFilterConfiguration: ReturnType<typeof vi.fn>;
  getFeedforwardConfiguration: ReturnType<typeof vi.fn>;
  getRatesConfiguration: ReturnType<typeof vi.fn>;
  getTuningConfig: ReturnType<typeof vi.fn>;
  getBlackboxInfo: ReturnType<typeof vi.fn>;
  getPidProcessDenom: ReturnType<typeof vi.fn>;
} {
  const mock = {
    _cliMode: false,
    isConnected: vi.fn(() => true),
    isInCLI: () => mock._cliMode,
    getFCInfo: vi.fn().mockResolvedValue(makeFCInfo()),
    getStatusEx: vi.fn().mockResolvedValue({ pidProfileIndex: 0, pidProfileCount: 4 }),
    getPIDConfiguration: vi.fn().mockResolvedValue(makePIDConfig()),
    getFilterConfiguration: vi.fn().mockResolvedValue(makeFilterConfig()),
    getFeedforwardConfiguration: vi.fn().mockResolvedValue(makeFFConfig()),
    getRatesConfiguration: vi.fn().mockResolvedValue(makeRatesConfig()),
    getTuningConfig: vi.fn().mockResolvedValue(makeTuningConfig()),
    getBlackboxInfo: vi.fn().mockResolvedValue(makeBBInfo()),
    getPidProcessDenom: vi.fn().mockResolvedValue(2),
  };
  return mock;
}

function createMockSnapshotProvider(cliDiff = ''): CacheSnapshotProvider {
  return {
    loadSnapshot: vi.fn().mockResolvedValue({ configuration: { cliDiff } }),
  };
}

function createMockProfileProvider(snapshotIds: string[] = ['snap-1']): CacheProfileProvider {
  return {
    getCurrentProfile: vi.fn().mockResolvedValue({ snapshotIds }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FCStateCache', () => {
  let msp: ReturnType<typeof createMockMSPClient>;
  let cache: FCStateCache;

  beforeEach(() => {
    msp = createMockMSPClient();
    cache = new FCStateCache(msp);
    cache.setDependencies(
      createMockSnapshotProvider('set debug_mode = GYRO_SCALED\nset blackbox_sample_rate = 0'),
      createMockProfileProvider()
    );
  });

  // -------------------------------------------------------------------------
  // hydrate()
  // -------------------------------------------------------------------------

  it('hydrate() calls all MSP methods and populates state', async () => {
    await cache.hydrate();
    const state = cache.getState();

    expect(msp.getFCInfo).toHaveBeenCalled();
    expect(msp.getStatusEx).toHaveBeenCalled();
    expect(msp.getPIDConfiguration).toHaveBeenCalled();
    expect(msp.getFilterConfiguration).toHaveBeenCalled();
    expect(msp.getRatesConfiguration).toHaveBeenCalled();
    expect(msp.getBlackboxInfo).toHaveBeenCalled();
    expect(msp.getFeedforwardConfiguration).toHaveBeenCalled();
    expect(msp.getTuningConfig).toHaveBeenCalled();

    expect(state.info).toEqual(makeFCInfo());
    expect(state.statusEx).toEqual({ pidProfileIndex: 0, pidProfileCount: 4 });
    expect(state.pidConfig).toEqual(makePIDConfig());
    expect(state.filterConfig).toEqual(makeFilterConfig());
    expect(state.ratesConfig).toEqual(makeRatesConfig());
    expect(state.feedforwardConfig).toEqual(makeFFConfig());
    expect(state.tuningConfig).toEqual(makeTuningConfig());
    expect(state.blackboxInfo).toEqual(makeBBInfo());
    expect(state.blackboxSettings).toEqual({
      debugMode: 'GYRO_SCALED',
      sampleRate: 0,
      loggingRateHz: 4000,
    });
    expect(state.hydrating).toBe(false);
    expect(state.hydratedAt).toBeTruthy();
  });

  it('hydrate() handles MSP error gracefully (partial state)', async () => {
    msp.getPIDConfiguration.mockRejectedValue(new Error('MSP timeout'));
    msp.getBlackboxInfo.mockRejectedValue(new Error('MSP timeout'));

    await cache.hydrate();
    const state = cache.getState();

    // Failed slices are null, rest populated
    expect(state.pidConfig).toBeNull();
    expect(state.blackboxInfo).toBeNull();
    expect(state.info).toEqual(makeFCInfo());
    expect(state.filterConfig).toEqual(makeFilterConfig());
    expect(state.hydrating).toBe(false);
  });

  it('hydrate() sets hydrating flag and emits state-changed', async () => {
    const events: boolean[] = [];
    cache.on('state-changed', (state) => events.push(state.hydrating));

    await cache.hydrate();

    // First emit: hydrating=true, last emit: hydrating=false
    expect(events[0]).toBe(true);
    expect(events[events.length - 1]).toBe(false);
  });

  it('hydrate() passes apiVersion from FCInfo to getStatusEx', async () => {
    const apiVersion = { protocol: 0, major: 1, minor: 46 };
    msp.getFCInfo.mockResolvedValue(makeFCInfo({ apiVersion }));

    await cache.hydrate();

    expect(msp.getStatusEx).toHaveBeenCalledWith(apiVersion);
  });

  // -------------------------------------------------------------------------
  // invalidate()
  // -------------------------------------------------------------------------

  it('invalidate([blackboxInfo]) only re-reads blackboxInfo', async () => {
    await cache.hydrate();
    msp.getFCInfo.mockClear();
    msp.getPIDConfiguration.mockClear();
    msp.getBlackboxInfo.mockClear();

    await cache.invalidate(['blackboxInfo']);

    expect(msp.getBlackboxInfo).toHaveBeenCalledTimes(1);
    expect(msp.getFCInfo).not.toHaveBeenCalled();
    expect(msp.getPIDConfiguration).not.toHaveBeenCalled();
  });

  it('invalidate() skips when CLI mode active', async () => {
    await cache.hydrate();
    msp._cliMode = true;
    msp.getBlackboxInfo.mockClear();

    await cache.invalidate(['blackboxInfo']);

    expect(msp.getBlackboxInfo).not.toHaveBeenCalled();
  });

  it('invalidate() flash->none guard preserves storageType', async () => {
    await cache.hydrate();
    // Simulate FC briefly reporting 'none' for flash storage
    msp.getBlackboxInfo.mockResolvedValue(makeBBInfo({ storageType: 'none' }));

    await cache.invalidate(['blackboxInfo']);
    const state = cache.getState();

    expect(state.blackboxInfo?.storageType).toBe('flash');
    expect(state.blackboxInfo?.usedSize).toBe(0);
    expect(state.blackboxInfo?.hasLogs).toBe(false);
  });

  it('invalidate() reads feedforward and tuning sequentially', async () => {
    await cache.hydrate();
    const callOrder: string[] = [];
    msp.getFeedforwardConfiguration.mockImplementation(async () => {
      callOrder.push('ff');
      return makeFFConfig();
    });
    msp.getTuningConfig.mockImplementation(async () => {
      callOrder.push('tuning');
      return makeTuningConfig();
    });

    await cache.invalidate(['feedforwardConfig', 'tuningConfig']);

    expect(callOrder).toEqual(['ff', 'tuning']);
  });

  // -------------------------------------------------------------------------
  // clear()
  // -------------------------------------------------------------------------

  it('clear() resets all to null', async () => {
    await cache.hydrate();
    cache.clear();
    const state = cache.getState();

    expect(state).toEqual(EMPTY_FC_STATE);
  });

  it('clear() emits state-changed', () => {
    const listener = vi.fn();
    cache.on('state-changed', listener);
    cache.clear();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // getState() / getSlice()
  // -------------------------------------------------------------------------

  it('getState() returns correct values after hydrate', async () => {
    await cache.hydrate();
    const state = cache.getState();
    expect(state.info?.variant).toBe('BTFL');
    expect(state.statusEx?.pidProfileCount).toBe(4);
  });

  it('getSlice() returns specific value', async () => {
    await cache.hydrate();
    expect(cache.getSlice('pidConfig')).toEqual(makePIDConfig());
    expect(cache.getSlice('info')).toEqual(makeFCInfo());
  });

  // -------------------------------------------------------------------------
  // state-changed events
  // -------------------------------------------------------------------------

  it('emits state-changed on hydrate, invalidate, and clear', async () => {
    const listener = vi.fn();
    cache.on('state-changed', listener);

    await cache.hydrate();
    const hydrateCount = listener.mock.calls.length;
    expect(hydrateCount).toBeGreaterThanOrEqual(2); // at least start + end

    await cache.invalidate(['pidConfig']);
    expect(listener.mock.calls.length).toBeGreaterThan(hydrateCount);

    const preClean = listener.mock.calls.length;
    cache.clear();
    expect(listener.mock.calls.length).toBe(preClean + 1);
  });

  // -------------------------------------------------------------------------
  // blackboxSettings from snapshot
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Generation protection (stale hydrate prevention)
  // -------------------------------------------------------------------------

  it('clear() during hydrate prevents stale state writes', async () => {
    // Make getFCInfo slow so we can clear() mid-hydrate
    let resolveFCInfo: ((val: FCInfo) => void) | undefined;
    msp.getFCInfo.mockImplementation(
      () =>
        new Promise<FCInfo>((resolve) => {
          resolveFCInfo = resolve;
        })
    );

    const hydratePromise = cache.hydrate();

    // Clear while hydrate is waiting on getFCInfo
    cache.clear();

    // Now resolve the stale getFCInfo — should be discarded
    resolveFCInfo!(makeFCInfo({ variant: 'STALE' }));
    await hydratePromise;

    // State should be empty (from clear), not the stale hydrate result
    expect(cache.getState()).toEqual(EMPTY_FC_STATE);
  });

  it('hydrate() flash->none guard applies on re-hydrate', async () => {
    // First hydrate sets blackboxInfo with flash storage
    await cache.hydrate();
    expect(cache.getState().blackboxInfo?.storageType).toBe('flash');

    // Second hydrate: FC briefly reports 'none'
    msp.getBlackboxInfo.mockResolvedValue(makeBBInfo({ storageType: 'none' }));
    await cache.hydrate();

    // Guard should preserve flash storageType
    expect(cache.getState().blackboxInfo?.storageType).toBe('flash');
    expect(cache.getState().blackboxInfo?.usedSize).toBe(0);
  });

  // -------------------------------------------------------------------------
  // blackboxSettings from snapshot
  // -------------------------------------------------------------------------

  it('blackboxSettings defaults when no snapshot provider', async () => {
    const bareCache = new FCStateCache(msp);
    // No setDependencies call
    await bareCache.hydrate();
    expect(bareCache.getState().blackboxSettings).toBeNull();
  });

  it('blackboxSettings uses latest snapshot CLI diff', async () => {
    const snapshotProvider: CacheSnapshotProvider = {
      loadSnapshot: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'snap-2') {
          return {
            configuration: { cliDiff: 'set debug_mode = NONE\nset blackbox_sample_rate = 2' },
          };
        }
        return { configuration: { cliDiff: 'set debug_mode = GYRO_SCALED' } };
      }),
    };
    const profileProvider = createMockProfileProvider(['snap-1', 'snap-2']);

    cache.setDependencies(snapshotProvider, profileProvider);
    await cache.hydrate();

    const settings = cache.getState().blackboxSettings;
    expect(settings?.debugMode).toBe('NONE');
    expect(settings?.sampleRate).toBe(2);
  });
});
