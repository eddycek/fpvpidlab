# Flight Style in Profiles: Subjective PID Tuning Preferences

> **Status**: Complete (PRs #71–#78)
> **Date**: 2026-02-11
> **Scope**: Profile Types, Profile UI, PID Recommender, Constants

---

## 1. Why This Is Needed

### 1.1 Problem: PID Tuning Has a Subjective Component

Our PID recommender (`PIDRecommender.ts`) uses fixed thresholds to decide what constitutes "good" step response behavior:

```typescript
OVERSHOOT_IDEAL_PERCENT = 10    // target overshoot
OVERSHOOT_MAX_PERCENT = 25      // "too much"
SETTLING_MAX_MS = 200            // "too slow"
```

These thresholds assume a **one-size-fits-all** flying preference. In reality, different pilots and use cases have fundamentally different preferences:

- **Cinematic/smooth flying**: Pilots want minimal overshoot, smooth transitions, zero oscillation. They'll accept slower response for a buttery, floaty feel. A 3% overshoot target is ideal.
- **Freestyle**: Balanced overshoot vs. response. Quick stick feel with some bounce-back tolerated. The current 10% target is reasonable.
- **Racing**: Maximum responsiveness, tight tracking. Pilots tolerate 15%+ overshoot for the fastest possible snap response. Every millisecond of latency matters.

Using the same thresholds for all three produces suboptimal recommendations:
- A cinematic pilot gets told their quad "looks good" at 10% overshoot — but they'd prefer 3%
- A racing pilot gets told to increase D because of 20% overshoot — but they want that snappy feel

### 1.2 History: Previously Existed, Then Removed

In commit `2f83956` (February 8, 2026), three profile types were removed:

```typescript
// Removed types:
export type FrameType = 'freestyle' | 'race' | 'cinematic' | 'long-range';
export type FlightStyle = 'smooth' | 'balanced' | 'aggressive';
export type FrameStiffness = 'soft' | 'medium' | 'stiff';
```

**Reason for removal**: "Never used in tuning logic."

This was correct at the time — the types existed in the data model but no code consumed them. Now, with a functional PID recommender that uses thresholds, **FlightStyle has a clear consumer**.

### 1.3 What Should Come Back (and What Shouldn't)

| Type | Bring back? | Reasoning |
|------|-------------|-----------|
| `FlightStyle` | **Yes** | Directly maps to PID threshold preferences. Clear, actionable, every pilot knows their style. |
| `FrameType` | **No** | Redundant — implicit in preset names (5inch-freestyle, 5inch-race). No tuning logic maps to frame type independently of flight style. |
| `FrameStiffness` | **No** | Hard to determine without specialized knowledge. Better detected from FFT data (frame resonance peaks) than user input. |

### 1.4 Preset Profiles Already Encode Style Implicitly

Our 10 preset profiles have flight style baked into their names and descriptions:

```typescript
'5inch-freestyle':  'Standard 5 inch freestyle quad with balanced tuning'
'5inch-race':       'Lightweight 5 inch racing quad with aggressive tuning'
'5inch-cinematic':  'Heavy cinematic quad with GoPro, smooth tuning'
'3inch-cinewhoop':  'Indoor/cinematic whoop with ducted props'
```

The words "balanced", "aggressive", and "smooth" are already there — we just don't extract them into a structured field.

---

## 2. Analysis of Required Changes

### 2.1 FlightStyle Type Definition

```typescript
export type FlightStyle = 'smooth' | 'balanced' | 'aggressive';
```

Three options is the right granularity:
- **smooth** = cinematic, long-range, cinewhoop (minimize overshoot, maximize smoothness)
- **balanced** = freestyle, general flying (default — current behavior)
- **aggressive** = racing, freestyle acro (maximize response, tolerate overshoot)

### 2.2 PID Threshold Mapping

The core value: FlightStyle directly modifies the PID recommender's decision thresholds.

| Threshold | smooth | balanced (current) | aggressive |
|-----------|--------|-------------------|------------|
| `OVERSHOOT_IDEAL_PERCENT` | 3 | 10 | 18 |
| `OVERSHOOT_MAX_PERCENT` | 12 | 25 | 35 |
| `SETTLING_MAX_MS` | 250 | 200 | 150 |
| `RINGING_MAX_COUNT` | 1 | 2 | 3 |
| Moderate overshoot threshold | 8 | 15 | 25 |
| Sluggish rise time (ms) | 120 | 80 | 50 |

**Balanced** = identical to current constants → no behavior change for existing users.

### 2.3 Profile Type Changes

**`src/shared/types/profile.types.ts`**:
```typescript
export type FlightStyle = 'smooth' | 'balanced' | 'aggressive';

export interface DroneProfileOptional {
  propSize?: string;
  weight?: number;
  motorKV?: number;
  notes?: string;
  flightStyle?: FlightStyle;  // NEW — defaults to 'balanced' if unset
}
```

Using an optional field ensures backward compatibility — existing profiles without `flightStyle` default to `'balanced'`, preserving current behavior exactly.

### 2.4 Profile UI Changes

**ProfileWizard** (`ProfileWizard.tsx`): Add a flight style selector in the custom path's BasicStep. Three visual options with descriptions:
- Smooth: "Cinematic, smooth transitions, minimal overshoot"
- Balanced: "General freestyle, good all-around response" (default)
- Aggressive: "Racing, maximum snap, fast tracking"

**ProfileEditModal** (`ProfileEditModal.tsx`): Add the same flight style selector.

**PresetSelector**: Map preset IDs to default flight styles:
- `5inch-race` → `aggressive`
- `5inch-cinematic`, `3inch-cinewhoop` → `smooth`
- All others → `balanced`

### 2.5 PID Recommender Changes

**`PIDRecommender.ts`**: Accept `FlightStyle` parameter (default: `'balanced'`). Use style-specific thresholds instead of imported constants. The recommendation rules remain the same — only the thresholds change.

**`constants.ts`**: Add style-based threshold maps alongside existing constants (existing constants become the `balanced` values).

### 2.6 Summary and Explanation Text Changes

The PID summary should reflect the flight style context:
- smooth: "Analyzed N stick inputs for smooth flying preferences..."
- aggressive: "Analyzed N stick inputs optimized for racing response..."

### 2.7 Migration

Existing profiles have no `flightStyle` field. When loaded:
- `flightStyle ?? 'balanced'` — zero-migration approach
- No database migration needed
- Existing behavior preserved exactly

---

## 3. Implementation Plan

### ~~Task 1: Add `FlightStyle` type and update profile interfaces~~ ✅ DONE (PR #71)
- **File**: `src/shared/types/profile.types.ts`
- **Changes**: Add `FlightStyle` type, add `flightStyle?: FlightStyle` to `DroneProfileOptional`
- **Tests**: Type compilation; verify `ProfileCreationInput` and `ProfileUpdateInput` inherit the new field

### ~~Task 2: Add flight style selector to ProfileWizard~~ ✅ DONE (PR #72)
- **File**: `src/renderer/components/ProfileWizard.tsx`
- **Changes**: Add `flightStyle` state (default: `'balanced'`). Add three-option selector in BasicStep with icons/descriptions. Include in `ProfileCreationInput` on complete. When using presets, auto-set based on preset ID mapping.
- **Tests**: Component test: default selection is balanced; changing selection persists; custom path includes flightStyle in output; preset path maps correctly

### ~~Task 3: Add flight style selector to ProfileEditModal~~ ✅ DONE (PR #73)
- **File**: `src/renderer/components/ProfileEditModal.tsx`
- **Changes**: Add `flightStyle` state initialized from `profile.flightStyle ?? 'balanced'`. Add same selector UI. Include in `ProfileUpdateInput` on save.
- **Tests**: Component test: loads existing value; saves updated value; defaults to balanced for old profiles

### ~~Task 4: Add style-based PID threshold constants~~ ✅ DONE (PR #74)
- **File**: `src/main/analysis/constants.ts`
- **Changes**: Add threshold map:
  ```typescript
  export const PID_STYLE_THRESHOLDS = {
    smooth:     { overshootIdeal: 3,  overshootMax: 12, settlingMax: 250, ringingMax: 1, moderateOvershoot: 8,  sluggishRise: 120 },
    balanced:   { overshootIdeal: 10, overshootMax: 25, settlingMax: 200, ringingMax: 2, moderateOvershoot: 15, sluggishRise: 80  },
    aggressive: { overshootIdeal: 18, overshootMax: 35, settlingMax: 150, ringingMax: 3, moderateOvershoot: 25, sluggishRise: 50  },
  } as const;
  ```
  Keep existing individual constants unchanged (they remain the `balanced` defaults for backward compatibility).
- **Tests**: Verify threshold values exist for all three styles

### ~~Task 5: Make `recommendPID()` accept FlightStyle parameter~~ ✅ DONE (PR #75)
- **File**: `src/main/analysis/PIDRecommender.ts`
- **Changes**: Add `flightStyle: FlightStyle = 'balanced'` parameter. Replace hardcoded threshold constants with lookups from `PID_STYLE_THRESHOLDS[flightStyle]`. Update `generatePIDSummary()` to mention style context.
- **Tests**:
  - balanced style → identical behavior to current (regression test)
  - smooth style + 10% overshoot → recommends reducing (too high for smooth)
  - aggressive style + 20% overshoot → no recommendation (acceptable for aggressive)
  - smooth style + 100ms rise time → no sluggish warning (acceptable for smooth)
  - aggressive style + 70ms rise time → sluggish warning (too slow for aggressive)

### ~~Task 6: Wire FlightStyle through analysis pipeline~~ ✅ DONE (PR #76)
- **File**: `src/main/analysis/PIDAnalyzer.ts`, `src/main/ipc/handlers.ts`
- **Changes**: Pass profile's `flightStyle` from IPC handler through PIDAnalyzer to `recommendPID()`. Read from current profile when running PID analysis.
- **Tests**: Integration test verifying style flows from profile to recommendations

### ~~Task 7: Display flight style context in analysis UI~~ ✅ DONE (PR #77)
- **File**: `src/renderer/components/TuningWizard/PIDAnalysisStep.tsx`, `src/renderer/components/AnalysisOverview/AnalysisOverview.tsx`
- **Changes**: Show the active flight style preference as context: "Tuning for: Balanced flying". Include in summary text.
- **Tests**: Component tests verifying style label renders

### ~~Task 8: Map preset profiles to default flight styles~~ ✅ DONE (PR #78)
- **File**: `src/shared/constants.ts`
- **Changes**: Add `flightStyle` field to `PresetProfile` interface and populate:
  ```typescript
  '5inch-freestyle':  { ...preset(...), flightStyle: 'balanced' },
  '5inch-race':       { ...preset(...), flightStyle: 'aggressive' },
  '5inch-cinematic':  { ...preset(...), flightStyle: 'smooth' },
  '3inch-cinewhoop':  { ...preset(...), flightStyle: 'smooth' },
  '6inch-longrange':  { ...preset(...), flightStyle: 'smooth' },
  '7inch-longrange':  { ...preset(...), flightStyle: 'smooth' },
  // others: 'balanced'
  ```
- **Tests**: Verify all presets have a valid flightStyle mapping

---

## 4. UX Design Notes

### Flight Style Selector

The selector should be visually distinct — not just a dropdown, but three clickable cards:

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Smooth    │  │  Balanced   │  │  Aggressive  │
│             │  │   (default) │  │              │
│  Cinematic, │  │  Freestyle, │  │  Racing,     │
│  long-range │  │  all-around │  │  maximum     │
│  flying     │  │  flying     │  │  snap        │
└─────────────┘  └─────────────┘  └─────────────┘
```

### When to Show

- **ProfileWizard custom path**: In BasicStep, after drone size/battery
- **ProfileWizard preset path**: Auto-set from preset mapping (shown in review step, editable)
- **ProfileEditModal**: Always shown
- **Dashboard**: Small badge on profile display (e.g., "Balanced" tag)

### Terminology

Use "Flying Style" (not "Flight Style") in the UI — more natural for pilots. The type name stays `FlightStyle` in code.

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Users don't understand the options | Low | Low | Clear descriptions with concrete examples |
| Wrong style selected → bad recs | Medium | Low | User can change style and re-analyze; defaults to balanced |
| Threshold values need tuning | High | Medium | Start conservative; collect feedback; thresholds are in one constant map |
| Old profiles missing flightStyle | Certain | None | Optional field with `?? 'balanced'` fallback |
| Preset mapping disputes | Low | Low | Reasonable defaults; user can override |

---

## 6. Files Affected

| File | Change Type |
|------|-------------|
| `src/shared/types/profile.types.ts` | Add `FlightStyle` type, add to `DroneProfileOptional` |
| `src/shared/constants.ts` | Add `flightStyle` to `PresetProfile` and preset mappings |
| `src/main/analysis/constants.ts` | Add `PID_STYLE_THRESHOLDS` map |
| `src/main/analysis/PIDRecommender.ts` | Accept FlightStyle, use style thresholds |
| `src/main/analysis/PIDAnalyzer.ts` | Pass FlightStyle through pipeline |
| `src/main/ipc/handlers.ts` | Read FlightStyle from profile, pass to analyzer |
| `src/renderer/components/ProfileWizard.tsx` | Add flight style selector |
| `src/renderer/components/ProfileEditModal.tsx` | Add flight style selector |
| `src/renderer/components/TuningWizard/PIDAnalysisStep.tsx` | Display style context |
| `src/renderer/components/AnalysisOverview/AnalysisOverview.tsx` | Display style context |

---

## 7. References

- Current PID thresholds: `src/main/analysis/constants.ts` lines 146-176
- PID recommender rules: `src/main/analysis/PIDRecommender.ts` lines 41-160
- Removed types: commit `2f83956` (February 8, 2026)
- Preset profiles: `src/shared/constants.ts` (10 presets)
- [Oscar Liang: FPV Drone PID Tuning](https://oscarliang.com/pid/)
- [Betaflight PID Tuning Guide](https://www.betaflight.com/docs/wiki/guides/current/PID-Tuning-Guide)
- [FPVSIM: Step Response P/D Balance](https://fpvsim.com/how-tos/step-response-pd-balance)
