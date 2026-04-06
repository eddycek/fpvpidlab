import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs/promises
const mockReadFile = vi.fn();
vi.mock('fs/promises', () => ({
  default: { readFile: (...args: any[]) => mockReadFile(...args) },
  readFile: (...args: any[]) => mockReadFile(...args),
}));

// Mock electron
vi.mock('electron', () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  return {
    ipcMain: {
      handle: (channel: string, handler: (...args: any[]) => any) => {
        handlers.set(channel, handler);
      },
      _handlers: handlers,
    },
    app: { isPackaged: false },
    net: {
      fetch: vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ reportId: 'server-report-id' }),
      }),
    },
  };
});

// Mock zlib
vi.mock('zlib', () => ({
  gzipSync: (buf: Buffer) => buf,
  default: { gzipSync: (buf: Buffer) => buf },
}));

// Mock crypto
vi.mock('crypto', () => ({
  randomUUID: () => 'test-report-uuid',
  default: { randomUUID: () => 'test-report-uuid' },
}));

import { ipcMain, net } from 'electron';
import { registerDiagnosticHandlers } from './diagnosticHandlers';
import { IPCChannel } from '@shared/types/ipc.types';
import type { HandlerDependencies } from './types';

describe('diagnosticHandlers', () => {
  let deps: HandlerDependencies;
  const mockRecord = {
    id: 'rec-1',
    profileId: 'p-1',
    tuningType: 'filter',
    startedAt: '2026-03-16T10:00:00.000Z',
    completedAt: '2026-03-16T10:30:00.000Z',
    baselineSnapshotId: null,
    postFilterSnapshotId: null,
    postTuningSnapshotId: null,
    filterLogId: 'log-filter-1',
    pidLogId: null,
    quickLogId: null,
    verificationLogId: 'log-verify-1',
    appliedFilterChanges: [],
    appliedPIDChanges: [],
    appliedFeedforwardChanges: [],
    filterMetrics: null,
    pidMetrics: null,
    verificationMetrics: null,
    verificationPidMetrics: null,
    transferFunctionMetrics: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (ipcMain as any)._handlers.clear();
    mockReadFile.mockReset();

    deps = {
      mspClient: null,
      snapshotManager: null,
      profileManager: {
        getCurrentProfileId: vi.fn().mockReturnValue('p-1'),
        getProfile: vi.fn().mockResolvedValue(null),
      },
      blackboxManager: {
        getLog: vi.fn().mockResolvedValue({
          id: 'log-verify-1',
          filepath: '/data/logs/flight.bbl',
          filename: 'flight.bbl',
        }),
      },
      tuningSessionManager: null,
      tuningHistoryManager: {
        getHistory: vi.fn().mockResolvedValue([mockRecord]),
      },
      mscManager: null,
      isDownloadingBlackbox: false,
      pendingSettingsSnapshot: false,
      isDemoMode: false,
      telemetryManager: {
        getSettings: vi.fn().mockReturnValue({ installationId: 'test-install' }),
      },
      licenseManager: {
        isPro: vi.fn().mockReturnValue(true),
      },
      eventCollector: {
        emit: vi.fn(),
        getEvents: vi.fn().mockReturnValue([]),
      } as any,
      fcStateCache: null,
    };

    registerDiagnosticHandlers(deps);
  });

  async function invokeHandler(input: any) {
    const handler = (ipcMain as any)._handlers.get(IPCChannel.DIAGNOSTIC_SEND_REPORT);
    return handler({}, input);
  }

  it('registers the diagnostic handler', () => {
    expect((ipcMain as any)._handlers.has(IPCChannel.DIAGNOSTIC_SEND_REPORT)).toBe(true);
  });

  it('submits diagnostic report successfully', async () => {
    const result = await invokeHandler({
      recordId: 'rec-1',
      userEmail: 'test@example.com',
      userNote: 'Bad recommendations',
    });

    expect(result.success).toBe(true);
    expect(result.data.submitted).toBe(true);
    expect(result.data.reportId).toBeDefined();
  });

  it('rejects when license is not Pro', async () => {
    (deps.licenseManager as any).isPro.mockReturnValue(false);

    const result = await invokeHandler({ recordId: 'rec-1' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Pro license');
  });

  it('allows in demo mode even without Pro license', async () => {
    (deps.licenseManager as any).isPro.mockReturnValue(false);
    deps.isDemoMode = true;

    const result = await invokeHandler({ recordId: 'rec-1' });

    expect(result.success).toBe(true);
  });

  it('returns error when record not found', async () => {
    const result = await invokeHandler({ recordId: 'nonexistent' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('emits telemetry event on success', async () => {
    await invokeHandler({ recordId: 'rec-1', userEmail: 'a@b.com' });

    expect(deps.eventCollector!.emit).toHaveBeenCalledWith(
      'workflow',
      'diagnostic_report_sent',
      expect.objectContaining({ mode: 'filter', hasEmail: true })
    );
  });

  it('handles upload failure gracefully', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Server error'),
    } as any);

    const result = await invokeHandler({ recordId: 'rec-1' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Upload failed');
  });

  describe('BBL upload (fire-and-forget)', () => {
    it('initiates BBL upload when includeFlightData is true', async () => {
      const bblBuffer = Buffer.alloc(1024);
      mockReadFile.mockResolvedValue(bblBuffer);

      // First call: bundle upload. Second call: BBL upload (fire-and-forget).
      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ reportId: 'rpt-1' }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ status: 'ok' }),
        } as any);

      const result = await invokeHandler({
        recordId: 'rec-1',
        includeFlightData: true,
      });

      // Report succeeds immediately (BBL upload is background)
      expect(result.success).toBe(true);
      expect(result.data.submitted).toBe(true);

      // Allow fire-and-forget promise to settle
      await vi.waitFor(() => {
        expect(net.fetch).toHaveBeenCalledTimes(2);
      });

      // Verify BBL upload call
      const bblCall = vi.mocked(net.fetch).mock.calls[1];
      expect(bblCall[0]).toContain('/rpt-1/bbl');
      expect(bblCall[1]).toMatchObject({ method: 'PUT' });
    });

    it('skips BBL upload when includeFlightData is false', async () => {
      const result = await invokeHandler({
        recordId: 'rec-1',
        includeFlightData: false,
      });

      expect(result.success).toBe(true);

      // Only one fetch call (bundle upload)
      expect(net.fetch).toHaveBeenCalledTimes(1);
    });

    it('report succeeds even when BBL file not on disk', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      vi.mocked(net.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ reportId: 'rpt-1' }),
      } as any);

      const result = await invokeHandler({
        recordId: 'rec-1',
        includeFlightData: true,
      });

      expect(result.success).toBe(true);
      expect(result.data.submitted).toBe(true);
    });

    it('report succeeds even when BBL upload fails', async () => {
      const bblBuffer = Buffer.alloc(1024);
      mockReadFile.mockResolvedValue(bblBuffer);

      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ reportId: 'rpt-1' }),
        } as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 413,
          text: () => Promise.resolve('Too large'),
        } as any);

      const result = await invokeHandler({
        recordId: 'rec-1',
        includeFlightData: true,
      });

      // Report still succeeds — BBL is fire-and-forget
      expect(result.success).toBe(true);
      expect(result.data.submitted).toBe(true);
    });

    it('selects verification log over analysis log', async () => {
      const bblBuffer = Buffer.alloc(512);
      mockReadFile.mockResolvedValue(bblBuffer);

      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ reportId: 'rpt-1' }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ status: 'ok' }),
        } as any);

      await invokeHandler({ recordId: 'rec-1', includeFlightData: true });

      // Allow fire-and-forget promise to settle
      await vi.waitFor(() => {
        expect(deps.blackboxManager!.getLog).toHaveBeenCalledWith('log-verify-1');
      });
    });

    it('emits BBL telemetry event on background completion', async () => {
      const bblBuffer = Buffer.alloc(1024);
      mockReadFile.mockResolvedValue(bblBuffer);

      vi.mocked(net.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ reportId: 'rpt-1' }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ status: 'ok' }),
        } as any);

      await invokeHandler({ recordId: 'rec-1', includeFlightData: true });

      // Allow fire-and-forget promise to settle
      await vi.waitFor(() => {
        expect(deps.eventCollector!.emit).toHaveBeenCalledWith(
          'workflow',
          'diagnostic_bbl_upload',
          expect.objectContaining({ reportId: 'rpt-1', success: true })
        );
      });
    });

    it('includes includeFlightData in report telemetry event', async () => {
      await invokeHandler({ recordId: 'rec-1', includeFlightData: true });

      expect(deps.eventCollector!.emit).toHaveBeenCalledWith(
        'workflow',
        'diagnostic_report_sent',
        expect.objectContaining({ includeFlightData: true })
      );
    });
  });
});
