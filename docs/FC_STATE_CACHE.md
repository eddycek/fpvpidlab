# FC State Cache — Centralized FC Data Management

> **Status**: Proposed

## Problem Statement

The application suffers from recurring state consistency issues during tuning workflows:

1. **Blackbox status displays incorrectly** — BB storage info is fetched independently by `useBlackboxInfo` hook, `App.tsx refreshBlackboxInfo()`, and `TuningStatusBanner`, leading to stale or conflicting values
2. **PID profile not displayed** — `pidProfileIndex` from `MSP_STATUS_EX` is read during connect but lost during reconnect/reboot cycles
3. **Erase step skipped / download button missing** — phase transitions occur before blackbox data is ready, causing the UI to skip workflow steps
4. **Race conditions** — CLI mode blocks MSP reads; concurrent IPC calls from multiple UI components trigger simultaneous FC communication

### Root Cause

There is **no centralized cache** for FC data in the main process. Each of 20+ IPC handlers reads directly from the flight controller via MSPClient on every call. The renderer has 20+ state variables in `App.tsx` tracking FC data (`flashUsedSize`, `storageType`, `storageTypeRef`, `bbSettings`, `fcVersion`, `connectedFcInfo`, `bbRefreshKey`...), with multiple hooks and components independently fetching the same data.

### Current Data Flow (problematic)

```
┌─────────────────────────────────────────────────────────┐
│ Renderer (React)                                        │
│                                                         │
│  App.tsx                useBlackboxInfo    BlackboxStatus│
│  refreshBlackboxInfo()  loadBlackboxInfo() (via hook)   │
│       │                      │                │         │
│       ▼                      ▼                ▼         │
│  ┌─────────────────────────────────────────────┐        │
│  │  window.betaflight.getBlackboxInfo()  ×3    │        │
│  └─────────────────────────────────────────────┘        │
└─────────────────────┬───────────────────────────────────┘
                      │ IPC (×3 independent calls)
┌─────────────────────▼───────────────────────────────────┐
│ Main Process                                            │
│                                                         │
│  blackboxHandlers.ts  (no cache, reads from FC each time)│
│       │                                                 │
│       ▼                                                 │
│  MSPClient.getBlackboxInfo()  ← serial port I/O ×3     │
└─────────────────────────────────────────────────────────┘
```

**Problems**: 3 independent reads for the same data, race conditions between them, stale values when one completes before another.

## Proposed Solution

### Architecture: FCStateCache + Event Push

```
┌─────────────────────────────────────────────────────────┐
│ Renderer (React)                                        │
│                                                         │
│  useFCState() hook ← single source of truth             │
│       │                                                 │
│       ├─ state.blackboxInfo  (used by BlackboxStatus,   │
│       │                       TuningStatusBanner, App)  │
│       ├─ state.info          (board, version, profiles) │
│       ├─ state.statusEx      (PID profile index)        │
│       ├─ state.pidConfig     (PID gains)                │
│       ├─ state.filterConfig  (filter settings)          │
│       └─ state.blackboxSettings (debug_mode, rate)      │
│                                                         │
│  Subscribes to EVENT_FC_STATE_CHANGED (push from main)  │
└─────────────────────────────────────────────────────────┘
                      ▲ Events (push, not pull)
┌─────────────────────┴───────────────────────────────────┐
│ Main Process                                            │
│                                                         │
│  FCStateCache (centralized in-memory cache)             │
│       │                                                 │
│       ├─ hydrate() — reads ALL FC data once on connect  │
│       ├─ get(key) — synchronous read from cache         │
│       ├─ invalidate(keys) — re-reads specific slices    │
│       └─ clear() — wipes on disconnect                  │
│                                                         │
│  IPC handlers read from cache (sync, no MSP calls)      │
│  Mutation handlers invalidate cache after writes        │
└─────────────────────────────────────────────────────────┘
```

### Layer 1: FCStateCache (Main Process)

**New file: `src/main/fc/FCStateCache.ts`**

A centralized in-memory cache holding all FC state, populated atomically on connect, with granular invalidation after mutations.

#### State Shape

```typescript
export interface FCState {
  info: FCInfo | null;
  statusEx: { pidProfileIndex: number; pidProfileCount: number } | null;
  pidConfig: PIDConfiguration | null;
  filterConfig: CurrentFilterSettings | null;
  feedforwardConfig: FeedforwardConfiguration | null;
  ratesConfig: RatesConfiguration | null;
  tuningConfig: Record<string, number> | null;  // MSP_PID_ADVANCED advanced fields (PR #427)
  blackboxInfo: BlackboxInfo | null;
  blackboxSettings: BlackboxSettings | null;     // CLI-only: parsed from baseline snapshot CLI diff
  hydratedAt: string | null;                     // ISO timestamp of last full hydration
  hydrating: boolean;                            // True during MSP reads
}

export type FCStateSlice = keyof Omit<FCState, 'hydratedAt' | 'hydrating'>;
```

**Data source classification:**

| Slice | Source | Notes |
|-------|--------|-------|
| info | MSP (getFCInfo) | Board, version, craftName, PID profile index/count |
| statusEx | MSP (getStatusEx) | Active PID profile index |
| pidConfig | MSP (getPIDConfiguration) | P/I/D per axis |
| filterConfig | MSP (getFilterConfiguration) | LPF, notch, RPM, dynamic lowpass |
| feedforwardConfig | MSP (getFeedforwardConfiguration) | FF gains, d_min, iterm_relax — reads MSP_PID_ADVANCED |
| ratesConfig | MSP (getRatesConfiguration) | Rates type, per-axis settings |
| tuningConfig | MSP (getTuningConfig) | anti_gravity, TPA, vbat_sag, thrust_linear, idle_min_rpm — reads MSP_PID_ADVANCED |
| blackboxInfo | MSP (getBlackboxInfo) | Storage type, used/free size, hasLogs |
| blackboxSettings | **CLI-only** (baseline snapshot) | debug_mode, logging_rate — NOT readable via MSP |

**CLI-only settings** (`simplified_dmax_gain`, `tpa_low_always`) are in BF CLI but NOT in any MSP command. These are applied/restored via CLI `set` commands and readable only from snapshot CLI diff. They are NOT cached — the app reads them from the latest snapshot when needed.

**MSP_PID_ADVANCED constraint**: `feedforwardConfig` and `tuningConfig` both read from MSP command 94 (MSP_PID_ADVANCED). MSP responseQueue is keyed by command ID, so concurrent reads collide. These MUST be called sequentially during hydration.

#### Cache API

```typescript
class FCStateCache extends EventEmitter {
  // Populate all slices from FC (called once after connect)
  async hydrate(mspClient: MSPClient): Promise<void>;

  // Synchronous read — returns cached value or null
  get<K extends FCStateKey>(key: K): FCState[K];
  getAll(): Readonly<FCState>;

  // Re-read specific slices from FC after mutations
  async invalidate(keys: FCStateKey[], mspClient: MSPClient): Promise<void>;

  // Wipe all cached data (called on disconnect)
  clear(): void;

  // Check if cache has been populated
  isHydrated(): boolean;

  // Events: 'state-changed' with { key: FCStateKey, value: any }
}
```

#### Hydration Sequence

Called once after baseline creation + smart reconnect completes in `src/main/index.ts`:

```
1. getFCInfo()                    → cache.info           (must be first — apiVersion needed)
2. getStatusEx(apiVersion)        → cache.statusEx       (PID profile index)
3. Promise.all([                                         (parallel — different MSP commands)
     getPIDConfiguration(),       → cache.pidConfig
     getFilterConfiguration(),    → cache.filterConfig
     getRatesConfiguration(),     → cache.ratesConfig
     getBlackboxInfo(),           → cache.blackboxInfo
   ])
4. getFeedforwardConfiguration()  → cache.feedforwardConfig  (SEQUENTIAL — MSP_PID_ADVANCED)
5. getTuningConfig()              → cache.tuningConfig       (SEQUENTIAL — MSP_PID_ADVANCED)
6. readBBSettingsFromSnapshot()   → cache.blackboxSettings   (CLI-only, from baseline)
```

Total: 8 MSP commands + 1 snapshot read, ~600ms one-time cost on connect. After this, all reads are instant from cache.

**BlackboxSettings special case**: Read from baseline snapshot CLI diff (not MSP), so populated separately after baseline creation. Cached as `blackboxSettings`.

#### Guards

**CLI mode guard**: `invalidate()` checks `mspClient.connection.isInCLI()` before issuing MSP reads. If CLI mode is active, skips the read and logs a warning. This prevents timeout race conditions during baseline export or snapshot restore.

**Flash→none guard**: After erase, MSP may transiently return `storageType='none'` before dataflash subsystem reinitializes. `invalidate(['blackboxInfo'])` preserves the previous `storageType` if the new value is `'none'` but previous was `'flash'`, updating only `usedSize=0` and `hasLogs=false`.

#### Snapshot Optimization (PR #422 synergy)

PR #422 introduced MSP-based snapshot capture — `SnapshotManager.createSnapshot()` now reads PID, filter, FF, and rates config via MSP **before** `exportCLIDiff()` (which enters CLI and reboots FC). These 4 reads are done via `Promise.all()` on lines 49-54 of `SnapshotManager.ts`.

With FCStateCache, `createSnapshot()` can read these values **from cache** instead of 4 additional MSP calls:

```typescript
// Before (current): 4 MSP reads + CLI diff + reboot
[pidConfig, filterConfig, feedforwardConfig, ratesConfig] = await Promise.all([
  this.mspClient.getPIDConfiguration(),       // MSP read
  this.mspClient.getFilterConfiguration(),    // MSP read
  this.mspClient.getFeedforwardConfiguration(), // MSP read
  this.mspClient.getRatesConfiguration(),     // MSP read
]);

// After (with cache): 0 MSP reads, instant from memory
const cached = this.fcStateCache.getAll();
pidConfig = cached.pidConfig ?? undefined;
filterConfig = cached.filterConfig ?? undefined;
feedforwardConfig = cached.feedforwardConfig ?? undefined;
ratesConfig = cached.ratesConfig ?? undefined;
```

This eliminates ~200ms of MSP I/O before every snapshot creation.

Similarly, `restoreSnapshot()` (which writes MSP data back after CLI restore) should invalidate all cache slices after completion, since the FC state has been completely overwritten.

#### Invalidation Matrix

| Mutation Action | Invalidated Slices | Method |
|---|---|---|
| Connect / reconnect | ALL | `hydrate()` (full re-read) |
| Disconnect | ALL | `clear()` (reset to null) |
| Erase flash | `blackboxInfo` | `invalidate(['blackboxInfo'])` |
| Download BB log | `blackboxInfo` | `invalidate(['blackboxInfo'])` |
| PID profile switch | `pidConfig`, `filterConfig`, `feedforwardConfig`, `ratesConfig`, `tuningConfig`, `statusEx` | `invalidate([...])` |
| Apply recommendations (reboot) | ALL | Auto via reconnect → `hydrate()` |
| Snapshot restore (reboot) | ALL | Auto via reconnect → `hydrate()` |
| Fix BB settings (reboot) | ALL | Auto via reconnect → `hydrate()` |
| Wipe profile (PR #419) | N/A (disk only) | Cache unchanged |

### Layer 2: IPC Event Propagation

**New IPC channel: `EVENT_FC_STATE_CHANGED`**

When cache changes (hydrate or invalidate), FCStateCache emits to renderer:

```typescript
// In events.ts
export function sendFCStateChanged(
  window: BrowserWindow,
  key: FCStateKey | 'all',
  state: Partial<FCState>
): void {
  window.webContents.send(IPCChannel.EVENT_FC_STATE_CHANGED, key, state);
}
```

**New IPC handler: `FC_GET_STATE`**

Synchronous read of entire cached state (used on renderer mount):

```typescript
// In fcInfoHandlers.ts
ipcMain.handle(IPCChannel.FC_GET_STATE, () => {
  return createResponse(deps.fcStateCache?.getAll() ?? null);
});
```

### Layer 3: useFCState Hook (Renderer)

**New file: `src/renderer/hooks/useFCState.ts`**

Single React hook providing all FC data to components:

```typescript
export function useFCState(): FCState {
  const [state, setState] = useState<FCState>(EMPTY_FC_STATE);

  useEffect(() => {
    // Initial load from cache
    window.betaflight.getFCState().then((cached) => {
      if (cached) setState(cached);
    });

    // Subscribe to cache changes (push from main)
    const unsub = window.betaflight.onFCStateChanged((key, newState) => {
      if (key === 'all') {
        setState(newState as FCState);
      } else {
        setState((prev) => ({ ...prev, [key]: newState[key] }));
      }
    });

    // Clear on disconnect
    const unsubConn = window.betaflight.onConnectionChanged((status) => {
      if (!status.connected) {
        setState(EMPTY_FC_STATE);
      }
    });

    return () => { unsub(); unsubConn(); };
  }, []);

  return state;
}
```

### Layer 4: Preload Bridge

**Modified: `src/preload/index.ts`**

```typescript
getFCState: () => ipcRenderer.invoke(IPCChannel.FC_GET_STATE),
onFCStateChanged: (callback) => {
  const handler = (_event, key, state) => callback(key, state);
  ipcRenderer.on(IPCChannel.EVENT_FC_STATE_CHANGED, handler);
  return () => ipcRenderer.removeListener(IPCChannel.EVENT_FC_STATE_CHANGED, handler);
},
```

## Implementation (single PR)

Implementation in bottom-up order — tests pass at each step.

### Step 1: Types + cache class + tests

- Create `src/shared/types/fcState.types.ts` — FCState interface, FCStateSlice type
- Create `src/main/cache/FCStateCache.ts` (~250 lines) — Cache class with hydrate/invalidate/clear
- Create `src/main/cache/FCStateCache.test.ts` (~15 tests)

### Step 2: IPC plumbing

- Add `FC_GET_STATE`, `EVENT_FC_STATE_CHANGED` to `src/shared/types/ipc.types.ts`
- Add `getFCState()`, `onFCStateChanged()` to `BetaflightAPI` and preload bridge
- Add `sendFCStateChanged()` to `src/main/ipc/handlers/events.ts`
- Add `fcStateCache` to `HandlerDependencies`
- Register `FC_GET_STATE` handler in `src/main/ipc/handlers/index.ts`

### Step 3: Hydration lifecycle

- Instantiate `FCStateCache` in `src/main/index.ts`
- Replace post-connect MSP reads with `cache.hydrate()`
- Call `cache.clear()` on disconnect
- Remove `suppressConnectEvent` pattern (cache push replaces final re-emit)

### Step 4: Handler migration (read path)

- `BLACKBOX_GET_INFO` → read from cache with MSP fallback
- `FC_GET_INFO` → read from cache with MSP fallback
- `FC_GET_BLACKBOX_SETTINGS` → read from cache with snapshot fallback
- `PID_GET_CONFIG` → read from cache with MSP fallback

### Step 5: Handler migration (write path)

- `BLACKBOX_ERASE_FLASH` → `invalidate(['blackboxInfo'])` after erase
- `BLACKBOX_DOWNLOAD_LOG` → `invalidate(['blackboxInfo'])` after download
- `FC_SELECT_PID_PROFILE` → `invalidate(['pidConfig', 'filterConfig', ...])` after switch

### Step 6: useFCState hook + renderer migration

- Create `src/renderer/hooks/useFCState.ts` (~60 lines)
- Create `src/renderer/hooks/useFCState.test.ts` (~6 tests)
- Migrate `App.tsx`:
  - Remove 7 state vars: `flashUsedSize`, `storageType`, `storageTypeRef`, `bbSettings`, `fcVersion`, `connectedFcInfo`, `bbRefreshKey`
  - Remove 2 functions: `refreshBlackboxInfo()`, `fetchBBSettings()`
  - Replace with `const fcState = useFCState();`
  - Update all JSX props to use `fcState.*`

### Step 7: Optimizations + cleanup

- `SnapshotManager.createSnapshot()`: read MSP config from cache instead of 4 MSP calls
- `MockMSPClient`: add `getStatusEx()` if missing
- Update `src/renderer/test/setup.ts` with new mocks
- Simplify `useBlackboxInfo` (thin wrapper around `useFCState().blackboxInfo`)

### Step 8: E2E validation

- Run `npm run test:e2e` — all 37 E2E tests must pass
- Run `npm run test:run` — all 3076+ unit tests must pass

## Bug Fix Mapping

| Bug | Root Cause | How Cache Fixes It |
|---|---|---|
| BB status incorrect | `useBlackboxInfo` + `App.refreshBlackboxInfo()` + `TuningStatusBanner` each fetch independently, race on results | Single cache slice pushed to all consumers simultaneously via `EVENT_FC_STATE_CHANGED` |
| PID profile missing | `statusEx.pidProfileIndex` read only during connect, lost on reconnect | Cache holds `statusEx`, re-hydrated on every reconnect, pushed to renderer |
| Erase step skipped | Phase transition fires before `getBlackboxInfo()` returns | Cache `invalidate(['blackboxInfo'])` awaited before phase update; UI reads from already-updated cache |
| Download button missing | `flashUsedSize` is stale after reconnect (still null from disconnect) | Cache hydrate reads fresh `blackboxInfo` on reconnect, pushes to UI before any phase logic |

## Testing Strategy

### Unit Tests (`src/main/cache/FCStateCache.test.ts`, ~15 tests)

- `hydrate()` reads all MSP values and populates state
- `hydrate()` respects sequential MSP_PID_ADVANCED constraint
- `hydrate()` handles partial MSP failure gracefully
- `hydrate()` sets `hydrating` flag during reads
- `invalidate(['blackboxInfo'])` re-reads only blackbox info
- `invalidate()` skips when CLI mode active (guard)
- `invalidate(['blackboxInfo'])` preserves storageType on flash→none transition (guard)
- `clear()` resets all slices to null
- `getState()` returns immutable copy
- `getSlice()` returns correct slice value
- Emits `state-changed` event on hydrate, invalidate, clear

### Hook Tests (`src/renderer/hooks/useFCState.test.ts`, ~6 tests)

- Returns empty state before hydration
- Hydrates from `getFCState()` on mount
- Updates on `onFCStateChanged` event
- Returns correct typed slice values
- Handles unmount cleanup (no memory leak)

### E2E Validation (existing 37 tests)

Existing Playwright E2E tests run the full tuning workflow in demo mode. The cache is transparent to the E2E layer — tests validate UI outcomes (button states, phase transitions, toasts), not implementation details. All 37 tests must pass after migration without modification.
- Apply → verify invalidated slices re-read → verify UI updated
- Erase → verify blackboxInfo updated → verify BB status panel correct
- Reconnect after reboot → verify full re-hydration

### E2E Tests

Existing Playwright E2E tests (`e2e/tuning-*.spec.ts`) cover the full tuning workflow. These should pass unchanged after migration, validating that the cache layer doesn't break existing behavior.

## Recent PR Context

These recently merged PRs are relevant to the cache design:

| PR | Change | Cache Impact |
|---|---|---|
| **#422** — MSP snapshot capture | `createSnapshot()` reads PID/filter/FF/rates via MSP before CLI diff | Cache eliminates these 4 MSP reads (instant from memory) |
| **#422** — `saveToEEPROM()` | New `MSPClient.saveToEEPROM()` writes MSP data without reboot | After EEPROM write during restore, invalidate affected slices |
| **#422** — Restore via MSP | `restoreSnapshot()` writes PID config back via MSP after CLI restore | Invalidate ALL slices after restore (FC state fully overwritten) |
| **#418** — BB log disk deletion | `BlackboxManager.deleteLog()` propagates filesystem errors | No cache impact (disk-only operation, not FC state) |
| **#419** — Wipe Profile | Profile data wipe (logs, snapshots, sessions) | No cache impact (disk-only, cache remains valid) |
| **#415** — Convergence detection | Previous session enrichment in `TUNING_UPDATE_PHASE` | No cache impact (reads tuning history, not FC) |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cache stale after unexpected FC reboot | Medium | High | Every reconnect triggers full re-hydrate |
| Hydration failure (MSP timeout) | Low | Medium | Fallback to direct MSP read in IPC handlers |
| Breaking existing tests | Medium | Medium | Incremental migration with backward-compatible wrappers |
| CLI diff for BB settings outside MSP | N/A | N/A | BB settings populated from snapshot, not MSP — handled separately |
| Performance regression from bulk read | Low | Low | 7 MSP commands ~500ms — already similar to current scattered reads |

## Files Modified (Summary)

### New Files
- `src/main/fc/FCStateCache.ts`
- `src/main/fc/FCStateCache.test.ts`
- `src/renderer/hooks/useFCState.ts`
- `src/renderer/hooks/useFCState.test.ts`

### Modified Files
- `src/main/ipc/handlers/types.ts` — add `fcStateCache` to deps
- `src/main/ipc/handlers/index.ts` — init + setter
- `src/main/index.ts` — wire hydrate/clear, simplify reconnect
- `src/shared/types/ipc.types.ts` — new channels
- `src/preload/index.ts` — new bridge methods
- `src/renderer/App.tsx` — remove ~15 state vars, use useFCState()
- `src/renderer/components/BlackboxStatus/BlackboxStatus.tsx` — use useFCState()
- `src/renderer/components/TuningStatusBanner/TuningStatusBanner.tsx` — use useFCState()
- `src/renderer/components/FCInfo/FCInfoDisplay.tsx` — use useFCState()
- `src/main/ipc/handlers/fcInfoHandlers.ts` — read from cache
- `src/main/ipc/handlers/blackboxHandlers.ts` — read from cache, invalidate after erase
- `src/main/ipc/handlers/tuningHandlers.ts` — invalidate after apply
- `src/main/ipc/handlers/snapshotHandlers.ts` — full re-hydrate after restore
- `src/main/storage/SnapshotManager.ts` — read MSP config from cache instead of 4 MSP calls (PR #422 optimization)
