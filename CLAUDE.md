# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Detailed architecture docs are split into subdirectory CLAUDE.md files** — they load automatically when you work in those directories:
- `src/main/CLAUDE.md` — Storage, apply flow, snapshot restore, SD card, smart reconnect
- `src/main/analysis/CLAUDE.md` — FFT, step response, transfer function, data quality scoring
- `src/main/blackbox/CLAUDE.md` — BBL parser encoding/predictor/frame details
- `src/main/msp/CLAUDE.md` — MSP protocol, CLI prompt detection, BF version compatibility
- `src/renderer/CLAUDE.md` — UI components: Analysis Overview, Tuning Wizard, charts, history
- `e2e/CLAUDE.md` — Playwright E2E test architecture and common pitfalls

## Project Overview

FPVPIDlab is an Electron-based desktop application for managing FPV drone PID configurations. It uses MSP (MultiWii Serial Protocol) to communicate with Betaflight flight controllers over USB serial connection.

**Current Phase**: Phase 4 complete, Phase 6 complete (CI/CD, code quality, data quality scoring, flight quality score)

**Tech Stack**: Electron + TypeScript + React + Vite + serialport + fft.js

## Development Commands

```bash
npm run dev          # Start dev server + Electron + debug server (:9300)
npm run dev:demo     # Start with simulated FC (no hardware needed)
npm test             # Unit tests (watch mode)
npm run test:run     # Unit tests once (pre-commit)
npm run test:e2e     # Playwright E2E tests (builds first)
npm run build        # Production build
npm run rebuild      # Rebuild native modules (serialport)
```

Full command reference (demo data generation, code quality, E2E UI, etc.): [QUICK_START.md](./QUICK_START.md)

### Debug Server

Both `npm run dev` and `npm run dev:demo` start with `DEBUG_SERVER=true`, which launches an HTTP debug server on `http://127.0.0.1:9300`. The server exposes app state for tooling integration (e.g., Claude Code).

**Read-only endpoints (GET):**

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check (PID, uptime) |
| `GET /state` | Connection, profile, tuning session, blackbox info |
| `GET /screenshot` | Capture renderer screenshot (saves PNG, returns path) |
| `GET /logs` | Last N lines from electron-log (`?n=100` for count) |
| `GET /console` | Renderer console messages (`?level=error` to filter) |
| `GET /msp` | MSP connection details, CLI mode, FC info, filter/PID config |
| `GET /tuning-history` | Completed tuning session records for current profile |
| `GET /tuning-session` | Active tuning session state |
| `GET /snapshots` | Configuration snapshots for current profile |
| `GET /blackbox-logs` | Downloaded blackbox logs for current profile |

**Action endpoints (POST) — for autonomous testing without UI:**

| Endpoint | Description |
|----------|-------------|
| `POST /connect?port=X` | Connect to FC (auto-selects first BF port if no param) |
| `POST /disconnect` | Disconnect from FC |
| `POST /start-tuning?mode=X` | Start tuning session (mode: filter, pid, flash) |
| `POST /reset-session` | Delete active tuning session |
| `POST /erase-flash` | Erase blackbox flash memory |
| `POST /restore-snapshot?id=X` | Restore a snapshot (backup param optional) |
| `POST /update-phase?phase=X` | Update tuning session phase (with logId params) |
| `POST /apply?logId=X&mode=Y` | Apply recommendations from analysis |
| `POST /open-wizard?logId=X&mode=Y` | Open tuning wizard UI |
| `POST /wait-connected?timeout=N` | Wait for FC connection (ms timeout) |
| `GET /analyze?logId=X` | Run full analysis pipeline on a BBL log |

**Configuration:**
- Controlled by `DEBUG_SERVER=true` environment variable (not active in production builds)
- Port override: `DEBUG_SERVER_PORT=9400` (default: 9300)
- Screenshots saved to `debug-screenshots/` (gitignored)
- Implementation: `src/main/debug/DebugServer.ts`

## Architecture

### Electron Process Model

**Main Process** (`src/main/`) — Entry point: `src/main/index.ts`. See `src/main/CLAUDE.md` for storage, apply flow, and restore details.

**Preload Script** (`src/preload/index.ts`) — Exposes `window.betaflight` API to renderer. Type-safe bridge using `@shared/types/ipc.types.ts`.

**Renderer Process** (`src/renderer/`) — React app with hooks. See `src/renderer/CLAUDE.md` for UI component details.

### IPC Architecture (Modular Handlers)

IPC handlers are split into domain modules under `src/main/ipc/handlers/`:

| Module | Handlers | Purpose |
|--------|----------|---------|
| `types.ts` | — | `HandlerDependencies` interface, `createResponse`, `parseDiffSetting` |
| `events.ts` | — | 7 event broadcast functions |
| `connectionHandlers.ts` | 8 | Port scanning, connect, disconnect, status, demo mode, reset demo, get logs, export logs |
| `fcInfoHandlers.ts` | 7 | FC info, CLI export, BB settings, FF config, fix settings, reset settings, BF PID profile selection |
| `snapshotHandlers.ts` | 6 | Snapshot CRUD, export, restore |
| `profileHandlers.ts` | 10 | Profile CRUD, presets, FC serial |
| `pidHandlers.ts` | 3 | PID get/set/save |
| `blackboxHandlers.ts` | 9 | Info, download, list, delete, erase, folder, test, parse, import |
| `analysisHandlers.ts` | 3 | Filter, PID, and transfer function analysis |
| `tuningHandlers.ts` | 8 | Apply, session CRUD (filter + pid + flash), history, update verification, update history verification |
| `telemetryHandlers.ts` | 3 | Telemetry settings get/set, manual upload trigger |
| `licenseHandlers.ts` | 4 | License activate, get status, remove, validate |
| `updateHandlers.ts` | 2 | Auto-update check, install |
| `diagnosticHandlers.ts` | 2 | Build and upload diagnostic report bundle + BBL upload + PATCH auto-report |
| `index.ts` | — | DI container, `registerIPCHandlers()` |

**Request-Response Pattern**: `IPCResponse<T> = { success: boolean, data?: T, error?: string }`

### Stateful Tuning Session

Three tuning modes: **Filter Tune**, **PID Tune**, **Flash Tune** (each: 2 flights — analysis + verification).

**TuningType**: `'filter' | 'pid' | 'flash'`

**State Machines**:
- Filter: `filter_flight_pending → filter_log_ready → filter_analysis → filter_applied → filter_verification_pending → completed`
- PID: `pid_flight_pending → pid_log_ready → pid_analysis → pid_applied → pid_verification_pending → completed`
- Flash: `flash_flight_pending → flash_log_ready → flash_analysis → flash_applied → flash_verification_pending → completed`

`TuningSessionManager` enforces legal forward-only transitions. Archive on completion to `TuningHistoryManager`.

## Testing Requirements

**Mandatory**: All UI changes require tests. Pre-commit hook enforces this.

**Important**: After adding or removing tests, update the test inventory in `TESTING.md`. Keep counts and file lists accurate.

### Test Coverage
- See `TESTING.md` for the authoritative test inventory (counts per file, descriptions)
- Test files are co-located with source: `Component.tsx` + `Component.test.tsx`

### Mock Setup
Tests use `src/renderer/test/setup.ts` which mocks `window.betaflight` API. Key points:
- Mock all API methods before each test with `vi.mocked(window.betaflight.method)`
- Mock event subscriptions return cleanup functions: `() => {}`
- Use `waitFor()` for async state updates
- Use `getByRole()` for accessibility-compliant queries

### Common Test Patterns
```typescript
// Component test
const user = userEvent.setup();
render(<Component />);
await waitFor(() => {
  expect(screen.getByText('Expected')).toBeInTheDocument();
});

// Hook test
const { result } = renderHook(() => useYourHook());
await waitFor(() => {
  expect(result.current.data).toBeDefined();
});
```

## Key Behaviors & Gotchas

### Connection Flow
1. **Port scanning** filters by Betaflight vendor IDs (fallback to all if none found)
2. **Auto port selection** - if selected port disappears, auto-select first available
3. **3-second cooldown** after disconnect to prevent "FC not responding" errors
4. **1-second backend delay** in disconnect for port release
5. **Port rescan** 1.5s after disconnect to detect new FC

### Profile Management
- **Cannot cancel ProfileWizard** - profile creation is mandatory for new FC
- **Active profile deletion** allowed - disconnects FC automatically
- **Profile switching** disabled when FC connected (UI lock with visual indicator)
- **Preset profiles** available in `@shared/constants.ts` (8 common drone types)

### Snapshot Behavior
- **Baseline** type cannot be deleted via UI
- **Auto-created baseline** when profile first connects
- **Server-side filtering** by current profile's snapshotIds
- **Dynamic numbering** `#1` (oldest) through `#N` (newest) — recalculates on deletion
- **Tuning metadata** on auto snapshots: `tuningSessionNumber`, `tuningType`, `snapshotRole`
- **Compare** smart matching: auto-selects pre/post-tuning pair from same session number
- **Corrupted config detection**: `detectCorruptedConfigLines()` scans for `###ERROR IN diff: CORRUPTED CONFIG:` markers

### BlackboxStatus Readonly Mode
- When tuning session active, `BlackboxStatus` enters readonly mode (`readonly={!!tuning.session}`)
- All actions driven by `TuningStatusBanner` (single point of action UX pattern)

### FC Info Blackbox Diagnostics
- `FCInfoDisplay` shows `debug_mode` and `logging_rate` with ✓/⚠ indicators
- Settings read from baseline snapshot CLI diff via `FC_GET_BLACKBOX_SETTINGS` IPC (not from live CLI)
- **Fix Settings button** + **TuningStatusBanner pre-flight check** during `*_flight_pending` phases
- Shared logic in `src/renderer/utils/bbSettingsUtils.ts`

### Event-Driven UI Updates
- `onConnectionChanged` → reload snapshots after connect, clear on disconnect
- `onProfileChanged` → reload snapshots for new profile, clear if null
- `onNewFCDetected` → show ProfileWizard modal

## Common Issues

### "FC not responding to MSP commands"
- Caused by immediate reconnect before port fully released
- Fixed with 3s cooldown + 1s backend delay

### Board name showing as target
- BoardName field may be empty/corrupted from FC → fallback to target name

### Tests failing with "not wrapped in act(...)"
- React state updates in tests need `waitFor()`

## Configuration & Constants

### Important Files
- `src/shared/constants.ts` - MSP codes, Betaflight vendor IDs, preset profiles, size defaults
- `src/shared/types/*.types.ts` - Shared type definitions
- `src/shared/constants/flightGuide.ts` - Flight guide phases, tips, and tuning workflow steps
- `src/shared/constants/metricTooltips.ts` - Chart descriptions and metric tooltip strings
- `src/main/analysis/constants.ts` - FFT thresholds, peak detection, safety bounds (tunable)
- `vitest.config.ts` - Test configuration with jsdom environment

### Size Defaults
When user selects drone size, defaults auto-populate (1" → 25g/19000KV/1S, 5" → 650g/1950KV/6S, etc.)
Sizes available: 1", 2.5", 3", 4", 5", 6", 7" (no 2" or 10")

## Documentation Requirements

**MANDATORY: Every PR must update documentation.** Before merging any PR, ensure all affected documentation files are up-to-date:

1. **TESTING.md** — Update test inventory whenever tests are added or removed
2. **ARCHITECTURE.md** — Update when architecture, handler counts, component structure changes
3. **README.md** — Update test count, feature list, or usage instructions if affected
4. **SPEC.md** — Update progress summary (test count, PR range) and phase tracking
5. **CLAUDE.md** — Update architecture sections when relevant code changes
6. **docs/README.md** — Update when design docs are added or completed
7. **docs/*.md** — Update status headers when all tasks in a design doc are merged
8. **QUICK_START.md** — Update if development workflow or prerequisites change

**Key numbers to keep in sync across files:**
- Total test count and test file count (ARCHITECTURE.md, README.md, SPEC.md, TESTING.md, docs/README.md)
- Analysis module count (README.md project structure, feature bullet)
- IPC handler counts per module (ARCHITECTURE.md, CLAUDE.md)

**MANDATORY: Documentation subagent before merge.** After completing implementation and before merging the final PR, launch a background Agent to review all changes and update every affected MD file.

## Code Style

### File Organization
- Place test files next to components: `Component.tsx` + `Component.test.tsx`
- Separate CSS files: `Component.css`
- Hooks in `src/renderer/hooks/`
- Shared types in `src/shared/types/`

### Design Documents (`docs/`)
- Lifecycle: **Proposed → Complete**. Index: `docs/README.md`
- Language: English only
- Status header: `> **Status**: Complete/Proposed/Active` on line 3

### React Patterns
- Functional components with hooks
- Custom hooks for business logic (useConnection, useProfiles, useSnapshots)
- No prop drilling - use event subscriptions for cross-component communication
- `ErrorBoundary` wraps `App` — class component crash recovery

### Code Quality
- **ESLint**: Flat config (`eslint.config.mjs`), `typescript-eslint` recommended, `react-hooks` rules
- **Prettier**: 100 char width, single quotes, trailing comma es5 (`.prettierrc.json`)
- **lint-staged**: Pre-commit runs `eslint --fix` + `prettier --write` + `vitest related`
- **TypeScript**: `tsc --noEmit` enforced in CI (zero errors)

## Claude Code Configuration

### Autonomous Repo Operations
Claude has **full autonomous access** exclusively to `eddycek/pidlab` repo:
- **NEVER push directly to main** — always create a feature branch, open a PR, then merge with `gh pr merge --admin`
- **Merge workflow**: After creating PR: (1) wait for CI, (2) wait for CodePilot Agent check, (3) poll 6 min for comments (15s intervals), (4) fix any comments, (5) ask user before merging — NEVER auto-merge
- **CodePilot comments can be delayed** — always poll for 6 minutes after Agent check completes, filtering by latest commit SHA

**CRITICAL**: NEVER push, merge, or interact with any repository other than `eddycek/pidlab`. All git push/pull operations MUST target only `origin` remote. Never specify `--repo` pointing to a different repository.

### Permissions Strategy
- **Allow**: git workflow, gh CLI, npm dev/build/test commands, filesystem ops, curated WebFetch domains
- **Deny**: Credentials, secrets, SSH keys, certificates, `node -e`/`python3` (arbitrary code exec)
- **Ask**: Destructive ops (`rm`, `git reset --hard`), package installations (`npm install`)
- **Location**: `.claude/settings.json` (project-specific)

### Skills

| Skill | Description |
|-------|-------------|
| `/tuning-advisor` | PID tuning expert — consult, review, audit, analyze modes. KB: `docs/PID_TUNING_KNOWLEDGE.md` |
| `/doc-sync` | Documentation accuracy auditor. **Run before every PR merge.** |
| `/telemetry-evaluator` | Evaluates telemetry data against target KPIs |
| `/diagnose <reportId>` | Investigates user-submitted diagnostic reports |
| `/e2e-tuning-test` | Automated E2E testing of tuning workflow via debug server |
| `/rate-advisor` | Evaluates FPV rate profiles against community benchmarks |

### Hooks

**PostToolUse**:
1. **Tuning Logic Check** (`.claude/hooks/tuning-logic-check.sh`) — triggers on Edit/Write to `src/main/analysis/` or `src/main/demo/DemoDataGenerator*`. Reminds to run `/tuning-advisor review`.
2. **Doc Sync Check** (`.claude/hooks/doc-sync-check.sh`) — triggers on Edit/Write to analysis code, constants, types, IPC handlers, hooks, and test files. Reminds to run `/doc-sync`.

**PreToolUse**:
1. **Pre-Push Review** (`.claude/hooks/pre-push-review.sh`) — triggers before `git push`. Non-blocking reminder to run `/code-review`.

## Platform-Specific Notes

### macOS
- Serial ports: `/dev/tty.usbmodem*`
- Requires Xcode Command Line Tools for native modules

### Windows
- Serial ports: `COM*`
- Requires STM32 VCP drivers
- Visual Studio Build Tools needed for native modules

### Linux
- Serial ports: `/dev/ttyUSB*` or `/dev/ttyACM*`
- User may need to be in `dialout` group
- Requires `build-essential` package
