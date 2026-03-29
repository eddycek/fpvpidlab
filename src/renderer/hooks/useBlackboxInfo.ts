import { useState, useEffect, useRef } from 'react';
import type { BlackboxInfo } from '@shared/types/blackbox.types';

export function useBlackboxInfo() {
  const [info, setInfo] = useState<BlackboxInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false); // Prevent concurrent requests

  const loadBlackboxInfo = async () => {
    // Prevent concurrent requests
    if (loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const blackboxInfo = await window.betaflight.getBlackboxInfo();
      // Guard: flash chip temporarily unreadable after erase — keep previous storage type.
      // Only for flash→none transition (SD card removal is a legitimate none).
      setInfo((prev) => {
        if (prev && prev.storageType === 'flash' && blackboxInfo.storageType === 'none') {
          return {
            ...prev,
            usedSize: 0,
            hasLogs: false,
            freeSize: prev.totalSize,
            usagePercent: 0,
          };
        }
        return blackboxInfo;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Blackbox info';
      setError(message);
      console.error('[useBlackboxInfo] Error:', err);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  // Auto-load on mount
  useEffect(() => {
    loadBlackboxInfo();
  }, []);

  // Refresh when FC reconnects (e.g. after snapshot reboot)
  useEffect(() => {
    return window.betaflight.onConnectionChanged((status) => {
      if (status.connected) {
        loadBlackboxInfo();
      }
    });
  }, []);

  return {
    info,
    loading,
    error,
    refresh: loadBlackboxInfo,
  };
}
