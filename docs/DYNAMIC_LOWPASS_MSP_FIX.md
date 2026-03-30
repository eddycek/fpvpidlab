# Dynamic Lowpass MSP Fix

> **Status**: Proposed

## Problem

FPVPIDlab does not read dynamic lowpass parameters from MSP_FILTER_CONFIG, causing three critical issues:

1. **Invisible dynamic mode**: When a user's FC has dynamic lowpass enabled (e.g., `gyro_lpf1_dyn_min_hz=250`, `dyn_max_hz=500`), the app doesn't know. It reports only the static fallback value (`gyro_lpf1_static_hz=193`), which has no effect when dynamic is active.

2. **Ineffective recommendations**: `FilterRecommender` tunes `gyro_lpf1_static_hz` and `dterm_lpf1_static_hz`, which are overridden by the active dynamic filter. Users apply changes that do nothing.

3. **False "enable dynamic" recommendations**: `DynamicLowpassRecommender` hardcodes `currentValue: 0` for all dynamic fields, so it recommends "enabling" dynamic lowpass when it's already running — potentially overwriting the user's existing (and possibly better) min/max values.

### Discovery

Found during a live tuning session on a SpeedyBee F405 Mini (4", BF 4.5.2). After applying filter changes, Betaflight Configurator showed dynamic lowpass active at 250/500 Hz, while our app reported a static cutoff of 193 Hz and claimed `dyn_notch_count` changed from 5→3 (it didn't).

### Root Cause

`MSPClient.getFilterConfiguration()` parses MSP_FILTER_CONFIG (command 92) but skips 8 bytes that contain dynamic lowpass state:

| Offset | Field | Status |
|--------|-------|--------|
| 17 | `dterm_lpf1_type` (U8) | **Not read** — needed for filter shape (PT1/PT2/PT3/biquad) |
| 24 | `gyro_lpf1_type` (U8) | **Not read** — needed for group delay estimation |
| 25 | `gyro_lpf2_type` (U8) | **Not read** — low priority |
| 28 | `dterm_lpf2_type` (U8) | **Not read** — low priority |
| 29-30 | `gyro_lpf1_dyn_min_hz` (U16) | **Not read** — CRITICAL |
| 31-32 | `gyro_lpf1_dyn_max_hz` (U16) | **Not read** — CRITICAL |
| 33-34 | `dterm_lpf1_dyn_min_hz` (U16) | **Not read** — CRITICAL |
| 35-36 | `dterm_lpf1_dyn_max_hz` (U16) | **Not read** — CRITICAL |

The `CurrentFilterSettings` type only partially defines these: `dterm_lpf1_dyn_min_hz` and `dterm_lpf1_dyn_expo` exist, but gyro dynamic fields and `dterm_lpf1_dyn_max_hz` are missing entirely.

## Betaflight Dynamic Lowpass Behavior

Understanding the FC-side behavior is critical for correct recommendations.

**Activation**: Dynamic mode activates when `dyn_min_hz > 0`. When `dyn_min_hz == 0`, static mode uses `static_hz`.

**Throttle tracking**: Cutoff ramps with throttle position:
- Low throttle → cutoff near `dyn_min_hz` (tighter filtering, more noise rejection)
- High throttle → cutoff near `dyn_max_hz` (filter relaxes, motor noise shifts to higher frequencies handled by RPM/notch)

**Static as floor**: When dynamic is active, `static_hz` acts as a hard minimum. BF enforces `static_hz <= dyn_min_hz`.

**Dynamic expo** (`dterm_lpf1_dyn_expo`, BF 4.5+, 0-10, default 5): Controls how aggressively cutoff tracks throttle. Higher = cutoff rises faster.

**Filter type** (`gyro_lpf1_type`): 0=PT1, 1=BIQUAD, 2=PT2, 3=PT3. Determines filter shape for both static and dynamic modes. Affects group delay calculation.

**RPM interaction**: With RPM filter active, dynamic lowpass provides less benefit (motor harmonics already tracked). Community presets with RPM typically use higher static cutoffs or narrower dynamic ranges.

## Implementation Plan

### Task 1: Extend CurrentFilterSettings type

**File**: `src/shared/types/analysis.types.ts`

Add missing fields to `CurrentFilterSettings`:
```typescript
// Dynamic lowpass (already partially defined)
gyro_lpf1_dyn_min_hz?: number;   // NEW
gyro_lpf1_dyn_max_hz?: number;   // NEW
dterm_lpf1_dyn_max_hz?: number;  // NEW
// dterm_lpf1_dyn_min_hz already exists
// dterm_lpf1_dyn_expo already exists

// Filter types (for group delay accuracy)
gyro_lpf1_type?: number;   // NEW: 0=PT1, 1=BIQUAD, 2=PT2, 3=PT3
dterm_lpf1_type?: number;  // NEW
gyro_lpf2_type?: number;   // NEW (low priority)
dterm_lpf2_type?: number;  // NEW (low priority)
```

Update `DEFAULT_FILTER_SETTINGS` to include BF defaults:
```typescript
gyro_lpf1_dyn_min_hz: 0,   // 0 = dynamic off (static mode)
gyro_lpf1_dyn_max_hz: 0,
dterm_lpf1_dyn_min_hz: 0,
dterm_lpf1_dyn_max_hz: 0,
```

### Task 2: Read all missing MSP fields

**File**: `src/main/msp/MSPClient.ts`

Add extraction for all missing bytes in `getFilterConfiguration()`:

```
Offset 17: U8  dterm_lpf1_type
Offset 24: U8  gyro_lpf1_type
Offset 25: U8  gyro_lpf2_type
Offset 28: U8  dterm_lpf2_type
Offset 29: U16 gyro_lpf1_dyn_min_hz
Offset 31: U16 gyro_lpf1_dyn_max_hz
Offset 33: U16 dterm_lpf1_dyn_min_hz
Offset 35: U16 dterm_lpf1_dyn_max_hz
```

All fields are within the existing 47-byte minimum response, so no length guard needed.

### Task 3: Update enrichSettingsFromBBLHeaders

**File**: `src/main/analysis/headerValidation.ts`

Add extraction for gyro dynamic fields from BBL headers:
- `gyro_lpf1_dyn_min_hz` (header key: `gyro_lowpass_dyn_min_hz`)
- `gyro_lpf1_dyn_max_hz` (header key: `gyro_lowpass_dyn_max_hz`)
- `dterm_lpf1_dyn_max_hz` (header key: `dterm_lowpass_dyn_max_hz`)

Already enriched: `dterm_lpf1_dyn_min_hz`, `dterm_lpf1_dyn_expo`.

### Task 4: Dynamic-aware FilterRecommender

**File**: `src/main/analysis/FilterRecommender.ts`

When dynamic lowpass is active (`dyn_min_hz > 0`):

1. **Skip static cutoff recommendations** — `gyro_lpf1_static_hz` and `dterm_lpf1_static_hz` changes have no practical effect when dynamic is active. Don't recommend them.

2. **Tune dyn_min_hz instead** — The noise-floor-based target (from `computeNoiseBasedTarget()`) maps to `dyn_min_hz` — this is the tightest filtering point (low throttle). Apply the same safety bounds (GYRO_LPF1_MIN_HZ, propwash floor, RPM-aware max).

3. **Proportionally adjust dyn_max_hz** — Maintain the user's min/max ratio. If original is 250/500 (ratio 2.0) and we recommend dyn_min=200, set dyn_max=400.

4. **Ensure static_hz ≤ dyn_min_hz** — If recommending a lower dyn_min, also lower static_hz to maintain BF's floor constraint.

5. **RPM-aware dynamic bounds** — When RPM active, apply `GYRO_LPF1_MAX_HZ_RPM` and `DTERM_LPF1_MAX_HZ_RPM` as upper bounds for `dyn_max_hz`.

### Task 5: Fix DynamicLowpassRecommender

**File**: `src/main/analysis/DynamicLowpassRecommender.ts`

1. **Read actual current values** — Pass `CurrentFilterSettings` instead of just static cutoffs. Use `settings.gyro_lpf1_dyn_min_hz` and `settings.gyro_lpf1_dyn_max_hz` as `currentValue` (not hardcoded 0).

2. **Skip "enable" recommendation when already active** — If `dyn_min_hz > 0`, dynamic is already on. Don't recommend enabling it again.

3. **Recommend "disable" when appropriate** — If throttle spectrogram shows no significant throttle-dependent noise (correlation < threshold, delta < 6 dB) AND dynamic is currently active, recommend disabling (set dyn_min=0, dyn_max=0) and adjusting static cutoff instead.

### Task 6: Update GroupDelayEstimator

**File**: `src/main/analysis/GroupDelayEstimator.ts`

1. **Use dyn_min_hz when dynamic is active** — For delay estimation, use `dyn_min_hz` as the worst-case (tightest) cutoff instead of `static_hz`. This gives a more accurate delay estimate since `dyn_min_hz` is where the filter spends most of cruise time.

2. **Filter type awareness** — Use `gyro_lpf1_type` / `dterm_lpf1_type` to select correct delay model (PT1 vs biquad vs PT2/PT3). Currently assumes PT1 for LPF1 and biquad for LPF2.

### Task 7: Update verify flow

**File**: `src/main/utils/verifyAppliedConfig.ts`

1. **Add dynamic fields to expected/actual maps** — Include `gyro_lpf1_dyn_min_hz`, `gyro_lpf1_dyn_max_hz`, `dterm_lpf1_dyn_min_hz`, `dterm_lpf1_dyn_max_hz` in `buildExpectedFilterMap()` and `buildActualFilterMap()`.

2. **Handle CLI-only settings** — `rpm_filter_q` is not in MSP_FILTER_CONFIG. Track it as `unchecked` without failing verification. Add a comment explaining which settings can't be verified via MSP.

### Task 8: Update DemoDataGenerator

**File**: `src/main/demo/DemoDataGenerator.ts`

Add dynamic lowpass BBL headers to demo data:
```
H gyro_lowpass_dyn_min_hz:250
H gyro_lowpass_dyn_max_hz:500
H dterm_lowpass_dyn_min_hz:150
H dterm_lowpass_dyn_max_hz:300
H dterm_lpf1_dyn_expo:5
```

Vary per demo session to exercise both static-only and dynamic-active paths.

### Task 9: UI — show dynamic lowpass state

**File**: `src/renderer/components/FCInfoDisplay/FCInfoDisplay.tsx` (or similar)

Show dynamic lowpass status alongside existing BB diagnostics:
- "Gyro LPF1: Dynamic 250-500 Hz" or "Gyro LPF1: Static 250 Hz"
- Same for D-term LPF1

This gives users visibility into what mode their FC is running.

### Task 10: Tests

- MSPClient: verify all new byte offsets are parsed correctly
- FilterRecommender: test dynamic-aware recommendation logic (skip static when dynamic active, tune dyn_min/max)
- DynamicLowpassRecommender: test with existing dynamic values (not always 0)
- GroupDelayEstimator: test with dynamic cutoffs and filter types
- verifyAppliedConfig: test dynamic fields in expected/actual maps
- DemoDataGenerator: verify dynamic headers in generated BBL

### Task 11: Investigate dyn_notch_count apply failure

Separate from dynamic lowpass, but discovered alongside it. The CLI command `set dyn_notch_count = 3` was sent but FC still reports 5 via MSP. Possible causes:

1. **CLI command name mismatch** — verify exact BF CLI setting name for dyn_notch_count
2. **CLI response validation** — check if `validateCLIResponse()` caught an error that was silently swallowed
3. **Save ordering** — verify the CLI `save` command runs after all `set` commands

This task should be investigated by checking apply logs and testing CLI commands manually.

## File Impact Summary

| File | Change Type |
|------|-------------|
| `src/shared/types/analysis.types.ts` | Type extension + defaults |
| `src/main/msp/MSPClient.ts` | Read 8 new bytes from MSP response |
| `src/main/analysis/headerValidation.ts` | Enrich 3 new BBL header fields |
| `src/main/analysis/FilterRecommender.ts` | Dynamic-aware recommendation logic |
| `src/main/analysis/DynamicLowpassRecommender.ts` | Read actual values, skip/disable logic |
| `src/main/analysis/GroupDelayEstimator.ts` | Dynamic cutoff + filter type support |
| `src/main/utils/verifyAppliedConfig.ts` | Dynamic fields in verification maps |
| `src/main/demo/DemoDataGenerator.ts` | Dynamic lowpass BBL headers |
| `src/renderer/components/` | UI dynamic mode indicator |
| Test files (co-located) | Tests for all above |

## Risk Assessment

- **Safety**: No risk — we're reading more data and making more informed decisions. Recommendations become more accurate, not more aggressive.
- **Breaking change**: None — new fields are optional (`?:`). Existing sessions/history remain valid.
- **BF version compat**: All MSP offsets are stable from BF 4.3+ (our minimum). No version gate needed.
- **Convergence**: Fixing the "tune static when dynamic is active" bug eliminates a major source of non-convergence in real-world tuning.
