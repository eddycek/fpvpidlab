/**
 * TuningHistoryManager
 *
 * Archives completed tuning sessions as history records for comparison.
 * One file per profile: {dataDir}/tuning-history/{profileId}.json
 */

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import type { TuningSession } from '@shared/types/tuning.types';
import { APP_VERSION, TUNING_PHASE } from '@shared/constants';
import type { TuningType } from '@shared/types/tuning.types';
import { ITERATION_LOOKBACK_DAYS } from '../analysis/constants';
import type {
  CompletedTuningRecord,
  FilterMetricsSummary,
  PIDMetricsSummary,
  TransferFunctionMetricsSummary,
} from '@shared/types/tuning-history.types';
import { logger } from '../utils/logger';

export class TuningHistoryManager {
  private dataDir: string;

  constructor(basePath: string) {
    this.dataDir = join(basePath, 'tuning-history');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    logger.info('TuningHistoryManager initialized');
  }

  /**
   * Archive a completed tuning session as a history record.
   * Appends to the profile's history file (oldest-first on disk).
   *
   * @throws if session.phase !== 'completed'
   */
  async archiveSession(session: TuningSession): Promise<CompletedTuningRecord> {
    if (session.phase !== TUNING_PHASE.COMPLETED) {
      throw new Error(`Cannot archive non-completed session (phase: ${session.phase})`);
    }

    const record: CompletedTuningRecord = {
      id: randomUUID(),
      profileId: session.profileId,
      startedAt: session.startedAt,
      completedAt: session.updatedAt,
      baselineSnapshotId: session.baselineSnapshotId ?? null,
      postFilterSnapshotId: session.postFilterSnapshotId ?? null,
      postTuningSnapshotId: session.postTuningSnapshotId ?? null,
      tuningType: session.tuningType,
      filterLogId: session.filterLogId ?? null,
      pidLogId: session.pidLogId ?? null,
      quickLogId: session.quickLogId ?? null,
      verificationLogId: session.verificationLogId ?? null,
      appliedFilterChanges: session.appliedFilterChanges ?? [],
      appliedPIDChanges: session.appliedPIDChanges ?? [],
      appliedFeedforwardChanges: session.appliedFeedforwardChanges ?? [],
      filterMetrics: session.filterMetrics ?? null,
      pidMetrics: session.pidMetrics ?? null,
      verificationMetrics: session.verificationMetrics ?? null,
      verificationPidMetrics: session.verificationPidMetrics ?? null,
      transferFunctionMetrics: session.transferFunctionMetrics ?? null,
      bfPidProfileIndex: session.bfPidProfileIndex,
      appVersion: APP_VERSION,
      ratesConfig: session.ratesConfig,
      autoReportId: session.autoReportId,
      convergence: session.convergence,
      verificationSimilarity: session.verificationSimilarity,
      iterationCount: session.iterationCount,
    };

    const existing = await this.loadRecords(session.profileId);
    existing.push(record); // Append = oldest-first on disk
    await this.saveRecords(session.profileId, existing);

    logger.info(`Tuning history archived: ${record.id} for profile ${session.profileId}`);
    return record;
  }

  /**
   * Get history records for a profile, newest-first.
   * Returns [] if no history exists or file is corrupted.
   */
  async getHistory(profileId: string): Promise<CompletedTuningRecord[]> {
    const records = await this.loadRecords(profileId);
    return records.reverse(); // Stored oldest-first, return newest-first
  }

  /**
   * Update verification metrics on the most recent history record for a profile.
   * Returns true if a record was updated, false if no history exists.
   */
  async updateLatestVerification(
    profileId: string,
    verificationMetrics?: FilterMetricsSummary,
    verificationTransferFunctionMetrics?: TransferFunctionMetricsSummary,
    verificationPidMetrics?: PIDMetricsSummary
  ): Promise<boolean> {
    const records = await this.loadRecords(profileId);
    if (records.length === 0) return false;

    // Records stored oldest-first — last element is the most recent
    const latest = records[records.length - 1];
    if (verificationMetrics) latest.verificationMetrics = verificationMetrics;
    if (verificationTransferFunctionMetrics) {
      latest.verificationTransferFunctionMetrics = verificationTransferFunctionMetrics;
    }
    if (verificationPidMetrics) latest.verificationPidMetrics = verificationPidMetrics;
    await this.saveRecords(profileId, records);
    logger.info(`Updated verification metrics on latest history record for profile ${profileId}`);
    return true;
  }

  /**
   * Update verification metrics on a specific history record by ID.
   * Returns true if the record was found and updated, false otherwise.
   */
  async updateRecordVerification(
    profileId: string,
    recordId: string,
    verificationMetrics?: FilterMetricsSummary,
    verificationPidMetrics?: PIDMetricsSummary
  ): Promise<boolean> {
    const records = await this.loadRecords(profileId);
    const record = records.find((r) => r.id === recordId);
    if (!record) return false;

    if (verificationMetrics) record.verificationMetrics = verificationMetrics;
    if (verificationPidMetrics) record.verificationPidMetrics = verificationPidMetrics;
    await this.saveRecords(profileId, records);
    logger.info(`Updated verification metrics on history record ${recordId}`);
    return true;
  }

  /**
   * Update PID verification metrics on the most recent history record.
   * Used by PID Tune verification flow.
   */
  async updateLatestPidVerification(
    profileId: string,
    verificationPidMetrics: PIDMetricsSummary
  ): Promise<boolean> {
    const records = await this.loadRecords(profileId);
    if (records.length === 0) return false;

    const latest = records[records.length - 1];
    latest.verificationPidMetrics = verificationPidMetrics;
    await this.saveRecords(profileId, records);
    logger.info(
      `Updated PID verification metrics on latest history record for profile ${profileId}`
    );
    return true;
  }

  /**
   * Count recent completed tuning sessions of a given type within the lookback window.
   * Used by Layer 4 (iteration tracking) to detect tuning loops.
   */
  async getRecentIterationCount(
    profileId: string,
    tuningType: TuningType,
    lookbackDays: number = ITERATION_LOOKBACK_DAYS
  ): Promise<number> {
    const records = await this.loadRecords(profileId);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);
    const cutoffIso = cutoff.toISOString();

    return records.filter((r) => r.tuningType === tuningType && r.completedAt >= cutoffIso).length;
  }

  /**
   * Delete all history for a profile. No-op if none exists.
   */
  async deleteHistory(profileId: string): Promise<void> {
    const filePath = this.historyPath(profileId);
    try {
      await fs.unlink(filePath);
      logger.info(`Tuning history deleted for profile ${profileId}`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return; // No history, no-op
      }
      throw error;
    }
  }

  private historyPath(profileId: string): string {
    return join(this.dataDir, `${profileId}.json`);
  }

  private async loadRecords(profileId: string): Promise<CompletedTuningRecord[]> {
    const filePath = this.historyPath(profileId);
    try {
      const json = await fs.readFile(filePath, 'utf-8');
      const records = JSON.parse(json) as CompletedTuningRecord[];
      return records;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      logger.warn(
        `Failed to load tuning history for profile ${profileId}, treating as empty`,
        error
      );
      return [];
    }
  }

  private async saveRecords(profileId: string, records: CompletedTuningRecord[]): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    const filePath = this.historyPath(profileId);
    await fs.writeFile(filePath, JSON.stringify(records, null, 2), 'utf-8');
  }
}
