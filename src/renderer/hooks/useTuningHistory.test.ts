import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTuningHistory } from './useTuningHistory';
import { TUNING_PHASE } from '@shared/constants';

describe('useTuningHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads history on mount', async () => {
    const mockRecords = [
      {
        id: 'r1',
        profileId: 'p1',
        startedAt: '2026-01-01',
        completedAt: '2026-01-01',
        appliedFilterChanges: [],
        appliedPIDChanges: [],
        appliedFeedforwardChanges: [],
        baselineSnapshotId: null,
        postFilterSnapshotId: null,
        postTuningSnapshotId: null,
        filterLogId: null,
        pidLogId: null,
        verificationLogId: null,
        filterMetrics: null,
        pidMetrics: null,
        verificationMetrics: null,
        quickLogId: null,
        transferFunctionMetrics: null,
      },
    ];
    vi.mocked(window.betaflight.getTuningHistory).mockResolvedValue(mockRecords);

    const { result } = renderHook(() => useTuningHistory());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.history).toEqual(mockRecords);
  });

  it('returns empty array on error', async () => {
    vi.mocked(window.betaflight.getTuningHistory).mockRejectedValue(new Error('fail'));

    const { result } = renderHook(() => useTuningHistory());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.history).toEqual([]);
  });

  it('reloads on profile change', async () => {
    vi.mocked(window.betaflight.getTuningHistory).mockResolvedValue([]);
    let profileCallback: ((p: any) => void) | undefined;
    vi.mocked(window.betaflight.onProfileChanged).mockImplementation((cb) => {
      profileCallback = cb;
      return () => {};
    });

    const { result } = renderHook(() => useTuningHistory());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(window.betaflight.getTuningHistory).toHaveBeenCalledTimes(1);

    // Simulate profile change
    profileCallback?.(null);

    await waitFor(() => {
      expect(window.betaflight.getTuningHistory).toHaveBeenCalledTimes(2);
    });
  });

  it('reloads when tuning session becomes null', async () => {
    vi.mocked(window.betaflight.getTuningHistory).mockResolvedValue([]);
    let sessionCallback: ((s: any) => void) | undefined;
    vi.mocked(window.betaflight.onTuningSessionChanged).mockImplementation((cb) => {
      sessionCallback = cb;
      return () => {};
    });

    const { result } = renderHook(() => useTuningHistory());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(window.betaflight.getTuningHistory).toHaveBeenCalledTimes(1);

    // Session dismissed (null)
    sessionCallback?.(null);

    await waitFor(() => {
      expect(window.betaflight.getTuningHistory).toHaveBeenCalledTimes(2);
    });
  });

  it('does not reload when session changes to non-null', async () => {
    vi.mocked(window.betaflight.getTuningHistory).mockResolvedValue([]);
    let sessionCallback: ((s: any) => void) | undefined;
    vi.mocked(window.betaflight.onTuningSessionChanged).mockImplementation((cb) => {
      sessionCallback = cb;
      return () => {};
    });

    const { result } = renderHook(() => useTuningHistory());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(window.betaflight.getTuningHistory).toHaveBeenCalledTimes(1);

    // Session updated (not null) — should NOT reload
    sessionCallback?.({ phase: TUNING_PHASE.FILTER_FLIGHT_PENDING });

    // Wait a tick and verify no extra call
    await new Promise((r) => setTimeout(r, 50));
    expect(window.betaflight.getTuningHistory).toHaveBeenCalledTimes(1);
  });
});
