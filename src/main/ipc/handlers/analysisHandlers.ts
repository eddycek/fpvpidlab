import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import { IPCChannel } from '@shared/types/ipc.types';
import type {
  FilterAnalysisResult,
  PIDAnalysisResult,
  CurrentFilterSettings,
} from '@shared/types/analysis.types';
import type { PIDConfiguration } from '@shared/types/pid.types';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { BlackboxParser } from '../../blackbox/BlackboxParser';
import { analyze as analyzeFilters } from '../../analysis/FilterAnalyzer';
import { analyzePID, analyzeTransferFunction } from '../../analysis/PIDAnalyzer';
import { extractFlightPIDs } from '../../analysis/PIDRecommender';
import { validateBBLHeader, enrichSettingsFromBBLHeaders } from '../../analysis/headerValidation';
import type { HandlerDependencies } from './types';
import { createResponse } from './types';

/**
 * Registers analysis-related IPC handlers.
 */
export function registerAnalysisHandlers(deps: HandlerDependencies): void {
  const emitEvent = (
    type: 'error' | 'workflow' | 'analysis',
    name: string,
    meta?: Record<string, string | number | boolean>
  ) => deps.eventCollector?.emit(type, name, meta);
  // Filter analysis handler
  ipcMain.handle(
    IPCChannel.ANALYSIS_RUN_FILTER,
    async (
      event,
      logId: string,
      sessionIndex?: number,
      currentSettings?: CurrentFilterSettings
    ) => {
      try {
        if (!deps.blackboxManager) {
          return createResponse<FilterAnalysisResult>(undefined, 'BlackboxManager not initialized');
        }

        const logMeta = await deps.blackboxManager.getLog(logId);
        if (!logMeta) {
          return createResponse<FilterAnalysisResult>(
            undefined,
            `Blackbox log not found: ${logId}`
          );
        }

        logger.info(`Running filter analysis on: ${logMeta.filename}`);

        // Parse the log first — BBL headers are the primary source for filter settings
        // (they capture the config at flight time, not the current FC state)
        const data = await fs.readFile(logMeta.filepath);
        const parseResult = await BlackboxParser.parse(data);

        if (!parseResult.success || parseResult.sessions.length === 0) {
          return createResponse<FilterAnalysisResult>(
            undefined,
            'Failed to parse Blackbox log for analysis'
          );
        }

        const idx = sessionIndex ?? 0;
        if (idx >= parseResult.sessions.length) {
          return createResponse<FilterAnalysisResult>(
            undefined,
            `Session index ${idx} out of range (log has ${parseResult.sessions.length} sessions)`
          );
        }

        const session = parseResult.sessions[idx];

        // Build filter settings: BBL headers are the primary source (flight-time config).
        // MSP (live FC) is used only to fill fields that BBL headers don't cover.
        const { DEFAULT_FILTER_SETTINGS } = await import('@shared/types/analysis.types');
        const baseSettings = currentSettings ?? DEFAULT_FILTER_SETTINGS;
        const fromBBL = enrichSettingsFromBBLHeaders(baseSettings, session.header.rawHeaders);
        if (fromBBL) {
          currentSettings = fromBBL;
          logger.info('Enriched filter settings from BBL headers (primary source)');
        } else if (!currentSettings) {
          currentSettings = DEFAULT_FILTER_SETTINGS;
        }

        // Fill remaining undefined fields from live FC (single MSP read, reused below)
        let mspConfig: CurrentFilterSettings | null = null;
        if (deps.mspClient?.isConnected()) {
          try {
            mspConfig = await deps.mspClient.getFilterConfiguration();
          } catch {
            // Non-critical — BBL has the primary data
          }
        }
        if (mspConfig && currentSettings) {
          const mspAny = mspConfig as any;

          const settingsAny = currentSettings as any;
          for (const key of Object.keys(mspAny)) {
            if (settingsAny[key] === undefined && mspAny[key] !== undefined) {
              settingsAny[key] = mspAny[key];
            }
          }
        }

        // Validate BBL header for data quality warnings
        const headerWarnings = validateBBLHeader(session.header);

        // Resolve profile context for size/style-aware advisories
        let droneSize: import('@shared/types/profile.types').DroneSize | undefined;
        let flightStyle: import('@shared/types/profile.types').FlightStyle | undefined;
        if (deps.profileManager) {
          try {
            const currentProfile = await deps.profileManager.getCurrentProfile();
            if (currentProfile?.size) droneSize = currentProfile.size;
            if (currentProfile?.flightStyle) flightStyle = currentProfile.flightStyle;
          } catch {
            // Profile not available — advisory recommendations will be skipped
          }
        }

        // Run analysis with progress reporting
        const result = await analyzeFilters(
          session.flightData,
          idx,
          currentSettings,
          (progress) => {
            event.sender.send(IPCChannel.EVENT_ANALYSIS_PROGRESS, progress);
          },
          { droneSize, flightStyle }
        );

        // Attach header warnings to the result
        if (headerWarnings.length > 0) {
          result.warnings = [...headerWarnings, ...(result.warnings || [])];
        }

        logger.info(
          `Filter analysis complete: ${result.recommendations.length} recommendations, ` +
            `noise level: ${result.noise.overallLevel}, ${result.analysisTimeMs}ms`
        );

        emitEvent('analysis', 'complete', {
          mode: 'filter',
          durationMs: result.analysisTimeMs ?? 0,
          recCount: result.recommendations.length,
          dataQualityTier: result.dataQuality?.tier ?? 'unknown',
        });
        if (result.recommendations.length === 0) {
          emitEvent('analysis', 'no_recommendations', {
            mode: 'filter',
            dataQualityTier: result.dataQuality?.tier ?? 'unknown',
          });
        }

        return createResponse<FilterAnalysisResult>(result);
      } catch (error) {
        emitEvent('error', 'analysis_failed', {
          mode: 'filter',
          stage: 'fft',
          message: getErrorMessage(error),
        });
        logger.error('Failed to run filter analysis:', error);
        return createResponse<FilterAnalysisResult>(undefined, getErrorMessage(error));
      }
    }
  );

  // PID analysis handler
  ipcMain.handle(
    IPCChannel.ANALYSIS_RUN_PID,
    async (event, logId: string, sessionIndex?: number, currentPIDs?: PIDConfiguration) => {
      try {
        if (!deps.blackboxManager) {
          return createResponse<PIDAnalysisResult>(undefined, 'BlackboxManager not initialized');
        }

        const logMeta = await deps.blackboxManager.getLog(logId);
        if (!logMeta) {
          return createResponse<PIDAnalysisResult>(undefined, `Blackbox log not found: ${logId}`);
        }

        logger.info(`Running PID analysis on: ${logMeta.filename}`);

        // Auto-read current PID settings from FC if not provided
        if (!currentPIDs && deps.mspClient?.isConnected()) {
          try {
            currentPIDs = await deps.mspClient.getPIDConfiguration();
            logger.info('Read current PID settings from FC');
          } catch {
            logger.warn('Could not read PID settings from FC, using defaults');
          }
        }

        // Parse the log first
        const data = await fs.readFile(logMeta.filepath);
        const parseResult = await BlackboxParser.parse(data);

        if (!parseResult.success || parseResult.sessions.length === 0) {
          return createResponse<PIDAnalysisResult>(
            undefined,
            'Failed to parse Blackbox log for PID analysis'
          );
        }

        const idx = sessionIndex ?? 0;
        if (idx >= parseResult.sessions.length) {
          return createResponse<PIDAnalysisResult>(
            undefined,
            `Session index ${idx} out of range (log has ${parseResult.sessions.length} sessions)`
          );
        }

        const session = parseResult.sessions[idx];

        // Validate BBL header for data quality warnings
        const headerWarnings = validateBBLHeader(session.header);

        // Extract flight-time PIDs from BBL header for convergent recommendations
        const flightPIDs = extractFlightPIDs(session.header.rawHeaders);

        // Read flight style, drone size, and weight from current profile
        let flightStyle: 'smooth' | 'balanced' | 'aggressive' = 'balanced';
        let droneSize: import('@shared/types/profile.types').DroneSize | undefined;
        let droneWeight: number | undefined;
        if (deps.profileManager) {
          try {
            const currentProfile = await deps.profileManager.getCurrentProfile();
            if (currentProfile?.flightStyle) {
              flightStyle = currentProfile.flightStyle;
            }
            if (currentProfile?.size) {
              droneSize = currentProfile.size;
            }
            if (currentProfile?.weight) {
              droneWeight = currentProfile.weight;
            }
          } catch {
            // Fall back to balanced
          }
        }

        // Run PID analysis with progress reporting
        const result = await analyzePID(
          session.flightData,
          idx,
          currentPIDs,
          (progress) => {
            event.sender.send(IPCChannel.EVENT_ANALYSIS_PROGRESS, progress);
          },
          flightPIDs,
          session.header.rawHeaders,
          flightStyle,
          undefined,
          droneSize,
          droneWeight
        );

        // Attach header warnings to the result
        if (headerWarnings.length > 0) {
          result.warnings = [...headerWarnings, ...(result.warnings || [])];
        }

        logger.info(
          `PID analysis complete: ${result.recommendations.length} recommendations, ` +
            `${result.stepsDetected} steps detected, ${result.analysisTimeMs}ms`
        );

        emitEvent('analysis', 'complete', {
          mode: 'pid',
          durationMs: result.analysisTimeMs ?? 0,
          recCount: result.recommendations.length,
          dataQualityTier: result.dataQuality?.tier ?? 'unknown',
        });
        if (result.recommendations.length === 0) {
          emitEvent('analysis', 'no_recommendations', {
            mode: 'pid',
            dataQualityTier: result.dataQuality?.tier ?? 'unknown',
          });
        }

        return createResponse<PIDAnalysisResult>(result);
      } catch (error) {
        emitEvent('error', 'analysis_failed', {
          mode: 'pid',
          stage: 'step',
          message: getErrorMessage(error),
        });
        logger.error('Failed to run PID analysis:', error);
        return createResponse<PIDAnalysisResult>(undefined, getErrorMessage(error));
      }
    }
  );

  // Transfer function (Wiener deconvolution) analysis handler
  ipcMain.handle(
    IPCChannel.ANALYSIS_RUN_TRANSFER_FUNCTION,
    async (event, logId: string, sessionIndex?: number, currentPIDs?: PIDConfiguration) => {
      try {
        if (!deps.blackboxManager) {
          return createResponse<PIDAnalysisResult>(undefined, 'BlackboxManager not initialized');
        }

        const logMeta = await deps.blackboxManager.getLog(logId);
        if (!logMeta) {
          return createResponse<PIDAnalysisResult>(undefined, `Blackbox log not found: ${logId}`);
        }

        logger.info(`Running transfer function analysis on: ${logMeta.filename}`);

        if (!currentPIDs && deps.mspClient?.isConnected()) {
          try {
            currentPIDs = await deps.mspClient.getPIDConfiguration();
          } catch {
            logger.warn('Could not read PID settings from FC, using defaults');
          }
        }

        const data = await fs.readFile(logMeta.filepath);
        const parseResult = await BlackboxParser.parse(data);

        if (!parseResult.success || parseResult.sessions.length === 0) {
          return createResponse<PIDAnalysisResult>(
            undefined,
            'Failed to parse Blackbox log for transfer function analysis'
          );
        }

        const idx = sessionIndex ?? 0;
        if (idx >= parseResult.sessions.length) {
          return createResponse<PIDAnalysisResult>(
            undefined,
            `Session index ${idx} out of range (log has ${parseResult.sessions.length} sessions)`
          );
        }

        const session = parseResult.sessions[idx];
        const flightPIDs = extractFlightPIDs(session.header.rawHeaders);

        let flightStyle: 'smooth' | 'balanced' | 'aggressive' = 'balanced';
        let droneSize: import('@shared/types/profile.types').DroneSize | undefined;
        let droneWeight: number | undefined;
        if (deps.profileManager) {
          try {
            const currentProfile = await deps.profileManager.getCurrentProfile();
            if (currentProfile?.flightStyle) {
              flightStyle = currentProfile.flightStyle;
            }
            if (currentProfile?.size) {
              droneSize = currentProfile.size;
            }
            if (currentProfile?.weight) {
              droneWeight = currentProfile.weight;
            }
          } catch {
            // Fall back to balanced
          }
        }

        const result = await analyzeTransferFunction(
          session.flightData,
          idx,
          currentPIDs,
          (progress) => {
            event.sender.send(IPCChannel.EVENT_ANALYSIS_PROGRESS, progress);
          },
          flightPIDs,
          session.header.rawHeaders,
          flightStyle,
          undefined,
          droneSize,
          droneWeight
        );

        logger.info(
          `Transfer function analysis complete: ${result.recommendations.length} recommendations, ${result.analysisTimeMs}ms`
        );

        emitEvent('analysis', 'complete', {
          mode: 'flash',
          durationMs: result.analysisTimeMs ?? 0,
          recCount: result.recommendations.length,
        });
        if (result.recommendations.length === 0) {
          emitEvent('analysis', 'no_recommendations', { mode: 'flash' });
        }

        return createResponse<PIDAnalysisResult>(result);
      } catch (error) {
        emitEvent('error', 'analysis_failed', {
          mode: 'flash',
          stage: 'tf',
          message: getErrorMessage(error),
        });
        logger.error('Failed to run transfer function analysis:', error);
        return createResponse<PIDAnalysisResult>(undefined, getErrorMessage(error));
      }
    }
  );
}
