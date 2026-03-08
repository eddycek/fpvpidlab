/**
 * Mock MSP client for offline UX testing (demo mode).
 *
 * Simulates a connected flight controller with realistic responses.
 * Activated via DEMO_MODE=true env var (dev) or --demo CLI flag (production).
 */

import { EventEmitter } from 'events';
import type { PortInfo, FCInfo, ConnectionStatus } from '@shared/types/common.types';
import type { PIDConfiguration, FeedforwardConfiguration } from '@shared/types/pid.types';
import type { CurrentFilterSettings } from '@shared/types/analysis.types';
import type { BlackboxInfo } from '@shared/types/blackbox.types';
import {
  generateFilterDemoBBL,
  generatePIDDemoBBL,
  generateQuickDemoBBL,
  generateVerificationDemoBBL,
} from './DemoDataGenerator';
import { logger } from '../utils/logger';

/** Demo FC serial number — used for profile matching */
export const DEMO_FC_SERIAL = 'DEMO-0001-0002-0003';

/** Realistic CLI diff for a 5" freestyle quad (BF 4.5 defaults + common tweaks) */
export const DEMO_CLI_DIFF = `# diff all

# master
set gyro_lpf1_static_hz = 250
set gyro_lpf2_static_hz = 500
set dterm_lpf1_static_hz = 150
set dterm_lpf2_static_hz = 150
set dyn_notch_count = 3
set dyn_notch_q = 300
set dyn_notch_min_hz = 100
set dyn_notch_max_hz = 600
set motor_pwm_protocol = DSHOT600
set motor_poles = 14
set pid_process_denom = 2
set blackbox_sample_rate = 1
set debug_mode = GYRO_SCALED
set feedforward_transition = 0
set feedforward_boost = 15
set feedforward_smooth_factor = 37
set feedforward_jitter_factor = 7
set feedforward_max_rate_limit = 100

# profile 0
set p_pitch = 52
set i_pitch = 92
set d_pitch = 48
set f_pitch = 130
set p_roll = 50
set i_roll = 88
set d_roll = 45
set f_roll = 120
set p_yaw = 45
set i_yaw = 90
set d_yaw = 0
set f_yaw = 80
`;

/** Demo FC info matching BF 4.5.1 on STM32F405 — exported for test assertions */
export const DEMO_FC_INFO: FCInfo = {
  variant: 'BTFL',
  version: '4.5.1',
  target: 'STM32F405',
  boardName: 'OMNIBUSF4SD',
  apiVersion: { protocol: 0, major: 1, minor: 46 },
};

/** Standard 5" freestyle PID values */
const DEMO_PID_CONFIG: PIDConfiguration = {
  roll: { P: 50, I: 88, D: 45 },
  pitch: { P: 52, I: 92, D: 48 },
  yaw: { P: 45, I: 90, D: 0 },
};

/** BF 4.5 default filter settings */
const DEMO_FILTER_CONFIG: CurrentFilterSettings = {
  gyro_lpf1_static_hz: 250,
  gyro_lpf2_static_hz: 500,
  dterm_lpf1_static_hz: 150,
  dterm_lpf2_static_hz: 150,
  dyn_notch_min_hz: 100,
  dyn_notch_max_hz: 600,
  rpm_filter_harmonics: 3,
  rpm_filter_min_hz: 100,
  dyn_notch_count: 3,
  dyn_notch_q: 300,
};

/** Demo feedforward config */
const DEMO_FF_CONFIG: FeedforwardConfiguration = {
  transition: 0,
  rollGain: 120,
  pitchGain: 130,
  yawGain: 80,
  boost: 15,
  smoothFactor: 37,
  jitterFactor: 7,
  maxRateLimit: 100,
};

/**
 * Mock MSPConnection that simulates CLI mode operations.
 */
class MockMSPConnection extends EventEmitter {
  private _cliMode = false;
  /** Tracks `set key = value` CLI commands for dynamic diff generation */
  readonly appliedSettings = new Map<string, string>();

  isInCLI(): boolean {
    return this._cliMode;
  }

  async enterCLI(): Promise<void> {
    this._cliMode = true;
    logger.info('[DEMO] Entered CLI mode');
  }

  async sendCLICommand(cmd: string): Promise<string> {
    logger.info(`[DEMO] CLI command: ${cmd}`);
    // Parse "set key = value" and track the change
    const match = cmd.match(/^set\s+(\S+)\s*=\s*(.+)$/);
    if (match) {
      this.appliedSettings.set(match[1], match[2].trim());
    }
    return `${cmd}\n# `;
  }

  exitCLI(): void {
    this._cliMode = false;
    logger.info('[DEMO] Exited CLI mode');
  }

  forceExitCLI(): void {
    this._cliMode = false;
  }

  async close(): Promise<void> {
    this._cliMode = false;
    this.emit('disconnected');
  }
}

/**
 * Mock MSP client for demo mode.
 *
 * Implements the same public interface as the real MSPClient
 * but returns static/simulated data without any serial communication.
 */
export class MockMSPClient extends EventEmitter {
  public connection: MockMSPConnection;
  private _connected = false;
  private _mscModeActive = false;
  private _rebootPending = false;
  private _lastStorageType: 'flash' | 'sdcard' | 'none' = 'flash';
  /** Simulated flash state: true = has data after "flight" */
  private _flashHasData = false;
  /** Pre-generated demo BBL data (set by DemoDataGenerator) */
  private _demoBBLData: Buffer | null = null;
  /** Which BBL type the next auto-flight will generate (exposed for testing) */
  _nextFlightType: 'filter' | 'pid' | 'quick' | 'verification' = 'filter';
  /** Last session type — determines what `advancePastVerification` resets to */
  _lastSessionType: 'guided' | 'quick' = 'guided';
  /** Current tuning cycle (0-based). Increments each time a new session starts.
   *  Used for progressive noise reduction in demo data generation. */
  _tuningCycle = 0;
  /** Timer handle for auto-flight scheduling (for cleanup) */
  private _autoFlightTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.connection = new MockMSPConnection();
    logger.info('[DEMO] MockMSPClient created — demo mode active');
  }

  // ── Public state accessors ──────────────────────────────────────────

  get mscModeActive(): boolean {
    return this._mscModeActive;
  }

  get rebootPending(): boolean {
    return this._rebootPending;
  }

  get lastStorageType(): 'flash' | 'sdcard' | 'none' {
    return this._lastStorageType;
  }

  isConnected(): boolean {
    return this._connected;
  }

  getConnectionStatus(): ConnectionStatus {
    return {
      connected: this._connected,
      portPath: this._connected ? '/dev/demo' : undefined,
      fcInfo: this._connected ? DEMO_FC_INFO : undefined,
    };
  }

  // ── Demo-specific methods ───────────────────────────────────────────

  /** Set demo BBL data to be returned by downloadBlackboxLog */
  setDemoBBLData(data: Buffer): void {
    this._demoBBLData = data;
  }

  /** Simulate flash having data (e.g. after a "flight") */
  setFlashHasData(hasData: boolean): void {
    this._flashHasData = hasData;
  }

  /**
   * Simulate connection — triggers the same 'connected' event
   * that src/main/index.ts listens to for profile auto-detection.
   */
  async simulateConnect(): Promise<void> {
    logger.info('[DEMO] Simulating FC connection...');
    this._connected = true;

    // Small delay to let the window initialize
    await new Promise((r) => setTimeout(r, 500));

    this.emit('connected');
    this.emit('connection-changed', {
      connected: true,
      portPath: '/dev/demo',
      fcInfo: DEMO_FC_INFO,
    });
    logger.info('[DEMO] FC connected');
  }

  /**
   * Reset all demo state to initial values — used by "Reset Demo" button.
   * Allows the user to restart the 5-cycle tuning progression from scratch.
   */
  resetDemoState(): void {
    this.cancelAutoFlight();
    this._tuningCycle = 0;
    this._nextFlightType = 'filter';
    this._lastSessionType = 'guided';
    this.connection.appliedSettings.clear();
    this._flashHasData = false;
    this._demoBBLData = null;
    logger.info('[DEMO] Demo state reset — starting from cycle 0');
  }

  /**
   * Advance past a skipped verification flight.
   * Called when user clicks "Skip & Complete" instead of doing the verification flight.
   * Ensures the flight type cycle stays in sync for the next tuning session.
   */
  advancePastVerification(): void {
    if (this._nextFlightType === 'verification') {
      this._tuningCycle++;
      this._nextFlightType = this._lastSessionType === 'quick' ? 'quick' : 'filter';
      logger.info(
        `[DEMO] Skipped verification — advanced to cycle ${this._tuningCycle}, next flight: ${this._nextFlightType}`
      );
    }
  }

  /**
   * Set the next flight type for quick tune sessions.
   * Called when a quick tuning session is started.
   */
  setQuickTuneMode(): void {
    this._nextFlightType = 'quick';
    this._lastSessionType = 'quick';
    logger.info('[DEMO] Quick tune mode set — next flight: quick');
  }

  // ── MSPClient interface implementation ──────────────────────────────

  async listPorts(): Promise<PortInfo[]> {
    return [
      {
        path: '/dev/demo',
        manufacturer: 'Demo FC (offline mode)',
        vendorId: '0x0483',
        productId: '0x5740',
      },
    ];
  }

  async connect(_portPath: string): Promise<void> {
    await this.simulateConnect();
  }

  async disconnect(): Promise<void> {
    const shouldAutoReconnect = this._rebootPending;
    logger.info(
      `[DEMO] Disconnecting...${shouldAutoReconnect ? ' (reboot pending — will auto-reconnect)' : ''}`
    );
    this.cancelAutoFlight();
    this._connected = false;
    this.emit('disconnected');
    this.emit('connection-changed', { connected: false });

    if (shouldAutoReconnect) {
      setTimeout(() => {
        logger.info('[DEMO] Auto-reconnecting after reboot...');
        this._connected = true;
        this.emit('connected');
        this.emit('connection-changed', {
          connected: true,
          portPath: '/dev/demo',
          fcInfo: DEMO_FC_INFO,
        });
      }, 1500);
    }
  }

  async reconnect(): Promise<void> {
    await this.disconnect();
    await new Promise((r) => setTimeout(r, 500));
    await this.simulateConnect();
  }

  async getFCInfo(): Promise<FCInfo> {
    return { ...DEMO_FC_INFO };
  }

  async getFCSerialNumber(): Promise<string> {
    return DEMO_FC_SERIAL;
  }

  async getUID(): Promise<string> {
    return DEMO_FC_SERIAL;
  }

  async getBlackboxInfo(): Promise<BlackboxInfo> {
    const totalSize = 16 * 1024 * 1024; // 16 MB flash
    const usedSize = this._flashHasData ? 2 * 1024 * 1024 : 0; // 2 MB when has data
    return {
      supported: true,
      storageType: 'flash',
      totalSize,
      usedSize,
      hasLogs: this._flashHasData,
      freeSize: totalSize - usedSize,
      usagePercent: Math.round((usedSize / totalSize) * 100),
    };
  }

  async getFilterConfiguration(): Promise<CurrentFilterSettings> {
    return { ...DEMO_FILTER_CONFIG };
  }

  async getPIDConfiguration(): Promise<PIDConfiguration> {
    return JSON.parse(JSON.stringify(DEMO_PID_CONFIG));
  }

  async setPIDConfiguration(config: PIDConfiguration): Promise<void> {
    logger.info('[DEMO] PID config set:', JSON.stringify(config));
    // Track PID changes as CLI settings for diff generation
    const pidMap: Record<string, { P: string; I: string; D: string; F: string }> = {
      roll: { P: 'p_roll', I: 'i_roll', D: 'd_roll', F: 'f_roll' },
      pitch: { P: 'p_pitch', I: 'i_pitch', D: 'd_pitch', F: 'f_pitch' },
      yaw: { P: 'p_yaw', I: 'i_yaw', D: 'd_yaw', F: 'f_yaw' },
    };
    for (const axis of ['roll', 'pitch', 'yaw'] as const) {
      const vals = config[axis];
      this.connection.appliedSettings.set(pidMap[axis].P, String(vals.P));
      this.connection.appliedSettings.set(pidMap[axis].I, String(vals.I));
      this.connection.appliedSettings.set(pidMap[axis].D, String(vals.D));
    }
  }

  async getFeedforwardConfiguration(): Promise<FeedforwardConfiguration> {
    return { ...DEMO_FF_CONFIG };
  }

  async getPidProcessDenom(): Promise<number> {
    return 2; // 4kHz PID loop (8kHz gyro / 2)
  }

  async exportCLIDiff(): Promise<string> {
    // Simulate CLI enter/exit like the real client
    if (!this.connection.isInCLI()) {
      await this.connection.enterCLI();
    }
    return this.buildCurrentDiff();
  }

  async exportCLIDump(): Promise<string> {
    return this.buildCurrentDiff();
  }

  /**
   * Build CLI diff reflecting any applied tuning changes.
   * Starts from the base DEMO_CLI_DIFF and overlays appliedSettings.
   */
  private buildCurrentDiff(): string {
    if (this.connection.appliedSettings.size === 0) {
      return DEMO_CLI_DIFF;
    }

    // Parse base diff into key-value map preserving order
    const lines = DEMO_CLI_DIFF.split('\n');
    const settingsMap = new Map<string, string>();
    const orderedKeys: string[] = [];
    const headerLines: string[] = [];

    for (const line of lines) {
      const match = line.match(/^set\s+(\S+)\s*=\s*(.+)$/);
      if (match) {
        settingsMap.set(match[1], match[2].trim());
        orderedKeys.push(match[1]);
      } else if (line.trim()) {
        headerLines.push(line);
      }
    }

    // Overlay applied changes
    for (const [key, value] of this.connection.appliedSettings) {
      if (!settingsMap.has(key)) {
        orderedKeys.push(key);
      }
      settingsMap.set(key, value);
    }

    // Rebuild diff — split master and profile sections
    const masterKeys = orderedKeys.filter((k) => !k.match(/^[pidf]_(roll|pitch|yaw)$/));
    const profileKeys = orderedKeys.filter((k) => k.match(/^[pidf]_(roll|pitch|yaw)$/));

    const result: string[] = ['# diff all', '', '# master'];
    for (const key of masterKeys) {
      result.push(`set ${key} = ${settingsMap.get(key)}`);
    }
    if (profileKeys.length > 0) {
      result.push('', '# profile 0');
      for (const key of profileKeys) {
        result.push(`set ${key} = ${settingsMap.get(key)}`);
      }
    }
    result.push('');

    return result.join('\n');
  }

  async downloadBlackboxLog(onProgress?: (progress: number) => void): Promise<Buffer> {
    if (!this._demoBBLData) {
      throw new Error('[DEMO] No demo BBL data available. Run DemoDataGenerator first.');
    }

    // Simulate download progress
    const totalChunks = 20;
    for (let i = 0; i <= totalChunks; i++) {
      const progress = Math.round((i / totalChunks) * 100);
      onProgress?.(progress);
      await new Promise((r) => setTimeout(r, 50));
    }

    return this._demoBBLData;
  }

  async eraseBlackboxFlash(): Promise<void> {
    logger.info('[DEMO] Flash erased (simulated)');
    this._flashHasData = false;
    this.cancelAutoFlight();

    // Simulate erase delay
    await new Promise((r) => setTimeout(r, 500));

    // Schedule simulated flight after 3s
    this._autoFlightTimer = setTimeout(() => {
      const c = this._tuningCycle;
      logger.info(`[DEMO] Auto-flight complete (${this._nextFlightType} cycle ${c})`);
      this._flashHasData = true;

      const generators: Record<typeof this._nextFlightType, (cycle: number) => Buffer> = {
        filter: generateFilterDemoBBL,
        pid: generatePIDDemoBBL,
        quick: generateQuickDemoBBL,
        verification: generateVerificationDemoBBL,
      };
      this._demoBBLData = generators[this._nextFlightType](c);

      const nextType: Record<string, typeof this._nextFlightType> = {
        filter: 'pid',
        pid: 'verification',
        quick: 'verification',
        verification: this._lastSessionType === 'quick' ? 'quick' : 'filter',
      };
      // After verification completes a full cycle — increment for next round
      if (this._nextFlightType === 'verification') {
        this._tuningCycle++;
      }
      this._nextFlightType = nextType[this._nextFlightType];

      this.simulateFlightAndReconnect();
    }, 3000);
  }

  async saveAndReboot(): Promise<void> {
    logger.info('[DEMO] Save & reboot (simulated)');
    this._rebootPending = true;

    // Simulate disconnect → delay → reconnect
    this._connected = false;
    this.emit('disconnected');
    this.emit('connection-changed', { connected: false });

    await new Promise((r) => setTimeout(r, 2000));

    // Reconnect — rebootPending stays true so connected handler in index.ts
    // knows this is a reboot (clears it after processing)
    this._connected = true;
    this.emit('connected');
    this.emit('connection-changed', {
      connected: true,
      portPath: '/dev/demo',
      fcInfo: DEMO_FC_INFO,
    });
    logger.info('[DEMO] FC rebooted and reconnected');
  }

  async testBlackboxRead(): Promise<{ success: boolean; message: string; data?: string }> {
    return {
      success: true,
      message: 'Demo mode — blackbox read test simulated',
      data: 'DEMO_DATA',
    };
  }

  async rebootToMSC(): Promise<boolean> {
    logger.info('[DEMO] MSC mode not supported in demo');
    return false;
  }

  // ── Auto-flight simulation ─────────────────────────────────────────

  /**
   * Simulate a completed flight: disconnect → delay → reconnect with flash data.
   * Smart reconnect in index.ts will detect flash data and advance the tuning phase.
   */
  private simulateFlightAndReconnect(): void {
    this._rebootPending = true; // Prevent profile clear on disconnect
    this._connected = false;
    this.emit('disconnected');
    this.emit('connection-changed', { connected: false });
    logger.info('[DEMO] Simulated flight disconnect — reconnecting in 1.5s...');

    setTimeout(() => {
      this._connected = true;
      this.emit('connected');
      this.emit('connection-changed', {
        connected: true,
        portPath: '/dev/demo',
        fcInfo: DEMO_FC_INFO,
      });
      logger.info('[DEMO] Reconnected with flight data on flash');
    }, 1500);
  }

  /** Cancel any pending auto-flight timer (cleanup on disconnect) */
  cancelAutoFlight(): void {
    if (this._autoFlightTimer) {
      clearTimeout(this._autoFlightTimer);
      this._autoFlightTimer = null;
      logger.info('[DEMO] Auto-flight timer cancelled');
    }
  }

  // ── State management (same as real MSPClient) ──────────────────────

  clearMSCMode(): void {
    this._mscModeActive = false;
  }

  setRebootPending(): void {
    this._rebootPending = true;
  }

  clearRebootPending(): void {
    this._rebootPending = false;
  }

  /**
   * Validate firmware version — always passes in demo mode.
   */
  async validateFirmwareVersion(): Promise<void> {
    // Demo FC is always compatible
  }
}
