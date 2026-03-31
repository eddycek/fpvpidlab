import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LogPickerModal } from './LogPickerModal';
import type { BlackboxLogMetadata } from '@shared/types/blackbox.types';

const mockLogs: BlackboxLogMetadata[] = [
  {
    id: 'log-1',
    profileId: 'prof-1',
    fcSerial: 'SN123',
    timestamp: '2026-03-28T10:00:00Z',
    filename: 'LOG00001.bbl',
    filepath: '/data/LOG00001.bbl',
    size: 1024 * 500,
    fcInfo: { variant: 'BTFL', version: '4.5.0', target: 'STM32F7X2' },
    compressionDetected: false,
  },
  {
    id: 'log-2',
    profileId: 'prof-1',
    fcSerial: 'SN123',
    timestamp: '2026-03-29T14:30:00Z',
    filename: 'LOG00002.bbl',
    filepath: '/data/LOG00002.bbl',
    size: 1024 * 1024 * 2.5,
    fcInfo: { variant: 'BTFL', version: '4.5.0', target: 'STM32F7X2' },
    compressionDetected: false,
  },
] as BlackboxLogMetadata[];

describe('LogPickerModal', () => {
  let onSelect: ReturnType<typeof vi.fn<(logId: string) => void>>;
  let onCancel: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    onSelect = vi.fn<(logId: string) => void>();
    onCancel = vi.fn<() => void>();
    vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue(mockLogs);
  });

  it('renders loading state then log list', async () => {
    render(<LogPickerModal onSelect={onSelect} onCancel={onCancel} />);

    expect(screen.getByText('Loading logs...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('LOG00002.bbl')).toBeInTheDocument();
    });
    expect(screen.getByText('LOG00001.bbl')).toBeInTheDocument();
  });

  it('sorts logs newest first', async () => {
    render(<LogPickerModal onSelect={onSelect} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByText('LOG00002.bbl')).toBeInTheDocument();
    });

    const items = screen.getAllByRole('button', { name: /LOG0000/ });
    expect(items[0]).toHaveTextContent('LOG00002.bbl');
    expect(items[1]).toHaveTextContent('LOG00001.bbl');
  });

  it('calls onSelect when log is clicked', async () => {
    const user = userEvent.setup();
    render(<LogPickerModal onSelect={onSelect} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByText('LOG00001.bbl')).toBeInTheDocument();
    });

    await user.click(screen.getByText('LOG00001.bbl'));
    expect(onSelect).toHaveBeenCalledWith('log-1');
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<LogPickerModal onSelect={onSelect} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByText('LOG00002.bbl')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows empty state when no logs', async () => {
    vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue([]);
    render(<LogPickerModal onSelect={onSelect} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByText('No downloaded logs available.')).toBeInTheDocument();
    });
  });

  it('has correct dialog role and label', async () => {
    render(<LogPickerModal onSelect={onSelect} onCancel={onCancel} />);

    expect(screen.getByRole('dialog', { name: 'Select existing log' })).toBeInTheDocument();
  });

  it('shows error message when listBlackboxLogs fails', async () => {
    vi.mocked(window.betaflight.listBlackboxLogs).mockRejectedValue(new Error('Connection lost'));
    render(<LogPickerModal onSelect={onSelect} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByText('Connection lost')).toBeInTheDocument();
    });
  });
});
