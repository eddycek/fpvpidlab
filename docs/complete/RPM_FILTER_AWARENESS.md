# RPM Filter Awareness: Detection and Filter Recommendation Adjustments

> **Status**: Complete (all 8 tasks implemented, PRs #63–#69)
> **Date**: 2026-02-11
> **Scope**: Filter Analysis Pipeline, MSP Client, Types, UI Display

---

## 1. Why This Is Needed

### 1.1 Problem: Overly Conservative Filter Recommendations

The RPM filter is a bank of **36 narrow notch filters** (3 harmonics × 4 motors × 3 axes) that dynamically track motor rotation frequencies via bidirectional DShot telemetry. When active, it surgically removes motor noise — the dominant noise source on most quads.

Our filter recommender (`FilterRecommender.ts`) currently has no knowledge of RPM filter state. This means:

- **With RPM filter active**: The recommender may suggest lowering lowpass cutoffs to address motor noise that the RPM filter has already removed. This results in **unnecessarily aggressive filtering** — more latency, mushier stick feel, slower response.
- **Without RPM filter**: The current recommendations are appropriate, but the user gets no guidance that enabling RPM filter would dramatically improve their noise profile.

### 1.2 Problem: Safety Bounds Don't Reflect RPM Filter

Current safety bounds in `constants.ts`:
```
GYRO_LPF1_MAX_HZ = 300
DTERM_LPF1_MAX_HZ = 200
```

With RPM filter active, the BF community routinely runs:
- `gyro_lpf1_static_hz = 0` (disabled entirely)
- `gyro_lpf2_static_hz = 500`
- `dterm_lpf1_static_hz = 250-300`

Our bounds cap recommendations well below what's safe with RPM filtering, leaving performance on the table.

### 1.3 Problem: Dynamic Notch Recommendations Ignore RPM Context

When RPM filter handles motor harmonics, the dynamic notch filter only needs to catch **frame resonances** — requiring fewer notches with narrower Q. The Betaflight Configurator auto-adjusts:
- RPM ON: `dyn_notch_count` 3→1, `dyn_notch_q` 300→500
- RPM OFF: `dyn_notch_count` 1→3, `dyn_notch_q` 500→300

Our recommender does not make this distinction.

### 1.4 Problem: Motor Harmonic Classification Is Context-Blind

`NoiseAnalyzer.ts` classifies peaks as `motor_harmonic` based on frequency spacing patterns. But with RPM filter active, motor harmonics should already be removed. If motor harmonic peaks still appear with RPM filter on, it likely indicates:
- Incorrect `motor_poles` setting
- ESC telemetry issues
- RPM filter misconfiguration

This is diagnostic information the user should see.

### 1.5 How RPM Filter Works

The RPM filter places narrow notch filters at each motor's rotation frequency and its harmonics. Requirements:
- **Bidirectional DShot** (`dshot_bidir = ON`) — ESC sends back eRPM data
- **Compatible ESC firmware** (BLHeli_32 v32.7+, JESC, Bluejay, AM32)
- `rpm_filter_harmonics > 0` (default: 3)

Key parameters:
| Setting | Default | Description |
|---------|---------|-------------|
| `dshot_bidir` | OFF | Enable bidirectional DShot |
| `rpm_filter_harmonics` | 3 | Harmonics tracked (0 = off) |
| `rpm_filter_q` | 500 | Notch Q factor (÷100 internally) |
| `rpm_filter_min_hz` | 100 | Minimum notch frequency |
| `rpm_filter_fade_range_hz` | 50 | Crossfade below min_hz |

---

## 2. Analysis of Required Changes

### 2.1 Data Already Available

**MSP_FILTER_CONFIG** (`MSPClient.ts` line 478-479):
```typescript
// Byte 43: U8  rpm_notch_harmonics     ← already read but NOT exposed
// Byte 44: U8  rpm_notch_min_hz        ← already read but NOT exposed
```

The MSP response is already parsed and has enough bytes (47 minimum checked), but `rpm_notch_harmonics` and `rpm_notch_min_hz` are not included in the returned `CurrentFilterSettings` object.

**BBL Headers** (via `rawHeaders` Map — no parser changes needed):
- `dshot_bidir` — `1` if enabled
- `rpm_filter_harmonics` — `0` = off, `1-3` = active
- `rpm_filter_q`, `rpm_filter_min_hz`, `rpm_filter_fade_range_hz`, `rpm_filter_weights`
- `dyn_notch_count`, `dyn_notch_q` — current dynamic notch config

### 2.2 Type Changes Required

**`src/shared/types/analysis.types.ts`** — extend `CurrentFilterSettings`:
```typescript
export interface CurrentFilterSettings {
  // ... existing fields ...

  /** RPM filter harmonics count (0 = disabled, 1-3 = active). Undefined if not read. */
  rpm_filter_harmonics?: number;
  /** RPM filter minimum frequency in Hz */
  rpm_filter_min_hz?: number;
  /** Dynamic notch count (1-5) */
  dyn_notch_count?: number;
  /** Dynamic notch Q factor */
  dyn_notch_q?: number;
}
```

Using optional fields preserves backward compatibility — existing code that doesn't provide RPM data continues to work.

### 2.3 FilterRecommender Changes

The recommender needs conditional bounds and dynamic notch logic:

1. **Detect RPM state**: `rpmFilterActive = (settings.rpm_filter_harmonics ?? 0) > 0`
2. **Widen safety bounds when RPM active**:
   - `GYRO_LPF1_MAX_HZ`: 300 → 500 (or allow 0 = disabled)
   - `DTERM_LPF1_MAX_HZ`: 200 → 300
3. **Adjust dynamic notch recommendations**:
   - With RPM: recommend count=1, Q=500 (frame resonance only)
   - Without RPM: keep count=3+, Q=300 (must track motor noise)
4. **Contextual peak classification**: Flag motor harmonics detected with RPM active as potential misconfiguration

### 2.4 MSPClient Changes

Expose the already-read RPM bytes in the returned `CurrentFilterSettings`:
```typescript
const settings: CurrentFilterSettings = {
  // ... existing fields ...
  rpm_filter_harmonics: response.data.readUInt8(43),
  rpm_filter_min_hz: response.data.readUInt8(44),
};
```

Also read dynamic notch count/Q for recommendation context (already in the MSP response at bytes 37-39).

---

## 3. Implementation Plan

### Task 1: Extend `CurrentFilterSettings` type with RPM and dynamic notch fields ✅
- **File**: `src/shared/types/analysis.types.ts`
- **Changes**: Add optional `rpm_filter_harmonics`, `rpm_filter_min_hz`, `dyn_notch_count`, `dyn_notch_q` fields
- **Tests**: Type compilation; update existing tests that construct `CurrentFilterSettings` objects
- **PR**: #63 (merged)

### Task 2: Expose RPM filter bytes in `MSPClient.getFilterConfiguration()` ✅
- **File**: `src/main/msp/MSPClient.ts`
- **Changes**: Read bytes 43-44 (rpm_notch_harmonics, rpm_notch_min_hz) and bytes 37-39 (dyn_notch_q) into the returned settings object. Add `dyn_notch_count` if available in extended response (byte 47+ in BF 4.3+).
- **Tests**: Unit tests with mock Buffer for both minimal (47-byte) and extended responses
- **PR**: #64 (merged)

### Task 3: Add RPM-aware safety bound constants ✅
- **File**: `src/main/analysis/constants.ts`
- **Changes**: Add RPM-conditional bounds:
  ```typescript
  export const GYRO_LPF1_MAX_HZ_RPM = 500;
  export const DTERM_LPF1_MAX_HZ_RPM = 300;
  export const DYN_NOTCH_COUNT_WITH_RPM = 1;
  export const DYN_NOTCH_Q_WITH_RPM = 500;
  export const DYN_NOTCH_COUNT_WITHOUT_RPM = 3;
  export const DYN_NOTCH_Q_WITHOUT_RPM = 300;
  ```
- **Tests**: N/A (constants only)
- **PR**: #65 (merged)

### Task 4: Make `FilterRecommender.recommend()` RPM-aware ✅
- **File**: `src/main/analysis/FilterRecommender.ts`
- **Changes**:
  1. Detect RPM state from `current.rpm_filter_harmonics`
  2. Use RPM-conditional max bounds in `computeNoiseBasedTarget()` calls
  3. Add new function `recommendDynamicNotchForRPM()` — if RPM active and dyn_notch settings are at non-RPM defaults (count=3, Q=300), recommend adjusting to count=1, Q=500
  4. Skip `motor_harmonic` peak classification adjustment recommendations when RPM active
- **Tests**: Unit tests for:
  - RPM active: higher cutoff recommendations within RPM bounds
  - RPM active: dynamic notch count/Q adjustment
  - RPM inactive: unchanged behavior (regression)
  - RPM state unknown (undefined): unchanged behavior (regression)
- **PR**: #66 (merged)

### Task 5: Add RPM context to `FilterAnalysisResult` ✅
- **File**: `src/shared/types/analysis.types.ts`, `src/main/analysis/FilterAnalyzer.ts`
- **Changes**: Add `rpmFilterActive: boolean` field to `FilterAnalysisResult`. Wire detection through `FilterAnalyzer`.
- **Tests**: Integration test verifying RPM context propagates to result
- **PR**: #67 (merged)

### Task 6: Extract RPM state from BBL headers as fallback ✅
- **File**: `src/main/analysis/headerValidation.ts`, `src/main/ipc/handlers.ts`
- **Changes**: When `CurrentFilterSettings` doesn't include RPM data (e.g., FC not connected), fall back to reading `dshot_bidir` and `rpm_filter_harmonics` from BBL `rawHeaders` via `enrichSettingsFromBBLHeaders()`
- **Tests**: Unit tests for BBL header fallback path in `headerValidation.test.ts`
- **PR**: #68 (merged)

### Task 7: Display RPM filter status in analysis UI ✅
- **File**: `src/renderer/components/TuningWizard/FilterAnalysisStep.tsx`, `src/renderer/components/AnalysisOverview/AnalysisOverview.tsx`
- **Changes**: RPM status pill in analysis meta ("Active"/"Not detected"), info banner when RPM active, CSS styles
- **Tests**: 6 new component tests (3 per component: active/inactive/undefined)
- **PR**: #69 (merged)

### Task 8: Add diagnostic for motor harmonics with RPM active ✅
- **File**: `src/main/analysis/FilterRecommender.ts`
- **Changes**: `recommendMotorHarmonicDiagnostic()` already implemented in Task 4 — warns about `motor_poles` and ESC telemetry when motor harmonics detected with RPM active
- **Tests**: 2 tests in FilterRecommender.test.ts (diagnostic present/absent based on RPM state)
- **PR**: #66 (merged as part of Task 4)

---

## 4. Concrete Recommendation Differences

| Setting | Without RPM (current) | With RPM (proposed) |
|---------|----------------------|---------------------|
| `gyro_lpf1_static_hz` | 75-300 Hz | 75-500 Hz (or 0 = disabled) |
| `dterm_lpf1_static_hz` | 70-200 Hz | 70-300 Hz |
| `dyn_notch_count` | No recommendation | Recommend 1 (from default 3) |
| `dyn_notch_q` | No recommendation | Recommend 500 (from default 300) |
| Motor harmonic peaks | Normal classification | Warning about RPM filter issue |

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| RPM bytes not in MSP response (very old FW) | Low | None | Optional fields; graceful fallback to current behavior |
| Over-relaxing filters with RPM | Low | Medium | Never allow disabling ALL lowpass filters; keep LPF2 as safety net |
| User has broken RPM filter config | Low | Medium | Motor harmonic diagnostic catches this case |
| Dynamic notch count not in MSP_FILTER_CONFIG | Medium | Low | Fall back to BBL header or skip dyn_notch recommendations |

---

## 6. Files Affected

| File | Change Type |
|------|-------------|
| `src/shared/types/analysis.types.ts` | Extend `CurrentFilterSettings`, add `rpmFilterActive` to result |
| `src/main/analysis/constants.ts` | Add RPM-conditional bound constants |
| `src/main/analysis/FilterRecommender.ts` | RPM-aware bounds, dynamic notch logic, motor harmonic diagnostic |
| `src/main/analysis/FilterAnalyzer.ts` | Wire RPM context, BBL header fallback |
| `src/main/msp/MSPClient.ts` | Expose rpm_notch_harmonics, rpm_notch_min_hz |
| `src/renderer/components/TuningWizard/FilterAnalysisStep.tsx` | RPM status display |
| `src/renderer/components/AnalysisOverview/AnalysisOverview.tsx` | RPM status display |

---

## 7. BF Version Compatibility

The app's minimum supported version is **BF 4.3** (API 1.44). All RPM filter parameters
(`rpm_filter_harmonics`, `rpm_filter_q`, `rpm_filter_min_hz`, `rpm_filter_fade_range_hz`)
are available from BF 4.3 onward. `rpm_filter_weights` (per-harmonic weight strings) is
a BF 4.5+ feature and should use optional fields with graceful fallback.

MSP_FILTER_CONFIG bytes 43-44 (`rpm_notch_harmonics`, `rpm_notch_min_hz`) are stable across
BF 4.3–2025.12 — no version-specific parsing needed.

See `docs/BF_VERSION_POLICY.md` for the full version compatibility policy.

---

## 8. References

- [Oscar Liang: How to Setup RPM Filters in Betaflight](https://oscarliang.com/rpm-filter/)
- [Betaflight: DShot RPM Filtering](https://www.betaflight.com/docs/wiki/guides/current/DSHOT-RPM-Filtering)
- [Betaflight 4.3 Tuning Notes](https://www.betaflight.com/docs/wiki/tuning/4-3-Tuning-Notes)
- [Betaflight firmware presets: basic_rpm_normal](https://github.com/betaflight/firmware-presets/blob/master/presets/4.3/filters/basic_rpm_normal.txt)
- [Betaflight source: rpm_filter.h](https://github.com/betaflight/betaflight/blob/master/src/main/pg/rpm_filter.h)
