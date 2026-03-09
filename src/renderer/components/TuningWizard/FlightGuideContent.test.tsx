import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlightGuideContent } from './FlightGuideContent';
import { TUNING_MODE } from '@shared/constants';

describe('FlightGuideContent', () => {
  it('renders full mode phases by default', () => {
    render(<FlightGuideContent />);

    // FLIGHT_PHASES includes Roll Snaps, Pitch Snaps (combined guide)
    expect(screen.getByText('Roll Snaps')).toBeInTheDocument();
    expect(screen.getByText('Pitch Snaps')).toBeInTheDocument();
    expect(screen.getByText('Yaw Snaps')).toBeInTheDocument();
  });

  it('renders filter mode phases', () => {
    render(<FlightGuideContent mode={TUNING_MODE.FILTER} />);

    // FILTER_FLIGHT_PHASES has Throttle Sweep instead of snaps
    expect(screen.getByText('Throttle Sweep')).toBeInTheDocument();
    expect(screen.queryByText('Roll Snaps')).not.toBeInTheDocument();
  });

  it('renders pid mode phases', () => {
    render(<FlightGuideContent mode={TUNING_MODE.PID} />);

    // PID_FLIGHT_PHASES has snaps but no Throttle Sweep
    expect(screen.getByText('Roll Snaps')).toBeInTheDocument();
    expect(screen.getByText('Pitch Snaps')).toBeInTheDocument();
    expect(screen.queryByText('Throttle Sweep')).not.toBeInTheDocument();
  });

  it('renders filter mode tips', () => {
    render(<FlightGuideContent mode={TUNING_MODE.FILTER} />);

    expect(screen.getByText(/Throttle sweeps should be slow/)).toBeInTheDocument();
  });

  it('renders pid mode tips', () => {
    render(<FlightGuideContent mode={TUNING_MODE.PID} />);

    expect(screen.getByText(/Mix half-stick and full-stick snaps/)).toBeInTheDocument();
  });

  it('renders full mode tips', () => {
    render(<FlightGuideContent mode={TUNING_MODE.FULL} />);

    expect(screen.getByText(/One pack = one test flight/)).toBeInTheDocument();
  });

  it('shows GYRO_SCALED tip in filter mode without fcVersion', () => {
    render(<FlightGuideContent mode={TUNING_MODE.FILTER} />);

    expect(screen.getByText(/GYRO_SCALED/)).toBeInTheDocument();
  });

  it('hides GYRO_SCALED tip in filter mode for BF 4.6+', () => {
    render(<FlightGuideContent mode={TUNING_MODE.FILTER} fcVersion="4.6.0" />);

    expect(screen.queryByText(/GYRO_SCALED/)).not.toBeInTheDocument();
  });

  it('shows GYRO_SCALED tip in filter mode for BF 4.5.x', () => {
    render(<FlightGuideContent mode={TUNING_MODE.FILTER} fcVersion="4.5.1" />);

    expect(screen.getByText(/GYRO_SCALED/)).toBeInTheDocument();
  });
});
