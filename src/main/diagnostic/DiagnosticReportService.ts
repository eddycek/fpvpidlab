/**
 * Diagnostic Report Service
 *
 * Handles auto-report submission on apply verification failure
 * and PATCH for merging user details into an existing auto-report.
 */

import { app, net } from 'electron';
import { randomUUID } from 'crypto';
import { DIAGNOSTIC, APP_VERSION } from '@shared/constants';
import type { DiagnosticBundle } from '@shared/types/diagnostic.types';
import type { TuningSession } from '@shared/types/tuning.types';
import type { TelemetryEvent } from '@shared/types/telemetry.types';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

interface ServiceDependencies {
  profileManager: any;
  snapshotManager: any;
  telemetrySettings: { installationId: string } | null;
  eventCollector: {
    getEvents(): TelemetryEvent[];
    emit(type: string, name: string, meta?: Record<string, string | number | boolean>): void;
  } | null;
  licenseManager: { isPro(): boolean } | null;
  isDemoMode: boolean;
}

function getUploadUrl(): string {
  const defaultUrl = app.isPackaged ? DIAGNOSTIC.UPLOAD_URL : DIAGNOSTIC.UPLOAD_URL_DEV;
  return process.env.DIAGNOSTIC_URL || defaultUrl;
}

/**
 * Send an auto-diagnostic report when apply verification fails.
 * Returns the reportId if submitted, null if skipped (no license, demo mode, etc).
 */
export async function sendAutoReport(
  deps: ServiceDependencies,
  session: TuningSession,
  mismatches: string[],
  expected: Record<string, number>,
  actual: Record<string, number>,
  suspicious: boolean
): Promise<string | null> {
  // Gate: require Pro license (skip in demo mode)
  if (deps.isDemoMode) {
    logger.info('Auto-report skipped: demo mode');
    return null;
  }
  if (!deps.licenseManager || !deps.licenseManager.isPro()) {
    logger.info('Auto-report skipped: no Pro license');
    return null;
  }

  const installationId = deps.telemetrySettings?.installationId;
  if (!installationId) {
    logger.warn('Auto-report skipped: missing installationId (telemetry disabled or unavailable)');
    return null;
  }

  const reportId = randomUUID();

  // Profile context
  let droneSize: string | undefined;
  let flightStyle: string | undefined;
  let bfVersion: string | undefined;
  let boardTarget: string | undefined;

  if (deps.profileManager) {
    try {
      const profile = await deps.profileManager.getProfile(session.profileId);
      if (profile) {
        droneSize = profile.size;
        flightStyle = profile.flightStyle;
        bfVersion = profile.fcInfo?.version;
        boardTarget = profile.fcInfo?.target;
      }
    } catch (err) {
      logger.warn('Auto-report: failed to load profile:', err);
    }
  }

  // CLI diff (pre-tuning snapshot)
  let cliDiffBefore: string | undefined;
  if (deps.snapshotManager && session.baselineSnapshotId) {
    try {
      const snap = await deps.snapshotManager.getSnapshot(session.baselineSnapshotId);
      if (snap) cliDiffBefore = snap.cliDiff;
    } catch {
      // Non-fatal
    }
  }

  // Recommendations from traces
  const recommendations = (session.recommendationTraces ?? []).map((trace) => {
    const allChanges = [
      ...(session.appliedFilterChanges ?? []),
      ...(session.appliedPIDChanges ?? []),
      ...(session.appliedFeedforwardChanges ?? []),
    ];
    const change = allChanges.find((c) => c.setting === trace.setting);
    return {
      ruleId: trace.ruleId,
      setting: trace.setting,
      currentValue: change?.previousValue ?? 0,
      recommendedValue: change?.newValue ?? 0,
      confidence: trace.confidence ?? 'medium',
      explanation: (trace as any).explanation ?? '',
    };
  });

  const bundle: DiagnosticBundle = {
    reportId,
    installationId,
    timestamp: new Date().toISOString(),
    appVersion: APP_VERSION,
    mode: session.tuningType,
    droneSize,
    flightStyle,
    bfVersion,
    boardTarget,
    dataQuality: { overall: 0, tier: 'unknown', warnings: [] },
    recommendations,
    cliDiffBefore,
    autoReported: true,
    autoReportReason: 'apply_mismatch',
    applyVerification: { expected, actual, mismatches, suspicious },
    events: deps.eventCollector?.getEvents() ?? [],
  };

  try {
    const uploadUrl = getUploadUrl();
    const response = await net.fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn(`Auto-report upload failed: HTTP ${response.status} ${text}`);
      return null;
    }

    logger.info(`Auto-report submitted: ${reportId} (${mismatches.length} mismatches)`);

    deps.eventCollector?.emit('workflow', 'auto_report_sent', {
      reportId,
      mismatchCount: mismatches.length,
      suspicious,
    });

    return reportId;
  } catch (error) {
    logger.warn(`Auto-report failed: ${getErrorMessage(error)}`);
    return null;
  }
}

/**
 * Patch an existing report with user details (email, note).
 * Used when user clicks "Report Issue" on a session that already has an auto-report.
 */
export async function patchReport(
  installationId: string,
  reportId: string,
  userEmail?: string,
  userNote?: string
): Promise<void> {
  const uploadUrl = getUploadUrl();
  const patchUrl = `${uploadUrl}/${reportId}`;

  const response = await net.fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Installation-Id': installationId,
    },
    body: JSON.stringify({ userEmail, userNote }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Patch failed: HTTP ${response.status} ${text}`);
  }

  logger.info(`Auto-report patched: ${reportId}`);
}
