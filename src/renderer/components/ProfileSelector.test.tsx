import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileSelector } from './ProfileSelector';
import type { DroneProfileMetadata } from '@shared/types/profile.types';

describe('ProfileSelector', () => {
  const mockProfiles: DroneProfileMetadata[] = [
    {
      id: 'profile-1',
      name: '5" Freestyle',
      fcSerialNumber: 'ABC123',
      size: '5"',
      battery: '4S',
      connectionCount: 10,
      lastConnected: new Date('2024-01-01').toISOString(),
    },
    {
      id: 'profile-2',
      name: 'Tiny Whoop',
      fcSerialNumber: 'DEF456',
      size: '1"',
      battery: '1S',
      connectionCount: 5,
      lastConnected: new Date('2024-01-02').toISOString(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(window.betaflight.listProfiles).mockResolvedValue(mockProfiles);
    vi.mocked(window.betaflight.getCurrentProfile).mockResolvedValue({
      ...mockProfiles[0],
      weight: 650,
      flightStyle: 'balanced',
      motorKV: 2400,
      propSize: '5.1"',
      snapshotIds: [],
      createdAt: new Date('2024-01-01').toISOString(),
      updatedAt: new Date('2024-01-01').toISOString(),
      fcInfo: {
        variant: 'BTFL',
        version: '4.4.0',
        target: 'STM32F405',
        boardName: 'MATEKF405',
        apiVersion: { protocol: 0, major: 1, minor: 46 },
      },
    });
    vi.mocked(window.betaflight.getConnectionStatus).mockResolvedValue({ connected: false });
    vi.mocked(window.betaflight.onProfileChanged).mockReturnValue(() => {});
    vi.mocked(window.betaflight.onConnectionChanged).mockReturnValue(() => {});
  });

  it('renders current profile header', async () => {
    render(<ProfileSelector />);

    await waitFor(() => {
      expect(screen.getByText('Current Drone Profile')).toBeInTheDocument();
    });
  });

  it('displays current profile name and details', async () => {
    render(<ProfileSelector />);

    await waitFor(() => {
      expect(screen.getByText('5" Freestyle')).toBeInTheDocument();
      expect(screen.getByText(/5" • 4S/)).toBeInTheDocument();
    });
  });

  it('shows profile count', async () => {
    render(<ProfileSelector />);

    await waitFor(() => {
      expect(screen.getByText('2 profiles')).toBeInTheDocument();
    });
  });

  it('expands to show profile list when clicked', async () => {
    const user = userEvent.setup();
    render(<ProfileSelector />);

    await waitFor(() => {
      expect(screen.getByText('5" Freestyle')).toBeInTheDocument();
    });

    const header = screen.getByText('Current Drone Profile');
    await user.click(header);

    await waitFor(() => {
      expect(screen.getByText('Tiny Whoop')).toBeInTheDocument();
    });
  });

  it('allows switching profiles when disconnected', async () => {
    const user = userEvent.setup();
    vi.mocked(window.betaflight.setCurrentProfile).mockResolvedValue({
      ...mockProfiles[1],
      weight: 25,
      flightStyle: 'balanced',
      motorKV: 19000,
      propSize: '31mm',
      snapshotIds: [],
      createdAt: new Date('2024-01-02').toISOString(),
      updatedAt: new Date('2024-01-02').toISOString(),
      fcInfo: {
        variant: 'BTFL',
        version: '4.4.0',
        target: 'STM32F405',
        boardName: 'MATEKF405',
        apiVersion: { protocol: 0, major: 1, minor: 46 },
      },
    });

    render(<ProfileSelector />);

    await waitFor(() => {
      expect(screen.getByText('5" Freestyle')).toBeInTheDocument();
    });

    const header = screen.getByText('Current Drone Profile');
    await user.click(header);

    await waitFor(() => {
      expect(screen.getByText('Tiny Whoop')).toBeInTheDocument();
    });

    const tinyWhoopCard = screen.getByText('Tiny Whoop').closest('.profile-card');
    if (tinyWhoopCard) {
      await user.click(tinyWhoopCard);

      await waitFor(() => {
        expect(window.betaflight.setCurrentProfile).toHaveBeenCalledWith('profile-2');
      });
    }
  });

  it('shows lock notice when FC is connected', async () => {
    vi.mocked(window.betaflight.getConnectionStatus).mockResolvedValue({
      connected: true,
      portPath: '/dev/ttyUSB0',
    });

    render(<ProfileSelector />);

    await waitFor(() => {
      expect(screen.getByText('5" Freestyle')).toBeInTheDocument();
    });

    const header = screen.getByText('Current Drone Profile');
    const user = userEvent.setup();
    await user.click(header);

    await waitFor(() => {
      expect(screen.getByText('Profile locked while FC is connected')).toBeInTheDocument();
    });
  });

  it('prevents profile switching when FC is connected', async () => {
    const user = userEvent.setup();
    vi.mocked(window.betaflight.getConnectionStatus).mockResolvedValue({
      connected: true,
      portPath: '/dev/ttyUSB0',
    });

    render(<ProfileSelector />);

    await waitFor(() => {
      expect(screen.getByText('5" Freestyle')).toBeInTheDocument();
    });

    const header = screen.getByText('Current Drone Profile');
    await user.click(header);

    await waitFor(() => {
      expect(screen.getByText('Tiny Whoop')).toBeInTheDocument();
    });

    const tinyWhoopCard = screen.getByText('Tiny Whoop').closest('.profile-card');
    if (tinyWhoopCard) {
      await user.click(tinyWhoopCard);

      // Should NOT call setCurrentProfile when connected
      expect(window.betaflight.setCurrentProfile).not.toHaveBeenCalled();
    }
  });

  it('shows active badge on current profile', async () => {
    const user = userEvent.setup();
    render(<ProfileSelector />);

    await waitFor(() => {
      expect(screen.getByText('5" Freestyle')).toBeInTheDocument();
    });

    const header = screen.getByText('Current Drone Profile');
    await user.click(header);

    await waitFor(() => {
      expect(screen.getByText('Active')).toBeInTheDocument();
    });
  });

  it('renders nothing when no profiles exist', () => {
    vi.mocked(window.betaflight.listProfiles).mockResolvedValue([]);
    vi.mocked(window.betaflight.getCurrentProfile).mockResolvedValue(null);

    const { container } = render(<ProfileSelector />);
    expect(container.firstChild).toBeNull();
  });

  it('shows edit button for each profile', async () => {
    const user = userEvent.setup();
    render(<ProfileSelector />);

    await waitFor(() => {
      expect(screen.getByText('5" Freestyle')).toBeInTheDocument();
    });

    const header = screen.getByText('Current Drone Profile');
    await user.click(header);

    await waitFor(() => {
      const editButtons = screen.getAllByTitle('Edit profile');
      expect(editButtons.length).toBeGreaterThan(0);
    });
  });

  it('shows delete button for each profile', async () => {
    const user = userEvent.setup();
    render(<ProfileSelector />);

    await waitFor(() => {
      expect(screen.getByText('5" Freestyle')).toBeInTheDocument();
    });

    const header = screen.getByText('Current Drone Profile');
    await user.click(header);

    await waitFor(() => {
      const deleteButtons = screen.getAllByTitle('Delete profile');
      expect(deleteButtons.length).toBeGreaterThan(0);
    });
  });
});
