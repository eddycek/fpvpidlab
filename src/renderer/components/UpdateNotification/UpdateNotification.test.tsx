import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdateNotification } from './UpdateNotification';

describe('UpdateNotification', () => {
  beforeEach(() => {
    vi.mocked(window.betaflight.onUpdateAvailable).mockReturnValue(() => {});
    vi.mocked(window.betaflight.onUpdateDownloaded).mockReturnValue(() => {});
  });

  it('renders nothing when no update', () => {
    const { container } = render(<UpdateNotification />);
    expect(container.firstChild).toBeNull();
  });

  it('subscribes to update events on mount', () => {
    render(<UpdateNotification />);
    expect(window.betaflight.onUpdateAvailable).toHaveBeenCalled();
    expect(window.betaflight.onUpdateDownloaded).toHaveBeenCalled();
  });

  it('shows notification when update is downloaded', async () => {
    vi.mocked(window.betaflight.onUpdateDownloaded).mockImplementation((cb) => {
      setTimeout(() => cb({ version: '0.3.0' }), 0);
      return () => {};
    });

    render(<UpdateNotification />);

    await waitFor(() => {
      expect(screen.getByText(/0\.3\.0/)).toBeInTheDocument();
    });
    expect(screen.getByText('Restart')).toBeInTheDocument();
  });

  it('calls installUpdate on Restart click', async () => {
    vi.mocked(window.betaflight.onUpdateDownloaded).mockImplementation((cb) => {
      setTimeout(() => cb({ version: '0.3.0' }), 0);
      return () => {};
    });
    vi.mocked(window.betaflight.installUpdate).mockResolvedValue(undefined);

    render(<UpdateNotification />);

    const restartBtn = await screen.findByText('Restart');
    await userEvent.click(restartBtn);
    expect(window.betaflight.installUpdate).toHaveBeenCalled();
  });

  it('dismisses notification on X click', async () => {
    vi.mocked(window.betaflight.onUpdateDownloaded).mockImplementation((cb) => {
      setTimeout(() => cb({ version: '0.3.0' }), 0);
      return () => {};
    });

    render(<UpdateNotification />);

    await waitFor(() => {
      expect(screen.getByText(/0\.3\.0/)).toBeInTheDocument();
    });

    const dismissBtn = screen.getByTitle('Dismiss (will install on next quit)');
    await userEvent.click(dismissBtn);

    expect(screen.queryByText(/0\.3\.0/)).not.toBeInTheDocument();
  });

  it('shows "What\'s new" link when releaseNotes present', async () => {
    vi.mocked(window.betaflight.onUpdateDownloaded).mockImplementation((cb) => {
      setTimeout(() => cb({ version: '0.3.0', releaseNotes: '<p>Bug fixes</p>' }), 0);
      return () => {};
    });

    render(<UpdateNotification />);

    await waitFor(() => {
      expect(screen.getByText("What's new")).toBeInTheDocument();
    });
  });

  it('does not show "What\'s new" without releaseNotes', async () => {
    vi.mocked(window.betaflight.onUpdateDownloaded).mockImplementation((cb) => {
      setTimeout(() => cb({ version: '0.3.0' }), 0);
      return () => {};
    });

    render(<UpdateNotification />);

    await waitFor(() => {
      expect(screen.getByText('Restart')).toBeInTheDocument();
    });

    expect(screen.queryByText("What's new")).not.toBeInTheDocument();
  });

  it('opens changelog modal on "What\'s new" click', async () => {
    vi.mocked(window.betaflight.onUpdateDownloaded).mockImplementation((cb) => {
      setTimeout(() => cb({ version: '0.3.0', releaseNotes: '<p>New features</p>' }), 0);
      return () => {};
    });

    render(<UpdateNotification />);

    const whatsNew = await screen.findByText("What's new");
    await userEvent.click(whatsNew);

    expect(screen.getByText("What's new in v0.3.0")).toBeInTheDocument();
    expect(screen.getByText('Restart to update')).toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
  });

  it('closes changelog modal on Close click', async () => {
    vi.mocked(window.betaflight.onUpdateDownloaded).mockImplementation((cb) => {
      setTimeout(() => cb({ version: '0.3.0', releaseNotes: '<p>Fixes</p>' }), 0);
      return () => {};
    });

    render(<UpdateNotification />);

    const whatsNew = await screen.findByText("What's new");
    await userEvent.click(whatsNew);

    expect(screen.getByText("What's new in v0.3.0")).toBeInTheDocument();

    await userEvent.click(screen.getByText('Close'));

    expect(screen.queryByText("What's new in v0.3.0")).not.toBeInTheDocument();
    // Main notification should still be visible
    expect(screen.getByText(/0\.3\.0/)).toBeInTheDocument();
  });

  it('installs update from changelog modal', async () => {
    vi.mocked(window.betaflight.onUpdateDownloaded).mockImplementation((cb) => {
      setTimeout(() => cb({ version: '0.3.0', releaseNotes: '<p>Fixes</p>' }), 0);
      return () => {};
    });
    vi.mocked(window.betaflight.installUpdate).mockResolvedValue(undefined);

    render(<UpdateNotification />);

    const whatsNew = await screen.findByText("What's new");
    await userEvent.click(whatsNew);
    await userEvent.click(screen.getByText('Restart to update'));

    expect(window.betaflight.installUpdate).toHaveBeenCalled();
  });
});
