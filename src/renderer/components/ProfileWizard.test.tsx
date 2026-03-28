import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileWizard } from './ProfileWizard';
import type { FCInfo } from '@shared/types/common.types';

const mockFCInfo: FCInfo = {
  variant: 'BTFL',
  version: '4.5.0',
  apiVersion: { protocol: 0, major: 1, minor: 46 },
  target: 'STM32F405',
  boardName: 'BETAFPV F405',
};

describe('ProfileWizard flight style', () => {
  const onComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to balanced flight style in custom path', async () => {
    const user = userEvent.setup();
    render(<ProfileWizard fcSerial="ABC123" fcInfo={mockFCInfo} onComplete={onComplete} />);

    // Go to custom path
    await user.click(screen.getByText('Custom Configuration'));

    // Flight style selector should be visible with Balanced selected
    expect(screen.getByText('Balanced (default)')).toBeInTheDocument();
    expect(screen.getByText('Smooth')).toBeInTheDocument();
    expect(screen.getByText('Aggressive')).toBeInTheDocument();

    // Balanced should be selected (has .selected class)
    const balancedBtn = screen.getByText('Balanced (default)').closest('.flight-style-option');
    expect(balancedBtn?.classList.contains('selected')).toBe(true);
  });

  it('includes flightStyle in custom profile output', async () => {
    const user = userEvent.setup();
    render(<ProfileWizard fcSerial="ABC123" fcInfo={mockFCInfo} onComplete={onComplete} />);

    // Custom path
    await user.click(screen.getByText('Custom Configuration'));

    // Fill required name
    await user.type(screen.getByPlaceholderText('e.g., My 5 inch freestyle'), 'Test Drone');

    // Select aggressive style
    await user.click(screen.getByText('Aggressive'));

    // Continue to review
    await user.click(screen.getByText('Continue'));

    // Review should show Flying Style
    expect(screen.getByText('Flying Style')).toBeInTheDocument();
    expect(screen.getByText('Aggressive')).toBeInTheDocument();

    // Create
    await user.click(screen.getByText('Create Profile'));

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Drone',
        flightStyle: 'aggressive',
      })
    );
  });

  it('sets flight style from preset mapping for racing preset', async () => {
    const user = userEvent.setup();
    render(<ProfileWizard fcSerial="ABC123" fcInfo={mockFCInfo} onComplete={onComplete} />);

    // Preset path
    await user.click(screen.getByText('Use a Preset'));

    // Select racing preset
    const racePreset = screen.getByText('5" Race');
    await user.click(racePreset);

    // Continue to review
    await user.click(screen.getByText('Continue'));

    // Review should show Aggressive flight style
    expect(screen.getByText('Aggressive')).toBeInTheDocument();

    // Create
    await user.click(screen.getByText('Create Profile'));

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        presetId: '5inch-race',
        flightStyle: 'aggressive',
      })
    );
  });

  it('sets flight style from preset mapping for whoop preset', async () => {
    const user = userEvent.setup();
    render(<ProfileWizard fcSerial="ABC123" fcInfo={mockFCInfo} onComplete={onComplete} />);

    await user.click(screen.getByText('Use a Preset'));
    const whoopPreset = screen.getByText('3" Whoop');
    await user.click(whoopPreset);
    await user.click(screen.getByText('Continue'));

    expect(screen.getByText('Smooth')).toBeInTheDocument();

    await user.click(screen.getByText('Create Profile'));

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        presetId: '3inch-whoop',
        flightStyle: 'smooth',
      })
    );
  });

  it('defaults to balanced for freestyle preset', async () => {
    const user = userEvent.setup();
    render(<ProfileWizard fcSerial="ABC123" fcInfo={mockFCInfo} onComplete={onComplete} />);

    await user.click(screen.getByText('Use a Preset'));
    const freestylePreset = screen.getByText('5" Freestyle');
    await user.click(freestylePreset);
    await user.click(screen.getByText('Continue'));

    expect(screen.getByText('Balanced')).toBeInTheDocument();

    await user.click(screen.getByText('Create Profile'));

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        presetId: '5inch-freestyle',
        flightStyle: 'balanced',
      })
    );
  });

  it('pre-fills profile name from FC craft name in custom path', async () => {
    const user = userEvent.setup();
    const fcInfoWithCraft: FCInfo = { ...mockFCInfo, craftName: 'My Racer' };
    render(<ProfileWizard fcSerial="ABC123" fcInfo={fcInfoWithCraft} onComplete={onComplete} />);

    await user.click(screen.getByText('Custom Configuration'));

    const nameInput = screen.getByPlaceholderText('e.g., My 5 inch freestyle') as HTMLInputElement;
    expect(nameInput.value).toBe('My Racer');
  });

  it('pre-fills custom name from FC craft name in preset path', async () => {
    const user = userEvent.setup();
    const fcInfoWithCraft: FCInfo = { ...mockFCInfo, craftName: 'My Racer' };
    render(<ProfileWizard fcSerial="ABC123" fcInfo={fcInfoWithCraft} onComplete={onComplete} />);

    await user.click(screen.getByText('Use a Preset'));
    await user.click(screen.getByText('5" Freestyle'));

    const nameInput = screen.getByPlaceholderText(
      'Leave empty to use preset name'
    ) as HTMLInputElement;
    expect(nameInput.value).toBe('My Racer');
  });

  it('leaves name empty when craft name is not set', async () => {
    const user = userEvent.setup();
    render(<ProfileWizard fcSerial="ABC123" fcInfo={mockFCInfo} onComplete={onComplete} />);

    await user.click(screen.getByText('Custom Configuration'));

    const nameInput = screen.getByPlaceholderText('e.g., My 5 inch freestyle') as HTMLInputElement;
    expect(nameInput.value).toBe('');
  });

  it('allows changing flight style in custom path', async () => {
    const user = userEvent.setup();
    render(<ProfileWizard fcSerial="ABC123" fcInfo={mockFCInfo} onComplete={onComplete} />);

    await user.click(screen.getByText('Custom Configuration'));
    await user.type(screen.getByPlaceholderText('e.g., My 5 inch freestyle'), 'My Cinewhoop');

    // Click smooth
    await user.click(screen.getByText('Smooth'));

    // Smooth should now be selected
    const smoothBtn = screen.getByText('Smooth').closest('.flight-style-option');
    expect(smoothBtn?.classList.contains('selected')).toBe(true);

    // Balanced should no longer be selected
    const balancedBtn = screen.getByText('Balanced (default)').closest('.flight-style-option');
    expect(balancedBtn?.classList.contains('selected')).toBe(false);
  });
});
