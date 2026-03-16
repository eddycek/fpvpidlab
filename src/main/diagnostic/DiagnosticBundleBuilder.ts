import { randomUUID } from 'crypto';
import { APP_VERSION } from '@shared/constants';
import type {
  DiagnosticBundle,
  DiagnosticRecommendation,
  DiagnosticFilterAnalysis,
  DiagnosticPIDAnalysis,
  DiagnosticTransferFunction,
  DiagnosticVerification,
} from '@shared/types/diagnostic.types';
import type { CompletedTuningRecord } from '@shared/types/tuning-history.types';
import type { TelemetryEvent } from '@shared/types/telemetry.types';
import { logger } from '../utils/logger';

interface BuilderDependencies {
  profileManager: any;
  snapshotManager: any;
  telemetrySettings: { installationId: string } | null;
  eventCollector: { getEvents(): TelemetryEvent[] } | null;
}

/**
 * Builds a DiagnosticBundle from a completed tuning record.
 * Assembles analysis results, recommendations, FC config, and context
 * into a single privacy-safe bundle for investigation.
 */
export async function buildDiagnosticBundle(
  record: CompletedTuningRecord,
  deps: BuilderDependencies,
  userEmail?: string,
  userNote?: string
): Promise<DiagnosticBundle> {
  const reportId = randomUUID();
  const installationId = deps.telemetrySettings?.installationId ?? 'unknown';

  // Profile context
  let droneSize: string | undefined;
  let flightStyle: string | undefined;
  let bfVersion: string | undefined;
  let boardTarget: string | undefined;

  if (deps.profileManager) {
    try {
      const profile = await deps.profileManager.getProfile(record.profileId);
      if (profile) {
        droneSize = profile.size;
        flightStyle = profile.flightStyle;
        bfVersion = profile.fcInfo?.version;
        boardTarget = profile.fcInfo?.target;
      }
    } catch (err) {
      logger.warn('DiagnosticBundleBuilder: failed to load profile:', err);
    }
  }

  // Snapshot CLI diffs
  let cliDiffBefore: string | undefined;
  let cliDiffAfter: string | undefined;

  if (deps.snapshotManager) {
    try {
      if (record.baselineSnapshotId) {
        const snap = await deps.snapshotManager.getSnapshot(record.baselineSnapshotId);
        if (snap) cliDiffBefore = snap.cliDiff;
      }
      if (record.postTuningSnapshotId) {
        const snap = await deps.snapshotManager.getSnapshot(record.postTuningSnapshotId);
        if (snap) cliDiffAfter = snap.cliDiff;
      }
    } catch (err) {
      logger.warn('DiagnosticBundleBuilder: failed to load snapshots:', err);
    }
  }

  // Data quality
  const dq =
    record.filterMetrics?.dataQuality ??
    record.pidMetrics?.dataQuality ??
    (record.transferFunctionMetrics as any)?.dataQuality;
  const dataQuality = {
    overall: dq?.overall ?? 0,
    tier: dq?.tier ?? 'unknown',
    warnings: dq?.warnings ?? [],
  };

  // Filter analysis
  let filterAnalysis: DiagnosticFilterAnalysis | undefined;
  if (record.filterMetrics) {
    const fm = record.filterMetrics;
    filterAnalysis = {
      noiseLevel: (fm as any).noiseLevel ?? 'unknown',
      axisNoise: {
        roll: fm.roll?.noiseFloorDb ?? 0,
        pitch: fm.pitch?.noiseFloorDb ?? 0,
        yaw: fm.yaw?.noiseFloorDb ?? 0,
      },
      peaks: (fm as any).peaks ?? [],
      spectrum: (fm.roll as any)?.spectrum ?? [],
      throttleSpectrogram: (fm as any).throttleSpectrogram,
      groupDelay: (fm as any).groupDelay,
    };
  }

  // PID analysis
  let pidAnalysis: DiagnosticPIDAnalysis | undefined;
  if (record.pidMetrics) {
    const pm = record.pidMetrics;
    pidAnalysis = {
      stepsDetected: (pm as any).stepsDetected ?? 0,
      axisMetrics: {},
      dTermEffectiveness: (pm as any).dTermEffectiveness,
      propWash: (pm as any).propWash,
    };
    for (const axis of ['roll', 'pitch', 'yaw'] as const) {
      const m = pm[axis];
      if (m) {
        pidAnalysis.axisMetrics[axis] = {
          overshoot: m.meanOvershoot ?? 0,
          riseTime: m.meanRiseTimeMs ?? 0,
          settling: m.meanSettlingTimeMs ?? 0,
          latency: m.meanLatencyMs ?? 0,
        };
      }
    }
  }

  // Transfer function
  let transferFunction: DiagnosticTransferFunction | undefined;
  if (record.transferFunctionMetrics) {
    const tf = record.transferFunctionMetrics;
    transferFunction = {
      bandwidth: {
        roll: tf.roll?.bandwidthHz ?? 0,
        pitch: tf.pitch?.bandwidthHz ?? 0,
        yaw: tf.yaw?.bandwidthHz ?? 0,
      },
      phaseMargin: {
        roll: tf.roll?.phaseMarginDeg ?? 0,
        pitch: tf.pitch?.phaseMarginDeg ?? 0,
        yaw: tf.yaw?.phaseMarginDeg ?? 0,
      },
      dcGain: {
        roll: (tf.roll as any)?.dcGainDb ?? 0,
        pitch: (tf.pitch as any)?.dcGainDb ?? 0,
        yaw: (tf.yaw as any)?.dcGainDb ?? 0,
      },
    };
  }

  // Recommendations from traces
  const recommendations: DiagnosticRecommendation[] = [];
  if (record.recommendationTraces) {
    for (const trace of record.recommendationTraces) {
      const allChanges = [
        ...(record.appliedFilterChanges ?? []),
        ...(record.appliedPIDChanges ?? []),
        ...(record.appliedFeedforwardChanges ?? []),
      ];
      const change = allChanges.find((c) => c.setting === trace.setting);
      recommendations.push({
        ruleId: trace.ruleId,
        setting: trace.setting,
        currentValue: change?.previousValue ?? 0,
        recommendedValue: change?.newValue ?? 0,
        confidence: trace.confidence ?? 'medium',
        explanation: (trace as any).explanation ?? '',
      });
    }
  } else {
    // Fallback: build from applied changes (no ruleId/explanation)
    const allChanges = [
      ...(record.appliedFilterChanges ?? []),
      ...(record.appliedPIDChanges ?? []),
      ...(record.appliedFeedforwardChanges ?? []),
    ];
    for (const change of allChanges) {
      recommendations.push({
        ruleId: change.setting ?? 'unknown',
        setting: change.setting ?? 'unknown',
        currentValue: change.previousValue ?? 0,
        recommendedValue: change.newValue ?? 0,
        confidence: 'medium',
        explanation: '',
      });
    }
  }

  // Verification
  let verification: DiagnosticVerification | undefined;
  if (record.verificationDelta) {
    const vd = record.verificationDelta;
    verification = {
      overallImprovement: vd.overallImprovement ?? 0,
    };
    if (vd.noiseFloorDeltaDb) {
      verification.noiseFloorDelta = vd.noiseFloorDeltaDb;
    }
    if (vd.overshootDeltaPct) {
      verification.overshootDelta = vd.overshootDeltaPct;
    }
  }

  // Related telemetry events (from this session)
  let events: TelemetryEvent[] = [];
  if (deps.eventCollector) {
    const allEvents = deps.eventCollector.getEvents();
    const sessionId = (record as any).sessionId;
    if (sessionId) {
      events = allEvents.filter((e) => e.sessionId === sessionId);
    }
  }

  return {
    reportId,
    installationId,
    sessionId: (record as any).sessionId,
    timestamp: new Date().toISOString(),
    appVersion: APP_VERSION,
    userEmail,
    userNote,
    mode: record.tuningType ?? 'filter',
    droneSize,
    flightStyle,
    bfVersion,
    boardTarget,
    dataQuality,
    filterAnalysis,
    pidAnalysis,
    transferFunction,
    recommendations,
    cliDiffBefore,
    cliDiffAfter,
    verification,
    events,
  };
}
