import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TuningHistoryPanel } from './TuningHistoryPanel';
import type { CompletedTuningRecord } from '@shared/types/tuning-history.types';
import { TUNING_TYPE } from '@shared/constants';

// ResponsiveContainer mock (for expanded detail with chart)
vi.mock('recharts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('recharts')>();
  const { cloneElement } = await import('react');
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      cloneElement(children, { width: 700, height: 260 }),
  };
});

const makeRecord = (
  id: string,
  date: string,
  filterCount = 2,
  pidCount = 1
): CompletedTuningRecord => ({
  id,
  profileId: 'profile-1',
  startedAt: '2026-01-01T00:00:00Z',
  completedAt: date,
  baselineSnapshotId: null,
  postFilterSnapshotId: null,
  postTuningSnapshotId: null,
  filterLogId: null,
  pidLogId: null,
  verificationLogId: null,
  appliedFilterChanges: Array.from({ length: filterCount }, (_, i) => ({
    setting: `filter_setting_${i}`,
    previousValue: 100,
    newValue: 120,
  })),
  appliedPIDChanges: Array.from({ length: pidCount }, (_, i) => ({
    setting: `pid_setting_${i}`,
    previousValue: 45,
    newValue: 50,
  })),
  appliedFeedforwardChanges: [],
  filterMetrics: {
    noiseLevel: 'low',
    roll: { noiseFloorDb: -40, peakCount: 1 },
    pitch: { noiseFloorDb: -38, peakCount: 0 },
    yaw: { noiseFloorDb: -42, peakCount: 0 },
    segmentsUsed: 3,
    summary: 'Low noise',
  },
  pidMetrics: null,
  verificationMetrics: null,
  verificationPidMetrics: null,
  quickLogId: null,
  transferFunctionMetrics: null,
});

describe('TuningHistoryPanel', () => {
  it('renders nothing when loading', () => {
    const { container } = render(<TuningHistoryPanel history={[]} loading={true} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when history is empty', () => {
    const { container } = render(<TuningHistoryPanel history={[]} loading={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders title when history exists', () => {
    const records = [makeRecord('r1', '2026-02-10T00:00:00Z')];
    render(<TuningHistoryPanel history={records} loading={false} />);

    expect(screen.getByText('Tuning History')).toBeInTheDocument();
  });

  it('renders history cards with date and summary', () => {
    const records = [
      makeRecord('r1', '2026-02-10T00:00:00Z', 3, 2),
      makeRecord('r2', '2026-01-28T00:00:00Z', 1, 0),
    ];
    render(<TuningHistoryPanel history={records} loading={false} />);

    expect(screen.getByText('Feb 10, 2026')).toBeInTheDocument();
    expect(screen.getByText('Jan 28, 2026')).toBeInTheDocument();
    expect(screen.getByText(/3 filter \+ 2 PID changes/)).toBeInTheDocument();
    expect(screen.getByText(/1 filter changes/)).toBeInTheDocument();
  });

  it('expands card on click', async () => {
    const user = userEvent.setup();
    const records = [makeRecord('r1', '2026-02-10T00:00:00Z')];
    render(<TuningHistoryPanel history={records} loading={false} />);

    const header = screen.getByRole('button', { name: /Feb 10, 2026/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');

    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapses card on second click', async () => {
    const user = userEvent.setup();
    const records = [makeRecord('r1', '2026-02-10T00:00:00Z')];
    render(<TuningHistoryPanel history={records} loading={false} />);

    const header = screen.getByRole('button', { name: /Feb 10, 2026/ });
    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');

    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows expanded detail with filter changes', async () => {
    const user = userEvent.setup();
    const records = [makeRecord('r1', '2026-02-10T00:00:00Z')];
    render(<TuningHistoryPanel history={records} loading={false} />);

    await user.click(screen.getByRole('button', { name: /Feb 10, 2026/ }));

    expect(screen.getByText('Filter Changes (2)')).toBeInTheDocument();
    expect(screen.getByText('filter_setting_0')).toBeInTheDocument();
  });

  it('shows duration and flight count in expanded detail', async () => {
    const user = userEvent.setup();
    const record = makeRecord('r1', '2026-01-01T01:30:00Z');
    record.filterLogId = 'log-f';
    record.pidLogId = 'log-p';
    render(<TuningHistoryPanel history={[record]} loading={false} />);

    await user.click(screen.getByRole('button', { name: /Jan 1, 2026/ }));

    expect(screen.getByText(/Duration: 90 min/)).toBeInTheDocument();
    expect(screen.getByText(/2 flights/)).toBeInTheDocument();
  });

  it('only expands one card at a time', async () => {
    const user = userEvent.setup();
    const records = [
      makeRecord('r1', '2026-02-10T00:00:00Z'),
      makeRecord('r2', '2026-01-28T00:00:00Z'),
    ];
    render(<TuningHistoryPanel history={records} loading={false} />);

    const headers = screen.getAllByRole('button');
    await user.click(headers[0]);
    expect(headers[0]).toHaveAttribute('aria-expanded', 'true');

    await user.click(headers[1]);
    expect(headers[0]).toHaveAttribute('aria-expanded', 'false');
    expect(headers[1]).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows tuning type badge for all records', () => {
    const guided = makeRecord('r1', '2026-02-10T00:00:00Z');
    const quick = makeRecord('r2', '2026-02-01T00:00:00Z');
    quick.tuningType = TUNING_TYPE.FLASH;
    render(<TuningHistoryPanel history={[guided, quick]} loading={false} />);

    const badges = document.querySelectorAll('.tuning-type-badge');
    const badgeTexts = Array.from(badges).map((b) => b.textContent);
    expect(badgeTexts).toContain('Filter Tune');
    expect(badgeTexts).toContain('Flash Tune');
  });

  it('shows noise level in summary', () => {
    const records = [makeRecord('r1', '2026-02-10T00:00:00Z')];
    render(<TuningHistoryPanel history={records} loading={false} />);

    expect(screen.getByText(/Noise: low/)).toBeInTheDocument();
  });

  it('shows quality score badge with tier label in card header', () => {
    const record = makeRecord('r1', '2026-02-10T00:00:00Z');
    // Add PID metrics so score can be computed
    record.pidMetrics = {
      roll: {
        meanOvershoot: 5,
        meanRiseTimeMs: 10,
        meanSettlingTimeMs: 60,
        meanLatencyMs: 3,
        meanTrackingErrorRMS: 0.05,
      },
      pitch: {
        meanOvershoot: 5,
        meanRiseTimeMs: 10,
        meanSettlingTimeMs: 60,
        meanLatencyMs: 3,
        meanTrackingErrorRMS: 0.05,
      },
      yaw: {
        meanOvershoot: 5,
        meanRiseTimeMs: 10,
        meanSettlingTimeMs: 60,
        meanLatencyMs: 3,
        meanTrackingErrorRMS: 0.05,
      },
      stepsDetected: 20,
      currentPIDs: {
        roll: { P: 45, I: 80, D: 30 },
        pitch: { P: 47, I: 82, D: 32 },
        yaw: { P: 35, I: 90, D: 0 },
      },
      summary: 'Good',
    };
    const { container } = render(<TuningHistoryPanel history={[record]} loading={false} />);

    const badge = container.querySelector('.quality-score-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toMatch(/\d+\s+(Excellent|Good|Fair|Poor)/);
  });

  describe('re-analyze verification', () => {
    const makeRecordWithVerification = (id: string, verLogId: string | null) => {
      const record = makeRecord(id, '2026-02-10T00:00:00Z');
      record.verificationLogId = verLogId;
      if (verLogId) {
        record.verificationMetrics = {
          noiseLevel: 'low',
          roll: { noiseFloorDb: -50, peakCount: 0 },
          pitch: { noiseFloorDb: -48, peakCount: 0 },
          yaw: { noiseFloorDb: -52, peakCount: 0 },
          segmentsUsed: 2,
          summary: 'Better',
          spectrum: {
            frequencies: [100, 200, 300],
            roll: [-40, -50, -60],
            pitch: [-38, -48, -58],
            yaw: [-42, -52, -62],
          },
        };
        // Also need filterMetrics.spectrum for hasComparison
        record.filterMetrics = {
          ...record.filterMetrics!,
          spectrum: {
            frequencies: [100, 200, 300],
            roll: [-30, -40, -50],
            pitch: [-28, -38, -48],
            yaw: [-32, -42, -52],
          },
        };
      }
      return record;
    };

    it('shows re-analyze button when log available', async () => {
      const user = userEvent.setup();
      const record = makeRecordWithVerification('r1', 'log-ver-1');
      const onReanalyze = vi.fn();
      render(
        <TuningHistoryPanel
          history={[record]}
          loading={false}
          onReanalyzeHistory={onReanalyze}
          availableLogIds={new Set(['log-ver-1'])}
        />
      );

      await user.click(screen.getByRole('button', { name: /Feb 10, 2026/ }));
      const link = screen.getByText('Re-analyze with different session');
      expect(link).toBeInTheDocument();
    });

    it('calls onReanalyzeHistory with correct record on click', async () => {
      const user = userEvent.setup();
      const record = makeRecordWithVerification('r1', 'log-ver-1');
      const onReanalyze = vi.fn();
      render(
        <TuningHistoryPanel
          history={[record]}
          loading={false}
          onReanalyzeHistory={onReanalyze}
          availableLogIds={new Set(['log-ver-1'])}
        />
      );

      await user.click(screen.getByRole('button', { name: /Feb 10, 2026/ }));
      await user.click(screen.getByText('Re-analyze with different session'));
      expect(onReanalyze).toHaveBeenCalledWith(record);
    });

    it('hides re-analyze button when log deleted', async () => {
      const user = userEvent.setup();
      const record = makeRecordWithVerification('r1', 'log-ver-1');
      const onReanalyze = vi.fn();
      render(
        <TuningHistoryPanel
          history={[record]}
          loading={false}
          onReanalyzeHistory={onReanalyze}
          availableLogIds={new Set()} // log not available
        />
      );

      await user.click(screen.getByRole('button', { name: /Feb 10, 2026/ }));
      expect(screen.queryByText('Re-analyze with different session')).not.toBeInTheDocument();
    });

    it('hides re-analyze button when record has no verificationLogId', async () => {
      const user = userEvent.setup();
      const record = makeRecordWithVerification('r1', null);
      const onReanalyze = vi.fn();
      render(
        <TuningHistoryPanel
          history={[record]}
          loading={false}
          onReanalyzeHistory={onReanalyze}
          availableLogIds={new Set(['some-other-log'])}
        />
      );

      await user.click(screen.getByRole('button', { name: /Feb 10, 2026/ }));
      expect(screen.queryByText('Re-analyze with different session')).not.toBeInTheDocument();
    });
  });

  it('shows session numbers matching trend chart order', () => {
    const records = [
      makeRecord('r1', '2026-02-10T00:00:00Z'), // newest → #2
      makeRecord('r2', '2026-01-28T00:00:00Z'), // oldest → #1
    ];
    const { container } = render(<TuningHistoryPanel history={records} loading={false} />);

    const numbers = container.querySelectorAll('.tuning-history-session-number');
    expect(numbers).toHaveLength(2);
    expect(numbers[0]).toHaveTextContent('#2');
    expect(numbers[1]).toHaveTextContent('#1');
  });

  it('renders trend chart with 2+ records', () => {
    const r1 = makeRecord('r1', '2026-02-10T00:00:00Z');
    const r2 = makeRecord('r2', '2026-02-01T00:00:00Z');
    // Add PID metrics so scores are computable
    const pidMetrics = {
      roll: {
        meanOvershoot: 5,
        meanRiseTimeMs: 10,
        meanSettlingTimeMs: 60,
        meanLatencyMs: 3,
        meanTrackingErrorRMS: 0.05,
      },
      pitch: {
        meanOvershoot: 5,
        meanRiseTimeMs: 10,
        meanSettlingTimeMs: 60,
        meanLatencyMs: 3,
        meanTrackingErrorRMS: 0.05,
      },
      yaw: {
        meanOvershoot: 5,
        meanRiseTimeMs: 10,
        meanSettlingTimeMs: 60,
        meanLatencyMs: 3,
        meanTrackingErrorRMS: 0.05,
      },
      stepsDetected: 20,
      currentPIDs: {
        roll: { P: 45, I: 80, D: 30 },
        pitch: { P: 47, I: 82, D: 32 },
        yaw: { P: 35, I: 90, D: 0 },
      },
      summary: 'Good',
    };
    r1.pidMetrics = pidMetrics;
    r2.pidMetrics = pidMetrics;
    render(<TuningHistoryPanel history={[r1, r2]} loading={false} />);

    expect(screen.getByText('Tune Quality Trend')).toBeInTheDocument();
  });
});
