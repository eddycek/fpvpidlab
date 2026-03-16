import { ipcMain } from 'electron';
import { app, net } from 'electron';
import { IPCChannel } from '@shared/types/ipc.types';
import { DIAGNOSTIC } from '@shared/constants';
import type { DiagnosticReportInput, DiagnosticReportResult } from '@shared/types/diagnostic.types';
import type { HandlerDependencies } from './types';
import { createResponse } from './types';
import { buildDiagnosticBundle } from '../../diagnostic/DiagnosticBundleBuilder';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';

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

        logger.info(`Diagnostic report submitted: ${bundle.reportId}`);

        // Emit telemetry event
        deps.eventCollector?.emit('workflow', 'diagnostic_report_sent', {
          mode: bundle.mode,
          hasEmail: !!input.userEmail,
          recCount: bundle.recommendations.length,
        });

        return createResponse<DiagnosticReportResult>({
          reportId: result.reportId ?? bundle.reportId,
          submitted: true,
        });
      } catch (error) {
        logger.error('Failed to send diagnostic report:', error);
        return createResponse<DiagnosticReportResult>(undefined, getErrorMessage(error));
      }
    }
  );

  logger.info('Diagnostic IPC handlers registered');
}
