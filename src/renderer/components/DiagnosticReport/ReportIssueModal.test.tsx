import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportIssueModal } from './ReportIssueModal';

describe('ReportIssueModal', () => {
  const onSubmit = vi.fn();
  const onClose = vi.fn();

  it('renders modal with form fields', () => {
    render(<ReportIssueModal onSubmit={onSubmit} onClose={onClose} submitting={false} />);

    expect(screen.getByText('Report Tuning Issue')).toBeInTheDocument();
    expect(screen.getByLabelText('Email (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('What went wrong? (optional)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Report' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('submits with email and note', async () => {
    const user = userEvent.setup();
    render(<ReportIssueModal onSubmit={onSubmit} onClose={onClose} submitting={false} />);

    await user.type(screen.getByLabelText('Email (optional)'), 'pilot@test.com');
    await user.type(screen.getByLabelText('What went wrong? (optional)'), 'Bad LPF1');
    await user.click(screen.getByRole('button', { name: 'Send Report' }));

    expect(onSubmit).toHaveBeenCalledWith('pilot@test.com', 'Bad LPF1');
  });

  it('submits with undefined when fields empty', async () => {
    const user = userEvent.setup();
    render(<ReportIssueModal onSubmit={onSubmit} onClose={onClose} submitting={false} />);

    await user.click(screen.getByRole('button', { name: 'Send Report' }));

    expect(onSubmit).toHaveBeenCalledWith(undefined, undefined);
  });

  it('shows Sending... when submitting', () => {
    render(<ReportIssueModal onSubmit={onSubmit} onClose={onClose} submitting={true} />);

    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();
  });

  it('closes on Cancel click', async () => {
    const user = userEvent.setup();
    render(<ReportIssueModal onSubmit={onSubmit} onClose={onClose} submitting={false} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('shows privacy note', () => {
    render(<ReportIssueModal onSubmit={onSubmit} onClose={onClose} submitting={false} />);

    expect(
      screen.getByText('No personal data, file paths, or raw flight recordings.')
    ).toBeInTheDocument();
  });
});
