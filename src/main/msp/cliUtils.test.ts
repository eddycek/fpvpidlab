import { describe, it, expect } from 'vitest';
import { validateCLIResponse, CLICommandError } from './cliUtils';

describe('validateCLIResponse', () => {
  // ─── Valid responses (should NOT throw) ───────────────────────────

  it('accepts a valid "set" command response', () => {
    // BF CLI echoes: "set gyro_lpf1_static_hz = 200\r\n# "
    const response = 'set gyro_lpf1_static_hz = 200\r\n# ';
    expect(() => validateCLIResponse('set gyro_lpf1_static_hz = 200', response)).not.toThrow();
  });

  it('accepts a valid "set" response with current value echo', () => {
    // Some BF versions echo current value: "gyro_lpf1_static_hz = 200\r\nset gyro_lpf1_static_hz = 200\r\n# "
    const response = 'gyro_lpf1_static_hz = 200\r\nset gyro_lpf1_static_hz = 200\r\n# ';
    expect(() => validateCLIResponse('set gyro_lpf1_static_hz = 200', response)).not.toThrow();
  });

  it('accepts a "feature" command response', () => {
    const response = 'feature -TELEMETRY\r\n# ';
    expect(() => validateCLIResponse('feature -TELEMETRY', response)).not.toThrow();
  });

  it('accepts an empty prompt response', () => {
    const response = '# ';
    expect(() => validateCLIResponse('set debug_mode = GYRO_SCALED', response)).not.toThrow();
  });

  it('accepts response with multi-line output', () => {
    const response = 'serial 0 64 115200 57600 0 115200\r\nserial 1 0 115200 57600 0 115200\r\n# ';
    expect(() => validateCLIResponse('serial 0 64 115200 57600 0 115200', response)).not.toThrow();
  });

  // ─── Invalid name ─────────────────────────────────────────────────

  it('throws CLICommandError for "Invalid name" response', () => {
    const response = 'set gyro_lpf1_static_hzz = 200\r\nInvalid name\r\n# ';
    expect(() => validateCLIResponse('set gyro_lpf1_static_hzz = 200', response)).toThrow(
      CLICommandError
    );
  });

  it('includes command text in CLICommandError', () => {
    const cmd = 'set typo_setting = 100';
    const response = `${cmd}\r\nInvalid name\r\n# `;
    try {
      validateCLIResponse(cmd, response);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CLICommandError);
      const err = e as CLICommandError;
      expect(err.command).toBe(cmd);
      expect(err.matchedPattern).toBe('Invalid name');
      expect(err.response).toContain('Invalid name');
    }
  });

  // ─── Invalid value ────────────────────────────────────────────────

  it('throws CLICommandError for "Invalid value" response', () => {
    const response = 'set debug_mode = NOT_A_MODE\r\nInvalid value\r\n# ';
    expect(() => validateCLIResponse('set debug_mode = NOT_A_MODE', response)).toThrow(
      CLICommandError
    );
  });

  // ─── Unknown command ──────────────────────────────────────────────

  it('throws CLICommandError for "Unknown command" response', () => {
    const response = 'notacommand\r\nUnknown command\r\n# ';
    expect(() => validateCLIResponse('notacommand', response)).toThrow(CLICommandError);
  });

  // ─── Parse error ──────────────────────────────────────────────────

  it('throws CLICommandError for "Parse error" response', () => {
    const response = 'set gyro_lpf1_static_hz = abc\r\nParse error\r\n# ';
    expect(() => validateCLIResponse('set gyro_lpf1_static_hz = abc', response)).toThrow(
      CLICommandError
    );
  });

  // ─── ERROR ────────────────────────────────────────────────────────

  it('throws CLICommandError for generic "ERROR" response', () => {
    const response = 'some command\r\nERROR\r\n# ';
    expect(() => validateCLIResponse('some command', response)).toThrow(CLICommandError);
  });

  // ─── Edge cases ───────────────────────────────────────────────────

  it('does not false-positive on "error" in lowercase (BF uses uppercase ERROR)', () => {
    // A setting value might contain "error" in lowercase — that's not an error
    const response = 'set osd_warnings = BATTERY,NO_ERROR\r\n# ';
    expect(() =>
      validateCLIResponse('set osd_warnings = BATTERY,NO_ERROR', response)
    ).not.toThrow();
  });

  it('detects error pattern anywhere in multi-line response', () => {
    const response = 'line1\r\nline2\r\nInvalid name\r\nline3\r\n# ';
    expect(() => validateCLIResponse('set bad_name = 1', response)).toThrow(CLICommandError);
  });

  it('works with Windows-style line endings (CRLF)', () => {
    const response = 'set bad = 1\r\nInvalid name\r\n# ';
    expect(() => validateCLIResponse('set bad = 1', response)).toThrow(CLICommandError);
  });

  it('works with Unix-style line endings (LF only)', () => {
    const response = 'set bad = 1\nInvalid name\n# ';
    expect(() => validateCLIResponse('set bad = 1', response)).toThrow(CLICommandError);
  });

  // ─── CLICommandError properties ───────────────────────────────────

  it('CLICommandError has correct name property', () => {
    const err = new CLICommandError('set x = 1', 'Invalid name\r\n# ', 'Invalid name');
    expect(err.name).toBe('CLICommandError');
    expect(err.message).toContain('set x = 1');
    expect(err.message).toContain('Invalid name');
  });

  it('CLICommandError is an instance of Error', () => {
    const err = new CLICommandError('cmd', 'resp', 'pattern');
    expect(err).toBeInstanceOf(Error);
  });
});
