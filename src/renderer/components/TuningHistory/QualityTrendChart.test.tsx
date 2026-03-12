import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QualityTrendChart } from './QualityTrendChart';
import type { CompletedTuningRecord } from '@shared/types/tuning-history.types';
import type { TuningType } from '@shared/types/tuning.types';
import { TUNING_TYPE } from '@shared/constants';

vi.mock('recharts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('recharts')>();
  const { cloneElement } = await import('react');
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      cloneElement(children, { width: 700, height: 180 }),
  };
});

function makeRecord(
  id: string,
  date: string,
  noiseFloorDb = -50,
  tuningType: TuningType = TUNING_TYPE.FILTER
): CompletedTuningRecord {
  return {
    id,
    profileId: 'p1',
    tuningType,
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: date,
    baselineSnapshotId: null,
    postFilterSnapshotId: null,
    postTuningSnapshotId: null,
    filterLogId: null,
    pidLogId: null,
    verificationLogId: null,
    appliedFilterChanges: [],
    appliedPIDChanges: [],
    appliedFeedforwardChanges: [],
    filterMetrics: {
      noiseLevel: 'low',
      roll: { noiseFloorDb, peakCount: 0 },
      pitch: { noiseFloorDb, peakCount: 0 },
      yaw: { noiseFloorDb, peakCount: 0 },
      segmentsUsed: 3,
      summary: 'OK',
    },
    pidMetrics: {
      roll: {
        meanOvershoot: 10,
        meanRiseTimeMs: 15,
        meanSettlingTimeMs: 100,
        meanLatencyMs: 5,
        meanTrackingErrorRMS: 0.1,
      },
      pitch: {
        meanOvershoot: 10,
        meanRiseTimeMs: 15,
        meanSettlingTimeMs: 100,
        meanLatencyMs: 5,
        meanTrackingErrorRMS: 0.1,
      },
      yaw: {
        meanOvershoot: 10,
        meanRiseTimeMs: 15,
        meanSettlingTimeMs: 100,
        meanLatencyMs: 5,
        meanTrackingErrorRMS: 0.1,
      },
      stepsDetected: 20,
      currentPIDs: {
        roll: { P: 45, I: 80, D: 30 },
        pitch: { P: 47, I: 82, D: 32 },
        yaw: { P: 35, I: 90, D: 0 },
      },
      summary: 'OK',
    },
    verificationMetrics: null,
    verificationPidMetrics: null,
    quickLogId: null,
    transferFunctionMetrics: null,
  };
}

describe('QualityTrendChart', () => {
  it('renders nothing with fewer than 2 scored records', () => {
    const { container } = render(
      <QualityTrendChart history={[makeRecord('r1', '2026-02-01T00:00:00Z')]} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing with empty history', () => {
    const { container } = render(<QualityTrendChart history={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders chart with 2+ scored records', () => {
    const records = [
      makeRecord('r1', '2026-02-10T00:00:00Z'),
      makeRecord('r2', '2026-02-01T00:00:00Z'),
    ];
    const { container } = render(<QualityTrendChart history={records} />);
    expect(screen.getByText('Tune Quality Trend')).toBeInTheDocument();
    expect(container.querySelector('.recharts-wrapper')).not.toBeNull();
  });

  it('renders heading text', () => {
    const records = [
      makeRecord('r1', '2026-02-10T00:00:00Z'),
      makeRecord('r2', '2026-02-01T00:00:00Z'),
    ];
    render(<QualityTrendChart history={records} />);
    expect(screen.getByText('Tune Quality Trend')).toBeInTheDocument();
  });

  it('renders legend with all three tuning types', () => {
    const records = [
      makeRecord('r1', '2026-02-10T00:00:00Z'),
      makeRecord('r2', '2026-02-01T00:00:00Z'),
    ];
    render(<QualityTrendChart history={records} />);
    expect(screen.getByText('Filter Tune')).toBeInTheDocument();
    expect(screen.getByText('PID Tune')).toBeInTheDocument();
    expect(screen.getByText('Flash Tune')).toBeInTheDocument();
  });

  it('renders separate lines per tuning type', () => {
    const records = [
      makeRecord('r1', '2026-02-10T00:00:00Z', -50, TUNING_TYPE.FILTER),
      makeRecord('r2', '2026-02-05T00:00:00Z', -45, TUNING_TYPE.PID),
      makeRecord('r3', '2026-02-01T00:00:00Z', -40, TUNING_TYPE.FLASH),
    ];
    const { container } = render(<QualityTrendChart history={records} />);
    // 3 Line components render 3 .recharts-line elements
    const lines = container.querySelectorAll('.recharts-line');
    expect(lines.length).toBe(3);
  });

  it('skips records with null scores', () => {
    const nullRecord: CompletedTuningRecord = {
      id: 'r0',
      profileId: 'p1',
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-15T00:00:00Z',
      baselineSnapshotId: null,
      postFilterSnapshotId: null,
      postTuningSnapshotId: null,
      filterLogId: null,
      pidLogId: null,
      verificationLogId: null,
      appliedFilterChanges: [],
      appliedPIDChanges: [],
      appliedFeedforwardChanges: [],
      filterMetrics: null,
      pidMetrics: null,
      verificationMetrics: null,
      verificationPidMetrics: null,
      quickLogId: null,
      transferFunctionMetrics: null,
    };
    const records = [
      makeRecord('r1', '2026-02-10T00:00:00Z'),
      nullRecord,
      makeRecord('r2', '2026-02-01T00:00:00Z'),
    ];
    const { container } = render(<QualityTrendChart history={records} />);
    // Should still render — 2 scoreable records remain
    expect(container.querySelector('.recharts-wrapper')).not.toBeNull();
  });
});
