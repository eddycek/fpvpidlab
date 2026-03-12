import { EventEmitter } from 'events';
import { SerialPort } from 'serialport';
import { MSPConnection } from './MSPConnection';
import { MSPCommand, CLI_COMMANDS } from './commands';
import type {
  PortInfo,
  ApiVersionInfo,
  BoardInfo,
  FCInfo,
  ConnectionStatus,
} from '@shared/types/common.types';
import type { PIDConfiguration, FeedforwardConfiguration } from '@shared/types/pid.types';
import type { CurrentFilterSettings } from '@shared/types/analysis.types';
import type { BlackboxInfo, SDCardInfo } from '@shared/types/blackbox.types';
import { SDCardState } from '@shared/types/blackbox.types';
import { ConnectionError, MSPError, TimeoutError } from '../utils/errors';
import { logger } from '../utils/logger';
import { MSP, BETAFLIGHT } from '@shared/constants';
import { UnsupportedVersionError } from '../utils/errors';

export class MSPClient extends EventEmitter {
  private connection: MSPConnection;
  private connectionStatus: ConnectionStatus = { connected: false };
  private currentPort: string | null = null;
  /** True when FC is in MSC mode — suppresses normal disconnect handling */
  private _mscModeActive: boolean = false;
  /** True when FC is rebooting after save — suppresses normal disconnect handling */
  private _rebootPending: boolean = false;
  /** Cached storage type from last getBlackboxInfo() call */
  private _lastStorageType: 'flash' | 'sdcard' | 'none' = 'none';

  constructor() {
    super();
    this.connection = new MSPConnection();

    // 'connected' is emitted at the end of connect(), not here,
    // to prevent race conditions with initialization.

    this.connection.on('disconnected', () => {
      this.connectionStatus = { connected: false };
      this.currentPort = null;
      this.emit('disconnected');
    });

    this.connection.on('error', (error) => {
      this.emit('error', error);
    });
  }

  get mscModeActive(): boolean {
    return this._mscModeActive;
  }

  get rebootPending(): boolean {
    return this._rebootPending;
  }

  get lastStorageType(): 'flash' | 'sdcard' | 'none' {
    return this._lastStorageType;
  }

  async listPorts(): Promise<PortInfo[]> {
    try {
      const ports = await SerialPort.list();
      logger.info(`Found ${ports.length} serial ports:`, ports);

      // Filter for likely Betaflight devices
      const filtered = ports.filter((port) => {
        if (!port.vendorId) return false;
        const vid = `0x${port.vendorId}`;
        return BETAFLIGHT.VENDOR_IDS.some((id) => id.toLowerCase() === vid.toLowerCase());
      });

      logger.info(`Filtered to ${filtered.length} Betaflight-compatible ports`);

      // If no filtered ports, return all ports with vendorId
      const result = filtered.length > 0 ? filtered : ports.filter((p) => p.vendorId);

      return result.map((port) => ({
        path: port.path,
        manufacturer: port.manufacturer,
        serialNumber: port.serialNumber,
        pnpId: port.pnpId,
        locationId: port.locationId,
        productId: port.productId,
        vendorId: port.vendorId,
      }));
    } catch (error) {
      logger.error('Failed to list ports:', error);
      throw new ConnectionError('Failed to enumerate serial ports', error);
    }
  }

  async connect(portPath: string, baudRate: number = MSP.DEFAULT_BAUD_RATE): Promise<void> {
    if (this.connection.isOpen()) {
      throw new ConnectionError('Already connected');
    }

    try {
      await this.connection.open(portPath, baudRate);
      this.currentPort = portPath;

      // Wait a bit for FC to stabilize
      await this.delay(500);

      // Try to exit CLI mode if FC is stuck there from previous session
      try {
        await this.connection.forceExitCLI();
        await this.delay(500);
      } catch (error) {
        // Ignore errors - FC might not be in CLI mode
        logger.debug('CLI exit attempt (this is normal):', error);
      }

      // Try to get FC information with retry logic
      let fcInfo;
      let retries = 2;

      while (retries > 0) {
        try {
          fcInfo = await this.getFCInfo();
          break; // Success!
        } catch (error) {
          retries--;
          if (retries === 0) {
            // Last attempt failed - close port and throw error
            logger.error('Failed to get FC info after retries, closing port');
            await this.connection.close();
            this.connectionStatus = { connected: false };
            this.currentPort = null;
            throw new ConnectionError(
              'FC not responding to MSP commands. Please disconnect and reconnect the FC.',
              error
            );
          }

          // Retry - try to reset FC state
          logger.warn(`FC not responding, attempting reset (${retries} retries left)...`);
          try {
            await this.connection.forceExitCLI();
            await this.delay(1000);
          } catch {}
        }
      }

      // Version gate: reject firmware below minimum supported version
      this.validateFirmwareVersion(fcInfo!);

      // Read PID profile info from MSP_STATUS_EX
      try {
        const statusEx = await this.getStatusEx();
        fcInfo!.pidProfileIndex = statusEx.pidProfileIndex;
        fcInfo!.pidProfileCount = statusEx.pidProfileCount;
      } catch (error) {
        logger.warn('Failed to read MSP_STATUS_EX (PID profile info):', error);
        // Non-fatal — leave fields undefined
      }

      this.connectionStatus = {
        connected: true,
        portPath,
        fcInfo,
      };

      logger.info('Connected to FC:', fcInfo);
      this.emit('connection-changed', this.connectionStatus);
      this.emit('connected'); // After all init is complete — safe for handlers
    } catch (error) {
      this.connectionStatus = { connected: false };
      this.currentPort = null;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    logger.info('Disconnect requested');

    if (!this.connection.isOpen()) {
      logger.warn('Port already closed, updating status');
      this.connectionStatus = { connected: false };
      this.currentPort = null;
      this.emit('connection-changed', this.connectionStatus);
      return;
    }

    try {
      logger.info('Closing connection...');
      await this.connection.close();

      // Wait a bit for the port to fully release
      // This prevents "FC not responding" errors when reconnecting immediately
      await new Promise((resolve) => setTimeout(resolve, 1000));

      this.connectionStatus = { connected: false };
      this.currentPort = null;
      logger.info('Emitting connection-changed event (disconnected)');
      this.emit('connection-changed', this.connectionStatus);
      logger.info('Disconnect completed');
    } catch (error) {
      logger.error('Error during disconnect:', error);
      // Still update status even if close fails
      this.connectionStatus = { connected: false };
      this.currentPort = null;
      this.emit('connection-changed', this.connectionStatus);
      throw error;
    }
  }

  async reconnect(): Promise<void> {
    if (!this.currentPort) {
      throw new ConnectionError('No previous connection to reconnect to');
    }

    const port = this.currentPort;
    await this.disconnect();
    await this.delay(1000);
    await this.connect(port);
  }

  /**
   * Validate that the connected FC runs a supported firmware version.
   * Minimum: BF 4.3 (API 1.44). Throws UnsupportedVersionError if below.
   */
  private validateFirmwareVersion(fcInfo: FCInfo): void {
    const { apiVersion, version } = fcInfo;
    const { major, minor } = apiVersion;
    const { MIN_API_VERSION, MIN_VERSION } = BETAFLIGHT;

    if (
      major < MIN_API_VERSION.major ||
      (major === MIN_API_VERSION.major && minor < MIN_API_VERSION.minor)
    ) {
      // Close the port before throwing — we don't want to leave it open
      this.connection.close().catch(() => {});
      this.connectionStatus = { connected: false };
      this.currentPort = null;

      throw new UnsupportedVersionError(
        `Betaflight ${version} (API ${major}.${minor}) is not supported. ` +
          `Minimum required: Betaflight ${MIN_VERSION} (API ${MIN_API_VERSION.major}.${MIN_API_VERSION.minor}). ` +
          `Please update your firmware.`,
        version,
        { major, minor }
      );
    }

    logger.info(`Firmware version check passed: ${version} (API ${major}.${minor})`);
  }

  isConnected(): boolean {
    return this.connection.isOpen();
  }

  getConnectionStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  async getApiVersion(): Promise<ApiVersionInfo> {
    const response = await this.connection.sendCommand(MSPCommand.MSP_API_VERSION);

    if (response.data.length < 3) {
      throw new MSPError('Invalid API_VERSION response');
    }

    return {
      protocol: response.data[0],
      major: response.data[1],
      minor: response.data[2],
    };
  }

  async getFCVariant(): Promise<string> {
    const response = await this.connection.sendCommand(MSPCommand.MSP_FC_VARIANT);
    return response.data.toString('utf-8', 0, 4);
  }

  async getFCVersion(): Promise<string> {
    const response = await this.connection.sendCommand(MSPCommand.MSP_FC_VERSION);

    if (response.data.length < 3) {
      throw new MSPError('Invalid FC_VERSION response');
    }

    return `${response.data[0]}.${response.data[1]}.${response.data[2]}`;
  }

  async getBoardInfo(): Promise<BoardInfo> {
    const response = await this.connection.sendCommand(MSPCommand.MSP_BOARD_INFO);

    if (response.data.length < 9) {
      throw new MSPError('Invalid BOARD_INFO response');
    }

    const boardIdentifier = response.data.toString('utf-8', 0, 4);
    const boardVersion = response.data.readUInt16LE(4);
    const boardType = response.data[6];
    const targetNameLength = response.data[7];

    let offset = 8;
    const targetName = response.data.toString('utf-8', offset, offset + targetNameLength);
    offset += targetNameLength;

    let boardName = '';
    let manufacturerId = '';
    let signature: number[] = [];
    let mcuTypeId = 0;
    let configurationState = 0;

    // Some boards don't have boardName field, check if we have enough data
    if (offset < response.data.length) {
      const boardNameLength = response.data[offset];
      offset += 1;

      if (boardNameLength > 0 && offset + boardNameLength <= response.data.length) {
        const rawBoardName = response.data.toString('utf-8', offset, offset + boardNameLength);
        // Filter out null bytes and control characters
        boardName = rawBoardName.replace(/[\x00-\x1F\x7F]/g, '').trim();
        offset += boardNameLength;
      }
    }

    // Get manufacturer ID if available
    if (offset < response.data.length) {
      const manufacturerIdLength = response.data[offset];
      offset += 1;

      if (manufacturerIdLength > 0 && offset + manufacturerIdLength <= response.data.length) {
        manufacturerId = response.data.toString('utf-8', offset, offset + manufacturerIdLength);
        offset += manufacturerIdLength;
      }
    }

    // Get signature if available
    if (offset < response.data.length) {
      const signatureLength = response.data[offset];
      offset += 1;

      if (signatureLength > 0 && offset + signatureLength <= response.data.length) {
        signature = Array.from(response.data.slice(offset, offset + signatureLength));
        offset += signatureLength;
      }
    }

    // Get MCU type and configuration state if available
    if (offset < response.data.length) {
      mcuTypeId = response.data[offset];
      if (offset + 1 < response.data.length) {
        configurationState = response.data[offset + 1];
      }
    }

    // Fallback: use targetName if boardName is empty
    if (!boardName) {
      boardName = targetName;
    }

    return {
      boardIdentifier,
      boardVersion,
      boardType,
      targetName,
      boardName,
      manufacturerId,
      signature,
      mcuTypeId,
      configurationState,
    };
  }

  async getUID(): Promise<string> {
    const response = await this.connection.sendCommand(MSPCommand.MSP_UID);

    if (response.data.length < 12) {
      throw new MSPError('Invalid UID response');
    }

    // Convert UID bytes to hex string
    const uid = Array.from(response.data.slice(0, 12))
      .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
      .join('');

    return uid;
  }

  async getFCInfo(): Promise<FCInfo> {
    const [apiVersion, variant, version, boardInfo] = await Promise.all([
      this.getApiVersion(),
      this.getFCVariant(),
      this.getFCVersion(),
      this.getBoardInfo(),
    ]);

    return {
      variant,
      version,
      target: boardInfo.targetName,
      boardName: boardInfo.boardName,
      apiVersion,
    };
  }

  async getFCSerialNumber(): Promise<string> {
    return this.getUID();
  }

  async exportCLIDiff(): Promise<string> {
    const wasInCLI = this.connection.isInCLI();

    try {
      if (!wasInCLI) {
        await this.connection.enterCLI();
      }
      const output = await this.connection.sendCLICommand(CLI_COMMANDS.DIFF, 10000);

      // Don't exit CLI - it causes port to close on some FCs
      // Instead, just leave it in CLI mode and next MSP command will handle it

      return this.cleanCLIOutput(output);
    } catch (error) {
      // Try to recover but don't fail if exit fails
      try {
        if (!wasInCLI) {
          await this.connection.exitCLI();
        }
      } catch {}
      throw error;
    }
  }

  async exportCLIDump(): Promise<string> {
    const wasInCLI = this.connection.isInCLI();

    try {
      if (!wasInCLI) {
        await this.connection.enterCLI();
      }
      const output = await this.connection.sendCLICommand(CLI_COMMANDS.DUMP, 15000);

      // Don't exit CLI - it causes port to close on some FCs
      // Instead, just leave it in CLI mode and next MSP command will handle it

      return this.cleanCLIOutput(output);
    } catch (error) {
      // Try to recover but don't fail if exit fails
      try {
        if (!wasInCLI) {
          await this.connection.exitCLI();
        }
      } catch {}
      throw error;
    }
  }

  async saveAndReboot(): Promise<void> {
    try {
      this._rebootPending = true;
      if (!this.connection.isInCLI()) {
        await this.connection.enterCLI();
      }
      // Use writeCLIRaw instead of sendCLICommand because `save` causes
      // FC to reboot — the CLI prompt never comes back, so waiting for
      // it would always time out.
      await this.connection.writeCLIRaw(CLI_COMMANDS.SAVE);
      // FC is rebooting from save — it exits CLI mode on its own.
      // Clear flag so close() doesn't send redundant 'exit'.
      this.connection.clearFCRebootedFromCLI();
      // Give FC a moment to process the save command before we update state
      await new Promise((resolve) => setTimeout(resolve, 500));
      this.connectionStatus = { connected: false };
      this.emit('connection-changed', this.connectionStatus);
    } catch (error) {
      this._rebootPending = false;
      logger.error('Failed to save and reboot:', error);
      throw error;
    }
  }

  /**
   * Read PID configuration from flight controller
   * @returns Current PID values for roll, pitch, yaw axes
   */
  async getPIDConfiguration(): Promise<PIDConfiguration> {
    const response = await this.connection.sendCommand(MSPCommand.MSP_PID);

    if (response.data.length < 9) {
      throw new MSPError('Invalid MSP_PID response - expected at least 9 bytes');
    }

    // Parse roll, pitch, yaw (first 9 bytes)
    // Format: Roll P/I/D (0-2), Pitch P/I/D (3-5), Yaw P/I/D (6-8)
    const config: PIDConfiguration = {
      roll: {
        P: response.data[0],
        I: response.data[1],
        D: response.data[2],
      },
      pitch: {
        P: response.data[3],
        I: response.data[4],
        D: response.data[5],
      },
      yaw: {
        P: response.data[6],
        I: response.data[7],
        D: response.data[8],
      },
    };

    logger.info('PID configuration read:', config);
    return config;
  }

  /**
   * Read filter configuration from flight controller
   * @returns Current filter settings (gyro LPF, D-term LPF, dynamic notch)
   */
  async getFilterConfiguration(): Promise<CurrentFilterSettings> {
    const response = await this.connection.sendCommand(MSPCommand.MSP_FILTER_CONFIG);

    if (response.data.length < 47) {
      throw new MSPError(
        `Invalid MSP_FILTER_CONFIG response - expected at least 47 bytes, got ${response.data.length}`
      );
    }

    // Betaflight 4.4+ MSP_FILTER_CONFIG binary layout
    // (from betaflight-configurator MSPHelper.js parsing order):
    //  0: U8  gyro_lpf1_static_hz (legacy, low byte only)
    //  1: U16 dterm_lpf1_static_hz
    //  3: U16 yaw_lowpass_hz
    //  5: U16 gyro_notch_hz
    //  7: U16 gyro_notch_cutoff
    //  9: U16 dterm_notch_hz
    // 11: U16 dterm_notch_cutoff
    // 13: U16 gyro_notch2_hz
    // 15: U16 gyro_notch2_cutoff
    // 17: U8  dterm_lpf1_type
    // 18: U8  gyro_hardware_lpf
    // 19: U8  (deprecated)
    // 20: U16 gyro_lpf1_static_hz (full uint16)
    // 22: U16 gyro_lpf2_static_hz
    // 24: U8  gyro_lpf1_type
    // 25: U8  gyro_lpf2_type
    // 26: U16 dterm_lpf2_static_hz
    // 28: U8  dterm_lpf2_type
    // 29: U16 gyro_lowpass_dyn_min_hz
    // 31: U16 gyro_lowpass_dyn_max_hz
    // 33: U16 dterm_lowpass_dyn_min_hz
    // 35: U16 dterm_lowpass_dyn_max_hz
    // 37: U8  dyn_notch_range (deprecated)
    // 38: U8  dyn_notch_width_percent (deprecated)
    // 39: U16 dyn_notch_q
    // 41: U16 dyn_notch_min_hz
    // 43: U8  rpm_notch_harmonics
    // 44: U8  rpm_notch_min_hz
    // 45: U16 dyn_notch_max_hz
    const settings: CurrentFilterSettings = {
      gyro_lpf1_static_hz: response.data.readUInt16LE(20),
      dterm_lpf1_static_hz: response.data.readUInt16LE(1),
      gyro_lpf2_static_hz: response.data.readUInt16LE(22),
      dterm_lpf2_static_hz: response.data.readUInt16LE(26),
      dyn_notch_min_hz: response.data.readUInt16LE(41),
      dyn_notch_max_hz: response.data.readUInt16LE(45),
      dyn_notch_q: response.data.readUInt16LE(39),
      rpm_filter_harmonics: response.data.readUInt8(43),
      rpm_filter_min_hz: response.data.readUInt8(44),
    };

    // dyn_notch_count is at byte 47 in BF 4.3+ extended response
    if (response.data.length > 47) {
      settings.dyn_notch_count = response.data.readUInt8(47);
    }

    logger.info('Filter configuration read:', settings);
    return settings;
  }

  /**
   * Read pid_process_denom from MSP_ADVANCED_CONFIG (command 90).
   *
   * Byte layout (from betaflight-configurator MSPHelper.js):
   *  0: U8  gyro_sync_denom
   *  1: U8  pid_process_denom
   *  2: U8  use_unsynced_pwm
   *  3: U8  motor_pwm_protocol
   *  4-5: U16 motor_pwm_rate
   *  6-7: U16 digital_idle_percent (÷100)
   *  8: U8  gyro_use_32khz (BF 4.x)
   */
  async getPidProcessDenom(): Promise<number> {
    const response = await this.connection.sendCommand(MSPCommand.MSP_ADVANCED_CONFIG);
    if (response.data.length < 2) {
      throw new MSPError(
        `Invalid MSP_ADVANCED_CONFIG response - expected at least 2 bytes, got ${response.data.length}`
      );
    }
    return response.data.readUInt8(1);
  }

  /**
   * Read feedforward configuration from flight controller via MSP_PID_ADVANCED.
   *
   * Byte layout (BF 4.3+, API 1.44+, from betaflight-configurator MSPHelper.js):
   *  0-1:  U16 (reserved)        14-15: U16 pidMaxVelocity
   *  2-3:  U16 (reserved)        16-17: U16 pidMaxVelocityYaw
   *  4-5:  U16 (reserved)        18:    U8  levelAngleLimit
   *  6:    U8  (reserved)        19:    U8  levelSensitivity
   *  7:    U8  vbatPidComp       20-21: U16 (reserved)
   *  8:    U8  ffTransition      22-23: U16 antiGravityGain
   *  9-10: U16 (reserved)        24-25: U16 ffRoll
   * 11:    U8  (reserved)        26-27: U16 ffPitch
   * 12:    U8  (reserved)        28-29: U16 ffYaw
   * 13:    U8  (reserved)        30:    U8  antiGravityMode
   *
   * 31-33: U8×3 d_min[R/P/Y]    40:    U8  ffAveraging
   * 34:    U8  d_min_gain        41:    U8  ffSmoothFactor
   * 35:    U8  d_min_advance     42:    U8  ffBoost
   * 36:    U8  integratedYaw     43:    U8  ffMaxRateLimit
   * 37:    U8  motorOutLimit     44:    U8  ffJitterFactor
   * 38:    U8  autoProfCellCnt
   * 39:    U8  idleMinRpm
   */
  async getFeedforwardConfiguration(): Promise<FeedforwardConfiguration> {
    const response = await this.connection.sendCommand(MSPCommand.MSP_PID_ADVANCED);

    if (response.data.length < 45) {
      throw new MSPError(
        `Invalid MSP_PID_ADVANCED response - expected at least 45 bytes, got ${response.data.length}`
      );
    }

    const config: FeedforwardConfiguration = {
      transition: response.data.readUInt8(8),
      rollGain: response.data.readUInt16LE(24),
      pitchGain: response.data.readUInt16LE(26),
      yawGain: response.data.readUInt16LE(28),
      boost: response.data.readUInt8(42),
      smoothFactor: response.data.readUInt8(41),
      jitterFactor: response.data.readUInt8(44),
      maxRateLimit: response.data.readUInt8(43),
    };

    logger.info('Feedforward configuration read:', config);
    return config;
  }

  /**
   * Write PID configuration to flight controller RAM (not persisted)
   * @param config PID values to write
   */
  async setPIDConfiguration(config: PIDConfiguration): Promise<void> {
    // Create 30-byte buffer for all PID values (Betaflight MSP_SET_PID format)
    const data = Buffer.alloc(30);

    // Roll (bytes 0-2)
    data[0] = Math.round(config.roll.P);
    data[1] = Math.round(config.roll.I);
    data[2] = Math.round(config.roll.D);

    // Pitch (bytes 3-5)
    data[3] = Math.round(config.pitch.P);
    data[4] = Math.round(config.pitch.I);
    data[5] = Math.round(config.pitch.D);

    // Yaw (bytes 6-8)
    data[6] = Math.round(config.yaw.P);
    data[7] = Math.round(config.yaw.I);
    data[8] = Math.round(config.yaw.D);

    // Bytes 9-29: other PIDs (leave as 0 - won't affect FC if unchanged)

    const response = await this.connection.sendCommand(MSPCommand.MSP_SET_PID, data);

    if (response.error) {
      throw new MSPError('Failed to set PID configuration');
    }

    logger.info('PID configuration updated successfully:', config);
  }

  /**
   * Get SD card storage information via MSP_SDCARD_SUMMARY.
   * Returns null if SD card is not supported (command not recognized).
   */
  async getSDCardInfo(): Promise<SDCardInfo | null> {
    if (!this.isConnected()) {
      throw new ConnectionError('Flight controller not connected');
    }

    try {
      const response = await this.connection.sendCommand(MSPCommand.MSP_SDCARD_SUMMARY);

      if (response.error) {
        logger.debug('MSP_SDCARD_SUMMARY returned error (SD card not supported)');
        return null;
      }

      if (response.data.length < 11) {
        logger.warn(`SD card response too short: ${response.data.length} bytes (expected 11)`);
        return null;
      }

      // Parse MSP_SDCARD_SUMMARY response (11 bytes)
      // Byte 0: flags (bit 0 = supported)
      // Byte 1: state (0=not-present, 1=fatal, 2=card-init, 3=fs-init, 4=ready)
      // Byte 2: last error
      // Bytes 3-6: free space in KB (uint32 LE)
      // Bytes 7-10: total space in KB (uint32 LE)
      const flags = response.data.readUInt8(0);
      const state = response.data.readUInt8(1) as SDCardState;
      const lastError = response.data.readUInt8(2);
      const freeSizeKB = response.data.readUInt32LE(3);
      const totalSizeKB = response.data.readUInt32LE(7);

      const supported = (flags & 0x01) !== 0;

      logger.debug('SD card parsed:', {
        flags,
        state,
        lastError,
        freeSizeKB,
        totalSizeKB,
        supported,
      });

      return { supported, state, lastError, freeSizeKB, totalSizeKB };
    } catch (error) {
      logger.debug('MSP_SDCARD_SUMMARY failed (likely not supported):', error);
      return null;
    }
  }

  /**
   * Get Blackbox storage information — checks both flash and SD card.
   * Tries dataflash first; if not supported, falls back to SD card.
   */
  async getBlackboxInfo(): Promise<BlackboxInfo> {
    if (!this.isConnected()) {
      throw new ConnectionError('Flight controller not connected');
    }

    const unsupported: BlackboxInfo = {
      supported: false,
      storageType: 'none',
      totalSize: 0,
      usedSize: 0,
      hasLogs: false,
      freeSize: 0,
      usagePercent: 0,
    };

    // --- Try dataflash first ---
    try {
      const flashInfo = await this.getDataflashInfo();
      if (flashInfo.supported && flashInfo.totalSize > 0) {
        this._lastStorageType = 'flash';
        return flashInfo;
      }
    } catch (error) {
      logger.debug('Dataflash check failed, trying SD card:', error);
    }

    // --- Fallback: try SD card ---
    try {
      const sdInfo = await this.getSDCardInfo();
      if (sdInfo && sdInfo.supported) {
        if (sdInfo.state === SDCardState.READY) {
          const totalSize = sdInfo.totalSizeKB * 1024;
          const freeSize = sdInfo.freeSizeKB * 1024;
          const usedSize = totalSize - freeSize;
          const usagePercent = totalSize > 0 ? Math.round((usedSize / totalSize) * 100) : 0;

          const info: BlackboxInfo = {
            supported: true,
            storageType: 'sdcard',
            totalSize,
            usedSize,
            hasLogs: usedSize > 0,
            freeSize,
            usagePercent,
          };

          this._lastStorageType = 'sdcard';
          logger.info('Blackbox info (SD card):', info);
          return info;
        }

        // SD card supported but not ready
        logger.warn(
          `SD card supported but not ready (state=${sdInfo.state}, error=${sdInfo.lastError})`
        );
        this._lastStorageType = 'sdcard';
        return {
          supported: true,
          storageType: 'sdcard',
          totalSize: 0,
          usedSize: 0,
          hasLogs: false,
          freeSize: 0,
          usagePercent: 0,
        };
      }
    } catch (error) {
      logger.debug('SD card check failed:', error);
    }

    this._lastStorageType = 'none';
    return unsupported;
  }

  /**
   * Get dataflash-specific storage info (internal helper).
   * Returns BlackboxInfo with storageType='flash'.
   */
  private async getDataflashInfo(): Promise<BlackboxInfo> {
    const unsupported: BlackboxInfo = {
      supported: false,
      storageType: 'flash',
      totalSize: 0,
      usedSize: 0,
      hasLogs: false,
      freeSize: 0,
      usagePercent: 0,
    };

    const response = await this.connection.sendCommand(MSPCommand.MSP_DATAFLASH_SUMMARY);

    logger.debug('Blackbox response:', {
      error: response.error,
      dataLength: response.data.length,
      dataHex: response.data.toString('hex'),
    });

    if (response.error || response.data.length < 13) {
      return unsupported;
    }

    // Parse dataflash summary response (13 bytes total)
    const ready = response.data.readUInt8(0);
    const totalSize = response.data.readUInt32LE(5);
    const usedSize = response.data.readUInt32LE(9);

    logger.debug('Blackbox parsed:', { ready, totalSize, usedSize, readyHex: ready.toString(16) });

    const supported = (ready & 0x02) !== 0;

    // Check for invalid values (0x80000000 = "not available" on some FCs)
    const INVALID_SIZE = 0x80000000;
    if (totalSize === INVALID_SIZE || usedSize === INVALID_SIZE) {
      if (supported) {
        return { ...unsupported, supported: true };
      }
      return unsupported;
    }

    if (!supported) {
      return unsupported;
    }

    if (totalSize === 0) {
      return { ...unsupported, supported: true };
    }

    // Normal case with valid sizes
    const hasLogs = usedSize > 0;
    const freeSize = totalSize - usedSize;
    const usagePercent = totalSize > 0 ? Math.round((usedSize / totalSize) * 100) : 0;

    const info: BlackboxInfo = {
      supported,
      storageType: 'flash',
      totalSize,
      usedSize,
      hasLogs,
      freeSize,
      usagePercent,
    };

    logger.info('Blackbox info:', info);
    return info;
  }

  /**
   * Reboot FC into Mass Storage Class mode for SD card / flash access.
   * After calling this, the serial connection will be lost as the FC
   * re-enumerates as a USB mass storage device.
   *
   * @returns true if FC accepted MSC reboot, false if storage not ready
   */
  async rebootToMSC(): Promise<boolean> {
    if (!this.isConnected()) {
      throw new ConnectionError('Flight controller not connected');
    }

    // Use MSC_UTC (3) on Linux, MSC (2) on macOS/Windows
    const rebootType = process.platform === 'linux' ? 3 : 2;
    const payload = Buffer.alloc(1);
    payload.writeUInt8(rebootType, 0);

    logger.info(
      `Sending MSP_REBOOT with type=${rebootType} (MSC${rebootType === 3 ? '_UTC' : ''})`
    );

    // Set flag BEFORE sending — FC reboots immediately and may disconnect
    // before we can process a response. The disconnect handler checks this
    // flag to suppress normal profile clear behavior.
    this._mscModeActive = true;

    // Fire-and-forget: FC reboots into MSC mode without sending an ACK.
    // If the FC doesn't support MSC or SD card isn't ready, the drive
    // detection in MSCManager will timeout and report the error.
    try {
      await this.connection.sendCommandNoResponse(MSPCommand.MSP_REBOOT, payload);
    } catch (error) {
      // Write may fail if FC already disconnected — that's fine
      logger.info('MSP_REBOOT write error (FC may have rebooted already):', error);
    }

    // Brief delay for FC to process the command
    await this.delay(200);

    logger.info('MSC reboot sent — FC will disconnect and re-enumerate as USB drive');
    return true;
  }

  /**
   * Clear MSC mode flag after FC reconnects from MSC mode.
   */
  /**
   * Read PID profile index and count from MSP_STATUS_EX.
   * Byte 10 = current PID profile index (0-based)
   * Byte 11 = number of PID profiles
   */
  async getStatusEx(): Promise<{ pidProfileIndex: number; pidProfileCount: number }> {
    const response = await this.connection.sendCommand(MSPCommand.MSP_STATUS_EX);

    // MSP_STATUS_EX response is at least 16 bytes in BF 4.3+
    if (response.data.length < 12) {
      throw new MSPError('Invalid MSP_STATUS_EX response - expected at least 12 bytes');
    }

    const pidProfileIndex = response.data[10];
    const pidProfileCount = response.data[11];

    logger.info(`Status EX: PID profile ${pidProfileIndex}/${pidProfileCount}`);
    return {
      pidProfileIndex,
      pidProfileCount: pidProfileCount > 0 ? pidProfileCount : 3, // fallback for old BF
    };
  }

  /**
   * Switch the active PID profile on the flight controller.
   * Uses MSP_SELECT_SETTING (210) — immediate, no reboot required.
   * @param index 0-based PID profile index
   */
  async selectPidProfile(index: number): Promise<void> {
    if (index < 0 || index > 3) {
      throw new MSPError(`Invalid PID profile index: ${index} (must be 0-3)`);
    }

    const payload = Buffer.alloc(1);
    payload.writeUInt8(index, 0);
    await this.connection.sendCommand(MSPCommand.MSP_SELECT_SETTING, payload);

    logger.info(`Switched to PID profile ${index}`);
  }

  clearMSCMode(): void {
    this._mscModeActive = false;
  }

  /**
   * Set reboot pending flag before a disconnect that will cause FC reboot.
   * Prevents profile from being cleared during expected disconnect/reconnect.
   */
  setRebootPending(): void {
    this._rebootPending = true;
  }

  /**
   * Clear reboot pending flag after FC reconnects from save reboot.
   */
  clearRebootPending(): void {
    this._rebootPending = false;
  }

  /**
   * Test if FC supports MSP_DATAFLASH_READ by attempting minimal read
   * @returns Object with success status and diagnostic info
   */
  async testBlackboxRead(): Promise<{ success: boolean; message: string; data?: string }> {
    if (!this.isConnected()) {
      return { success: false, message: 'FC not connected' };
    }

    try {
      logger.info('Testing MSP_DATAFLASH_READ with minimal request (10 bytes from address 0)...');

      // Try to read just 10 bytes from address 0
      const request = Buffer.alloc(6);
      request.writeUInt32LE(0, 0); // address = 0
      request.writeUInt16LE(10, 4); // size = 10 bytes

      logger.debug(`Test request hex: ${request.toString('hex')}`);

      // Short timeout for test (5 seconds)
      const response = await this.connection.sendCommand(
        MSPCommand.MSP_DATAFLASH_READ,
        request,
        5000
      );

      logger.info(
        `Test SUCCESS! Received ${response.data.length} bytes: ${response.data.toString('hex')}`
      );

      return {
        success: true,
        message: `FC responded with ${response.data.length} bytes`,
        data: response.data.toString('hex'),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Test FAILED: ${message}`);

      return {
        success: false,
        message: `Test failed: ${message}`,
      };
    }
  }

  /**
   * Read a chunk of Blackbox data from flash storage.
   *
   * MSP_DATAFLASH_READ response format:
   *   [4B readAddress LE] [2B dataSize LE] [1B isCompressed (BF 4.1+)] [dataSize bytes]
   *
   * We strip the response header and return only the raw flash data.
   *
   * @param address - Start address to read from
   * @param size - Number of bytes to read (max 4096)
   * @returns Buffer containing only the flash data (header stripped)
   */
  async readBlackboxChunk(
    address: number,
    size: number
  ): Promise<{ data: Buffer; isCompressed: boolean }> {
    if (!this.isConnected()) {
      throw new ConnectionError('Flight controller not connected');
    }

    // Max size with MSP jumbo frames
    if (size > 8192) {
      throw new Error('Chunk size cannot exceed 8192 bytes (MSP jumbo frame limit)');
    }

    try {
      // Build request: address (uint32 LE) + size (uint16 LE)
      const request = Buffer.alloc(6);
      request.writeUInt32LE(address, 0);
      request.writeUInt16LE(size, 4);

      // Use 5 second timeout - fail fast so adaptive chunking can adjust quickly
      const response = await this.connection.sendCommand(
        MSPCommand.MSP_DATAFLASH_READ,
        request,
        5000
      );

      // Strip MSP_DATAFLASH_READ response header to return only flash data.
      // Without this, downloadBlackboxLog would use chunk.length (which includes
      // the header) as the flash address offset, skipping bytes on every read.
      return MSPClient.extractFlashPayload(response.data);
    } catch (error) {
      logger.error(
        `Failed to read Blackbox chunk at ${address}: ${error instanceof Error ? error.message : error}`
      );
      throw error;
    }
  }

  /**
   * Extract raw flash data from an MSP_DATAFLASH_READ response payload.
   *
   * Response format (BF 4.1+ with USE_HUFFMAN):
   *   [4B readAddress] [2B dataSize] [1B isCompressed] [data...]
   *
   * Older format (no compression support):
   *   [4B readAddress] [2B dataSize] [data...]
   *
   * Detects header size by comparing response length with dataSize field.
   * Returns both the payload data and whether Huffman compression was detected.
   */
  static extractFlashPayload(responseData: Buffer): { data: Buffer; isCompressed: boolean } {
    if (responseData.length < 6) {
      return { data: responseData, isCompressed: false };
    }

    const dataSize = responseData.readUInt16LE(4);

    // Detect 7-byte header (with compression flag) vs 6-byte header
    if (responseData.length === 7 + dataSize && responseData.length >= 7) {
      const isCompressed = responseData[6] !== 0;
      if (isCompressed) {
        logger.warn('Compressed dataflash response detected — Huffman decompression not supported');
      }
      return { data: responseData.subarray(7, 7 + dataSize), isCompressed };
    }

    if (responseData.length === 6 + dataSize) {
      return { data: responseData.subarray(6, 6 + dataSize), isCompressed: false };
    }

    // Unknown format — return everything after minimum 6-byte header
    logger.warn(
      `Unexpected dataflash response size: ${responseData.length} bytes, expected ${6 + dataSize} or ${7 + dataSize}`
    );
    return { data: responseData.subarray(6), isCompressed: false };
  }

  /**
   * Download entire Blackbox log from flash storage
   * @param onProgress - Optional callback for progress updates (0-100)
   * @returns Buffer containing all log data
   */
  async downloadBlackboxLog(
    onProgress?: (progress: number) => void
  ): Promise<{ data: Buffer; compressionDetected: boolean }> {
    if (!this.isConnected()) {
      throw new ConnectionError('Flight controller not connected');
    }

    try {
      // Get flash info to know how much to download
      const info = await this.getBlackboxInfo();

      if (!info.supported || !info.hasLogs || info.usedSize === 0) {
        throw new Error('No Blackbox logs available to download');
      }

      logger.info(`Starting Blackbox download: ${info.usedSize} bytes`);

      const chunks: Buffer[] = [];
      let bytesRead = 0;
      let compressionDetected = false;

      // Conservative adaptive chunking with recovery delays
      // Start with known-working size, gradually increase with caution
      let currentChunkSize = 180; // Start conservative (between 128 working and 256 timeout)
      const minChunkSize = 128; // Known working minimum
      let maxChunkSize = 240; // Conservative max (under 256 timeout threshold)
      let consecutiveSuccesses = 0;
      let consecutiveFailures = 0;

      // Read flash in chunks with adaptive sizing
      while (bytesRead < info.usedSize) {
        const remaining = info.usedSize - bytesRead;
        const requestSize = Math.min(currentChunkSize, remaining);

        try {
          const chunkResult = await this.readBlackboxChunk(bytesRead, requestSize);
          const chunk = chunkResult.data;
          if (chunkResult.isCompressed) {
            compressionDetected = true;
          }

          // Guard against 0-byte responses (FC returned empty data) — would cause infinite loop
          if (chunk.length === 0) {
            logger.warn(
              `FC returned 0 bytes at address ${bytesRead}, skipping ${requestSize} bytes`
            );
            bytesRead += requestSize;
            continue;
          }

          chunks.push(chunk);
          bytesRead += chunk.length;
          consecutiveSuccesses++;
          consecutiveFailures = 0;

          // After 50 successful chunks, cautiously try increasing chunk size by 10 bytes
          if (consecutiveSuccesses >= 50 && currentChunkSize < maxChunkSize) {
            const newSize = Math.min(currentChunkSize + 10, maxChunkSize);
            logger.info(`Increasing chunk size: ${currentChunkSize} → ${newSize} bytes`);
            currentChunkSize = newSize;
            consecutiveSuccesses = 0;
          }

          // Report progress
          if (onProgress) {
            const progress = Math.round((bytesRead / info.usedSize) * 100);
            onProgress(progress);

            // Log only at 5% intervals to reduce overhead
            if (progress % 5 === 0 && progress > 0) {
              logger.info(
                `Downloaded ${bytesRead}/${info.usedSize} bytes (${progress}%) - chunk size: ${currentChunkSize}B`
              );
            }
          }

          // Tiny delay to keep FC stable
          await new Promise((resolve) => setTimeout(resolve, 5));
        } catch (error) {
          // Chunk failed - reduce size and retry with recovery delay
          consecutiveFailures++;
          consecutiveSuccesses = 0;

          if (consecutiveFailures > 5) {
            // Too many failures, abort
            logger.error(
              `Too many consecutive failures (${consecutiveFailures}) at chunk size ${currentChunkSize}, aborting`
            );
            throw error;
          }

          // Reduce chunk size more conservatively
          const newSize = Math.max(Math.floor(currentChunkSize * 0.8), minChunkSize);
          logger.warn(
            `Chunk failed at size ${currentChunkSize} (failure ${consecutiveFailures}/5), reducing to ${newSize} bytes and retrying`
          );
          currentChunkSize = newSize;
          // Remember the ceiling — don't grow back above the failure point
          maxChunkSize = currentChunkSize;

          // Give FC time to recover after timeout (critical!)
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Don't increment bytesRead - retry same address
          continue;
        }
      }

      const fullLog = Buffer.concat(chunks);
      logger.info(
        `Blackbox download complete: ${fullLog.length} bytes (final chunk size: ${currentChunkSize}B)${compressionDetected ? ' — HUFFMAN COMPRESSION DETECTED' : ''}`
      );

      return { data: fullLog, compressionDetected };
    } catch (error) {
      logger.error('Failed to download Blackbox log:', error);
      throw error;
    }
  }

  /**
   * Erase all data from Blackbox flash storage
   * WARNING: This permanently deletes all logged flight data!
   */
  async eraseBlackboxFlash(): Promise<void> {
    if (!this.isConnected()) {
      throw new ConnectionError('Flight controller not connected');
    }

    try {
      logger.warn('Erasing Blackbox flash - all logged data will be permanently deleted');

      // Send erase command — some FCs respond immediately (async erase),
      // others block until done (can take 30-60s). We catch timeout and
      // poll MSP_DATAFLASH_SUMMARY to confirm erase completion.
      try {
        const response = await this.connection.sendCommand(
          MSPCommand.MSP_DATAFLASH_ERASE,
          Buffer.alloc(0),
          5000
        );
        if (response.error) {
          throw new MSPError('FC rejected erase command');
        }
        logger.info('Erase command acknowledged by FC');
      } catch (err) {
        if (err instanceof TimeoutError) {
          logger.info('Erase command sent (FC did not ACK — polling for completion)');
        } else {
          throw err;
        }
      }

      // Poll MSP_DATAFLASH_SUMMARY until usedSize === 0 (erase complete)
      const POLL_INTERVAL = 1000;
      const MAX_POLL_TIME = 60000;
      const start = Date.now();

      while (Date.now() - start < MAX_POLL_TIME) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));

        if (!this.isConnected()) {
          throw new ConnectionError('FC disconnected during erase');
        }

        try {
          const info = await this.getBlackboxInfo();
          if (info.usedSize === 0) {
            logger.info('Blackbox flash erased successfully (verified via poll)');
            return;
          }
          logger.debug(`Erase in progress: ${info.usedSize} bytes remaining`);
        } catch (pollError) {
          if (!this.connection.isOpen()) {
            throw new ConnectionError('FC disconnected during erase');
          }
          // FC may be busy erasing — ignore poll errors and retry
          logger.debug('Poll failed (FC busy), retrying...');
        }
      }

      throw new MSPError('Blackbox flash erase timed out after 60s');
    } catch (error) {
      logger.error('Failed to erase Blackbox flash:', error);
      throw error;
    }
  }

  private cleanCLIOutput(output: string): string {
    // Remove CLI prompt characters and clean up
    return output
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !trimmed.startsWith('#') && trimmed !== '#';
      })
      .join('\n')
      .trim();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
