import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { ipcMain } from 'electron';
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
    filterLogId: null,
    pidLogId: null,
    quickLogId: null,
    verificationLogId: null,
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

    deps = {
      mspClient: null,
      snapshotManager: null,
      profileManager: {
        getCurrentProfileId: vi.fn().mockReturnValue('p-1'),
        getProfile: vi.fn().mockResolvedValue(null),
      },
      blackboxManager: null,
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
    const { net } = await import('electron');
    vi.mocked(net.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Server error'),
    } as any);

    const result = await invokeHandler({ recordId: 'rec-1' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Upload failed');
  });
});
