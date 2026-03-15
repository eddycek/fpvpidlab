declare const __APP_VERSION__: string;
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';

export const MSP = {
  DEFAULT_BAUD_RATE: 115200,
  CONNECTION_TIMEOUT: 5000,
  COMMAND_TIMEOUT: 2000,
  RECONNECT_ATTEMPTS: 5,
  RECONNECT_INTERVAL: 2000,
  REBOOT_WAIT_TIME: 3000,
} as const;

export const BETAFLIGHT = {
  VENDOR_IDS: ['0x0483', '0x2E8A'], // STM32, RP2040
  VARIANT: 'BTFL',
  /** Minimum supported BF version (API 1.44) */
  MIN_VERSION: '4.3.0',
  /** Minimum supported API version (major.minor) */
  MIN_API_VERSION: { major: 1, minor: 44 },
} as const;

export const SNAPSHOT = {
  BASELINE_LABEL: 'Baseline',
  STORAGE_DIR: 'data/snapshots',
} as const;

export const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
} as const;

export const PROFILE = {
  STORAGE_DIR: 'data/profiles',
  PROFILES_FILE: 'profiles.json',
} as const;

// Default values based on drone size
export const SIZE_DEFAULTS = {
  '1"': { weight: 25, motorKV: 19000, battery: '1S' as const, propSize: '31mm' },
  '2"': { weight: 50, motorKV: 8000, battery: '1S' as const, propSize: '40mm' },
  '2.5"': { weight: 120, motorKV: 3000, battery: '3S' as const, propSize: '2.5"' },
  '3"': { weight: 180, motorKV: 3000, battery: '4S' as const, propSize: '3"' },
  '4"': { weight: 350, motorKV: 2650, battery: '4S' as const, propSize: '4"' },
  '5"': { weight: 650, motorKV: 2400, battery: '4S' as const, propSize: '5.1"' },
  '6"': { weight: 800, motorKV: 2000, battery: '6S' as const, propSize: '6"' },
  '7"': { weight: 900, motorKV: 1800, battery: '6S' as const, propSize: '7"' },
  '10"': { weight: 1500, motorKV: 1400, battery: '6S' as const, propSize: '10"' },
} as const;

/**
 * Tuning session type constants.
 * Names use user-facing terminology; values are serialized strings.
 */
export const TUNING_TYPE = {
  /** Filter Tune — filter-only session (hover + throttle sweeps) */
  FILTER: 'filter' as const,
  /** PID Tune — PID-only session (stick snaps) */
  PID: 'pid' as const,
  /** Flash Tune — 1-flight session via Wiener deconvolution */
  FLASH: 'quick' as const,
};

/**
 * Wizard operating mode constants.
 * Controls which analysis steps the wizard shows.
 */
export const TUNING_MODE = {
  FILTER: 'filter' as const,
  PID: 'pid' as const,
  FULL: 'full' as const,
  /** Flash Tune wizard mode — combined filter + transfer function analysis */
  FLASH: 'quick' as const,
};

/**
 * Tuning phase constants — state machine phases for tuning sessions.
 * Filter Tune (filter_*), PID Tune (pid_*), and Flash Tune (quick_*).
 */
export const TUNING_PHASE = {
  // Filter Tune phases
  FILTER_FLIGHT_PENDING: 'filter_flight_pending' as const,
  FILTER_LOG_READY: 'filter_log_ready' as const,
  FILTER_ANALYSIS: 'filter_analysis' as const,
  FILTER_APPLIED: 'filter_applied' as const,
  FILTER_VERIFICATION_PENDING: 'filter_verification_pending' as const,
  // PID Tune phases
  PID_FLIGHT_PENDING: 'pid_flight_pending' as const,
  PID_LOG_READY: 'pid_log_ready' as const,
  PID_ANALYSIS: 'pid_analysis' as const,
  PID_APPLIED: 'pid_applied' as const,
  PID_VERIFICATION_PENDING: 'pid_verification_pending' as const,
  // Flash Tune phases
  QUICK_FLIGHT_PENDING: 'quick_flight_pending' as const,
  QUICK_LOG_READY: 'quick_log_ready' as const,
  QUICK_ANALYSIS: 'quick_analysis' as const,
  QUICK_APPLIED: 'quick_applied' as const,
  // Shared phases
  VERIFICATION_PENDING: 'verification_pending' as const,
  COMPLETED: 'completed' as const,
};

/** Display labels for tuning types — single source of truth */
export const TUNING_TYPE_LABELS: Record<string, string> = {
  [TUNING_TYPE.FILTER]: 'Filter Tune',
  [TUNING_TYPE.PID]: 'PID Tune',
  [TUNING_TYPE.FLASH]: 'Flash Tune',
};

export const LICENSE = {
  /** Production license API endpoint */
  API_URL: 'https://license.pidlab.app',
  /** Development license API endpoint (CF Workers subdomain — update after first deploy) */
  API_URL_DEV: 'https://pidlab-license-dev.eddycek.workers.dev',
  /** Key format regex: PIDLAB-XXXX-XXXX-XXXX (28-char alphabet) */
  KEY_FORMAT_REGEX: /^PIDLAB-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/,
  /** Ed25519 public key (base64 SPKI DER) for offline license verification.
   *  MUST match the ED25519_PUBLIC_KEY secret on the license CF Worker.
   *  On key rotation: update this value, deploy app, then rotate worker secret.
   *  Generated with: infrastructure/scripts/generate-ed25519-keypair.sh */
  ED25519_PUBLIC_KEY: 'MCowBQYDK2VwAyEAPhSegGVFCNCs5ZIb0StMdy10gs7QaW3oRls1XGTbZB8=',
  /** Free tier: max 1 profile */
  FREE_PROFILE_LIMIT: 1,
  /** Online validation interval (24 hours) */
  VALIDATION_INTERVAL_MS: 24 * 60 * 60 * 1000,
} as const;

export const TELEMETRY = {
  /** Production telemetry endpoint */
  UPLOAD_URL: 'https://telemetry.pidlab.app/v1/collect',
  /** Development telemetry endpoint (CF Workers subdomain — update after first deploy) */
  UPLOAD_URL_DEV: 'https://pidlab-telemetry-dev.eddycek.workers.dev/v1/collect',
  /** Retry delays in ms for failed uploads */
  RETRY_DELAYS: [1000, 2000, 4000] as readonly number[],
  /** Minimum interval between automatic uploads (24 hours) */
  HEARTBEAT_INTERVAL_MS: 24 * 60 * 60 * 1000,
  /** Stale threshold — skip upload if last one was within this window */
  STALE_THRESHOLD_MS: 23 * 60 * 60 * 1000,
} as const;

// Helper to build preset from SIZE_DEFAULTS with overrides
import type { DroneSize, FlightStyle } from './types/profile.types';

function preset(
  size: DroneSize,
  name: string,
  description: string,
  flightStyle: FlightStyle,
  overrides?: Record<string, unknown>
) {
  return { ...SIZE_DEFAULTS[size], size, name, description, flightStyle, ...overrides };
}

// Preset profiles — values derived from SIZE_DEFAULTS, only overrides where different
export const PRESET_PROFILES = {
  'tiny-whoop': preset('1"', 'Tiny Whoop (1")', 'Ultra micro indoor whoop, 1S battery', 'balanced'),
  'micro-whoop': preset(
    '2"',
    'Micro Whoop (2")',
    'Micro whoop for indoor flying, 1S battery',
    'balanced'
  ),
  '3inch-cinewhoop': preset(
    '3"',
    '3" Cinewhoop',
    'Indoor/cinematic whoop with ducted props',
    'smooth'
  ),
  '4inch-toothpick': preset(
    '4"',
    '4" Toothpick',
    'Lightweight 4 inch toothpick for indoor/outdoor',
    'balanced',
    { battery: '3S' as const, weight: 300, motorKV: 2800 }
  ),
  '5inch-freestyle': preset(
    '5"',
    '5" Freestyle',
    'Standard 5 inch freestyle quad with balanced tuning',
    'balanced'
  ),
  '5inch-race': preset(
    '5"',
    '5" Race',
    'Lightweight 5 inch racing quad with aggressive tuning',
    'aggressive',
    { propSize: '5"', weight: 580, motorKV: 2650 }
  ),
  '5inch-cinematic': preset(
    '5"',
    '5" Cinematic',
    'Heavy cinematic quad with GoPro, smooth tuning',
    'smooth',
    { battery: '6S' as const, weight: 750, motorKV: 1960 }
  ),
  '6inch-longrange': preset('6"', '6" Long Range', 'Mid-range cruiser with 6S power', 'smooth'),
  '7inch-longrange': preset(
    '7"',
    '7" Long Range',
    'Long range cruiser with smooth flight characteristics',
    'smooth'
  ),
  '10inch-ultra-longrange': preset(
    '10"',
    '10" Ultra Long Range',
    'Ultra long range platform for exploration',
    'smooth'
  ),
};
