import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PIDAnalysisStep } from './PIDAnalysisStep';
import type { PIDAnalysisResult } from '@shared/types/analysis.types';

// Mock recharts to avoid SVG rendering in tests
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
}));

const mockPIDResult: PIDAnalysisResult = {
  roll: {
    responses: [],
    meanOvershoot: 5,
    meanRiseTimeMs: 20,
    meanSettlingTimeMs: 50,
    meanLatencyMs: 8,
    meanTrackingErrorRMS: 0,
    meanSteadyStateError: 0,
  },
  pitch: {
    responses: [],
    meanOvershoot: 8,
    meanRiseTimeMs: 22,
    meanSettlingTimeMs: 55,
    meanLatencyMs: 9,
    meanTrackingErrorRMS: 0,
    meanSteadyStateError: 0,
  },
  yaw: {
    responses: [],
    meanOvershoot: 3,
    meanRiseTimeMs: 30,
    meanSettlingTimeMs: 60,
    meanLatencyMs: 10,
    meanTrackingErrorRMS: 0,
    meanSteadyStateError: 0,
  },
  recommendations: [],
  summary: 'Your PIDs look good.',
  analysisTimeMs: 200,
  sessionIndex: 0,
  stepsDetected: 12,
  currentPIDs: {
    roll: { P: 45, I: 80, D: 30 },
    pitch: { P: 47, I: 84, D: 32 },
    yaw: { P: 45, I: 80, D: 0 },
  },
};

describe('PIDAnalysisStep', () => {
  const defaultProps = {
    pidResult: null as PIDAnalysisResult | null,
    pidAnalyzing: false,
    pidProgress: null,
    pidError: null,
    runPIDAnalysis: vi.fn(),
    onContinue: vi.fn(),
  };

  it('shows flight style pill when flightStyle is present', () => {
    render(
      <PIDAnalysisStep {...defaultProps} pidResult={{ ...mockPIDResult, flightStyle: 'smooth' }} />
    );

    expect(screen.getByText(/Tuning for: Smooth flying/)).toBeInTheDocument();
  });

  it('shows Aggressive label for aggressive flight style', () => {
    render(
      <PIDAnalysisStep
        {...defaultProps}
        pidResult={{ ...mockPIDResult, flightStyle: 'aggressive' }}
      />
    );

    expect(screen.getByText(/Tuning for: Aggressive flying/)).toBeInTheDocument();
  });

  it('does not show flight style pill when flightStyle is absent', () => {
    render(<PIDAnalysisStep {...defaultProps} pidResult={mockPIDResult} />);

    expect(screen.queryByText(/Tuning for:/)).not.toBeInTheDocument();
  });

  it('shows step count pill with correct pluralization', () => {
    render(<PIDAnalysisStep {...defaultProps} pidResult={mockPIDResult} />);

    expect(screen.getByText(/12 steps detected/)).toBeInTheDocument();
  });

  it('uses singular "step" for single step', () => {
    render(
      <PIDAnalysisStep {...defaultProps} pidResult={{ ...mockPIDResult, stepsDetected: 1 }} />
    );

    expect(screen.getByText(/1 step detected/)).toBeInTheDocument();
  });

  it('shows data quality pill when dataQuality is present', () => {
    render(
      <PIDAnalysisStep
        {...defaultProps}
        pidResult={{
          ...mockPIDResult,
          dataQuality: {
            overall: 85,
            tier: 'excellent',
            subScores: [],
          },
        }}
      />
    );

    expect(screen.getByText(/Data: excellent \(85\/100\)/)).toBeInTheDocument();
  });

  it('does not show data quality pill when dataQuality is absent', () => {
    render(<PIDAnalysisStep {...defaultProps} pidResult={mockPIDResult} />);

    expect(screen.queryByText(/Data:/)).not.toBeInTheDocument();
  });

  it('shows prop wash pill when prop wash data present with ≥3 events', () => {
    const pidWithPW: PIDAnalysisResult = {
      ...mockPIDResult,
      propWash: {
        events: [
          {
            timestampMs: 1000,
            throttleDropRate: 0.5,
            durationMs: 200,
            peakFrequencyHz: 52,
            severityRatio: 3.5,
            axisEnergy: { roll: 30, pitch: 20, yaw: 5 },
          },
          {
            timestampMs: 2000,
            throttleDropRate: 0.4,
            durationMs: 180,
            peakFrequencyHz: 48,
            severityRatio: 2.8,
            axisEnergy: { roll: 25, pitch: 18, yaw: 4 },
          },
          {
            timestampMs: 3000,
            throttleDropRate: 0.6,
            durationMs: 220,
            peakFrequencyHz: 55,
            severityRatio: 4.0,
            axisEnergy: { roll: 35, pitch: 22, yaw: 6 },
          },
        ],
        meanSeverity: 3.4,
        worstAxis: 'roll',
        dominantFrequencyHz: 52,
        recommendation: 'Moderate prop wash on roll axis.',
      },
    };
    render(<PIDAnalysisStep {...defaultProps} pidResult={pidWithPW} />);
    expect(screen.getByText(/Prop wash: moderate/)).toBeInTheDocument();
    expect(screen.getByText(/roll.*52 Hz/)).toBeInTheDocument();
  });

  it('does not show prop wash pill when fewer than 3 events', () => {
    const pidWithFewPW: PIDAnalysisResult = {
      ...mockPIDResult,
      propWash: {
        events: [
          {
            timestampMs: 1000,
            throttleDropRate: 0.5,
            durationMs: 200,
            peakFrequencyHz: 52,
            severityRatio: 6,
            axisEnergy: { roll: 30, pitch: 20, yaw: 5 },
          },
        ],
        meanSeverity: 6,
        worstAxis: 'roll',
        dominantFrequencyHz: 52,
        recommendation: 'Severe prop wash.',
      },
    };
    render(<PIDAnalysisStep {...defaultProps} pidResult={pidWithFewPW} />);
    expect(screen.queryByText(/Prop wash/)).not.toBeInTheDocument();
  });

  it('does not show prop wash pill when propWash is absent', () => {
    render(<PIDAnalysisStep {...defaultProps} pidResult={mockPIDResult} />);
    expect(screen.queryByText(/Prop wash/)).not.toBeInTheDocument();
  });
});
