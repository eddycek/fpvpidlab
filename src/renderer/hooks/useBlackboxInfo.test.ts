import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBlackboxInfo } from './useBlackboxInfo';
import type { BlackboxInfo } from '@shared/types/blackbox.types';

describe('useBlackboxInfo', () => {
  const mockBlackboxInfo: BlackboxInfo = {
    supported: true,
    storageType: 'flash',
    totalSize: 16777216,
    usedSize: 1048576,
    hasLogs: true,
    freeSize: 15728640,
    usagePercent: 6.25,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with null info, loading false, and no error', () => {
    // Mock to prevent auto-load on mount
    vi.mocked(window.betaflight.getBlackboxInfo).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const { result } = renderHook(() => useBlackboxInfo());

    expect(result.current.info).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('auto-loads blackbox info on mount', async () => {
    vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfo);

    const { result } = renderHook(() => useBlackboxInfo());

    await waitFor(() => {
      expect(result.current.info).toEqual(mockBlackboxInfo);
    });

    expect(window.betaflight.getBlackboxInfo).toHaveBeenCalled();
  });

  it('returns blackbox info on success', async () => {
    vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfo);

    const { result } = renderHook(() => useBlackboxInfo());

    await waitFor(() => {
      expect(result.current.info).toEqual(mockBlackboxInfo);
      expect(result.current.error).toBeNull();
    });
  });

  it('sets error on API failure', async () => {
    const errorMessage = 'Failed to load Blackbox info';
    vi.mocked(window.betaflight.getBlackboxInfo).mockRejectedValue(new Error(errorMessage));

    const { result } = renderHook(() => useBlackboxInfo());

    await waitFor(() => {
      expect(result.current.error).toBe(errorMessage);
    });
  });

  it('refresh() reloads blackbox data', async () => {
    vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfo);

    const { result } = renderHook(() => useBlackboxInfo());

    await waitFor(() => {
      expect(result.current.info).toEqual(mockBlackboxInfo);
    });

    // Clear and call refresh
    vi.mocked(window.betaflight.getBlackboxInfo).mockClear();

    const updatedInfo: BlackboxInfo = {
      ...mockBlackboxInfo,
      usedSize: 2097152, // Different value
    };
    vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(updatedInfo);

    await result.current.refresh();

    await waitFor(() => {
      expect(result.current.info).toEqual(updatedInfo);
    });

    expect(window.betaflight.getBlackboxInfo).toHaveBeenCalled();
  });

  it('prevents concurrent requests with loadingRef guard', async () => {
    let resolveFirst: ((value: BlackboxInfo) => void) | undefined;
    const firstPromise = new Promise<BlackboxInfo>((resolve) => {
      resolveFirst = resolve;
    });

    vi.mocked(window.betaflight.getBlackboxInfo).mockReturnValue(firstPromise);

    const { result } = renderHook(() => useBlackboxInfo());

    // First call should be in progress
    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    // Second call should be ignored (loadingRef guard)
    const secondCall = result.current.refresh();

    // Verify only one API call was made
    expect(window.betaflight.getBlackboxInfo).toHaveBeenCalledTimes(1);

    // Resolve first request
    resolveFirst?.(mockBlackboxInfo);

    await waitFor(() => {
      expect(result.current.info).toEqual(mockBlackboxInfo);
      expect(result.current.loading).toBe(false);
    });

    // Second call should have been skipped
    await secondCall;
    expect(window.betaflight.getBlackboxInfo).toHaveBeenCalledTimes(1);
  });

  it('manages loading state correctly', async () => {
    vi.mocked(window.betaflight.getBlackboxInfo).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockBlackboxInfo), 100))
    );

    const { result } = renderHook(() => useBlackboxInfo());

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.info).toEqual(mockBlackboxInfo);
    });
  });

  it('keeps previous storage type when refresh returns storageType=none', async () => {
    vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfo);

    const { result } = renderHook(() => useBlackboxInfo());

    await waitFor(() => {
      expect(result.current.info?.storageType).toBe('flash');
    });

    // After erase, FC temporarily returns storageType=none
    const noneInfo: BlackboxInfo = {
      supported: false,
      storageType: 'none',
      totalSize: 0,
      usedSize: 0,
      hasLogs: false,
      freeSize: 0,
      usagePercent: 0,
    };
    vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(noneInfo);

    await result.current.refresh();

    await waitFor(() => {
      // Should keep 'flash' storageType but update usedSize/freeSize/usagePercent
      expect(result.current.info?.storageType).toBe('flash');
      expect(result.current.info?.usedSize).toBe(0);
      expect(result.current.info?.hasLogs).toBe(false);
      expect(result.current.info?.freeSize).toBe(mockBlackboxInfo.totalSize);
      expect(result.current.info?.usagePercent).toBe(0);
    });
  });

  it('clears error on successful refresh after previous error', async () => {
    // First call fails
    vi.mocked(window.betaflight.getBlackboxInfo).mockRejectedValueOnce(new Error('Initial error'));

    const { result } = renderHook(() => useBlackboxInfo());

    await waitFor(() => {
      expect(result.current.error).toBe('Initial error');
    });

    // Second call succeeds
    vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfo);

    await result.current.refresh();

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.info).toEqual(mockBlackboxInfo);
    });
  });
});
