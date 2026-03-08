# Testing Guidelines

> **Rule:** After adding or removing tests, update the test inventory in this file. Keep counts accurate.

## Overview

This project uses **Vitest** and **React Testing Library** for testing. All UI changes must include tests and pass before committing.

## Test Stack

- **Vitest** - Fast unit test framework (Vite-native)
- **React Testing Library** - React component testing utilities
- **@testing-library/jest-dom** - Custom matchers for DOM assertions
- **@testing-library/user-event** - User interaction simulation
- **jsdom** - DOM implementation for Node.js
- **Playwright** - Electron E2E testing (demo mode)

## Running Tests

```bash
# Watch mode (development)
npm test

# Single run (CI / pre-commit)
npm run test:run

# Interactive UI
npm run test:ui

# Coverage report
npm run test:coverage

# E2E tests (requires build first)
npm run test:e2e

# E2E with Playwright UI
npm run test:e2e:ui

# Generate 5 tuning sessions for demo history (slow, ~2 min)
npm run demo:generate-history
```

## Pre-commit Hook

Tests run automatically before each commit via **husky** and **lint-staged**:
- Only tests related to changed files are executed
- Commit is blocked if tests fail

## Writing Tests

### File Location & Naming

Place test files next to the source file:
```
src/renderer/components/
  ConnectionPanel/
    ConnectionPanel.tsx          ← Component
    ConnectionPanel.test.tsx     ← Tests
    ConnectionPanel.css
```

- `.test.tsx` for component tests
- `.test.ts` for utility/hook/backend tests

### Basic Structure

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { YourComponent } from './YourComponent';

describe('YourComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.betaflight.someMethod).mockResolvedValue(mockData);
  });

  it('renders correctly', () => {
    render(<YourComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });

  it('handles user interaction', async () => {
    const user = userEvent.setup();
    render(<YourComponent />);

    await user.click(screen.getByRole('button', { name: /click me/i }));

    await waitFor(() => {
      expect(screen.getByText('Result')).toBeInTheDocument();
    });
  });
});
```

### Common Patterns

**Querying elements:**
```typescript
screen.getByRole('button', { name: /connect/i })  // preferred
screen.getByLabelText(/serial port/i)
screen.getByText(/connection/i)
```

**Async operations:**
```typescript
await waitFor(() => {
  expect(screen.getByText('Loaded')).toBeInTheDocument();
});
```

**Mocking API calls:**
```typescript
beforeEach(() => {
  vi.mocked(window.betaflight.connect).mockResolvedValue(undefined);
  vi.mocked(window.betaflight.listPorts).mockResolvedValue(mockPorts);
});
```

**Error states:**
```typescript
vi.mocked(window.betaflight.connect).mockRejectedValue(new Error('Connection failed'));
```

## Best Practices

**DO:**
- Test user behavior, not implementation details
- Use accessible queries (`getByRole`, `getByLabelText`)
- Use `waitFor()` for async state updates
- Clean up mocks with `vi.clearAllMocks()` in `beforeEach`
- Test edge cases: empty states, errors, loading, disabled

**DON'T:**
- Test implementation details (internal state, private methods)
- Use `setTimeout()` / `wait()` — use `waitFor()` instead
- Test library code — test YOUR code
- Skip cleanup — always reset mocks in `beforeEach`

## Debugging

```typescript
screen.debug();           // Print current DOM
it.only('...', () => {}); // Run only this test
it.skip('...', () => {}); // Skip this test
```

```bash
npm run test:ui           # Visual interface with DOM snapshots
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "not wrapped in act(...)" | Use `waitFor()` for async state updates |
| Test fails only in CI | Check for race conditions, use `waitFor` |
| Flaky test | Add `waitFor()`, increase timeout if needed |
| Mock not working | Ensure `vi.clearAllMocks()` in `beforeEach`, mock before `render()` |

---

## Test Inventory

**Total: 2180 unit tests across 107 files + 25 Playwright E2E tests** (last verified: March 8, 2026)

### UI Components

| File | Tests | Description |
|------|-------|-------------|
| `ConnectionPanel/ConnectionPanel.test.tsx` | 13 | Connection flow, port scanning, cooldown, auto-cooldown on unexpected disconnect |
| `FCInfo/FCInfoDisplay.test.tsx` | 35 | FC information display, CLI export, diagnostics, version-aware debug mode, feedforward config, fix/reset settings |
| `FCInfo/FixSettingsConfirmModal.test.tsx` | 4 | Fix settings confirmation modal, reboot warning, confirm/cancel |
| `BlackboxStatus/BlackboxStatus.test.tsx` | 31 | Blackbox status, download trigger, readonly mode, onAnalyze, SD card storage type, erase labels, log numbering, pagination |
| `ProfileSelector.test.tsx` | 11 | Profile switching, locking when FC connected |
| `ProfileEditModal.test.tsx` | 18 | Profile editing, validation, form handling, flight style selector |
| `ProfileDeleteModal.test.tsx` | 12 | Deletion confirmation, warnings |
| `SnapshotManager/SnapshotManager.test.tsx` | 43 | Snapshot CRUD, export, restore, baseline handling, dynamic numbering, pagination |
| `SnapshotManager/SnapshotDiffModal.test.tsx` | 13 | Snapshot diff view, change display |
| `SnapshotManager/snapshotDiffUtils.test.ts` | 24 | CLI diff parsing, change computation |
| `Toast/Toast.test.tsx` | 14 | Toast notification rendering and lifecycle |
| `Toast/ToastContainer.test.tsx` | 6 | Toast container layout and stacking |
| `StartTuningModal.test.tsx` | 6 | Start tuning modal, Deep Tune/Flash Tune selection, cancel |
| `TuningStatusBanner/TuningStatusBanner.test.tsx` | 62 | Workflow banner, step indicator, actions, downloading, applied phases, BB settings pre-flight warning, verification flow, flashUsedSize-based erased state, import file, skip erase, SD card labels + eraseCompleted, Flash Tune phases |
| `TuningWizard/TuningWizard.test.tsx` | 47 | Multi-step wizard flow, results display, apply, mode-aware routing, onApplyComplete with metrics, FF warning, RPM status, flight style display |
| `TuningWizard/FlightGuideContent.test.tsx` | 9 | Flight guide content rendering, version-aware tip filtering |
| `TuningWizard/TestFlightGuideStep.test.tsx` | 5 | Flight guide step integration |
| `TuningWizard/PhaseIllustration.test.tsx` | 4 | Phase illustration SVG rendering, custom size, aria-hidden, unknown title fallback |
| `TuningWorkflowModal/TuningWorkflowModal.test.tsx` | 23 | Workflow preparation modal, mode-aware step filtering (filter/pid/verification), flight guide sections |
| `AnalysisOverview/AnalysisOverview.test.tsx` | 32 | Diagnostic-only analysis view, auto-parse, session picker, breadcrumb navigation, session metadata, FF warning, RPM status, data quality pill, TF analysis |
| `TuningWizard/PIDAnalysisStep.test.tsx` | 7 | PID results display, flight style pill, step count pluralization, data quality pill |
| `TuningWizard/RecommendationCard.test.tsx` | 11 | Setting label lookup, value display, change percentage, confidence, feedforward labels |
| `TuningWizard/ApplyConfirmationModal.test.tsx` | 9 | Change counts, snapshot checkbox, confirm/cancel, reboot warning |
| `TuningWizard/QuickAnalysisStep.test.tsx` | 6 | Quick analysis dual-panel (filter + TF), auto-run, progress, retry |
| `TuningWizard/WizardProgress.test.tsx` | 10 | Step indicator, mode-aware filtering (filter/pid/quick), current/done/upcoming states |
| `TuningWizard/SessionSelectStep.test.tsx` | 8 | Session picker, auto-parse, parsing/error/empty states, reverse order |
| `TuningWizard/TuningSummaryStep.test.tsx` | 17 | Recommendations table, mode-aware labels (filter/pid/quick), apply/progress/success/error states, tfResult for quick mode |
| `TuningWizard/charts/AxisTabs.test.tsx` | 6 | Tab rendering, selection, aria-selected, onChange callback |
| `TuningHistory/AppliedChangesTable.test.tsx` | 7 | Setting changes table, percent formatting, empty state, zero value handling |
| `TuningHistory/NoiseComparisonChart.test.tsx` | 9 | Before/after spectrum overlay, delta pill, axis tabs, empty state |
| `TuningHistory/TuningCompletionSummary.test.tsx` | 17 | Completion summary with/without verification, noise chart, changes, PID metrics, actions, quality score badge with tier label, re-analyze button, Flash Tune title |
| `TuningHistory/TuningHistoryPanel.test.tsx` | 17 | History list, expand/collapse, detail view with duration/flights, empty/loading states, quality score badge with tier label, trend chart, re-analyze verification, Flash Tune label |
| `TuningHistory/VerificationSessionModal.test.tsx` | 7 | Auto-analyze single session, multi-session picker, reverse order, cancel, error/parsing states |
| `TuningHistory/QualityTrendChart.test.tsx` | 5 | Trend chart rendering, minimum data threshold, null score handling |
| `ProfileWizard.test.tsx` | 6 | Profile creation wizard, flight style selector, preset mapping |
| `ProfileCard.test.tsx` | 17 | Profile card rendering, badges (Active/Recent), relative time, click handlers, locked state, CSS classes |
| `PresetSelector.test.tsx` | 11 | Preset dropdown rendering, selection callback, flight style mapping |
| `ErrorBoundary.test.tsx` | 6 | Error catch, fallback UI, try again reset, custom fallback, normal render |
| `App.test.tsx` | 10 | App render, title, version, BF compat badge, help button, ErrorBoundary integration, start tuning modal |

### Charts

| File | Tests | Description |
|------|-------|-------------|
| `TuningWizard/charts/chartUtils.test.ts` | 20 | Data conversion, downsampling, findBestStep, robust Y domain |
| `TuningWizard/charts/SpectrumChart.test.tsx` | 5 | FFT spectrum chart rendering |
| `TuningWizard/charts/StepResponseChart.test.tsx` | 10 | Step response chart rendering, navigation |
| `TuningWizard/charts/BodePlot.test.tsx` | 4 | Bode plot (magnitude + phase) rendering for transfer function |

### Contexts

| File | Tests | Description |
|------|-------|-------------|
| `contexts/ToastContext.test.tsx` | 10 | Toast context provider, add/remove/auto-dismiss |

### Hooks

| File | Tests | Description |
|------|-------|-------------|
| `hooks/useConnection.test.ts` | 14 | Connection state, port management, error handling |
| `hooks/useProfiles.test.ts` | 15 | Profile CRUD, event subscriptions |
| `hooks/useSnapshots.test.ts` | 19 | Snapshot management, restore, event-driven updates |
| `hooks/useTuningWizard.test.ts` | 23 | Wizard state, parse/analyze/apply lifecycle, PID/FF split, quick mode TF analysis |
| `hooks/useTuningSession.test.ts` | 10 | Tuning session lifecycle, IPC events, reload on profile change |
| `hooks/useTuningHistory.test.ts` | 5 | History loading, profile/session change reload, error handling |
| `hooks/useAnalysisOverview.test.ts` | 12 | Auto-parse, dual analysis, session picker |
| `hooks/useFCInfo.test.ts` | 8 | FC info fetch, CLI export, loading/error states |
| `hooks/useToast.test.tsx` | 5 | Toast helper methods, context requirement |
| `hooks/useBlackboxInfo.test.ts` | 8 | Auto-load, refresh, concurrent request prevention |
| `hooks/useBlackboxLogs.test.ts` | 9 | Log list, profile change subscription, delete, openFolder |
| `hooks/useDemoMode.test.ts` | 3 | Demo mode detection, reset demo |
| `utils/bbSettingsUtils.test.ts` | 18 | BB settings status computation, version-aware debug mode, fix/reset commands |

### IPC Handlers

| File | Tests | Description |
|------|-------|-------------|
| `ipc/handlers.test.ts` | 113 | All 50 IPC handler channels: connection, FC info, profiles, snapshots, blackbox, PID config, analysis (filter+PID+TF), tuning apply (PID+filter+FF), snapshot restore, tuning session, BB settings fix, handler registration |

### MSP Protocol & Client

| File | Tests | Description |
|------|-------|-------------|
| `msp/MSPProtocol.test.ts` | 40 | MSPv1 encode/decode, jumbo frames, round-trip, parseBuffer, checksum validation, garbage recovery |
| `msp/MSPConnection.test.ts` | 48 | Connection lifecycle, sendCommand, sendCommandNoResponse, timeouts, error/partial responses, CLI mode (prompt debounce, chunk-boundary, trailing CR), event forwarding |
| `msp/MSPClient.test.ts` | 68 | FC info queries, PID/filter/FF config, board info, UID, blackbox info (flash+SD card), SD card summary, MSC reboot (fire-and-forget), set PID, CLI diff, save & reboot, connect/disconnect, version gate, listPorts |
| `msp/cliUtils.test.ts` | 17 | CLI command response validation, error pattern detection, setting extraction |

### MSC (Mass Storage Class)

| File | Tests | Description |
|------|-------|-------------|
| `msc/driveDetector.test.ts` | 29 | Cross-platform volume snapshot (macOS/Windows/Linux), BF log file matching (root + subdirs), new drive detection with polling, drive eject |
| `msc/MSCManager.test.ts` | 14 | Download/erase lifecycle, MSC rejection, mount timeout, cancel, multi-file copy, eject error handling |

### Storage

| File | Tests | Description |
|------|-------|-------------|
| `storage/FileStorage.test.ts` | 13 | Snapshot JSON save/load/delete/list/export, ensureDirectory, snapshotExists |
| `storage/ProfileStorage.test.ts` | 13 | Profile persistence, loadProfiles, findBySerial, export, ensureDirectory idempotent |
| `storage/ProfileManager.test.ts` | 23 | Profile CRUD, preset creation, current profile, link/unlink snapshots, export |
| `storage/SnapshotManager.test.ts` | 16 | Snapshot creation via MSP, baseline management, server-side filtering, delete protection |
| `storage/BlackboxManager.test.ts` | 15 | Log save/list/get/delete/export, profile filtering, soft delete, initialization |
| `storage/TuningSessionManager.test.ts` | 20 | Session CRUD, phase transitions, per-profile persistence, Flash Tune phases |
| `storage/TuningHistoryManager.test.ts` | 25 | History archive, retrieval ordering, corrupted data handling, per-profile isolation, delete, updateLatestVerification, updateRecordVerification, tuningType field |

### Blackbox Parser

| File | Tests | Description |
|------|-------|-------------|
| `blackbox/BlackboxParser.test.ts` | 35 | End-to-end parsing, multi-session, corruption recovery |
| `blackbox/BlackboxParser.fuzz.test.ts` | 18 | Fuzz/property-based: random bytes, truncation, extreme values, oversized frames, all-zero, huge iterations |
| `blackbox/BlackboxParser.integration.test.ts` | 9 | Real flight BBL regression tests |
| `blackbox/realflight.regression.test.ts` | 13 | Additional real-flight regression tests |
| `blackbox/StreamReader.test.ts` | 35 | Binary stream reading, variable-byte encoding |
| `blackbox/HeaderParser.test.ts` | 25 | BBL header parsing, field definitions |
| `blackbox/ValueDecoder.test.ts` | 64 | 10 encoding types |
| `blackbox/PredictorApplier.test.ts` | 31 | 10 predictor types, C integer division |
| `blackbox/FrameParser.test.ts` | 15 | I/P/S frame decoding |

### FFT Analysis

| File | Tests | Description |
|------|-------|-------------|
| `analysis/FFTCompute.test.ts` | 20 | Hanning window, Welch's method, sine detection |
| `analysis/SegmentSelector.test.ts` | 29 | Hover detection, throttle sweep detection, throttle normalization |
| `analysis/NoiseAnalyzer.test.ts` | 25 | Peak detection, classification, noise floor |
| `analysis/FilterRecommender.test.ts` | 48 | Noise-based targets, convergence, safety bounds, RPM-aware bounds, dynamic notch, motor diagnostic, propwash floor |
| `analysis/DataQualityScorer.test.ts` | 36 | Filter/PID data quality scoring, tier mapping, warnings, confidence adjustment, TF data quality |
| `analysis/FilterAnalyzer.test.ts` | 19 | End-to-end pipeline, progress reporting, segment fallback warnings, RPM context propagation, data quality scoring, throttle spectrogram, group delay |
| `analysis/ThrottleSpectrogramAnalyzer.test.ts` | 17 | Throttle-dependent spectrogram analysis, frequency-throttle mapping, noise source tracking |
| `analysis/GroupDelayEstimator.test.ts` | 22 | Group delay estimation, filter phase response, latency measurement |

### Step Response Analysis

| File | Tests | Description |
|------|-------|-------------|
| `analysis/StepDetector.test.ts` | 16 | Derivative-based step detection, hold/cooldown |
| `analysis/StepMetrics.test.ts` | 53 | Rise time, overshoot, settling, latency, ringing, FF contribution classification, trackingErrorRMS computation and aggregation, adaptive window, FF energy ratio |
| `analysis/PIDRecommender.test.ts` | 73 | Flight PID anchoring, convergence, safety bounds, FF context, FF-aware recommendations, flight style thresholds, proportional severity scaling, TF-based recommendations, damping ratio, I-term, D-term effectiveness |
| `analysis/PIDAnalyzer.test.ts` | 21 | End-to-end pipeline, progress reporting, FF context wiring, flight style propagation, data quality scoring, cross-axis, propwash integration |
| `analysis/CrossAxisDetector.test.ts` | 20 | Cross-axis coupling detection, axis interaction analysis |
| `analysis/PropWashDetector.test.ts` | 15 | Propwash detection, wash-out frequency analysis |
| `analysis/DTermAnalyzer.test.ts` | 8 | D-term effectiveness, energy ratio computation, dCritical flag |
| `analysis/BayesianPIDOptimizer.test.ts` | 31 | Gaussian Process surrogate, Expected Improvement, Latin Hypercube Sampling, bounds |
| `analysis/TransferFunctionEstimator.test.ts` | 21 | Wiener deconvolution, frequency response estimation, Bode plot data, PID recommendations from transfer function |
| `analysis/AnalysisPipeline.realdata.test.ts` | 20 | End-to-end filter+PID analysis with bf45-reference fixture and real_flight.bbl, safety bounds, determinism, performance |

### E2E Workflow Tests

| File | Tests | Description |
|------|-------|-------------|
| `e2e/tuningWorkflow.e2e.test.ts` | 30 | Profile+connection workflow, snapshot CRUD+restore, tuning session lifecycle, apply recommendations 4-stage ordering, error recovery, BB settings fix, full tuning cycle |

### Header Validation

| File | Tests | Description |
|------|-------|-------------|
| `analysis/constants.test.ts` | 7 | PID style threshold validation, ordering constraints, balanced-matches-existing |

### Shared Constants & Types

| File | Tests | Description |
|------|-------|-------------|
| `shared/utils/metricsExtract.test.ts` | 17 | Spectrum downsampling, filter/PID/TF metrics extraction, boundary handling, trackingErrorRMS extraction |
| `shared/utils/tuneQualityScore.test.ts` | 25 | Quality score computation, tier boundaries, partial metrics, backward compat, clamping, TIER_LABELS, verification quality |
| `shared/constants.test.ts` | 7 | Preset profile flight style mapping validation |
| `shared/types/profile.types.test.ts` | 5 | FlightStyle type compilation, DroneProfileOptional inheritance |

### Header Validation

| File | Tests | Description |
|------|-------|-------------|
| `analysis/headerValidation.test.ts` | 24 | GYRO_SCALED check, logging rate validation, BF version-aware debug mode, BBL header RPM enrichment, independent field enrichment |

### Demo Mode (Offline UX Testing)

| File | Tests | Description |
|------|-------|-------------|
| `demo/MockMSPClient.test.ts` | 47 | Mock FC connection, state management, FC info, PID/filter/FF config, blackbox, CLI, save/reboot, flags, flight type cycling, advancePastVerification, Flash Tune mode |
| `demo/DemoDataGenerator.test.ts` | 22 | BBL generation for filter/PID/quick analysis, multi-session, header metadata, step inputs, throttle sweeps, progressive noise reduction |

### Playwright E2E Tests (Demo Mode)

End-to-end tests that launch the real Electron app in demo mode and walk through the UI using Playwright. Requires a build before running (`npm run build:e2e`).

| File | Tests | Description |
|------|-------|-------------|
| `e2e/demo-smoke.spec.ts` | 4 | App launch, auto-connect, dashboard elements (blackbox, start tuning, reset demo) |
| `e2e/demo-tuning-cycle.spec.ts` | 11 | Full Deep Tune cycle: start → modal → erase → download → filter wizard → apply → PID wizard → apply → skip verify → complete → dismiss → check history |
| `e2e/demo-quick-tune-cycle.spec.ts` | 7 | Full Flash Tune cycle: start → modal (Flash) → erase → download → flash wizard (auto-analysis) → apply all → skip verify → complete → dismiss → check history |
| `e2e/demo-generate-history.spec.ts` | 3 | Generates completed tuning sessions in 3 modes: mixed, deep-only, flash-only (excluded from normal `test:e2e` runs, run via `npm run demo:generate-history`) |

**E2E infrastructure:**
- `e2e/electron-app.ts` — Shared fixture with `launchDemoApp()`, screenshot helpers, button/text wait utilities
- `playwright.config.ts` — Config: 1 worker, 60s timeout, trace on failure
- `.e2e-userdata/` — Isolated user data directory (wiped before each test file for clean state)
- `E2E_USER_DATA_DIR` env var — Overrides Electron `userData` path for test isolation
