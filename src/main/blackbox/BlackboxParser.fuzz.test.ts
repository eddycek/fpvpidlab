import { describe, it, expect } from 'vitest';
import { BlackboxParser, BlackboxParseError } from './BlackboxParser';

// ---------------------------------------------------------------------------
// Helper: Variable-byte encoders
// ---------------------------------------------------------------------------

/** Encode unsigned value as variable-byte and push to array */
function pushUVB(arr: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    arr.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  arr.push(v & 0x7f);
}

/** Encode signed value as zigzag VB and push to array */
function pushSVB(arr: number[], value: number): void {
  const zigzag = (value << 1) ^ (value >> 31);
  pushUVB(arr, zigzag >>> 0);
}

// ---------------------------------------------------------------------------
// Helper: Build minimal valid BBL headers
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid BBL header buffer with standard I/P field definitions.
 * Returns only the header section (no frame data).
 */
function buildMinimalHeaders(options?: { fieldNames?: string; fieldCount?: number }): Buffer {
  const defaultFieldNames = 'loopIteration,time,gyroADC[0],gyroADC[1],gyroADC[2]';
  let fieldNames = options?.fieldNames ?? defaultFieldNames;

  // If fieldCount is specified, generate that many fields
  if (options?.fieldCount !== undefined) {
    const names: string[] = [];
    for (let i = 0; i < options.fieldCount; i++) {
      names.push(`field${i}`);
    }
    fieldNames = names.join(',');
  }

  const fieldCount = fieldNames ? fieldNames.split(',').filter((n) => n.trim()).length : 0;
  const iSigned = new Array(fieldCount).fill('0').join(',');
  const iPredictors = new Array(fieldCount).fill('0').join(',');
  const iEncodings = new Array(fieldCount).fill('1').join(','); // UNSIGNED_VB

  const headers = [
    'H Product:Blackbox flight data recorder by Nicholas Sherlock',
    'H Data version:2',
    'H I interval:32',
    'H P interval:1/2',
    'H Firmware type:Betaflight',
    'H Firmware revision:4.4.2',
    'H looptime:312',
    'H minthrottle:1070',
    'H vbatref:420',
    `H Field I name:${fieldNames}`,
    `H Field I signed:${iSigned}`,
    `H Field I predictor:${iPredictors}`,
    `H Field I encoding:${iEncodings}`,
    `H Field P name:${fieldNames}`,
    `H Field P signed:${iSigned}`,
    `H Field P predictor:${new Array(fieldCount).fill('1').join(',')}`,
    `H Field P encoding:${new Array(fieldCount).fill('0').join(',')}`,
  ];

  return Buffer.from(headers.join('\n') + '\n');
}

/**
 * Build a single valid I-frame with the default 5-field layout:
 * loopIteration, time, gyroADC[0], gyroADC[1], gyroADC[2]
 */
function buildIFrame(loopIter: number, time: number, gyro: [number, number, number]): Buffer {
  const bytes: number[] = [0x49]; // 'I'
  pushUVB(bytes, loopIter);
  pushUVB(bytes, time);
  pushSVB(bytes, gyro[0]);
  pushSVB(bytes, gyro[1]);
  pushSVB(bytes, gyro[2]);
  return Buffer.from(bytes);
}

/** Full LOG_END event bytes: marker(E=0x45) + type(0xFF) + "End of log\0" */
function logEndBytes(): Buffer {
  return Buffer.from([0x45, 0xff, ...Buffer.from('End of log\0', 'ascii')]);
}

// ---------------------------------------------------------------------------
// Fuzz / Property-Based Tests
// ---------------------------------------------------------------------------

describe('BlackboxParser fuzz / robustness', () => {
  it('survives 1000 random bytes without crashing', async () => {
    const randomBytes = Buffer.alloc(1000);
    for (let i = 0; i < 1000; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }

    try {
      const result = await BlackboxParser.parse(randomBytes);
      // If it returns, it should be a valid result shape
      expect(result).toHaveProperty('sessions');
      expect(result).toHaveProperty('fileSize');
    } catch (err) {
      // Only BlackboxParseError is acceptable
      expect(err).toBeInstanceOf(BlackboxParseError);
    }
  });

  it('handles truncated file at every position in last header line', async () => {
    const fullHeaders = buildMinimalHeaders();
    const headerStr = fullHeaders.toString('ascii');

    // Find the start of the last header line (last "H Field P encoding:...")
    const lastLineStart = headerStr.lastIndexOf('\nH Field P encoding:');
    expect(lastLineStart).toBeGreaterThan(0);

    // Truncate at every position within the last line
    const errors: string[] = [];
    for (let pos = lastLineStart + 1; pos < fullHeaders.length; pos++) {
      const truncated = fullHeaders.subarray(0, pos);
      try {
        const result = await BlackboxParser.parse(truncated);
        // Returning a result (success or failure) is fine
        expect(result).toHaveProperty('sessions');
      } catch (err) {
        if (err instanceof BlackboxParseError) {
          // Expected - graceful error
        } else {
          errors.push(
            `Position ${pos}: unexpected error type: ${(err as Error).constructor.name}: ${(err as Error).message}`
          );
        }
      }
    }

    expect(errors).toEqual([]);
  });

  it('handles truncated file mid-I-frame at every byte position', async () => {
    const headers = buildMinimalHeaders();
    const iframe = buildIFrame(0, 0, [100, -50, 30]);

    // Build complete buffer without LOG_END
    const complete = Buffer.concat([headers, iframe]);

    const errors: string[] = [];
    // Truncate at every position within the I-frame
    for (let pos = headers.length; pos < complete.length; pos++) {
      const truncated = complete.subarray(0, pos);
      try {
        const result = await BlackboxParser.parse(truncated);
        // May return success=false (no frames) or success=true (partial)
        expect(result).toHaveProperty('sessions');
        expect(result).toHaveProperty('fileSize');
      } catch (err) {
        if (err instanceof BlackboxParseError) {
          // Expected
        } else {
          errors.push(
            `Position ${pos}: unexpected error: ${(err as Error).constructor.name}: ${(err as Error).message}`
          );
        }
      }
    }

    expect(errors).toEqual([]);
  });

  it('handles valid headers followed by 500 random payload bytes', async () => {
    const headers = buildMinimalHeaders();
    const randomPayload = Buffer.alloc(500);
    for (let i = 0; i < 500; i++) {
      randomPayload[i] = Math.floor(Math.random() * 256);
    }

    const data = Buffer.concat([headers, randomPayload]);

    try {
      const result = await BlackboxParser.parse(data);
      // Parser should return a result (possibly with no valid sessions)
      expect(result).toHaveProperty('sessions');
      expect(result).toHaveProperty('fileSize');
      expect(result.fileSize).toBe(data.length);
    } catch (err) {
      expect(err).toBeInstanceOf(BlackboxParseError);
    }
  });

  it('does not hang on 10KB of all-zero bytes', { timeout: 10000 }, async () => {
    const zeros = Buffer.alloc(10240, 0x00);

    try {
      const result = await BlackboxParser.parse(zeros);
      expect(result).toHaveProperty('sessions');
    } catch (err) {
      expect(err).toBeInstanceOf(BlackboxParseError);
    }
  });

  it('handles I-frame with huge loopIteration value (0xFFFFFFFF) without overflow', async () => {
    const headers = buildMinimalHeaders();

    // Build I-frame with loopIteration = 0x0FFFFFFF (max safe for VB encoding
    // within 5 bytes) and time = 0
    const bytes: number[] = [0x49]; // 'I'
    pushUVB(bytes, 0x0fffffff); // huge iteration
    pushUVB(bytes, 0); // time = 0
    pushSVB(bytes, 10); // gyro[0]
    pushSVB(bytes, -5); // gyro[1]
    pushSVB(bytes, 3); // gyro[2]
    const iframe = Buffer.from(bytes);

    const data = Buffer.concat([headers, iframe, logEndBytes()]);

    try {
      const result = await BlackboxParser.parse(data);
      expect(result).toHaveProperty('sessions');
      // The frame might be accepted or rejected semantically, but no crash
      expect(result.fileSize).toBe(data.length);
    } catch (err) {
      expect(err).toBeInstanceOf(BlackboxParseError);
    }
  });

  it('handles I-frame with huge time value (0xFFFFFFFF) without overflow', async () => {
    const headers = buildMinimalHeaders();

    const bytes: number[] = [0x49]; // 'I'
    pushUVB(bytes, 0); // loopIteration = 0
    pushUVB(bytes, 0x0fffffff); // huge time
    pushSVB(bytes, 10); // gyro[0]
    pushSVB(bytes, -5); // gyro[1]
    pushSVB(bytes, 3); // gyro[2]
    const iframe = Buffer.from(bytes);

    const data = Buffer.concat([headers, iframe, logEndBytes()]);

    try {
      const result = await BlackboxParser.parse(data);
      expect(result).toHaveProperty('sessions');
      expect(result.fileSize).toBe(data.length);
    } catch (err) {
      expect(err).toBeInstanceOf(BlackboxParseError);
    }
  });

  it('handles header with 0 fields gracefully', async () => {
    // Build headers where field name line is present but empty
    const headers = [
      'H Product:Blackbox flight data recorder by Nicholas Sherlock',
      'H Data version:2',
      'H I interval:32',
      'H P interval:1/2',
      'H Firmware type:Betaflight',
      'H Firmware revision:4.4.2',
      'H looptime:312',
      'H Field I name:',
      'H Field I signed:',
      'H Field I predictor:',
      'H Field I encoding:',
    ];
    const data = Buffer.from(headers.join('\n') + '\n');

    try {
      const result = await BlackboxParser.parse(data);
      // With 0 I-frame fields, session should be null (no valid session)
      expect(result.success).toBe(false);
      expect(result.sessions).toHaveLength(0);
    } catch (err) {
      expect(err).toBeInstanceOf(BlackboxParseError);
    }
  });

  it('handles header with 100 fields without crashing', async () => {
    const headers = buildMinimalHeaders({ fieldCount: 100 });

    // Build an I-frame with 100 UVB-encoded values
    const bytes: number[] = [0x49]; // 'I'
    for (let i = 0; i < 100; i++) {
      pushUVB(bytes, i);
    }
    const iframe = Buffer.from(bytes);

    const data = Buffer.concat([headers, iframe, logEndBytes()]);

    try {
      const result = await BlackboxParser.parse(data);
      expect(result).toHaveProperty('sessions');
      expect(result.fileSize).toBe(data.length);
    } catch (err) {
      expect(err).toBeInstanceOf(BlackboxParseError);
    }
  });

  it('accepts I-frame that is exactly 256 bytes (MAX_FRAME_LENGTH)', async () => {
    // Build headers with enough UVB fields to make a frame exactly 256 bytes.
    // Frame = 1 marker byte + encoded field values. Target total = 256 bytes.
    // UVB encoding: values >= 0x10000000 (2^28) require exactly 5 bytes.
    // 1 (marker) + N*5 (each field = 5-byte UVB) = 256 => N = 51 fields

    const fieldCount = 51;
    const headers = buildMinimalHeaders({ fieldCount });

    // Build I-frame: marker + 51 values, each encoded as 5-byte UVB
    const bytes: number[] = [0x49]; // 'I' marker (1 byte)
    for (let i = 0; i < fieldCount; i++) {
      // 0x10000000 (2^28) requires exactly 5 VB bytes
      pushUVB(bytes, 0x10000000);
    }

    const iframe = Buffer.from(bytes);
    // Verify our math: should be 1 + 51*5 = 256 bytes
    expect(iframe.length).toBe(256);

    const data = Buffer.concat([headers, iframe, logEndBytes()]);
    const result = await BlackboxParser.parse(data);

    // Frame is exactly at the limit, so it should be structurally accepted.
    // It may be semantically rejected (huge iteration/time jumps), but the
    // parser should not treat it as an oversize corrupt frame.
    expect(result).toHaveProperty('sessions');
    expect(result.fileSize).toBe(data.length);
  });

  it('rejects I-frame exceeding 256 bytes (MAX_FRAME_LENGTH) as corrupt', async () => {
    // Build a frame that is 257+ bytes. Use 52 fields with 5-byte UVB each.
    const fieldCount = 52;
    const headers = buildMinimalHeaders({ fieldCount });

    const bytes: number[] = [0x49]; // 'I' marker
    for (let i = 0; i < fieldCount; i++) {
      // 0x10000000 (2^28) requires exactly 5 VB bytes
      pushUVB(bytes, 0x10000000);
    }

    const iframe = Buffer.from(bytes);
    // 1 + 52*5 = 261 bytes > 256
    expect(iframe.length).toBeGreaterThan(256);

    // Add a second valid small I-frame after the oversize one to verify recovery
    const smallFrame: number[] = [0x49];
    for (let i = 0; i < fieldCount; i++) {
      pushUVB(smallFrame, i); // small values, 1-2 bytes each
    }
    const smallIFrame = Buffer.from(smallFrame);

    const data = Buffer.concat([headers, iframe, smallIFrame, logEndBytes()]);
    const result = await BlackboxParser.parse(data);

    expect(result).toHaveProperty('sessions');
    expect(result.fileSize).toBe(data.length);
    // The oversize frame should be rejected; the session may still have the
    // small frame or may have no valid frames at all (both are acceptable).
    if (result.success && result.sessions.length > 0) {
      expect(result.sessions[0].corruptedFrameCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns failure for file with only headers and no data frames', async () => {
    const headers = buildMinimalHeaders();
    const result = await BlackboxParser.parse(headers);

    expect(result.success).toBe(false);
    expect(result.sessions).toHaveLength(0);
    expect(result.error).toBeDefined();
  });

  it('handles P-frame before any I-frame gracefully (no crash)', async () => {
    const headers = buildMinimalHeaders();

    // P-frame marker (0x50) with some SVB-encoded deltas
    const pBytes: number[] = [0x50]; // 'P'
    pushSVB(pBytes, 1); // loopIteration delta
    pushSVB(pBytes, 312); // time delta
    pushSVB(pBytes, 5); // gyro[0] delta
    pushSVB(pBytes, -3); // gyro[1] delta
    pushSVB(pBytes, 2); // gyro[2] delta
    const pFrame = Buffer.from(pBytes);

    // Then a valid I-frame that should still be parseable
    const iframe = buildIFrame(0, 0, [100, -50, 30]);

    const data = Buffer.concat([headers, pFrame, iframe, logEndBytes()]);
    const result = await BlackboxParser.parse(data);

    expect(result).toHaveProperty('sessions');
    // The I-frame should still be found even though P-frame came first
    if (result.success && result.sessions.length > 0) {
      expect(result.sessions[0].flightData.frameCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('handles two consecutive LOG_END events (second starts new session search)', async () => {
    const headers = buildMinimalHeaders();
    const iframe = buildIFrame(0, 0, [100, -50, 30]);

    // Session 1: headers + 1 I-frame + LOG_END
    const session1 = Buffer.concat([headers, iframe, logEndBytes()]);

    // Session 2: same structure
    const iframe2 = buildIFrame(0, 0, [200, -100, 60]);
    const session2 = Buffer.concat([headers, iframe2, logEndBytes()]);

    // Put two LOG_END events between sessions (the first is session1's normal end,
    // plus an extra orphan LOG_END that appears before session2 headers)
    const extraLogEnd = logEndBytes();

    const data = Buffer.concat([session1, extraLogEnd, session2]);
    const result = await BlackboxParser.parse(data);

    expect(result).toHaveProperty('sessions');
    expect(result.success).toBe(true);
    // Should find at least 2 sessions (the extra LOG_END between them is harmless)
    expect(result.sessions.length).toBeGreaterThanOrEqual(2);
  });

  it(
    'handles 10000 repeated valid I-frames without hanging or memory issues',
    { timeout: 10000 },
    async () => {
      const headers = buildMinimalHeaders();
      const parts: Buffer[] = [headers];

      for (let i = 0; i < 10000; i++) {
        const loopIter = i * 32;
        const time = loopIter * 312;
        parts.push(buildIFrame(loopIter, time, [10 + (i % 50), -(5 + (i % 30)), i % 20]));
      }

      parts.push(logEndBytes());
      const data = Buffer.concat(parts);

      const result = await BlackboxParser.parse(data);

      expect(result).toHaveProperty('sessions');
      expect(result.success).toBe(true);
      expect(result.sessions.length).toBeGreaterThanOrEqual(1);
      // Should have parsed a substantial number of frames
      expect(result.sessions[0].flightData.frameCount).toBeGreaterThan(100);
    }
  );

  it('survives a buffer filled with every possible byte value (0x00-0xFF)', async () => {
    const data = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) {
      data[i] = i;
    }

    try {
      const result = await BlackboxParser.parse(data);
      expect(result).toHaveProperty('sessions');
    } catch (err) {
      expect(err).toBeInstanceOf(BlackboxParseError);
    }
  });

  it('survives alternating frame markers and EOF bytes', async () => {
    // Build a buffer of alternating known frame markers without valid payloads
    const markers = [0x49, 0x50, 0x45, 0x53, 0x47, 0x48]; // I, P, E, S, G, H
    const data = Buffer.alloc(600);
    for (let i = 0; i < 600; i++) {
      data[i] = markers[i % markers.length];
    }

    try {
      const result = await BlackboxParser.parse(data);
      expect(result).toHaveProperty('sessions');
    } catch (err) {
      expect(err).toBeInstanceOf(BlackboxParseError);
    }
  });

  it(
    'handles valid headers followed by repeating 0xFF bytes (potential false LOG_END flood)',
    { timeout: 10000 },
    async () => {
      const headers = buildMinimalHeaders();

      // Add a valid I-frame first so we have a parseable session
      const iframe = buildIFrame(0, 0, [100, -50, 30]);

      // Then flood with 0xFF bytes (0x45=E marker + 0xFF=LOG_END type appears frequently)
      const flood = Buffer.alloc(2000, 0xff);

      const data = Buffer.concat([headers, iframe, flood]);

      try {
        const result = await BlackboxParser.parse(data);
        expect(result).toHaveProperty('sessions');
        expect(result.fileSize).toBe(data.length);
      } catch (err) {
        expect(err).toBeInstanceOf(BlackboxParseError);
      }
    }
  );
});
