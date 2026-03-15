import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron-updater
const mockAutoUpdater = vi.hoisted(() => ({
  logger: null as any,
  autoDownload: false,
  autoInstallOnAppQuit: false,
  on: vi.fn(),
  checkForUpdates: vi.fn().mockResolvedValue({}),
  quitAndInstall: vi.fn(),
}));

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}));

// Mock electron
const mockApp = vi.hoisted(() => ({
  isPackaged: true,
}));

const mockWindow = vi.hoisted(() => ({
  webContents: { send: vi.fn() },
}));

vi.mock('electron', () => ({
  app: mockApp,
}));

vi.mock('./window', () => ({
  getMainWindow: () => mockWindow,
}));

vi.mock('./utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { initAutoUpdater, checkForUpdates, quitAndInstall } from './updater';
import { IPCChannel } from '@shared/types/ipc.types';

describe('updater', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockApp.isPackaged = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initAutoUpdater', () => {
    it('skips in dev mode (not packaged)', () => {
      mockApp.isPackaged = false;
      initAutoUpdater();
      expect(mockAutoUpdater.on).not.toHaveBeenCalled();
    });

    it('configures autoUpdater settings', () => {
      initAutoUpdater();
      expect(mockAutoUpdater.autoDownload).toBe(true);
      expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true);
    });

    it('registers all event listeners', () => {
      initAutoUpdater();
      const events = mockAutoUpdater.on.mock.calls.map((c: any[]) => c[0]);
      expect(events).toContain('checking-for-update');
      expect(events).toContain('update-available');
      expect(events).toContain('update-not-available');
      expect(events).toContain('download-progress');
      expect(events).toContain('update-downloaded');
      expect(events).toContain('error');
    });

    it('checks for updates after delay', () => {
      initAutoUpdater();
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();

      vi.advanceTimersByTime(10_000);
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledOnce();
    });

    it('does not check before delay', () => {
      initAutoUpdater();
      vi.advanceTimersByTime(9_999);
      expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled();
    });

    it('handles check failure gracefully', () => {
      mockAutoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('Network error'));
      initAutoUpdater();
      vi.advanceTimersByTime(10_000);
      // Should not throw — error is caught internally
    });

    it('sends EVENT_UPDATE_AVAILABLE to renderer', () => {
      initAutoUpdater();

      const updateAvailableCb = mockAutoUpdater.on.mock.calls.find(
        (c: any[]) => c[0] === 'update-available'
      )?.[1];
      expect(updateAvailableCb).toBeDefined();

      updateAvailableCb({ version: '0.5.0', releaseNotes: 'Bug fixes' });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(IPCChannel.EVENT_UPDATE_AVAILABLE, {
        version: '0.5.0',
        releaseNotes: 'Bug fixes',
      });
    });

    it('sends EVENT_UPDATE_DOWNLOADED to renderer', () => {
      initAutoUpdater();

      const downloadedCb = mockAutoUpdater.on.mock.calls.find(
        (c: any[]) => c[0] === 'update-downloaded'
      )?.[1];
      expect(downloadedCb).toBeDefined();

      downloadedCb({ version: '0.5.0', releaseNotes: 'New features' });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(IPCChannel.EVENT_UPDATE_DOWNLOADED, {
        version: '0.5.0',
        releaseNotes: 'New features',
      });
    });

    it('handles non-string releaseNotes', () => {
      initAutoUpdater();

      const updateAvailableCb = mockAutoUpdater.on.mock.calls.find(
        (c: any[]) => c[0] === 'update-available'
      )?.[1];

      // releaseNotes can be an array of objects in some cases
      updateAvailableCb({ version: '0.5.0', releaseNotes: [{ note: 'test' }] });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(IPCChannel.EVENT_UPDATE_AVAILABLE, {
        version: '0.5.0',
        releaseNotes: undefined,
      });
    });

    it('handles missing releaseNotes', () => {
      initAutoUpdater();

      const downloadedCb = mockAutoUpdater.on.mock.calls.find(
        (c: any[]) => c[0] === 'update-downloaded'
      )?.[1];

      downloadedCb({ version: '0.5.0' });

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(IPCChannel.EVENT_UPDATE_DOWNLOADED, {
        version: '0.5.0',
        releaseNotes: undefined,
      });
    });
  });

  describe('checkForUpdates', () => {
    it('calls autoUpdater.checkForUpdates', async () => {
      await checkForUpdates();
      expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledOnce();
    });
  });

  describe('quitAndInstall', () => {
    it('calls autoUpdater.quitAndInstall with correct args', () => {
      quitAndInstall();
      expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    });
  });
});
