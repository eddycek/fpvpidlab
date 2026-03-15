import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LicenseSettingsModal } from './LicenseSettingsModal';

describe('LicenseSettingsModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    onClose.mockReset();
    vi.mocked(window.betaflight.getLicenseStatus).mockResolvedValue({
      type: 'free',
      expiresAt: null,
    });
    vi.mocked(window.betaflight.onLicenseChanged).mockReturnValue(() => {});
  });

  it('renders free status with comparison and key input', async () => {
    render(<LicenseSettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getAllByText('Free').length).toBeGreaterThanOrEqual(1);
    });

    // Comparison table shows both tiers
    expect(screen.getByText('1 drone profile')).toBeInTheDocument();
    expect(screen.getByText('Unlimited drone profiles')).toBeInTheDocument();
    expect(screen.getByText('Already have a license key?')).toBeInTheDocument();

    expect(screen.getByPlaceholderText('PIDLAB-XXXX-XXXX-XXXX')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument();
  });

  it('renders Pro status with key info', async () => {
    vi.mocked(window.betaflight.getLicenseStatus).mockResolvedValue({
      type: 'paid',
      expiresAt: null,
      key: 'PIDLAB-ABCD-****-****',
      activatedAt: '2026-03-01T00:00:00Z',
      lastValidatedAt: '2026-03-15T00:00:00Z',
    });

    render(<LicenseSettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Pro')).toBeInTheDocument();
    });

    expect(screen.getByText('PIDLAB-ABCD-****-****')).toBeInTheDocument();
    expect(screen.getByText('Remove License')).toBeInTheDocument();
  });

  it('activates license on button click', async () => {
    const user = userEvent.setup();
    vi.mocked(window.betaflight.activateLicense).mockResolvedValue({
      type: 'paid',
      expiresAt: null,
      key: 'PIDLAB-ABCD-****-****',
      activatedAt: '2026-03-15T00:00:00Z',
    });

    render(<LicenseSettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('PIDLAB-XXXX-XXXX-XXXX')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('PIDLAB-XXXX-XXXX-XXXX');
    await user.type(input, 'PIDLAB-ABCD-EFGH-JKLM');
    await user.click(screen.getByRole('button', { name: 'Activate' }));

    expect(window.betaflight.activateLicense).toHaveBeenCalledWith('PIDLAB-ABCD-EFGH-JKLM');
  });

  it('shows error on activation failure', async () => {
    const user = userEvent.setup();
    vi.mocked(window.betaflight.activateLicense).mockRejectedValue(
      new Error('Already activated on another machine')
    );

    render(<LicenseSettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('PIDLAB-XXXX-XXXX-XXXX')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('PIDLAB-XXXX-XXXX-XXXX');
    await user.type(input, 'PIDLAB-ABCD-EFGH-JKLM');
    await user.click(screen.getByRole('button', { name: 'Activate' }));

    await waitFor(() => {
      expect(screen.getByText('Already activated on another machine')).toBeInTheDocument();
    });
  });

  it('closes on overlay click', async () => {
    render(<LicenseSettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('License')).toBeInTheDocument();
    });

    // Click the overlay (the outer div with modal-overlay class)
    const overlay = screen.getByText('License').closest('.license-modal')!.parentElement!;
    await userEvent.click(overlay);

    expect(onClose).toHaveBeenCalled();
  });

  it('closes on X button click', async () => {
    const user = userEvent.setup();
    render(<LicenseSettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('License')).toBeInTheDocument();
    });

    // The close button has × character
    const closeBtn = screen.getByText('\u00D7');
    await user.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });

  it('requires confirmation to remove license', async () => {
    const user = userEvent.setup();
    vi.mocked(window.betaflight.getLicenseStatus).mockResolvedValue({
      type: 'paid',
      expiresAt: null,
      key: 'PIDLAB-ABCD-****-****',
      activatedAt: '2026-03-01T00:00:00Z',
    });
    vi.mocked(window.betaflight.removeLicense).mockResolvedValue(undefined);

    render(<LicenseSettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Remove License')).toBeInTheDocument();
    });

    // First click shows confirmation
    await user.click(screen.getByText('Remove License'));
    expect(screen.getByText('Confirm Remove')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();

    // Cancel resets
    await user.click(screen.getByText('Cancel'));
    expect(screen.getByText('Remove License')).toBeInTheDocument();

    // Confirm remove
    await user.click(screen.getByText('Remove License'));
    await user.click(screen.getByText('Confirm Remove'));

    expect(window.betaflight.removeLicense).toHaveBeenCalled();
  });

  it('converts key input to uppercase', async () => {
    const user = userEvent.setup();
    render(<LicenseSettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('PIDLAB-XXXX-XXXX-XXXX')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('PIDLAB-XXXX-XXXX-XXXX') as HTMLInputElement;
    await user.type(input, 'pidlab-test');

    expect(input.value).toBe('PIDLAB-TEST');
  });
});
