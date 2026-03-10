import { useState, useEffect, useCallback } from 'react';
import type {
  DroneProfile,
  DroneProfileMetadata,
  ProfileCreationInput,
  ProfileUpdateInput,
} from '@shared/types/profile.types';
import { useToast } from './useToast';

export function useProfiles() {
  const [profiles, setProfiles] = useState<DroneProfileMetadata[]>([]);
  const [currentProfile, setCurrentProfile] = useState<DroneProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const loadProfiles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await window.betaflight.listProfiles();
      setProfiles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profiles');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCurrentProfile = useCallback(async () => {
    try {
      const profile = await window.betaflight.getCurrentProfile();
      setCurrentProfile(profile);
    } catch (err) {
      console.error('Failed to load current profile:', err);
    }
  }, []);

  const createProfile = useCallback(
    async (input: ProfileCreationInput): Promise<DroneProfile> => {
      try {
        setLoading(true);
        setError(null);
        const profile = await window.betaflight.createProfile(input);
        await loadProfiles();
        setCurrentProfile(profile);
        toast.success(`Profile '${profile.name}' created`);
        return profile;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create profile';
        setError(message);
        toast.error(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadProfiles]
  );

  const createProfileFromPreset = useCallback(
    async (presetId: string, customName?: string): Promise<DroneProfile> => {
      try {
        setLoading(true);
        setError(null);
        const profile = await window.betaflight.createProfileFromPreset(presetId, customName);
        await loadProfiles();
        setCurrentProfile(profile);
        toast.success(`Profile '${profile.name}' created`);
        return profile;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create profile from preset';
        setError(message);
        toast.error(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadProfiles]
  );

  const updateProfile = useCallback(
    async (id: string, updates: ProfileUpdateInput): Promise<DroneProfile> => {
      try {
        setLoading(true);
        setError(null);
        const profile = await window.betaflight.updateProfile(id, updates);
        await loadProfiles();
        if (currentProfile?.id === id) {
          setCurrentProfile(profile);
        }
        toast.success('Profile updated');
        return profile;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update profile';
        setError(message);
        toast.error(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadProfiles, currentProfile]
  );

  const deleteProfile = useCallback(
    async (id: string): Promise<void> => {
      try {
        setLoading(true);
        setError(null);
        await window.betaflight.deleteProfile(id);
        await loadProfiles();
        if (currentProfile?.id === id) {
          setCurrentProfile(null);
        }
        toast.success('Profile deleted');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete profile';
        setError(message);
        toast.error(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadProfiles, currentProfile]
  );

  const setAsCurrentProfile = useCallback(
    async (id: string): Promise<DroneProfile> => {
      try {
        setLoading(true);
        setError(null);
        const profile = await window.betaflight.setCurrentProfile(id);
        setCurrentProfile(profile);
        await loadProfiles();
        toast.info(`Switched to profile '${profile.name}'`);
        return profile;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to set current profile';
        setError(message);
        toast.error(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadProfiles]
  );

  const getProfile = useCallback(async (id: string): Promise<DroneProfile | null> => {
    try {
      return await window.betaflight.getProfile(id);
    } catch (err) {
      console.error('Failed to get profile:', err);
      return null;
    }
  }, []);

  const exportProfile = useCallback(async (id: string, filePath: string): Promise<void> => {
    try {
      await window.betaflight.exportProfile(id, filePath);
      toast.success('Profile exported successfully');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export profile';
      setError(message);
      toast.error(message);
      throw new Error(message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // toast is stable

  useEffect(() => {
    loadProfiles();
    loadCurrentProfile();

    // Listen for profile changes
    const unsubscribe = window.betaflight.onProfileChanged((profile) => {
      setCurrentProfile(profile);
      loadProfiles();
    });

    return unsubscribe;
  }, [loadProfiles, loadCurrentProfile]);

  return {
    profiles,
    currentProfile,
    loading,
    error,
    loadProfiles,
    createProfile,
    createProfileFromPreset,
    updateProfile,
    deleteProfile,
    setAsCurrentProfile,
    getProfile,
    exportProfile,
  };
}
