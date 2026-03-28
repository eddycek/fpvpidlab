import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProfiles } from './useProfiles';
import type { DroneProfile, DroneProfileMetadata } from '@shared/types/profile.types';

describe('useProfiles', () => {
  const mockProfiles: DroneProfileMetadata[] = [
    {
      id: 'profile-1',
      name: '5" Freestyle',
      fcSerialNumber: 'ABC123',
      size: '5"',
      battery: '4S',
      connectionCount: 10,
      lastConnected: new Date().toISOString(),
    },
    {
      id: 'profile-2',
      name: 'Tiny Whoop',
      fcSerialNumber: 'DEF456',
      size: '1"',
      battery: '1S',
      connectionCount: 5,
      lastConnected: new Date().toISOString(),
    },
  ];

  const mockFullProfile: DroneProfile = {
    ...mockProfiles[0],
    weight: 650,
    flightStyle: 'balanced',
    motorKV: 2400,
    propSize: '5.1"',
    snapshotIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fcInfo: {
      variant: 'BTFL',
      version: '4.4.0',
      target: 'STM32F405',
      boardName: 'BETAFLIGHTF4',
      apiVersion: { protocol: 0, major: 1, minor: 46 },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(window.betaflight.listProfiles).mockResolvedValue(mockProfiles);
    vi.mocked(window.betaflight.getCurrentProfile).mockResolvedValue(mockFullProfile);
    vi.mocked(window.betaflight.onProfileChanged).mockReturnValue(() => {});
  });

  it('loads profiles on mount', async () => {
    const { result } = renderHook(() => useProfiles());

    await waitFor(() => {
      expect(result.current.profiles).toEqual(mockProfiles);
    });

    expect(window.betaflight.listProfiles).toHaveBeenCalled();
  });

  it('loads current profile on mount', async () => {
    const { result } = renderHook(() => useProfiles());

    await waitFor(() => {
      expect(result.current.currentProfile).toEqual(mockFullProfile);
    });

    expect(window.betaflight.getCurrentProfile).toHaveBeenCalled();
  });

  it('subscribes to profile changes on mount', () => {
    renderHook(() => useProfiles());

    expect(window.betaflight.onProfileChanged).toHaveBeenCalled();
  });

  it('sets loading state while loading', async () => {
    vi.mocked(window.betaflight.listProfiles).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockProfiles), 100))
    );

    const { result } = renderHook(() => useProfiles());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('creates profile successfully', async () => {
    vi.mocked(window.betaflight.createProfile).mockResolvedValue(mockFullProfile);

    const { result } = renderHook(() => useProfiles());

    await waitFor(() => {
      expect(result.current.profiles).toBeDefined();
    });

    const input = {
      fcSerialNumber: 'ABC123',
      fcInfo: {
        variant: 'BTFL',
        version: '4.4.0',
        target: 'STM32F405',
        boardName: 'BETAFLIGHTF4',
        apiVersion: { protocol: 0, major: 1, minor: 46 },
      },
      name: 'New Profile',
      size: '5"' as const,
      battery: '6S' as const,
      weight: 650,
      flightStyle: 'balanced' as const,
      motorKV: 1950,
      propSize: '5.1"',
    };

    const profile = await result.current.createProfile(input);

    expect(profile).toEqual(mockFullProfile);
    expect(window.betaflight.createProfile).toHaveBeenCalledWith(input);
  });

  it('creates profile from preset', async () => {
    vi.mocked(window.betaflight.createProfileFromPreset).mockResolvedValue(mockFullProfile);

    const { result } = renderHook(() => useProfiles());

    await waitFor(() => {
      expect(result.current.profiles).toBeDefined();
    });

    const profile = await result.current.createProfileFromPreset(
      '5inch-freestyle',
      'My Custom Name'
    );

    expect(profile).toEqual(mockFullProfile);
    expect(window.betaflight.createProfileFromPreset).toHaveBeenCalledWith(
      '5inch-freestyle',
      'My Custom Name'
    );
  });

  it('updates profile successfully', async () => {
    const updatedProfile = { ...mockFullProfile, name: 'Updated Name' };
    vi.mocked(window.betaflight.updateProfile).mockResolvedValue(updatedProfile);

    const { result } = renderHook(() => useProfiles());

    await waitFor(() => {
      expect(result.current.currentProfile).toEqual(mockFullProfile);
    });

    const updates = { name: 'Updated Name' };
    const profile = await result.current.updateProfile('profile-1', updates);

    expect(profile).toEqual(updatedProfile);
    expect(window.betaflight.updateProfile).toHaveBeenCalledWith('profile-1', updates);
  });

  it('deletes profile successfully', async () => {
    vi.mocked(window.betaflight.deleteProfile).mockResolvedValue(undefined);

    const { result } = renderHook(() => useProfiles());

    await waitFor(() => {
      expect(result.current.profiles).toBeDefined();
    });

    await result.current.deleteProfile('profile-2');

    expect(window.betaflight.deleteProfile).toHaveBeenCalledWith('profile-2');
  });

  it('clears current profile when deleted profile is current', async () => {
    vi.mocked(window.betaflight.deleteProfile).mockResolvedValue(undefined);

    const { result } = renderHook(() => useProfiles());

    await waitFor(() => {
      expect(result.current.currentProfile).toEqual(mockFullProfile);
    });

    await result.current.deleteProfile('profile-1');

    await waitFor(() => {
      expect(result.current.currentProfile).toBeNull();
    });
  });

  it('sets profile as current', async () => {
    vi.mocked(window.betaflight.setCurrentProfile).mockResolvedValue(mockFullProfile);

    const { result } = renderHook(() => useProfiles());

    await waitFor(() => {
      expect(result.current.profiles).toBeDefined();
    });

    const profile = await result.current.setAsCurrentProfile('profile-1');

    expect(profile).toEqual(mockFullProfile);
    expect(window.betaflight.setCurrentProfile).toHaveBeenCalledWith('profile-1');
  });

  it('gets profile by id', async () => {
    vi.mocked(window.betaflight.getProfile).mockResolvedValue(mockFullProfile);

    const { result } = renderHook(() => useProfiles());

    const profile = await result.current.getProfile('profile-1');

    expect(profile).toEqual(mockFullProfile);
    expect(window.betaflight.getProfile).toHaveBeenCalledWith('profile-1');
  });

  it('exports profile', async () => {
    vi.mocked(window.betaflight.exportProfile).mockResolvedValue(undefined);

    const { result } = renderHook(() => useProfiles());

    await result.current.exportProfile('profile-1', '/path/to/export');

    expect(window.betaflight.exportProfile).toHaveBeenCalledWith('profile-1', '/path/to/export');
  });

  it('sets error state when loading fails', async () => {
    const errorMessage = 'Failed to load';
    vi.mocked(window.betaflight.listProfiles).mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useProfiles());

    await waitFor(() => {
      expect(result.current.error).toBe(errorMessage);
    });
  });

  it('sets error state when create fails', async () => {
    const errorMessage = 'Failed to create';
    vi.mocked(window.betaflight.createProfile).mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useProfiles());

    await waitFor(() => {
      expect(result.current.profiles).toBeDefined();
    });

    const input = {
      fcSerialNumber: 'ABC123',
      fcInfo: {
        variant: 'BTFL',
        version: '4.4.0',
        target: 'STM32F405',
        boardName: 'BETAFLIGHTF4',
        apiVersion: { protocol: 0, major: 1, minor: 46 },
      },
      name: 'New Profile',
      size: '5"' as const,
      battery: '6S' as const,
      weight: 650,
      flightStyle: 'balanced' as const,
      motorKV: 1950,
      propSize: '5.1"',
    };

    await expect(result.current.createProfile(input)).rejects.toThrow(errorMessage);

    await waitFor(() => {
      expect(result.current.error).toBe(errorMessage);
    });
  });

  it('reloads profiles when profile changed event fires', async () => {
    let profileChangeCallback: ((profile: DroneProfile | null) => void) | null = null;

    vi.mocked(window.betaflight.onProfileChanged).mockImplementation(((
      callback: (profile: DroneProfile | null) => void
    ) => {
      profileChangeCallback = callback;
      return () => {};
    }) as any);

    renderHook(() => useProfiles());

    await waitFor(() => {
      expect(window.betaflight.listProfiles).toHaveBeenCalledTimes(1);
    });

    // Clear mock calls
    vi.mocked(window.betaflight.listProfiles).mockClear();

    // Trigger profile change
    const newProfile = { ...mockFullProfile, name: 'Changed Profile' };
    profileChangeCallback!(newProfile);

    await waitFor(() => {
      expect(window.betaflight.listProfiles).toHaveBeenCalledTimes(1);
    });
  });
});
