import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApplyConfirmationModal } from './ApplyConfirmationModal';

describe('ApplyConfirmationModal', () => {
  it('shows total change count', () => {
    render(
      <ApplyConfirmationModal filterCount={3} pidCount={2} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );

    expect(screen.getByText(/5 changes will be written/)).toBeInTheDocument();
  });

  it('shows filter and PID change counts separately', () => {
    render(
      <ApplyConfirmationModal filterCount={3} pidCount={2} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );

    expect(screen.getByText('3 filter changes (via CLI)')).toBeInTheDocument();
    expect(screen.getByText('2 PID changes (via MSP)')).toBeInTheDocument();
  });

  it('handles singular "change" text correctly', () => {
    render(
      <ApplyConfirmationModal filterCount={1} pidCount={1} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );

    expect(screen.getByText('1 filter change (via CLI)')).toBeInTheDocument();
    expect(screen.getByText('1 PID change (via MSP)')).toBeInTheDocument();
  });

  it('confirm button calls onConfirm', async () => {
    const user = userEvent.setup();
    const mockConfirm = vi.fn();
    render(
      <ApplyConfirmationModal
        filterCount={3}
        pidCount={2}
        onConfirm={mockConfirm}
        onCancel={vi.fn()}
      />
    );

    const confirmButton = screen.getByRole('button', { name: 'Apply Changes' });
    await user.click(confirmButton);

    expect(mockConfirm).toHaveBeenCalled();
  });

  it('cancel button calls onCancel', async () => {
    const user = userEvent.setup();
    const mockCancel = vi.fn();
    render(
      <ApplyConfirmationModal
        filterCount={3}
        pidCount={2}
        onConfirm={vi.fn()}
        onCancel={mockCancel}
      />
    );

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    expect(mockCancel).toHaveBeenCalled();
  });

  it('shows reboot warning text', () => {
    render(
      <ApplyConfirmationModal filterCount={3} pidCount={2} onConfirm={vi.fn()} onCancel={vi.fn()} />
    );

    expect(screen.getByText(/Your FC will reboot after applying/)).toBeInTheDocument();
  });

  it('shows feedforward count separately with CLI label', () => {
    render(
      <ApplyConfirmationModal
        filterCount={2}
        pidCount={3}
        feedforwardCount={1}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(/6 changes will be written/)).toBeInTheDocument();
    expect(screen.getByText('2 filter changes (via CLI)')).toBeInTheDocument();
    expect(screen.getByText('3 PID changes (via MSP)')).toBeInTheDocument();
    expect(screen.getByText('1 feedforward change (via CLI)')).toBeInTheDocument();
  });

  it('hides feedforward pill when count is zero', () => {
    render(
      <ApplyConfirmationModal
        filterCount={2}
        pidCount={3}
        feedforwardCount={0}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.queryByText(/feedforward/)).not.toBeInTheDocument();
  });
});
