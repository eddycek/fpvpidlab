import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoUpdate } from './useAutoUpdate';

describe('useAutoUpdate', () => {
  beforeEach(() => {
    vi.mocked(window.betaflight.onUpdateAvailable).mockReturnValue(() => {});
    vi.mocked(window.betaflight.onUpdateDownloaded).mockReturnValue(() => {});
  });

  it('starts with no update', () => {
    const { result } = renderHook(() => useAutoUpdate());
    expect(result.current.updateVersion).toBeNull();
    expect(result.current.releaseNotes).toBeNull();
    expect(result.current.updateReady).toBe(false);
  });

  it('sets version when update available', () => {
    let cb: ((info: { version: string; releaseNotes?: string }) => void) | null = null;
    vi.mocked(window.betaflight.onUpdateAvailable).mockImplementation((fn) => {
      cb = fn;
      return () => {};
    });

    const { result } = renderHook(() => useAutoUpdate());

    act(() => cb!({ version: '0.2.0' }));

    expect(result.current.updateVersion).toBe('0.2.0');
    expect(result.current.updateReady).toBe(false);
  });

  it('sets releaseNotes when available', () => {
    let cb: ((info: { version: string; releaseNotes?: string }) => void) | null = null;
    vi.mocked(window.betaflight.onUpdateAvailable).mockImplementation((fn) => {
      cb = fn;
      return () => {};
    });

    const { result } = renderHook(() => useAutoUpdate());

    act(() => cb!({ version: '0.2.0', releaseNotes: '<p>Bug fixes</p>' }));

    expect(result.current.releaseNotes).toBe('<p>Bug fixes</p>');
  });

  it('sets updateReady when downloaded', () => {
    let cb: ((info: { version: string; releaseNotes?: string }) => void) | null = null;
    vi.mocked(window.betaflight.onUpdateDownloaded).mockImplementation((fn) => {
      cb = fn;
      return () => {};
    });

    const { result } = renderHook(() => useAutoUpdate());

    act(() => cb!({ version: '0.2.0' }));

    expect(result.current.updateVersion).toBe('0.2.0');
    expect(result.current.updateReady).toBe(true);
  });

  it('overwrites version from available with downloaded', () => {
    let availableCb: ((info: { version: string; releaseNotes?: string }) => void) | null = null;
    let downloadedCb: ((info: { version: string; releaseNotes?: string }) => void) | null = null;

    vi.mocked(window.betaflight.onUpdateAvailable).mockImplementation((fn) => {
      availableCb = fn;
      return () => {};
    });
    vi.mocked(window.betaflight.onUpdateDownloaded).mockImplementation((fn) => {
      downloadedCb = fn;
      return () => {};
    });

    const { result } = renderHook(() => useAutoUpdate());

    act(() => availableCb!({ version: '0.2.0', releaseNotes: 'Notes v1' }));
    expect(result.current.updateReady).toBe(false);

    act(() => downloadedCb!({ version: '0.2.0', releaseNotes: 'Notes v2' }));
    expect(result.current.updateReady).toBe(true);
    expect(result.current.releaseNotes).toBe('Notes v2');
  });

  it('calls installUpdate on the API', () => {
    vi.mocked(window.betaflight.installUpdate).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoUpdate());

    act(() => result.current.installUpdate());

    expect(window.betaflight.installUpdate).toHaveBeenCalled();
  });

  it('handles installUpdate failure gracefully', () => {
    vi.mocked(window.betaflight.installUpdate).mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useAutoUpdate());

    // Should not throw
    act(() => result.current.installUpdate());
  });

  it('cleans up subscriptions on unmount', () => {
    const cleanupAvailable = vi.fn();
    const cleanupDownloaded = vi.fn();
    vi.mocked(window.betaflight.onUpdateAvailable).mockReturnValue(cleanupAvailable);
    vi.mocked(window.betaflight.onUpdateDownloaded).mockReturnValue(cleanupDownloaded);

    const { unmount } = renderHook(() => useAutoUpdate());
    unmount();

    expect(cleanupAvailable).toHaveBeenCalled();
    expect(cleanupDownloaded).toHaveBeenCalled();
  });
});
