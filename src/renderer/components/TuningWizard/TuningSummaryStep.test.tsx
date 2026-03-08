import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TuningSummaryStep } from './TuningSummaryStep';
import type { FilterAnalysisResult, PIDAnalysisResult } from '@shared/types/analysis.types';
import type {
  ApplyRecommendationsProgress,
  ApplyRecommendationsResult,
} from '@shared/types/ipc.types';

const mockAxisNoiseProfile = {
  spectrum: { frequencies: new Float64Array(0), magnitudes: new Float64Array(0) },
  noiseFloorDb: -40,
  peaks: [],
};

const mockFilterResult: FilterAnalysisResult = {
  noise: {
    roll: mockAxisNoiseProfile,
    pitch: mockAxisNoiseProfile,
    yaw: mockAxisNoiseProfile,
    overallLevel: 'medium' as const,
  },
  recommendations: [
    {
      setting: 'gyro_lpf1_static_hz',
      currentValue: 250,
      recommendedValue: 200,
      reason: 'Reduce noise',
      impact: 'noise' as const,
      confidence: 'high' as const,
    },
  ],
  summary: 'Filter summary',
  analysisTimeMs: 500,
  sessionIndex: 0,
  segmentsUsed: 3,
};

const mockPidResult: PIDAnalysisResult = {
  roll: {
    responses: [],
    meanOvershoot: 10,
    meanRiseTimeMs: 50,
    meanSettlingTimeMs: 200,
    meanLatencyMs: 5,
    meanTrackingErrorRMS: 0,
  },
  pitch: {
    responses: [],
    meanOvershoot: 12,
    meanRiseTimeMs: 55,
    meanSettlingTimeMs: 210,
    meanLatencyMs: 5,
    meanTrackingErrorRMS: 0,
  },
  yaw: {
    responses: [],
    meanOvershoot: 8,
    meanRiseTimeMs: 60,
    meanSettlingTimeMs: 220,
    meanLatencyMs: 5,
    meanTrackingErrorRMS: 0,
  },
  recommendations: [
    {
      setting: 'pid_roll_d',
      currentValue: 40,
      recommendedValue: 35,
      reason: 'Reduce D',
      impact: 'stability' as const,
      confidence: 'medium' as const,
    },
  ],
  summary: 'PID summary',
  analysisTimeMs: 300,
  sessionIndex: 0,
  stepsDetected: 15,
  currentPIDs: {
    roll: { P: 45, I: 80, D: 40 },
    pitch: { P: 47, I: 84, D: 43 },
    yaw: { P: 45, I: 80, D: 0 },
  },
};

const mockApplyProgress: ApplyRecommendationsProgress = {
  stage: 'filter',
  message: 'Applying settings...',
  percent: 50,
};

const mockApplyResult: ApplyRecommendationsResult = {
  success: true,
  appliedFilters: 1,
  appliedPIDs: 1,
  appliedFeedforward: 0,
  snapshotId: 'snap-123',
  rebooted: true,
};

describe('TuningSummaryStep', () => {
  it('shows "no changes" when no recommendations', () => {
    const emptyFilterResult: FilterAnalysisResult = {
      ...mockFilterResult,
      recommendations: [],
    };
    const emptyPidResult: PIDAnalysisResult = {
      ...mockPidResult,
      recommendations: [],
    };

    render(
      <TuningSummaryStep
        filterResult={emptyFilterResult}
        pidResult={emptyPidResult}
        mode="full"
        onExit={vi.fn()}
        onApply={vi.fn()}
        applyState="idle"
        applyProgress={null}
        applyResult={null}
        applyError={null}
      />
    );

    expect(screen.getByText(/No changes recommended/)).toBeInTheDocument();
  });

  it('shows recommendation count pills', () => {
    render(
      <TuningSummaryStep
        filterResult={mockFilterResult}
        pidResult={mockPidResult}
        mode="full"
        onExit={vi.fn()}
        onApply={vi.fn()}
        applyState="idle"
        applyProgress={null}
        applyResult={null}
        applyError={null}
      />
    );

    expect(screen.getByText('1 filter change')).toBeInTheDocument();
    expect(screen.getByText('1 PID change')).toBeInTheDocument();
    expect(screen.getByText('1 medium confidence')).toBeInTheDocument();
    expect(screen.getByText('1 high confidence')).toBeInTheDocument();
  });

  it('shows changes table with settings', () => {
    render(
      <TuningSummaryStep
        filterResult={mockFilterResult}
        pidResult={mockPidResult}
        mode="full"
        onExit={vi.fn()}
        onApply={vi.fn()}
        applyState="idle"
        applyProgress={null}
        applyResult={null}
        applyError={null}
      />
    );

    // Labels appear in both table and RecommendationCard, check they exist
    expect(screen.getAllByText('Gyro Lowpass 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Roll D-Gain').length).toBeGreaterThan(0);
    expect(screen.getAllByText('250 Hz').length).toBeGreaterThan(0);
    expect(screen.getAllByText('200 Hz').length).toBeGreaterThan(0);
  });

  it('apply button shows "Apply Filters" in filter mode', () => {
    render(
      <TuningSummaryStep
        filterResult={mockFilterResult}
        pidResult={null}
        mode="filter"
        onExit={vi.fn()}
        onApply={vi.fn()}
        applyState="idle"
        applyProgress={null}
        applyResult={null}
        applyError={null}
      />
    );

    expect(screen.getByRole('button', { name: 'Apply Filters' })).toBeInTheDocument();
  });

  it('apply button shows "Apply PIDs" in pid mode', () => {
    render(
      <TuningSummaryStep
        filterResult={null}
        pidResult={mockPidResult}
        mode="pid"
        onExit={vi.fn()}
        onApply={vi.fn()}
        applyState="idle"
        applyProgress={null}
        applyResult={null}
        applyError={null}
      />
    );

    expect(screen.getByRole('button', { name: 'Apply PIDs' })).toBeInTheDocument();
  });

  it('apply button disabled during applying', () => {
    render(
      <TuningSummaryStep
        filterResult={mockFilterResult}
        pidResult={mockPidResult}
        mode="full"
        onExit={vi.fn()}
        onApply={vi.fn()}
        applyState="applying"
        applyProgress={mockApplyProgress}
        applyResult={null}
        applyError={null}
      />
    );

    const applyButton = screen.getByRole('button', { name: 'Applying...' });
    expect(applyButton).toBeDisabled();
  });

  it('shows progress bar during apply', () => {
    render(
      <TuningSummaryStep
        filterResult={mockFilterResult}
        pidResult={mockPidResult}
        mode="full"
        onExit={vi.fn()}
        onApply={vi.fn()}
        applyState="applying"
        applyProgress={mockApplyProgress}
        applyResult={null}
        applyError={null}
      />
    );

    expect(screen.getByText('Applying settings...')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('shows success message after apply', () => {
    render(
      <TuningSummaryStep
        filterResult={mockFilterResult}
        pidResult={mockPidResult}
        mode="full"
        onExit={vi.fn()}
        onApply={vi.fn()}
        applyState="done"
        applyProgress={null}
        applyResult={mockApplyResult}
        applyError={null}
      />
    );

    expect(screen.getByText(/Changes applied successfully/)).toBeInTheDocument();
    expect(screen.getByText(/1 PID and 1 filter written/)).toBeInTheDocument();
  });

  it('shows error message on failure', () => {
    render(
      <TuningSummaryStep
        filterResult={mockFilterResult}
        pidResult={mockPidResult}
        mode="full"
        onExit={vi.fn()}
        onApply={vi.fn()}
        applyState="error"
        applyProgress={null}
        applyResult={null}
        applyError="Failed to apply changes"
      />
    );

    expect(screen.getByText('Failed to apply changes')).toBeInTheDocument();
  });

  it('exit button calls onExit', async () => {
    const user = userEvent.setup();
    const mockOnExit = vi.fn();

    render(
      <TuningSummaryStep
        filterResult={mockFilterResult}
        pidResult={mockPidResult}
        mode="full"
        onExit={mockOnExit}
        onApply={vi.fn()}
        applyState="idle"
        applyProgress={null}
        applyResult={null}
        applyError={null}
      />
    );

    const exitButton = screen.getByRole('button', { name: 'Exit Wizard' });
    await user.click(exitButton);

    expect(mockOnExit).toHaveBeenCalled();
  });

  it('apply button calls onApply', async () => {
    const user = userEvent.setup();
    const mockOnApply = vi.fn();

    render(
      <TuningSummaryStep
        filterResult={mockFilterResult}
        pidResult={mockPidResult}
        mode="full"
        onExit={vi.fn()}
        onApply={mockOnApply}
        applyState="idle"
        applyProgress={null}
        applyResult={null}
        applyError={null}
      />
    );

    const applyButton = screen.getByRole('button', { name: 'Apply Changes' });
    await user.click(applyButton);

    expect(mockOnApply).toHaveBeenCalled();
  });

  it('shows filter-specific success message in filter mode', () => {
    render(
      <TuningSummaryStep
        filterResult={mockFilterResult}
        pidResult={null}
        mode="filter"
        onExit={vi.fn()}
        onApply={vi.fn()}
        applyState="done"
        applyProgress={null}
        applyResult={mockApplyResult}
        applyError={null}
      />
    );

    expect(screen.getByText(/Filters applied!/)).toBeInTheDocument();
    expect(screen.getByText(/Next: erase Blackbox/)).toBeInTheDocument();
  });

  it('shows PID-specific success message in pid mode', () => {
    render(
      <TuningSummaryStep
        filterResult={null}
        pidResult={mockPidResult}
        mode="pid"
        onExit={vi.fn()}
        onApply={vi.fn()}
        applyState="done"
        applyProgress={null}
        applyResult={mockApplyResult}
        applyError={null}
      />
    );

    expect(screen.getByText(/PIDs applied!/)).toBeInTheDocument();
    expect(screen.getByText(/Fly a normal flight to verify/)).toBeInTheDocument();
  });

  it('apply button shows "Apply All Changes" in quick mode', () => {
    render(
      <TuningSummaryStep
        filterResult={mockFilterResult}
        pidResult={null}
        tfResult={mockPidResult}
        mode="quick"
        onExit={vi.fn()}
        onApply={vi.fn()}
        applyState="idle"
        applyProgress={null}
        applyResult={null}
        applyError={null}
      />
    );

    expect(screen.getByRole('button', { name: 'Apply All Changes' })).toBeInTheDocument();
  });

  it('quick mode uses tfResult for PID recommendations', () => {
    const tfResult: PIDAnalysisResult = {
      ...mockPidResult,
      summary: 'TF summary',
      recommendations: [
        {
          setting: 'pid_roll_p',
          currentValue: 45,
          recommendedValue: 50,
          reason: 'Increase P',
          impact: 'response' as const,
          confidence: 'high' as const,
        },
      ],
    };

    render(
      <TuningSummaryStep
        filterResult={mockFilterResult}
        pidResult={null}
        tfResult={tfResult}
        mode="quick"
        onExit={vi.fn()}
        onApply={vi.fn()}
        applyState="idle"
        applyProgress={null}
        applyResult={null}
        applyError={null}
      />
    );

    expect(screen.getByText('1 filter change')).toBeInTheDocument();
    expect(screen.getByText('1 PID change')).toBeInTheDocument();
    expect(screen.getByText('TF summary')).toBeInTheDocument();
  });

  it('shows quick mode success message', () => {
    render(
      <TuningSummaryStep
        filterResult={mockFilterResult}
        pidResult={null}
        tfResult={mockPidResult}
        mode="quick"
        onExit={vi.fn()}
        onApply={vi.fn()}
        applyState="done"
        applyProgress={null}
        applyResult={mockApplyResult}
        applyError={null}
      />
    );

    expect(screen.getByText(/All changes applied!/)).toBeInTheDocument();
    expect(screen.getByText(/verification hover/)).toBeInTheDocument();
  });

  it('shows continue without changes button when no recommendations', () => {
    const emptyFilterResult: FilterAnalysisResult = {
      ...mockFilterResult,
      recommendations: [],
    };
    const emptyPidResult: PIDAnalysisResult = {
      ...mockPidResult,
      recommendations: [],
    };

    render(
      <TuningSummaryStep
        filterResult={emptyFilterResult}
        pidResult={emptyPidResult}
        mode="full"
        onExit={vi.fn()}
        onApply={vi.fn()}
        applyState="idle"
        applyProgress={null}
        applyResult={null}
        applyError={null}
      />
    );

    const continueButton = screen.getByRole('button', { name: 'Continue (No Changes)' });
    expect(continueButton).toBeEnabled();
  });
});
