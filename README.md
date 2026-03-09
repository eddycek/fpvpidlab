# PIDlab

**The first open-source desktop app that auto-tunes Betaflight PID and filter settings from Blackbox data.**

Most FPV pilots tune their quads by hand — tweaking PID numbers, test flying, staring at Blackbox graphs, and repeating. It takes dozens of flights, deep BF knowledge, and a lot of patience. Tools like PIDtoolbox show you the data but don't tell you what to change. PIDlab closes that gap: it reads your Blackbox log, runs signal processing (FFT noise analysis, step response detection, Wiener deconvolution), and produces concrete Betaflight CLI commands — with plain-English explanations — that you apply with one click.

**What makes it different:**
- **Fully automated recommendations** — not just graphs, but actual filter cutoffs and PID values ready to flash
- **Two tuning modes** — Deep Tune (2 dedicated flights, direct step response measurement) or Flash Tune (any single flight, Wiener deconvolution à la [Plasmatree](https://github.com/Plasmatree/PID-Analyzer))
- **Convergent by design** — re-analyzing the same log always produces the same result, no recommendation drift
- **Safety-first** — every apply creates an automatic rollback snapshot, all values clamped to proven safe bounds
- **Multi-quad profiles** — auto-detects each FC by serial number, stores configs and tuning history per quad
- **Flight style adaptation** — Smooth (cinematic), Balanced (freestyle), Aggressive (racing) thresholds
- **19 analysis modules** — FFT, step response, Wiener deconvolution, Bode plots, prop wash detection, D-term effectiveness, cross-axis coupling, throttle spectrograms, group delay estimation, Bayesian PID optimizer framework
- **Works offline** — demo mode with simulated FC for testing without hardware

**How it works:** Connect FC via USB → Erase flash → Fly → Download log → PIDlab analyzes and applies optimized settings → Done.

## Download

Pre-built binaries are available on the [Releases](https://github.com/eddycek/pidlab/releases) page:

| Platform | Format | File |
|----------|--------|------|
| **macOS** | Disk Image | `PIDlab-*.dmg` |
| **Windows** | Installer | `PIDlab-Setup-*.exe` |
| **Linux** | AppImage | `PIDlab-*.AppImage` |

> **Note:** macOS builds are currently unsigned. On first launch, right-click the app and select **Open**, or run `xattr -cr /Applications/PIDlab.app` in Terminal to bypass Gatekeeper.

## Supported Betaflight Versions

| Tier | Version | Notes |
|------|---------|-------|
| **Minimum** | BF 4.3 (API 1.44) | Oldest supported — connects and works |
| **Recommended** | BF 4.5+ (API 1.46) | Best feature coverage |
| **Actively tested** | BF 4.5.x, 2025.12.x | User's fleet |

Connecting with BF 4.2 or earlier will show an error and auto-disconnect. See [BF Version Policy](./docs/complete/BF_VERSION_POLICY.md) for detailed rationale and version-specific notes.

## Current Status

- **Phase 1:** ✅ Complete - MSP connection, profile management, snapshots
- **Phase 2:** ✅ Complete - Blackbox analysis, automated tuning, rollback
- **Phase 2.5:** ✅ Complete - Profile simplification, interactive analysis charts
- **Phase 3:** ✅ Complete - Mode-aware wizard, read-only analysis, flight guides
- **Phase 4:** ✅ Complete - Stateful Deep Tune workflow
- **Phase 6:** ✅ Complete - CI/CD with GitHub Actions (tests on PR, cross-platform releases on tag)

See [SPEC.md](./SPEC.md) for detailed phase tracking and test counts.

## Features

### Connection & Profiles
- USB serial connection to Betaflight flight controllers (MSP protocol)
- Multi-quad profile management with automatic FC detection by serial number
- Profile auto-selection on connect, profile locking while FC is connected
- 10 preset profiles (Tiny Whoop, 5" Freestyle, 7" Long Range, etc.)
- Cross-platform (Windows, macOS, Linux)

### Configuration Management
- CLI export (diff/dump) for full configuration backup
- Configuration snapshots with versioning and comparison
- Snapshot restore/rollback via CLI command replay
- GitHub-style diff view for snapshot comparison

### Blackbox Storage
- **Flash storage**: Download via MSP with adaptive chunking
- **SD card storage**: Download via MSC (Mass Storage Class) mode — FC re-enumerates as USB drive, app copies `.bbl` files automatically
- Binary BBL log parser (validated against BF Explorer, 245 tests)
- Multi-session support (multiple flights per file)
- FC diagnostics: debug_mode, logging rate, and feedforward configuration display with warnings + one-click fix

### Automated Filter Tuning
- FFT noise analysis (Welch's method, Hanning window, peak detection)
- Noise source classification (frame resonance, motor harmonics, electrical)
- Noise-floor-based filter cutoff targeting with linear interpolation
- RPM filter awareness: widens safety bounds (gyro LPF1 up to 500 Hz), optimizes dynamic notch (count/Q), diagnoses motor harmonic anomalies
- Propwash floor protection (never pushes gyro LPF1 below 100 Hz)
- Group delay estimation for filter chain latency visualization

### Automated PID Tuning
- Step response analysis (rise time, overshoot, settling time, latency, ringing)
- I-term rules: steady-state error detection with I increase/decrease recommendations
- Damping ratio validation: D/P ratio check (0.45–0.85 range) with automatic correction
- D-term effectiveness analysis: measures D dampening vs noise amplification ratio
- Prop wash detection: throttle-down event analysis with severity scoring per axis
- Cross-axis coupling detection: measures roll↔pitch interference
- Feedforward awareness: detects FF-dominated overshoot, recommends `feedforward_boost` reduction instead of P/D changes
- FF energy ratio integration: downgrades P-decrease confidence when feedforward contributes >60% of overshoot energy
- Proportional step sizing: D +5/+10/+15 based on overshoot severity for faster convergence

### Transfer Function Analysis (Wiener Deconvolution)

Inspired by [Plasmatree PID-Analyzer](https://github.com/Plasmatree/PID-Analyzer) by Florian Melsheimer — the first tool to bring frequency-domain system identification to FPV tuning (2018). PIDlab reimplements the core technique (cross-spectral density estimation with Wiener regularization) in TypeScript with `fft.js`, extended with automatic PID recommendations and integrated into the tuning workflow.

- Computes closed-loop transfer function H(f) = S_xy(f) / (S_xx(f) + ε) from any flight data — no dedicated maneuvers needed
- 2-second Hanning windows with 50% Welch overlap (matching Plasmatree's proven parameters)
- Noise-floor-based regularization (1% of S_xx median) prevents artifacts in low-SNR bins
- Synthetic step response via IFFT → cumulative sum (impulse → step integration)
- Bode plot visualization (magnitude + phase vs frequency)
- Classical stability metrics: bandwidth (-3 dB), phase margin (at 0 dB gain crossover), gain margin (at -180° phase crossover)
- Frequency-domain PID rules: low phase margin → D increase, low bandwidth → P increase
- Confidence capped at medium — Wiener deconvolution assumes a linear time-invariant system; real quads are nonlinear, so dedicated step response measurements remain more precise

### Bayesian PID Optimizer (Framework)
- Gaussian Process surrogate with RBF kernel
- Expected Improvement acquisition function
- Latin Hypercube Sampling for initial exploration
- Multi-session history-based optimization (available for future integration)

### Throttle Spectrogram Analysis
- Per-throttle-bin FFT computation (10 bins, 0–100%)
- Reveals motor harmonic tracking, frame resonance, and electrical noise patterns
- Available as diagnostic module (UI visualization pending)

### Flight Style Preferences
- Smooth (cinematic), Balanced (freestyle), or Aggressive (racing)
- PID thresholds adapt to pilot preference (overshoot tolerances, rise time targets, settling limits)
- Style set per-profile, preset profiles include sensible defaults

### Data Quality Scoring
- Rates input flight data 0-100 (excellent/good/fair/poor)
- Adjusts recommendation confidence based on data quality
- Warns about insufficient hover time, missing axes, too few steps
- Flight quality score: composite 0-100 metric with type-aware components (Deep Tune: step response metrics; Flash Tune: TF bandwidth + phase margin)

### Deep Tune (Two-Flight Workflow)

The thorough approach — two dedicated flights with specific maneuvers for maximum measurement accuracy.

**Flight 1 (Filters):** Hover + throttle sweeps across the full throttle range. The FFT engine (Welch's method, Hanning window, prominence-based peak detection) identifies noise sources — frame resonances (80–200 Hz), motor harmonics, and electrical noise (>500 Hz) — and computes optimal filter cutoffs via noise-floor-based targeting. RPM-filter-aware quads get wider safety bounds.

**Flight 2 (PIDs):** Sharp stick snaps on each axis with 500 ms holds. The step detector finds these inputs via derivative thresholds, then `StepMetrics` measures each response directly — rise time, overshoot, settling time, latency, ringing, and steady-state error. This time-domain approach gives the most precise overshoot and damping measurements because you're observing the actual physical response, not a mathematical estimate.

- 10-phase state machine (filter_flight_pending → ... → completed) with per-profile persistence
- Smart reconnect: auto-advances to log_ready when flash data detected after FC reboot
- Post-erase flight guide with mode-specific maneuver instructions
- Optional verification hover after PID apply — before/after noise spectrum comparison with dB delta
- Tuning completion summary with applied changes, noise metrics, and step response data

### Flash Tune (Single Flight)

The fast approach — analyzes any single flight (freestyle, cruise, hover) using frequency-domain system identification. Based on the [Plasmatree PID-Analyzer](https://github.com/Plasmatree/PID-Analyzer) technique pioneered by Florian Melsheimer.

**How it works:** Normal stick inputs contain broadband energy that excites the PID loop across all relevant frequencies. Wiener deconvolution recovers the closed-loop transfer function H(f) = S_xy / (S_xx + ε) from setpoint→gyro data, then synthesizes a step response via IFFT integration. Filter analysis runs the same FFT pipeline as Deep Tune. Both run in parallel from the same log.

**Trade-off:** No dedicated maneuvers needed, but the LTI (linear time-invariant) assumption means recommendations are less precise than direct step measurements — PIDlab caps Flash Tune confidence at "medium" and recommends Deep Tune for initial setup or major changes.

- Parallel filter + transfer function analysis with combined one-click apply
- Bode plot (magnitude + phase) with bandwidth, gain margin, and phase margin markers
- Synthetic step response metrics: overshoot, rise time, settling time derived from H(f)
- 6-phase state machine (quick_flight_pending → ... → completed)
- Best for experienced pilots iterating on an existing tune

### Tuning History
- Archived tuning records per profile (persistent across sessions)
- Before/after noise spectrum overlay with dB delta indicators
- Applied filter and PID changes table with old → new values
- Flight quality score badge and trend chart across sessions
- Expandable history cards on the dashboard

### Interactive Charts
- FFT spectrum chart (noise per axis, floor lines, peak markers)
- Step response chart (setpoint vs gyro trace, metrics overlay)
- Bode plot chart (magnitude + phase, bandwidth/margin markers)
- Axis tabs (Roll/Pitch/Yaw/All) for all chart types

## Tech Stack

- **Electron** - Desktop application framework
- **TypeScript** - Type-safe development
- **React** - UI framework
- **Vite** - Fast build tool
- **serialport** - USB serial communication
- **MSP Protocol** - Betaflight communication protocol
- **fft.js** - FFT computation for noise analysis
- **Recharts** - SVG-based interactive analysis charts
- **ESLint** + **Prettier** - Code linting and formatting (lint-staged pre-commit)

## Installation

### Prerequisites

- Node.js 20+ and npm
- Python 3 (for native module compilation)
- Build tools:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: Visual Studio Build Tools or windows-build-tools
  - **Linux**: `build-essential` package

### Setup

1. Clone the repository:
```bash
git clone https://github.com/eddycek/pidlab.git
cd pidlab
```

2. Install dependencies:
```bash
npm install
```

3. Rebuild native modules for Electron:
```bash
npm run rebuild
```

## Development

Start the development server:
```bash
npm run dev
```

This will:
- Start Vite dev server for hot reload
- Launch Electron with the app
- Open DevTools automatically

### Demo Mode (No Hardware Needed)

Start the app with a simulated flight controller for offline UX testing:
```bash
npm run dev:demo
```

Demo mode auto-connects to a virtual FC, creates a demo profile, and generates realistic blackbox data. The full tuning workflow is functional — real FFT and step response analysis runs on the simulated data. See [docs/complete/OFFLINE_UX_TESTING.md](./docs/complete/OFFLINE_UX_TESTING.md) for details.

### Available Commands

```bash
# Development
npm run dev                          # Start with hot reload
npm run dev:demo                     # Start with simulated FC (no hardware needed)

# Testing
npm test                             # Unit tests in watch mode
npm run test:run                     # Unit tests once (pre-commit)
npm run test:ui                      # Interactive test UI
npm run test:coverage                # Generate coverage report
npm run test:e2e                     # Build + run Playwright E2E tests
npm run test:e2e:ui                  # Build + Playwright UI

# Demo data generation
npm run demo:generate-history        # Generate 5 mixed tuning sessions (~2 min)
npm run demo:generate-history:deep   # Generate 5 Deep Tune sessions
npm run demo:generate-history:flash  # Generate 5 Flash Tune sessions

# Code quality
npm run lint                         # ESLint check
npm run lint:fix                     # ESLint auto-fix
npm run format                       # Prettier format
npm run format:check                 # Prettier check

# Build
npm run build                        # Production build
npm run rebuild                      # Rebuild native modules (serialport)
```

### Testing

All UI changes must include tests. Tests automatically run before commits. Coverage thresholds enforced: 80% lines/functions/statements, 75% branches.

**Unit tests:** 2331 tests across 114 files — MSP protocol, storage managers, IPC handlers, UI components, hooks, BBL parser fuzz, analysis pipeline validation.

**Playwright E2E:** 25 tests across 4 spec files — launches real Electron app in demo mode, walks through complete tuning cycles (Deep Tune and Flash Tune).

See [TESTING.md](./TESTING.md) for complete testing guidelines, test inventory, and best practices.

## Building

Build the application for your platform:
```bash
npm run build
```

Output will be in the `release/` directory.

### Releasing

Releases are automated via GitHub Actions. To create a new release:

```bash
# Update version in package.json, then:
git tag v0.2.0
git push origin v0.2.0
```

This triggers the release workflow which builds native installers for macOS (`.dmg`), Windows (`.exe`), and Linux (`.AppImage`), then uploads them as a draft GitHub Release. Review the draft and publish it manually.

## Project Structure

```
pidlab/
├── src/
│   ├── main/                    # Main process (Node.js)
│   │   ├── index.ts             # Entry point, event wiring
│   │   ├── window.ts            # Window management
│   │   ├── msp/                 # MSP communication
│   │   │   ├── MSPClient.ts     # High-level MSP API (connect, read/write, download)
│   │   │   ├── MSPConnection.ts # Serial port + CLI mode + reboot handling
│   │   │   ├── MSPProtocol.ts   # Protocol encoding/decoding (MSP v1)
│   │   │   ├── cliUtils.ts      # CLI diff parsing, command extraction
│   │   │   ├── commands.ts      # MSP command definitions
│   │   │   └── types.ts         # MSP type definitions
│   │   ├── blackbox/            # BBL binary log parser (6 modules, 245 tests)
│   │   ├── analysis/            # Signal processing & tuning engine (19 modules)
│   │   │   ├── FFTCompute.ts              # Welch's method, Hanning window
│   │   │   ├── SegmentSelector.ts         # Hover/sweep segment detection
│   │   │   ├── NoiseAnalyzer.ts           # Peak detection, noise classification
│   │   │   ├── FilterRecommender.ts       # Noise-based filter targets
│   │   │   ├── FilterAnalyzer.ts          # Filter analysis orchestrator
│   │   │   ├── StepDetector.ts            # Step input detection in setpoint
│   │   │   ├── StepMetrics.ts             # Rise time, overshoot, settling, FF classification
│   │   │   ├── PIDRecommender.ts          # Rule-based P/I/D recommendations
│   │   │   ├── PIDAnalyzer.ts             # PID analysis orchestrator
│   │   │   ├── TransferFunctionEstimator.ts # Wiener deconvolution engine
│   │   │   ├── DataQualityScorer.ts       # Flight data quality scoring (0-100)
│   │   │   ├── PropWashDetector.ts        # Throttle-down event detection + severity
│   │   │   ├── DTermAnalyzer.ts           # D-term effectiveness ratio analysis
│   │   │   ├── CrossAxisDetector.ts       # Roll↔pitch coupling detection
│   │   │   ├── ThrottleSpectrogramAnalyzer.ts # Per-throttle-bin FFT
│   │   │   ├── GroupDelayEstimator.ts     # Filter chain latency estimation
│   │   │   ├── BayesianPIDOptimizer.ts    # GP-based multi-session optimizer
│   │   │   ├── headerValidation.ts        # BB header diagnostics
│   │   │   └── constants.ts               # Tunable thresholds
│   │   ├── storage/             # Data managers
│   │   │   ├── ProfileManager.ts        # Multi-quad profile CRUD
│   │   │   ├── ProfileStorage.ts        # File-based profile storage
│   │   │   ├── SnapshotManager.ts       # Configuration snapshots
│   │   │   ├── BlackboxManager.ts       # BB log file management
│   │   │   ├── TuningSessionManager.ts  # Tuning session state machine
│   │   │   ├── TuningHistoryManager.ts  # Tuning history archive
│   │   │   └── FileStorage.ts           # Generic file storage utilities
│   │   ├── msc/                 # SD card Mass Storage Class support
│   │   │   ├── MSCManager.ts          # MSC download/erase orchestration
│   │   │   └── driveDetector.ts       # Cross-platform drive mount detection
│   │   ├── demo/               # Demo mode (offline UX testing)
│   │   │   ├── MockMSPClient.ts       # Simulated FC (47 tests)
│   │   │   └── DemoDataGenerator.ts   # Realistic BBL generation (22 tests)
│   │   ├── ipc/                 # IPC handlers (50 handlers across 8 modules)
│   │   │   ├── handlers/       # Domain-split handler modules
│   │   │   │   ├── index.ts            # DI container, registerIPCHandlers
│   │   │   │   ├── types.ts            # HandlerDependencies interface
│   │   │   │   ├── events.ts           # Event broadcast functions
│   │   │   │   ├── connectionHandlers.ts   # 6 handlers
│   │   │   │   ├── fcInfoHandlers.ts       # 5 handlers
│   │   │   │   ├── snapshotHandlers.ts     # 6 handlers
│   │   │   │   ├── profileHandlers.ts      # 10 handlers
│   │   │   │   ├── pidHandlers.ts          # 3 handlers
│   │   │   │   ├── blackboxHandlers.ts     # 9 handlers
│   │   │   │   ├── analysisHandlers.ts     # 3 handlers
│   │   │   │   └── tuningHandlers.ts       # 8 handlers
│   │   │   └── channels.ts     # Channel definitions
│   │   └── utils/               # Logger, error types
│   │
│   ├── preload/                 # Preload script
│   │   └── index.ts             # window.betaflight API bridge
│   │
│   ├── renderer/                # Renderer process (React)
│   │   ├── App.tsx              # Main layout, session routing
│   │   ├── components/
│   │   │   ├── ConnectionPanel/       # Port selection, connect/disconnect
│   │   │   ├── FCInfo/                # FC details + BB diagnostics + FixSettingsConfirmModal
│   │   │   ├── BlackboxStatus/        # Flash/SD card storage, download, erase
│   │   │   ├── SnapshotManager/       # Snapshot CRUD, diff view, restore
│   │   │   ├── TuningWizard/          # Multi-step tuning wizard
│   │   │   │   ├── charts/            # SpectrumChart, StepResponseChart, BodePlot, AxisTabs
│   │   │   │   ├── FilterAnalysisStep, PIDAnalysisStep  # Analysis result views
│   │   │   │   ├── QuickAnalysisStep  # Combined filter+PID for Flash Tune
│   │   │   │   ├── SessionSelectStep, TestFlightGuideStep # Pre-analysis steps
│   │   │   │   ├── TuningSummaryStep, WizardProgress     # Summary + progress
│   │   │   │   ├── RecommendationCard, ApplyConfirmationModal
│   │   │   │   └── FlightGuideContent # Flight phase instructions
│   │   │   ├── TuningStatusBanner/    # Workflow progress banner
│   │   │   ├── AnalysisOverview/      # Read-only analysis view (+ Bode plot fallback)
│   │   │   ├── TuningHistory/         # History panel + completion summary
│   │   │   │   ├── TuningHistoryPanel, TuningSessionDetail
│   │   │   │   ├── TuningCompletionSummary  # Replaces banner on completion
│   │   │   │   ├── NoiseComparisonChart     # Before/after spectrum overlay
│   │   │   │   ├── QualityTrendChart        # Flight quality score progression
│   │   │   │   └── AppliedChangesTable      # Setting changes with % diff
│   │   │   ├── TuningWorkflowModal/   # Two-flight workflow help
│   │   │   ├── StartTuningModal.tsx   # Deep Tune vs Flash Tune mode selector
│   │   │   ├── Toast/                 # Toast notification system
│   │   │   ├── ProfileWizard.tsx      # New FC profile creation wizard
│   │   │   ├── PresetSelector.tsx     # Preset profile picker
│   │   │   ├── ProfileSelector.tsx    # Profile switching dropdown
│   │   │   ├── ErrorBoundary.tsx      # React error boundary (crash recovery)
│   │   │   ├── ProfileCard.tsx        # Individual profile display
│   │   │   ├── ProfileEditModal.tsx   # Profile editing dialog
│   │   │   └── ProfileDeleteModal.tsx # Profile deletion confirmation
│   │   ├── hooks/               # React hooks (13)
│   │   │   ├── useConnection.ts       # Connection state management
│   │   │   ├── useProfiles.ts         # Profile CRUD operations
│   │   │   ├── useSnapshots.ts        # Snapshot management
│   │   │   ├── useTuningSession.ts    # Tuning session lifecycle
│   │   │   ├── useTuningWizard.ts     # Wizard state (parse/analyze/apply)
│   │   │   ├── useAnalysisOverview.ts # Read-only analysis state
│   │   │   ├── useTuningHistory.ts    # Tuning history loading
│   │   │   ├── useBlackboxInfo.ts     # BB flash info
│   │   │   ├── useBlackboxLogs.ts     # BB log list
│   │   │   ├── useFCInfo.ts           # FC info polling
│   │   │   ├── useDemoMode.ts         # Demo mode detection
│   │   │   └── useToast.ts            # Toast context consumer
│   │   ├── utils/               # Renderer utilities
│   │   │   └── bbSettingsUtils.ts     # BB settings status computation
│   │   ├── contexts/            # React contexts
│   │   │   └── ToastContext.tsx
│   │   └── test/                # Test setup
│   │       └── setup.ts         # window.betaflight mock
│   │
│   └── shared/                  # Shared types & constants
│       ├── types/               # TypeScript interfaces (10 type files)
│       ├── utils/               # Shared utilities
│       │   ├── metricsExtract.ts      # Metrics extraction, spectrum downsampling
│       │   └── tuneQualityScore.ts    # Composite flight quality score (0-100)
│       └── constants/           # MSP codes, presets, flight guides
│
├── e2e/                         # Playwright E2E tests (demo mode)
│   ├── electron-app.ts                # Shared fixture (launchDemoApp, helpers)
│   ├── demo-smoke.spec.ts             # 4 smoke tests
│   ├── demo-tuning-cycle.spec.ts      # 11 Deep Tune cycle tests
│   ├── demo-quick-tune-cycle.spec.ts  # 7 Flash Tune cycle tests
│   └── demo-generate-history.spec.ts  # Mixed history generator
│
└── docs/                        # Design documents (see docs/README.md for index)
    ├── README.md                          # Document index
    ├── PROPWASH_AND_DTERM_DIAGNOSTICS.md  # Active — backend done, UI pending
    ├── TUNING_PRECISION_IMPROVEMENTS.md   # Active — 4/15 improvements done
    ├── UX_IMPROVEMENT_IDEAS.md            # Active — 4/7 ideas done
    └── complete/                          # Completed design docs (13 historical records)
```

## Usage

### 1. First Connection & Profile Setup

1. Connect your flight controller via USB
2. Click **Scan** to detect available serial ports
3. Select your FC from the dropdown and click **Connect**
4. On first connection with a new FC, the **Profile Wizard** opens automatically:
   - Choose a preset profile (e.g., "5 inch Freestyle") or create a custom one
   - Enter quad name, size, weight, motor KV, battery config
   - Profile is linked to the FC's unique serial number
5. A **baseline snapshot** is created automatically, capturing the FC's current configuration

On subsequent connections, the app recognizes the FC by serial number and auto-selects the correct profile.

### 2. Pre-Flight Setup

Before flying, check the **Flight Controller Information** panel:

- **Debug Mode** should be `GYRO_SCALED` for noise analysis — **BF 4.3–4.5 only** (not needed on BF 2025.12+, hidden automatically)
- **Logging Rate** should be at least 2 kHz (shown with green checkmark or amber warning)
- **Feedforward** section shows current FF configuration read from FC (boost, per-axis gains, smoothing, jitter factor, transition, max rate limit)

If settings are wrong, click **Fix Settings** in the FC info panel — the app sends the CLI commands and reboots the FC automatically. During an active tuning session, the **TuningStatusBanner** also shows an amber pre-flight warning with a one-click fix button.

### 3. Deep Tune

Click **Start Tuning Session** and select **Deep Tune**. The status banner at the top tracks your progress through 10 phases:

#### Flight 1: Filter Tuning
1. **Erase Flash** — Clear old Blackbox data before flying
2. **Fly filter test flight** — Hover with gentle throttle sweeps (30-60 seconds)
3. **Reconnect** — App auto-detects new flight data on reconnect
4. **Download log** — Download Blackbox data from FC
5. **Analyze** — Click Analyze to open the filter wizard:
   - Auto-parses the log and runs FFT noise analysis
   - Shows noise spectrum, detected peaks, and filter recommendations
   - Review recommendations, then click **Apply Filters** (creates safety snapshot + reboots FC)

#### Flight 2: PID Tuning
6. **Erase Flash** — Clear flash for the PID test flight
7. **Fly PID test flight** — Sharp stick snaps on all axes (roll, pitch, yaw)
8. **Reconnect & download** — Same as above
9. **Analyze** — Opens the PID wizard:
   - Detects step inputs, measures response metrics (overshoot, rise time, settling)
   - Shows step response charts and PID recommendations
   - Click **Apply PIDs** to apply changes

#### Optional: Verification Hover
10. After PID apply, the banner offers an optional **verification hover** (30s gentle hover)
11. If flown, the app compares before/after noise spectra with a dB delta indicator

The session shows a **completion summary** with all applied changes, noise metrics, and PID response data. You can start a new tuning cycle to iterate further. Past sessions are archived in the **Tuning History** panel on the dashboard.

### 4. Flash Tune (Single Flight)

Click **Start Tuning Session** and select **Flash Tune**:

1. **Erase Flash** — Clear old data
2. **Fly any flight** — Freestyle, cruise, stick snaps — any 30+ second flight works
3. **Download & analyze** — App runs two analyses in parallel:
   - **FFT noise analysis** (same as Deep Tune) for filter recommendations
   - **Wiener deconvolution** for PID recommendations — computes the closed-loop transfer function H(f) = S_xy(f) / S_xx(f) from setpoint→gyro data using 2s Hanning windows with 50% Welch overlap, then synthesizes a step response via IFFT cumulative integration
4. **Review Bode plot** — Magnitude + phase curves with bandwidth (-3 dB), gain margin, and phase margin markers. Low phase margin (<45°) indicates need for more D damping; low bandwidth (<40 Hz) suggests P increase
5. **Apply all** — Combined filter + PID changes in one click
6. **Optional verification** — Same as Deep Tune

This approach is based on the [Plasmatree PID-Analyzer](https://github.com/Plasmatree/PID-Analyzer) technique by Florian Melsheimer (2018) — the first tool to apply Wiener deconvolution to FPV PID tuning. The key insight is that normal stick inputs contain enough broadband energy to excite the PID loop across all relevant frequencies, so the transfer function can be recovered from *any* flight data without dedicated maneuvers.

**Trade-off vs Deep Tune:** Wiener deconvolution assumes a linear time-invariant (LTI) system. Real quads are nonlinear (TPA, anti-gravity, motor saturation), so PIDlab caps Flash Tune confidence at "medium". Use Deep Tune for initial setup or significant changes; Flash Tune for fast iteration on an existing tune.

### 5. Standalone Analysis (No Tuning Session)

If you just want to analyze a log without applying changes:

1. Connect FC and download a Blackbox log
2. Click **Analyze** on any downloaded log (without starting a tuning session)
3. Opens a **read-only Analysis Overview** — shows filter analysis (noise spectrum), PID analysis (step response or Bode plot), and diagnostic data on a single page
4. No Apply buttons — purely informational, great for reviewing flight data

### 6. Managing Snapshots

Snapshots capture the FC's full CLI configuration at a point in time.

- **Baseline** — Auto-created on first connection, cannot be deleted
- **Manual** — Create anytime via "Create Snapshot" button with optional label
- **Auto (safety)** — Created automatically before applying tuning changes
- **Compare** — Click to see GitHub-style diff between snapshots
- **Restore** — Roll back to any snapshot (creates a safety backup first, sends CLI commands, reboots FC)
- **Export** — Download as `.txt` file

### 7. Exporting Configuration

The FC Info panel provides two export options:

- **Export CLI Diff** — Only changed settings (recommended for sharing/backup)
- **Export CLI Dump** — Full configuration dump

### 8. Blackbox Storage Management

The Blackbox Storage panel shows flash/SD card usage and downloaded logs:

- **Download** — Downloads flight data from FC flash or SD card (MSC mode for SD)
- **Erase** — Permanently deletes all data from FC storage (required before each test flight)
- **Test Read** — Diagnostic tool to verify FC flash communication
- **Open Folder** — Opens the local log storage directory

During an active tuning session, Blackbox actions are driven by the status banner (single point of action).

## Troubleshooting

### Port Access Issues

**macOS/Linux:**
```bash
sudo chmod 666 /dev/ttyUSB0  # or your port
```

**Windows:**
- Install STM32 VCP drivers
- Check Device Manager for COM port

### Rebuild Native Modules

If serialport doesn't work after installation:
```bash
npm run rebuild
```

### Connection Timeout

- Ensure FC is powered on
- Check USB cable (data cable, not charge-only)
- Try different USB port
- Restart the application

### FC Not Detected

- Verify FC is in MSP mode (not CLI or DFU)
- Check Betaflight Configurator can connect
- Install proper USB drivers

### "FC not responding to MSP commands"

- Caused by reconnecting too quickly after disconnect
- Wait for the 3-second cooldown timer, then retry
- If persistent, physically unplug and replug the USB cable

## MSP Protocol

The app uses the MultiWii Serial Protocol (MSP) v1 to communicate with Betaflight:

- **MSP_API_VERSION** - Get API version
- **MSP_FC_VARIANT** / **MSP_FC_VERSION** - Firmware identification
- **MSP_BOARD_INFO** - Board and target information
- **MSP_UID** - Unique FC serial number (for profile matching)
- **MSP_PID** / **MSP_SET_PID** - Read/write PID configuration
- **MSP_FILTER_CONFIG** - Read current filter settings
- **MSP_PID_ADVANCED** - Read feedforward configuration (boost, gains, smoothing, jitter, transition)
- **MSP_DATAFLASH_SUMMARY** - Flash storage information
- **MSP_DATAFLASH_READ** - Download Blackbox data
- **MSP_DATAFLASH_ERASE** - Erase flash storage
- **MSP_SDCARD_SUMMARY** - SD card storage information
- **MSP_REBOOT** - Reboot FC (type=2 for MSC mode — SD card as USB drive)
- **CLI Mode** - For configuration export, snapshot restore, and filter tuning

## Configuration Storage

All data is stored locally per platform:

- **macOS**: `~/Library/Application Support/pidlab/data/`
- **Windows**: `%APPDATA%/pidlab/data/`
- **Linux**: `~/.config/pidlab/data/`

Subdirectories:
- `profiles/` — Quad profile JSON files + metadata index
- `snapshots/` — Configuration snapshot JSON files
- `blackbox/` — Downloaded Blackbox log files (`.bbl`)
- `tuning/` — Tuning session state files (per profile)
- `tuning-history/` — Archived tuning records (per profile)

## How Autotuning Works

PIDlab automates the two core aspects of FPV quad tuning: **filter tuning** (reducing noise) and **PID tuning** (improving flight response). Both use Blackbox log analysis to produce data-driven recommendations.

### Filter Tuning (FFT Analysis)

The filter tuning pipeline analyzes gyro noise to determine optimal lowpass filter cutoff frequencies.

**Pipeline:** `SegmentSelector` → `FFTCompute` → `NoiseAnalyzer` → `FilterRecommender`

1. **Segment selection** — Identifies stable hover segments from throttle and gyro data, excluding takeoff, landing, and aggressive maneuvers. Detects both hover and throttle sweep segments.
2. **FFT computation** — Applies Welch's method (Hanning window, 50% overlap, 4096-sample windows) to compute power spectral density for each axis
3. **Noise analysis** — Estimates the noise floor (lower quartile), detects prominent peaks (>6 dB above local floor), and classifies noise sources:
   - Frame resonance (80–200 Hz)
   - Motor harmonics (equally-spaced peaks)
   - Electrical noise (>500 Hz)
4. **Filter recommendation** — Maps the measured noise floor (dB) to a target cutoff frequency (Hz) via linear interpolation between safety bounds

#### Filter Safety Bounds

| Filter | Min Cutoff | Max Cutoff (no RPM) | Max Cutoff (with RPM) | Source |
|--------|-----------|--------------------|-----------------------|--------|
| Gyro LPF1 | 75 Hz | 300 Hz | 500 Hz | [BF Tuning Guide](https://www.betaflight.com/docs/wiki/guides/current/PID-Tuning-Guide): 50 Hz = "very noisy", 80 Hz = "slightly noisy"; 75 Hz is a conservative midpoint |
| D-term LPF1 | 70 Hz | 200 Hz | 300 Hz | [BF Filtering Wiki](https://github.com/betaflight/betaflight/wiki/Gyro-&-Dterm-filtering-recommendations): "70–90 Hz range" for D-term |

The **minimum cutoffs** are derived from the official Betaflight guides. The **maximum cutoffs** represent the point where further relaxation provides negligible latency benefit. With RPM filter active, maximums are raised because 36 per-motor notch filters already handle motor noise, so the lowpass can afford to be more relaxed.

**Propwash floor:** Gyro LPF1 is never pushed below 100 Hz (configurable per flight style) to preserve D-term responsiveness in the 50–100 Hz prop wash frequency range.

#### Noise-Based Targeting (Linear Interpolation)

The cutoff target is computed from the **worst-case noise floor** across roll and pitch axes (dB), mapped linearly to the cutoff range:

```
t = (noiseFloorDb - (-10)) / ((-70) - (-10))
targetHz = minHz + t × (maxHz - minHz)
```

| Noise Floor (dB) | Meaning | Gyro LPF1 Target | D-term LPF1 Target |
|-------------------|---------|-------------------|---------------------|
| **-10 dB** (very noisy) | Extreme vibration/noise | 75 Hz (min) | 70 Hz (min) |
| **-40 dB** (moderate) | Typical mid-range quad | ~188 Hz | ~135 Hz |
| **-70 dB** (very clean) | Pristine signal | 300 Hz (max) | 200 Hz (max) |

The -10 dB and -70 dB anchor points are calibrated from real Blackbox logs across various frame sizes (3"–7"). This is our own interpolation method — not a community standard — designed to produce **convergent** (idempotent) recommendations: same noise data always produces the same target, regardless of current settings.

#### Filter Decision Table

| Rule | Trigger Condition | Action | Confidence | Source / Rationale |
|------|-------------------|--------|------------|---------------------|
| **Noise floor → lowpass** | Overall noise = high or low | Set gyro/D-term LPF1 to noise-based target | High (noisy) / Medium (clean) | Linear interpolation from BF guide bounds (see above) |
| **Dead zone** | \|target − current\| ≤ 5 Hz | No change recommended | — | Prevents micro-adjustments that add no real benefit |
| **Resonance peak → cutoff** | Peak ≥ 12 dB above local floor AND below current cutoff | Lower cutoff to peakFreq − 20 Hz (clamped to bounds) | High | Strong resonance passing through the filter must be blocked |
| **Disabled gyro LPF + resonance** | gyro_lpf1 = 0 (disabled) AND resonance peak detected | Enable gyro LPF1 at peakFreq − 20 Hz | High | Common BF 4.4+ config with RPM filter; re-enable when needed |
| **Dynamic notch range** | Peak below `dyn_notch_min_hz` | Lower dyn_notch_min to peakFreq − 20 Hz (floor: 50 Hz) | Medium | Notch can't track peaks outside its configured range |
| **Dynamic notch range** | Peak above `dyn_notch_max_hz` | Raise dyn_notch_max to peakFreq + 20 Hz (ceiling: 1000 Hz) | Medium | Same as above, upper bound |
| **RPM → notch count** | RPM filter active AND dyn_notch_count > 1 | Reduce dyn_notch_count to 1 | High | Motor noise handled by RPM notches; fewer dynamic notches = less CPU + latency |
| **RPM → notch Q** | RPM filter active AND dyn_notch_q < 500 | Raise dyn_notch_q to 500 | High | Only frame resonances remain; narrower notch = less signal distortion |
| **RPM motor diagnostic** | RPM filter active AND motor harmonics still detected (≥ 12 dB) | Warning: check motor_poles / ESC telemetry | Medium | Motor harmonics should not exist with working RPM filter |
| **Deduplication** | Multiple rules target same setting | Keep more aggressive value, upgrade confidence | — | Ensures a single coherent recommendation per setting |

**RPM filter awareness:** When the RPM filter is active (detected via MSP or BBL headers), the recommender widens safety bounds because motor noise is already handled by the 36 narrow notch filters tracking motor frequencies. It also recommends dynamic notch optimization (count 3→1, Q 300→500) since only frame resonances remain. If motor harmonics are still detected with RPM active, a diagnostic warns about possible `motor_poles` misconfiguration or ESC telemetry issues.

#### Filter Methodology Sources

| Source | What We Use From It |
|--------|---------------------|
| [Betaflight PID Tuning Guide](https://www.betaflight.com/docs/wiki/guides/current/PID-Tuning-Guide) | Gyro LPF1 cutoff range (50–80 Hz for noisy quads), general filtering philosophy |
| [BF Filtering Wiki](https://github.com/betaflight/betaflight/wiki/Gyro-&-Dterm-filtering-recommendations) | D-term LPF1 "70–90 Hz" recommendation, dynamic notch configuration |
| [BF Configurator](https://github.com/betaflight/betaflight-configurator) | RPM-aware max cutoffs (verified against Configurator auto-adjust behavior) |
| [Oscar Liang: PID Filter Tuning](https://oscarliang.com/pid-filter-tuning-blackbox/) | Blackbox-based filter tuning workflow, noise floor interpretation |
| [PIDtoolbox](https://pidtoolbox.com/home) | Spectral analysis methodology, noise floor percentile approach |
| Real Blackbox logs (3"–7" quads) | Calibration of -10 dB / -70 dB noise anchor points |

### PID Tuning (Step Response Analysis)

PID tuning works by detecting sharp stick inputs ("steps") in the Blackbox log and measuring how the quad's gyro (actual rotation) tracks the pilot's command (setpoint).

**Pipeline:** `StepDetector` → `StepMetrics` → `PIDRecommender` (+ `PropWashDetector`, `DTermAnalyzer`, `CrossAxisDetector`)

#### Step 1: Detect Step Inputs

A "step" is a rapid, decisive stick movement. The detector scans setpoint data for each axis (roll, pitch, yaw):

1. Compute the setpoint derivative at each sample
2. Flag samples where |derivative| > 500 deg/s/s as potential step edges
3. Group consecutive high-derivative samples into a single edge
4. Validate each candidate:
   - **Minimum magnitude**: step must be ≥ 100 deg/s
   - **Hold time**: setpoint must hold near the new value for ≥ 50 ms (not just a transient spike)
   - **Cooldown**: at least 100 ms gap between consecutive steps (avoids rapid stick reversals)

#### Step 2: Measure Response Metrics

For each valid step, the algorithm extracts a 300 ms response window and computes:

| Metric | Definition | How It's Measured |
|--------|-----------|-------------------|
| **Rise time** | How fast the quad responds | Time from 10% to 90% of final gyro value |
| **Overshoot** | How much gyro exceeds the target | Peak deviation beyond steady-state, as % of step magnitude |
| **Settling time** | How quickly oscillations die out | Last time gyro exits the ±2% band around steady-state |
| **Latency** | Delay before first movement | Time until gyro moves >5% of step magnitude from baseline |
| **Ringing** | Post-step oscillation count | Zero-crossings around steady-state, counted as full cycles |
| **Steady-state error** | Accuracy after settling | Difference between target and actual position after settling |
| **FF energy ratio** | Feedforward vs P contribution | Sum-of-squares energy ratio `FF/(FF+P)` over step response window |

These metrics follow standard control theory definitions (consistent with MATLAB `stepinfo`).

#### Step 3: Generate PID Recommendations

The recommendation engine applies rule-based tuning logic anchored to the PID values from the Blackbox log header (the PIDs that were active during the flight). This anchoring makes recommendations **convergent** — applying them and re-analyzing the same log produces no further changes.

**Flight Style Thresholds:**

| Threshold | Smooth | Balanced | Aggressive |
|-----------|--------|----------|------------|
| Overshoot ideal | 3% | 10% | 18% |
| Overshoot max | 12% | 25% | 35% |
| Moderate overshoot | 8% | 15% | 25% |
| Settling max | 250 ms | 200 ms | 150 ms |
| Ringing max | 1 cycle | 2 cycles | 3 cycles |
| Sluggish rise time | 120 ms | 80 ms | 50 ms |
| Steady-state error max | 8% | 5% | 3% |

*Yaw axis uses relaxed thresholds (1.5× overshoot limit, 1.5× sluggish threshold).*

**PID Decision Table (Balanced thresholds shown):**

| Rule | Condition | Action | Step Size | Confidence | Rationale |
|------|-----------|--------|-----------|------------|-----------|
| **1a** | Overshoot > 25% (severity 1–2×) | D ↑ | +5 | High | D-term dampens bounce-back |
| **1a** | Overshoot > 25% (severity 2–4×) | D ↑ | +10 | High | Proportional step for faster convergence |
| **1a** | Overshoot > 25% (severity > 4×) | D ↑ | +15 | High | Extreme overshoot needs aggressive dampening |
| **1a** | Overshoot > 25% AND (severity > 2× OR D ≥ 60% of max) | P ↓ | -5 / -10 | High | D alone insufficient at extreme overshoot |
| **1b** | Overshoot 15–25% | D ↑ | +5 | Medium | Moderate overshoot, D-first strategy |
| **1c** | FF-dominated overshoot (FF > P at peak) | FF boost ↓ | -5 | Medium | Overshoot caused by feedforward, not P/D |
| **2** | Overshoot < 10% AND rise time > 80 ms | P ↑ | +5 | Medium | Sluggish response needs more authority |
| **3** | Ringing > 2 cycles | D ↑ | +5 | Medium | Oscillation = underdamped response |
| **4** | Settling > 200 ms AND overshoot < 15% | D ↑ | +5 | Low | Slow convergence, may have other causes |
| **5a** | Steady-state error > 5% | I ↑ | +5 / +10 | Medium / High | Tracking drift during holds, improves wind resistance |
| **5b** | Low error + slow settling + overshoot | I ↓ | -5 | Low | I-term oscillation pattern |

**Post-Processing Rules:**

| Rule | Condition | Action | Rationale |
|------|-----------|--------|-----------|
| **Damping ratio (underdamped)** | D/P < 0.45, no existing D rec | D ↑ to reach 0.45 ratio | Maintains healthy D/P balance |
| **Damping ratio (overdamped)** | D/P > 0.85, D was increased | P ↑ proportionally | Prevents excessive damping after D adjustment |
| **Damping ratio (overdamped)** | D/P > 0.85, no recs exist | D ↓ to reach 0.85 ratio | Reduces motor heat and noise |
| **D-term effectiveness (critical)** | D increase rec + dCritical flag | Upgrade confidence → High | D-term is doing useful dampening work, increase is safe |
| **D-term effectiveness (balanced)** | D increase rec + effectiveness 0.3–0.7 | Advisory note: monitor temps | D has some noise cost, user should check motor heat |
| **D-term effectiveness (low)** | D increase rec + effectiveness < 0.3 | Downgrade confidence → Low + redirect | D is mostly noise — improve filters before increasing D |
| **D-term effectiveness (low, decrease)** | D decrease rec + effectiveness < 0.3 | Advisory note appended | D may not be doing much dampening — filter issue? |
| **Prop wash (severe + D rec)** | Severe prop wash (≥ 5×) on axis with existing D ↑ | Upgrade confidence → High | Prop wash confirms D increase will help |
| **Prop wash (severe, no D rec)** | Severe prop wash (≥ 5×) on worst axis, no D rec | D ↑ +5 on worst axis | Medium | Prop wash oscillation during descents needs more dampening |
| **FF energy ratio** | P decrease rec + meanFFEnergyRatio > 0.6 | Downgrade confidence → Low | Overshoot is feedforward-dominated, not P-caused |

**Transfer Function Rules (Wiener deconvolution — used in Flash Tune and as fallback when no step inputs detected):**

The transfer function approach is based on [Plasmatree PID-Analyzer](https://github.com/Plasmatree/PID-Analyzer) by Florian Melsheimer (2018). PIDlab estimates the closed-loop transfer function H(f) from setpoint→gyro data via cross-spectral density: `H(f) = S_xy(f) / (S_xx(f) + ε)`, where ε is a noise-floor-based regularization term. A synthetic step response is derived by inverse-FFT of H(f) followed by cumulative integration (impulse → step). Classical control stability metrics (bandwidth, phase margin, gain margin) are extracted from the Bode plot representation.

| Rule | Condition | Action | Step Size | Confidence |
|------|-----------|--------|-----------|------------|
| **TF-1** | Phase margin < 45° (critical: < 30°) | D ↑ | +5 / +10 | Medium |
| **TF-2** | Synthetic overshoot > threshold | Same as Rule 1a | varies | Medium |
| **TF-3** | Bandwidth < 40 Hz (yaw: < 28 Hz), no overshoot | P ↑ | +5 | Medium |

All TF-derived recommendations are capped at "medium" confidence because Wiener deconvolution assumes a linear time-invariant (LTI) system, while real quads exhibit nonlinearities (TPA gain scheduling, anti-gravity, motor saturation, propeller aerodynamics). For this reason, Deep Tune's direct step response measurements (which observe the actual nonlinear system) produce higher-confidence recommendations.

**Safety Bounds:**

| Parameter | Min | Max |
|-----------|-----|-----|
| P gain | 20 | 120 |
| D gain | 15 | 80 |
| I gain | 30 | 120 |

**Key design decisions:**

- **D-first strategy for overshoot** — Increasing D (dampening) is always the first action. P is only reduced as a supplement when overshoot is extreme (>2× threshold) or D is already near its ceiling (≥60% of max). This is safer for beginners because lowering P too aggressively can make the quad feel unresponsive.
- **Proportional step sizing** — Step sizes scale with overshoot severity: ±5 for mild issues (baseline, consistent with FPVSIM guidance), ±10 for significant overshoot (2–4× threshold), and ±15 for extreme cases (>4× threshold). This reduces the number of tuning flights needed while staying within safety bounds. All changes are clamped to safe min/max ranges.
- **Flight-PID anchoring** — Recommendations target values relative to the PIDs recorded in the Blackbox header, not the FC's current values. This prevents recommendation drift when PIDs are changed between flights and log analysis.
- **Feedforward awareness** — The recommender detects whether feedforward is active from BBL headers (`feedforward_boost > 0`). At each step's overshoot peak, it compares `|pidF|` vs `|pidP|` magnitude. When overshoot is FF-dominated (FF contributes more than P), the engine skips P/D changes and instead recommends reducing `feedforward_boost`. The FF energy ratio (sum-of-squares over the response window) provides additional confidence gating for P-decrease recommendations.
- **Flight style adaptation** — PID thresholds adjust based on the user's profile flight style. Smooth (cinematic) pilots get tighter overshoot tolerances and accept slower response. Aggressive (racing) pilots tolerate more overshoot in exchange for maximum snap. The Balanced default matches the standard thresholds.
- **Damping ratio validation** — After all per-axis rules run, a post-processing step checks the D/P ratio stays within the 0.45–0.85 range. This ensures D and P remain balanced regardless of which individual rules fired.
- **D-term effectiveness gating** — When D-term effectiveness data is available (from `DTermAnalyzer`), D recommendations are gated in three tiers: ratio > 0.7 (dCritical) → confidence boosted to high; ratio 0.3–0.7 → allowed with "monitor motor temps" advisory; ratio < 0.3 → D increase downgraded to low confidence with "improve filters first" redirect. This prevents the common failure mode of blindly increasing D when the real problem is noise from inadequate filtering.
- **Prop wash integration** — When `PropWashDetector` finds severe oscillation (≥ 5× baseline energy in the 20–90 Hz band), the recommender either boosts confidence on an existing D-increase for the worst axis, or generates a new D +5 recommendation if none exists. Events below the moderate threshold (< 2×) or with fewer than 3 detections are ignored to avoid false positives. This directly connects the pilot's most common complaint ("my quad shakes when I descend") to an actionable PID change.

### Interactive Analysis Charts

Analysis results are visualized with interactive SVG charts (Recharts):

- **Spectrum Chart** — FFT noise spectrum per axis (roll/pitch/yaw), with noise floor reference lines and peak frequency markers. Helps users visually understand where noise lives in the frequency domain.
- **Step Response Chart** — Overlaid setpoint vs. gyro traces for individual steps, with prev/next navigation and a metrics overlay (overshoot %, rise time, settling time, latency). Shows exactly how the quad tracked each stick input.
- **Bode Plot** — Transfer function magnitude (dB) and phase (degrees) vs frequency. Shows bandwidth, gain margin, and phase margin from Wiener deconvolution. Available in Flash Tune wizard and AnalysisOverview.
- **Noise Comparison Chart** — Before/after spectrum overlay with per-axis dB delta indicators. Shows tuning improvement on completion.
- **Quality Trend Chart** — Flight quality score progression across tuning sessions. Minimum 2 data points to render.
- **Axis Tabs** — Shared roll/pitch/yaw/all tab selector for all chart types.

Charts are integrated directly into the tuning wizard steps (filter analysis, PID analysis, quick analysis) as collapsible sections, open by default.

### Safety & Rollback
- All tuning changes create an automatic safety snapshot before applying
- One-click rollback to any previous configuration via CLI command replay
- Safety bounds prevent extreme PID and filter values
- Plain-English explanations accompany every recommended change

### Tuning Methodology Sources

The autotuning rules and thresholds are based on established FPV community practices:

| Source | Used For |
|--------|----------|
| [Betaflight PID Tuning Guide](https://www.betaflight.com/docs/wiki/guides/current/PID-Tuning-Guide) | P/I/D role definitions, overshoot→D rule, bounce-back diagnostics |
| [FPVSIM Step Response Guide](https://fpvsim.com/how-tos/step-response-pd-balance) | P/D balance via step response graphs, ±5 step size, baseline values |
| [Plasmatree PID-Analyzer](https://github.com/Plasmatree/PID-Analyzer) | Wiener deconvolution reference implementation, transfer function approach |
| [Oscar Liang: PID Filter Tuning](https://oscarliang.com/pid-filter-tuning-blackbox/) | Blackbox-based tuning workflow, PIDToolBox methodology |
| [PIDtoolbox](https://pidtoolbox.com/home) | Overshoot 10–15% as ideal range for multirotors, spectral analysis |
| [UAV Tech Tuning Principles](https://theuavtech.com/tuning/) | D-gain as damper, P-gain authority, safety-first approach |
| [FPVtune](https://dev.to/fpvtune/i-built-an-auto-pid-tuning-tool-for-betaflight-heres-how-it-works-under-the-hood-okg) | Prop wash detection, D-term effectiveness ratio concepts |
| Standard control theory (rise time, settling, overshoot definitions) | Metric definitions consistent with MATLAB `stepinfo` |

## Known Limitations

- MSP v1 only (v2 support planned)
- Requires test flights in a safe environment
- Huffman-compressed Blackbox data not yet supported (rare, BF 4.1+ feature)
- Feedforward: detection and FF-aware PID recommendations implemented; direct FF parameter tuning (writing `feedforward_boost` via MSP) not yet supported
- Prop wash detection and D-term effectiveness: backend analysis complete, UI visualization pending
- Bayesian PID optimizer: framework and tests complete, integration into recommendation pipeline pending
- Throttle spectrogram: analysis module complete, UI visualization pending

## Development Roadmap

- **Phase 1**: ✅ MSP connection, profiles, snapshots
- **Phase 2**: ✅ Blackbox analysis, automated tuning, rollback
- **Phase 2.5**: ✅ UX polish — profile simplification, interactive analysis charts
- **Phase 3**: ✅ Mode-aware wizard, read-only analysis overview, flight guides
- **Phase 4**: ✅ Stateful Deep Tune workflow with smart reconnect, verification flight, tuning history
- **Phase 5**: ⬜ Complete manual testing & UX polish (real hardware validation)
- **Phase 6**: ✅ CI/CD & cross-platform releases (macOS/Windows/Linux installers)
- **Phase 7a**: ✅ Playwright E2E tests (demo mode, 25 tests)
- **Phase 7b**: ⬜ E2E tests on real FC in CI pipeline

See [SPEC.md](./SPEC.md) for detailed requirements and phase tracking.

## License

MIT

## Acknowledgments

- **[Plasmatree PID-Analyzer](https://github.com/Plasmatree/PID-Analyzer)** by Florian Melsheimer — pioneered Wiener deconvolution for FPV PID tuning (2018). PIDlab's Flash Tune mode reimplements this technique: cross-spectral density transfer function estimation with noise-floor-based regularization, 2-second Hanning windows, and Welch averaging. The key insight that normal stick inputs contain sufficient broadband energy to identify the closed-loop transfer function without dedicated test maneuvers is due to Melsheimer's work.
- **[PIDtoolbox](https://github.com/bw1129/PIDtoolbox)** by bw1129 — extended the Plasmatree approach with an interactive GUI, throttle-dependent spectral analysis, and refined step response visualization. PIDlab's spectral analysis methodology and overshoot ideal ranges draw on PIDtoolbox's work.
- **[Betaflight](https://betaflight.com/)** — the open-source flight controller firmware that makes all of this possible. PIDlab communicates via MSP protocol and validates against BF Explorer's binary log parser.

## Contributing

Contributions welcome! Please open an issue first to discuss changes.
