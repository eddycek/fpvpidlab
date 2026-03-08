import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StartTuningModal } from './StartTuningModal';

describe('StartTuningModal', () => {
  it('renders both tuning mode options', () => {
    render(<StartTuningModal onStart={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText('Guided Tune')).toBeInTheDocument();
    expect(screen.getByText('Quick Tune')).toBeInTheDocument();
    expect(screen.getByText('2 flights')).toBeInTheDocument();
    expect(screen.getByText('1 flight')).toBeInTheDocument();
  });

  it('calls onStart with guided when Guided Tune clicked', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<StartTuningModal onStart={onStart} onCancel={vi.fn()} />);

    await user.click(screen.getByText('Guided Tune'));
    expect(onStart).toHaveBeenCalledWith('guided');
  });

  it('calls onStart with quick when Quick Tune clicked', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<StartTuningModal onStart={onStart} onCancel={vi.fn()} />);

    await user.click(screen.getByText('Quick Tune'));
    expect(onStart).toHaveBeenCalledWith('quick');
  });

  it('calls onCancel when Cancel clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<StartTuningModal onStart={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when overlay clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<StartTuningModal onStart={vi.fn()} onCancel={onCancel} />);

    // Click the overlay (background)
    await user.click(screen.getByText('Choose Tuning Mode').closest('.start-tuning-overlay')!);
    expect(onCancel).toHaveBeenCalled();
  });

  it('does not call onCancel when modal content clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<StartTuningModal onStart={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByText('Choose Tuning Mode'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
