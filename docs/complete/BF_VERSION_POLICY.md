# Betaflight Version Compatibility Policy

> **Status**: Implemented
> **Date**: 2026-02-11
> **Enforcement**: MSPClient version gate on connect

---

## Version Support Tiers

```
Minimum supported:   BF 4.3   (API 1.44)   — June 2022
Recommended:         BF 4.5+  (API 1.46)   — April 2024
Actively tested:     BF 4.5.x, 2025.12.x   — user's fleet
```

**BF 4.2 and earlier are not supported.** Connecting with an unsupported version
triggers an automatic disconnect with an error message.

---

## 1. Why BF 4.3 as Minimum

### 1.1 CLI Parameter Naming Break

BF 4.3 introduced a major CLI parameter rename. The `ff_*` → `feedforward_*` rename
affects snapshot storage, CLI diff parsing, and analysis header extraction:

| BF 4.2 and earlier | BF 4.3+ |
|---------------------|---------|
| `ff_boost` | `feedforward_boost` |
| `ff_transition` | `feedforward_transition` |
| `ff_smooth_factor` | `feedforward_smooth_factor` |
| `ff_max_rate_limit` | `feedforward_max_rate_limit` |
| `dyn_notch_width_percent` | **Removed** → `dyn_notch_count` |

Supporting both naming conventions would add complexity to every CLI diff parser,
snapshot restore handler, and analysis pipeline for a user base that represents <5%
of active pilots.

### 1.2 MSP_FILTER_CONFIG Byte Layout

The 47-byte MSP_FILTER_CONFIG layout our app reads (bytes 20-46) is stable from
BF 4.3 onward (API 1.44). Earlier versions have a different layout that would
require version-specific parsing.

### 1.3 Key Features Introduced in 4.3

- `dyn_notch_count` (multi-notch system) — needed for RPM filter awareness
- `feedforward_jitter_factor` — needed for feedforward detection
- `rpm_filter_fade_range_hz` and `rpm_filter_lpf_hz`
- Simplified tuning slider system
- Modern RC smoothing

### 1.4 BF Configurator 11.0 Requires 4.3+

The current Betaflight Configurator (PWA version 11.0) only supports BF 4.3 and later.
If the official configurator has dropped older versions, there's no reason for us
to maintain compatibility with them.

### 1.5 Hardware Compatibility

- **F3 boards** were dropped in BF 4.1 (2019) — stuck on 4.0.6
- **F4/F7/H7/G4/AT32** all support BF 4.3+
- No modern hardware is limited to pre-4.3 firmware

---

## 2. Version-Specific Notes

### BF 4.3 (API 1.44) — Minimum Supported

| Feature | Status |
|---------|--------|
| MSP_FILTER_CONFIG 47-byte layout | Full support |
| `feedforward_*` CLI naming | Standard |
| `dyn_notch_count` | Available |
| `blackbox_high_resolution` | **Not available** (4.4+) |
| `rpm_filter_weights` | **Not available** (4.5+) |

**Note**: `blackbox_high_resolution` header will be absent. App treats missing as `0` (off).

### BF 4.4 (API 1.45)

| Feature | Status |
|---------|--------|
| All 4.3 features | Yes |
| `blackbox_high_resolution` | Available |
| Cloud build system | Available |
| 4 PID profiles (down from 6) | Structural change |

### BF 4.5 (API 1.46) — Recommended

| Feature | Status |
|---------|--------|
| All 4.4 features | Yes |
| `rpm_filter_weights` (CLI only) | Available |
| Debug expanded to 8 channels | Available |
| `tpa_low_*` parameters | Available |
| EZ Landing | Available |
| Unfiltered gyro logged by default | Partial (debug still helps) |

### BF 2025.12 / 4.6 (API 1.47) — Actively Tested

| Feature | Status |
|---------|--------|
| All 4.5 features | Yes |
| `DEBUG_GYRO_SCALED` (index 6) | **Removed** — gyro unfiltered by default |
| Chirp signal generator | Available (custom build) |
| `motor_idle` (was `dshot_idle_value`) | CLI rename |
| CalVer naming (YYYY.MM) | Display only |
| `DeviceUID` in BBL header | New |

**Critical**: `DEBUG_GYRO_SCALED` was removed. The app detects firmware version
from the BBL header (`firmwareVersion` field) and skips the debug mode check
for 4.6+.

---

## 3. Implementation Details

### 3.1 Version Gate on Connect

**File**: `src/main/msp/MSPClient.ts` — `validateFirmwareVersion()`

After reading `FCInfo` (which includes `apiVersion`), the connect flow checks:
- If `apiVersion.major < 1` or `(major === 1 && minor < 44)` → reject
- Throws `UnsupportedVersionError` with clear message
- Automatically closes the port before throwing
- The renderer displays the error to the user

### 3.2 Constants

**File**: `src/shared/constants.ts`

```typescript
export const BETAFLIGHT = {
  VENDOR_IDS: ['0x0483', '0x2E8A'],
  VARIANT: 'BTFL',
  MIN_VERSION: '4.3.0',
  MIN_API_VERSION: { major: 1, minor: 44 },
} as const;
```

### 3.3 DEBUG_GYRO_SCALED Version Check

**File**: `src/main/analysis/headerValidation.ts`

The `validateBBLHeader()` function checks `header.firmwareVersion`:
- If version >= 4.6.0: skip debug mode check entirely (gyro unfiltered by default)
- If version < 4.6.0: warn if `debug_mode != 6` (GYRO_SCALED)
- If version missing/unparseable: assume pre-4.6 (conservative)

**File**: `src/renderer/components/FCInfo/FCInfoDisplay.tsx`

The debug mode indicator in FC info panel uses the same logic:
- BF 4.6+: debug mode always shows as OK (checkmark)
- BF 4.3–4.5: warns if not GYRO_SCALED

**File**: `src/shared/constants/flightGuide.ts`

Flight guide tips and workflow steps clarify the BF version scope:
- "Set debug_mode = GYRO_SCALED (BF 4.3–4.5 only; not needed on 2025.12+)"

### 3.4 Optional Field Pattern

Features available only on newer versions use optional fields with fallback:

```typescript
// CurrentFilterSettings
rpm_filter_harmonics?: number;    // 4.3+ (MSP byte 43)
rpm_filter_weights?: string;      // 4.5+ (CLI only)
blackbox_high_resolution?: boolean; // 4.4+

// Usage: always with fallback
const rpmActive = (settings.rpm_filter_harmonics ?? 0) > 0;
```

---

## 4. What We Explicitly Do NOT Support

| Feature | Reason |
|---------|--------|
| `ff_*` CLI naming (BF 4.2) | Minimum version is 4.3 |
| `dyn_notch_width_percent` (BF 4.2) | Replaced by `dyn_notch_count` in 4.3 |
| F3 boards (BF 4.0 max) | Hardware EOL since 2019 |
| MSP v2 | Not yet implemented (MSP v1 works for all our commands) |
| Huffman-compressed BBL data | Rare BF 4.1+ feature, logs warning if detected |
| INAV / Emuflight / other forks | Only Betaflight (`BTFL` variant) |

---

## 5. Future Considerations

### BF 2026.06 (Expected June 2026)

When the next BF release ships:
1. Check for MSP protocol changes
2. Check for CLI parameter renames (review release notes)
3. Add new debug modes to enum if needed
4. Test BBL parser with new logs
5. Update this document

### Raising Minimum Version

If/when we decide to raise the minimum:
- Update `BETAFLIGHT.MIN_VERSION` and `BETAFLIGHT.MIN_API_VERSION` in constants
- The version gate in MSPClient handles the rest automatically
- Update this document and CLAUDE.md

---

## 6. References

- [Betaflight GitHub Releases](https://github.com/betaflight/betaflight/releases)
- [Betaflight 4.3 Tuning Notes](https://www.betaflight.com/docs/wiki/tuning/4-3-Tuning-Notes)
- [Betaflight 2025.12 Release Notes](https://www.betaflight.com/docs/wiki/release/Betaflight-2025-12-Release-Notes)
- [MSP Protocol Reference](https://www.betaflight.com/docs/development/API/MSP-Extensions)
- [Betaflight source: msp.c](https://github.com/betaflight/betaflight/blob/master/src/main/msp/msp.c)
