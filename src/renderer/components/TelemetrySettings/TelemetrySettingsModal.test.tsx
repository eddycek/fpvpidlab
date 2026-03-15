import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TelemetrySettingsModal } from './TelemetrySettingsModal';

describe('TelemetrySettingsModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(window.betaflight.getTelemetrySettings).mockResolvedValue({
      enabled: false,
      installationId: 'abcd1234-5678-9012-3456-789012345678',
      lastUploadAt: null,
      lastUploadError: null,
    });
  });

  it('renders telemetry settings', async () => {
    render(<TelemetrySettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    expect(screen.getByText('Send anonymous usage data')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('shows toggle in off state when disabled', async () => {
    render(<TelemetrySettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles telemetry on click', async () => {
    const user = userEvent.setup();
    vi.mocked(window.betaflight.setTelemetryEnabled).mockResolvedValue({
      enabled: true,
      installationId: 'abcd1234-5678-9012-3456-789012345678',
      lastUploadAt: null,
      lastUploadError: null,
    });

    render(<TelemetrySettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('switch'));

    expect(window.betaflight.setTelemetryEnabled).toHaveBeenCalledWith(true);
  });

  it('Send Now button is disabled when telemetry is off', async () => {
    render(<TelemetrySettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Send Now')).toBeInTheDocument();
    });

    expect(screen.getByText('Send Now')).toBeDisabled();
  });

  it('displays installation ID prefix', async () => {
    render(<TelemetrySettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('abcd1234...')).toBeInTheDocument();
    });
  });

  it('calls onClose when clicking close button', async () => {
    const user = userEvent.setup();
    render(<TelemetrySettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    await user.click(screen.getByText('\u00d7'));

    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when clicking overlay', async () => {
    const user = userEvent.setup();
    render(<TelemetrySettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    // Click on overlay (the outer div)
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) {
      await user.click(overlay);
    }

    expect(onClose).toHaveBeenCalled();
  });
});
