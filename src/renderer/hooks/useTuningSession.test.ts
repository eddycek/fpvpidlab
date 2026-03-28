import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTuningSession } from './useTuningSession';
import type { TuningSession } from '@shared/types/tuning.types';
import { TUNING_PHASE, TUNING_TYPE } from '@shared/constants';

const mockSession: TuningSession = {
  profileId: 'profile-1',
  phase: TUNING_PHASE.FILTER_FLIGHT_PENDING,
  tuningType: TUNING_TYPE.FILTER,
  startedAt: '2026-02-10T10:00:00Z',
  updatedAt: '2026-02-10T10:00:00Z',
};

describe('useTuningSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads session on mount', async () => {
    vi.mocked(window.betaflight.getTuningSession).mockResolvedValue(mockSession);

    const { result } = renderHook(() => useTuningSession());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.session).toEqual(mockSession);
  });

  it('sets loading to false when no session exists', async () => {
    vi.mocked(window.betaflight.getTuningSession).mockResolvedValue(null);

    const { result } = renderHook(() => useTuningSession());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.session).toBeNull();
  });

  it('handles load error gracefully', async () => {
    vi.mocked(window.betaflight.getTuningSession).mockRejectedValue(new Error('Not connected'));

    const { result } = renderHook(() => useTuningSession());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.session).toBeNull();
  });

  it('subscribes to session change events', async () => {
    vi.mocked(window.betaflight.getTuningSession).mockResolvedValue(null);

    let eventCallback: ((session: TuningSession | null) => void) | undefined;
    vi.mocked(window.betaflight.onTuningSessionChanged).mockImplementation((cb) => {
      eventCallback = cb;
      return () => {};
    });

    const { result } = renderHook(() => useTuningSession());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(eventCallback).toBeDefined();

    // Simulate event from main process
    act(() => {
      eventCallback!(mockSession);
    });

    expect(result.current.session).toEqual(mockSession);
  });

  it('startSession calls IPC and updates state', async () => {
    vi.mocked(window.betaflight.getTuningSession).mockResolvedValue(null);
    vi.mocked(window.betaflight.startTuningSession).mockResolvedValue(mockSession);

    const { result } = renderHook(() => useTuningSession());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.startSession();
    });

    expect(window.betaflight.startTuningSession).toHaveBeenCalled();
    expect(result.current.session).toEqual(mockSession);
  });

  it('resetSession calls IPC and clears state', async () => {
    vi.mocked(window.betaflight.getTuningSession).mockResolvedValue(mockSession);
    vi.mocked(window.betaflight.resetTuningSession).mockResolvedValue(undefined);

    const { result } = renderHook(() => useTuningSession());

    await waitFor(() => {
      expect(result.current.session).toEqual(mockSession);
    });

    await act(async () => {
      await result.current.resetSession();
    });

    expect(window.betaflight.resetTuningSession).toHaveBeenCalled();
    expect(result.current.session).toBeNull();
  });

  it('updatePhase calls IPC and updates state', async () => {
    vi.mocked(window.betaflight.getTuningSession).mockResolvedValue(mockSession);

    const updatedSession: TuningSession = {
      ...mockSession,
      phase: TUNING_PHASE.FILTER_LOG_READY,
      filterLogId: 'log-42',
      updatedAt: '2026-02-10T11:00:00Z',
    };
    vi.mocked(window.betaflight.updateTuningPhase).mockResolvedValue(updatedSession);

    const { result } = renderHook(() => useTuningSession());

    await waitFor(() => {
      expect(result.current.session).toEqual(mockSession);
    });

    await act(async () => {
      await result.current.updatePhase(TUNING_PHASE.FILTER_LOG_READY, { filterLogId: 'log-42' });
    });

    expect(window.betaflight.updateTuningPhase).toHaveBeenCalledWith(
      TUNING_PHASE.FILTER_LOG_READY,
      { filterLogId: 'log-42' }
    );
    expect(result.current.session).toEqual(updatedSession);
  });

  it('cleans up event subscription on unmount', async () => {
    vi.mocked(window.betaflight.getTuningSession).mockResolvedValue(null);

    const cleanup = vi.fn();
    vi.mocked(window.betaflight.onTuningSessionChanged).mockReturnValue(cleanup);

    const { unmount } = renderHook(() => useTuningSession());

    await waitFor(() => {
      expect(window.betaflight.onTuningSessionChanged).toHaveBeenCalled();
    });

    unmount();

    expect(cleanup).toHaveBeenCalled();
  });

  it('reloads session when profile changes', async () => {
    // Start with session from profile A
    vi.mocked(window.betaflight.getTuningSession).mockResolvedValue(mockSession);

    let profileCallback: ((p: any) => void) | undefined;
    vi.mocked(window.betaflight.onProfileChanged).mockImplementation((cb) => {
      profileCallback = cb;
      return () => {};
    });

    const { result } = renderHook(() => useTuningSession());

    await waitFor(() => {
      expect(result.current.session).toEqual(mockSession);
    });
    expect(window.betaflight.getTuningSession).toHaveBeenCalledTimes(1);

    // Profile changes to B (no session)
    vi.mocked(window.betaflight.getTuningSession).mockResolvedValue(null);
    profileCallback?.(null);

    await waitFor(() => {
      expect(result.current.session).toBeNull();
    });
    expect(window.betaflight.getTuningSession).toHaveBeenCalledTimes(2);
  });

  it('reloads session when switching to profile with active session', async () => {
    // Start with no session
    vi.mocked(window.betaflight.getTuningSession).mockResolvedValue(null);

    let profileCallback: ((p: any) => void) | undefined;
    vi.mocked(window.betaflight.onProfileChanged).mockImplementation((cb) => {
      profileCallback = cb;
      return () => {};
    });

    const { result } = renderHook(() => useTuningSession());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.session).toBeNull();

    // Profile changes to one with active session
    const sessionB: TuningSession = {
      profileId: 'profile-2',
      phase: TUNING_PHASE.PID_FLIGHT_PENDING,
      tuningType: TUNING_TYPE.PID,
      startedAt: '2026-02-11T10:00:00Z',
      updatedAt: '2026-02-11T10:00:00Z',
    };
    vi.mocked(window.betaflight.getTuningSession).mockResolvedValue(sessionB);
    profileCallback?.({ id: 'profile-2' });

    await waitFor(() => {
      expect(result.current.session).toEqual(sessionB);
    });
  });
});
