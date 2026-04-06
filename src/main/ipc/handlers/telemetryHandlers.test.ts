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
  };
});

import { ipcMain } from 'electron';
import { registerTelemetryHandlers } from './telemetryHandlers';
import { IPCChannel } from '@shared/types/ipc.types';
import type { HandlerDependencies } from './types';

describe('telemetryHandlers', () => {
  let deps: HandlerDependencies;
  const mockTelemetryManager = {
    getSettings: vi.fn(),
    setEnabled: vi.fn(),
    sendNow: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (ipcMain as any)._handlers.clear();

    deps = {
      mspClient: null,
      snapshotManager: null,
      profileManager: null,
      blackboxManager: null,
      tuningSessionManager: null,
      tuningHistoryManager: null,
      mscManager: null,
      isDownloadingBlackbox: false,
      pendingSettingsSnapshot: false,
      isDemoMode: false,
      telemetryManager: mockTelemetryManager,
      licenseManager: null,
      eventCollector: null,
      fcStateCache: null,
    };

    registerTelemetryHandlers(deps);
  });

  const invoke = async (channel: string, ...args: any[]) => {
    const handler = (ipcMain as any)._handlers.get(channel);
    return handler({ sender: { send: vi.fn() } }, ...args);
  };

  it('TELEMETRY_GET_SETTINGS returns settings', async () => {
    mockTelemetryManager.getSettings.mockReturnValue({
      enabled: true,
      installationId: 'test-id',
      lastUploadAt: null,
    });

    const result = await invoke(IPCChannel.TELEMETRY_GET_SETTINGS);
    expect(result.success).toBe(true);
    expect(result.data.enabled).toBe(true);
  });

  it('TELEMETRY_SET_ENABLED updates enabled state', async () => {
    mockTelemetryManager.setEnabled.mockResolvedValue({
      enabled: false,
      installationId: 'test-id',
      lastUploadAt: null,
    });

    const result = await invoke(IPCChannel.TELEMETRY_SET_ENABLED, false);
    expect(result.success).toBe(true);
    expect(mockTelemetryManager.setEnabled).toHaveBeenCalledWith(false);
  });

  it('TELEMETRY_SEND_NOW calls sendNow', async () => {
    mockTelemetryManager.sendNow.mockResolvedValue(undefined);

    const result = await invoke(IPCChannel.TELEMETRY_SEND_NOW);
    expect(result.success).toBe(true);
    expect(mockTelemetryManager.sendNow).toHaveBeenCalled();
  });

  it('returns error when telemetryManager is null', async () => {
    deps.telemetryManager = null;

    const result = await invoke(IPCChannel.TELEMETRY_GET_SETTINGS);
    expect(result.success).toBe(false);
    expect(result.error).toContain('TelemetryManager not initialized');
  });
});
