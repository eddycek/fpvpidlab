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
      includeFlightData: undefined,
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

  it('passes hasFlightData to modal', async () => {
    const user = userEvent.setup();
    renderWithToast(<ReportIssueButton recordId="rec-1" hasFlightData={true} />);

    await waitFor(() => {
      expect(screen.getByText('Report Issue')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Report Issue'));

    // Flight data checkbox should be visible
    expect(screen.getByText('Include flight data (BBL log)')).toBeInTheDocument();
  });

  it('submits with includeFlightData when flight data available', async () => {
    const user = userEvent.setup();
    renderWithToast(<ReportIssueButton recordId="rec-1" hasFlightData={true} />);

    await waitFor(() => {
      expect(screen.getByText('Report Issue')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Report Issue'));
    await user.click(screen.getByRole('button', { name: 'Send Report' }));

    expect(window.betaflight.sendDiagnosticReport).toHaveBeenCalledWith({
      recordId: 'rec-1',
      userEmail: undefined,
      userNote: undefined,
      includeFlightData: true,
    });
  });

  describe('merge mode (autoReportId)', () => {
    it('shows "Add Details to Report" button when autoReportId is set', async () => {
      renderWithToast(<ReportIssueButton recordId="rec-1" autoReportId="auto-report-123" />);

      await waitFor(() => {
        expect(screen.getByText('Add Details to Report')).toBeInTheDocument();
      });
      expect(screen.queryByText('Report Issue')).not.toBeInTheDocument();
    });

    it('opens merge mode modal with correct title', async () => {
      const user = userEvent.setup();
      renderWithToast(<ReportIssueButton recordId="rec-1" autoReportId="auto-report-123" />);

      await waitFor(() => {
        expect(screen.getByText('Add Details to Report')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Add Details to Report'));

      expect(screen.getByText('Add Details to Auto-Report')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add Details' })).toBeInTheDocument();
    });

    it('calls patchDiagnosticReport instead of sendDiagnosticReport', async () => {
      vi.mocked(window.betaflight.sendDiagnosticReport).mockClear();
      vi.mocked(window.betaflight.patchDiagnosticReport).mockClear();

      const user = userEvent.setup();
      renderWithToast(<ReportIssueButton recordId="rec-1" autoReportId="auto-report-123" />);

      await waitFor(() => {
        expect(screen.getByText('Add Details to Report')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Add Details to Report'));
      await user.click(screen.getByRole('button', { name: 'Add Details' }));

      expect(window.betaflight.patchDiagnosticReport).toHaveBeenCalledWith({
        reportId: 'auto-report-123',
        userEmail: undefined,
        userNote: undefined,
      });
      expect(window.betaflight.sendDiagnosticReport).not.toHaveBeenCalled();
    });

    it('hides flight data checkbox and privacy note in merge mode', async () => {
      const user = userEvent.setup();
      renderWithToast(
        <ReportIssueButton recordId="rec-1" autoReportId="auto-report-123" hasFlightData={true} />
      );

      await waitFor(() => {
        expect(screen.getByText('Add Details to Report')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Add Details to Report'));

      expect(screen.queryByText('Include flight data (BBL log)')).not.toBeInTheDocument();
      expect(screen.queryByText(/What we'll send/)).not.toBeInTheDocument();
    });
  });
});
