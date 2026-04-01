# MSP Communication

MultiWii Serial Protocol layer for Betaflight flight controller communication.

## Protocol Layer

- `MSPProtocol.ts` - Low-level packet encoding/decoding. Jumbo frame support (frames >255 bytes: 2-byte size at offset+4)
- `MSPConnection.ts` - Serial port handling, CLI mode switching
- `MSPClient.ts` - High-level API with retry logic
- `mspLayouts.ts` - Byte offset definitions for all MSP fields (FILTER_CONFIG, PID_ADVANCED, RC_TUNING, etc.). Exports `readField()`, `writeField()` helpers
- `types.ts` - `MSPCommand` enum (all command IDs), `MSP_PROTOCOL` constants (preamble, jumbo threshold)
- `cliUtils.ts` - CLI command response validation (`validateCLIResponse()` throws `CLICommandError` on error patterns: 'Invalid name/value', 'Unknown command', 'Allowed range', line-level `ERROR`)

## Important MSP Behaviors

- FC may be stuck in CLI mode from previous session → `forceExitCLI()` on connect (resets local flag only)
- BF CLI `exit` command ALWAYS reboots FC (`systemReset()`) — no way to leave CLI without reboot
- `MSPConnection.close()` sends `exit` before closing if CLI was entered during the session (`fcEnteredCLI` flag)
- `exitCLI()`/`forceExitCLI()` only reset local `cliMode` flag — no commands sent to FC
- `clearFCRebootedFromCLI()` clears the flag after `save` (FC already reboots from save)
- Connection requires 500ms stabilization delay after port open
- Retry logic: 2 attempts with reset between failures
- **Version gate**: `validateFirmwareVersion()` checks API version on connect — rejects BF < 4.3 (API 1.44) with `UnsupportedVersionError`, auto-disconnects
- **BF PID profile selection**: `MSP_SELECT_SETTING` (210) switches active PID profile (0-indexed). `getStatusEx()` reads current `pidProfileIndex` and `pidProfileCount` from FC. FCInfo carries these fields.

## CLI Prompt Detection

`MSPConnection.sendCLICommand`: The real BF CLI prompt is `# ` (hash + space). Detection strips trailing `\r` from buffer (FC may send extra CR), then checks `endsWith('\n# ')`. Never use `trimEnd()` (it strips the space that distinguishes the prompt from section headers). **100ms debounce** in `sendCLICommand` — when the pattern matches, a timer starts. If more data arrives before it fires (e.g. `# master\r\n...`), the timer resets. Only when no data arrives for 100ms does it resolve as the real prompt. `enterCLI()` uses the same strip-CR + `endsWith('\n# ')` check but without debounce (no diff output during CLI entry).

## Betaflight Version Compatibility

**Minimum**: BF 4.3 (API 1.44) — **Recommended**: BF 4.5+ (API 1.46) — **Actively tested**: BF 4.5.x, 2025.12.x

- Version gate in `MSPClient.ts` auto-disconnects unsupported firmware on connect
- Constants in `src/shared/constants.ts`: `BETAFLIGHT.MIN_VERSION`, `BETAFLIGHT.MIN_API_VERSION`
- `UnsupportedVersionError` in `src/main/utils/errors.ts`
- **DEBUG_GYRO_SCALED**: Removed in BF 2025.12 (4.6+). Header validation and FCInfoDisplay skip debug mode check for 4.6+
- **CLI naming**: All `feedforward_*` (4.3+ naming only). No `ff_*` (4.2) support needed
- **MSP_FILTER_CONFIG**: 49-byte layout (47-byte base + 2-byte extension) stable from 4.3 onward. Dynamic lowpass fields: `gyro_lpf1_dyn_min_hz` (offset 29, U16), `gyro_lpf1_dyn_max_hz` (offset 31, U16), `dterm_lpf1_dyn_min_hz` (offset 33, U16), `dterm_lpf1_dyn_max_hz` (offset 35, U16)
- Full policy: `docs/BF_VERSION_POLICY.md`

## MSP Filter Config (`MSP_FILTER_CONFIG`, command 92)

- Reads current filter settings directly from FC (gyro LPF1/2, D-term LPF1/2, dynamic notch, dynamic lowpass)
- Dynamic lowpass fields at offsets listed above
- Auto-read in analysis handlers when FC connected and settings not provided
- Byte layout verified against betaflight-configurator MSPHelper.js

## MSP Dataflash Read (`MSP_DATAFLASH_READ`, command 0x46)

- Response format: `[4B readAddress LE][2B dataSize LE][1B isCompressed (BF4.1+)][flash data]`
- `MSPClient.extractFlashPayload()` returns `{ data, isCompressed }` — strips the 6-7 byte header, detects Huffman compression flag
- Both 6-byte (no compression flag) and 7-byte (with compression flag) formats supported
- `downloadBlackboxLog()` returns `{ data, compressionDetected }` — propagates compression flag to caller
- `BlackboxLogMetadata` includes `compressionDetected` field — persisted per log
- Huffman decompression not implemented — compressed logs are detected and blocked (analysis disabled, Huffman badge in UI)
