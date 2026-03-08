# PIDlab — Project Quality Report

> **Date**: February 14, 2026 | **Snapshot**: Phase 4 & 6 Complete | **1700 tests, 91 files**
>
> This is a point-in-time quality assessment. It will not be updated.

---

## What It Is

A desktop application (Electron + TypeScript + React) that connects to a Betaflight flight controller over USB, guides the pilot through two short test flights, analyzes Blackbox data automatically (FFT noise analysis for filters, step response metrics for PIDs), and applies optimized settings with one click. No graph reading, no spreadsheets, no guesswork.

**Workflow:** Connect FC → Fly hover + throttle sweeps → App tunes filters → Fly stick snaps → App tunes PIDs → Done.

---

## By the Numbers

| Metric | Value |
|--------|-------|
| Lines of code | ~15,000 (TypeScript, excluding tests) |
| Tests | 1,700 tests across 91 files |
| Test types | Unit, fuzz, real-data regression, E2E workflow |
| Modules | MSP protocol, BBL parser, FFT engine, step response engine, data quality scoring, 10-phase state machine, snapshot/rollback system |
| Platforms | macOS (.dmg), Windows (.exe), Linux (.AppImage) |
| CI/CD | GitHub Actions — lint, typecheck, tests on every PR, cross-platform release on tag |
| Code quality | 0 TODO/FIXME/HACK in entire source, 0 `any` types in production code, ESLint + Prettier enforced |
| PRs merged | #1–#120 |

---

## Technical Quality Assessment: 7.8/10

| Area | Score | Commentary |
|------|-------|-----------|
| Architecture | 8/10 | Clean process separation, modular IPC (11 domain modules), event-driven. Weakness: App.tsx root component is overly complex (454 lines, 13 useState, 22 handlers) |
| Type safety | 8.5/10 | Zero `any`, zero `@ts-ignore` in production code. One gap: `HandlerDependencies` interface uses `any` for manager types |
| Error handling | 7.5/10 | Main process consistent (120 catch blocks, custom error types, no swallowed errors). Renderer weaker — no retry in hooks, missing error boundary around wizard views |
| Testing | 8.5/10 | 1,700 tests, fuzz testing, real-data regression, E2E workflow. Missing: integration tests for full IPC round-trips, load tests, visual regression |
| Security | 7/10 | No eval/innerHTML/dangerouslySetInnerHTML, context isolation enabled. Missing: CSP header, file path validation in export/open folder handlers |
| Code cleanliness | 8/10 | Zero TODO/FIXME/HACK comments. Minimal duplication. Well-organized file structure |
| Documentation | 9/10 | 19 MD files, comprehensive CLAUDE.md, design docs with lifecycle tracking, mandatory per-PR doc update rule |

### Top 3 Technical Improvements Available

1. **Extract App.tsx business logic into custom hooks** — Move the 112-line `handleTuningAction` switch statement into `useTuningActions()`, modal state into `useModalState()`. Reduces root component from 454 to ~220 lines.
2. **Add CSP header and path validation** — Content-Security-Policy in Electron window, validate file paths in export/open handlers. Defense-in-depth.
3. **Fix HandlerDependencies type safety** — Replace `any` with proper MSPClient/SnapshotManager/etc. types at the IPC routing layer.

---

## Functional Quality Assessment: 8.5/10

### Five Algorithmic Properties No Other Open-Source Tool Has

**1. Convergent Recommendations (Idempotent)**

Recommendations derive from absolute physical measurements (noise floor in dB → cutoff frequency in Hz via linear interpolation), not relative heuristics. Consequence: applying recommendations and re-analyzing the same flight produces identical results. No drift, no guessing, no infinite iterations. Neither PIDtoolbox nor Plasmatree have this property.

**2. Flight-PID Anchoring**

PID recommendations anchor to values from the Blackbox header (PIDs active during the flight), not the FC's current values. This prevents the classic problem: "I changed P to 55, re-analyzed, and now it says P=60" — exponential drift. PIDlab always recommends the same target values from the same data, regardless of current FC state.

**3. Feedforward-Aware PID Analysis**

When overshoot is caused by feedforward (not P-gain), increasing D won't help. PIDlab compares |pidF| vs |pidP| at each step's overshoot peak. If the majority of steps are FF-dominated, it skips P/D rules and recommends reducing `feedforward_boost` instead. No other tool even detects FF in the context of PID tuning.

**4. RPM Filter-Aware Safety Bounds**

When the RPM filter is active (detected via MSP or BBL headers), motor harmonics are already covered by 36 narrow RPM notch filters. PIDlab widens safety bounds (gyro LPF1 max 300→500 Hz, D-term max 200→300 Hz) and recommends dynamic notch optimization (count 3→1, Q 300→500). If motor harmonics persist with RPM active → diagnostic warns about `motor_poles` misconfiguration or ESC telemetry issues.

**5. Data Quality Scoring**

Before generating any recommendations, rates input data quality 0-100 (excellent/good/fair/poor). Four weighted sub-scores (segment count, hover time, throttle coverage, axis coverage). On low quality, automatically downgrades recommendation confidence and warns the pilot: "Your hover was too short — recommendations have reduced confidence." No other tool validates input data quality upfront.

### Technical Depth

**Blackbox Parser** (1,200 lines, 245 tests) — Implements 10 encoding types and 10 predictor types, validated byte-for-byte against Betaflight Explorer. Handles multi-session files, corruption recovery (byte-by-byte rewind matching BF Explorer), and passes fuzz testing with random data.

**FFT Analysis** — Welch's method, Hanning window, 4096-sample window, 50% overlap. Prominence-based peak detection with noise source classification (frame resonance 80-200 Hz, motor harmonics via equally-spaced peak detection, electrical noise >500 Hz). Noise floor via lower quartile of PSD.

**Step Response Analysis** — Derivative-based step detection (500 deg/s/s threshold), 5 metrics compatible with MATLAB `stepinfo` (rise time 10%→90%, overshoot, settling ±2% band, latency 5% threshold, ringing zero-crossing count). Each step carries a `StepResponseTrace` (Float64Array) for interactive chart visualization. Steps classified as `ffDominated` via `|pidF|` vs `|pidP|` comparison.

**Tuning State Machine** — 10-phase workflow (filter_flight_pending → filter_log_ready → filter_analysis → filter_applied → pid_flight_pending → ... → verification_pending → completed) with persistence to disk, smart reconnect detection, and automatic phase advancement when flight data is detected.

**Snapshot/Rollback System** — Every change creates a safety snapshot. Three automatic snapshots per tuning cycle (pre-tuning, post-filter, post-tuning). One-click rollback via CLI command replay with safety backup before restore.

### Known Algorithmic Limitations

1. **Step detection requires dedicated test flights** — Stick snaps needed; general freestyle/race flights produce no PID recommendations. Wiener deconvolution (planned) would solve this.
2. **Proportional step sizing (±5/±10/±15)** — Severity-based scaling implemented (PR #137). D step scales with overshoot severity; mild cases use ±5 (FPVSIM baseline), extreme cases up to ±15. All clamped to safe bounds.
3. **Single-point FFT** — Averages across entire hover segment; doesn't capture noise vs throttle relationship. Throttle-indexed spectrograms (planned) would improve this.
4. **No transfer function estimation** — Bandwidth, gain/phase margins unknown. No Bode plots. Wiener deconvolution (planned) would enable this.

---

## Competitive Positioning

| Capability | PIDlab | PIDtoolbox | BF Configurator | Plasmatree PID-Analyzer |
|---|:---:|:---:|:---:|:---:|
| Automatic tuning recommendations | **Yes** | No | No | No |
| Convergent (idempotent) | **Yes** | No | — | No |
| FF-aware PID analysis | **Yes** | No | — | No |
| RPM-aware filter bounds | **Yes** | No | — | No |
| Data quality scoring | **Yes** | No | — | No |
| Guided two-flight workflow | **Yes** | No | — | No |
| One-click apply + rollback | **Yes** | No | No | No |
| Transfer function (Wiener) | Planned | Yes | — | Yes |
| Chirp analysis | Planned | Yes | — | — |
| Throttle spectrogram | Planned | Yes | — | Yes |
| UI/UX | Desktop app | MATLAB GUI | Web | CLI only |
| Price | Free / open-source | MATLAB license | Free | Free |
| Cross-platform | macOS/Win/Linux | MATLAB | Web | Python CLI |

Existing tools (PIDtoolbox, BF Configurator Blackbox viewer, Plasmatree PID-Analyzer) show pilots graphs and leave them to interpret. PIDlab goes a step further — it **automatically decides what to change, explains why, and applies it with one click**.

The tools that have more advanced analysis capabilities (Wiener deconvolution, chirp analysis) require either a MATLAB license, a Python CLI, or manual graph interpretation. None of them offer convergent recommendations, FF-awareness, RPM-aware bounds, data quality scoring, or a guided workflow.

---

## Community Value

Most FPV pilots tune their drones by trial and error: change a number, fly, check if it's better, repeat. Experienced pilots spend hours in PIDtoolbox interpreting FFT spectra and step response graphs. Beginners give up and fly on stock PIDs.

PIDlab addresses both:

- **For beginners** — Structured workflow with plain-English explanations ("Your quad has noise at 150 Hz — we're lowering the gyro filter to clean it up"). Data quality warnings prevent false confidence from bad test flights.
- **For experienced pilots** — "Analyze and apply" saves hours of manual interpretation. Tuning history tracks improvements across sessions.
- **For everyone** — Safety net with automatic snapshots, one-click rollback, and transparent reasoning for every recommendation.

Key insight: this is not an "AI tuner" or a black box. The algorithms are deterministic, transparent, and grounded in established FPV tuning practices (Betaflight tuning guide, FPVSIM step response methodology, Oscar Liang's Blackbox tuning guides, UAV Tech tuning principles). Every recommendation explains its reasoning. The pilot always sees what changes and why.

### Who Benefits Most

- **Beginner pilots (5-50 hours)** — Need structured guidance and confidence
- **Lazy veteran pilots** — "Just analyze and apply" workflow
- **Pilots with mechanical issues** — Early noise warnings ("extreme noise detected, check props/bearings")
- **Iterative tuners** — History panel shows convergence across multiple flights

### Who Benefits Less

- **Extreme racers** — Proportional scaling (PR #137) now handles extreme overshoot faster, but still uses discrete tiers rather than continuous scaling
- **Perfectionist tuners** — No Bode plots, no ARX system identification (yet)

---

## Current Status and What's Next

Phases 1-4 and 6 are complete. The application is functional, tested, documented, with a full CI/CD pipeline producing cross-platform installers.

The single critical step before community release: **real hardware testing (Phase 5)** — validating that recommendations actually improve flight characteristics, not just that algorithms produce mathematically correct output.

On the roadmap are advanced features (Wiener deconvolution for analyzing any flight, throttle spectrograms, proportional PID scaling, chirp analysis for BF 4.6+), but even without them, this is **the most comprehensive open-source autotuning tool for Betaflight that exists**.

---

## Architecture Overview

```
Electron App
├── Renderer (React)
│   ├── Dashboard: Connection, FC Info, Blackbox, Snapshots, Tuning History
│   ├── TuningWizard: Guided multi-step analysis + apply (filter/PID modes)
│   ├── AnalysisOverview: Read-only analysis (no tuning session)
│   ├── Interactive Charts: FFT spectrum, step response (Recharts SVG)
│   └── 11 Custom Hooks: useConnection, useProfiles, useTuningSession, ...
│
├── Preload Bridge (527 lines)
│   └── window.betaflight API (44 IPC channels, 14 event types)
│
└── Main Process (Node.js)
    ├── IPC Handlers (1,822 lines, 11 domain modules)
    ├── MSP Protocol Layer (MSPProtocol, MSPConnection, MSPClient)
    ├── Blackbox Parser (6 modules, 245 tests)
    ├── Analysis Engine (11 modules: FFT + Step Response + Data Quality)
    ├── Storage Layer (Profile, Snapshot, Blackbox, Session, History managers)
    └── MSC Manager (SD card blackbox via Mass Storage Class mode)
```

---

*Report generated February 14, 2026. Reflects the state of the codebase at commit aca8bc7 (PR #121).*
