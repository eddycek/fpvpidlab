import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSnapshots } from './useSnapshots';
import type {
  SnapshotMetadata,
  ConfigurationSnapshot,
  ConnectionStatus,
} from '@shared/types/common.types';
import type { DroneProfile } from '@shared/types/profile.types';
import type { SnapshotRestoreResult } from '@shared/types/ipc.types';

describe('useSnapshots', () => {
  const mockSnapshots: SnapshotMetadata[] = [
    {
      id: 'snapshot-1',
      timestamp: new Date('2024-01-01').toISOString(),
      label: 'Baseline',
      type: 'baseline',
      sizeBytes: 2048,
      fcInfo: {
        variant: 'BTFL',
        version: '4.4.0',
        boardName: 'MATEKF405',
      },
    },
    {
      id: 'snapshot-2',
      timestamp: new Date('2024-01-02').toISOString(),
      label: 'After tuning',
      type: 'manual',
      sizeBytes: 3072,
      fcInfo: {
        variant: 'BTFL',
        version: '4.4.0',
        boardName: 'MATEKF405',
      },
    },
  ];

  const mockFullSnapshot: ConfigurationSnapshot = {
    id: 'snapshot-1',
    timestamp: new Date('2024-01-01').toISOString(),
    label: 'Baseline',
    type: 'baseline',
    fcInfo: {
      variant: 'BTFL',
      version: '4.4.0',
      target: 'MATEKF405',
      boardName: 'MATEKF405',
      apiVersion: { protocol: 1, major: 12, minor: 0 },
    },
    configuration: {
      cliDiff: 'set motor_pwm_protocol = DSHOT600',
    },
    metadata: {
      appVersion: '0.1.0',
      createdBy: 'user',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(window.betaflight.listSnapshots).mockResolvedValue(mockSnapshots);
    vi.mocked(window.betaflight.createSnapshot).mockResolvedValue(mockFullSnapshot);
    vi.mocked(window.betaflight.loadSnapshot).mockResolvedValue(mockFullSnapshot);
    vi.mocked(window.betaflight.deleteSnapshot).mockResolvedValue(undefined);
    vi.mocked(window.betaflight.onConnectionChanged).mockReturnValue(() => {});
    vi.mocked(window.betaflight.onProfileChanged).mockReturnValue(() => {});
    vi.mocked(window.betaflight.restoreSnapshot).mockResolvedValue({
      success: true,
      backupSnapshotId: 'backup-1',
      appliedCommands: 3,
      rebooted: true,
    } as SnapshotRestoreResult);
  });

  it('loads snapshots on mount', async () => {
    const { result } = renderHook(() => useSnapshots());

    await waitFor(() => {
      expect(result.current.snapshots).toEqual(mockSnapshots);
    });

    expect(window.betaflight.listSnapshots).toHaveBeenCalled();
  });

  it('sets loading state while loading', async () => {
    vi.mocked(window.betaflight.listSnapshots).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockSnapshots), 100))
    );

    const { result } = renderHook(() => useSnapshots());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('creates snapshot successfully', async () => {
    const { result } = renderHook(() => useSnapshots());

    await waitFor(() => {
      expect(result.current.snapshots).toBeDefined();
    });

    const snapshot = await result.current.createSnapshot('My label');

    expect(snapshot).toEqual(mockFullSnapshot);
    expect(window.betaflight.createSnapshot).toHaveBeenCalledWith('My label');
  });

  it('creates snapshot without label', async () => {
    const { result } = renderHook(() => useSnapshots());

    await waitFor(() => {
      expect(result.current.snapshots).toBeDefined();
    });

    await result.current.createSnapshot();

    expect(window.betaflight.createSnapshot).toHaveBeenCalledWith(undefined);
  });

  it('refreshes snapshot list after creating', async () => {
    const { result } = renderHook(() => useSnapshots());

    await waitFor(() => {
      expect(window.betaflight.listSnapshots).toHaveBeenCalledTimes(1);
    });

    vi.mocked(window.betaflight.listSnapshots).mockClear();

    await result.current.createSnapshot('New snapshot');

    await waitFor(() => {
      expect(window.betaflight.listSnapshots).toHaveBeenCalledTimes(1);
    });
  });

  it('deletes snapshot successfully', async () => {
    const { result } = renderHook(() => useSnapshots());

    await waitFor(() => {
      expect(result.current.snapshots).toBeDefined();
    });

    await result.current.deleteSnapshot('snapshot-1');

    expect(window.betaflight.deleteSnapshot).toHaveBeenCalledWith('snapshot-1');
  });

  it('refreshes snapshot list after deleting', async () => {
    const { result } = renderHook(() => useSnapshots());

    await waitFor(() => {
      expect(window.betaflight.listSnapshots).toHaveBeenCalledTimes(1);
    });

    vi.mocked(window.betaflight.listSnapshots).mockClear();

    await result.current.deleteSnapshot('snapshot-1');

    await waitFor(() => {
      expect(window.betaflight.listSnapshots).toHaveBeenCalledTimes(1);
    });
  });

  it('loads snapshot by id', async () => {
    const { result } = renderHook(() => useSnapshots());

    const snapshot = await result.current.loadSnapshot('snapshot-1');

    expect(snapshot).toEqual(mockFullSnapshot);
    expect(window.betaflight.loadSnapshot).toHaveBeenCalledWith('snapshot-1');
  });

  it('sets error state when loading fails', async () => {
    const errorMessage = 'Failed to load snapshots';
    vi.mocked(window.betaflight.listSnapshots).mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useSnapshots());

    await waitFor(() => {
      expect(result.current.error).toBe(errorMessage);
    });
  });

  it('sets error state when create fails', async () => {
    const errorMessage = 'Failed to create snapshot';
    vi.mocked(window.betaflight.createSnapshot).mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useSnapshots());

    await waitFor(() => {
      expect(result.current.snapshots).toBeDefined();
    });

    const snapshot = await result.current.createSnapshot('Test');

    expect(snapshot).toBeNull();

    await waitFor(() => {
      expect(result.current.error).toBe(errorMessage);
    });
  });

  it('clears snapshots on disconnect', async () => {
    let connectionChangeCallback: ((status: ConnectionStatus) => void) | null = null;

    vi.mocked(window.betaflight.onConnectionChanged).mockImplementation(((
      callback: (status: ConnectionStatus) => void
    ) => {
      connectionChangeCallback = callback;
      return () => {};
    }) as any);

    const { result } = renderHook(() => useSnapshots());

    await waitFor(() => {
      expect(result.current.snapshots).toEqual(mockSnapshots);
    });

    // Trigger disconnect
    connectionChangeCallback!({ connected: false });

    await waitFor(() => {
      expect(result.current.snapshots).toEqual([]);
    });
  });

  it('reloads snapshots when connection established', async () => {
    let connectionChangeCallback: ((status: ConnectionStatus) => void) | null = null;

    vi.mocked(window.betaflight.onConnectionChanged).mockImplementation(((
      callback: (status: ConnectionStatus) => void
    ) => {
      connectionChangeCallback = callback;
      return () => {};
    }) as any);

    renderHook(() => useSnapshots());

    await waitFor(() => {
      expect(window.betaflight.listSnapshots).toHaveBeenCalledTimes(1);
    });

    vi.mocked(window.betaflight.listSnapshots).mockClear();

    // Trigger connect
    connectionChangeCallback!({ connected: true, portPath: '/dev/ttyUSB0' });

    await waitFor(
      () => {
        expect(window.betaflight.listSnapshots).toHaveBeenCalled();
      },
      { timeout: 2000 }
    );
  });

  it('clears snapshots when no profile selected', async () => {
    let profileChangeCallback: ((profile: DroneProfile | null) => void) | null = null;

    vi.mocked(window.betaflight.onProfileChanged).mockImplementation(((
      callback: (profile: DroneProfile | null) => void
    ) => {
      profileChangeCallback = callback;
      return () => {};
    }) as any);

    const { result } = renderHook(() => useSnapshots());

    await waitFor(() => {
      expect(result.current.snapshots).toEqual(mockSnapshots);
    });

    // Trigger no profile
    profileChangeCallback!(null);

    await waitFor(() => {
      expect(result.current.snapshots).toEqual([]);
    });
  });

  it('reloads snapshots when profile changes', async () => {
    let profileChangeCallback: ((profile: DroneProfile | null) => void) | null = null;

    vi.mocked(window.betaflight.onProfileChanged).mockImplementation(((
      callback: (profile: DroneProfile | null) => void
    ) => {
      profileChangeCallback = callback;
      return () => {};
    }) as any);

    renderHook(() => useSnapshots());

    await waitFor(() => {
      expect(window.betaflight.listSnapshots).toHaveBeenCalledTimes(1);
    });

    vi.mocked(window.betaflight.listSnapshots).mockClear();

    const newProfile: DroneProfile = {
      id: 'profile-2',
      name: 'New Profile',
      fcSerialNumber: 'XYZ789',
      size: '5"',
      battery: '6S',
      weight: 650,
      flightStyle: 'balanced',
      motorKV: 1950,
      propSize: '5.1"',
      snapshotIds: [],
      connectionCount: 1,
      lastConnected: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fcInfo: {
        variant: 'BTFL',
        version: '4.4.0',
        target: 'MATEKF405',
        boardName: 'MATEKF405',
        apiVersion: { protocol: 1, major: 12, minor: 0 },
      },
    };

    // Trigger profile change
    profileChangeCallback!(newProfile);

    await waitFor(
      () => {
        expect(window.betaflight.listSnapshots).toHaveBeenCalled();
      },
      { timeout: 1000 }
    );
  });

  it('subscribes to connection changes', () => {
    renderHook(() => useSnapshots());

    expect(window.betaflight.onConnectionChanged).toHaveBeenCalled();
  });

  it('subscribes to profile changes', () => {
    renderHook(() => useSnapshots());

    expect(window.betaflight.onProfileChanged).toHaveBeenCalled();
  });

  // Restore tests
  it('restoreSnapshot calls API and returns result', async () => {
    const { result } = renderHook(() => useSnapshots());

    await waitFor(() => {
      expect(result.current.snapshots).toBeDefined();
    });

    const restoreResult = await result.current.restoreSnapshot('snapshot-1', true);

    expect(window.betaflight.restoreSnapshot).toHaveBeenCalledWith('snapshot-1', true);
    expect(restoreResult).toEqual({
      success: true,
      backupSnapshotId: 'backup-1',
      appliedCommands: 3,
      rebooted: true,
    });
  });

  it('restoreSnapshot handles error and returns null', async () => {
    vi.mocked(window.betaflight.restoreSnapshot).mockRejectedValue(
      new Error('Snapshot contains no restorable settings')
    );

    const { result } = renderHook(() => useSnapshots());

    await waitFor(() => {
      expect(result.current.snapshots).toBeDefined();
    });

    const restoreResult = await result.current.restoreSnapshot('snapshot-1', true);

    expect(restoreResult).toBeNull();

    await waitFor(() => {
      expect(result.current.error).toBe('Snapshot contains no restorable settings');
    });
  });

  it('restoreSnapshot refreshes snapshot list after success', async () => {
    const { result } = renderHook(() => useSnapshots());

    await waitFor(() => {
      expect(window.betaflight.listSnapshots).toHaveBeenCalledTimes(1);
    });

    vi.mocked(window.betaflight.listSnapshots).mockClear();

    await result.current.restoreSnapshot('snapshot-1', true);

    await waitFor(() => {
      expect(window.betaflight.listSnapshots).toHaveBeenCalledTimes(1);
    });
  });
});
