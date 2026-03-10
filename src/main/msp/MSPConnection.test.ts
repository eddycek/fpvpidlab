import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildMSPv1Response, buildMSPv1ErrorResponse } from './test/mspResponseFactory';

// Track mock port instances across test and MSPConnection
let mockPortInstance: any = null;

vi.mock('serialport', () => {
  const { EventEmitter } = require('events');

  class MockPort extends EventEmitter {
    isOpen = false;
    writtenData: Buffer[] = [];
    path: string;
    baudRate: number;
    private _shouldFailWrite = false;

    constructor(opts: any, callback?: any) {
      super();
      this.path = opts.path;
      this.baudRate = opts.baudRate;
      mockPortInstance = this;
      if (callback) {
        process.nextTick(() => {
          this.isOpen = true;
          callback(null);
        });
      }
    }

    write(data: string | Buffer, callback?: (error?: Error | null) => void): boolean {
      if (this._shouldFailWrite) {
        if (callback) callback(new Error('Write failed'));
        return false;
      }
      const buf = typeof data === 'string' ? Buffer.from(data) : data;
      this.writtenData.push(buf);
      if (callback) process.nextTick(() => callback(null));
      return true;
    }

    drain(callback?: (error?: Error | null) => void): void {
      if (callback) process.nextTick(() => callback(null));
    }

    close(callback?: (error?: Error | null) => void): void {
      this.isOpen = false;
      if (callback) process.nextTick(() => callback(null));
    }

    // Test helpers
    injectData(data: Buffer | string) {
      const buf = typeof data === 'string' ? Buffer.from(data) : data;
      this.emit('data', buf);
    }
    injectClose() {
      this.isOpen = false;
      this.emit('close');
    }
    injectError(err: Error) {
      this.emit('error', err);
    }
    failWrites() {
      this._shouldFailWrite = true;
    }
    getAllWrittenBytes() {
      return Buffer.concat(this.writtenData);
    }
    clearWritten() {
      this.writtenData = [];
    }
  }

  return {
    SerialPort: MockPort,
  };
});

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import after mocks are set up
import { MSPConnection } from './MSPConnection';

describe('MSPConnection', () => {
  let conn: MSPConnection;

  beforeEach(() => {
    mockPortInstance = null;
    conn = new MSPConnection();
  });

  afterEach(() => {
    conn.removeAllListeners();
  });

  function getPort(): any {
    return mockPortInstance;
  }

  // ─── open() ─────────────────────────────────────────────────

  describe('open', () => {
    it('opens port with correct parameters', async () => {
      await conn.open('/dev/ttyUSB0', 115200);
      const port = getPort();

      expect(port).not.toBeNull();
      expect(port.path).toBe('/dev/ttyUSB0');
      expect(port.baudRate).toBe(115200);
      expect(conn.isOpen()).toBe(true);
    });

    it('uses default baud rate 115200', async () => {
      await conn.open('/dev/ttyUSB0');
      expect(getPort().baudRate).toBe(115200);
    });

    it('emits connected event on success', async () => {
      const connectedSpy = vi.fn();
      conn.on('connected', connectedSpy);

      await conn.open('/dev/ttyUSB0');

      expect(connectedSpy).toHaveBeenCalledTimes(1);
    });

    it('throws ConnectionError if port already open', async () => {
      await conn.open('/dev/ttyUSB0');
      await expect(conn.open('/dev/ttyUSB0')).rejects.toThrow('Port already open');
    });
  });

  // ─── close() ────────────────────────────────────────────────

  describe('close', () => {
    it('resolves immediately if port not open', async () => {
      await expect(conn.close()).resolves.toBeUndefined();
    });

    it('closes port and emits disconnected', async () => {
      const disconnectedSpy = vi.fn();
      conn.on('disconnected', disconnectedSpy);

      await conn.open('/dev/ttyUSB0');
      await conn.close();

      expect(conn.isOpen()).toBe(false);
      expect(disconnectedSpy).toHaveBeenCalled();
    });

    it('clears state on close', async () => {
      await conn.open('/dev/ttyUSB0');
      await conn.close();
      expect(conn.isOpen()).toBe(false);
      expect(conn.isInCLI()).toBe(false);
    });

    it('sends exit before closing if fcEnteredCLI is true', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      // Enter CLI to set fcEnteredCLI flag
      const enterPromise = conn.enterCLI();
      await new Promise((r) => setTimeout(r, 20));
      port.injectData('Entering CLI Mode\r\n# ');
      await enterPromise;

      port.clearWritten();
      await conn.close();

      const written = port.getAllWrittenBytes().toString();
      expect(written).toContain('exit');
    });

    it('does NOT send exit if fcEnteredCLI is false', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();
      port.clearWritten();

      await conn.close();

      const written = port.getAllWrittenBytes().toString();
      expect(written).not.toContain('exit');
    });
  });

  // ─── isOpen() / isInCLI() ──────────────────────────────────

  describe('state queries', () => {
    it('isOpen returns false before open', () => {
      expect(conn.isOpen()).toBe(false);
    });

    it('isOpen returns true after open', async () => {
      await conn.open('/dev/ttyUSB0');
      expect(conn.isOpen()).toBe(true);
    });

    it('isInCLI returns false initially', () => {
      expect(conn.isInCLI()).toBe(false);
    });
  });

  // ─── sendCommand() ─────────────────────────────────────────

  describe('sendCommand', () => {
    it('sends encoded MSP message and resolves with response', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const cmdPromise = conn.sendCommand(1); // MSP_API_VERSION

      await new Promise((r) => setTimeout(r, 20));
      port.injectData(buildMSPv1Response(1, [0, 1, 44]));

      const result = await cmdPromise;
      expect(result.command).toBe(1);
      expect(result.data[1]).toBe(1);
      expect(result.data[2]).toBe(44);
    });

    it('throws ConnectionError if port not open', async () => {
      await expect(conn.sendCommand(1)).rejects.toThrow('Port not open');
    });

    it('times out if no response received', async () => {
      await conn.open('/dev/ttyUSB0');
      await expect(conn.sendCommand(1, Buffer.alloc(0), 50)).rejects.toThrow('timed out');
    }, 1000);

    it('handles error response from FC', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const cmdPromise = conn.sendCommand(202);

      await new Promise((r) => setTimeout(r, 20));
      port.injectData(buildMSPv1ErrorResponse(202));

      const result = await cmdPromise;
      expect(result.error).toBe(true);
      expect(result.command).toBe(202);
    });

    it('handles partial response (data arrives in chunks)', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const cmdPromise = conn.sendCommand(1);

      const fullResponse = buildMSPv1Response(1, [0, 1, 44]);

      await new Promise((r) => setTimeout(r, 20));
      port.injectData(fullResponse.subarray(0, 4));
      await new Promise((r) => setTimeout(r, 20));
      port.injectData(fullResponse.subarray(4));

      const result = await cmdPromise;
      expect(result.command).toBe(1);
      expect(result.data.length).toBe(3);
    });

    it('handles multiple responses in single data event', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const cmd1 = conn.sendCommand(1);
      const cmd2 = conn.sendCommand(2);

      await new Promise((r) => setTimeout(r, 20));

      const resp1 = buildMSPv1Response(1, [0, 1, 44]);
      const resp2 = buildMSPv1Response(2, Buffer.from('BTFL'));
      port.injectData(Buffer.concat([resp1, resp2]));

      const [result1, result2] = await Promise.all([cmd1, cmd2]);
      expect(result1.command).toBe(1);
      expect(result2.command).toBe(2);
      expect(result2.data.toString()).toBe('BTFL');
    });

    it('emits unsolicited for responses with no pending request', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const unsolicitedSpy = vi.fn();
      conn.on('unsolicited', unsolicitedSpy);

      await new Promise((r) => setTimeout(r, 20));
      port.injectData(buildMSPv1Response(99, [0x42]));
      await new Promise((r) => setTimeout(r, 20));

      expect(unsolicitedSpy).toHaveBeenCalledTimes(1);
      expect(unsolicitedSpy.mock.calls[0][0].command).toBe(99);
    });

    it('writes encoded MSP bytes to serial port', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();
      port.clearWritten();

      const cmdPromise = conn.sendCommand(112);
      await new Promise((r) => setTimeout(r, 20));
      port.injectData(buildMSPv1Response(112, Buffer.alloc(30)));
      await cmdPromise;

      const written = port.getAllWrittenBytes();
      expect(written[0]).toBe(0x24); // '$'
      expect(written[1]).toBe(0x4d); // 'M'
      expect(written[2]).toBe(0x3c); // '<' direction to FC
      expect(written[4]).toBe(112); // command
    });
  });

  // ─── sendCommandNoResponse() ───────────────────────────────

  describe('sendCommandNoResponse', () => {
    it('sends encoded MSP message without waiting for response', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();
      port.clearWritten();

      await conn.sendCommandNoResponse(68, Buffer.from([2])); // MSP_REBOOT, type=MSC

      const written = port.getAllWrittenBytes();
      expect(written[0]).toBe(0x24); // '$'
      expect(written[1]).toBe(0x4d); // 'M'
      expect(written[2]).toBe(0x3c); // '<'
      expect(written[4]).toBe(68); // command
    });

    it('throws if port not open', async () => {
      await expect(conn.sendCommandNoResponse(68)).rejects.toThrow('Port not open');
    });
  });

  // ─── enterCLI() ─────────────────────────────────────────────

  describe('enterCLI', () => {
    it('sets cliMode flag on CLI prompt', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const enterPromise = conn.enterCLI();
      await new Promise((r) => setTimeout(r, 20));
      port.injectData('CLI mode\r\n# ');
      await enterPromise;

      expect(conn.isInCLI()).toBe(true);
    });

    it('throws if port not open', async () => {
      await expect(conn.enterCLI()).rejects.toThrow('Port not open');
    });

    it('writes # to serial port', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();
      port.clearWritten();

      const enterPromise = conn.enterCLI();
      await new Promise((r) => setTimeout(r, 20));
      port.injectData('# ');
      await enterPromise;

      const written = port.getAllWrittenBytes().toString();
      expect(written).toContain('#');
    });

    it('accumulates data into cliBuffer across chunks', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const enterPromise = conn.enterCLI();
      await new Promise((r) => setTimeout(r, 20));
      // Data arrives in two chunks — prompt split across them
      port.injectData('Entering CLI Mode\r\n');
      await new Promise((r) => setTimeout(r, 10));
      port.injectData('# ');
      await enterPromise;

      expect(conn.isInCLI()).toBe(true);
    });

    it('does NOT resolve on bare # without trailing space', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const enterPromise = conn.enterCLI();
      await new Promise((r) => setTimeout(r, 20));
      // Inject hash without trailing space — should NOT resolve
      port.injectData('Entering CLI\r\n#');
      await new Promise((r) => setTimeout(r, 50));

      // Should still be pending — verify by injecting proper prompt
      port.injectData(' ');
      await enterPromise;

      expect(conn.isInCLI()).toBe(true);
    });

    it('handles trailing \\r after CLI prompt', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const enterPromise = conn.enterCLI();
      await new Promise((r) => setTimeout(r, 20));
      // FC sends prompt with trailing CR (some FC firmware behavior)
      port.injectData('Entering CLI Mode\r\n# \r');
      await enterPromise;

      expect(conn.isInCLI()).toBe(true);
    });
  });

  // ─── sendCLICommand() ───────────────────────────────────────

  describe('sendCLICommand', () => {
    async function enterCLIMode(): Promise<any> {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const enterPromise = conn.enterCLI();
      await new Promise((r) => setTimeout(r, 20));
      port.injectData('Entering CLI\r\n# ');
      await enterPromise;

      port.clearWritten();
      return port;
    }

    it('sends command and waits for \\n# prompt with debounce', async () => {
      const port = await enterCLIMode();

      const cmdPromise = conn.sendCLICommand('set debug_mode = GYRO_SCALED');

      await new Promise((r) => setTimeout(r, 20));
      port.injectData('set debug_mode = GYRO_SCALED\r\n# ');
      // Wait for 100ms debounce to fire
      await new Promise((r) => setTimeout(r, 150));

      const result = await cmdPromise;
      expect(result).toContain('debug_mode');
    });

    it('does NOT false-match # in diff output comment lines', async () => {
      const port = await enterCLIMode();

      const cmdPromise = conn.sendCLICommand('diff all', 2000);

      await new Promise((r) => setTimeout(r, 20));
      // Comment lines with # that should NOT trigger prompt detection
      port.injectData('# master\r\nset debug_mode = GYRO_SCALED\r\n');
      await new Promise((r) => setTimeout(r, 20));
      port.injectData('# profile 0\r\nset p_roll = 45\r\n');
      await new Promise((r) => setTimeout(r, 20));
      // Actual CLI prompt — buffer ends with \n# (with space)
      port.injectData('\n# ');
      // Wait for debounce
      await new Promise((r) => setTimeout(r, 150));

      const result = await cmdPromise;
      expect(result).toContain('debug_mode');
      expect(result).toContain('p_roll');
    });

    it('accumulates multi-line response', async () => {
      const port = await enterCLIMode();

      const cmdPromise = conn.sendCLICommand('diff all', 2000);

      await new Promise((r) => setTimeout(r, 20));
      port.injectData('set a = 1\r\n');
      await new Promise((r) => setTimeout(r, 10));
      port.injectData('set b = 2\r\n');
      await new Promise((r) => setTimeout(r, 10));
      port.injectData('set c = 3\r\n# ');
      // Wait for debounce
      await new Promise((r) => setTimeout(r, 150));

      const result = await cmdPromise;
      expect(result).toContain('set a = 1');
      expect(result).toContain('set b = 2');
      expect(result).toContain('set c = 3');
    });

    it('does NOT resolve early when chunk boundary splits "# master" header', async () => {
      const port = await enterCLIMode();

      const cmdPromise = conn.sendCLICommand('diff all', 2000);

      await new Promise((r) => setTimeout(r, 20));
      port.injectData('set gyro_lpf1 = 200\r\n');
      await new Promise((r) => setTimeout(r, 10));
      // Chunk boundary: "# " arrives alone (looks like prompt)
      port.injectData('# ');
      await new Promise((r) => setTimeout(r, 30));
      // But before debounce fires (100ms), rest of header arrives
      port.injectData('master\r\nset dterm_lpf1 = 150\r\n');
      await new Promise((r) => setTimeout(r, 10));
      // More data
      port.injectData('# profile 0\r\nset p_roll = 45\r\n');
      await new Promise((r) => setTimeout(r, 10));
      // Real prompt
      port.injectData('\n# ');
      // Wait for debounce
      await new Promise((r) => setTimeout(r, 150));

      const result = await cmdPromise;
      // Must contain ALL data — not truncated at "# master"
      expect(result).toContain('gyro_lpf1');
      expect(result).toContain('dterm_lpf1');
      expect(result).toContain('p_roll');
    });

    it('debounce resets when more data arrives before 100ms', async () => {
      const port = await enterCLIMode();

      let resolved = false;
      const cmdPromise = conn.sendCLICommand('diff all', 2000).then((result) => {
        resolved = true;
        return result;
      });

      await new Promise((r) => setTimeout(r, 20));
      // First "# " — starts debounce timer
      port.injectData('set a = 1\r\n# ');
      await new Promise((r) => setTimeout(r, 50));
      // Not yet resolved (debounce is 100ms)
      expect(resolved).toBe(false);
      // More data arrives — cancels debounce, no longer matches prompt
      port.injectData('profile 0\r\nset b = 2\r\n');
      await new Promise((r) => setTimeout(r, 150));
      // Still not resolved — buffer no longer ends with "# "
      expect(resolved).toBe(false);
      // Real prompt
      port.injectData('\n# ');
      await new Promise((r) => setTimeout(r, 150));

      const result = await cmdPromise;
      expect(result).toContain('set a = 1');
      expect(result).toContain('set b = 2');
    });

    it('throws ConnectionError if not in CLI mode', async () => {
      await conn.open('/dev/ttyUSB0');
      await expect(conn.sendCLICommand('diff all')).rejects.toThrow('Not in CLI mode');
    });

    it('times out if prompt never received', async () => {
      await enterCLIMode();
      await expect(conn.sendCLICommand('set something = 1', 50)).rejects.toThrow(
        'CLI command timed out'
      );
    }, 1000);

    it('cleans up debounce timer on timeout', async () => {
      const port = await enterCLIMode();

      // Start a command that will time out with a pending debounce
      const cmdPromise = conn.sendCLICommand('diff all', 200);
      await new Promise((r) => setTimeout(r, 20));
      // Inject potential prompt to start debounce
      port.injectData('partial\r\n# ');
      // Inject more data before debounce fires to cancel it
      await new Promise((r) => setTimeout(r, 30));
      port.injectData('master\r\n');
      // Let it time out — no real prompt ever arrives
      await expect(cmdPromise).rejects.toThrow('CLI command timed out');
    }, 1000);

    it('handles trailing \\r after prompt in sendCLICommand', async () => {
      const port = await enterCLIMode();

      const cmdPromise = conn.sendCLICommand('set debug_mode = GYRO_SCALED');

      await new Promise((r) => setTimeout(r, 20));
      // FC sends prompt with trailing CR
      port.injectData('set debug_mode = GYRO_SCALED\r\n# \r');
      // Wait for debounce
      await new Promise((r) => setTimeout(r, 150));

      const result = await cmdPromise;
      expect(result).toContain('debug_mode');
    });
  });

  // ─── exitCLI() / forceExitCLI() ────────────────────────────

  describe('exitCLI', () => {
    it('resets cliMode flag only (no command sent)', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const enterPromise = conn.enterCLI();
      await new Promise((r) => setTimeout(r, 20));
      port.injectData('# ');
      await enterPromise;

      expect(conn.isInCLI()).toBe(true);
      port.clearWritten();

      await conn.exitCLI();

      expect(conn.isInCLI()).toBe(false);
      expect(port.writtenData.length).toBe(0);
    });

    it('is safe to call when not in CLI mode', async () => {
      await expect(conn.exitCLI()).resolves.toBeUndefined();
    });
  });

  describe('forceExitCLI', () => {
    it('resets cliMode flag without sending commands', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const enterPromise = conn.enterCLI();
      await new Promise((r) => setTimeout(r, 20));
      port.injectData('# ');
      await enterPromise;

      port.clearWritten();
      await conn.forceExitCLI();

      expect(conn.isInCLI()).toBe(false);
      expect(port.writtenData.length).toBe(0);
    });
  });

  describe('clearFCRebootedFromCLI', () => {
    it('clears fcEnteredCLI flag so close() does not send exit', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const enterPromise = conn.enterCLI();
      await new Promise((r) => setTimeout(r, 20));
      port.injectData('# ');
      await enterPromise;

      conn.clearFCRebootedFromCLI();

      port.clearWritten();
      await conn.close();

      const written = port.getAllWrittenBytes().toString();
      expect(written).not.toContain('exit');
    });

    it('also resets cliMode and cliBuffer', () => {
      // Direct state test
      (conn as any).cliMode = true;
      (conn as any).fcEnteredCLI = true;
      (conn as any).cliBuffer = 'some data';

      conn.clearFCRebootedFromCLI();

      expect(conn.isInCLI()).toBe(false);
      expect((conn as any).cliBuffer).toBe('');
    });
  });

  // ─── writeCLIRaw() ─────────────────────────────────────────

  describe('writeCLIRaw', () => {
    it('writes command without waiting for prompt', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const enterPromise = conn.enterCLI();
      await new Promise((r) => setTimeout(r, 20));
      port.injectData('# ');
      await enterPromise;

      port.clearWritten();
      await conn.writeCLIRaw('save');

      const written = port.getAllWrittenBytes().toString();
      expect(written).toBe('save\r\n');
    });

    it('throws if not in CLI mode', async () => {
      await conn.open('/dev/ttyUSB0');
      await expect(conn.writeCLIRaw('save')).rejects.toThrow('Not in CLI mode');
    });
  });

  // ─── Event forwarding ──────────────────────────────────────

  describe('event forwarding', () => {
    it('emits error on port error', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const errorSpy = vi.fn();
      conn.on('error', errorSpy);

      port.injectError(new Error('Port failure'));

      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('emits disconnected on port close', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const disconnectedSpy = vi.fn();
      conn.on('disconnected', disconnectedSpy);

      port.injectClose();

      expect(disconnectedSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Data routing (MSP vs CLI mode) ────────────────────────

  describe('data routing', () => {
    it('routes to MSP handler when not in CLI mode', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const cmdPromise = conn.sendCommand(1);
      await new Promise((r) => setTimeout(r, 20));
      port.injectData(buildMSPv1Response(1, [0, 1, 44]));
      const result = await cmdPromise;

      expect(result.command).toBe(1);
    });

    it('routes to CLI handler when in CLI mode', async () => {
      await conn.open('/dev/ttyUSB0');
      const port = getPort();

      const cliDataSpy = vi.fn();
      conn.on('cli-data', cliDataSpy);

      const enterPromise = conn.enterCLI();
      await new Promise((r) => setTimeout(r, 20));
      port.injectData('# ');
      await enterPromise;

      cliDataSpy.mockClear();

      port.injectData('set motor_pwm_rate = 8000\r\n');
      await new Promise((r) => setTimeout(r, 10));

      expect(cliDataSpy).toHaveBeenCalled();
      expect(cliDataSpy.mock.calls[0][0]).toContain('motor_pwm_rate');
    });
  });
});
