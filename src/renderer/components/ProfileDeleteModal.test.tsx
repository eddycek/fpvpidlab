import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileDeleteModal } from './ProfileDeleteModal';
import type { DroneProfile } from '@shared/types/profile.types';

describe('ProfileDeleteModal', () => {
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
    snapshotIds: ['snapshot-1', 'snapshot-2', 'snapshot-3'],
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

  const mockOnConfirm = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnConfirm.mockResolvedValue(undefined);
  });

  it('renders modal with title and profile name', () => {
    render(
      <ProfileDeleteModal
        profile={mockProfile}
        isActive={false}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByRole('heading', { name: 'Delete Profile' })).toBeInTheDocument();
    expect(screen.getByText('5" Freestyle')).toBeInTheDocument();
  });

  it('displays profile details', () => {
    render(
      <ProfileDeleteModal
        profile={mockProfile}
        isActive={false}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText('Profile Name')).toBeInTheDocument();
    expect(screen.getByText('Size')).toBeInTheDocument();
    expect(screen.getByText('5"')).toBeInTheDocument();
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByText('6S')).toBeInTheDocument();
  });

  it('displays snapshot count', () => {
    render(
      <ProfileDeleteModal
        profile={mockProfile}
        isActive={false}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText('Snapshots')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows warning message', () => {
    render(
      <ProfileDeleteModal
        profile={mockProfile}
        isActive={false}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText(/This action cannot be undone/i)).toBeInTheDocument();
    expect(screen.getByText(/Profile configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/backup files/i)).toBeInTheDocument();
    expect(screen.getByText(/Connection history/i)).toBeInTheDocument();
  });

  it('shows active profile warning when isActive is true', () => {
    render(
      <ProfileDeleteModal
        profile={mockProfile}
        isActive={true}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText(/This is your currently active profile/i)).toBeInTheDocument();
  });

  it('does not show active warning when isActive is false', () => {
    render(
      <ProfileDeleteModal
        profile={mockProfile}
        isActive={false}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.queryByText(/This is your currently active profile/i)).not.toBeInTheDocument();
  });

  it('mentions snapshots in warning when snapshots exist', () => {
    render(
      <ProfileDeleteModal
        profile={mockProfile}
        isActive={false}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText(/3 snapshots and all associated data/i)).toBeInTheDocument();
  });

  it('calls onCancel when cancel button clicked', async () => {
    const user = userEvent.setup();
    render(
      <ProfileDeleteModal
        profile={mockProfile}
        isActive={false}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when delete button clicked', async () => {
    const user = userEvent.setup();
    render(
      <ProfileDeleteModal
        profile={mockProfile}
        isActive={false}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    const deleteButton = screen.getByRole('button', { name: /delete profile/i });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(mockOnConfirm).toHaveBeenCalledTimes(1);
    });
  });

  it('shows loading state while deleting', async () => {
    const user = userEvent.setup();
    mockOnConfirm.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

    render(
      <ProfileDeleteModal
        profile={mockProfile}
        isActive={false}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    const deleteButton = screen.getByRole('button', { name: /delete profile/i });
    await user.click(deleteButton);

    expect(screen.getByText('Deleting...')).toBeInTheDocument();
    expect(deleteButton).toBeDisabled();
  });

  it('disables buttons while deleting', async () => {
    const user = userEvent.setup();
    mockOnConfirm.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

    render(
      <ProfileDeleteModal
        profile={mockProfile}
        isActive={false}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    const deleteButton = screen.getByRole('button', { name: /delete profile/i });
    await user.click(deleteButton);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    expect(cancelButton).toBeDisabled();
    expect(deleteButton).toBeDisabled();
  });

  it('renders correctly for profile with no snapshots', () => {
    const profileWithoutSnapshots = { ...mockProfile, snapshotIds: [] };

    render(
      <ProfileDeleteModal
        profile={profileWithoutSnapshots}
        isActive={false}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText(/snapshots and all associated data/i)).not.toBeInTheDocument();
  });
});
