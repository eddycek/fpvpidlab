import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TuningCompletionSummary } from './TuningCompletionSummary';
import type { TuningSession } from '@shared/types/tuning.types';
import type {
  CompactSpectrum,
  FilterMetricsSummary,
  PIDMetricsSummary,
} from '@shared/types/tuning-history.types';
import { TUNING_PHASE, TUNING_TYPE } from '@shared/constants';

// ResponsiveContainer mock
vi.mock('recharts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('recharts')>();
  const { cloneElement } = await import('react');
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      cloneElement(children, { width: 700, height: 260 }),
  };
});

const spectrum: CompactSpectrum = {
  frequencies: [100, 200, 300],
  roll: [-30, -35, -40],
  pitch: [-32, -37, -42],
  yaw: [-34, -39, -44],
};

const filterMetrics: FilterMetricsSummary = {
  noiseLevel: 'low',
  roll: { noiseFloorDb: -40, peakCount: 1 },
  pitch: { noiseFloorDb: -38, peakCount: 0 },
  yaw: { noiseFloorDb: -42, peakCount: 0 },
  segmentsUsed: 3,
  summary: 'Low noise',
  spectrum,
};

const pidMetrics: PIDMetricsSummary = {
  roll: { meanOvershoot: 5, meanRiseTimeMs: 20, meanSettlingTimeMs: 50, meanLatencyMs: 8 },
  pitch: { meanOvershoot: 8, meanRiseTimeMs: 22, meanSettlingTimeMs: 55, meanLatencyMs: 9 },
  yaw: { meanOvershoot: 3, meanRiseTimeMs: 30, meanSettlingTimeMs: 60, meanLatencyMs: 10 },
  stepsDetected: 12,
  currentPIDs: {
    roll: { P: 45, I: 80, D: 30 },
    pitch: { P: 47, I: 84, D: 32 },
    yaw: { P: 45, I: 80, D: 0 },
  },
  summary: 'Good response',
};

const verificationMetrics: FilterMetricsSummary = {
  noiseLevel: 'low',
  roll: { noiseFloorDb: -52, peakCount: 0 },
  pitch: { noiseFloorDb: -50, peakCount: 0 },
  yaw: { noiseFloorDb: -54, peakCount: 0 },
  segmentsUsed: 3,
  summary: 'Improved',
  spectrum: {
    frequencies: [100, 200, 300],
    roll: [-42, -47, -52],
    pitch: [-44, -49, -54],
    yaw: [-46, -51, -56],
  },
};

const baseSession: TuningSession = {
  profileId: 'profile-1',
  phase: TUNING_PHASE.COMPLETED,
  startedAt: '2026-02-10T10:00:00Z',
  updatedAt: '2026-02-10T10:30:00Z',
  filterLogId: 'log-f1',
  pidLogId: 'log-p1',
  appliedFilterChanges: [{ setting: 'gyro_lpf1_static_hz', previousValue: 250, newValue: 300 }],
  appliedPIDChanges: [{ setting: 'pid_roll_p', previousValue: 45, newValue: 50 }],
  filterMetrics,
  pidMetrics,
};

describe('TuningCompletionSummary', () => {
  const onDismiss = vi.fn();
  const onStartNew = vi.fn();

  it('renders title and timestamp', () => {
    render(
      <TuningCompletionSummary
        session={baseSession}
        onDismiss={onDismiss}
        onStartNew={onStartNew}
      />
    );

    expect(screen.getByText(/Deep Tune Complete/)).toBeInTheDocument();
    expect(screen.getByText(/Duration:/)).toBeInTheDocument();
    expect(screen.getByText(/2 flights/)).toBeInTheDocument();
  });

  it('shows noise comparison chart when verification data available', () => {
    const session = { ...baseSession, verificationMetrics, verificationLogId: 'log-ver' };
    const { container } = render(
      <TuningCompletionSummary session={session} onDismiss={onDismiss} onStartNew={onStartNew} />
    );

    expect(screen.getByText('Noise Comparison')).toBeInTheDocument();
    expect(container.querySelector('.recharts-wrapper')).not.toBeNull();
  });

  it('shows numeric noise when no verification', () => {
    render(
      <TuningCompletionSummary
        session={baseSession}
        onDismiss={onDismiss}
        onStartNew={onStartNew}
      />
    );

    expect(screen.getByText('Filter Analysis')).toBeInTheDocument();
    expect(screen.getByText(/Roll -40 dB/)).toBeInTheDocument();
    expect(screen.queryByText('Noise Comparison')).not.toBeInTheDocument();
  });

  it('shows hint about verification when skipped', () => {
    render(
      <TuningCompletionSummary
        session={baseSession}
        onDismiss={onDismiss}
        onStartNew={onStartNew}
      />
    );

    expect(screen.getByText(/Fly a verification hover/)).toBeInTheDocument();
  });

  it('does not show hint when verification available', () => {
    const session = { ...baseSession, verificationMetrics };
    render(
      <TuningCompletionSummary session={session} onDismiss={onDismiss} onStartNew={onStartNew} />
    );

    expect(screen.queryByText(/Fly a verification hover/)).not.toBeInTheDocument();
  });

  it('renders filter and PID changes', () => {
    render(
      <TuningCompletionSummary
        session={baseSession}
        onDismiss={onDismiss}
        onStartNew={onStartNew}
      />
    );

    expect(screen.getByText('Filter Changes (1)')).toBeInTheDocument();
    expect(screen.getByText('PID Changes (1)')).toBeInTheDocument();
    expect(screen.getByText('gyro_lpf1_static_hz')).toBeInTheDocument();
    expect(screen.getByText('pid_roll_p')).toBeInTheDocument();
  });

  it('renders PID step response metrics', () => {
    render(
      <TuningCompletionSummary
        session={baseSession}
        onDismiss={onDismiss}
        onStartNew={onStartNew}
      />
    );

    expect(screen.getByText(/Step Response Metrics/)).toBeInTheDocument();
    expect(screen.getByText(/before PID changes/)).toBeInTheDocument();
    expect(screen.getByText('12 steps detected')).toBeInTheDocument();
    expect(screen.getByText(/Overshoot: 5.0%/)).toBeInTheDocument();
  });

  it('calls onDismiss when Dismiss clicked', async () => {
    const user = userEvent.setup();
    render(
      <TuningCompletionSummary
        session={baseSession}
        onDismiss={onDismiss}
        onStartNew={onStartNew}
      />
    );

    await user.click(screen.getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('calls onStartNew when Start New clicked', async () => {
    const user = userEvent.setup();
    render(
      <TuningCompletionSummary
        session={baseSession}
        onDismiss={onDismiss}
        onStartNew={onStartNew}
      />
    );

    await user.click(screen.getByText('Start New Tuning Cycle'));
    expect(onStartNew).toHaveBeenCalled();
  });

  it('shows re-analyze button when verification data and callback available', () => {
    const onReanalyze = vi.fn();
    const session = { ...baseSession, verificationMetrics, verificationLogId: 'log-ver' };
    render(
      <TuningCompletionSummary
        session={session}
        onDismiss={onDismiss}
        onStartNew={onStartNew}
        onReanalyzeVerification={onReanalyze}
      />
    );

    expect(screen.getByText('Re-analyze with different session')).toBeInTheDocument();
  });

  it('calls onReanalyzeVerification when re-analyze clicked', async () => {
    const user = userEvent.setup();
    const onReanalyze = vi.fn();
    const session = { ...baseSession, verificationMetrics, verificationLogId: 'log-ver' };
    render(
      <TuningCompletionSummary
        session={session}
        onDismiss={onDismiss}
        onStartNew={onStartNew}
        onReanalyzeVerification={onReanalyze}
      />
    );

    await user.click(screen.getByText('Re-analyze with different session'));
    expect(onReanalyze).toHaveBeenCalled();
  });

  it('does not show re-analyze button without callback', () => {
    const session = { ...baseSession, verificationMetrics, verificationLogId: 'log-ver' };
    render(
      <TuningCompletionSummary session={session} onDismiss={onDismiss} onStartNew={onStartNew} />
    );

    expect(screen.queryByText('Re-analyze with different session')).not.toBeInTheDocument();
  });

  it('handles session with no changes gracefully', () => {
    const session: TuningSession = {
      ...baseSession,
      appliedFilterChanges: [],
      appliedPIDChanges: [],
    };
    render(
      <TuningCompletionSummary session={session} onDismiss={onDismiss} onStartNew={onStartNew} />
    );

    expect(screen.queryByText(/Filter Changes/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PID Changes/)).not.toBeInTheDocument();
  });

  it('shows quality score badge with tier label next to title', () => {
    const { container } = render(
      <TuningCompletionSummary
        session={baseSession}
        onDismiss={onDismiss}
        onStartNew={onStartNew}
      />
    );

    const badge = container.querySelector('.quality-score-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toMatch(/\d+\s+(Excellent|Good|Fair|Poor)/);
  });

  it('shows "Flash Tune Complete" for quick tuning sessions', () => {
    const quickSession: TuningSession = {
      ...baseSession,
      tuningType: TUNING_TYPE.FLASH,
      quickLogId: 'log-q1',
      filterLogId: undefined,
      pidLogId: undefined,
    };
    render(
      <TuningCompletionSummary
        session={quickSession}
        onDismiss={onDismiss}
        onStartNew={onStartNew}
      />
    );

    expect(screen.getByText(/Flash Tune Complete/)).toBeInTheDocument();
    expect(screen.getByText(/1 flight/)).toBeInTheDocument();
  });

  it('shows "Deep Tune Complete" for guided tuning sessions', () => {
    render(
      <TuningCompletionSummary
        session={baseSession}
        onDismiss={onDismiss}
        onStartNew={onStartNew}
      />
    );

    expect(screen.getByText(/Deep Tune Complete/)).toBeInTheDocument();
  });

  it('includes pidMetrics in quality score (higher score than filter-only)', () => {
    // With pidMetrics: 4 components score → higher total
    const { container } = render(
      <TuningCompletionSummary
        session={baseSession}
        onDismiss={onDismiss}
        onStartNew={onStartNew}
      />
    );

    const badge = container.querySelector('.quality-score-badge');
    expect(badge).not.toBeNull();
    // With good PID metrics + filter metrics, score should be ≥60 (Good or Excellent)
    const scoreMatch = badge!.textContent!.match(/(\d+)/);
    expect(scoreMatch).not.toBeNull();
    expect(Number(scoreMatch![1])).toBeGreaterThanOrEqual(60);
  });
});
