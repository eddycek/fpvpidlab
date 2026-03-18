import { describe, it, expect, vi } from 'vitest';
import { buildDiagnosticBundle } from './DiagnosticBundleBuilder';
import type { CompletedTuningRecord } from '@shared/types/tuning-history.types';

// Mock crypto
vi.mock('crypto', () => ({
  randomUUID: () => 'test-report-uuid',
  default: { randomUUID: () => 'test-report-uuid' },
}));

function makeRecord(overrides: Partial<CompletedTuningRecord> = {}): CompletedTuningRecord {
  return {
    id: 'rec-1',
    profileId: 'profile-1',
    startedAt: '2026-03-16T10:00:00.000Z',
    completedAt: '2026-03-16T10:30:00.000Z',
    tuningType: 'filter',
    baselineSnapshotId: 'snap-before',
    postFilterSnapshotId: null,
    postTuningSnapshotId: 'snap-after',
    filterLogId: 'log-1',
    pidLogId: null,
    quickLogId: null,
    verificationLogId: null,
    appliedFilterChanges: [{ setting: 'gyro_lpf1_static_hz', previousValue: 300, newValue: 200 }],
    appliedPIDChanges: [],
    appliedFeedforwardChanges: [],
    filterMetrics: {
      noiseLevel: 'medium',
      roll: { noiseFloorDb: -20, peakCount: 2, spectrum: [1, 2, 3] },
      pitch: { noiseFloorDb: -18, peakCount: 1 },
      yaw: { noiseFloorDb: -25, peakCount: 0 },
      segmentsUsed: 3,
      summary: 'test',
      dataQuality: { overall: 72, tier: 'good', warnings: ['few_segments'] },
    } as any,
    pidMetrics: null,
    verificationMetrics: null,
    verificationPidMetrics: null,
    transferFunctionMetrics: null,
    ...overrides,
  };
}

describe('DiagnosticBundleBuilder', () => {
  const baseDeps = {
    profileManager: null,
    snapshotManager: null,
    telemetrySettings: { installationId: 'install-123' },
    eventCollector: null,
  };

  it('builds bundle with correct metadata', async () => {
    const record = makeRecord();
    const bundle = await buildDiagnosticBundle(record, baseDeps, 'user@test.com', 'Bad LPF1');

    expect(bundle.reportId).toBe('test-report-uuid');
    expect(bundle.installationId).toBe('install-123');
    expect(bundle.userEmail).toBe('user@test.com');
    expect(bundle.userNote).toBe('Bad LPF1');
    expect(bundle.mode).toBe('filter');
    expect(bundle.timestamp).toBeDefined();
    expect(bundle.appVersion).toBeDefined();
  });

  it('extracts filter analysis from filterMetrics', async () => {
    const record = makeRecord();
    const bundle = await buildDiagnosticBundle(record, baseDeps);

    expect(bundle.filterAnalysis).toBeDefined();
    expect(bundle.filterAnalysis!.noiseLevel).toBe('medium');
    expect(bundle.filterAnalysis!.axisNoise).toEqual({
      roll: -20,
      pitch: -18,
      yaw: -25,
    });
    expect(bundle.filterAnalysis!.spectrum).toEqual([1, 2, 3]);
  });

  it('extracts PID analysis from pidMetrics', async () => {
    const record = makeRecord({
      tuningType: 'pid',
      filterMetrics: null,
      pidMetrics: {
        roll: { meanOvershoot: 15, meanRiseTimeMs: 30, meanSettlingTimeMs: 80, meanLatencyMs: 5 },
        pitch: { meanOvershoot: 12, meanRiseTimeMs: 28, meanSettlingTimeMs: 75, meanLatencyMs: 4 },
        yaw: { meanOvershoot: 8, meanRiseTimeMs: 35, meanSettlingTimeMs: 90, meanLatencyMs: 6 },
        stepsDetected: 20,
        dataQuality: { overall: 85, tier: 'excellent' },
      } as any,
    });
    const bundle = await buildDiagnosticBundle(record, baseDeps);

    expect(bundle.pidAnalysis).toBeDefined();
    expect(bundle.pidAnalysis!.stepsDetected).toBe(20);
    expect(bundle.pidAnalysis!.axisMetrics.roll.overshoot).toBe(15);
    expect(bundle.pidAnalysis!.axisMetrics.pitch.riseTime).toBe(28);
    expect(bundle.dataQuality.overall).toBe(85);
    expect(bundle.dataQuality.tier).toBe('excellent');
  });

  it('extracts transfer function metrics', async () => {
    const record = makeRecord({
      tuningType: 'flash',
      filterMetrics: null,
      transferFunctionMetrics: {
        roll: { bandwidthHz: 45, phaseMarginDeg: 55, dcGainDb: -2 },
        pitch: { bandwidthHz: 42, phaseMarginDeg: 50, dcGainDb: -3 },
        yaw: { bandwidthHz: 30, phaseMarginDeg: 60, dcGainDb: -1 },
      } as any,
    });
    const bundle = await buildDiagnosticBundle(record, baseDeps);

    expect(bundle.transferFunction).toBeDefined();
    expect(bundle.transferFunction!.bandwidth.roll).toBe(45);
    expect(bundle.transferFunction!.phaseMargin.pitch).toBe(50);
    expect(bundle.transferFunction!.dcGain.yaw).toBe(-1);
  });

  it('builds recommendations from recommendationTraces', async () => {
    const record = makeRecord({
      recommendationTraces: [
        {
          ruleId: 'F-1',
          setting: 'gyro_lpf1_static_hz',
          confidence: 'high',
          explanation: 'High noise floor',
        },
      ] as any,
    });
    const bundle = await buildDiagnosticBundle(record, baseDeps);

    expect(bundle.recommendations).toHaveLength(1);
    expect(bundle.recommendations[0].ruleId).toBe('F-1');
    expect(bundle.recommendations[0].setting).toBe('gyro_lpf1_static_hz');
    expect(bundle.recommendations[0].confidence).toBe('high');
    expect(bundle.recommendations[0].explanation).toBe('High noise floor');
    expect(bundle.recommendations[0].currentValue).toBe(300);
    expect(bundle.recommendations[0].recommendedValue).toBe(200);
  });

  it('falls back to applied changes when no traces', async () => {
    const record = makeRecord({ recommendationTraces: undefined });
    const bundle = await buildDiagnosticBundle(record, baseDeps);

    expect(bundle.recommendations).toHaveLength(1);
    expect(bundle.recommendations[0].setting).toBe('gyro_lpf1_static_hz');
    expect(bundle.recommendations[0].ruleId).toBe('gyro_lpf1_static_hz');
    expect(bundle.recommendations[0].confidence).toBe('medium');
  });

  it('loads profile context when profileManager available', async () => {
    const mockProfileManager = {
      getProfile: vi.fn().mockResolvedValue({
        size: '5"',
        flightStyle: 'balanced',
        fcInfo: { version: '4.5.1', target: 'STM32F405' },
      }),
    };
    const deps = { ...baseDeps, profileManager: mockProfileManager };
    const record = makeRecord();
    const bundle = await buildDiagnosticBundle(record, deps);

    expect(bundle.droneSize).toBe('5"');
    expect(bundle.flightStyle).toBe('balanced');
    expect(bundle.bfVersion).toBe('4.5.1');
    expect(bundle.boardTarget).toBe('STM32F405');
  });

  it('loads snapshot CLI diffs', async () => {
    const mockSnapshotManager = {
      getSnapshot: vi.fn().mockImplementation((id: string) => {
        if (id === 'snap-before') return { cliDiff: 'set gyro_lpf1_static_hz = 300' };
        if (id === 'snap-after') return { cliDiff: 'set gyro_lpf1_static_hz = 200' };
        return null;
      }),
    };
    const deps = { ...baseDeps, snapshotManager: mockSnapshotManager };
    const record = makeRecord();
    const bundle = await buildDiagnosticBundle(record, deps);

    expect(bundle.cliDiffBefore).toBe('set gyro_lpf1_static_hz = 300');
    expect(bundle.cliDiffAfter).toBe('set gyro_lpf1_static_hz = 200');
  });

  it('includes verification delta when available', async () => {
    const record = makeRecord({
      verificationDelta: {
        noiseFloorDeltaDb: { roll: -3, pitch: -2, yaw: -4 },
        overallImprovement: 3,
      } as any,
    });
    const bundle = await buildDiagnosticBundle(record, baseDeps);

    expect(bundle.verification).toBeDefined();
    expect(bundle.verification!.overallImprovement).toBe(3);
    expect(bundle.verification!.noiseFloorDelta).toEqual({ roll: -3, pitch: -2, yaw: -4 });
  });

  it('filters telemetry events by sessionId', async () => {
    const mockEventCollector = {
      getEvents: vi.fn().mockReturnValue([
        { type: 'workflow', name: 'tuning_started', ts: '...', sessionId: 'sess-1' },
        { type: 'error', name: 'uncaught', ts: '...' },
        { type: 'analysis', name: 'complete', ts: '...', sessionId: 'sess-1' },
        { type: 'workflow', name: 'tuning_started', ts: '...', sessionId: 'sess-2' },
      ]),
    };
    const deps = { ...baseDeps, eventCollector: mockEventCollector };
    const record = makeRecord() as any;
    record.sessionId = 'sess-1';
    const bundle = await buildDiagnosticBundle(record, deps);

    expect(bundle.events).toHaveLength(2);
    expect(bundle.events[0].sessionId).toBe('sess-1');
    expect(bundle.events[1].sessionId).toBe('sess-1');
  });

  it('handles missing data gracefully', async () => {
    const record = makeRecord({
      filterMetrics: null,
      pidMetrics: null,
      transferFunctionMetrics: null,
      appliedFilterChanges: [],
      appliedPIDChanges: [],
      appliedFeedforwardChanges: [],
      baselineSnapshotId: null,
      postTuningSnapshotId: null,
    });
    const bundle = await buildDiagnosticBundle(record, baseDeps);

    expect(bundle.filterAnalysis).toBeUndefined();
    expect(bundle.pidAnalysis).toBeUndefined();
    expect(bundle.transferFunction).toBeUndefined();
    expect(bundle.recommendations).toEqual([]);
    expect(bundle.verification).toBeUndefined();
    expect(bundle.cliDiffBefore).toBeUndefined();
    expect(bundle.cliDiffAfter).toBeUndefined();
    expect(bundle.dataQuality).toEqual({ overall: 0, tier: 'unknown', warnings: [] });
  });

  it('uses fallback installationId when settings unavailable', async () => {
    const deps = { ...baseDeps, telemetrySettings: null };
    const record = makeRecord();
    const bundle = await buildDiagnosticBundle(record, deps);

    expect(bundle.installationId).toBe('unknown');
  });
});
