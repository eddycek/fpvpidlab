import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useFCState } from './useFCState';
import type { FCState } from '@shared/types/fcState.types';
import { EMPTY_FC_STATE } from '@shared/types/fcState.types';

describe('useFCState', () => {
  const mockFCState: FCState = {
    info: {
      variant: 'BTFL',
      version: '4.5.1',
      target: 'STM32F405',
      boardName: 'OMNIBUSF4SD',
      apiVersion: { protocol: 0, major: 1, minor: 46 },
    },
    statusEx: { pidProfileIndex: 0, pidProfileCount: 4 },
    pidConfig: {
      roll: { P: 50, I: 88, D: 45 },
      pitch: { P: 52, I: 92, D: 48 },
      yaw: { P: 45, I: 90, D: 0 },
    },
    filterConfig: null,
    feedforwardConfig: null,
    ratesConfig: null,
    tuningConfig: null,
    blackboxInfo: {
      supported: true,
      storageType: 'flash',
      totalSize: 16777216,
      usedSize: 1048576,
      hasLogs: true,
      freeSize: 15728640,
      usagePercent: 6.25,
    },
    blackboxSettings: { debugMode: 'GYRO_SCALED', sampleRate: 0, loggingRateHz: 1000 },
    hydratedAt: '2026-04-06T12:00:00Z',
    hydrating: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty state initially', () => {
    vi.mocked(window.betaflight.getFCState).mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useFCState());

    expect(result.current).toEqual(EMPTY_FC_STATE);
  });

  it('hydrates from getFCState on mount', async () => {
    vi.mocked(window.betaflight.getFCState).mockResolvedValue(mockFCState);

    const { result } = renderHook(() => useFCState());

    await waitFor(() => {
      expect(result.current).toEqual(mockFCState);
    });

    expect(window.betaflight.getFCState).toHaveBeenCalledTimes(1);
  });

  it('updates on onFCStateChanged event', async () => {
    let changeCallback: ((state: FCState) => void) | undefined;

    vi.mocked(window.betaflight.getFCState).mockResolvedValue(null);
    vi.mocked(window.betaflight.onFCStateChanged).mockImplementation((cb) => {
      changeCallback = cb;
      return () => {};
    });

    const { result } = renderHook(() => useFCState());

    // Initially empty (getFCState returned null)
    await waitFor(() => {
      expect(result.current).toEqual(EMPTY_FC_STATE);
    });

    // Simulate state change event
    act(() => {
      changeCallback!(mockFCState);
    });

    await waitFor(() => {
      expect(result.current).toEqual(mockFCState);
    });
  });

  it('cleans up subscription on unmount', () => {
    const unsubscribe = vi.fn();
    vi.mocked(window.betaflight.getFCState).mockResolvedValue(null);
    vi.mocked(window.betaflight.onFCStateChanged).mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useFCState());

    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('live event takes precedence over stale getFCState', async () => {
    const liveState: FCState = {
      ...mockFCState,
      hydratedAt: '2026-04-06T13:00:00Z', // newer
    };

    let changeCallback: ((state: FCState) => void) | undefined;
    let resolveFetch: ((val: FCState | null) => void) | undefined;

    vi.mocked(window.betaflight.getFCState).mockImplementation(
      () =>
        new Promise<FCState | null>((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.mocked(window.betaflight.onFCStateChanged).mockImplementation((cb) => {
      changeCallback = cb;
      return () => {};
    });

    const { result } = renderHook(() => useFCState());

    // Live event arrives BEFORE fetch resolves
    act(() => {
      changeCallback!(liveState);
    });

    // Now resolve the older cached state
    act(() => {
      resolveFetch!(mockFCState);
    });

    // Should keep the live state, not the stale fetch
    await waitFor(() => {
      expect(result.current.hydratedAt).toBe('2026-04-06T13:00:00Z');
    });
  });

  it('handles getFCState rejection gracefully', async () => {
    vi.mocked(window.betaflight.getFCState).mockRejectedValue(new Error('Not connected'));

    const { result } = renderHook(() => useFCState());

    // Should remain empty on error — no crash
    await waitFor(() => {
      expect(result.current).toEqual(EMPTY_FC_STATE);
    });
  });
});
