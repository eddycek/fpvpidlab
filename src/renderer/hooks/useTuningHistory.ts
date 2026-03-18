import { useState, useEffect, useCallback } from 'react';
import type { CompletedTuningRecord } from '@shared/types/tuning-history.types';

export interface UseTuningHistoryReturn {
  history: CompletedTuningRecord[];
  loading: boolean;
  reload: () => Promise<void>;
}

export function useTuningHistory(): UseTuningHistoryReturn {
  const [history, setHistory] = useState<CompletedTuningRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const records = await window.betaflight.getTuningHistory();
      setHistory(records);
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    reload();
  }, [reload]);

  // Reload when profile changes
  useEffect(() => {
    return window.betaflight.onProfileChanged(() => {
      reload();
    });
  }, [reload]);

  // Reload when tuning session changes (may have just completed)
  useEffect(() => {
    return window.betaflight.onTuningSessionChanged((session) => {
      if (session === null || session?.phase === 'completed') {
        // Session completed or dismissed — history may have been updated
        reload();
      }
    });
  }, [reload]);

  return { history, loading, reload };
}
