# Tuning Workflow Backend Fixes

Tracking document for fixing the two-flight tuning workflow orchestration issues.

**Created**: 2026-02-11
**Context**: Backend engines (parser, FFT, step response, recommenders) work correctly for both flight types. The issues are in workflow orchestration — state machine transitions and UI action availability.

---

## Problem Overview

| ID | Severity | Problem | Status |
|----|----------|---------|--------|
| P2 | Critical | Download/Analyze blocked during tuning session (readonly) | ✅ Done (PR #42) |
| P1 | Critical | Phase transitions after apply never happen | ✅ Done (PR #43) |
| P3 | Medium | appliedFilterChanges/PIDChanges never populated | ✅ Done (PR #43) |
| P4 | Low | No flight type validation warning in filter analysis | ✅ Done (PR #44) |
| P5 | Low | No post-apply snapshot | ✅ Done (PR #45) |

---

## P2: Download/Analyze Blocked During Tuning Session

### Problem

When a tuning session is active, `BlackboxStatus` enters `readonly` mode (`App.tsx:210`), which hides **all** action buttons: Download, Erase Flash, Test Read, Analyze.

The `TuningStatusBanner` has actions like "Download Log" (`filter_log_ready` phase) but the handler just shows a toast: "Use the Download button in Blackbox Storage below" — **but that button is hidden** by readonly mode.

Similarly, "Open Filter Wizard" needs `activeLogId` which requires clicking Analyze on a downloaded log — also hidden.

### Impact

After smart reconnect detects flight data and transitions to `*_log_ready`, the user **cannot download the log or start analysis** through the standard flow.

### Solution

The `readonly` prop should not hide Download and Analyze buttons during tuning. Instead, readonly should be **phase-aware**:

- During `*_flight_pending` phases: hide Download/Analyze (no log yet), show Erase Flash only via banner
- During `*_log_ready` phases: show Download (user needs it), hide Erase
- During `*_analysis` phases: show Analyze on downloaded logs, hide Download/Erase
- During other phases: current readonly behavior is fine

**Approach**: Replace boolean `readonly` with a more granular system. The simplest approach: make `TuningStatusBanner` handle Download and Analyze actions directly (not delegating to BlackboxStatus), and keep BlackboxStatus readonly for Erase Flash only.

**Concrete changes**:
1. `TuningStatusBanner` "Download Log" action → calls `window.betaflight.downloadBlackboxLog()` directly, then triggers phase transition to `*_analysis`
2. `TuningStatusBanner` "Open Filter/PID Wizard" action → opens wizard with the just-downloaded logId
3. `BlackboxStatus` readonly stays — it correctly hides manual actions during guided tuning
4. Need to store downloaded `logId` in tuning session or pass through App state

### PR

Branch: `fix/tuning-download-during-session`

---

## P1: Phase Transitions After Apply Never Happen

### Problem

Phases `filter_applied` and `pid_applied` exist in `TuningPhase` type and have UI entries in `TuningStatusBanner` (lines 52-58, 78-83), but **no code ever sets them**:

- After successful filter apply, wizard shows "Filters applied!" but session stays in `filter_analysis`
- `filter_applied` → `pid_flight_pending` transition never happens
- Same for `pid_analysis` → `pid_applied`
- Smart reconnect only handles `*_flight_pending` phases

### Impact

The state machine is frozen after apply. The user sees stale banner text. The workflow cannot progress to the next flight phase automatically.

### Solution

After successful apply in `useTuningWizard.confirmApply()`:
1. Call `tuning.updatePhase()` to transition to the `*_applied` phase with applied changes data
2. Add transition from `filter_applied` → `pid_flight_pending` (triggered by "Continue" button in banner, which already maps to `erase_flash` action)
3. Add transition from `pid_applied` → `verification_pending` or `completed`

**Concrete changes**:
1. `useTuningWizard.ts`: After successful apply, call `updatePhase('filter_applied', { appliedFilterChanges })` or `updatePhase('pid_applied', { appliedPIDChanges })`
2. `App.tsx handleTuningAction('erase_flash')`: When current phase is `filter_applied`, also transition to `pid_flight_pending`
3. Need to thread `tuning.updatePhase` into TuningWizard (currently wizard has no access to tuning session hook)

### PR

Branch: `fix/tuning-phase-transitions`

---

## P3: appliedFilterChanges/PIDChanges Never Populated

### Problem

`TuningSession` has `appliedFilterChanges` and `appliedPIDChanges` fields (tuning.types.ts:56,62). These are defined, typed, and even tested in `TuningSessionManager.test.ts:115`, but **never populated** during the actual apply flow.

### Impact

- PID phase has no reference of what filters were applied
- No audit trail of changes made during tuning
- Session data is incomplete for debugging

### Solution

This is largely solved by P1 — when `confirmApply` calls `updatePhase('filter_applied', { appliedFilterChanges })`, the changes get stored. The remaining work is to **build the `AppliedChange[]` array** from the apply result.

**Concrete changes**:
1. `TUNING_APPLY_RECOMMENDATIONS` IPC handler: return the list of actual changes (setting, previousValue, newValue) in `ApplyRecommendationsResult`
2. `useTuningWizard.confirmApply()`: use the returned changes to populate session data via `updatePhase()`

### PR

Branch: `fix/tuning-applied-changes-tracking` (or combined with P1)

---

## P4: No Flight Type Validation Warning in Filter Analysis

### Problem

If user uploads a PID-type flight (stick snaps) for filter analysis:
- `SegmentSelector` fails to find throttle sweeps or steady hovers
- Falls back to analyzing the **entire flight** as one block
- Produces noisy FFT spectrum with false peaks from stick transients
- **No warning** to the user about degraded quality

PID analysis handles the reverse case gracefully: "No step inputs detected."

### Solution

Add a warning/diagnostic when `SegmentSelector` falls back to the entire flight.

**Concrete changes**:
1. `FilterAnalyzer.ts`: When segment selection falls back to entire flight, add a warning to the result
2. `analysis.types.ts`: Add `warnings` field to `FilterAnalysisResult` (or use existing `diagnostics`)
3. UI: Display warning in FilterAnalysisStep when present

### PR

Branch: `fix/filter-analysis-segment-warning`

---

## P5: No Post-Apply Snapshot

### Problem

During apply, only a "Pre-tuning (auto)" snapshot is created **before** changes. No snapshot captures the state **after** applying filter/PID changes. For rollback, only the pre-apply state is available.

### Solution

After successful apply + FC reboot + reconnect, create a "Post-filter-tune (auto)" or "Post-PID-tune (auto)" snapshot automatically.

**Concrete changes**:
1. In `src/main/index.ts` smart reconnect: when transitioning from `filter_applied`, create auto snapshot
2. Or: in the apply handler after `saveAndReboot()`, note that a post-apply snapshot is needed on next connect
3. Store `pendingPostApplySnapshot: boolean` in session to trigger on reconnect

### PR

Branch: `fix/tuning-post-apply-snapshot`

---

## Implementation Order

1. **P2** first — unblocks the basic download/analyze flow during tuning
2. **P1** + **P3** together — fix phase transitions and populate applied changes
3. **P4** — add filter analysis warnings
4. **P5** — add post-apply snapshots

Each fix gets its own PR, merged immediately after tests pass.
