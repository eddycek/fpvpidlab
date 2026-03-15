import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLicense } from './useLicense';

describe('useLicense', () => {
  beforeEach(() => {
    vi.mocked(window.betaflight.getLicenseStatus).mockResolvedValue({
      type: 'free',
      expiresAt: null,
    });
    vi.mocked(window.betaflight.onLicenseChanged).mockReturnValue(() => {});
  });

  it('loads license status on mount', async () => {
    const { result } = renderHook(() => useLicense());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status?.type).toBe('free');
    expect(result.current.isPro).toBe(false);
  });

  it('returns isPro=true for paid license', async () => {
    vi.mocked(window.betaflight.getLicenseStatus).mockResolvedValue({
      type: 'paid',
      expiresAt: null,
      key: 'PIDLAB-ABCD-****-****',
      activatedAt: '2026-03-01T00:00:00Z',
    });

    const { result } = renderHook(() => useLicense());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isPro).toBe(true);
    expect(result.current.status?.type).toBe('paid');
  });

  it('returns isPro=true for tester license', async () => {
    vi.mocked(window.betaflight.getLicenseStatus).mockResolvedValue({
      type: 'tester',
      expiresAt: null,
    });

    const { result } = renderHook(() => useLicense());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isPro).toBe(true);
  });

  it('activates license and updates status', async () => {
    vi.mocked(window.betaflight.activateLicense).mockResolvedValue({
      type: 'paid',
      expiresAt: null,
      key: 'PIDLAB-ABCD-****-****',
      activatedAt: '2026-03-15T00:00:00Z',
    });

    const { result } = renderHook(() => useLicense());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.activate('PIDLAB-ABCD-EFGH-JKNM');
    });

    expect(result.current.status?.type).toBe('paid');
    expect(result.current.isPro).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('sets error on activation failure', async () => {
    vi.mocked(window.betaflight.activateLicense).mockRejectedValue(
      new Error('Invalid license key')
    );

    const { result } = renderHook(() => useLicense());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      try {
        await result.current.activate('PIDLAB-XXXX-XXXX-XXXX');
      } catch {
        // Expected
      }
    });

    expect(result.current.error).toBe('Invalid license key');
    expect(result.current.isPro).toBe(false);
  });

  it('removes license and reverts to free', async () => {
    vi.mocked(window.betaflight.getLicenseStatus).mockResolvedValue({
      type: 'paid',
      expiresAt: null,
    });
    vi.mocked(window.betaflight.removeLicense).mockResolvedValue(undefined);

    const { result } = renderHook(() => useLicense());
    await waitFor(() => expect(result.current.isPro).toBe(true));

    await act(async () => {
      await result.current.remove();
    });

    expect(result.current.status?.type).toBe('free');
    expect(result.current.isPro).toBe(false);
  });

  it('subscribes to license change events', async () => {
    let eventCallback: ((info: any) => void) | null = null;
    vi.mocked(window.betaflight.onLicenseChanged).mockImplementation((cb) => {
      eventCallback = cb;
      return () => {};
    });

    const { result } = renderHook(() => useLicense());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(eventCallback).not.toBeNull();

    act(() => {
      eventCallback!({ type: 'paid', expiresAt: null });
    });

    expect(result.current.status?.type).toBe('paid');
    expect(result.current.isPro).toBe(true);
  });
});
