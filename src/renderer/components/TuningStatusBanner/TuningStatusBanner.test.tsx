import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TuningStatusBanner } from './TuningStatusBanner';
import type { TuningSession } from '@shared/types/tuning.types';
import { TUNING_MODE, TUNING_PHASE, TUNING_TYPE } from '@shared/constants';

const baseSession: TuningSession = {
  profileId: 'profile-1',
  phase: TUNING_PHASE.FILTER_FLIGHT_PENDING,
  tuningType: TUNING_TYPE.FILTER,
  startedAt: '2026-02-10T10:00:00Z',
  updatedAt: '2026-02-10T10:00:00Z',
};

describe('TuningStatusBanner', () => {
  const onAction = vi.fn();
  const onViewGuide = vi.fn();
  const onReset = vi.fn();

  const onFixSettings = vi.fn();

  function renderBanner(
    session: TuningSession = baseSession,
    flashErased?: boolean,
    overrides?: {
      bbSettingsOk?: boolean;
      fixingSettings?: boolean;
      flashUsedSize?: number | null;
      isDemoMode?: boolean;
      storageType?: 'flash' | 'sdcard' | 'none';
    }
  ) {
    return render(
      <TuningStatusBanner
        session={session}
        flashErased={flashErased}
        flashUsedSize={overrides?.flashUsedSize}
        storageType={overrides?.storageType}
        bbSettingsOk={overrides?.bbSettingsOk}
        fixingSettings={overrides?.fixingSettings}
        isDemoMode={overrides?.isDemoMode}
        onAction={onAction}
        onViewGuide={onViewGuide}
        onReset={onReset}
        onFixSettings={onFixSettings}
      />
    );
  }

  it('renders 4-step indicators (Prepare, Flight, Tune, Verify)', () => {
    renderBanner();

    expect(screen.getByText('Prepare')).toBeInTheDocument();
    expect(screen.getByText('Flight')).toBeInTheDocument();
    expect(screen.getByText('Tune')).toBeInTheDocument();
    expect(screen.getByText('Verify')).toBeInTheDocument();
  });

  it('shows filter_flight_pending UI', () => {
    renderBanner();

    expect(
      screen.getByText(/Erase Blackbox data from flash, then fly the filter test flight/)
    ).toBeInTheDocument();
    expect(screen.getByText('Erase Flash')).toBeInTheDocument();
    expect(screen.getByText('View Flight Guide')).toBeInTheDocument();
  });

  it('shows filter_analysis UI', () => {
    renderBanner({ ...baseSession, phase: TUNING_PHASE.FILTER_ANALYSIS });

    expect(screen.getByText(/Run the Filter Wizard/)).toBeInTheDocument();
    expect(screen.getByText('Open Filter Wizard')).toBeInTheDocument();
  });

  it('shows pid_flight_pending UI', () => {
    renderBanner({
      ...baseSession,
      tuningType: TUNING_TYPE.PID,
      phase: TUNING_PHASE.PID_FLIGHT_PENDING,
    });

    expect(
      screen.getByText(/Erase Blackbox data from flash, then fly the PID test flight/)
    ).toBeInTheDocument();
    expect(screen.getByText('Erase Flash')).toBeInTheDocument();
    expect(screen.getByText('View Flight Guide')).toBeInTheDocument();
  });

  it('shows pid_analysis UI', () => {
    renderBanner({
      ...baseSession,
      tuningType: TUNING_TYPE.PID,
      phase: TUNING_PHASE.PID_ANALYSIS,
    });

    expect(screen.getByText(/Run the PID Wizard/)).toBeInTheDocument();
    expect(screen.getByText('Open PID Wizard')).toBeInTheDocument();
  });

  it('shows completed UI', () => {
    renderBanner({ ...baseSession, phase: TUNING_PHASE.COMPLETED });

    expect(screen.getByText(/Tuning complete/)).toBeInTheDocument();
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
  });

  it('calls onAction with correct action when primary button clicked', async () => {
    const user = userEvent.setup();
    renderBanner({ ...baseSession, phase: TUNING_PHASE.FILTER_ANALYSIS });

    await user.click(screen.getByText('Open Filter Wizard'));
    expect(onAction).toHaveBeenCalledWith('open_filter_wizard');
  });

  it('calls onViewGuide when View Flight Guide clicked', async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByText('View Flight Guide'));
    expect(onViewGuide).toHaveBeenCalledWith(TUNING_MODE.FILTER);
  });

  it('calls onViewGuide with pid mode for pid phases', async () => {
    const user = userEvent.setup();
    renderBanner({
      ...baseSession,
      tuningType: TUNING_TYPE.PID,
      phase: TUNING_PHASE.PID_FLIGHT_PENDING,
    });

    await user.click(screen.getByText('View Flight Guide'));
    expect(onViewGuide).toHaveBeenCalledWith(TUNING_MODE.PID);
  });

  it('calls onReset when Reset Session clicked', async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByText('Reset Session'));
    expect(onReset).toHaveBeenCalled();
  });

  it('does not show View Flight Guide for phases without guideTip', () => {
    renderBanner({ ...baseSession, phase: TUNING_PHASE.FILTER_ANALYSIS });

    expect(screen.queryByText('View Flight Guide')).not.toBeInTheDocument();
  });

  it('shows download log button for filter_log_ready', async () => {
    const user = userEvent.setup();
    renderBanner({ ...baseSession, phase: TUNING_PHASE.FILTER_LOG_READY });

    expect(screen.getByText(/Download the Blackbox log/)).toBeInTheDocument();
    await user.click(screen.getByText('Download Log'));
    expect(onAction).toHaveBeenCalledWith('download_log');
  });

  it('shows download log button for pid_log_ready', async () => {
    const user = userEvent.setup();
    renderBanner({
      ...baseSession,
      tuningType: TUNING_TYPE.PID,
      phase: TUNING_PHASE.PID_LOG_READY,
    });

    expect(screen.getByText(/Download the Blackbox log/)).toBeInTheDocument();
    await user.click(screen.getByText('Download Log'));
    expect(onAction).toHaveBeenCalledWith('download_log');
  });

  it('shows flash erased state for filter_flight_pending', async () => {
    const user = userEvent.setup();
    renderBanner(baseSession, true);

    expect(
      screen.getByText(/Flash erased! Disconnect your drone and fly the filter test flight/)
    ).toBeInTheDocument();
    expect(screen.queryByText('Erase Flash')).not.toBeInTheDocument();
    const guideBtn = screen.getByText('View Flight Guide');
    expect(guideBtn.className).toContain('wizard-btn-primary');
    await user.click(guideBtn);
    expect(onViewGuide).toHaveBeenCalledWith(TUNING_MODE.FILTER);
  });

  it('advances step indicator after flash erased in filter_flight_pending', () => {
    const { container } = renderBanner(baseSession, true);

    const steps = container.querySelectorAll('.tuning-status-step');
    expect(steps[0].className).toContain('done');
    expect(steps[1].className).toContain('current');
  });

  it('shows flash erased state for pid_flight_pending', async () => {
    const user = userEvent.setup();
    renderBanner(
      { ...baseSession, tuningType: TUNING_TYPE.PID, phase: TUNING_PHASE.PID_FLIGHT_PENDING },
      true
    );

    expect(
      screen.getByText(/Flash erased! Disconnect your drone and fly the PID test flight/)
    ).toBeInTheDocument();
    expect(screen.queryByText('Erase Flash')).not.toBeInTheDocument();
    const guideBtn = screen.getByText('View Flight Guide');
    await user.click(guideBtn);
    expect(onViewGuide).toHaveBeenCalledWith(TUNING_MODE.PID);
  });

  it('shows Skip Erase button for filter_flight_pending', async () => {
    const user = userEvent.setup();
    renderBanner();

    expect(screen.getByText('Skip Erase')).toBeInTheDocument();
    await user.click(screen.getByText('Skip Erase'));
    expect(onAction).toHaveBeenCalledWith('skip_erase');
  });

  it('shows Skip Erase button for pid_flight_pending', () => {
    renderBanner({
      ...baseSession,
      tuningType: TUNING_TYPE.PID,
      phase: TUNING_PHASE.PID_FLIGHT_PENDING,
    });

    expect(screen.getByText('Skip Erase')).toBeInTheDocument();
  });

  it('shows filter_applied UI with Erase & Verify button', async () => {
    const user = userEvent.setup();
    renderBanner({ ...baseSession, phase: TUNING_PHASE.FILTER_APPLIED });

    expect(screen.getByText(/Filters applied/)).toBeInTheDocument();
    expect(screen.getByText('Erase & Verify')).toBeInTheDocument();

    await user.click(screen.getByText('Erase & Verify'));
    expect(onAction).toHaveBeenCalledWith('prepare_verification');
  });

  it('shows erased state when session.eraseSkipped is true even with flash data', () => {
    renderBanner({ ...baseSession, eraseSkipped: true }, false, { flashUsedSize: 26000000 });

    expect(
      screen.getByText(/Flash erased! Disconnect your drone and fly the filter test flight/)
    ).toBeInTheDocument();
    expect(screen.queryByText('Erase Flash')).not.toBeInTheDocument();
    expect(screen.getByText('View Flight Guide')).toBeInTheDocument();
  });

  it('shows erased state for pid_flight_pending with eraseSkipped', () => {
    renderBanner(
      {
        ...baseSession,
        tuningType: TUNING_TYPE.PID,
        phase: TUNING_PHASE.PID_FLIGHT_PENDING,
        eraseSkipped: true,
      },
      false,
      {
        flashUsedSize: 26000000,
      }
    );

    expect(
      screen.getByText(/Flash erased! Disconnect your drone and fly the PID test flight/)
    ).toBeInTheDocument();
    expect(screen.queryByText('Erase Flash')).not.toBeInTheDocument();
  });

  it('does not show erased state for eraseSkipped in non-flight-pending phase', () => {
    renderBanner(
      { ...baseSession, phase: TUNING_PHASE.FILTER_ANALYSIS, eraseSkipped: true },
      false
    );

    expect(screen.queryByText(/Flash erased!/)).not.toBeInTheDocument();
    expect(screen.getByText('Open Filter Wizard')).toBeInTheDocument();
  });

  it('does not show Skip Erase for non-erase phases', () => {
    renderBanner({ ...baseSession, phase: TUNING_PHASE.FILTER_ANALYSIS });

    expect(screen.queryByText('Skip Erase')).not.toBeInTheDocument();
  });

  it('hides Skip Erase during erase operation', () => {
    render(
      <TuningStatusBanner
        session={baseSession}
        onAction={onAction}
        onViewGuide={onViewGuide}
        onReset={onReset}
        erasing
      />
    );

    expect(screen.queryByText('Skip Erase')).not.toBeInTheDocument();
    expect(screen.getByText('Erasing...')).toBeInTheDocument();
  });

  it('does not show flash erased state when flashErased is false', () => {
    renderBanner(baseSession, false);

    expect(screen.getByText('Erase Flash')).toBeInTheDocument();
    expect(screen.queryByText(/Flash erased!/)).not.toBeInTheDocument();
  });

  it('does not show flash erased state for non-flight-pending phases', () => {
    renderBanner({ ...baseSession, phase: TUNING_PHASE.FILTER_ANALYSIS }, true);

    expect(screen.queryByText(/Flash erased!/)).not.toBeInTheDocument();
    expect(screen.getByText('Open Filter Wizard')).toBeInTheDocument();
  });

  it('shows downloading state when downloading prop is true', () => {
    render(
      <TuningStatusBanner
        session={{ ...baseSession, phase: TUNING_PHASE.FILTER_LOG_READY }}
        onAction={onAction}
        onViewGuide={onViewGuide}
        onReset={onReset}
        downloading
      />
    );

    expect(screen.getByText('Downloading...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Downloading/ })).toBeDisabled();
  });

  it('shows download progress percentage when downloadProgress is set', () => {
    render(
      <TuningStatusBanner
        session={{ ...baseSession, phase: TUNING_PHASE.FILTER_LOG_READY }}
        onAction={onAction}
        onViewGuide={onViewGuide}
        onReset={onReset}
        downloading
        downloadProgress={42}
      />
    );

    expect(screen.getByText('Downloading... 42%')).toBeInTheDocument();
  });

  it('disables primary button when downloading', () => {
    render(
      <TuningStatusBanner
        session={{
          ...baseSession,
          tuningType: TUNING_TYPE.PID,
          phase: TUNING_PHASE.PID_LOG_READY,
        }}
        onAction={onAction}
        onViewGuide={onViewGuide}
        onReset={onReset}
        downloading
      />
    );

    expect(screen.getByRole('button', { name: /Downloading/ })).toBeDisabled();
  });

  it('shows pid_applied UI with Erase & Verify button', async () => {
    const user = userEvent.setup();
    renderBanner({
      ...baseSession,
      tuningType: TUNING_TYPE.PID,
      phase: TUNING_PHASE.PID_APPLIED,
    });

    expect(screen.getByText(/PIDs applied/)).toBeInTheDocument();
    expect(screen.getByText('Erase & Verify')).toBeInTheDocument();

    await user.click(screen.getByText('Erase & Verify'));
    expect(onAction).toHaveBeenCalledWith('prepare_verification');
  });

  it('shows verification_pending UI with Download Log', async () => {
    const user = userEvent.setup();
    renderBanner({ ...baseSession, phase: TUNING_PHASE.VERIFICATION_PENDING });

    expect(screen.getByText(/Download the verification log/)).toBeInTheDocument();
    expect(screen.getByText('Download Log')).toBeInTheDocument();

    await user.click(screen.getByText('Download Log'));
    expect(onAction).toHaveBeenCalledWith('download_log');
  });

  it('shows verification_pending UI with Analyze when log downloaded', async () => {
    const user = userEvent.setup();
    renderBanner({
      ...baseSession,
      phase: TUNING_PHASE.VERIFICATION_PENDING,
      verificationLogId: 'log-ver',
    });

    expect(screen.getByText(/Verification log ready/)).toBeInTheDocument();
    expect(screen.getByText('Analyze Verification')).toBeInTheDocument();

    await user.click(screen.getByText('Analyze Verification'));
    expect(onAction).toHaveBeenCalledWith('analyze_verification');
  });

  // Blackbox settings pre-flight warning tests

  it('shows BB warning during filter_flight_pending with bbSettingsOk=false', () => {
    renderBanner(baseSession, false, { bbSettingsOk: false });

    expect(screen.getByText(/Blackbox settings need to be fixed/)).toBeInTheDocument();
    expect(screen.getByText('Fix Settings')).toBeInTheDocument();
  });

  it('shows BB warning during pid_flight_pending with bbSettingsOk=false', () => {
    renderBanner(
      { ...baseSession, tuningType: TUNING_TYPE.PID, phase: TUNING_PHASE.PID_FLIGHT_PENDING },
      false,
      {
        bbSettingsOk: false,
      }
    );

    expect(screen.getByText(/Blackbox settings need to be fixed/)).toBeInTheDocument();
  });

  it('does not show BB warning when bbSettingsOk=true', () => {
    renderBanner(baseSession, false, { bbSettingsOk: true });

    expect(screen.queryByText(/Blackbox settings need to be fixed/)).not.toBeInTheDocument();
  });

  it('does not show BB warning for non-flight-pending phases', () => {
    renderBanner({ ...baseSession, phase: TUNING_PHASE.FILTER_ANALYSIS }, false, {
      bbSettingsOk: false,
    });

    expect(screen.queryByText(/Blackbox settings need to be fixed/)).not.toBeInTheDocument();
  });

  it('does not show BB warning after flash erased', () => {
    renderBanner(baseSession, true, { bbSettingsOk: false });

    expect(screen.queryByText(/Blackbox settings need to be fixed/)).not.toBeInTheDocument();
  });

  it('calls onFixSettings when Fix Settings clicked in warning', async () => {
    const user = userEvent.setup();
    renderBanner(baseSession, false, { bbSettingsOk: false });

    await user.click(screen.getByText('Fix Settings'));
    expect(onFixSettings).toHaveBeenCalled();
  });

  // flashUsedSize-based erased state tests

  it('shows erased state when flash is physically empty on reconnect (flashUsedSize=0)', () => {
    renderBanner(baseSession, false, { flashUsedSize: 0 });

    expect(
      screen.getByText(/Flash erased! Disconnect your drone and fly the filter test flight/)
    ).toBeInTheDocument();
    expect(screen.queryByText('Erase Flash')).not.toBeInTheDocument();
  });

  it('shows Erase Flash when flash has data (flashUsedSize > 0)', () => {
    renderBanner(baseSession, false, { flashUsedSize: 1000 });

    expect(screen.getByText('Erase Flash')).toBeInTheDocument();
    expect(screen.queryByText(/Flash erased!/)).not.toBeInTheDocument();
  });

  it('shows Erase Flash when flashUsedSize is null (loading/unknown)', () => {
    renderBanner(baseSession, false, { flashUsedSize: null });

    expect(screen.getByText('Erase Flash')).toBeInTheDocument();
    expect(screen.queryByText(/Flash erased!/)).not.toBeInTheDocument();
  });

  it('shows erased state for pid_flight_pending when flash is empty', () => {
    renderBanner(
      { ...baseSession, tuningType: TUNING_TYPE.PID, phase: TUNING_PHASE.PID_FLIGHT_PENDING },
      false,
      {
        flashUsedSize: 0,
      }
    );

    expect(
      screen.getByText(/Flash erased! Disconnect your drone and fly the PID test flight/)
    ).toBeInTheDocument();
    expect(screen.queryByText('Erase Flash')).not.toBeInTheDocument();
  });

  it('does not show erased state for non-flight-pending phase even with flashUsedSize=0', () => {
    renderBanner({ ...baseSession, phase: TUNING_PHASE.FILTER_ANALYSIS }, false, {
      flashUsedSize: 0,
    });

    expect(screen.queryByText(/Flash erased!/)).not.toBeInTheDocument();
    expect(screen.getByText('Open Filter Wizard')).toBeInTheDocument();
  });

  it('shows erased state with flight guide for filter_verification_pending after erase', () => {
    renderBanner({ ...baseSession, phase: TUNING_PHASE.FILTER_VERIFICATION_PENDING }, true);

    expect(
      screen.getByText(/Flash erased! Disconnect and fly throttle sweeps/)
    ).toBeInTheDocument();
    expect(screen.getByText('View Flight Guide')).toBeInTheDocument();
    expect(screen.queryByText('Download Log')).not.toBeInTheDocument();
  });

  it('shows Download Log for verification_pending when flash has data (reconnect after flight)', () => {
    renderBanner({ ...baseSession, phase: TUNING_PHASE.VERIFICATION_PENDING }, false, {
      flashUsedSize: 1000,
    });

    expect(screen.getByText('Download Log')).toBeInTheDocument();
    expect(screen.queryByText('View Flight Guide')).not.toBeInTheDocument();
  });

  it('shows Download Log when flashErased is stale but flash has data', () => {
    renderBanner({ ...baseSession, phase: TUNING_PHASE.VERIFICATION_PENDING }, true, {
      flashUsedSize: 8000,
    });

    expect(screen.getByText('Download Log')).toBeInTheDocument();
    expect(screen.queryByText('View Flight Guide')).not.toBeInTheDocument();
  });

  // Import File button tests
  it('shows Import File button in filter_log_ready phase', () => {
    renderBanner({ ...baseSession, phase: TUNING_PHASE.FILTER_LOG_READY });

    expect(screen.getByText('Download Log')).toBeInTheDocument();
    expect(screen.getByText('Import File')).toBeInTheDocument();
  });

  it('shows Import File button in pid_log_ready phase', () => {
    renderBanner({
      ...baseSession,
      tuningType: TUNING_TYPE.PID,
      phase: TUNING_PHASE.PID_LOG_READY,
    });

    expect(screen.getByText('Download Log')).toBeInTheDocument();
    expect(screen.getByText('Import File')).toBeInTheDocument();
  });

  it('shows Import File button in verification_pending without log', () => {
    renderBanner({ ...baseSession, phase: TUNING_PHASE.VERIFICATION_PENDING }, false, {
      flashUsedSize: 1000,
    });

    expect(screen.getByText('Download Log')).toBeInTheDocument();
    expect(screen.getByText('Import File')).toBeInTheDocument();
  });

  it('fires import_log action when Import File is clicked', async () => {
    const user = userEvent.setup();
    renderBanner({ ...baseSession, phase: TUNING_PHASE.FILTER_LOG_READY });

    await user.click(screen.getByText('Import File'));
    expect(onAction).toHaveBeenCalledWith('import_log');
  });

  it('does not show Import File button in erase phases', () => {
    renderBanner({ ...baseSession, phase: 'filter_flight_pending' });

    expect(screen.getByText('Erase Flash')).toBeInTheDocument();
    expect(screen.queryByText('Import File')).not.toBeInTheDocument();
  });

  it('does not show Import File button in analysis phases', () => {
    renderBanner({ ...baseSession, phase: TUNING_PHASE.FILTER_ANALYSIS });

    expect(screen.getByText('Open Filter Wizard')).toBeInTheDocument();
    expect(screen.queryByText('Import File')).not.toBeInTheDocument();
  });

  // Demo mode tests

  it('hides BB warning in demo mode even with bbSettingsOk=false', () => {
    renderBanner(baseSession, false, { bbSettingsOk: false, isDemoMode: true });

    expect(screen.queryByText(/Blackbox settings need to be fixed/)).not.toBeInTheDocument();
    expect(screen.queryByText('Fix Settings')).not.toBeInTheDocument();
  });

  // SD card storage type tests

  it('shows "Erase Logs" label for SD card in filter_flight_pending', () => {
    renderBanner(baseSession, false, { storageType: 'sdcard' });

    expect(screen.getByText('Erase Logs')).toBeInTheDocument();
    expect(screen.queryByText('Erase Flash')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Erase Blackbox data from SD card, then fly the filter test flight/)
    ).toBeInTheDocument();
  });

  it('shows "Erase Logs" label for SD card in pid_flight_pending', () => {
    renderBanner(
      { ...baseSession, tuningType: TUNING_TYPE.PID, phase: TUNING_PHASE.PID_FLIGHT_PENDING },
      false,
      {
        storageType: 'sdcard',
      }
    );

    expect(screen.getByText('Erase Logs')).toBeInTheDocument();
    expect(
      screen.getByText(/Erase Blackbox data from SD card, then fly the PID test flight/)
    ).toBeInTheDocument();
  });

  it('shows "Logs erased" text for SD card after erase', () => {
    renderBanner({ ...baseSession, eraseCompleted: true }, false, {
      storageType: 'sdcard',
      flashUsedSize: 32000,
    });

    expect(
      screen.getByText(/Logs erased! Disconnect your drone and fly the filter test flight/)
    ).toBeInTheDocument();
    expect(screen.queryByText('Erase Logs')).not.toBeInTheDocument();
  });

  it('shows erased state for SD card via eraseCompleted even with flashUsedSize > 0', () => {
    renderBanner({ ...baseSession, eraseCompleted: true }, false, {
      storageType: 'sdcard',
      flashUsedSize: 65536,
    });

    expect(screen.getByText(/Logs erased!/)).toBeInTheDocument();
    expect(screen.getByText('View Flight Guide')).toBeInTheDocument();
  });

  it('shows "Erase Logs & Verify" for SD card in pid_applied', () => {
    renderBanner(
      { ...baseSession, tuningType: TUNING_TYPE.PID, phase: TUNING_PHASE.PID_APPLIED },
      false,
      {
        storageType: 'sdcard',
      }
    );

    expect(screen.getByText('Erase Logs & Verify')).toBeInTheDocument();
    expect(screen.queryByText('Erase & Verify')).not.toBeInTheDocument();
  });

  it('shows "Flash erased" text for flash storage (default)', () => {
    renderBanner(baseSession, true);

    expect(
      screen.getByText(/Flash erased! Disconnect your drone and fly the filter test flight/)
    ).toBeInTheDocument();
  });

  it('shows erased state for filter_verification_pending via eraseCompleted (SD card)', () => {
    renderBanner(
      { ...baseSession, phase: TUNING_PHASE.FILTER_VERIFICATION_PENDING, eraseCompleted: true },
      false,
      {
        storageType: 'sdcard',
        flashUsedSize: 32000,
      }
    );

    expect(screen.getByText(/Logs erased! Disconnect and fly throttle sweeps/)).toBeInTheDocument();
    expect(screen.getByText('View Flight Guide')).toBeInTheDocument();
  });

  it('shows Filter Tune badge for filter sessions', () => {
    renderBanner({ ...baseSession, tuningType: 'filter' });

    const badge = document.querySelector('.tuning-type-badge');
    expect(badge?.textContent).toBe('Filter Tune');
  });

  it('shows Flash Tune badge for quick sessions', () => {
    renderBanner({
      ...baseSession,
      tuningType: 'quick',
      phase: TUNING_PHASE.QUICK_FLIGHT_PENDING,
    });

    expect(screen.getByText('Flash Tune')).toBeInTheDocument();
  });

  it('shows Filter Tune badge by default when tuningType is undefined', () => {
    renderBanner({ ...baseSession, tuningType: undefined });

    const badge = document.querySelector('.tuning-type-badge');
    expect(badge?.textContent).toBe('Filter Tune');
  });

  it('shows PID Tune badge for pid sessions', () => {
    renderBanner({
      ...baseSession,
      tuningType: TUNING_TYPE.PID,
      phase: TUNING_PHASE.PID_FLIGHT_PENDING,
    });

    const badge = document.querySelector('.tuning-type-badge');
    expect(badge?.textContent).toBe('PID Tune');
  });

  it('passes flash_verification guide mode for Flash Tune verification', async () => {
    const user = userEvent.setup();
    renderBanner(
      {
        ...baseSession,
        tuningType: 'quick',
        phase: TUNING_PHASE.VERIFICATION_PENDING,
        eraseCompleted: true,
      },
      false,
      { flashUsedSize: 0 }
    );

    await user.click(screen.getByText('View Flight Guide'));
    expect(onViewGuide).toHaveBeenCalledWith('flash_verification');
  });

  it('passes filter_verification guide mode for Filter Tune verification', async () => {
    const user = userEvent.setup();
    renderBanner(
      {
        ...baseSession,
        tuningType: TUNING_TYPE.FILTER,
        phase: TUNING_PHASE.FILTER_VERIFICATION_PENDING,
        eraseCompleted: true,
      },
      false,
      { flashUsedSize: 0 }
    );

    await user.click(screen.getByText('View Flight Guide'));
    expect(onViewGuide).toHaveBeenCalledWith('filter_verification');
  });

  it('passes pid_verification guide mode for PID Tune verification', async () => {
    const user = userEvent.setup();
    renderBanner(
      {
        ...baseSession,
        tuningType: TUNING_TYPE.PID,
        phase: TUNING_PHASE.PID_VERIFICATION_PENDING,
        eraseCompleted: true,
      },
      false,
      { flashUsedSize: 0 }
    );

    await user.click(screen.getByText('View Flight Guide'));
    expect(onViewGuide).toHaveBeenCalledWith('pid_verification');
  });
});
