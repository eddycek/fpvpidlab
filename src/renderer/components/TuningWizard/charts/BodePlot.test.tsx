import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BodePlot } from './BodePlot';
import type { BodeResult } from '../../../../main/analysis/TransferFunctionEstimator';

// Mock recharts
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
  Legend: () => null,
}));

function makeBodeResult(size: number = 50): BodeResult {
  const frequencies = new Float64Array(size);
  const magnitude = new Float64Array(size);
  const phase = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    frequencies[i] = (i + 1) * 10;
    magnitude[i] = -i * 0.5;
    phase[i] = -i * 3;
  }
  return { frequencies, magnitude, phase };
}

function makeEmptyBodeResult(): BodeResult {
  return {
    frequencies: new Float64Array(0),
    magnitude: new Float64Array(0),
    phase: new Float64Array(0),
  };
}

describe('BodePlot', () => {
  it('renders magnitude and phase charts', () => {
    const bode = {
      roll: makeBodeResult(),
      pitch: makeBodeResult(),
      yaw: makeBodeResult(),
    };

    render(<BodePlot bode={bode} />);

    expect(screen.getByText('Magnitude (dB)')).toBeInTheDocument();
    expect(screen.getByText('Phase (degrees)')).toBeInTheDocument();
    expect(screen.getAllByTestId('line-chart')).toHaveLength(2);
  });

  it('renders axis tabs', () => {
    const bode = {
      roll: makeBodeResult(),
      pitch: makeBodeResult(),
      yaw: makeBodeResult(),
    };

    render(<BodePlot bode={bode} />);

    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Roll')).toBeInTheDocument();
    expect(screen.getByText('Pitch')).toBeInTheDocument();
    expect(screen.getByText('Yaw')).toBeInTheDocument();
  });

  it('shows empty message when no data', () => {
    const bode = {
      roll: makeEmptyBodeResult(),
      pitch: makeEmptyBodeResult(),
      yaw: makeEmptyBodeResult(),
    };

    render(<BodePlot bode={bode} />);

    expect(screen.getByText('No transfer function data available.')).toBeInTheDocument();
    expect(screen.queryByText('Magnitude (dB)')).not.toBeInTheDocument();
  });

  it('renders responsive containers', () => {
    const bode = {
      roll: makeBodeResult(),
      pitch: makeBodeResult(),
      yaw: makeBodeResult(),
    };

    render(<BodePlot bode={bode} />);

    expect(screen.getAllByTestId('responsive-container')).toHaveLength(2);
  });
});
