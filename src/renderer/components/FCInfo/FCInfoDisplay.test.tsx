import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FCInfoDisplay } from './FCInfoDisplay';
import { _resetDemoModeCache } from '../../hooks/useDemoMode';
import type { FCInfo } from '@shared/types/common.types';

describe('FCInfoDisplay', () => {
  const mockFCInfo: FCInfo = {
    variant: 'BTFL',
    version: '4.4.0',
    target: 'MATEKF405',
    boardName: 'MATEKF405',
    apiVersion: {
      protocol: 0,
      major: 1,
      minor: 45,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetDemoModeCache();

    vi.mocked(window.betaflight.isDemoMode).mockResolvedValue(false);
    vi.mocked(window.betaflight.getConnectionStatus).mockImplementation(() =>
      Promise.resolve({
        connected: true,
        portPath: '/dev/ttyUSB0',
        fcInfo: mockFCInfo,
      })
    );
    vi.mocked(window.betaflight.onConnectionChanged).mockReturnValue(() => {});
    vi.mocked(window.betaflight.getFCInfo).mockImplementation(() => Promise.resolve(mockFCInfo));

    // Mock exportCLI with format parameter
    vi.mocked(window.betaflight.exportCLI).mockImplementation((format: 'diff' | 'dump') => {
      if (format === 'diff') {
        return Promise.resolve('set motor_pwm_protocol = DSHOT600');
      } else {
        return Promise.resolve('# dump\nset motor_pwm_protocol = DSHOT600');
      }
    });

    // Default: blackbox settings return good values
    vi.mocked(window.betaflight.getBlackboxSettings).mockResolvedValue({
      debugMode: 'GYRO_SCALED',
      sampleRate: 1,
      loggingRateHz: 4000,
    });

    // Default: FF config not available (most tests don't need it)
    vi.mocked(window.betaflight.getFeedforwardConfig).mockRejectedValue(new Error('Not connected'));

    // Default: Rates config not available (most tests don't need it)
    vi.mocked(window.betaflight.getRatesConfig).mockRejectedValue(new Error('Not connected'));
  });

  it('renders nothing when not connected', () => {
    vi.mocked(window.betaflight.getConnectionStatus).mockResolvedValue({
      connected: false,
    });

    const { container } = render(<FCInfoDisplay />);
    expect(container.firstChild).toBeNull();
  });

  it('displays FC info title when connected', async () => {
    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Flight Controller Information')).toBeInTheDocument();
    });
  });

  it('displays all FC info fields', async () => {
    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Variant:')).toBeInTheDocument();
      expect(screen.getByText('BTFL')).toBeInTheDocument();
      expect(screen.getByText('Version:')).toBeInTheDocument();
      expect(screen.getByText('4.4.0')).toBeInTheDocument();
      expect(screen.getByText('Target:')).toBeInTheDocument();
      expect(screen.getByText('MATEKF405')).toBeInTheDocument();
      expect(screen.getByText('API Version:')).toBeInTheDocument();
      expect(screen.getByText('1.45')).toBeInTheDocument();
    });
  });

  it('hides board name when same as target', async () => {
    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Target:')).toBeInTheDocument();
    });

    // Board label should not appear when boardName === target
    const boardLabels = screen.queryAllByText('Board:');
    expect(boardLabels.length).toBe(0);
  });

  it('shows board name when different from target', async () => {
    vi.mocked(window.betaflight.getConnectionStatus).mockResolvedValue({
      connected: true,
      portPath: '/dev/ttyUSB0',
      fcInfo: {
        ...mockFCInfo,
        boardName: 'Custom Board Name',
      },
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Board:')).toBeInTheDocument();
      expect(screen.getByText('Custom Board Name')).toBeInTheDocument();
    });
  });

  it('displays export buttons', async () => {
    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Export CLI Diff')).toBeInTheDocument();
      expect(screen.getByText('Export CLI Dump')).toBeInTheDocument();
    });
  });

  it('calls exportCLI when diff button clicked', async () => {
    const user = userEvent.setup();

    render(<FCInfoDisplay />);

    await waitFor(
      () => {
        expect(screen.getByText('Export CLI Diff')).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    const diffButton = screen.getByText('Export CLI Diff');
    await user.click(diffButton);

    await waitFor(() => {
      expect(window.betaflight.exportCLI).toHaveBeenCalledWith('diff');
    });
  });

  it('calls exportCLI when dump button clicked', async () => {
    const user = userEvent.setup();

    render(<FCInfoDisplay />);

    await waitFor(
      () => {
        expect(screen.getByText('Export CLI Dump')).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    const dumpButton = screen.getByText('Export CLI Dump');
    await user.click(dumpButton);

    await waitFor(() => {
      expect(window.betaflight.exportCLI).toHaveBeenCalledWith('dump');
    });
  });

  it('shows loading state', async () => {
    vi.mocked(window.betaflight.getConnectionStatus).mockResolvedValue({
      connected: true,
      portPath: '/dev/ttyUSB0',
    });
    vi.mocked(window.betaflight.getFCInfo).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockFCInfo), 100))
    );

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Loading FC information...')).toBeInTheDocument();
    });
  });

  it('displays error message when fetch fails', async () => {
    const errorMessage = 'Failed to get FC info';
    vi.mocked(window.betaflight.getConnectionStatus).mockResolvedValue({
      connected: true,
      portPath: '/dev/ttyUSB0',
    });
    vi.mocked(window.betaflight.getFCInfo).mockRejectedValue(new Error(errorMessage));

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
  });

  it('fetches FC info when connected without fcInfo in status', async () => {
    vi.mocked(window.betaflight.getConnectionStatus).mockResolvedValue({
      connected: true,
      portPath: '/dev/ttyUSB0',
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(window.betaflight.getFCInfo).toHaveBeenCalled();
    });
  });

  it('uses fcInfo from connection status when available', async () => {
    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('BTFL')).toBeInTheDocument();
    });

    // Should NOT call getFCInfo when fcInfo already in status
    expect(window.betaflight.getFCInfo).not.toHaveBeenCalled();
  });

  // Blackbox settings diagnostics tests

  it('displays blackbox debug mode when GYRO_SCALED', async () => {
    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Debug Mode:')).toBeInTheDocument();
      expect(screen.getByText('GYRO_SCALED')).toBeInTheDocument();
    });
  });

  it('displays logging rate', async () => {
    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Logging Rate:')).toBeInTheDocument();
      expect(screen.getByText('4 kHz')).toBeInTheDocument();
    });
  });

  it('shows checkmark for correct debug mode', async () => {
    const { container } = render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('GYRO_SCALED')).toBeInTheDocument();
    });

    const debugSetting = container.querySelector('.fc-bb-setting.ok');
    expect(debugSetting).not.toBeNull();
  });

  it('shows warning for wrong debug mode', async () => {
    vi.mocked(window.betaflight.getBlackboxSettings).mockResolvedValue({
      debugMode: 'NONE',
      sampleRate: 0,
      loggingRateHz: 8000,
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('NONE')).toBeInTheDocument();
      expect(screen.getByText(/debug_mode = GYRO_SCALED/)).toBeInTheDocument();
    });
  });

  it('shows warning for low logging rate', async () => {
    vi.mocked(window.betaflight.getBlackboxSettings).mockResolvedValue({
      debugMode: 'GYRO_SCALED',
      sampleRate: 3,
      loggingRateHz: 1000,
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('1 kHz')).toBeInTheDocument();
      expect(screen.getByText(/Increase logging rate/)).toBeInTheDocument();
    });
  });

  it('calls getBlackboxSettings on mount when connected', async () => {
    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(window.betaflight.getBlackboxSettings).toHaveBeenCalled();
    });
  });

  it('hides debug mode row for BF 4.6+ (GYRO_SCALED not needed)', async () => {
    vi.mocked(window.betaflight.getConnectionStatus).mockResolvedValue({
      connected: true,
      portPath: '/dev/ttyUSB0',
      fcInfo: { ...mockFCInfo, version: '4.6.0' },
    });
    vi.mocked(window.betaflight.getBlackboxSettings).mockResolvedValue({
      debugMode: 'NONE',
      sampleRate: 0,
      loggingRateHz: 4000,
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Logging Rate:')).toBeInTheDocument();
    });

    // Debug Mode row should not be shown for 4.6+
    expect(screen.queryByText('Debug Mode:')).not.toBeInTheDocument();
    // GYRO_SCALED hint should not appear
    expect(screen.queryByText(/GYRO_SCALED/)).not.toBeInTheDocument();
  });

  it('shows debug mode row for BF 4.5.x', async () => {
    vi.mocked(window.betaflight.getConnectionStatus).mockResolvedValue({
      connected: true,
      portPath: '/dev/ttyUSB0',
      fcInfo: { ...mockFCInfo, version: '4.5.1' },
    });
    vi.mocked(window.betaflight.getBlackboxSettings).mockResolvedValue({
      debugMode: 'NONE',
      sampleRate: 0,
      loggingRateHz: 4000,
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Debug Mode:')).toBeInTheDocument();
      expect(screen.getByText('NONE')).toBeInTheDocument();
      expect(screen.getByText(/GYRO_SCALED/)).toBeInTheDocument();
    });
  });

  it('handles getBlackboxSettings failure gracefully', async () => {
    vi.mocked(window.betaflight.getBlackboxSettings).mockRejectedValue(new Error('CLI failed'));

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('BTFL')).toBeInTheDocument();
    });

    // Should still render FC info without blackbox settings
    expect(screen.queryByText('Debug Mode:')).not.toBeInTheDocument();
  });

  // Feedforward configuration tests

  it('displays feedforward section when FF config available', async () => {
    vi.mocked(window.betaflight.getFeedforwardConfig).mockResolvedValue({
      transition: 0,
      rollGain: 120,
      pitchGain: 120,
      yawGain: 80,
      boost: 15,
      smoothFactor: 37,
      jitterFactor: 7,
      maxRateLimit: 100,
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Feedforward')).toBeInTheDocument();
      expect(screen.getByText('Boost:')).toBeInTheDocument();
      expect(screen.getByText('15')).toBeInTheDocument();
      expect(screen.getByText('120 / 120 / 80')).toBeInTheDocument();
      expect(screen.getByText('Smoothing:')).toBeInTheDocument();
      expect(screen.getByText('37')).toBeInTheDocument();
    });
  });

  it('hides feedforward section when FF config fetch fails', async () => {
    vi.mocked(window.betaflight.getFeedforwardConfig).mockRejectedValue(new Error('Not supported'));

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('BTFL')).toBeInTheDocument();
    });

    expect(screen.queryByText('Feedforward')).not.toBeInTheDocument();
  });

  it('calls getFeedforwardConfig on mount when connected', async () => {
    vi.mocked(window.betaflight.getFeedforwardConfig).mockResolvedValue({
      transition: 0,
      rollGain: 0,
      pitchGain: 0,
      yawGain: 0,
      boost: 0,
      smoothFactor: 0,
      jitterFactor: 0,
      maxRateLimit: 0,
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(window.betaflight.getFeedforwardConfig).toHaveBeenCalled();
    });
  });

  // Fix Settings button tests

  it('shows Fix Settings button when debug_mode is wrong', async () => {
    vi.mocked(window.betaflight.getBlackboxSettings).mockResolvedValue({
      debugMode: 'NONE',
      sampleRate: 0,
      loggingRateHz: 4000,
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Fix Settings')).toBeInTheDocument();
    });
  });

  it('shows Fix Settings button when logging rate is low', async () => {
    vi.mocked(window.betaflight.getBlackboxSettings).mockResolvedValue({
      debugMode: 'GYRO_SCALED',
      sampleRate: 3,
      loggingRateHz: 1000,
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Fix Settings')).toBeInTheDocument();
    });
  });

  it('does not show Fix Settings when settings are correct', async () => {
    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('4 kHz')).toBeInTheDocument();
    });

    expect(screen.queryByText('Fix Settings')).not.toBeInTheDocument();
  });

  it('does not show Fix Settings for BF 4.6+ with only wrong debug_mode', async () => {
    vi.mocked(window.betaflight.getConnectionStatus).mockResolvedValue({
      connected: true,
      portPath: '/dev/ttyUSB0',
      fcInfo: { ...mockFCInfo, version: '4.6.0' },
    });
    vi.mocked(window.betaflight.getBlackboxSettings).mockResolvedValue({
      debugMode: 'NONE',
      sampleRate: 0,
      loggingRateHz: 4000,
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('4 kHz')).toBeInTheDocument();
    });

    expect(screen.queryByText('Fix Settings')).not.toBeInTheDocument();
  });

  it('opens confirm modal when Fix Settings is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(window.betaflight.getBlackboxSettings).mockResolvedValue({
      debugMode: 'NONE',
      sampleRate: 0,
      loggingRateHz: 4000,
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Fix Settings')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Fix Settings'));

    await waitFor(() => {
      expect(screen.getByText('Fix Blackbox Settings')).toBeInTheDocument();
      expect(screen.getByText('set debug_mode = GYRO_SCALED')).toBeInTheDocument();
    });
  });

  it('calls fixBlackboxSettings on confirm', async () => {
    const user = userEvent.setup();
    vi.mocked(window.betaflight.getBlackboxSettings).mockResolvedValue({
      debugMode: 'NONE',
      sampleRate: 3,
      loggingRateHz: 1000,
    });
    vi.mocked(window.betaflight.fixBlackboxSettings).mockResolvedValue({
      success: true,
      appliedCommands: 2,
      rebooted: true,
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Fix Settings')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Fix Settings'));

    await waitFor(() => {
      expect(screen.getByText('Fix & Reboot')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Fix & Reboot'));

    await waitFor(() => {
      expect(window.betaflight.fixBlackboxSettings).toHaveBeenCalledWith({
        commands: ['set debug_mode = GYRO_SCALED', 'set blackbox_sample_rate = 1'],
      });
    });
  });

  // Reset GYRO_SCALED tests

  it('shows Reset button when GYRO_SCALED is active on BF < 4.6', async () => {
    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Reset')).toBeInTheDocument();
    });
  });

  it('does not show Reset button when debug_mode is NONE', async () => {
    vi.mocked(window.betaflight.getBlackboxSettings).mockResolvedValue({
      debugMode: 'NONE',
      sampleRate: 0,
      loggingRateHz: 4000,
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('NONE')).toBeInTheDocument();
    });

    expect(screen.queryByText('Reset')).not.toBeInTheDocument();
  });

  it('opens confirm modal and sends reset command on confirm', async () => {
    const user = userEvent.setup();
    vi.mocked(window.betaflight.fixBlackboxSettings).mockResolvedValue({
      success: true,
      appliedCommands: 1,
      rebooted: true,
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Reset')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Reset'));

    await waitFor(() => {
      expect(screen.getByText('set debug_mode = NONE')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Fix & Reboot'));

    await waitFor(() => {
      expect(window.betaflight.fixBlackboxSettings).toHaveBeenCalledWith({
        commands: ['set debug_mode = NONE'],
      });
    });
  });

  // Demo mode tests

  it('disables Fix Settings button in demo mode', async () => {
    _resetDemoModeCache();
    vi.mocked(window.betaflight.isDemoMode).mockResolvedValue(true);
    vi.mocked(window.betaflight.getBlackboxSettings).mockResolvedValue({
      debugMode: 'NONE',
      sampleRate: 0,
      loggingRateHz: 4000,
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Fix Settings')).toBeInTheDocument();
    });

    const fixBtn = screen.getByText('Fix Settings');
    expect(fixBtn).toBeDisabled();
    expect(fixBtn.title).toBe('Not available in demo mode');
  });

  it('disables Reset button in demo mode', async () => {
    _resetDemoModeCache();
    vi.mocked(window.betaflight.isDemoMode).mockResolvedValue(true);

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Reset')).toBeInTheDocument();
    });

    const resetBtn = screen.getByText('Reset');
    expect(resetBtn).toBeDisabled();
    expect(resetBtn.title).toBe('Not available in demo mode');
  });

  // Rates configuration tests

  it('displays rates section when rates config available', async () => {
    vi.mocked(window.betaflight.getRatesConfig).mockResolvedValue({
      ratesType: 'ACTUAL',
      roll: { rcRate: 15, rate: 200, rcExpo: 56, rateLimit: 1998 },
      pitch: { rcRate: 15, rate: 200, rcExpo: 56, rateLimit: 1998 },
      yaw: { rcRate: 12, rate: 150, rcExpo: 32, rateLimit: 1998 },
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('Rates')).toBeInTheDocument();
      expect(screen.getByText('ACTUAL')).toBeInTheDocument();
      expect(screen.getByText('RC Rate (R/P/Y):')).toBeInTheDocument();
      expect(screen.getByText('15 / 15 / 12')).toBeInTheDocument();
      expect(screen.getByText('Rate (R/P/Y):')).toBeInTheDocument();
      expect(screen.getByText('200 / 200 / 150')).toBeInTheDocument();
      expect(screen.getByText('Expo (R/P/Y):')).toBeInTheDocument();
      expect(screen.getByText('56 / 56 / 32')).toBeInTheDocument();
      expect(screen.getByText('Rate Limit (R/P/Y):')).toBeInTheDocument();
      expect(screen.getByText('1998 / 1998 / 1998')).toBeInTheDocument();
    });
  });

  it('hides rates section when rates config fetch fails', async () => {
    vi.mocked(window.betaflight.getRatesConfig).mockRejectedValue(new Error('Not supported'));

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('BTFL')).toBeInTheDocument();
    });

    expect(screen.queryByText('Rates')).not.toBeInTheDocument();
  });

  it('calls getRatesConfig on mount when connected', async () => {
    vi.mocked(window.betaflight.getRatesConfig).mockResolvedValue({
      ratesType: 'BETAFLIGHT',
      roll: { rcRate: 100, rate: 70, rcExpo: 0, rateLimit: 1998 },
      pitch: { rcRate: 100, rate: 70, rcExpo: 0, rateLimit: 1998 },
      yaw: { rcRate: 100, rate: 70, rcExpo: 0, rateLimit: 1998 },
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(window.betaflight.getRatesConfig).toHaveBeenCalled();
    });
  });

  it('displays correct rates type badge', async () => {
    vi.mocked(window.betaflight.getRatesConfig).mockResolvedValue({
      ratesType: 'QUICK',
      roll: { rcRate: 180, rate: 80, rcExpo: 50, rateLimit: 1998 },
      pitch: { rcRate: 180, rate: 80, rcExpo: 50, rateLimit: 1998 },
      yaw: { rcRate: 150, rate: 60, rcExpo: 30, rateLimit: 1998 },
    });

    render(<FCInfoDisplay />);

    await waitFor(() => {
      expect(screen.getByText('QUICK')).toBeInTheDocument();
    });
  });
});
