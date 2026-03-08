# Offline UX Testing Mode

> **Status**: Complete (Tasks 1–6 done, 25 Playwright E2E tests)

## Problem

Testing the full tuning workflow UX requires:
1. A real flight controller connected via USB
2. Actual test flights with blackbox recording
3. Downloading blackbox data from flash/SD card
4. Waiting for FC reboots after apply/save operations

This makes it impossible to test UX changes while offline (e.g., traveling without hardware). Many UX issues are only discoverable by clicking through the entire 10-phase tuning workflow, which requires real flights.

## Solution: Demo Mode

A `DEMO_MODE=true` environment variable that boots the app with a simulated flight controller and pre-populated demo data. The real Electron app runs normally — only the MSP layer is replaced with a mock that returns realistic responses, and demo blackbox logs are generated for realistic analysis.

### What Demo Mode Provides

- **Simulated FC connection**: Auto-connects to a virtual "Demo FC" on startup
- **Pre-created demo profile**: 5" freestyle quad with realistic settings
- **Demo blackbox logs**: Generated from `bf45-reference.ts` fixture, parseable by real `BlackboxParser`
- **Real analysis**: `FilterAnalyzer` and `PIDAnalyzer` run on demo data (real FFT, real step detection)
- **Simulated apply**: `applyRecommendations` succeeds without MSP commands, simulates reboot delay
- **Full state machine**: All 10 tuning phases work, including verification and history archival
- **Demo snapshots**: Baseline and auto-snapshots created with realistic CLI diff data

### What Demo Mode Does NOT Change

- All renderer components run unmodified
- All storage managers (profile, snapshot, session, history) use real file I/O
- Blackbox parser and analysis engines run real computation
- Event system works normally (IPC events broadcast to renderer)

## Architecture

### Entry Point

```
npm run dev:demo         # Development (sets DEMO_MODE=true env var)
./app --demo             # Production (CLI flag fallback)
```

Demo mode is detected in `src/main/index.ts` via `process.env.DEMO_MODE === 'true'` (dev) or `process.argv.includes('--demo')` (production fallback). The env var approach is required because `vite-plugin-electron` does not forward CLI args to the Electron process.

### MockMSPClient

A new class `src/main/demo/MockMSPClient.ts` that implements the same interface as `MSPClient` but returns static/simulated data:

| Method | Mock Behavior |
|--------|--------------|
| `listPorts()` | Returns `[{ path: '/dev/demo', manufacturer: 'Demo' }]` |
| `connect()` | Sets connected=true, emits 'connected' after 500ms delay |
| `disconnect()` | Sets connected=false, emits 'disconnected' |
| `isConnected()` | Returns connection state |
| `getFCInfo()` | Returns demo FC info (BTFL 4.5.1, STM32F405) |
| `getFCSerialNumber()` | Returns `'DEMO-001'` |
| `getBlackboxInfo()` | Returns flash storage with simulated used/total size |
| `getFilterConfiguration()` | Returns BF 4.5 default filter settings |
| `getPIDConfiguration()` | Returns standard 5" PID values |
| `setPIDConfiguration()` | No-op, logs to console |
| `downloadBlackboxLog()` | Returns pre-generated demo BBL buffer |
| `eraseBlackboxFlash()` | No-op, resets simulated flash state |
| `saveAndReboot()` | Simulates disconnect → 2s delay → reconnect |
| `exportCLIDiff()` | Returns realistic CLI diff string |
| `getConnectionStatus()` | Returns current status |

### DemoDataGenerator

`src/main/demo/DemoDataGenerator.ts` — generates demo data on first boot:

1. **Demo BBL log**: Uses `buildReferenceFixture()` but with enhanced data:
   - More frames (500+ per session) for meaningful FFT analysis
   - Noise injection (motor harmonics at ~150Hz, electrical at ~600Hz)
   - Step inputs in setpoint data (for PID analysis)
   - Realistic throttle variation (hover ~1500, sweeps 1200-1800)

2. **Demo CLI diff**: Realistic `diff` output with common BF 4.5 settings

3. **Demo FC info**: STM32F405 board, BF 4.5.1, API 1.46

### Integration Point

In `src/main/index.ts`, the `initialize()` function checks for demo mode:

```typescript
async function initialize(): Promise<void> {
  const isDemoMode = process.env.DEMO_MODE === 'true' || process.argv.includes('--demo');

  if (isDemoMode) {
    mspClient = new MockMSPClient() as any;
    // Generate demo data after managers are initialized
  } else {
    mspClient = new MSPClient();
  }

  // ... rest of initialization unchanged ...

  if (isDemoMode) {
    // Auto-trigger connection after window is ready
    setTimeout(() => mspClient.simulateConnect(), 1000);
  }
}
```

### npm Script

```json
{
  "scripts": {
    "dev:demo": "DEMO_MODE=true vite"
  }
}
```

## Implementation Plan

### Task 1: MockMSPClient :white_check_mark:
- `src/main/demo/MockMSPClient.ts` — EventEmitter-based mock FC
- Static responses for all read operations, simulated delays, mock CLI mode
- Flight type cycling (`filter` → `pid` → `verification`), progressive noise reduction across cycles
- `advancePastVerification()` for multi-cycle support when verification is skipped
- 47 unit tests

### Task 2: DemoDataGenerator :white_check_mark:
- `src/main/demo/DemoDataGenerator.ts` — Enhanced BBL fixture with noise + step inputs
- Multi-session support (filter + PID in one BBL file)
- Progressive noise reduction across tuning cycles
- 22 unit tests

### Task 3: Integration in index.ts :white_check_mark:
- Demo mode via `DEMO_MODE` env var or `--demo` CLI flag
- MockMSPClient swapped in, auto-connect after window ready
- `E2E_USER_DATA_DIR` env var for Playwright test isolation
- `dev:demo` npm script

### Task 4: Demo Profile Auto-Setup :white_check_mark:
- Auto-creates "Demo Quad (5" Freestyle)" profile on first demo connect
- Baseline snapshot with demo CLI diff
- Pre-populated blackbox log

### Task 5: Unit Tests :white_check_mark:
- MockMSPClient: 47 tests
- DemoDataGenerator: 22 tests

### Task 6: Playwright E2E Tests :white_check_mark:
- `e2e/electron-app.ts` — Shared fixture with launchDemoApp, isolated userData
- `demo-smoke.spec.ts` — 4 smoke tests (launch, connect, dashboard)
- `demo-tuning-cycle.spec.ts` — 11 serial tests (complete tuning cycle)
- `demo-generate-history.spec.ts` — 5-cycle generator for demo screenshots

## Playwright E2E Tests

Automated end-to-end tests that launch the real Electron app in demo mode using Playwright's Electron support.

### Running E2E Tests

```bash
# Run all E2E tests (builds app first)
npm run test:e2e

# Run with Playwright UI
npm run test:e2e:ui

# Generate 5 tuning sessions for demo screenshots (~2 min)
npm run demo:generate-history
```

### Test Architecture

**Fixture** (`e2e/electron-app.ts`):
- `launchDemoApp()` — Launches Electron with `DEMO_MODE=true` and isolated `E2E_USER_DATA_DIR`
- Wipes `.e2e-userdata/` before each test file for clean state
- Helpers: `waitForDemoReady()`, `clickButton()`, `waitForText()`, `screenshot()`

**Test Files:**

| File | Tests | Description |
|------|-------|-------------|
| `demo-smoke.spec.ts` | 4 | App launch, auto-connect, dashboard elements |
| `demo-tuning-cycle.spec.ts` | 11 | Full tuning cycle (serial test suite): start → erase → download → filter wizard → apply → PID wizard → apply → skip verify → complete → dismiss |
| `demo-generate-history.spec.ts` | 1 | Generates 5 completed tuning sessions with progressive quality scores (excluded from `test:e2e`, run via `demo:generate-history`) |

**Key Design Decisions:**
- Tests use `test.describe.serial` — the tuning cycle tests must run in order as each step depends on the previous
- `E2E_USER_DATA_DIR` env var overrides Electron's `app.setPath('userData', ...)` for test isolation
- `waitForDemoReady()` waits for the "Start Tuning Session" button (most reliable full-dashboard indicator)
- Screenshots saved to `e2e-screenshots/` for visual review
- `--grep-invert 'generate 5'` in `test:e2e` excludes the slow generator from normal test runs
- `advancePastVerification()` in `MockMSPClient` keeps flight type cycling correct when verification is skipped across multiple tuning cycles

### MockMSPClient Flight Type Tracking

The `MockMSPClient` tracks which type of blackbox data to generate: `filter` → `pid` → `verification` → (cycle repeats). When verification is skipped (the common demo path), `advancePastVerification()` must be called to advance the cycle, otherwise the next tuning session generates wrong data types.

This is called automatically in `tuningHandlers.ts` when the phase transitions to `completed` in demo mode.

## Risk Assessment

**Low risk** — Demo mode is completely isolated:
- Only activated by explicit `DEMO_MODE=true` env var or `--demo` CLI flag
- No changes to production code paths (just an `if` branch in `initialize()`)
- All new code in `src/main/demo/` directory
- Real storage managers used (data persists between demo sessions in separate location if needed)

## Files

| File | Status |
|------|--------|
| `src/main/demo/MockMSPClient.ts` | Created (47 tests) |
| `src/main/demo/MockMSPClient.test.ts` | Created |
| `src/main/demo/DemoDataGenerator.ts` | Created (22 tests) |
| `src/main/demo/DemoDataGenerator.test.ts` | Created |
| `src/main/index.ts` | Modified (demo mode branch + E2E_USER_DATA_DIR) |
| `src/main/ipc/handlers/tuningHandlers.ts` | Modified (advancePastVerification on completion) |
| `e2e/electron-app.ts` | Created (shared E2E fixture) |
| `e2e/demo-smoke.spec.ts` | Created (4 tests) |
| `e2e/demo-tuning-cycle.spec.ts` | Created (11 tests) |
| `e2e/demo-generate-history.spec.ts` | Created (1 test) |
| `playwright.config.ts` | Created |
| `package.json` | Modified (test:e2e, demo:generate-history scripts) |
| `vitest.config.ts` | Modified (exclude e2e/) |
| `.gitignore` | Modified (E2E artifacts) |
| `docs/OFFLINE_UX_TESTING.md` | Created (this doc) |
