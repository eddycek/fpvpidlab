/**
 * IPC Handlers — modular registration with dependency injection.
 *
 * This is the main entry point. It maintains the same public API as the
 * original monolithic handlers.ts so that callers (src/main/index.ts,
 * tests) don't need any changes beyond updating import paths.
 */

import type { HandlerDependencies } from './types';
import { MSCManager } from '../../msc/MSCManager';

import { registerConnectionHandlers } from './connectionHandlers';
import { registerFCInfoHandlers } from './fcInfoHandlers';
import { registerSnapshotHandlers } from './snapshotHandlers';
import { registerProfileHandlers } from './profileHandlers';
import { registerPIDHandlers } from './pidHandlers';
import { registerBlackboxHandlers } from './blackboxHandlers';
import { registerAnalysisHandlers } from './analysisHandlers';
import { registerTuningHandlers } from './tuningHandlers';
import { registerTelemetryHandlers } from './telemetryHandlers';
import { registerLicenseHandlers } from './licenseHandlers';
import { registerUpdateHandlers } from './updateHandlers';
import { registerDiagnosticHandlers } from './diagnosticHandlers';

// Re-export events for use in src/main/index.ts
export {
  sendConnectionChanged,
  sendError,
  sendLog,
  sendProfileChanged,
  sendNewFCDetected,
  sendPIDChanged,
  sendTuningSessionChanged,
  sendLicenseChanged,
} from './events';

// Re-export types
export type { HandlerDependencies } from './types';

// ── Shared mutable state (DI container) ──────────────────────────────
const deps: HandlerDependencies = {
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
  telemetryManager: null,
  licenseManager: null,
  eventCollector: null,
};

// ── Setter functions (called from src/main/index.ts) ─────────────────
export function setMSPClient(client: any): void {
  deps.mspClient = client;
  deps.mscManager = new MSCManager(client);
}

export function setSnapshotManager(manager: any): void {
  deps.snapshotManager = manager;
}

export function setProfileManager(manager: any): void {
  deps.profileManager = manager;
}

export function setBlackboxManager(manager: any): void {
  deps.blackboxManager = manager;
}

export function setTuningSessionManager(manager: any): void {
  deps.tuningSessionManager = manager;
}

export function setTuningHistoryManager(manager: any): void {
  deps.tuningHistoryManager = manager;
}

export function setDemoMode(value: boolean): void {
  deps.isDemoMode = value;
}

export function setTelemetryManager(manager: any): void {
  deps.telemetryManager = manager;
}

export function setLicenseManager(manager: any): void {
  deps.licenseManager = manager;
}

export function setEventCollector(collector: any): void {
  deps.eventCollector = collector;
}

/** Returns true if a settings fix/reset was applied and a clean snapshot is needed on reconnect. */
export function consumePendingSettingsSnapshot(): boolean {
  if (deps.pendingSettingsSnapshot) {
    deps.pendingSettingsSnapshot = false;
    return true;
  }
  return false;
}

// ── Register all IPC handlers ────────────────────────────────────────
export function registerIPCHandlers(): void {
  registerConnectionHandlers(deps);
  registerFCInfoHandlers(deps);
  registerSnapshotHandlers(deps);
  registerProfileHandlers(deps);
  registerPIDHandlers(deps);
  registerBlackboxHandlers(deps);
  registerAnalysisHandlers(deps);
  registerTuningHandlers(deps);
  registerTelemetryHandlers(deps);
  registerLicenseHandlers(deps);
  registerDiagnosticHandlers(deps);
  registerUpdateHandlers();
}
