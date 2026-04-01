import { useState, useEffect, useCallback } from 'react';
import type { TuningSession, TuningPhase, TuningType } from '@shared/types/tuning.types';

export interface UseTuningSessionReturn {
  session: TuningSession | null;
  loading: boolean;
  startSession: (
    tuningType?: TuningType,
    bfPidProfileIndex?: number,
    reuseLogId?: string
  ) => Promise<void>;
  resetSession: () => Promise<void>;
  updatePhase: (phase: TuningPhase, data?: Partial<TuningSession>) => Promise<void>;
}

export function useTuningSession(): UseTuningSessionReturn {
  const [session, setSession] = useState<TuningSession | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const s = await window.betaflight.getTuningSession();
      setSession(s);
    } catch {
      // No session or not connected — that's fine
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load session on mount
  useEffect(() => {
    reload();
  }, [reload]);

  // Subscribe to session change events
  useEffect(() => {
    return window.betaflight.onTuningSessionChanged((updated) => {
      setSession(updated);
    });
  }, []);

  // Reload when profile changes (different FC connected)
  useEffect(() => {
    return window.betaflight.onProfileChanged(() => {
      reload();
    });
  }, [reload]);

  const startSession = useCallback(
    async (tuningType?: TuningType, bfPidProfileIndex?: number, reuseLogId?: string) => {
      const s = await window.betaflight.startTuningSession(
        tuningType,
        bfPidProfileIndex,
        reuseLogId
      );
      setSession(s);
    },
    []
  );

  const resetSession = useCallback(async () => {
    await window.betaflight.resetTuningSession();
    setSession(null);
  }, []);

  const updatePhase = useCallback(async (phase: TuningPhase, data?: Partial<TuningSession>) => {
    const s = await window.betaflight.updateTuningPhase(phase, data);
    setSession(s);
  }, []);

  return { session, loading, startSession, resetSession, updatePhase };
}
