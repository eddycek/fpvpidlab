import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportIssueButton } from './ReportIssueButton';
import { ToastProvider } from '../../contexts/ToastContext';

// Default mock: Pro license
beforeEach(() => {
  vi.mocked(window.betaflight.getLicenseStatus).mockResolvedValue({
    type: 'paid',
    expiresAt: null,
  });
  vi.mocked(window.betaflight.onLicenseChanged).mockReturnValue(() => {});
  vi.mocked(window.betaflight.sendDiagnosticReport).mockResolvedValue({
    reportId: 'test-id',
    submitted: true,
  });
});

function renderWithToast(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe('ReportIssueButton', () => {
  it('renders button for Pro users', async () => {
    renderWithToast(<ReportIssueButton recordId="rec-1" />);

    await waitFor(() => {
      expect(screen.getByText('Report Issue')).toBeInTheDocument();
    });
  });

  it('does not render for Free users', async () => {
    vi.mocked(window.betaflight.getLicenseStatus).mockResolvedValue({
      type: 'free',
      expiresAt: null,
    });

    renderWithToast(<ReportIssueButton recordId="rec-1" />);

    // Wait for license to load, then verify button is absent
    await waitFor(() => {
      expect(screen.queryByText('Report Issue')).not.toBeInTheDocument();
    });
  });

  it('opens modal on click', async () => {
    const user = userEvent.setup();
    renderWithToast(<ReportIssueButton recordId="rec-1" />);

    await waitFor(() => {
      expect(screen.getByText('Report Issue')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Report Issue'));

    expect(screen.getByText('Report Tuning Issue')).toBeInTheDocument();
  });

  it('submits report and closes modal on success', async () => {
    const user = userEvent.setup();
    renderWithToast(<ReportIssueButton recordId="rec-1" />);

    await waitFor(() => {
      expect(screen.getByText('Report Issue')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Report Issue'));
    await user.click(screen.getByRole('button', { name: 'Send Report' }));

    expect(window.betaflight.sendDiagnosticReport).toHaveBeenCalledWith({
      recordId: 'rec-1',
      userEmail: undefined,
      userNote: undefined,
    });

    // Modal closes on success
    await waitFor(() => {
      expect(screen.queryByText('Report Tuning Issue')).not.toBeInTheDocument();
    });
  });

  it('calls sendDiagnosticReport on failure without crashing', async () => {
    vi.mocked(window.betaflight.sendDiagnosticReport).mockRejectedValue(new Error('Upload failed'));

    const user = userEvent.setup();
    renderWithToast(<ReportIssueButton recordId="rec-1" />);

    await waitFor(() => {
      expect(screen.getByText('Report Issue')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Report Issue'));
    await user.click(screen.getByRole('button', { name: 'Send Report' }));

    expect(window.betaflight.sendDiagnosticReport).toHaveBeenCalled();

    // Modal stays open on failure (user can retry)
    await waitFor(() => {
      expect(screen.getByText('Report Tuning Issue')).toBeInTheDocument();
    });
  });

  it('renders as button variant', async () => {
    renderWithToast(<ReportIssueButton recordId="rec-1" variant="button" />);

    await waitFor(() => {
      const btn = screen.getByText('Report Issue');
      expect(btn.className).toContain('wizard-btn');
    });
  });
});
