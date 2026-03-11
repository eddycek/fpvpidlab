import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TuningWorkflowModal } from './TuningWorkflowModal';
import { TUNING_MODE } from '@shared/constants';

describe('TuningWorkflowModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title with tabs in overview mode', () => {
    render(<TuningWorkflowModal onClose={onClose} />);
    expect(screen.getByText('How to Tune')).toBeInTheDocument();
  });

  it('shows Filter Tune, PID Tune, and Flash Tune tabs in overview mode', () => {
    render(<TuningWorkflowModal onClose={onClose} />);
    expect(screen.getByText('Filter Tune')).toBeInTheDocument();
    expect(screen.getByText('PID Tune')).toBeInTheDocument();
    expect(screen.getByText('Flash Tune')).toBeInTheDocument();
  });

  it('defaults to Filter Tune tab showing filter workflow steps', () => {
    render(<TuningWorkflowModal onClose={onClose} />);
    expect(screen.getByText('Connect your drone')).toBeInTheDocument();
    expect(screen.getByText('Create a backup')).toBeInTheDocument();
    expect(screen.getByText('Check Blackbox setup')).toBeInTheDocument();
    expect(screen.getByText('Erase Blackbox data')).toBeInTheDocument();
    expect(screen.getByText('Fly: Filter test flight')).toBeInTheDocument();
    expect(screen.getByText('Analyze & apply filters')).toBeInTheDocument();
    // PID steps are on the PID Tune tab, not shown here
    expect(screen.queryByText('Erase Blackbox data again')).not.toBeInTheDocument();
    expect(screen.queryByText('Fly: PID test flight')).not.toBeInTheDocument();
  });

  it('shows filter flight guide section in Filter Tune tab', () => {
    render(<TuningWorkflowModal onClose={onClose} />);
    expect(screen.getByText('Filter Test Flight')).toBeInTheDocument();
    // PID flight guide is on PID Tune tab
    expect(screen.queryByText('PID Test Flight')).not.toBeInTheDocument();
  });

  it('shows filter flight guide phases in Filter Tune tab', () => {
    render(<TuningWorkflowModal onClose={onClose} />);
    expect(screen.getAllByText('Throttle Sweep').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Final Hover').length).toBeGreaterThanOrEqual(1);
  });

  it('shows PID flight guide phases in PID Tune tab', async () => {
    const user = userEvent.setup();
    render(<TuningWorkflowModal onClose={onClose} />);
    await user.click(screen.getByText('PID Tune'));
    expect(screen.getByText('Roll Snaps')).toBeInTheDocument();
    expect(screen.getByText('Pitch Snaps')).toBeInTheDocument();
    expect(screen.getByText('Yaw Snaps')).toBeInTheDocument();
  });

  it('shows tips in Filter Tune tab', () => {
    render(<TuningWorkflowModal onClose={onClose} />);
    const tipHeaders = screen.getAllByText('Tips');
    expect(tipHeaders.length).toBeGreaterThanOrEqual(1);
  });

  it('switches to Flash Tune tab on click', async () => {
    const user = userEvent.setup();
    render(<TuningWorkflowModal onClose={onClose} />);

    await user.click(screen.getByText('Flash Tune'));

    // Filter Tune content should be hidden
    expect(screen.queryByText('Connect your drone')).not.toBeInTheDocument();
    expect(screen.queryByText('Filter Test Flight')).not.toBeInTheDocument();

    // Flash Tune content should be visible
    expect(screen.getByText(/Rip a pack, land, tune/)).toBeInTheDocument();
  });

  it('switches back to Filter Tune tab', async () => {
    const user = userEvent.setup();
    render(<TuningWorkflowModal onClose={onClose} />);

    await user.click(screen.getByText('Flash Tune'));
    await user.click(screen.getByText('Filter Tune'));

    expect(screen.getByText('Connect your drone')).toBeInTheDocument();
    expect(screen.getByText('Filter Test Flight')).toBeInTheDocument();
  });

  it('calls onClose when "Got it" is clicked', async () => {
    const user = userEvent.setup();
    render(<TuningWorkflowModal onClose={onClose} />);

    await user.click(screen.getByText('Got it'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when overlay backdrop is clicked', async () => {
    const user = userEvent.setup();
    render(<TuningWorkflowModal onClose={onClose} />);

    // Click the overlay (the outermost element with the overlay class)
    const overlay = document.querySelector('.profile-wizard-overlay')!;
    await user.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when modal content is clicked', async () => {
    const user = userEvent.setup();
    render(<TuningWorkflowModal onClose={onClose} />);

    const modal = document.querySelector('.profile-wizard-modal')!;
    await user.click(modal);
    expect(onClose).not.toHaveBeenCalled();
  });

  describe('mode={TUNING_MODE.FILTER}', () => {
    it('shows only filter workflow steps (1–6)', () => {
      render(<TuningWorkflowModal onClose={onClose} mode={TUNING_MODE.FILTER} />);
      expect(screen.getByText('Connect your drone')).toBeInTheDocument();
      expect(screen.getByText('Create a backup')).toBeInTheDocument();
      expect(screen.getByText('Check Blackbox setup')).toBeInTheDocument();
      expect(screen.getByText('Erase Blackbox data')).toBeInTheDocument();
      expect(screen.getByText('Fly: Filter test flight')).toBeInTheDocument();
      expect(screen.getByText('Analyze & apply filters')).toBeInTheDocument();
      // PID and verification steps hidden
      expect(screen.queryByText('Erase Blackbox data again')).not.toBeInTheDocument();
      expect(screen.queryByText('Fly: PID test flight')).not.toBeInTheDocument();
      expect(screen.queryByText('Analyze & apply PIDs')).not.toBeInTheDocument();
      expect(screen.queryByText('Verification flight')).not.toBeInTheDocument();
    });

    it('shows only filter flight guide section', () => {
      render(<TuningWorkflowModal onClose={onClose} mode={TUNING_MODE.FILTER} />);
      expect(screen.getByText('Filter Test Flight')).toBeInTheDocument();
      expect(screen.queryByText('PID Test Flight')).not.toBeInTheDocument();
    });

    it('shows filter-specific subtitle', () => {
      render(<TuningWorkflowModal onClose={onClose} mode={TUNING_MODE.FILTER} />);
      expect(
        screen.getByText('Follow these steps for the filter tuning flight.')
      ).toBeInTheDocument();
    });

    it('does not show tabs', () => {
      render(<TuningWorkflowModal onClose={onClose} mode={TUNING_MODE.FILTER} />);
      expect(screen.queryByText('Filter Tune')).not.toBeInTheDocument();
      expect(screen.queryByText('Flash Tune')).not.toBeInTheDocument();
    });
  });

  describe('mode={TUNING_MODE.PID}', () => {
    it('shows only PID workflow steps (7–9)', () => {
      render(<TuningWorkflowModal onClose={onClose} mode={TUNING_MODE.PID} />);
      expect(screen.getByText('Erase Blackbox data again')).toBeInTheDocument();
      expect(screen.getByText('Fly: PID test flight')).toBeInTheDocument();
      expect(screen.getByText('Analyze & apply PIDs')).toBeInTheDocument();
      // Filter and verification steps hidden
      expect(screen.queryByText('Connect your drone')).not.toBeInTheDocument();
      expect(screen.queryByText('Create a backup')).not.toBeInTheDocument();
      expect(screen.queryByText('Fly: Filter test flight')).not.toBeInTheDocument();
      expect(screen.queryByText('Analyze & apply filters')).not.toBeInTheDocument();
      expect(screen.queryByText('Verification flight')).not.toBeInTheDocument();
    });

    it('shows only PID flight guide section', () => {
      render(<TuningWorkflowModal onClose={onClose} mode={TUNING_MODE.PID} />);
      expect(screen.queryByText('Filter Test Flight')).not.toBeInTheDocument();
      expect(screen.getByText('PID Test Flight')).toBeInTheDocument();
    });

    it('shows PID-specific subtitle', () => {
      render(<TuningWorkflowModal onClose={onClose} mode={TUNING_MODE.PID} />);
      expect(screen.getByText('Follow these steps for the PID tuning flight.')).toBeInTheDocument();
    });
  });

  describe('mode="verification"', () => {
    it('shows verification title and subtitle', () => {
      render(<TuningWorkflowModal onClose={onClose} mode="verification" />);
      expect(screen.getByText('Verification Hover')).toBeInTheDocument();
      expect(
        screen.getByText('Fly a short hover to verify noise improvement after tuning.')
      ).toBeInTheDocument();
    });

    it('shows verification flight phases', () => {
      render(<TuningWorkflowModal onClose={onClose} mode="verification" />);
      expect(screen.getByText('Throttle Sweep')).toBeInTheDocument();
      expect(screen.getByText('Final Hover')).toBeInTheDocument();
    });

    it('does not show workflow steps or filter/PID guides', () => {
      render(<TuningWorkflowModal onClose={onClose} mode="verification" />);
      expect(screen.queryByText('Connect your drone')).not.toBeInTheDocument();
      expect(screen.queryByText('Flight 1: Filter Test Flight')).not.toBeInTheDocument();
      expect(screen.queryByText('Flight 2: PID Test Flight')).not.toBeInTheDocument();
    });

    it('shows verification-specific tips', () => {
      render(<TuningWorkflowModal onClose={onClose} mode="verification" />);
      expect(screen.getByText(/before\/after spectra/)).toBeInTheDocument();
    });
  });
});
