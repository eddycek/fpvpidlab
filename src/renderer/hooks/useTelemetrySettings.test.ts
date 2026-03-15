import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTelemetrySettings } from './useTelemetrySettings';

describe('useTelemetrySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.betaflight.getTelemetrySettings).mockResolvedValue({
      enabled: false,
      installationId: 'hook-test-uuid',
      lastUploadAt: null,
      lastUploadError: null,
    });
  });

  it('loads settings on mount', async () => {
    const { result } = renderHook(() => useTelemetrySettings());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.settings?.installationId).toBe('hook-test-uuid');
  });

  it('toggleEnabled calls setTelemetryEnabled', async () => {
    vi.mocked(window.betaflight.setTelemetryEnabled).mockResolvedValue({
      enabled: true,
      installationId: 'hook-test-uuid',
      lastUploadAt: null,
      lastUploadError: null,
    });

    const { result } = renderHook(() => useTelemetrySettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.toggleEnabled();
    });

    expect(window.betaflight.setTelemetryEnabled).toHaveBeenCalledWith(true);
    expect(result.current.settings?.enabled).toBe(true);
  });

  it('sendNow sets sending state', async () => {
    vi.mocked(window.betaflight.getTelemetrySettings)
      .mockResolvedValueOnce({
        enabled: true,
        installationId: 'hook-test-uuid',
        lastUploadAt: null,
        lastUploadError: null,
      })
      .mockResolvedValue({
        enabled: true,
        installationId: 'hook-test-uuid',
        lastUploadAt: '2026-03-13T00:00:00Z',
        lastUploadError: null,
      });
    vi.mocked(window.betaflight.sendTelemetryNow).mockResolvedValue(undefined);

    const { result } = renderHook(() => useTelemetrySettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.sendNow();
    });

    expect(window.betaflight.sendTelemetryNow).toHaveBeenCalled();
    expect(result.current.sending).toBe(false);
  });

  it('handles load failure gracefully', async () => {
    vi.mocked(window.betaflight.getTelemetrySettings).mockRejectedValue(new Error('fail'));

    const { result } = renderHook(() => useTelemetrySettings());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.settings).toBeNull();
  });
});
