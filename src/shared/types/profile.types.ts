/**
 * Drone Profile Types
 *
 * Type definitions for the multi-drone profile system.
 */

import type { FCInfo } from './common.types';

// ============================================================================
// Enums
// ============================================================================

export type DroneSize = '1"' | '2.5"' | '3"' | '4"' | '5"' | '6"' | '7"';
export type BatteryType = '1S' | '2S' | '3S' | '4S' | '6S';

/**
 * Flying style preference — affects PID tuning thresholds.
 * - smooth: cinematic, long-range (minimize overshoot, maximize smoothness)
 * - balanced: freestyle, general flying (default)
 * - aggressive: racing, acro (maximize response, tolerate overshoot)
 */
export type FlightStyle = 'smooth' | 'balanced' | 'aggressive';

// ============================================================================
// Profile Interfaces
// ============================================================================

/**
 * Required fields for drone profile
 */
export interface DroneProfileRequired {
  name: string;
  size: DroneSize;
  battery: BatteryType;
  weight: number; // AUW in grams
  flightStyle: FlightStyle;
}

/**
 * Optional fields for drone profile
 */
export interface DroneProfileOptional {
  propSize?: string;
  motorKV?: number;
  notes?: string;
  lastConnected?: string;
  bfPidProfileIndex?: number; // preferred BF PID profile (0-based), undefined = FC default
  bfPidProfileLabels?: Record<number, string>; // user labels: {0: "Stock", 1: "Tuned"}
}

/**
 * Complete drone profile
 */
export interface DroneProfile extends DroneProfileRequired, DroneProfileOptional {
  // Unique identifiers
  id: string; // UUID for profile
  fcSerialNumber: string; // FC serial number (unique drone ID)

  // Auto-detected from FC
  fcInfo: FCInfo;

  // Metadata
  createdAt: string;
  updatedAt: string;
  lastConnected: string;
  connectionCount: number;

  // Links to snapshots
  snapshotIds: string[];
  baselineSnapshotId?: string;
}

/**
 * Profile metadata (lightweight version for lists)
 */
export interface DroneProfileMetadata {
  id: string;
  fcSerialNumber: string;
  name: string;
  size: DroneSize;
  battery: BatteryType;
  lastConnected: string;
  connectionCount: number;
}

/**
 * Preset profile template
 */
export interface PresetProfile extends DroneProfileRequired, DroneProfileOptional {
  description: string;
}

/**
 * Default values for drone size
 */
export interface DroneSizeDefaults {
  weight: number;
  motorKV: number;
  battery: BatteryType;
  propSize: string;
}

/**
 * Profile creation input (from wizard)
 */
export interface ProfileCreationInput extends DroneProfileRequired, DroneProfileOptional {
  fcSerialNumber: string;
  fcInfo: FCInfo;
}

/**
 * Profile update input
 */
export interface ProfileUpdateInput extends Partial<DroneProfileRequired>, DroneProfileOptional {
  // All fields optional for updates
}
