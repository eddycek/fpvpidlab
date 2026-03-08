# BBL Parser Validation Report

Deep comparison of our Blackbox log parser against the authoritative reference implementations.

**Date**: 2026-02-09
**Reference implementations**:
- Betaflight Blackbox Log Viewer (`betaflight/blackbox-log-viewer`) — authoritative decoder
- Betaflight firmware (`betaflight/betaflight`, `blackbox.c`) — authoritative encoder
- PIDtoolbox — uses external `blackbox_decode` C binary, not a native parser

**Our implementation**: `src/main/blackbox/` (TypeScript, ~1200 lines, 205+ tests)

---

## Executive Summary

Our parser correctly implements the majority of the BBL binary format. The core architecture (StreamReader, HeaderParser, ValueDecoder, PredictorApplier, FrameParser, BlackboxParser) matches BF Explorer's pipeline. Frame validation, corruption recovery, event parsing, and multi-session handling are all aligned.

**4 bugs found** (3 functional, 1 semantic):

| # | Bug | Severity | Impact on PID/Filter Analysis |
|---|-----|----------|------------------------------|
| 1 | NEG_14BIT encoding formula off-by-1 | Low | None (only affects `vbatLatest`) |
| 2 | TAG8_8SVB missing `count==1` special case | Medium | Stream misalignment if triggered |
| 3 | AVERAGE_2 truncation direction | Low | Tiny accumulation error on negative sums |
| 4 | INCREMENT predictor missing `skippedFrames` | Low | Only affects `loopIteration` counter |

**None of these bugs affect gyro/setpoint/PID data for typical modern BF 4.x quad configurations.** The core analysis fields (gyroADC, setpoint, axisP/I/D/F, motor) use SIGNED_VB, UNSIGNED_VB, TAG2_3S32, TAG8_4S16, and TAG8_8SVB (in groups > 1), all of which are correctly implemented.

---

## Architecture Comparison

### Pipeline

| Stage | BF Explorer (JS) | Our Implementation (TS) | Match |
|-------|------------------|------------------------|-------|
| Binary stream reading | `ArrayDataStream` | `StreamReader` | ✅ |
| Header parsing | `parseHeader()` in parser | `HeaderParser.parse()` | ✅ |
| Value decoding | Inline `switch(encoding)` | `ValueDecoder.decode()` | ⚠️ 2 bugs |
| Predictor application | `applyPrediction()` | `PredictorApplier.apply()` | ⚠️ 2 bugs |
| Frame assembly | `parseFrame()` | `FrameParser.parseFrame()` | ✅ |
| Session parsing | `parseIntraframe/Interframe` | `BlackboxParser.parseSession()` | ✅ |
| Corruption recovery | Rewind to `frameStart + 1` | Rewind to `frameStart + 1` | ✅ |
| Frame validation | Size + iteration + time only | Size + iteration + time only | ✅ |
| Event frames | VB-encoded event data | VB-encoded event data | ✅ |
| LOG_END | Validates "End of log\0" | Validates "End of log\0" | ✅ |
| Multi-session | `H Product:` boundary scan | `H Product:` boundary scan | ✅ |

### Encoding Implementations

| Encoding | ID | BF Explorer | Ours | Match |
|----------|-----|-------------|------|-------|
| SIGNED_VB | 0 | ZigZag decode | ZigZag decode | ✅ |
| UNSIGNED_VB | 1 | 7-bit LSB-first | 7-bit LSB-first | ✅ |
| NEG_14BIT | 3 | `-signExtend14Bit(UVB)` | `-(UVB + 1)` | ❌ Bug #1 |
| TAG8_8SVB | 6 | Special case count==1 | Always reads tag byte | ❌ Bug #2 |
| TAG2_3S32 | 7 | `leadByte >> 6` selector | `leadByte >> 6` selector | ✅ |
| TAG8_4S16 | 8 | 2-bit tag per value, v1/v2 | 2-bit tag per value, v1/v2 | ✅ |
| NULL | 9 | Returns 0, reads 0 bytes | Returns 0, reads 0 bytes | ✅ |
| TAG2_3SVARIABLE | 10 | `leadByte >> 6` selector | `leadByte >> 6` selector | ✅ |

### Predictor Implementations

| Predictor | ID | BF Explorer | Ours | Match |
|-----------|-----|-------------|------|-------|
| ZERO | 0 | `value` (absolute) | `decoded` | ✅ |
| PREVIOUS | 1 | `value + prev[i]` | `decoded + prev[i]` | ✅ |
| STRAIGHT_LINE | 2 | `value + 2*prev - prev2` | `decoded + 2*prev - prev2` | ✅ |
| AVERAGE_2 | 3 | `~~((prev+prev2)/2)` | `(prev+prev2) >> 1` | ❌ Bug #3 |
| MINTHROTTLE | 4 | `value + minthrottle` | `decoded + minthrottle` | ✅ |
| MOTOR_0 | 5 | `value + motor[0]` | `decoded + current[motor0Idx]` | ✅ |
| INCREMENT | 6 | `skippedFrames + 1 + prev` | `decoded + prev + 1` | ⚠️ Bug #4 |
| HOME_COORD | 7 | GPS only | `decoded + prev` | ✅ |
| SERVO_CENTER | 8 | `value + 1500` | `decoded + 1500` | ✅ |
| VBATREF | 9 | `value + vbatref` | `decoded + vbatref` | ✅ |

---

## Bug #1: NEG_14BIT Encoding Formula

### Description

Our implementation uses `-(readUnsignedVB() + 1)`, but BF Explorer uses `-signExtend14Bit(readUnsignedVB())`.

### BF Explorer Code (`src/tools.js`)

```javascript
export function signExtend14Bit(word) {
    return word & 0x2000 ? word | 0xffffc000 : word;
}
```

```javascript
// In decoder:
case FLIGHT_LOG_FIELD_ENCODING_NEG_14BIT:
    value = -signExtend14Bit(stream.readUnsignedVB());
    break;
```

### Our Code (`ValueDecoder.ts:111-114`)

```typescript
private static readNeg14Bit(reader: StreamReader): number {
    const unsigned = reader.readUnsignedVB();
    return -(unsigned + 1);
}
```

### Value Comparison

| UVB value | BF Explorer | Our code | Difference |
|-----------|-------------|----------|------------|
| 0 | 0 | -1 | -1 |
| 5 | -5 | -6 | -1 |
| 127 | -127 | -128 | -1 |
| 8191 (0x1FFF) | -8191 | -8192 | -1 |
| 8192 (0x2000) | 8192 | -8193 | -16385 |
| 16383 (0x3FFF) | 1 | -16384 | -16385 |

For typical battery voltage values (small positive UVB, < 8192), our code is always off by 1.
For values ≥ 8192 (sign bit set, battery spike over reference), our code is completely wrong.

### BF Firmware Encoder (`blackbox.c`)

```c
blackboxWriteUnsignedVB((vbatReference - blackboxCurrent->vbatLatest) & 0x3FFF);
```

The `& 0x3FFF` masks to 14 bits. The decoder must sign-extend bit 13 and negate.

### Impact

**Low for PID/filter analysis.** NEG_14BIT is only used for `vbatLatest` (battery voltage). Our analysis pipeline uses gyro, setpoint, PID terms, and motor data — none of which use this encoding.

### Fix

```typescript
private static readNeg14Bit(reader: StreamReader): number {
    const unsigned = reader.readUnsignedVB();
    // Sign-extend from 14 bits, then negate
    const extended = (unsigned & 0x2000) ? (unsigned | 0xFFFFC000) | 0 : unsigned;
    return -extended;
}
```

---

## Bug #2: TAG8_8SVB Missing `count==1` Special Case

### Description

When only 1 field uses TAG8_8SVB encoding, BF Explorer reads a signed VB directly (no tag byte). Our code always reads a tag byte, regardless of count.

### BF Explorer Code (`src/decoders.js`)

```javascript
ArrayDataStream.prototype.readTag8_8SVB = function(values, valueCount) {
    if (valueCount == 1) {
        values[0] = this.readSignedVB();
    } else {
        header = this.readByte();
        for (i = 0; i < 8; i++, header >>= 1)
            values[i] = header & 0x01 ? this.readSignedVB() : 0;
    }
};
```

### BF Firmware Encoder (`blackbox.c`)

```c
// The encoder also has the valueCount==1 special case:
// When only 1 value, it writes signedVB directly without a tag byte.
```

### Our Code (`ValueDecoder.ts:125-145`)

```typescript
private static readTag8_8SVB(
    reader: StreamReader, values: number[],
    fieldIdx: number, count: number = 8
): number {
    const tag = reader.readByte();  // ALWAYS reads tag byte
    // ...
}
```

### When Does count==1 Occur?

In BF firmware, the following P-frame fields use TAG8_8SVB:
- `magADC[0-2]` (3 fields, conditional on MAG)
- `baroAlt` (1 field, conditional on BARO)
- `surfaceRaw` (1 field, conditional on RANGEFINDER)
- `rssi` (1 field, conditional on RSSI_ADC)
- `servo[0-N]` (variable count)

If a quad has RSSI but no MAG/BARO/RANGEFINDER, `rssi` could be the only TAG8_8SVB field in the P-frame definition, making `count=1`. Similarly, `baroAlt` or `surfaceRaw` alone.

However, on a **typical modern freestyle/race quad** (no GPS, no baro, no mag), these optional sensor fields are rarely present in the blackbox log. The main analysis fields (gyro, PID, motor, setpoint, debug) typically use TAG2_3S32, TAG8_4S16, and TAG8_8SVB in groups of 4+ (motors + debug = 4+4 = 8).

### Impact

**Medium.** If triggered, the tag byte read consumes 1 byte that belongs to the next field, causing stream misalignment for all subsequent fields in the frame. This would likely cascade into frame validation failure, causing the frame to be rejected as corrupt.

On typical quad configurations (the primary target of our app), this bug is unlikely to be triggered. It would affect logs from FCs with specific sensor configurations (baro/mag/GPS enabled with specific field combinations).

### Fix

```typescript
private static readTag8_8SVB(
    reader: StreamReader, values: number[],
    fieldIdx: number, count: number = 8
): number {
    // Special case: single field — BF encoder writes signedVB directly, no tag byte
    if (count === 1) {
        values[fieldIdx] = reader.readSignedVB();
        return 1;
    }

    const tag = reader.readByte();
    if (tag === -1) {
        for (let i = 0; i < count; i++) values[fieldIdx + i] = 0;
        return count;
    }

    for (let i = 0; i < count; i++) {
        if (tag & (1 << i)) {
            values[fieldIdx + i] = reader.readSignedVB();
        } else {
            values[fieldIdx + i] = 0;
        }
    }
    return count;
}
```

---

## Bug #3: AVERAGE_2 Truncation Direction

### Description

BF Explorer truncates toward zero (C integer division semantics). Our code uses arithmetic shift right (floor toward negative infinity).

### BF Explorer Code (`src/flightlog_parser.js`)

```javascript
case FLIGHT_LOG_FIELD_PREDICTOR_AVERAGE_2:
    if (!previous) break;
    // Round toward zero like C would do for integer division:
    value += ~~((previous[fieldIndex] + previous2[fieldIndex]) / 2);
    break;
```

### Our Code (`PredictorApplier.ts:112-114`)

```typescript
private static average2(prev: number, prev2: number): number {
    return (prev + prev2) >> 1;
}
```

### Value Comparison

| prev | prev2 | sum | BF `~~(sum/2)` | Ours `sum>>1` | Diff |
|------|-------|-----|----------------|---------------|------|
| -201 | 100 | -101 | -50 | -51 | 1 |
| -3 | -2 | -5 | -2 | -3 | 1 |
| 100 | 200 | 300 | 150 | 150 | 0 |
| -100 | -200 | -300 | -150 | -150 | 0 |

The difference only occurs when the sum of previous two values is an **odd negative number**.

### Impact

**Low.** The AVERAGE_2 predictor is used for fields like `vbatLatest`, `amperageLatest` — not for the core PID analysis fields (gyro, setpoint, PID terms). Even when triggered, the error is ±1 per P-frame and doesn't accumulate continuously (each I-frame resets prediction state).

### Fix

```typescript
private static average2(prev: number, prev2: number): number {
    // Truncate toward zero to match C integer division (and BF viewer)
    const sum = prev + prev2;
    return sum >= 0 ? (sum >> 1) : -(-sum >> 1);
}
```

Or more simply:
```typescript
private static average2(prev: number, prev2: number): number {
    return Math.trunc((prev + prev2) / 2);
}
```

---

## Bug #4: INCREMENT Predictor Missing `skippedFrames`

### Description

BF Explorer computes the increment as `skippedFrames + 1 + previous[i]`. Our code always increments by 1: `decoded + previous[i] + 1`. The `skippedFrames` value accounts for intentionally unlogged PID loop iterations between consecutive P-frames (based on blackbox logging ratio).

### BF Explorer Code (`src/flightlog_parser.js`)

```javascript
if (predictor[i] == FLIGHT_LOG_FIELD_PREDICTOR_INC) {
    current[i] = skippedFrames + 1;
    if (previous) current[i] += previous[i];
    i++;
}
```

The INC predictor is handled **before** the encoding switch — no bytes are read from the stream. The BF firmware confirms this: for P-frames, the `loopIteration` field uses `ENCODING_NULL` (0 bytes written).

### Our Code

In `FrameParser.ts`, the field goes through the normal decode path:
1. Encoding check: `BBLEncoding.NULL` → reads 0 bytes, `decoded = 0` ✅
2. Predictor: `BBLPredictor.INCREMENT` → `decoded + previous + 1 = 0 + prev + 1 = prev + 1`

**Stream alignment is correct** — NULL encoding reads 0 bytes, same as BF Explorer. The only difference is the semantic value of `loopIteration`.

### When Does This Matter?

When the blackbox P ratio is > 1 (logging at a subrate of the PID loop). For example:
- PID loop: 8 kHz, Blackbox rate: 1 kHz (P ratio = 8)
- Each logged P-frame should advance `loopIteration` by 8
- BF Explorer: `skippedFrames(=7) + 1 = 8` → correct
- Our code: always `+1` → iteration drifts

When P ratio = 1 (every iteration logged), both produce the same result.

### Impact

**Low.** The `loopIteration` field is only used for frame validation (iteration continuity check) and time series ordering. It does not affect gyro/setpoint/PID/motor values. Our frame validation uses relative thresholds (`MAX_ITERATION_JUMP = 5000`) which accommodate any reasonable P ratio.

However, the reconstructed `loopIteration` values in our parsed data will be incorrect for subrate logging, which means the frame merging/sorting by `loopIteration` in `mergeFrames()` could theoretically produce slightly wrong ordering if P-frames have colliding iteration values.

### Fix

To fully fix this, we would need to:
1. Track `skippedFrames` based on `shouldHaveFrame()` logic (uses I-interval and P-interval/P-denom from header)
2. Apply it in the INC predictor

For now, this is deferred since:
- Most modern BF setups log at PID rate (P ratio = 1)
- The impact is limited to frame ordering, not data values
- Implementation requires significant refactoring of the predictor interface

---

## Verified Correct Implementations

The following components were verified against BF Explorer and found to be correct:

### Encodings
- **SIGNED_VB**: ZigZag decode `(unsigned >>> 1) ^ -(unsigned & 1)` ✅
- **UNSIGNED_VB**: 7-bit LSB-first with MSB continuation ✅
- **TAG2_3S32**: Selector from `leadByte >> 6`, all 4 sub-cases correct ✅
- **TAG2_3SVARIABLE**: Selector from `leadByte >> 6`, 5-5-4 and 8-7-7 bit packing correct ✅
- **TAG8_4S16**: Version 1 (4/8/16-bit) and Version 2 (8/16/VB) paths correct ✅
- **NULL**: Returns 0, reads 0 bytes ✅

### Predictors
- **ZERO, PREVIOUS, STRAIGHT_LINE, MINTHROTTLE, MOTOR_0, HOME_COORD, SERVO_CENTER, VBATREF**: All match BF Explorer ✅
- **STRAIGHT_LINE null prev2 fallback**: Our code falls back to PREVIOUS (safer than BF Explorer which doesn't check) ✅
- **AVERAGE_2 null prev2 fallback**: Our code falls back to PREVIOUS (safer than BF Explorer which doesn't check) ✅

### Frame Processing
- **Field grouping**: Fixed-group (TAG2_3S32/TAG2_3SVARIABLE = 3) and variable-group (TAG8_8SVB up to 8, TAG8_4S16 = 4) ✅
- **I-frame prev2 reset**: Sets both `previousFrame` and `previousFrame2` to I-frame values ✅
- **NULL + EOF skip**: Correctly checks `def.encoding !== BBLEncoding.NULL` before EOF break ✅

### Corruption Recovery
- **Oversize frame**: Rewind to `frameStart + 1`, byte-by-byte advance ✅
- **Semantic failure**: Invalidate prediction state, no resync needed ✅
- **Unknown bytes**: Silently skip, invalidate prediction ✅
- **No forward-scan resync**: Matches BF Explorer behavior ✅
- **No consecutive corrupt limit**: Matches BF Explorer (only EOF/LOG_END stops parsing) ✅

### Event Frames
- **SYNC_BEEP**: 1×UVB ✅
- **DISARM**: 1×UVB ✅
- **FLIGHT_MODE**: 2×UVB ✅
- **LOGGING_RESUME**: 2×UVB ✅
- **INFLIGHT_ADJUSTMENT**: 1×U8 + conditional (float: skip(4), int: SVB) ✅
- **LOG_END**: Validates "End of log\0" string, terminates session ✅

### Header Parsing
- **P interval/P denom**: Handles both "P interval:N/D" and separate "pid_process_denom:N" ✅
- **Field definitions**: Comma-separated names/encodings/predictors/signed correctly parsed ✅
- **P-frame name inheritance**: Falls back to I-frame names when P-frame names absent ✅
- **Flash corruption in headers**: `readHeaderLine()` strips non-printable bytes ✅

---

## PIDtoolbox Comparison

PIDtoolbox (MATLAB/Octave) does NOT implement a native BBL parser. It delegates to `blackbox_decode`, the C command-line tool from the Betaflight project, which converts BBL to CSV. PIDtoolbox then reads the CSV.

This means PIDtoolbox's parsing accuracy is identical to the C reference implementation. For our purposes, the BF Explorer (JavaScript) is the more useful reference because:
1. It's the same language family (JS/TS)
2. It handles all the same edge cases
3. It's the tool most BF users actually use to view their logs

---

## Test Data

### Existing Test Coverage (205+ tests)
- StreamReader: VB encoding, line reading, byte manipulation
- HeaderParser: All header keys, field definitions, P interval parsing, corruption recovery
- ValueDecoder: All 8 encoding types with various inputs
- PredictorApplier: All 10 predictor types, null previous handling
- FrameParser: Grouped/single encodings, I/P/S frames
- BlackboxParser: Integration tests, multi-session, corruption recovery, flash header stripping

### Recommended Additional Test Data

1. **Real BBL files** from PID-Analyzer project:
   - `good_tune.BBL` (4.6 MB) — well-tuned quad, clean data
   - `stock_tune.BFL` (13 MB) — stock PIDs, likely noisier
   - Source: https://github.com/Plasmatree/PID-Analyzer

2. **Cross-validation approach**:
   - Parse the same BBL file with both our parser and `blackbox_decode` (C tool)
   - Compare output field-by-field (at least gyro, setpoint, PID, motor)
   - This catches any discrepancies we haven't identified

3. **Targeted regression tests for each bug**:
   - NEG_14BIT: Test with UVB values 0, 5, 127, 8192, 16383
   - TAG8_8SVB count=1: Synthetic BBL with single TAG8_8SVB field
   - AVERAGE_2: Test with negative odd sums
   - INCREMENT: Test with P ratio > 1

---

## Fix Plan

### Phase 1: Bug Fixes (Branch: `fix/bbl-parser-bugs`)

**Commit 1**: Fix NEG_14BIT encoding
- Modify `ValueDecoder.readNeg14Bit()` to use `signExtend14Bit` + negate
- Add `signExtend14Bit()` helper method
- Update tests: change expected values for NEG_14BIT test cases

**Commit 2**: Fix TAG8_8SVB count==1 special case
- Add `if (count === 1)` branch in `readTag8_8SVB()`
- Add test case for single-value TAG8_8SVB

**Commit 3**: Fix AVERAGE_2 truncation direction
- Replace `>> 1` with `Math.trunc((prev + prev2) / 2)`
- Add test cases for negative odd sums

**Commit 4**: Add cross-validation integration test
- Download sample BBL file
- Parse with our parser
- Verify key metrics (frame count, sample rate, duration)
- Spot-check gyro/setpoint values against known-good output

### Phase 2: Deferred (Future)

**INCREMENT skippedFrames**: Deferred until we encounter real-world issues with subrate logging. The fix requires:
- Computing `skippedFrames` from I-interval and P-interval headers
- Passing it through the predictor interface
- Only matters for `loopIteration` field, not analysis data

---

## Maintenance Strategy

1. **Reference tracking**: When BF releases new firmware versions with blackbox changes, review `blackbox.c` field definitions and encoding implementations for any new encodings or predictor types.

2. **Cross-validation CI**: Add an integration test that parses a known BBL file and compares output against a frozen "golden" reference (generated by `blackbox_decode`). This catches regressions automatically.

3. **BF Explorer version pinning**: Our validation is against BF Explorer at commit `HEAD` (Feb 2026). Pin the reference commit in test comments.

4. **Encoding ID stability**: BF encoding IDs (0,1,3,6,7,8,9,10) are stable across versions. The gaps (2,4,5) are reserved but unused. If BF adds new encodings, they would use IDs > 10 and our parser would fall through to the default handler (returns 0).
