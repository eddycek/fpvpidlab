/**
 * Mock MSP client for offline UX testing (demo mode).
 *
 * Simulates a connected flight controller with realistic responses.
 * Activated via DEMO_MODE=true env var (dev) or --demo CLI flag (production).
 */

import { EventEmitter } from 'events';
import type { PortInfo, FCInfo, ConnectionStatus } from '@shared/types/common.types';
import type {
  PIDConfiguration,
  FeedforwardConfiguration,
  RatesConfiguration,
} from '@shared/types/pid.types';
import type { CurrentFilterSettings } from '@shared/types/analysis.types';
import type { BlackboxInfo } from '@shared/types/blackbox.types';
import {
  generateFilterDemoBBL,
  generatePIDDemoBBL,
  generateFlashDemoBBL,
  generateVerificationDemoBBL,
  generateFlashVerificationDemoBBL,
  generatePoorQualityBBL,
  generateMechanicalIssueBBL,
  generateWindyFlightBBL,
} from './DemoDataGenerator';
import { TUNING_TYPE } from '@shared/constants';
import type { TuningType } from '@shared/types/tuning.types';
import { logger } from '../utils/logger';

/** BBL generator function signature */
type BBLGenerator = (cycle: number) => Buffer;

/** Demo flight phase — which BBL type the next auto-flight generates */
export const DEMO_FLIGHT = {
  FILTER: 'filter',
  PID: 'pid',
  FLASH: 'flash',
  VERIFICATION: 'verification',
} as const;
type DemoFlightPhase = (typeof DEMO_FLIGHT)[keyof typeof DEMO_FLIGHT];

/**
 * Stress-test scenario — overrides the default progressive generator
 * for one specific flight type in the auto-flight sequence.
 */
export interface StressScenario {
  /** Which flight phase to override */
  flightType: DemoFlightPhase;
  /** Custom BBL generator to use instead of the default */
  generator: BBLGenerator;
}

/** Pre-built stress scenarios for common edge cases */
export const STRESS_SCENARIOS = {
  poorQuality: { flightType: DEMO_FLIGHT.FILTER, generator: generatePoorQualityBBL },
  mechanical: { flightType: DEMO_FLIGHT.FILTER, generator: generateMechanicalIssueBBL },
  windy: { flightType: DEMO_FLIGHT.FILTER, generator: generateWindyFlightBBL },
} satisfies Record<string, StressScenario>;

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

profile 0

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

rateprofile 0

# rateprofile 0
`;

/** Demo FC info matching BF 4.5.1 on STM32F405 — exported for test assertions */
export const DEMO_FC_INFO: FCInfo = {
  variant: 'BTFL',
  version: '4.5.1',
  target: 'STM32F405',
  boardName: 'OMNIBUSF4SD',
  craftName: 'Demo Quad',
  apiVersion: { protocol: 0, major: 1, minor: 46 },
  pidProfileIndex: 0,
  pidProfileCount: 4,
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
  /** Current BF PID profile index (0-based) */
  private _pidProfileIndex = 0;
  /** Number of available BF PID profiles */
  private _pidProfileCount = 4;
  /** Simulated flash state: true = has data after "flight" */
  private _flashHasData = false;
  /** Pre-generated demo BBL data (set by DemoDataGenerator) */
  private _demoBBLData: Buffer | null = null;
  /** Which BBL type the next auto-flight will generate (exposed for testing) */
  _nextFlightType: DemoFlightPhase = DEMO_FLIGHT.FILTER;
  /** Last tuning session type — determines what `advancePastVerification` resets to */
  _lastSessionType: TuningType = TUNING_TYPE.FILTER;
  /** Current tuning cycle (0-based). Increments each time a new session starts.
   *  Used for progressive noise reduction in demo data generation. */
  _tuningCycle = 0;
  /** Timer handle for auto-flight scheduling (for cleanup) */
  private _autoFlightTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Per-cycle stress scenario overrides.
   * Key = cycle number, value = generator to use instead of the default.
   * Only applies to the matching flight phase.
   */
  private _stressSchedule = new Map<number, StressScenario>();

  constructor() {
    super();
    this.connection = new MockMSPConnection();
    logger.info('[DEMO] MockMSPClient created — demo mode active');

    // Auto-configure stress schedule when DEMO_STRESS env var is set
    if (process.env.DEMO_STRESS === 'true') {
      this.setStressSchedule([
        [0, STRESS_SCENARIOS.poorQuality],
        [1, STRESS_SCENARIOS.windy],
        [2, STRESS_SCENARIOS.mechanical],
        // Cycles 3-4: normal progressive (no override) — shows recovery
      ]);
      logger.info('[DEMO] Stress mode enabled via env var');
    }
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
    this._nextFlightType = DEMO_FLIGHT.FILTER;
    this._lastSessionType = TUNING_TYPE.FILTER;
    this.connection.appliedSettings.clear();
    this._flashHasData = false;
    this._demoBBLData = null;
    this._pidProfileIndex = 0;
    this._stressSchedule.clear();
    logger.info('[DEMO] Demo state reset — starting from cycle 0');
  }

  /**
   * Advance past a skipped verification flight.
   * Called internally when verification is skipped programmatically.
   * Ensures the flight type cycle stays in sync for the next tuning session.
   */
  advancePastVerification(): void {
    if (this._nextFlightType === DEMO_FLIGHT.VERIFICATION) {
      this._tuningCycle++;
      if (this._lastSessionType === TUNING_TYPE.FLASH) {
        this._nextFlightType = DEMO_FLIGHT.FLASH;
      } else if (this._lastSessionType === TUNING_TYPE.PID) {
        this._nextFlightType = DEMO_FLIGHT.PID;
      } else {
        this._nextFlightType = DEMO_FLIGHT.FILTER;
      }
      logger.info(
        `[DEMO] Skipped verification — advanced to cycle ${this._tuningCycle}, next flight: ${this._nextFlightType}`
      );
    }
  }

  /**
   * Set the next flight type for Flash Tune sessions.
   * Called when a Flash Tune (quick) tuning session is started.
   */
  setFlashTuneMode(): void {
    this._nextFlightType = DEMO_FLIGHT.FLASH;
    this._lastSessionType = TUNING_TYPE.FLASH;
    logger.info('[DEMO] Flash Tune mode set — next flight: flash');
  }

  /**
   * Set the next flight type for Filter Tune sessions.
   * Ensures correct flight cycling after a previous Flash Tune session.
   */
  setFilterTuneMode(): void {
    this._nextFlightType = DEMO_FLIGHT.FILTER;
    this._lastSessionType = TUNING_TYPE.FILTER;
    logger.info('[DEMO] Filter Tune mode set — next flight: filter');
  }

  /**
   * Set the next flight type for PID Tune sessions.
   */
  setPIDTuneMode(): void {
    this._nextFlightType = DEMO_FLIGHT.PID;
    this._lastSessionType = TUNING_TYPE.PID;
    logger.info('[DEMO] PID Tune mode set — next flight: pid');
  }

  /**
   * Configure stress-test scenario overrides per cycle.
   * When a cycle matches, the stress generator is used instead of the default.
   *
   * Example: `setStressSchedule([[0, STRESS_SCENARIOS.poorQuality], [2, STRESS_SCENARIOS.mechanical]])`
   * → Cycle 0 filter flight uses poor quality BBL, cycle 2 uses mechanical issue BBL.
   */
  setStressSchedule(schedule: Array<[number, StressScenario]>): void {
    this._stressSchedule.clear();
    for (const [cycle, scenario] of schedule) {
      this._stressSchedule.set(cycle, scenario);
    }
    logger.info(`[DEMO] Stress schedule configured: ${schedule.length} overrides`);
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
    return {
      ...DEMO_FC_INFO,
      pidProfileIndex: this._pidProfileIndex,
      pidProfileCount: this._pidProfileCount,
    };
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
    // Return current state reflecting any applied changes
    const s = this.connection.appliedSettings;
    return {
      gyro_lpf1_static_hz: intOr(
        s.get('gyro_lpf1_static_hz'),
        DEMO_FILTER_CONFIG.gyro_lpf1_static_hz
      ),
      gyro_lpf2_static_hz: intOr(
        s.get('gyro_lpf2_static_hz'),
        DEMO_FILTER_CONFIG.gyro_lpf2_static_hz
      ),
      dterm_lpf1_static_hz: intOr(
        s.get('dterm_lpf1_static_hz'),
        DEMO_FILTER_CONFIG.dterm_lpf1_static_hz
      ),
      dterm_lpf2_static_hz: intOr(
        s.get('dterm_lpf2_static_hz'),
        DEMO_FILTER_CONFIG.dterm_lpf2_static_hz
      ),
      dyn_notch_min_hz: intOr(s.get('dyn_notch_min_hz'), DEMO_FILTER_CONFIG.dyn_notch_min_hz),
      dyn_notch_max_hz: intOr(s.get('dyn_notch_max_hz'), DEMO_FILTER_CONFIG.dyn_notch_max_hz),
      rpm_filter_harmonics: intOr(
        s.get('rpm_filter_harmonics'),
        DEMO_FILTER_CONFIG.rpm_filter_harmonics!
      ),
      rpm_filter_min_hz: intOr(s.get('rpm_filter_min_hz'), DEMO_FILTER_CONFIG.rpm_filter_min_hz!),
      dyn_notch_count: intOr(s.get('dyn_notch_count'), DEMO_FILTER_CONFIG.dyn_notch_count!),
      dyn_notch_q: intOr(s.get('dyn_notch_q'), DEMO_FILTER_CONFIG.dyn_notch_q!),
    };
  }

  async getPIDConfiguration(): Promise<PIDConfiguration> {
    // Return current state reflecting any applied changes
    const s = this.connection.appliedSettings;
    return {
      roll: {
        P: intOr(s.get('p_roll'), DEMO_PID_CONFIG.roll.P),
        I: intOr(s.get('i_roll'), DEMO_PID_CONFIG.roll.I),
        D: intOr(s.get('d_roll'), DEMO_PID_CONFIG.roll.D),
      },
      pitch: {
        P: intOr(s.get('p_pitch'), DEMO_PID_CONFIG.pitch.P),
        I: intOr(s.get('i_pitch'), DEMO_PID_CONFIG.pitch.I),
        D: intOr(s.get('d_pitch'), DEMO_PID_CONFIG.pitch.D),
      },
      yaw: {
        P: intOr(s.get('p_yaw'), DEMO_PID_CONFIG.yaw.P),
        I: intOr(s.get('i_yaw'), DEMO_PID_CONFIG.yaw.I),
        D: intOr(s.get('d_yaw'), DEMO_PID_CONFIG.yaw.D),
      },
    };
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
    const s = this.connection.appliedSettings;
    return {
      transition: intOr(s.get('feedforward_transition'), DEMO_FF_CONFIG.transition),
      rollGain: intOr(s.get('f_roll'), DEMO_FF_CONFIG.rollGain),
      pitchGain: intOr(s.get('f_pitch'), DEMO_FF_CONFIG.pitchGain),
      yawGain: intOr(s.get('f_yaw'), DEMO_FF_CONFIG.yawGain),
      boost: intOr(s.get('feedforward_boost'), DEMO_FF_CONFIG.boost),
      smoothFactor: intOr(s.get('feedforward_smooth_factor'), DEMO_FF_CONFIG.smoothFactor),
      jitterFactor: intOr(s.get('feedforward_jitter_factor'), DEMO_FF_CONFIG.jitterFactor),
      maxRateLimit: intOr(s.get('feedforward_max_rate_limit'), DEMO_FF_CONFIG.maxRateLimit),
    };
  }

  async getRatesConfiguration(): Promise<RatesConfiguration> {
    return {
      ratesType: 'ACTUAL',
      roll: { rcRate: 15, rate: 200, rcExpo: 56, rateLimit: 1998 },
      pitch: { rcRate: 15, rate: 200, rcExpo: 56, rateLimit: 1998 },
      yaw: { rcRate: 12, rate: 150, rcExpo: 32, rateLimit: 1998 },
    };
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
      result.push('', `profile ${this._pidProfileIndex}`, '');
      result.push(`# profile ${this._pidProfileIndex}`);
      for (const key of profileKeys) {
        result.push(`set ${key} = ${settingsMap.get(key)}`);
      }
    }
    result.push('', 'rateprofile 0', '', '# rateprofile 0', '');

    return result.join('\n');
  }

  async downloadBlackboxLog(
    onProgress?: (progress: number) => void
  ): Promise<{ data: Buffer; compressionDetected: boolean }> {
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

    return { data: this._demoBBLData, compressionDetected: false };
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

      // Check if stress schedule overrides this cycle + flight type
      const stressOverride = this._stressSchedule.get(c);
      if (stressOverride && stressOverride.flightType === this._nextFlightType) {
        logger.info(`[DEMO] Using stress override for cycle ${c} (${stressOverride.flightType})`);
        this._demoBBLData = stressOverride.generator(c);
      } else {
        const generators: Record<DemoFlightPhase, BBLGenerator> = {
          [DEMO_FLIGHT.FILTER]: generateFilterDemoBBL,
          [DEMO_FLIGHT.PID]: generatePIDDemoBBL,
          [DEMO_FLIGHT.FLASH]: generateFlashDemoBBL,
          // Verification flight type depends on tuning mode:
          // Filter Tune: throttle sweep (same as filter flight) for spectrogram comparison
          // PID Tune: stick snaps (same as PID flight) for step response comparison
          // Flash Tune: broadband setpoint for Wiener deconvolution
          [DEMO_FLIGHT.VERIFICATION]:
            this._lastSessionType === TUNING_TYPE.FLASH
              ? generateFlashVerificationDemoBBL
              : this._lastSessionType === TUNING_TYPE.PID
                ? generatePIDDemoBBL
                : generateVerificationDemoBBL,
        };
        this._demoBBLData = generators[this._nextFlightType](c);
      }

      const nextPhase: Record<DemoFlightPhase, DemoFlightPhase> = {
        // Filter Tune: filter → verification (no PID step)
        // PID Tune: pid → verification
        // Flash Tune: flash → verification
        [DEMO_FLIGHT.FILTER]: DEMO_FLIGHT.VERIFICATION,
        [DEMO_FLIGHT.PID]: DEMO_FLIGHT.VERIFICATION,
        [DEMO_FLIGHT.FLASH]: DEMO_FLIGHT.VERIFICATION,
        [DEMO_FLIGHT.VERIFICATION]:
          this._lastSessionType === TUNING_TYPE.FLASH
            ? DEMO_FLIGHT.FLASH
            : this._lastSessionType === TUNING_TYPE.PID
              ? DEMO_FLIGHT.PID
              : DEMO_FLIGHT.FILTER,
      };
      // After verification completes a full cycle — increment for next round
      if (this._nextFlightType === DEMO_FLIGHT.VERIFICATION) {
        this._tuningCycle++;
      }
      this._nextFlightType = nextPhase[this._nextFlightType];

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

  async getStatusEx(): Promise<{ pidProfileIndex: number; pidProfileCount: number }> {
    return {
      pidProfileIndex: this._pidProfileIndex,
      pidProfileCount: this._pidProfileCount,
    };
  }

  async selectPidProfile(index: number): Promise<void> {
    if (index < 0 || index >= this._pidProfileCount) {
      throw new Error(
        `Invalid PID profile index: ${index} (must be 0-${this._pidProfileCount - 1})`
      );
    }
    this._pidProfileIndex = index;
    logger.info(`[DEMO] Switched to PID profile ${index}`);
  }

  /**
   * Validate firmware version — always passes in demo mode.
   */
  async validateFirmwareVersion(): Promise<void> {
    // Demo FC is always compatible
  }
}

/** Parse int from string, fallback to default if missing/NaN */
function intOr(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}
