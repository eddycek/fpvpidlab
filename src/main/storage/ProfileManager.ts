/**
 * ProfileManager
 *
 * Business logic for managing drone profiles.
 */

import { v4 as uuidv4 } from 'uuid';
import { ProfileStorage } from './ProfileStorage';
import type {
  DroneProfile,
  DroneProfileMetadata,
  ProfileCreationInput,
  ProfileUpdateInput,
  PresetProfile,
} from '@shared/types/profile.types';
import { logger } from '../utils/logger';

export class ProfileManager {
  private storage: ProfileStorage;
  private currentProfileId: string | null = null;

  constructor(storagePath: string) {
    this.storage = new ProfileStorage(storagePath);
  }

  async initialize(): Promise<void> {
    await this.storage.ensureDirectory();
    logger.info('ProfileManager initialized');
  }

  /**
   * Create a new profile
   */
  async createProfile(input: ProfileCreationInput): Promise<DroneProfile> {
    const now = new Date().toISOString();

    const profile: DroneProfile = {
      id: uuidv4(),
      fcSerialNumber: input.fcSerialNumber,

      // Required fields
      name: input.name,
      size: input.size,
      battery: input.battery,
      weight: input.weight,
      flightStyle: input.flightStyle,

      // Optional fields
      propSize: input.propSize,
      motorKV: input.motorKV,
      notes: input.notes || '',

      // Auto-detected
      fcInfo: input.fcInfo,

      // Metadata
      createdAt: now,
      updatedAt: now,
      lastConnected: now,
      connectionCount: 1,

      // Snapshots
      snapshotIds: [],
      baselineSnapshotId: undefined,
    };

    await this.storage.saveProfile(profile);
    this.currentProfileId = profile.id;

    logger.info(`Profile created: ${profile.id} (${profile.name})`);
    return profile;
  }

  /**
   * Create profile from preset
   */
  async createProfileFromPreset(
    preset: PresetProfile,
    fcSerialNumber: string,
    fcInfo: any,
    customName?: string
  ): Promise<DroneProfile> {
    const input: ProfileCreationInput = {
      fcSerialNumber,
      fcInfo,
      name: customName || preset.name,
      size: preset.size,
      propSize: preset.propSize,
      battery: preset.battery,
      weight: preset.weight,
      flightStyle: preset.flightStyle,
      motorKV: preset.motorKV,
      notes: preset.notes,
    };

    return this.createProfile(input);
  }

  /**
   * Update an existing profile
   */
  async updateProfile(id: string, updates: ProfileUpdateInput): Promise<DroneProfile> {
    const profile = await this.storage.loadProfile(id);
    if (!profile) {
      throw new Error(`Profile ${id} not found`);
    }

    const updatedProfile: DroneProfile = {
      ...profile,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.saveProfile(updatedProfile);
    logger.info(`Profile updated: ${id}`);

    return updatedProfile;
  }

  /**
   * Delete a profile and all its snapshots
   */
  async deleteProfile(id: string): Promise<void> {
    // Get profile to find associated snapshots
    const profile = await this.storage.loadProfile(id);
    if (!profile) {
      throw new Error(`Profile ${id} not found`);
    }

    // If deleting current profile, clear it
    const wasActive = id === this.currentProfileId;
    if (wasActive) {
      this.currentProfileId = null;
      logger.info(`Cleared current profile as it's being deleted: ${id}`);
    }

    // Delete the profile
    await this.storage.deleteProfile(id);

    logger.info(
      `Profile deleted: ${id} (snapshots: ${profile.snapshotIds.length}, wasActive: ${wasActive})`
    );
  }

  /**
   * Get all profiles
   */
  async listProfiles(): Promise<DroneProfileMetadata[]> {
    const profiles = await this.storage.loadProfiles();

    return Object.values(profiles).map((profile) => ({
      id: profile.id,
      fcSerialNumber: profile.fcSerialNumber,
      name: profile.name,
      size: profile.size,
      battery: profile.battery,
      lastConnected: profile.lastConnected,
      connectionCount: profile.connectionCount,
    }));
  }

  /**
   * Get a single profile
   */
  async getProfile(id: string): Promise<DroneProfile | null> {
    return this.storage.loadProfile(id);
  }

  /**
   * Find profile by FC serial number
   */
  async findProfileBySerial(fcSerialNumber: string): Promise<DroneProfile | null> {
    return this.storage.findProfileBySerial(fcSerialNumber);
  }

  /**
   * Set current profile (when FC connects)
   */
  async setCurrentProfile(id: string): Promise<DroneProfile> {
    const profile = await this.storage.loadProfile(id);
    if (!profile) {
      throw new Error(`Profile ${id} not found`);
    }

    // Update last connected and connection count
    const updatedProfile = await this.updateProfile(id, {
      lastConnected: new Date().toISOString(),
    });

    // Increment connection count
    updatedProfile.connectionCount++;
    await this.storage.saveProfile(updatedProfile);

    this.currentProfileId = id;
    logger.info(`Current profile set: ${id} (${profile.name})`);

    return updatedProfile;
  }

  /**
   * Get current profile ID
   */
  getCurrentProfileId(): string | null {
    return this.currentProfileId;
  }

  /**
   * Get current profile
   */
  async getCurrentProfile(): Promise<DroneProfile | null> {
    if (!this.currentProfileId) {
      return null;
    }
    return this.storage.loadProfile(this.currentProfileId);
  }

  /**
   * Clear current profile (used when FC is disconnected)
   */
  clearCurrentProfile(): void {
    this.currentProfileId = null;
  }

  /**
   * Link snapshot to profile
   */
  async linkSnapshot(
    profileId: string,
    snapshotId: string,
    isBaseline: boolean = false
  ): Promise<void> {
    const profile = await this.storage.loadProfile(profileId);
    if (!profile) {
      throw new Error(`Profile ${profileId} not found`);
    }

    if (!profile.snapshotIds.includes(snapshotId)) {
      profile.snapshotIds.push(snapshotId);
    }

    if (isBaseline) {
      profile.baselineSnapshotId = snapshotId;
    }

    profile.updatedAt = new Date().toISOString();
    await this.storage.saveProfile(profile);

    logger.info(`Snapshot ${snapshotId} linked to profile ${profileId}`);
  }

  /**
   * Unlink snapshot from profile
   */
  async unlinkSnapshot(profileId: string, snapshotId: string): Promise<void> {
    const profile = await this.storage.loadProfile(profileId);
    if (!profile) {
      throw new Error(`Profile ${profileId} not found`);
    }

    profile.snapshotIds = profile.snapshotIds.filter((id) => id !== snapshotId);

    if (profile.baselineSnapshotId === snapshotId) {
      profile.baselineSnapshotId = undefined;
    }

    profile.updatedAt = new Date().toISOString();
    await this.storage.saveProfile(profile);

    logger.info(`Snapshot ${snapshotId} unlinked from profile ${profileId}`);
  }

  /**
   * Export profile
   */
  async exportProfile(id: string, filePath: string): Promise<void> {
    await this.storage.exportProfile(id, filePath);
  }
}
