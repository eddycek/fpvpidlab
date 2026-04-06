import { IPCResponse } from '@shared/types/ipc.types';
import type { MSCManager } from '../../msc/MSCManager';
import type { TelemetryEventCollector } from '../../telemetry/TelemetryEventCollector';
import type { FCStateCache } from '../../cache/FCStateCache';

/**
 * Shared dependencies injected into handler modules.
 * Each module receives the full deps object and accesses only what it needs.
 */
export interface HandlerDependencies {
  mspClient: any;
  snapshotManager: any;
  profileManager: any;
  blackboxManager: any;
  tuningSessionManager: any;
  tuningHistoryManager: any;
  mscManager: MSCManager | null;
  /** Guard against concurrent blackbox downloads */
  isDownloadingBlackbox: boolean;
  /** Set after fix/reset — triggers clean snapshot on reconnect */
  pendingSettingsSnapshot: boolean;
  /** Whether the app is running in demo mode */
  isDemoMode: boolean;
  /** Telemetry manager for anonymous usage data */
  telemetryManager: any;
  /** License manager for Pro/Free enforcement */
  licenseManager: any;
  /** Telemetry event collector for structured event logging */
  eventCollector: TelemetryEventCollector | null;
  /** Cached FC state for cache-first reads */
  fcStateCache: FCStateCache | null;
}

export function createResponse<T>(data: T | undefined, error?: string): IPCResponse<T> {
  return {
    success: !error,
    data: data as T,
    error,
  } as IPCResponse<T>;
}

/**
 * Parse a `set key = value` line from CLI diff output.
 * Returns the value string, or undefined if the key is not found.
 */
export function parseDiffSetting(cliDiff: string, key: string): string | undefined {
  for (const line of cliDiff.split('\n')) {
    const match = line.match(new RegExp(`^set\\s+${key}\\s*=\\s*(.+)`, 'i'));
    if (match) return match[1].trim();
  }
  return undefined;
}

/**
 * Parse PID profile names from `diff all` CLI output.
 * BF `diff all` has sections like `# profile 0`, `# profile 1`, etc.
 * Each section may contain `set profile_name = <name>`.
 * Returns a map of profile index → name (only for profiles with non-empty names).
 */
export function parseProfileNamesFromDiff(cliDiff: string): Record<number, string> {
  const names: Record<number, string> = {};
  let currentProfile = -1;

  for (const line of cliDiff.split('\n')) {
    // Detect profile section headers: "profile 0", "# profile 0", etc.
    const profileMatch = line.match(/^#?\s*profile\s+(\d+)/i);
    if (profileMatch) {
      currentProfile = parseInt(profileMatch[1], 10);
      continue;
    }

    // Detect rateprofile section — stop looking for profile_name
    if (/^#?\s*rateprofile\s+/i.test(line)) {
      currentProfile = -1;
      continue;
    }

    // Parse profile_name within a profile section
    if (currentProfile >= 0) {
      const nameMatch = line.match(/^set\s+profile_name\s*=\s*(.+)/i);
      if (nameMatch) {
        const name = nameMatch[1].trim();
        if (name) {
          names[currentProfile] = name;
        }
      }
    }
  }

  return names;
}
