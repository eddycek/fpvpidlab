import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StartTuningModal } from './StartTuningModal';
import { TUNING_TYPE } from '@shared/constants';
import type { FCInfo } from '@shared/types/common.types';

const DEMO_FC_INFO: FCInfo = {
  variant: 'BTFL',
  version: '4.5.1',
  target: 'STM32F405',
  boardName: 'OMNIBUSF4SD',
  apiVersion: { protocol: 0, major: 1, minor: 46 },
  pidProfileIndex: 0,
  pidProfileCount: 4,
};

describe('StartTuningModal', () => {
  it('renders all three tuning mode options', () => {
    render(<StartTuningModal onStart={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText('Filter Tune')).toBeInTheDocument();
    expect(screen.getByText('PID Tune')).toBeInTheDocument();
    expect(screen.getByText('Flash Tune')).toBeInTheDocument();
    expect(screen.getAllByText('2 flights')).toHaveLength(3);
  });

  it('shows "Start here" badge on Filter Tune', () => {
    render(<StartTuningModal onStart={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText('Start here')).toBeInTheDocument();
  });

  it('calls onStart with filter when Filter Tune clicked', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<StartTuningModal onStart={onStart} onCancel={vi.fn()} />);

    await user.click(screen.getByText('Filter Tune'));
    expect(onStart).toHaveBeenCalledWith(TUNING_TYPE.FILTER, undefined);
  });

  it('calls onStart with pid when PID Tune clicked', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<StartTuningModal onStart={onStart} onCancel={vi.fn()} />);

    await user.click(screen.getByText('PID Tune'));
    expect(onStart).toHaveBeenCalledWith(TUNING_TYPE.PID, undefined);
  });

  it('calls onStart with quick when Flash Tune clicked', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<StartTuningModal onStart={onStart} onCancel={vi.fn()} />);

    await user.click(screen.getByText('Flash Tune'));
    expect(onStart).toHaveBeenCalledWith(TUNING_TYPE.FLASH, undefined);
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

  // PID profile selector tests
  it('shows profile selector when fcInfo has multiple profiles', () => {
    render(<StartTuningModal onStart={vi.fn()} onCancel={vi.fn()} fcInfo={DEMO_FC_INFO} />);

    expect(screen.getByText('BF PID Profile')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('does not show profile selector when fcInfo has single profile', () => {
    const singleProfileFC: FCInfo = { ...DEMO_FC_INFO, pidProfileCount: 1 };
    render(<StartTuningModal onStart={vi.fn()} onCancel={vi.fn()} fcInfo={singleProfileFC} />);

    expect(screen.queryByText('BF PID Profile')).not.toBeInTheDocument();
  });

  it('passes selected profile index when starting tuning', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(<StartTuningModal onStart={onStart} onCancel={vi.fn()} fcInfo={DEMO_FC_INFO} />);

    // Click profile 2 (index 1)
    await user.click(screen.getByText('2'));
    await user.click(screen.getByText('Filter Tune'));

    expect(onStart).toHaveBeenCalledWith(TUNING_TYPE.FILTER, 1);
  });

  it('shows "current" label on active FC profile', () => {
    render(<StartTuningModal onStart={vi.fn()} onCancel={vi.fn()} fcInfo={DEMO_FC_INFO} />);

    expect(screen.getByText('current')).toBeInTheDocument();
  });

  it('shows user-defined profile labels', () => {
    render(
      <StartTuningModal
        onStart={vi.fn()}
        onCancel={vi.fn()}
        fcInfo={DEMO_FC_INFO}
        pidProfileLabels={{ 0: 'Stock', 1: 'Tuned' }}
      />
    );

    expect(screen.getByText('Stock')).toBeInTheDocument();
    expect(screen.getByText('Tuned')).toBeInTheDocument();
  });

  it('defaults to profile from defaultPidProfileIndex prop', async () => {
    const onStart = vi.fn();
    const user = userEvent.setup();
    render(
      <StartTuningModal
        onStart={onStart}
        onCancel={vi.fn()}
        fcInfo={DEMO_FC_INFO}
        defaultPidProfileIndex={2}
      />
    );

    // Without clicking any profile button, start Filter Tune
    await user.click(screen.getByText('Filter Tune'));
    expect(onStart).toHaveBeenCalledWith(TUNING_TYPE.FILTER, 2);
  });
});
