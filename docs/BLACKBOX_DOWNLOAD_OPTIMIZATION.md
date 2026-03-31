# Blackbox Download Optimization

> **Status**: Proposed

## Problem Statement

Blackbox flash download over MSP is extremely slow. Current implementation uses adaptive chunk sizes of **180–240 bytes** per MSP request, with 5ms inter-chunk delay and 500ms recovery delay on timeout. For a typical 16 MB flash chip, this means:

- **Best case** (240B chunks, no failures): ~67,000 requests × ~10ms each ≈ **~11 minutes**
- **Typical case** (with retries, adaptive shrinking): **15–25 minutes**
- **Worst case** (frequent timeouts, 128B fallback): **30+ minutes**

This is unacceptable UX, especially during iterative tuning sessions where the user needs to download logs after every flight.

### Why It's So Slow

The bottleneck is the combination of:

1. **Tiny chunk size** — MSP v1 payload limit is 256 bytes, but FC firmware often times out above ~240B, so we use 180–240B adaptive chunks
2. **Request-response latency** — each chunk requires a full MSP round-trip (request → FC reads flash → response)
3. **Serial overhead** — USB CDC virtual COM port adds overhead per transaction
4. **Conservative safety margins** — 5ms inter-chunk delay, 500ms recovery delay, max 5 consecutive failures before abort

### Current Implementation

**File**: `src/main/msp/MSPClient.ts` — `downloadBlackboxLog()` method

```
Initial chunk:  180 bytes
Min chunk:      128 bytes
Max chunk:      240 bytes
Growth:         +10 bytes after 50 consecutive successes
Shrink:         ×0.8 on failure
Inter-chunk:    5ms delay
Recovery:       500ms delay after timeout
Timeout:        5s per chunk read
Max failures:   5 consecutive → abort
```

**Flash read**: `MSP_DATAFLASH_READ` (cmd 0x46) — 6-byte request (4B address LE + 2B size LE), response header 6–7 bytes + payload.

## Proposed Solutions

### Solution A: MSC Mode for Flash Storage (Primary)

**Impact: 10–50× speedup** | **Complexity: Medium** | **Risk: Medium**

Reuse the existing MSC infrastructure (`src/main/msc/MSCManager.ts`, `driveDetector.ts`) that already works for SD card blackbox. Many modern FC boards with onboard flash also support MSC mode — the FC re-enumerates as a USB mass storage device, exposing the flash chip as a mountable drive.

#### How It Works

1. App sends `MSP_REBOOT` with type=2 (MSC mode)
2. FC reboots and re-enumerates as USB mass storage device
3. OS mounts the flash chip as a drive (contains `.BBL` files)
4. App copies files at native USB speed (~1–5 MB/s vs ~20 KB/s over MSP)
5. App ejects the drive
6. FC reboots normally, app reconnects

#### What We Already Have

The SD card MSC path is fully implemented and tested:
- `MSCManager.downloadLogs()` — full 6-stage lifecycle (snapshot → reboot → mount → copy → eject → reconnect)
- `driveDetector.ts` — cross-platform volume detection (macOS, Windows, Linux)
- BF log file pattern matching (`.BBL`, `.BFL`, `LOG*.TXT`)
- Progress reporting through IPC events
- Tuning session integration (phase transitions, `eraseCompleted` persistence)

#### What Needs To Be Done

##### Task 1: Flash MSC Capability Detection

Detect whether the connected FC supports MSC mode for its flash chip. Not all FCs support this — depends on firmware target and flash chip type.

- Read `MSP_BOARD_INFO` or `MSP_FC_VARIANT` for MSC capability flag
- BF 4.5+ exposes MSC support in board configuration
- Fallback: attempt MSC reboot, detect timeout (no USB device appears within 30s), recover gracefully
- Store capability per-profile to avoid re-detection: `profile.mscFlashSupported: boolean | null` (null = unknown, needs probe)

##### Task 2: Unified MSC Download Path

Refactor `MSCManager` to handle both SD card and flash storage transparently.

- Abstract storage-type differences (flash mounts as single partition, SD may have subdirectories)
- Flash MSC may expose raw flash as a single `.BBL` file or as a FAT filesystem with log files — handle both
- Update `BLACKBOX_DOWNLOAD_LOG` IPC handler to use MSC for flash when supported
- Ensure erase via MSC works (some FC erase flash via MSC mode, others require `MSP_DATAFLASH_ERASE` first)

##### Task 3: MSC Probe & Graceful Fallback

For FCs where MSC support is unknown (`mscFlashSupported === null`):

1. Attempt MSC reboot
2. Wait for USB device (30s timeout)
3. If mount detected → download via MSC, mark `mscFlashSupported = true`
4. If timeout → mark `mscFlashSupported = false`, reconnect to FC, fallback to MSP download
5. Show user-facing message: "Your FC doesn't support fast download mode. Using standard download."

Recovery from failed MSC probe:
- FC may be stuck in bootloader after failed MSC attempt
- Implement USB device detection to know if FC is still alive
- If FC doesn't reappear within 60s, prompt user to physically replug USB

##### Task 4: UI Integration

- Download button shows estimated time: "~30s (fast mode)" vs "~15min (standard)"
- Progress bar works for both paths (MSC already has stage-based progress)
- First-time MSC probe shows explanatory dialog: "Checking if your FC supports fast download..."
- Settings option to force MSP-only mode (for users with MSC issues)

##### Task 5: MSC Flash Erase

- Investigate if flash erase is possible via MSC mode (write zeros / format)
- If not, use existing `MSP_DATAFLASH_ERASE` before or after MSC download
- SD card erase already works via file deletion in MSC mode

#### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| FC doesn't support MSC for flash | Medium | Graceful fallback to MSP, per-profile caching |
| FC stuck after MSC probe failure | Medium | Timeout detection + user prompt to replug |
| Flash mounted as raw device (no filesystem) | Low | Detect and fall back to MSP |
| Platform-specific mount issues | Low | Already solved for SD card path |
| Erase behavior differs between flash/SD | Low | Test per-FC, document known behaviors |

### Solution B: MSP Request Pipelining (Secondary)

**Impact: 1.5–2× speedup** | **Complexity: Medium** | **Risk: Low**

For FCs that don't support MSC mode, improve the MSP download speed by sending multiple read requests without waiting for each response (pipelining).

#### How It Works

Current (sequential):
```
REQ[0] → wait → RESP[0] → REQ[1] → wait → RESP[1] → ...
```

Pipelined:
```
REQ[0] → REQ[1] → REQ[2] → RESP[0] → REQ[3] → RESP[1] → REQ[4] → RESP[2] → ...
```

Maintain a sliding window of N in-flight requests. As each response arrives, send the next request. This overlaps FC flash-read time with serial transfer time.

#### Implementation Plan

##### Task 6: MSP Pipeline Infrastructure

- Add request ID tracking to `MSPProtocol` — match responses to in-flight requests by address offset
- Implement sliding window with configurable depth (start conservative: window=2–3)
- Handle out-of-order responses (FC may process flash reads at different speeds)
- Timeout tracking per-request (not per-batch)

##### Task 7: Pipelined Flash Download

- New method `downloadBlackboxLogPipelined()` in `MSPClient`
- Window size: start at 2, adaptive growth (like chunk size) up to max 4–5
- On timeout/failure: drain pipeline, shrink window, retry from last confirmed offset
- Fall back to sequential on repeated pipeline failures
- Reuse existing progress reporting

##### Task 8: Pipeline Safety

- Some FC firmware may not handle concurrent MSP requests well — detect via error rate
- If error rate > 10% with window > 1, fall back to sequential (window=1)
- Never pipeline non-read commands (only safe for `MSP_DATAFLASH_READ`)

#### Estimated Speedup

With window=3 and 240B chunks:
- Sequential: ~10ms per chunk (5ms delay + 5ms transfer)
- Pipelined: ~5ms per chunk (overlap FC read with serial transfer)
- **Speedup: ~1.5–2×** (not transformative, but meaningful)

#### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| FC can't handle concurrent reads | Low | Adaptive window, fallback to sequential |
| Out-of-order responses | Low | Address-based matching |
| Buffer overflow on FC side | Low | Conservative max window (4–5) |

### Solution C: Larger Chunk Size (Deprioritized)

**Impact: Minimal** | **Complexity: Low** | **Risk: High (already tested, poor results)**

Previously attempted — increasing chunk size above 240B causes frequent timeouts on many FC boards. The timeout threshold varies by FC hardware (STM32F4 vs F7 vs H7) and firmware version.

**Why it doesn't work well:**
- FC firmware has internal buffer limits for `MSP_DATAFLASH_READ`
- SPI flash read latency increases with chunk size, causing MSP response timeouts
- Different FC boards have different thresholds (some work at 512B, many fail above 240B)
- Adaptive algorithm already maximizes chunk size per-FC

**What could marginally help:**
- Per-FC-target chunk size profiles (H7 boards may handle 512B+)
- Separate timeout for flash reads (current 5s is shared with all MSP commands)
- Reduce 5ms inter-chunk delay to 2ms (risk: FC instability on slower boards)

Not recommended as primary approach. May revisit if Solutions A and B don't provide sufficient improvement.

## Implementation Priority

```
Phase 1: MSC Flash Probe (Tasks 1, 3)
  → Detect if FC supports MSC for flash, graceful fallback
  → Immediate benefit for supported FCs

Phase 2: MSC Flash Download (Tasks 2, 4, 5)
  → Full MSC download path for flash storage
  → 10–50× speedup for supported FCs

Phase 3: MSP Pipelining (Tasks 6, 7, 8)
  → Fallback improvement for non-MSC FCs
  → 1.5–2× speedup
```

## Success Metrics

| Metric | Current | Target (MSC) | Target (Pipeline) |
|--------|---------|-------------|-------------------|
| 2 MB log download | ~3 min | ~5 sec | ~1.5 min |
| 16 MB full flash | ~15 min | ~30 sec | ~8 min |
| User-perceived wait | Painful | Acceptable | Tolerable |

## File List (Estimated)

| File | Change |
|------|--------|
| `src/main/msp/MSPClient.ts` | Pipeline download method, flash MSC detection |
| `src/main/msp/MSPProtocol.ts` | Request ID tracking for pipeline |
| `src/main/msc/MSCManager.ts` | Generalize for flash + SD card |
| `src/main/msc/driveDetector.ts` | Flash-specific mount patterns (if needed) |
| `src/main/ipc/handlers/blackboxHandlers.ts` | MSC-first download strategy |
| `src/shared/types/profile.types.ts` | `mscFlashSupported` field |
| `src/shared/types/blackbox.types.ts` | Download method indicator |
| `src/renderer/components/BlackboxStatus/` | Download speed indicator, MSC probe UI |
| `src/renderer/components/TuningWizard/` | Updated progress display |
| Tests for all above | New + updated |
