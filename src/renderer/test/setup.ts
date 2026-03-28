import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock useToast hook (tests can override this)
vi.mock('../hooks/useToast', () => ({
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  })),
}));

// Mock window.betaflight API
global.window.betaflight = {
  // App
  isDemoMode: vi.fn().mockResolvedValue(false),
  resetDemo: vi.fn().mockResolvedValue(undefined),

  // Connection
  listPorts: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  getConnectionStatus: vi.fn().mockResolvedValue({ connected: false }),
  onConnectionChanged: vi.fn(() => () => {}),

  // FC Info
  getFCInfo: vi.fn(),
  exportCLI: vi.fn(),
  getBlackboxSettings: vi.fn(),
  getFeedforwardConfig: vi.fn().mockRejectedValue(new Error('Not connected')),
  getRatesConfig: vi.fn().mockRejectedValue(new Error('Not connected')),
  fixBlackboxSettings: vi.fn(),
  selectPidProfile: vi.fn().mockResolvedValue(undefined),

  // Snapshots
  createSnapshot: vi.fn(),
  listSnapshots: vi.fn(),
  deleteSnapshot: vi.fn(),
  loadSnapshot: vi.fn(),
  exportSnapshot: vi.fn(),

  // Profiles
  createProfile: vi.fn(),
  createProfileFromPreset: vi.fn(),
  updateProfile: vi.fn(),
  deleteProfile: vi.fn(),
  listProfiles: vi.fn(),
  getProfile: vi.fn(),
  getCurrentProfile: vi.fn(),
  setCurrentProfile: vi.fn(),
  exportProfile: vi.fn(),
  getFCSerialNumber: vi.fn(),
  onProfileChanged: vi.fn(() => () => {}),
  onNewFCDetected: vi.fn(() => () => {}),

  // Blackbox
  getBlackboxInfo: vi.fn(),
  downloadBlackboxLog: vi.fn(),
  listBlackboxLogs: vi.fn().mockResolvedValue([]),
  deleteBlackboxLog: vi.fn(),
  eraseBlackboxFlash: vi.fn(),
  openBlackboxFolder: vi.fn(),
  testBlackboxRead: vi.fn(),
  parseBlackboxLog: vi.fn(),
  importBlackboxLog: vi.fn().mockResolvedValue(null),
  onBlackboxParseProgress: vi.fn(() => () => {}),

  // PID
  getPIDConfig: vi.fn(),
  updatePIDConfig: vi.fn(),
  savePIDConfig: vi.fn(),
  onPIDChanged: vi.fn(() => () => {}),

  // Analysis
  analyzeFilters: vi.fn(),
  analyzePID: vi.fn(),
  analyzeTransferFunction: vi.fn(),

  // Snapshot Restore
  restoreSnapshot: vi.fn(),
  onRestoreProgress: vi.fn(() => () => {}),

  // Tuning
  applyRecommendations: vi.fn(),
  onApplyProgress: vi.fn(() => () => {}),

  // Tuning Session
  getTuningSession: vi.fn().mockResolvedValue(null),
  startTuningSession: vi.fn(),
  updateTuningPhase: vi.fn(),
  resetTuningSession: vi.fn(),
  onTuningSessionChanged: vi.fn(() => () => {}),

  // Tuning History
  getTuningHistory: vi.fn().mockResolvedValue([]),
  updateVerificationMetrics: vi.fn(),
  updateHistoryVerification: vi.fn().mockResolvedValue(undefined),

  // Telemetry
  getTelemetrySettings: vi.fn().mockResolvedValue({
    enabled: true,
    installationId: 'test-uuid',
    lastUploadAt: null,
    lastUploadError: null,
  }),
  setTelemetryEnabled: vi.fn(),
  sendTelemetryNow: vi.fn().mockResolvedValue(undefined),

  // Diagnostic Reports
  sendDiagnosticReport: vi.fn().mockResolvedValue({ reportId: 'test-id', submitted: true }),

  // App Logs
  getAppLogs: vi.fn().mockResolvedValue([]),
  exportAppLogs: vi.fn().mockResolvedValue(''),

  // Auto-update
  checkForUpdate: vi.fn().mockResolvedValue(undefined),
  installUpdate: vi.fn().mockResolvedValue(undefined),
  onUpdateAvailable: vi.fn(() => () => {}),
  onUpdateDownloaded: vi.fn(() => () => {}),

  // License
  activateLicense: vi.fn(),
  getLicenseStatus: vi.fn().mockResolvedValue({ type: 'free', expiresAt: null }),
  removeLicense: vi.fn().mockResolvedValue(undefined),
  validateLicense: vi.fn().mockResolvedValue(undefined),
  onLicenseChanged: vi.fn(() => () => {}),

  // Events
  onError: vi.fn(() => () => {}),
  onLog: vi.fn(() => () => {}),
};
