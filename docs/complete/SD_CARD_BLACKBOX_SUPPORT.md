# SD Card Blackbox Storage Support

> **Status**: Complete (PRs #105, #142)

## Problem

PIDlab only supports blackbox logging on FCs with **onboard SPI flash** (via `MSP_DATAFLASH_SUMMARY` / `MSP_DATAFLASH_READ`). Many FCs use **onboard SD cards** for blackbox storage — these report `supported: false` for dataflash, causing the misleading "Blackbox not supported or no flash storage detected" message even though blackbox logging works fine via SD card.

BF Configurator handles this via two mechanisms: detecting SD card state with `MSP_SDCARD_SUMMARY`, and downloading logs through MSC (Mass Storage Class) mode which reboots the FC as a USB drive.

## Analysis

### MSP Commands

| Command | Code | Purpose | Works with |
|---------|------|---------|------------|
| `MSP_DATAFLASH_SUMMARY` | 70 (0x46) | Flash chip info (supported, totalSize, usedSize) | SPI flash |
| `MSP_DATAFLASH_READ` | 71 (0x47) | Read flash data by address | SPI flash only |
| `MSP_DATAFLASH_ERASE` | 72 (0x48) | Erase entire flash | SPI flash only |
| `MSP_SDCARD_SUMMARY` | 79 (0x4F) | SD card state, free/total space | SD card |
| `MSP_REBOOT` | 68 | Reboot FC (normal, bootloader, MSC) | All |

**Key insight**: There is no `MSP_SDCARD_READ` command. SD card stores files on a FAT filesystem — the only way to access them over USB is MSC (Mass Storage Class) mode, where the FC reboots as a USB mass storage device.

### MSP_SDCARD_SUMMARY Response (11 bytes)

| Offset | Type | Field | Description |
|--------|------|-------|-------------|
| 0 | U8 | flags | Bit 0: SD card hardware supported |
| 1 | U8 | state | 0=not-present, 1=fatal, 2=card-init, 3=fs-init, 4=ready |
| 2 | U8 | lastError | Last AFATFS error code |
| 3–6 | U32 LE | freeSizeKB | Free space in KB (valid when state=4) |
| 7–10 | U32 LE | totalSizeKB | Total capacity in KB (valid when state=4) |

### MSP_REBOOT for MSC Mode

Send `MSP_REBOOT` (68) with payload:
- Byte 0: reboot type — `2` = MSC (FC timezone), `3` = MSC_UTC (UTC timezone)

Response:
- Byte 0: echoed reboot type
- Byte 1: `1` = storage ready (will reboot to MSC), `0` = not ready (aborted)

After MSC reboot:
- Serial/VCP connection **disappears** (USB re-enumerates as mass storage)
- OS mounts the SD card as a removable drive
- FC runs minimal loop (USB MSC transfers + button check)
- Exit via physical button press or power cycle → FC boots normally

### Drive Detection by Platform

| Platform | Mount point | Eject command |
|----------|------------|---------------|
| macOS | `/Volumes/<LABEL>` | `diskutil eject /Volumes/<LABEL>` |
| Windows | New drive letter (e.g. `E:\`) | PowerShell `$vol.DriveLetter` + safely remove |
| Linux | `/media/$USER/<LABEL>` or `/run/media/$USER/<LABEL>` | `udisksctl unmount -b /dev/sdX1 && udisksctl power-off -b /dev/sdX` |

### SD Card File Layout

BF writes logs to the root of the SD card as numbered files:
- `LOG00001.TXT`, `LOG00002.TXT`, ... (older BF)
- `BTFL_001.BBL`, `BTFL_002.BBL`, ... (newer BF)
- Pattern: `*.BBL`, `*.BFL`, `*.TXT` (LOG prefix)

## Implementation Plan

### Task 1: MSP Layer — SD Card Detection

**Files**: `src/main/msp/types.ts`, `src/main/msp/MSPClient.ts`, `src/shared/types/blackbox.types.ts`

1. Add `MSP_SDCARD_SUMMARY = 79` to `MSPCommand` enum
2. Add `SDCardState` enum (NOT_PRESENT=0, FATAL=1, CARD_INIT=2, FS_INIT=3, READY=4)
3. Add `SDCardInfo` interface: `{ supported, state, lastError, freeSizeKB, totalSizeKB }`
4. Add `getSDCardInfo(): Promise<SDCardInfo>` to MSPClient — sends MSP_SDCARD_SUMMARY, parses 11-byte response
5. Extend `BlackboxInfo` with `storageType: 'flash' | 'sdcard' | 'none'`
6. Update `getBlackboxInfo()`:
   - First try `MSP_DATAFLASH_SUMMARY` (existing logic)
   - If flash not supported → try `MSP_SDCARD_SUMMARY`
   - If SD card supported & ready → return `BlackboxInfo` with `storageType: 'sdcard'`, sizes from SD card (convert KB→bytes)
   - SD card `hasLogs`: always `true` when card is ready (we can't enumerate files via MSP)
   - SD card `usedSize`: `totalSize - freeSize` (approximate — includes non-log files)

### Task 2: MSP Layer — MSC Reboot

**Files**: `src/main/msp/types.ts`, `src/main/msp/MSPClient.ts`

1. Add `MSP_REBOOT` handling (already in enum as 68)
2. Add `RebootType` enum: `FIRMWARE=0, BOOTLOADER=1, MSC=2, MSC_UTC=3`
3. Add `rebootToMSC(): Promise<boolean>` to MSPClient:
   - Send MSP_REBOOT with payload `[2]` (MSC) or `[3]` (MSC_UTC on Linux)
   - Parse response: byte 1 = ready flag
   - If ready=1: return true (FC will reboot to MSC, serial connection will drop)
   - If ready=0: return false (storage not ready)
   - **Important**: Don't wait for disconnect — FC will disconnect on its own

### Task 3: MSCManager — Automated Mass Storage Download

**Files**: `src/main/msc/MSCManager.ts` (new), `src/main/msc/driveDetector.ts` (new)

#### MSCManager class

Orchestrates the complete MSC download/erase cycle:

```
enterMSC() → waitForMount() → listLogFiles() → copyFiles() / eraseFiles() → eject() → waitForReconnect()
```

**Methods**:
- `downloadLogs(onProgress): Promise<CopiedFile[]>` — full MSC download cycle
- `eraseLogs(onProgress): Promise<void>` — full MSC erase cycle (delete files + eject)
- `cancelOperation(): void` — abort current operation

**Progress stages** (reuses existing progress event pattern):
1. `entering_msc` — "Rebooting FC into mass storage mode..."
2. `waiting_mount` — "Waiting for SD card to mount..."
3. `copying` — "Copying log files... (3/5)" with per-file progress
4. `ejecting` — "Ejecting SD card..."
5. `waiting_reconnect` — "Waiting for FC to reconnect..."

**Timeouts**:
- Mount detection: 30 seconds (FC reboot + USB enumeration + OS mount)
- File copy: no fixed timeout (depends on file sizes), but abort if stalled >60s
- Eject: 10 seconds
- Reconnect: 15 seconds (3s cooldown + port reappear + connect)

#### driveDetector — Cross-platform USB Drive Detection

Platform-agnostic drive mount detector:

**macOS**:
- Poll `/Volumes/` for new directory appearing after MSC reboot
- Snapshot existing volumes before reboot, detect new one after
- Validate: check for BF log file patterns on the new volume

**Windows**:
- Use `wmic logicaldisk` or PowerShell to snapshot drives before/after
- Detect new drive letter

**Linux**:
- Poll `/media/$USER/` and `/run/media/$USER/` for new mount
- Or use `lsblk --json` before/after

**Common validation**:
- New volume must contain `*.BBL`, `*.BFL`, or `LOG*.TXT` files
- If multiple new volumes appear, pick the one with BF log files
- If no volume appears within timeout, report error with troubleshooting hints

### Task 4: IPC Integration

**Files**: `src/main/ipc/handlers.ts`, `src/shared/types/ipc.types.ts`, `src/preload/index.ts`

1. `BLACKBOX_GET_INFO` handler: already returns `BlackboxInfo` — now includes `storageType`
2. `BLACKBOX_DOWNLOAD_LOG` handler: branch on `storageType`:
   - `'flash'`: existing `MSP_DATAFLASH_READ` path (unchanged)
   - `'sdcard'`: MSC download path via `MSCManager.downloadLogs()`
   - After MSC copy: save each file via `BlackboxManager.saveLogFromFile()` (new method — saves pre-existing .bbl file instead of raw Buffer)
3. `BLACKBOX_ERASE_FLASH` handler: branch on `storageType`:
   - `'flash'`: existing `MSP_DATAFLASH_ERASE` path
   - `'sdcard'`: MSC erase path via `MSCManager.eraseLogs()`
4. Add new IPC event `EVENT_BLACKBOX_MSC_PROGRESS` for MSC stage updates (or reuse `EVENT_BLACKBOX_DOWNLOAD_PROGRESS` with extended payload)
5. `BlackboxManager.saveLogFromFile(filepath, profileId, fcSerial, fcInfo)` — copies .bbl file to logs dir, creates metadata entry

### Task 5: Connection Handling During MSC

**Files**: `src/main/index.ts`, `src/main/msp/MSPClient.ts`

The MSC workflow intentionally disconnects the FC. We need to prevent the normal "unexpected disconnect" handling from interfering:

1. Add `mscModeActive: boolean` flag to MSPClient
2. Before MSC reboot: set `mscModeActive = true`
3. `disconnected` event handler in `index.ts`: if `mscModeActive`, suppress profile clear and disconnect notification
4. After MSC eject + FC reconnect: clear `mscModeActive`, resume normal connection flow
5. Smart reconnect after MSC: works naturally — FC reconnects with same serial, profile auto-loads, tuning session transitions

### Task 6: UI — Transparent SD Card Experience

**Files**: `src/renderer/components/BlackboxStatus/BlackboxStatus.tsx`

The UI should be **identical** for flash and SD card from the user's perspective:

1. Remove the special `totalSize === 0` info message block (lines 122–138)
2. Storage bar shows used/free/total for both types
3. "Download Logs" button works for both (triggers appropriate backend path)
4. "Erase Flash" button label becomes "Erase Logs" for SD card (same functionality)
5. Progress display: for SD card, show MSC stages as sub-steps within the download progress:
   - "Entering mass storage mode..." → "Mounting SD card..." → "Copying files (2/5)..." → "Ejecting..." → "Reconnecting..."
6. Error states: "SD card not inserted", "SD card error — reboot FC", "MSC mode not supported"

### Task 7: Smart Reconnect with SD Card

**Files**: `src/main/index.ts`

Smart reconnect currently checks `bbInfo.hasLogs && bbInfo.usedSize > 0` to auto-transition `*_flight_pending → *_log_ready`. For SD card:

- `hasLogs` is always `true` when card is ready (we can't enumerate files via MSP)
- `usedSize > 0` will always be true (card has filesystem overhead)
- Need smarter detection: compare `usedSize` before and after flight (store pre-flight usedSize in tuning session)
- Or: skip auto-transition for SD card, require manual "I've flown" confirmation
- **Simplest approach**: For SD card, if tuning session is in `*_flight_pending`, show "Logs Ready?" confirmation button instead of auto-transitioning

### Task 8: Tests

**Test files** (co-located):
- `src/main/msp/MSPClient.test.ts` — extend with `getSDCardInfo()`, `getBlackboxInfo()` SD card path, `rebootToMSC()`
- `src/main/msc/MSCManager.test.ts` (new) — mock fs/child_process, test download/erase/cancel flows
- `src/main/msc/driveDetector.test.ts` (new) — mock platform detection
- `src/renderer/components/BlackboxStatus/BlackboxStatus.test.ts` — extend for storageType='sdcard'
- `src/main/ipc/handlers.test.ts` — extend for SD card IPC paths

---

## Post-Implementation Fixes (Discovered during testing)

The original Tasks 1–8 shipped in PR #105. Testing revealed several issues with how SD card operations interact with the tuning session workflow. These fixes are tracked below.

### Fix 1: Multi-file SD card download returns incompatible type

**Problem**: `BLACKBOX_DOWNLOAD_LOG` handler returns `BlackboxLogMetadata | BlackboxLogMetadata[]` for SD card. When multiple log files exist on the SD card, the preload API type `Promise<BlackboxLogMetadata>` is violated — the renderer gets an array where it expects a single object. `metadata.filename` and `metadata.id` are `undefined`.

**Fix**: Always return the **last** (newest) metadata from the array. The tuning workflow needs only the most recent flight log. Keep all files saved to disk but return one to the caller.

**Files**: `src/main/ipc/handlers/blackboxHandlers.ts`

### Fix 2: SD-card-aware labels in TuningStatusBanner

**Problem**: `PHASE_UI` hardcodes `buttonLabel: 'Erase Flash'` and text mentions "Flash" for `filter_flight_pending`, `pid_flight_pending`, `filter_applied`. SD card users see incorrect terminology.

**Fix**: Pass `storageType` prop to `TuningStatusBanner`. Use "Erase Logs" and "SD card" in text when `storageType === 'sdcard'`. Update post-erase text similarly.

**Files**: `src/renderer/components/TuningStatusBanner/TuningStatusBanner.tsx`, `src/renderer/App.tsx`

### Fix 3: `showErasedState` broken for SD card after erase

**Problem**: After MSC erase + FC reconnect, `getBlackboxInfo()` returns `usedSize > 0` (filesystem overhead on FAT). The `showErasedState` guard requires `!flashHasData` (i.e. `flashUsedSize === 0`) — which is never true for SD card. So the banner shows "Erase" button again instead of "Flash erased! Fly..."

**Root cause**: `showErasedState` logic assumes flash behavior where `usedSize === 0` after erase. SD cards always report some used space.

**Fix**:
1. Add `eraseCompleted?: boolean` field to `TuningSession` (persisted)
2. After MSC erase during tuning, update session with `eraseCompleted: true`
3. Clear `eraseCompleted` when transitioning to the next phase (e.g. `*_log_ready`, `*_analysis`)
4. In `showErasedState`, also check `session.eraseCompleted` as an alternative to `flashUsedSize === 0`

**Files**: `src/shared/types/tuning.types.ts`, `src/renderer/App.tsx`, `src/renderer/components/TuningStatusBanner/TuningStatusBanner.tsx`, `src/main/ipc/handlers/blackboxHandlers.ts`

### Fix 4: Smart reconnect after SD card MSC erase during tuning

**Problem**: After MSC erase in tuning, FC reconnects. Smart reconnect for SD card currently just logs "skipping auto-transition (user must confirm)". But the user explicitly initiated erase — the session should know erase completed.

**Fix**: When `session.eraseCompleted === true` and `storageType === 'sdcard'`, clear the flag (it served its purpose — the banner will show the post-erase flight guide). Don't auto-transition to `*_log_ready` (user hasn't flown yet). The existing `eraseSkipped` path handles the "flew and came back" transition.

**Files**: `src/main/index.ts`

### Fix 5: MSC erase during tuning — persist eraseCompleted via IPC

**Problem**: The `handleTuningAction('erase_flash')` in App.tsx calls `eraseBlackboxFlash()` (which does MSC cycle for SD card), then sets `erasedForPhase` React state. But the FC disconnects during MSC — when it reconnects, the volatile `erasedForPhase` state is still set (AppContent doesn't unmount), but `flashUsedSize` gets refreshed to > 0, breaking `showErasedState`.

**Fix**: After successful MSC erase, call `tuning.updatePhase(currentPhase, { eraseCompleted: true })` to persist the flag. On reconnect, the banner reads it from the session and shows the correct post-erase state regardless of `flashUsedSize`.

**Files**: `src/renderer/App.tsx`

### Fix 6: Verification erase for SD card

**Problem**: `prepare_verification` action calls `eraseBlackboxFlash()` which triggers MSC for SD card. Same erase state issues as Fix 3/5.

**Fix**: Same pattern — persist `eraseCompleted` on session after erase. The verification_pending path in `showErasedState` should also check it.

**Files**: `src/renderer/App.tsx`

## Risk Assessment

### High Risk
- **Platform-specific drive detection**: Different behavior across macOS/Windows/Linux. Mitigated by: abstract platform layer, focus on macOS first (user's platform), CI tests with mocked fs.
- **MSC mode timing**: FC reboot + USB re-enumeration + OS mount can take variable time. Mitigated by: generous timeouts (30s mount), polling with validation.

### Medium Risk
- **FC doesn't support MSC**: Some targets may not have `USE_USB_MSC`. Mitigated by: check MSP_REBOOT response byte 1 (ready flag), show helpful error.
- **Drive not ejecting cleanly**: OS may hold file handles. Mitigated by: close all file handles before eject, retry eject.
- **Serial port path changes after MSC**: Some OSes assign different port names. Mitigated by: scan all ports after MSC, match by VID/PID.

### Low Risk
- **Multiple USB drives**: User may have other USB drives connected. Mitigated by: snapshot before/after, validate BF log files on new volume.
- **Smart reconnect false positives for SD card**: Card always has data. Mitigated by: use confirmation button instead of auto-transition for SD card.

## File List

| File | Action | Description |
|------|--------|-------------|
| `src/main/msp/types.ts` | Modify | Add MSP_SDCARD_SUMMARY, RebootType |
| `src/main/msp/MSPClient.ts` | Modify | Add getSDCardInfo(), rebootToMSC(), update getBlackboxInfo() |
| `src/shared/types/blackbox.types.ts` | Modify | Add storageType to BlackboxInfo, SDCardState, SDCardInfo |
| `src/main/msc/MSCManager.ts` | New | MSC download/erase orchestrator |
| `src/main/msc/driveDetector.ts` | New | Cross-platform USB drive mount detection |
| `src/main/storage/BlackboxManager.ts` | Modify | Add saveLogFromFile() for pre-existing .bbl files |
| `src/main/ipc/handlers.ts` | Modify | Branch download/erase on storageType |
| `src/main/index.ts` | Modify | MSC-aware disconnect handling, SD card smart reconnect |
| `src/renderer/components/BlackboxStatus/BlackboxStatus.tsx` | Modify | Transparent SD card UX |
| `src/renderer/hooks/useBlackboxInfo.ts` | Minor | No changes needed (returns BlackboxInfo as-is) |
| `src/main/msp/MSPClient.test.ts` | Modify | SD card + MSC tests |
| `src/main/msc/MSCManager.test.ts` | New | MSC flow tests |
| `src/main/msc/driveDetector.test.ts` | New | Drive detection tests |
| `src/renderer/components/BlackboxStatus/BlackboxStatus.test.tsx` | Modify | SD card UI tests |
