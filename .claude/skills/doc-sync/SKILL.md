---
name: doc-sync
description: >
  Audit and fix documentation accuracy after code changes. Verifies README decision tables,
  feature descriptions, test counts, and all MD files against the actual codebase.
  Run before every PR merge.
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Agent
---

# Documentation Sync Audit

You are a documentation accuracy auditor for the PIDlab codebase. Your job is to ensure all
markdown files are factually correct and consistent with the code. You catch stale descriptions,
wrong thresholds, outdated counts, and misleading text.

## When to Run

Run `/doc-sync` before merging any PR that changes:
- Analysis logic (`src/main/analysis/`)
- IPC handlers (`src/main/ipc/handlers/`)
- UI components or hooks (`src/renderer/`)
- Types (`src/shared/types/`)
- Constants (`src/shared/constants*`, `src/main/analysis/constants.ts`)
- Test files (any `*.test.ts`)

## Audit Procedure

### Step 1: Gather current state

Run these commands to get authoritative numbers:

```bash
# Test counts
npm run test:run 2>&1 | tail -5

# Test file count
find src -name '*.test.ts' -o -name '*.test.tsx' | wc -l

# E2E test count
grep -r 'test(' e2e/*.spec.ts | wc -l

# Analysis module count
ls src/main/analysis/*.ts | grep -v test | grep -v constants | grep -v index | wc -l

# IPC handler counts per module
grep -c 'ipcMain.handle' src/main/ipc/handlers/*.ts 2>/dev/null || true

# Hook count
ls src/renderer/hooks/*.ts | grep -v test | wc -l

# E2E spec file count
ls e2e/*.spec.ts | wc -l
```

### Step 2: Verify decision tables against code

**Filter Decision Table** (README "Filter Decision Table"):

Read these files and verify every row in the table:
- `src/main/analysis/FilterRecommender.ts` — all filter rules
- `src/main/analysis/DynamicLowpassRecommender.ts` — dynamic lowpass rules
- `src/main/analysis/constants.ts` — thresholds and bounds

Check for each rule:
- Trigger condition matches the code's `if` conditions
- Action matches the code's recommendation output
- Confidence level matches the code's `confidence` field
- Step sizes / threshold values are exact

**PID Decision Table** (README "PID Decision Table"):

Read these files:
- `src/main/analysis/PIDRecommender.ts` — all PID rules
- `src/main/analysis/constants.ts` — PID thresholds, style thresholds, bounds

Check for each rule:
- Threshold values match `PID_STYLE_THRESHOLDS` and other constants
- Step sizes match code (`dStep`, `pStep`, `iStep` variables)
- Severity scaling matches (`severity > 4 ? 15 : severity > 2 ? 10 : 5`)
- Confidence levels match code
- Post-processing rules match `validateDampingRatio`, `applyDTermEffectiveness`, etc.

**Transfer Function Rules** (README "Transfer Function Rules"):

Read `PIDRecommender.ts` function `generateFrequencyDomainRecs`:
- Phase margin thresholds
- Bandwidth thresholds per style
- DC gain threshold
- Step sizes

**Flight Style Thresholds Table:**

Compare README table against `PID_STYLE_THRESHOLDS` in constants.ts — every cell.

**Safety Bounds Table:**

Compare README table against `QUAD_SIZE_BOUNDS` in constants.ts.

**Filter Safety Bounds Table:**

Compare against `GYRO_LPF1_MIN_HZ`, `GYRO_LPF1_MAX_HZ`, etc.

### Step 3: Verify feature descriptions

Read the Features section of README and check each bullet against actual implementation:
- Step detection parameters (magnitude, hold time, cooldown) vs `constants.ts`
- Step response window (300 ms) vs `STEP_RESPONSE_WINDOW_MS`
- Noise classification bands vs `FRAME_RESONANCE_MIN_HZ`, `ELECTRICAL_NOISE_MIN_HZ`
- Data quality sub-score weights vs `DataQualityScorer.ts`
- Throttle spectrogram band count (10) vs `ThrottleSpectrogramAnalyzer.ts`
- ThrottleTF band count (5) vs `ThrottleTFAnalyzer.ts`
- Prop wash frequency range vs `PROPWASH_FREQ_MIN_HZ`, `PROPWASH_FREQ_MAX_HZ`
- Dynamic lowpass thresholds (6 dB, Pearson 0.6) vs `DynamicLowpassRecommender.ts`
- Ringing SNR filter threshold vs `RINGING_MIN_AMPLITUDE_FRACTION`

### Step 4: Cross-file count consistency

These numbers must match across all files where they appear:

| Metric | Files to check |
|--------|---------------|
| Unit test count | README.md, TESTING.md, ARCHITECTURE.md, SPEC.md |
| Test file count | README.md, TESTING.md, ARCHITECTURE.md |
| E2E test count | README.md, TESTING.md, ARCHITECTURE.md |
| Analysis module count | README.md, CLAUDE.md, ARCHITECTURE.md |
| IPC handler count | CLAUDE.md, ARCHITECTURE.md |
| Hook count | ARCHITECTURE.md |

### Step 5: Verify text accuracy

Scan for common stale patterns:
- Numbers that don't match code (grep for specific values)
- Features described as "planned" or "pending" that are actually implemented
- Features described as working that were removed
- Incorrect file paths in project structure tree
- Code comments with wrong threshold values (like the dCritical > 1.5 bug)

### Step 6: Fix issues

For each issue found:
1. State the file, line, and what's wrong
2. State what the correct value/text should be (cite the source file)
3. Apply the fix using Edit tool

## Output Format

```
## Doc Sync Report

### Counts
- Unit tests: [actual] (README: [x], TESTING: [x], ARCH: [x], SPEC: [x])
- Test files: [actual] (README: [x], TESTING: [x])
- E2E tests: [actual] (README: [x])
- Analysis modules: [actual] (README: [x])

### Decision Table Audit
- [x] Filter table: N rules checked, M issues
- [x] PID table: N rules checked, M issues
- [x] TF rules: N rules checked, M issues
- [x] Style thresholds: all cells match / N mismatches
- [x] Safety bounds: all cells match / N mismatches

### Feature Description Audit
- [list of issues found, or "all accurate"]

### Text Issues
- [list of stale/wrong text, or "none found"]

### Fixes Applied
- [list of edits made]
```

## Important Rules

- **Code is the source of truth** — if README says -5 but code says -3, the code is right
- **Check every number** — don't assume a threshold is correct just because it looks reasonable
- **Cross-reference constants** — many values in README come from `constants.ts`, verify them
- **Watch for conditions** — "RPM active AND noise < -45 dB" is different from just "noise < -45 dB"
- **Confidence matters** — 'low' vs 'medium' vs 'high' must match exactly
- **Don't skip post-processing rules** — damping ratio, D-term effectiveness, prop wash context
- **Comments count too** — fix stale code comments alongside README (like the dCritical threshold)
