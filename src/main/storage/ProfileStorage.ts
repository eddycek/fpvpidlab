/**
 * ProfileStorage
 *
 * Handles file operations for drone profiles (JSON storage).
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import type { DroneProfile } from '@shared/types/profile.types';
import { logger } from '../utils/logger';

export class ProfileStorage {
  private storagePath: string;
  private profilesFile: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.profilesFile = join(storagePath, 'profiles.json');
  }

  /**
   * Ensure storage directory exists
   */
  async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.storagePath, { recursive: true });

      // Initialize profiles file if it doesn't exist
      try {
        await fs.access(this.profilesFile);
      } catch {
        await fs.writeFile(this.profilesFile, JSON.stringify({ profiles: {} }, null, 2));
      }
    } catch (error) {
      logger.error('Failed to ensure profile directory:', error);
      throw error;
    }
  }

  /**
   * Load all profiles
   */
  async loadProfiles(): Promise<Record<string, DroneProfile>> {
    try {
      const data = await fs.readFile(this.profilesFile, 'utf-8');
      const parsed = JSON.parse(data);
      return parsed.profiles || {};
    } catch (error) {
      logger.error('Failed to load profiles:', error);
      return {};
    }
  }

  /**
   * Save a profile
   */
  async saveProfile(profile: DroneProfile): Promise<void> {
    try {
      const profiles = await this.loadProfiles();
      profiles[profile.id] = profile;

      await fs.writeFile(this.profilesFile, JSON.stringify({ profiles }, null, 2));

      logger.info(`Profile saved: ${profile.id} (${profile.name})`);
    } catch (error) {
      logger.error('Failed to save profile:', error);
      throw error;
    }
  }

  /**
   * Load a single profile by ID
   */
  async loadProfile(id: string): Promise<DroneProfile | null> {
    try {
      const profiles = await this.loadProfiles();
      return profiles[id] || null;
    } catch (error) {
      logger.error(`Failed to load profile ${id}:`, error);
      return null;
    }
  }

  /**
   * Delete a profile
   */
  async deleteProfile(id: string): Promise<void> {
    try {
      const profiles = await this.loadProfiles();
      delete profiles[id];

      await fs.writeFile(this.profilesFile, JSON.stringify({ profiles }, null, 2));

      logger.info(`Profile deleted: ${id}`);
    } catch (error) {
      logger.error('Failed to delete profile:', error);
      throw error;
    }
  }

  /**
   * Find profile by FC serial number
   */
  async findProfileBySerial(fcSerialNumber: string): Promise<DroneProfile | null> {
    try {
      const profiles = await this.loadProfiles();

      for (const profile of Object.values(profiles)) {
        if (profile.fcSerialNumber === fcSerialNumber) {
          return profile;
        }
      }

      return null;
    } catch (error) {
      logger.error('Failed to find profile by serial:', error);
      return null;
    }
  }

  /**
   * Export profile to file
   */
  async exportProfile(id: string, filePath: string): Promise<void> {
    try {
      const profile = await this.loadProfile(id);
      if (!profile) {
        throw new Error(`Profile ${id} not found`);
      }

      await fs.writeFile(filePath, JSON.stringify(profile, null, 2));

      logger.info(`Profile exported: ${id} to ${filePath}`);
    } catch (error) {
      logger.error('Failed to export profile:', error);
      throw error;
    }
  }
}
