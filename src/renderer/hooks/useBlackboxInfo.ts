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
      setInfo(blackboxInfo);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load Blackbox info';
      setError(message);
      console.error('[useBlackboxInfo] Error:', err);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  // Auto-load on mount only
  useEffect(() => {
    loadBlackboxInfo();
  }, []); // Empty deps - only run once on mount

  return {
    info,
    loading,
    error,
    refresh: loadBlackboxInfo,
  };
}
