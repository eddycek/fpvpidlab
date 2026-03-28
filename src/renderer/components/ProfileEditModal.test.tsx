import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileEditModal } from './ProfileEditModal';
import type { DroneProfile } from '@shared/types/profile.types';

describe('ProfileEditModal', () => {
  const mockProfile: DroneProfile = {
    id: 'profile-1',
    name: '5" Freestyle',
    fcSerialNumber: 'ABC123',
    size: '5"',
    battery: '6S',
    weight: 650,
    flightStyle: 'balanced',
    motorKV: 1950,
    propSize: '5.1"',
    notes: 'My racing quad',
    snapshotIds: [],
    connectionCount: 10,
    lastConnected: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fcInfo: {
      variant: 'BTFL',
      version: '4.4.0',
      target: 'STM32F405',
      boardName: 'MATEKF405',
      apiVersion: { protocol: 0, major: 1, minor: 46 },
    },
  };

  const mockOnSave = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSave.mockResolvedValue(undefined);
  });

  it('renders modal with title', () => {
    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    expect(screen.getByText('Edit Profile')).toBeInTheDocument();
    expect(screen.getByText(/Update drone configuration for MATEKF405/i)).toBeInTheDocument();
  });

  it('displays all form fields with current values', () => {
    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    expect(screen.getByDisplayValue('5" Freestyle')).toBeInTheDocument();
    expect(screen.getByDisplayValue('5"')).toBeInTheDocument();
    expect(screen.getByDisplayValue('5.1"')).toBeInTheDocument();
    expect(screen.getByDisplayValue('6S')).toBeInTheDocument();
    expect(screen.getByDisplayValue('650')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1950')).toBeInTheDocument();
    expect(screen.getByDisplayValue('My racing quad')).toBeInTheDocument();
  });

  it('shows required field indicators', () => {
    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    const requiredMarkers = screen.getAllByText('*');
    expect(requiredMarkers.length).toBeGreaterThan(0);
  });

  it('allows editing profile name', async () => {
    const user = userEvent.setup();
    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    const nameInput = screen.getByDisplayValue('5" Freestyle');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Name');

    expect(screen.getByDisplayValue('Updated Name')).toBeInTheDocument();
  });

  it('allows changing drone size', async () => {
    const user = userEvent.setup();
    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    const sizeSelect = screen.getByDisplayValue('5"');
    await user.selectOptions(sizeSelect, '7"');

    expect(screen.getByDisplayValue('7"')).toBeInTheDocument();
  });

  it('allows changing battery type', async () => {
    const user = userEvent.setup();
    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    const batterySelect = screen.getByDisplayValue('6S');
    await user.selectOptions(batterySelect, '4S');

    expect(screen.getByDisplayValue('4S')).toBeInTheDocument();
  });

  it('allows changing weight', async () => {
    const user = userEvent.setup();
    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    const weightInput = screen.getByDisplayValue('650');
    await user.clear(weightInput);
    await user.type(weightInput, '700');

    expect(screen.getByDisplayValue('700')).toBeInTheDocument();
  });

  it('allows changing motor KV', async () => {
    const user = userEvent.setup();
    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    const kvInput = screen.getByDisplayValue('1950');
    await user.clear(kvInput);
    await user.type(kvInput, '2650');

    expect(screen.getByDisplayValue('2650')).toBeInTheDocument();
  });

  it('allows editing notes', async () => {
    const user = userEvent.setup();
    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    const notesTextarea = screen.getByDisplayValue('My racing quad');
    await user.clear(notesTextarea);
    await user.type(notesTextarea, 'Updated notes');

    expect(screen.getByDisplayValue('Updated notes')).toBeInTheDocument();
  });

  it('calls onCancel when cancel button clicked', async () => {
    const user = userEvent.setup();
    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onSave with updated values when save button clicked', async () => {
    const user = userEvent.setup();
    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    const nameInput = screen.getByDisplayValue('5" Freestyle');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Name');

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Updated Name',
          size: '5"',
          battery: '6S',
          weight: 650,
          motorKV: 1950,
        })
      );
    });
  });

  it('disables save button when name is empty', async () => {
    const user = userEvent.setup();
    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    const nameInput = screen.getByDisplayValue('5" Freestyle');
    await user.clear(nameInput);

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    expect(saveButton).toBeDisabled();
  });

  it('shows loading state while saving', async () => {
    const user = userEvent.setup();
    mockOnSave.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    expect(screen.getByText('Saving...')).toBeInTheDocument();
    expect(saveButton).toBeDisabled();
  });

  it('disables cancel button while saving', async () => {
    const user = userEvent.setup();
    mockOnSave.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    expect(cancelButton).toBeDisabled();
  });

  it('shows balanced flight style when profile has balanced', () => {
    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    // Balanced should be selected (mockProfile has flightStyle: 'balanced')
    const balancedBtn = screen.getByText('Balanced (default)').closest('.flight-style-option');
    expect(balancedBtn?.classList.contains('selected')).toBe(true);
  });

  it('loads existing flight style from profile', () => {
    const aggressiveProfile: DroneProfile = {
      ...mockProfile,
      flightStyle: 'aggressive',
    };

    render(
      <ProfileEditModal profile={aggressiveProfile} onSave={mockOnSave} onCancel={mockOnCancel} />
    );

    const aggressiveBtn = screen.getByText('Aggressive').closest('.flight-style-option');
    expect(aggressiveBtn?.classList.contains('selected')).toBe(true);
  });

  it('includes flightStyle in save output', async () => {
    const user = userEvent.setup();
    render(<ProfileEditModal profile={mockProfile} onSave={mockOnSave} onCancel={mockOnCancel} />);

    // Change to smooth
    await user.click(screen.getByText('Smooth'));

    // Save
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          flightStyle: 'smooth',
        })
      );
    });
  });

  it('renders correctly for profile without optional fields', () => {
    const minimalProfile: DroneProfile = {
      ...mockProfile,
      propSize: undefined,
      motorKV: undefined,
      notes: undefined,
    };

    render(
      <ProfileEditModal profile={minimalProfile} onSave={mockOnSave} onCancel={mockOnCancel} />
    );

    expect(screen.getByText('Edit Profile')).toBeInTheDocument();
    // Selects for size and battery should still render
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);
  });
});
