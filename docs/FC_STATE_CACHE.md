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
  statusEx: StatusExData | null;
  pidConfig: PIDConfiguration | null;
  filterConfig: CurrentFilterSettings | null;
  feedforwardConfig: FeedforwardConfiguration | null;
  blackboxInfo: BlackboxInfo | null;
  blackboxSettings: BlackboxSettings | null;
  ratesConfig: RatesConfiguration | null;
}

export type FCStateKey = keyof FCState;
```

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

Called once after `MSPClient.connect()` completes successfully:

```
1. getFCInfo()              → cache.info
2. getStatusEx()            → cache.statusEx
3. getPIDConfiguration()    → cache.pidConfig
4. getFilterConfiguration() → cache.filterConfig
5. getFeedforwardConfig()   → cache.feedforwardConfig
6. getBlackboxInfo()        → cache.blackboxInfo
7. getRatesConfiguration()  → cache.ratesConfig
```

Total: ~7 MSP commands, ~500ms one-time cost on connect. After this, all reads are instant from cache.

**BlackboxSettings special case**: Read from baseline snapshot CLI diff (not MSP), so populated separately after baseline creation. Cached as `blackboxSettings`.

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

| Mutation Action | Invalidated Slices | Trigger |
|---|---|---|
| Apply recommendations | `pidConfig`, `filterConfig`, `feedforwardConfig`, `statusEx` | After `saveAndReboot()` + reconnect |
| Erase flash | `blackboxInfo` | After erase completes |
| Fix BB settings | `blackboxSettings`, `blackboxInfo` | After `saveAndReboot()` + reconnect |
| PID profile switch | `pidConfig`, `filterConfig`, `feedforwardConfig`, `statusEx`, `ratesConfig` | After MSP_SELECT_SETTING + reconnect |
| Snapshot restore | ALL slices | Full re-hydrate after reboot |
| Wipe profile (PR #419) | N/A (disk only) | Cache unchanged — wipe only deletes logs/snapshots on disk, not FC state |
| Reconnect (any) | ALL slices | Full re-hydrate |

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

## Implementation Phases

### Phase 1: Core Cache Infrastructure

**Goal**: Introduce FCStateCache without changing any existing behavior.

1. Create `src/main/fc/FCStateCache.ts` with full implementation
2. Create `src/main/fc/FCStateCache.test.ts` with unit tests
3. Add `fcStateCache` to `HandlerDependencies`
4. Add new IPC channels to `ipc.types.ts`
5. Wire hydrate/clear in `src/main/index.ts` connect/disconnect handlers
6. Add preload bridge methods

**Deliverable**: Cache populates on connect, clears on disconnect. No consumers yet — existing code unchanged.

### Phase 2: useFCState Hook + Renderer Migration

**Goal**: Components consume from cache instead of independent IPC calls.

1. Create `src/renderer/hooks/useFCState.ts` + tests
2. Migrate `BlackboxStatus` to use `useFCState().blackboxInfo`
3. Migrate `TuningStatusBanner` to use `useFCState().blackboxInfo` and `useFCState().statusEx`
4. Migrate `FCInfoDisplay` to use `useFCState().info`
5. Simplify `App.tsx`:
   - Remove: `flashUsedSize`, `storageType`, `storageTypeRef`, `bbRefreshKey`
   - Remove: `refreshBlackboxInfo()`, `fetchBBSettings()`
   - Remove: `fcVersion`, `connectedFcInfo`, `bbSettings`
   - Replace with single `useFCState()` call

**Deliverable**: All FC data consumed from single hook. ~15 state variables removed from App.tsx.

### Phase 3: Handler Migration (Read Path)

**Goal**: IPC handlers serve data from cache instead of MSP reads.

1. `FC_GET_INFO` → read from `cache.get('info')` (fallback to MSP if not hydrated)
2. `BLACKBOX_GET_INFO` → read from `cache.get('blackboxInfo')`
3. `PID_GET` → read from `cache.get('pidConfig')`
4. `FC_GET_BLACKBOX_SETTINGS` → read from `cache.get('blackboxSettings')`

**Fallback pattern** (for safety during migration):
```typescript
const cached = deps.fcStateCache?.get('blackboxInfo');
if (cached) return createResponse(cached);
// Fallback: direct MSP read
return createResponse(await deps.mspClient.getBlackboxInfo());
```

### Phase 4: Handler Migration (Write Path)

**Goal**: Mutation handlers invalidate cache after FC writes.

1. `APPLY_RECOMMENDATIONS` → after `saveAndReboot()` + reconnect → `cache.invalidate(['pidConfig', 'filterConfig', 'feedforwardConfig', 'statusEx'])`
2. `ERASE_FLASH` → after erase completes → `cache.invalidate(['blackboxInfo'])`
3. `FIX_BLACKBOX_SETTINGS` → after reboot → `cache.invalidate(['blackboxSettings', 'blackboxInfo'])`
4. `SNAPSHOT_RESTORE` → after reboot → `cache.hydrate()` (full re-read)

### Phase 5: Smart Reconnect Simplification

**Goal**: Remove timing hacks that are no longer needed.

1. Remove `suppressConnectEvent` flag in `src/main/index.ts`
2. Remove blackbox info 2-second retry delay
3. Remove `storageTypeRef` hack in `App.tsx`
4. Remove `bbRefreshKey` external refresh mechanism
5. Smart reconnect reads from cache (already populated by hydrate)

### Phase 6: Deprecate Old Hooks

**Goal**: Clean up redundant hooks.

1. `useBlackboxInfo` → thin wrapper around `useFCState().blackboxInfo` (for backward compat)
2. Eventually remove entirely and update all consumers
3. Remove unused IPC handlers that only served individual data reads

## Bug Fix Mapping

| Bug | Root Cause | How Cache Fixes It |
|---|---|---|
| BB status incorrect | `useBlackboxInfo` + `App.refreshBlackboxInfo()` + `TuningStatusBanner` each fetch independently, race on results | Single cache slice pushed to all consumers simultaneously via `EVENT_FC_STATE_CHANGED` |
| PID profile missing | `statusEx.pidProfileIndex` read only during connect, lost on reconnect | Cache holds `statusEx`, re-hydrated on every reconnect, pushed to renderer |
| Erase step skipped | Phase transition fires before `getBlackboxInfo()` returns | Cache `invalidate(['blackboxInfo'])` awaited before phase update; UI reads from already-updated cache |
| Download button missing | `flashUsedSize` is stale after reconnect (still null from disconnect) | Cache hydrate reads fresh `blackboxInfo` on reconnect, pushes to UI before any phase logic |

## Testing Strategy

### Unit Tests (`FCStateCache.test.ts`)

- `hydrate()` reads all 7 MSP values and stores them
- `get()` returns cached values synchronously
- `invalidate()` re-reads only specified keys
- `clear()` resets all to null
- Events emitted on hydrate, invalidate, clear
- Fallback: returns null for unhydrated keys
- Error handling: partial hydration failure doesn't corrupt existing state

### Hook Tests (`useFCState.test.ts`)

- Returns empty state before hydration
- Populates from `getFCState()` on mount
- Updates on `EVENT_FC_STATE_CHANGED` event
- Clears on disconnect
- Multiple components share same data (no independent fetches)

### Integration Tests

- Connect → verify cache hydrated → disconnect → verify cache cleared
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
