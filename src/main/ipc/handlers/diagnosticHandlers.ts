import { ipcMain } from 'electron';
import { app, net } from 'electron';
import fs from 'fs/promises';
import { IPCChannel } from '@shared/types/ipc.types';
import { DIAGNOSTIC } from '@shared/constants';
import type {
  DiagnosticReportInput,
  DiagnosticReportResult,
  DiagnosticPatchInput,
} from '@shared/types/diagnostic.types';
import type { HandlerDependencies } from './types';
import { createResponse } from './types';
import { buildDiagnosticBundle } from '../../diagnostic/DiagnosticBundleBuilder';
import { patchReport } from '../../diagnostic/DiagnosticReportService';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';

/**
 * Determine which BBL log ID to use based on tuning type.
 * Returns the most relevant log: verification > analysis > quick.
 */
function getLogIdForRecord(record: any): string | null {
  // Prefer verification log (last flight), then analysis log
  if (record.verificationLogId) return record.verificationLogId;
  if (record.tuningType === 'quick' && record.quickLogId) return record.quickLogId;
  if (record.tuningType === 'filter' && record.filterLogId) return record.filterLogId;
  if (record.tuningType === 'pid' && record.pidLogId) return record.pidLogId;
  // Fallback: any available log
  return record.quickLogId || record.filterLogId || record.pidLogId || null;
}

/**
 * Upload BBL flight data to the worker after the bundle has been submitted.
 * Returns true if uploaded successfully, false otherwise.
 */
async function uploadBBL(
  deps: HandlerDependencies,
  record: any,
  reportId: string,
  installationId: string,
  baseUrl: string
): Promise<boolean> {
  const logId = getLogIdForRecord(record);
  if (!logId || !deps.blackboxManager) {
    logger.warn(`BBL upload skipped: no log ID or blackboxManager`);
    return false;
  }

  const logMeta = await deps.blackboxManager.getLog(logId);
  if (!logMeta?.filepath) {
    logger.warn(`BBL upload skipped: log ${logId} not found on disk`);
    return false;
  }

  // Read file and check size
  let fileBuffer: Buffer;
  try {
    fileBuffer = await fs.readFile(logMeta.filepath);
  } catch {
    logger.warn(`BBL upload skipped: cannot read ${logMeta.filepath}`);
    return false;
  }

  if (fileBuffer.length > DIAGNOSTIC.BBL_MAX_SIZE_BYTES) {
    logger.warn(
      `BBL upload skipped: file too large (${Math.round(fileBuffer.length / 1024 / 1024)} MB)`
    );
    return false;
  }

  const bblUrl = `${baseUrl}/${reportId}/bbl`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DIAGNOSTIC.BBL_UPLOAD_TIMEOUT_MS);

  try {
    const response = await net.fetch(bblUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(fileBuffer.length),
        'X-Installation-Id': installationId,
      },
      body: fileBuffer as unknown as BodyInit,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      logger.warn(`BBL upload failed: HTTP ${response.status} ${text}`);
      return false;
    }

    logger.info(`BBL uploaded for report ${reportId} (${Math.round(fileBuffer.length / 1024)} KB)`);
    return true;
  } catch (error) {
    logger.warn(`BBL upload failed: ${getErrorMessage(error)}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function registerDiagnosticHandlers(deps: HandlerDependencies): void {
  ipcMain.handle(
    IPCChannel.DIAGNOSTIC_SEND_REPORT,
    async (_event, input: DiagnosticReportInput): Promise<any> => {
      try {
        // License gate: must have valid license (Pro or Tester)
        if (deps.licenseManager && !deps.licenseManager.isPro() && !deps.isDemoMode) {
          return createResponse<DiagnosticReportResult>(
            undefined,
            'Diagnostic reports require a Pro license'
          );
        }

        if (!deps.tuningHistoryManager || !deps.profileManager) {
          return createResponse<DiagnosticReportResult>(
            undefined,
            'Required managers not initialized'
          );
        }

        const profileId = deps.profileManager.getCurrentProfileId();
        if (!profileId) {
          return createResponse<DiagnosticReportResult>(undefined, 'No active profile');
        }

        // Find the tuning record
        const history = await deps.tuningHistoryManager.getHistory(profileId);
        const record = history.find((r: any) => r.id === input.recordId);
        if (!record) {
          return createResponse<DiagnosticReportResult>(
            undefined,
            `Tuning record not found: ${input.recordId}`
          );
        }

        // Build diagnostic bundle
        const telemetrySettings = deps.telemetryManager?.getSettings?.() ?? null;
        const bundle = await buildDiagnosticBundle(
          record,
          {
            profileManager: deps.profileManager,
            snapshotManager: deps.snapshotManager,
            telemetrySettings,
            eventCollector: deps.eventCollector,
          },
          input.userEmail,
          input.userNote
        );

        // Upload (plain JSON — bundle is ~100KB, gzip unnecessary)
        const json = JSON.stringify(bundle);

        const defaultUrl = app.isPackaged ? DIAGNOSTIC.UPLOAD_URL : DIAGNOSTIC.UPLOAD_URL_DEV;
        const uploadUrl = process.env.DIAGNOSTIC_URL || defaultUrl;

        const response = await net.fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: json,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`Upload failed: HTTP ${response.status} ${text}`);
        }

        const result = (await response.json()) as { reportId?: string };
        const reportId = result.reportId ?? bundle.reportId;

        logger.info(`Diagnostic report submitted: ${reportId}`);

        // Fire-and-forget BBL upload — don't block report submission
        if (input.includeFlightData) {
          const installationId = bundle.installationId;
          uploadBBL(deps, record, reportId, installationId, uploadUrl)
            .then((uploaded) => {
              deps.eventCollector?.emit('workflow', 'diagnostic_bbl_upload', {
                reportId,
                success: uploaded,
              });
            })
            .catch((err) => {
              logger.warn('BBL background upload failed:', err);
            });
        }

        // Emit telemetry event
        deps.eventCollector?.emit('workflow', 'diagnostic_report_sent', {
          mode: bundle.mode,
          hasEmail: !!input.userEmail,
          recCount: bundle.recommendations.length,
          includeFlightData: !!input.includeFlightData,
        });

        return createResponse<DiagnosticReportResult>({
          reportId,
          submitted: true,
        });
      } catch (error) {
        logger.error('Failed to send diagnostic report:', error);
        return createResponse<DiagnosticReportResult>(undefined, getErrorMessage(error));
      }
    }
  );

  // PATCH handler: merge user details into existing auto-report
  ipcMain.handle(
    IPCChannel.DIAGNOSTIC_PATCH_REPORT,
    async (_event, input: DiagnosticPatchInput): Promise<any> => {
      try {
        const telemetrySettings = deps.telemetryManager?.getSettings?.() ?? null;
        const installationId = telemetrySettings?.installationId;
        if (!installationId) {
          return createResponse(undefined, 'Installation ID not available');
        }

        await patchReport(installationId, input.reportId, input.userEmail, input.userNote);

        deps.eventCollector?.emit('workflow', 'diagnostic_report_patched', {
          reportId: input.reportId,
          hasEmail: !!input.userEmail,
        });

        return createResponse(undefined);
      } catch (error) {
        logger.error('Failed to patch diagnostic report:', error);
        return createResponse(undefined, getErrorMessage(error));
      }
    }
  );

  logger.info('Diagnostic IPC handlers registered');
}
