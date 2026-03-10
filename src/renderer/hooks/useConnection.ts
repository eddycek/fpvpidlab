import { useState, useEffect, useCallback } from 'react';
import type { PortInfo, ConnectionStatus } from '@shared/types/common.types';
import { useToast } from './useToast';

// Global state for intentional disconnect (shared across all hook instances)
let globalIntentionalDisconnect = false;
let globalDisconnectToastShown = false;
let globalPreviouslyConnected = false;

// For testing: reset global state between tests
export function resetConnectionGlobalState() {
  globalIntentionalDisconnect = false;
  globalDisconnectToastShown = false;
  globalPreviouslyConnected = false;
}

// Mark next disconnect as intentional (e.g. before FC reboot after apply)
export function markIntentionalDisconnect() {
  globalIntentionalDisconnect = true;
}

export function useConnection() {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>({ connected: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    // Listen for connection changes
    const unsubscribe = window.betaflight.onConnectionChanged((newStatus) => {
      setStatus(newStatus);

      // Show toast on successful connection
      if (newStatus.connected && newStatus.fcInfo) {
        setError(null);
        toast.success(`Connected to ${newStatus.fcInfo.boardName}`);
        globalPreviouslyConnected = true;
        globalDisconnectToastShown = false; // Reset for next disconnect
        globalIntentionalDisconnect = false; // Reset on reconnection
      }

      // Show toast on disconnection (was connected, now not)
      // Only show once per disconnect event
      if (!newStatus.connected && globalPreviouslyConnected && !globalDisconnectToastShown) {
        if (globalIntentionalDisconnect) {
          // Intentional disconnect (button) - show info
          toast.info('Disconnected');
        } else {
          // Unexpected disconnect (USB unplugged) - show warning
          toast.warning('Flight controller disconnected unexpectedly');
        }
        globalPreviouslyConnected = false;
        globalDisconnectToastShown = true; // Prevent duplicate toasts
      }

      // Don't reset globalIntentionalDisconnect here - wait until reconnection

      // Show toast on error
      if (newStatus.error) {
        setError(newStatus.error);
        toast.error(newStatus.error);
      }
    });

    // Get initial status
    window.betaflight.getConnectionStatus().then((initialStatus) => {
      setStatus(initialStatus);
      globalPreviouslyConnected = initialStatus.connected;
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // toast functions are stable, no need in dependencies

  const scanPorts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const portList = await window.betaflight.listPorts();
      setPorts(portList);
    } catch (err: any) {
      const message = err.message || 'Failed to scan ports';
      setError(message);
      toast.error(`Failed to scan ports: ${message}`);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // toast is stable

  const connect = useCallback(async (portPath: string) => {
    setLoading(true);
    setError(null);
    try {
      await window.betaflight.connect(portPath);
    } catch (err: any) {
      const message = err.message || 'Failed to connect';
      setError(message);
      toast.error(`Failed to connect: ${message}`);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // toast is stable

  const disconnect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Mark as intentional disconnect so we show info instead of warning
      globalIntentionalDisconnect = true;
      await window.betaflight.disconnect();
      // Don't show toast here - event listener will handle it
    } catch (err: any) {
      const message = err.message || 'Failed to disconnect';
      setError(message);
      toast.error(`Failed to disconnect: ${message}`);
      globalIntentionalDisconnect = false; // Reset on error
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // toast is stable

  return {
    ports,
    status,
    loading,
    error,
    scanPorts,
    connect,
    disconnect,
  };
}
