/** A single axis PID term (0-255 range) */
export interface PIDTerm {
  P: number;
  I: number;
  D: number;
}

/** PID term extended with feedforward gain */
export interface PIDFTerm extends PIDTerm {
  F: number;
}

/** PID configuration for all axes */
export interface PIDConfiguration {
  roll: PIDTerm;
  pitch: PIDTerm;
  yaw: PIDTerm;
}

/** Rate type as reported by Betaflight (MSP_RC_TUNING byte 22, BF 4.3+) */
export type RatesType = 'BETAFLIGHT' | 'RACEFLIGHT' | 'KISS' | 'ACTUAL' | 'QUICK';

/** Per-axis rate values */
export interface AxisRates {
  rcRate: number;
  rate: number;
  rcExpo: number;
  rateLimit: number;
}

/** RC rates configuration from MSP_RC_TUNING (BF 4.3+, API 1.44+) */
export interface RatesConfiguration {
  ratesType: RatesType;
  roll: AxisRates;
  pitch: AxisRates;
  yaw: AxisRates;
}

/** Feedforward configuration from MSP_PID_ADVANCED (BF 4.3+, API 1.44+) */
export interface FeedforwardConfiguration {
  /** Center-stick FF attenuation (0-100) */
  transition: number;
  /** Per-axis FF gains */
  rollGain: number;
  pitchGain: number;
  yawGain: number;
  /** Stick acceleration component (default 15) */
  boost: number;
  /** FF smoothing (default 37) */
  smoothFactor: number;
  /** Dynamic attenuation for slow inputs (default 7) */
  jitterFactor: number;
  /** Predictive overshoot prevention (default 100) */
  maxRateLimit: number;
}
