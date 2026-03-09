import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppliedChangesTable } from './AppliedChangesTable';
import type { AppliedChange } from '@shared/types/tuning.types';

describe('AppliedChangesTable', () => {
  it('renders nothing when changes are empty', () => {
    const { container } = render(<AppliedChangesTable title="Filter Changes" changes={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders title with count', () => {
    const changes: AppliedChange[] = [
      { setting: 'gyro_lpf1_static_hz', previousValue: 250, newValue: 300 },
    ];
    render(<AppliedChangesTable title="Filter Changes" changes={changes} />);
    expect(screen.getByText('Filter Changes (1)')).toBeInTheDocument();
  });

  it('renders setting name, values and arrow', () => {
    const changes: AppliedChange[] = [
      { setting: 'gyro_lpf1_static_hz', previousValue: 250, newValue: 300 },
    ];
    render(<AppliedChangesTable title="Test" changes={changes} />);
    expect(screen.getByText('gyro_lpf1_static_hz')).toBeInTheDocument();
    expect(screen.getByText('250')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('\u2192')).toBeInTheDocument();
  });

  it('shows percent change', () => {
    const changes: AppliedChange[] = [{ setting: 'test', previousValue: 100, newValue: 120 }];
    render(<AppliedChangesTable title="Test" changes={changes} />);
    expect(screen.getByText('+20%')).toBeInTheDocument();
  });

  it('shows negative percent change', () => {
    const changes: AppliedChange[] = [{ setting: 'test', previousValue: 500, newValue: 450 }];
    render(<AppliedChangesTable title="Test" changes={changes} />);
    expect(screen.getByText('-10%')).toBeInTheDocument();
  });

  it('handles zero previousValue gracefully', () => {
    const changes: AppliedChange[] = [{ setting: 'test', previousValue: 0, newValue: 50 }];
    render(<AppliedChangesTable title="Test" changes={changes} />);
    expect(screen.getByText('new')).toBeInTheDocument();
  });

  it('renders multiple changes', () => {
    const changes: AppliedChange[] = [
      { setting: 'setting_a', previousValue: 10, newValue: 20 },
      { setting: 'setting_b', previousValue: 100, newValue: 80 },
    ];
    render(<AppliedChangesTable title="Changes" changes={changes} />);
    expect(screen.getByText('Changes (2)')).toBeInTheDocument();
    expect(screen.getByText('setting_a')).toBeInTheDocument();
    expect(screen.getByText('setting_b')).toBeInTheDocument();
  });
});
