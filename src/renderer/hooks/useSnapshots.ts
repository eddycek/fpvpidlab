import { useState, useCallback, useEffect } from 'react';
import type { ConfigurationSnapshot, SnapshotMetadata } from '@shared/types/common.types';
import type { SnapshotRestoreResult } from '@shared/types/ipc.types';
import { useToast } from './useToast';

export function useSnapshots() {
  const [snapshots, setSnapshots] = useState<SnapshotMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const loadSnapshots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await window.betaflight.listSnapshots();
      setSnapshots(list);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const createSnapshot = useCallback(
    async (label?: string): Promise<ConfigurationSnapshot | null> => {
      setLoading(true);
      setError(null);
      try {
        const snapshot = await window.betaflight.createSnapshot(label);
        await loadSnapshots(); // Refresh list
        if (label) {
          toast.success(`Snapshot '${label}' created`);
        } else {
          toast.success('Snapshot created');
        }
        return snapshot;
      } catch (err: any) {
        const message = err.message || 'Failed to create snapshot';
        setError(message);
        toast.error(`Failed to create snapshot: ${message}`);
        return null;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadSnapshots]
  ); // toast is stable

  const deleteSnapshot = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        await window.betaflight.deleteSnapshot(id);
        await loadSnapshots(); // Refresh list
        toast.success('Snapshot deleted');
      } catch (err: any) {
        const message = err.message || 'Failed to delete snapshot';
        setError(message);
        toast.error(`Failed to delete snapshot: ${message}`);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadSnapshots]
  ); // toast is stable

  const restoreSnapshot = useCallback(
    async (id: string, createBackup: boolean): Promise<SnapshotRestoreResult | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.betaflight.restoreSnapshot(id, createBackup);
        toast.success(`Snapshot restored (${result.appliedCommands} settings applied)`);
        await loadSnapshots(); // Refresh list (backup snapshot may have been created)
        return result;
      } catch (err: any) {
        const message = err.message || 'Failed to restore snapshot';
        setError(message);
        toast.error(`Failed to restore snapshot: ${message}`);
        return null;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadSnapshots]
  ); // toast is stable

  const loadSnapshot = useCallback(async (id: string): Promise<ConfigurationSnapshot | null> => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await window.betaflight.loadSnapshot(id);
      return snapshot;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  // Refresh snapshots when connection changes
  useEffect(() => {
    const unsubscribe = window.betaflight.onConnectionChanged((status) => {
      if (status.connected) {
        // Wait a bit for baseline to be created, then refresh
        setTimeout(() => {
          loadSnapshots();
        }, 1000);
      } else {
        // Clear snapshots on disconnect
        setSnapshots([]);
      }
    });

    return unsubscribe;
  }, [loadSnapshots]);

  // Refresh snapshots when profile changes
  useEffect(() => {
    const unsubscribe = window.betaflight.onProfileChanged((profile) => {
      if (profile) {
        loadSnapshots();
      } else {
        // No profile, clear snapshots
        setSnapshots([]);
      }
    });

    return unsubscribe;
  }, [loadSnapshots]);

  return {
    snapshots,
    loading,
    error,
    createSnapshot,
    deleteSnapshot,
    restoreSnapshot,
    loadSnapshot,
    refreshSnapshots: loadSnapshots,
  };
}
