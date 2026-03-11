/**
 * Storage type for blackbox logging
 */
export type BlackboxStorageType = 'flash' | 'sdcard' | 'none';

/**
 * SD card state as reported by MSP_SDCARD_SUMMARY
 */
export enum SDCardState {
  NOT_PRESENT = 0,
  FATAL = 1,
  CARD_INIT = 2,
  FS_INIT = 3,
  READY = 4,
}

/**
 * SD card info from MSP_SDCARD_SUMMARY
 */
export interface SDCardInfo {
  supported: boolean;
  state: SDCardState;
  lastError: number;
  freeSizeKB: number;
  totalSizeKB: number;
}

/**
 * Blackbox storage information (flash or SD card)
 */
export interface BlackboxInfo {
  /** Whether Blackbox is supported on this FC */
  supported: boolean;
  /** Storage type: 'flash' for onboard SPI flash, 'sdcard' for onboard SD card, 'none' if unsupported */
  storageType: BlackboxStorageType;
  /** Total storage size in bytes (0 if no storage) */
  totalSize: number;
  /** Used storage size in bytes */
  usedSize: number;
  /** Whether storage has any logs */
  hasLogs: boolean;
  /** Free space in bytes */
  freeSize: number;
  /** Usage percentage (0-100) */
  usagePercent: number;
}

/**
 * Blackbox configuration settings (unused — retained for future MSP-based reading)
 */
export interface BlackboxConfig {
  /** Logging rate divisor (1 = full rate, 2 = half rate, etc.) */
  rateDivisor: number;
  /** Debug mode for logging */
  debugMode: BlackboxDebugMode;
  /** Fields to log */
  fields: number;
}

/**
 * Blackbox settings read from FC via CLI for pre-flight diagnostics.
 * Used by FCInfoDisplay to show whether the FC is configured correctly for analysis.
 */
export interface BlackboxSettings {
  /** Debug mode name as string, e.g. "GYRO_SCALED", "NONE" */
  debugMode: string;
  /** Blackbox sample rate index (0=1:1, 1=1:2, 2=1:4, 3=1:8) */
  sampleRate: number;
  /** Computed effective logging rate in Hz */
  loggingRateHz: number;
}

/**
 * Blackbox debug modes for specialized logging
 */
export enum BlackboxDebugMode {
  NONE = 0,
  CYCLETIME = 1,
  BATTERY = 2,
  GYRO_FILTERED = 3,
  ACCELEROMETER = 4,
  PIDLOOP = 5,
  GYRO_SCALED = 6,
  RC_INTERPOLATION = 7,
  ANGLERATE = 8,
  ESC_SENSOR = 9,
  SCHEDULER = 10,
  STACK = 11,
  ESC_SENSOR_RPM = 12,
  ESC_SENSOR_TMP = 13,
  ALTITUDE = 14,
  FFT = 15,
  FFT_TIME = 16,
  FFT_FREQ = 17,
  RX_FRSKY_SPI = 18,
  RX_SFHSS_SPI = 19,
  GYRO_RAW = 20,
  DUAL_GYRO_COMBINED = 21,
  DUAL_GYRO_DIFF = 22,
  MAX7456_SIGNAL = 23,
  MAX7456_SPICLOCK = 24,
  SBUS = 25,
  FPORT = 26,
  RANGEFINDER = 27,
  RANGEFINDER_QUALITY = 28,
  LIDAR_TF = 29,
  ADC_INTERNAL = 30,
  RUNAWAY_TAKEOFF = 31,
  SDIO = 32,
  CURRENT_SENSOR = 33,
  USB = 34,
  SMARTAUDIO = 35,
  RTH = 36,
  ITERM_RELAX = 37,
  ACRO_TRAINER = 38,
  RC_SMOOTHING = 39,
  RX_SIGNAL_LOSS = 40,
  RC_SMOOTHING_RATE = 41,
  ANTI_GRAVITY = 42,
  DYN_LPF = 43,
  RX_SPEKTRUM_SPI = 44,
  DSHOT_RPM_TELEMETRY = 45,
  RPM_FILTER = 46,
  D_MIN = 47,
  AC_CORRECTION = 48,
  AC_ERROR = 49,
  DUAL_GYRO_RAW = 50,
  DSHOT_RPM_ERRORS = 51,
  CRSF_LINK_STATISTICS_UPLINK = 52,
  CRSF_LINK_STATISTICS_PWR = 53,
  CRSF_LINK_STATISTICS_DOWN = 54,
  BARO = 55,
  GPS_RESCUE_THROTTLE_PID = 56,
  DYN_IDLE = 57,
  FF_LIMIT = 58,
  FF_INTERPOLATED = 59,
  BLACKBOX_OUTPUT = 60,
  GYRO_SAMPLE = 61,
  RX_TIMING = 62,
}

/**
 * Blackbox log download progress
 */
export interface BlackboxDownloadProgress {
  /** Downloaded bytes */
  downloaded: number;
  /** Total bytes to download */
  total: number;
  /** Progress percentage (0-100) */
  percent: number;
  /** Estimated time remaining in seconds */
  estimatedSecondsRemaining?: number;
}

/**
 * Metadata for a saved Blackbox log file
 */
export interface BlackboxLogMetadata {
  /** Unique log ID */
  id: string;
  /** Profile this log belongs to */
  profileId: string;
  /** FC serial number */
  fcSerial: string;
  /** Download timestamp (ISO format) */
  timestamp: string;
  /** Log filename */
  filename: string;
  /** Full filepath on disk */
  filepath: string;
  /** Log size in bytes */
  size: number;
  /** FC info at time of download */
  fcInfo: {
    variant: string;
    version: string;
    target: string;
  };
  /** Whether Huffman compression was detected during download (data unusable without decompression) */
  compressionDetected?: boolean;
}

// ============================================================
// Blackbox Binary Log Parser Types
// ============================================================

/**
 * BBL encoding types for field values.
 * Each encoding defines how raw bytes are decoded into integer values.
 *
 * Values match Betaflight standard encoding IDs used in BBL binary headers.
 * Reference: betaflight/src/main/blackbox/blackbox.h
 */
export enum BBLEncoding {
  /** Signed variable-byte encoding */
  SIGNED_VB = 0,
  /** Unsigned variable-byte encoding */
  UNSIGNED_VB = 1,
  /** Negative 14-bit encoding (value = -signedVB - 1) */
  NEG_14BIT = 3,
  /** Tag byte (8 bits) + up to 8 signed variable-byte values */
  TAG8_8SVB = 6,
  /** Tag2 (top 2 bits) + 3 packed signed values */
  TAG2_3S32 = 7,
  /** Tag8 (2 bits per value) + 4 signed values (v1: 4/8/16-bit, v2: 8/16/VB) */
  TAG8_4S16 = 8,
  /** Null encoding - always returns zero, reads no bytes */
  NULL = 9,
  /** Tag2 (top 2 bits) + 3 variable-width signed values */
  TAG2_3SVARIABLE = 10,
}

/**
 * BBL predictor types for delta decompression.
 * Predictors define the baseline value that deltas are applied to.
 */
export enum BBLPredictor {
  /** Predicted value is 0 (absolute encoding) */
  ZERO = 0,
  /** Predicted value is the previous frame's value */
  PREVIOUS = 1,
  /** Predicted value extrapolates linearly from last 2 values */
  STRAIGHT_LINE = 2,
  /** Predicted value is the average of last 2 values */
  AVERAGE_2 = 3,
  /** Predicted value is minthrottle from header */
  MINTHROTTLE = 4,
  /** Predicted value is motor[0] from same frame */
  MOTOR_0 = 5,
  /** Predicted value increments by 1 each frame (for loopIteration) */
  INCREMENT = 6,
  /** Predicted value is home coordinate from header (GPS) */
  HOME_COORD = 7,
  /** Predicted value is 1500 (servo center, not used for quads) */
  SERVO_CENTER = 8,
  /** Predicted value is vbatref * 100 from header */
  VBATREF = 9,
}

/**
 * Frame type markers in BBL binary data
 */
export enum BBLFrameType {
  /** Intra frame - contains absolute values */
  INTRA = 'I',
  /** Inter frame - contains delta values relative to previous */
  INTER = 'P',
  /** GPS home frame */
  GPS_HOME = 'H',
  /** GPS frame */
  GPS = 'G',
  /** Slow (auxiliary) frame */
  SLOW = 'S',
  /** Event frame */
  EVENT = 'E',
}

/**
 * Definition of a single field in a BBL log
 */
export interface BBLFieldDefinition {
  /** Field name (e.g. "gyroADC[0]", "motor[0]") */
  name: string;
  /** Encoding type for this field */
  encoding: BBLEncoding;
  /** Predictor type for this field */
  predictor: BBLPredictor;
  /** Whether the field value is signed */
  signed: boolean;
}

/**
 * Parsed header information from a BBL log session
 */
export interface BBLLogHeader {
  /** Product name (e.g. "Blackbox flight data recorder by Nicholas Sherlock") */
  product: string;
  /** Data version (e.g. 2) */
  dataVersion: number;
  /** Firmware type (e.g. "Cleanflight", "Betaflight") */
  firmwareType: string;
  /** Firmware revision string */
  firmwareRevision: string;
  /** Firmware date */
  firmwareDate: string;
  /** Board information string */
  boardInformation: string;
  /** Log start datetime */
  logStartDatetime: string;
  /** Craft name */
  craftName: string;

  /** I-frame field definitions */
  iFieldDefs: BBLFieldDefinition[];
  /** P-frame field definitions */
  pFieldDefs: BBLFieldDefinition[];
  /** S-frame (slow) field definitions */
  sFieldDefs: BBLFieldDefinition[];
  /** G-frame (GPS) field definitions */
  gFieldDefs: BBLFieldDefinition[];

  /** I-frame interval (how many loop iterations between I-frames) */
  iInterval: number;
  /** P-frame interval numerator */
  pInterval: number;
  /** P-frame interval denominator */
  pDenom: number;

  /** Minimum throttle value (for MINTHROTTLE predictor) */
  minthrottle: number;
  /** Maximum throttle value */
  maxthrottle: number;
  /** Motor output range */
  motorOutputRange: number;
  /** Voltage battery reference in 0.01V (for VBATREF predictor) */
  vbatref: number;
  /** Main loop time in microseconds */
  looptime: number;
  /** Gyro scale factor */
  gyroScale: number;

  /** Raw header key-value pairs for any additional metadata */
  rawHeaders: Map<string, string>;
}

/**
 * A single decoded frame of BBL data
 */
export interface BBLFrame {
  /** Frame type */
  type: BBLFrameType;
  /** Decoded field values (parallel array with field definitions) */
  values: number[];
  /** Frame byte offset in the file (for debugging) */
  offset: number;
}

/**
 * Time series data for a single signal channel
 */
export interface TimeSeries {
  /** Timestamps in seconds from start of log */
  time: Float64Array;
  /** Signal values */
  values: Float64Array;
}

/**
 * Extracted flight data from a parsed BBL log session.
 * Contains the key signals needed for PID/filter analysis.
 */
export interface BlackboxFlightData {
  /** Gyro ADC readings [roll, pitch, yaw] in deg/s */
  gyro: [TimeSeries, TimeSeries, TimeSeries];
  /** RC command setpoints [roll, pitch, yaw, throttle] */
  setpoint: [TimeSeries, TimeSeries, TimeSeries, TimeSeries];
  /** PID P-term [roll, pitch, yaw] */
  pidP: [TimeSeries, TimeSeries, TimeSeries];
  /** PID I-term [roll, pitch, yaw] */
  pidI: [TimeSeries, TimeSeries, TimeSeries];
  /** PID D-term [roll, pitch, yaw] */
  pidD: [TimeSeries, TimeSeries, TimeSeries];
  /** PID F-term (feedforward) [roll, pitch, yaw] - may be zero-filled if not logged */
  pidF: [TimeSeries, TimeSeries, TimeSeries];
  /** Motor outputs [0, 1, 2, 3] */
  motor: [TimeSeries, TimeSeries, TimeSeries, TimeSeries];
  /** Debug values (up to 8 channels) */
  debug: TimeSeries[];

  /** Effective sample rate in Hz */
  sampleRateHz: number;
  /** Total flight duration in seconds */
  durationSeconds: number;
  /** Total number of decoded frames */
  frameCount: number;
}

/**
 * A single parsed log session within a BBL file.
 * A BBL file may contain multiple sessions (multiple flights).
 */
export interface BlackboxLogSession {
  /** Session index (0-based) */
  index: number;
  /** Parsed header metadata */
  header: BBLLogHeader;
  /** Extracted flight data time series */
  flightData: BlackboxFlightData;
  /** Number of corrupted frames that were skipped */
  corruptedFrameCount: number;
  /** Non-fatal warnings encountered during parsing */
  warnings: string[];
}

/**
 * Complete result of parsing a BBL file
 */
export interface BlackboxParseResult {
  /** Parsed log sessions */
  sessions: BlackboxLogSession[];
  /** Original file size in bytes */
  fileSize: number;
  /** Time taken to parse in milliseconds */
  parseTimeMs: number;
  /** Whether parsing succeeded (at least one session) */
  success: boolean;
  /** Error message if parsing failed completely */
  error?: string;
}

/**
 * Progress information during BBL parsing
 */
export interface BlackboxParseProgress {
  /** Bytes processed so far */
  bytesProcessed: number;
  /** Total file size in bytes */
  totalBytes: number;
  /** Progress percentage (0-100) */
  percent: number;
  /** Index of the session currently being parsed */
  currentSession: number;
}
