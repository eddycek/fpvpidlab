import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlackboxStatus, _resetPersistedLogsPage } from './BlackboxStatus';
import { _resetDemoModeCache } from '../../hooks/useDemoMode';
import type { BlackboxInfo } from '@shared/types/blackbox.types';

function makeMockLog(index: number) {
  const ts = new Date(2026, 1, 9, 12, 0, 0);
  ts.setMinutes(index); // Each log 1 min apart for stable sort order
  return {
    id: `log-${index}`,
    profileId: 'profile-1',
    fcSerial: 'SERIAL123',
    filename: `blackbox_${index}.bbl`,
    filepath: `/tmp/blackbox_${index}.bbl`,
    timestamp: ts.toISOString(),
    size: 1024 * 1024,
    fcInfo: { variant: 'BTFL', version: '4.5.0', target: 'STM32F405' },
  };
}

describe('BlackboxStatus', () => {
  const mockBlackboxInfoSupported: BlackboxInfo = {
    supported: true,
    storageType: 'flash',
    totalSize: 16 * 1024 * 1024, // 16 MB
    usedSize: 8 * 1024 * 1024, // 8 MB
    hasLogs: true,
    freeSize: 8 * 1024 * 1024, // 8 MB
    usagePercent: 50,
  };

  const mockBlackboxInfoEmpty: BlackboxInfo = {
    supported: true,
    storageType: 'flash',
    totalSize: 16 * 1024 * 1024,
    usedSize: 0,
    hasLogs: false,
    freeSize: 16 * 1024 * 1024,
    usagePercent: 0,
  };

  const mockBlackboxInfoNotSupported: BlackboxInfo = {
    supported: false,
    storageType: 'none',
    totalSize: 0,
    usedSize: 0,
    hasLogs: false,
    freeSize: 0,
    usagePercent: 0,
  };

  const mockSDCardInfo: BlackboxInfo = {
    supported: true,
    storageType: 'sdcard',
    totalSize: 32 * 1024 * 1024 * 1024, // 32 GB
    usedSize: 28 * 1024 * 1024 * 1024, // 28 GB
    hasLogs: true,
    freeSize: 4 * 1024 * 1024 * 1024, // 4 GB
    usagePercent: 87,
  };

  const mockSDCardNotReady: BlackboxInfo = {
    supported: true,
    storageType: 'sdcard',
    totalSize: 0,
    usedSize: 0,
    hasLogs: false,
    freeSize: 0,
    usagePercent: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    _resetPersistedLogsPage();
    _resetDemoModeCache();
    vi.mocked(window.betaflight.isDemoMode).mockResolvedValue(false);
  });

  it('renders loading state initially', () => {
    vi.mocked(window.betaflight.getBlackboxInfo).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<BlackboxStatus />);

    expect(screen.getByText('Blackbox Storage')).toBeInTheDocument();
    expect(screen.getByText('Loading Blackbox info...')).toBeInTheDocument();
  });

  it('displays Blackbox info when supported and has logs', async () => {
    vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);

    render(<BlackboxStatus />);

    await waitFor(() => {
      expect(screen.getByText('Blackbox Storage')).toBeInTheDocument();
    });

    // Check storage stats
    expect(screen.getByText('16.00 MB')).toBeInTheDocument(); // Total (unique)
    const usedAndFree = screen.getAllByText('8.00 MB'); // Used and Free (same value)
    expect(usedAndFree).toHaveLength(2);
    expect(screen.getByText('50%')).toBeInTheDocument(); // Usage

    // Check logs available message
    expect(screen.getByText('Logs available for download')).toBeInTheDocument();
  });

  it('displays no logs message when storage is empty', async () => {
    vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoEmpty);

    render(<BlackboxStatus />);

    await waitFor(() => {
      expect(screen.getByText('No logs recorded yet')).toBeInTheDocument();
    });
  });

  it('displays not supported message when Blackbox not available', async () => {
    vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoNotSupported);

    render(<BlackboxStatus />);

    await waitFor(() => {
      expect(screen.getByText(/Blackbox not supported/i)).toBeInTheDocument();
    });
  });

  it('displays error message on fetch failure', async () => {
    vi.mocked(window.betaflight.getBlackboxInfo).mockRejectedValue(
      new Error('Failed to get Blackbox info')
    );

    render(<BlackboxStatus />);

    await waitFor(() => {
      expect(screen.getByText('Failed to get Blackbox info')).toBeInTheDocument();
    });
  });

  it('formats bytes correctly', async () => {
    const largeStorageInfo: BlackboxInfo = {
      supported: true,
      storageType: 'flash',
      totalSize: 128 * 1024 * 1024, // 128 MB
      usedSize: 64 * 1024 * 1024, // 64 MB
      hasLogs: true,
      freeSize: 64 * 1024 * 1024,
      usagePercent: 50,
    };

    vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(largeStorageInfo);

    render(<BlackboxStatus />);

    await waitFor(() => {
      expect(screen.getByText('128.00 MB')).toBeInTheDocument();
      const usedAndFree = screen.getAllByText('64.00 MB'); // Used and Free (same value)
      expect(usedAndFree).toHaveLength(2);
    });
  });

  it('shows correct usage indicator color for low usage', async () => {
    const lowUsageInfo: BlackboxInfo = {
      ...mockBlackboxInfoSupported,
      usedSize: 4 * 1024 * 1024, // 4 MB
      freeSize: 12 * 1024 * 1024, // 12 MB
      usagePercent: 25,
    };

    vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(lowUsageInfo);

    render(<BlackboxStatus />);

    await waitFor(() => {
      const indicator = document.querySelector('.usage-indicator.low');
      expect(indicator).toBeInTheDocument();
    });
  });

  it('shows correct usage indicator color for high usage', async () => {
    const highUsageInfo: BlackboxInfo = {
      ...mockBlackboxInfoSupported,
      usedSize: 14 * 1024 * 1024, // 14 MB
      freeSize: 2 * 1024 * 1024, // 2 MB
      usagePercent: 87,
    };

    vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(highUsageInfo);

    render(<BlackboxStatus />);

    await waitFor(() => {
      const indicator = document.querySelector('.usage-indicator.high');
      expect(indicator).toBeInTheDocument();
    });
  });

  it('calls getBlackboxInfo on mount', async () => {
    vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);

    render(<BlackboxStatus />);

    await waitFor(() => {
      expect(window.betaflight.getBlackboxInfo).toHaveBeenCalledTimes(1);
    });
  });

  describe('SD card storage', () => {
    it('shows SD Card label in header when storageType is sdcard', async () => {
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockSDCardInfo);

      render(<BlackboxStatus />);

      await waitFor(() => {
        expect(screen.getByText(/SD Card/)).toBeInTheDocument();
      });
    });

    it('shows storage stats for SD card', async () => {
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockSDCardInfo);

      render(<BlackboxStatus />);

      await waitFor(() => {
        expect(screen.getByText('32.00 GB')).toBeInTheDocument(); // Total
        expect(screen.getByText('87%')).toBeInTheDocument(); // Usage
      });
    });

    it('shows SD card not ready message when state is not ready', async () => {
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockSDCardNotReady);

      render(<BlackboxStatus />);

      await waitFor(() => {
        expect(screen.getByText('SD card not ready')).toBeInTheDocument();
      });
    });

    it('shows Erase Logs instead of Erase Flash for SD card', async () => {
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockSDCardInfo);

      render(<BlackboxStatus />);

      await waitFor(() => {
        expect(screen.getByText('Erase Logs')).toBeInTheDocument();
      });

      expect(screen.queryByText('Erase Flash')).not.toBeInTheDocument();
    });

    it('hides Test Read button for SD card', async () => {
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockSDCardInfo);

      render(<BlackboxStatus />);

      await waitFor(() => {
        expect(screen.getByText('Download Logs')).toBeInTheDocument();
      });

      expect(screen.queryByText('Test Read (Debug)')).not.toBeInTheDocument();
    });

    it('shows Download Logs button for SD card', async () => {
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockSDCardInfo);

      render(<BlackboxStatus />);

      await waitFor(() => {
        expect(screen.getByText('Download Logs')).toBeInTheDocument();
      });
    });
  });

  describe('readonly mode', () => {
    const mockLog = {
      id: 'log-1',
      profileId: 'profile-1',
      fcSerial: 'SERIAL123',
      filename: 'blackbox_2026-02-09.bbl',
      filepath: '/tmp/blackbox_2026-02-09.bbl',
      timestamp: '2026-02-09T12:00:00Z',
      size: 6 * 1024 * 1024,
      fcInfo: { variant: 'BTFL', version: '4.5.0', target: 'STM32F405' },
    };

    it('hides Download, Erase, and Test Read buttons when readonly', async () => {
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);

      render(<BlackboxStatus readonly />);

      await waitFor(() => {
        expect(screen.getByText('Logs available for download')).toBeInTheDocument();
      });

      expect(screen.queryByText('Download Logs')).not.toBeInTheDocument();
      expect(screen.queryByText('Erase Flash')).not.toBeInTheDocument();
      expect(screen.queryByText('Test Read (Debug)')).not.toBeInTheDocument();
    });

    it('shows Download, Erase, and Test Read buttons when not readonly', async () => {
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);

      render(<BlackboxStatus />);

      await waitFor(() => {
        expect(screen.getByText('Download Logs')).toBeInTheDocument();
      });

      expect(screen.getByText('Erase Flash')).toBeInTheDocument();
      expect(screen.getByText('Test Read (Debug)')).toBeInTheDocument();
    });

    it('still shows storage stats in readonly mode', async () => {
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);

      render(<BlackboxStatus readonly />);

      await waitFor(() => {
        expect(screen.getByText('16.00 MB')).toBeInTheDocument();
      });

      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('hides Analyze button on logs when readonly', async () => {
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);
      vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue([mockLog]);
      const onAnalyze = vi.fn();

      render(<BlackboxStatus onAnalyze={onAnalyze} readonly />);

      await waitFor(() => {
        expect(screen.getByText('blackbox_2026-02-09.bbl')).toBeInTheDocument();
      });

      expect(screen.queryByText('Analyze')).not.toBeInTheDocument();
    });

    it('shows Analyze button on logs when not readonly', async () => {
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);
      vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue([mockLog]);
      const onAnalyze = vi.fn();

      render(<BlackboxStatus onAnalyze={onAnalyze} />);

      await waitFor(() => {
        expect(screen.getByText('blackbox_2026-02-09.bbl')).toBeInTheDocument();
      });

      expect(screen.getByText('Analyze')).toBeInTheDocument();
    });

    it('calls onAnalyze with log id and filename', async () => {
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);
      vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue([mockLog]);
      const onAnalyze = vi.fn();
      const user = userEvent.setup();

      render(<BlackboxStatus onAnalyze={onAnalyze} />);

      await waitFor(() => {
        expect(screen.getByText('blackbox_2026-02-09.bbl')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Analyze'));

      expect(onAnalyze).toHaveBeenCalledWith('log-1', 'blackbox_2026-02-09.bbl');
    });
  });

  describe('refreshKey', () => {
    it('re-fetches blackbox info when refreshKey changes', async () => {
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);

      const { rerender } = render(<BlackboxStatus refreshKey={0} />);

      await waitFor(() => {
        expect(screen.getByText('50%')).toBeInTheDocument();
      });

      expect(window.betaflight.getBlackboxInfo).toHaveBeenCalledTimes(1);

      // After erase, parent increments refreshKey
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoEmpty);
      rerender(<BlackboxStatus refreshKey={1} />);

      await waitFor(() => {
        expect(screen.getByText('No logs recorded yet')).toBeInTheDocument();
      });

      expect(window.betaflight.getBlackboxInfo).toHaveBeenCalledTimes(2);
    });

    it('does not re-fetch when refreshKey stays the same', async () => {
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);

      const { rerender } = render(<BlackboxStatus refreshKey={0} />);

      await waitFor(() => {
        expect(screen.getByText('50%')).toBeInTheDocument();
      });

      rerender(<BlackboxStatus refreshKey={0} />);

      expect(window.betaflight.getBlackboxInfo).toHaveBeenCalledTimes(1);
    });
  });

  describe('log numbering and pagination', () => {
    it('displays #N numbering for logs (newest = highest)', async () => {
      const logs = [makeMockLog(1), makeMockLog(2), makeMockLog(3)];
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);
      vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue(logs);

      render(<BlackboxStatus />);

      await waitFor(() => {
        const numbers = document.querySelectorAll('.log-number');
        expect(numbers).toHaveLength(3);
        // Sorted newest-first: log-3 (#3), log-2 (#2), log-1 (#1)
        expect(numbers[0].textContent).toBe('#3');
        expect(numbers[1].textContent).toBe('#2');
        expect(numbers[2].textContent).toBe('#1');
      });
    });

    it('does not show pagination controls for fewer than 20 logs', async () => {
      const logs = Array.from({ length: 5 }, (_, i) => makeMockLog(i + 1));
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);
      vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue(logs);

      render(<BlackboxStatus />);

      await waitFor(() => {
        expect(document.querySelectorAll('.log-number')).toHaveLength(5);
      });

      expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument();
    });

    it('shows pagination controls and 20 items per page for > 20 logs', async () => {
      const logs = Array.from({ length: 25 }, (_, i) => makeMockLog(i + 1));
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);
      vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue(logs);

      render(<BlackboxStatus />);

      await waitFor(() => {
        expect(document.querySelectorAll('.log-number')).toHaveLength(20);
      });

      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    });

    it('navigates to page 2 with correct numbering', async () => {
      const logs = Array.from({ length: 25 }, (_, i) => makeMockLog(i + 1));
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);
      vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue(logs);
      const user = userEvent.setup();

      render(<BlackboxStatus />);

      await waitFor(() => {
        expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
      });

      // Page 2: items 21-25 sorted newest-first → #5, #4, #3, #2, #1
      const numbers = document.querySelectorAll('.log-number');
      expect(numbers).toHaveLength(5);
      expect(numbers[0].textContent).toBe('#5');
      expect(numbers[1].textContent).toBe('#4');
      expect(numbers[2].textContent).toBe('#3');
      expect(numbers[3].textContent).toBe('#2');
      expect(numbers[4].textContent).toBe('#1');
    });

    it('disables Prev on first page and Next on last page', async () => {
      const logs = Array.from({ length: 25 }, (_, i) => makeMockLog(i + 1));
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);
      vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue(logs);
      const user = userEvent.setup();

      render(<BlackboxStatus />);

      await waitFor(() => {
        expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();

      await user.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: 'Prev' })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    });

    it('persists page across unmount/remount via module-level variable', async () => {
      const logs = Array.from({ length: 25 }, (_, i) => makeMockLog(i + 1));
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);
      vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue(logs);
      const user = userEvent.setup();

      const { unmount } = render(<BlackboxStatus />);

      await waitFor(() => {
        expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
      });

      unmount();

      // Re-render — should start on page 2
      render(<BlackboxStatus />);

      await waitFor(() => {
        expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
      });
    });

    it('clamps page when log count decreases', async () => {
      const logs = Array.from({ length: 25 }, (_, i) => makeMockLog(i + 1));
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);
      vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue(logs);
      const user = userEvent.setup();

      const { unmount } = render(<BlackboxStatus />);

      await waitFor(() => {
        expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
      });

      unmount();

      // Now fewer logs — page 2 no longer exists
      const fewerLogs = Array.from({ length: 10 }, (_, i) => makeMockLog(i + 1));
      vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue(fewerLogs);

      render(<BlackboxStatus />);

      // Should clamp to page 1 (only 10 logs = 1 page)
      await waitFor(() => {
        const numbers = document.querySelectorAll('.log-number');
        expect(numbers).toHaveLength(10);
      });

      expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument();
    });
  });

  describe('demo mode', () => {
    it('disables Test Read button in demo mode', async () => {
      _resetDemoModeCache();
      vi.mocked(window.betaflight.isDemoMode).mockResolvedValue(true);
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);

      render(<BlackboxStatus />);

      await waitFor(() => {
        expect(screen.getByText('Test Read (Debug)')).toBeInTheDocument();
      });

      const testReadBtn = screen.getByText('Test Read (Debug)').closest('button')!;
      expect(testReadBtn).toBeDisabled();
      expect(testReadBtn.title).toBe('Not available in demo mode');
    });
  });

  describe('Huffman compression detection', () => {
    it('shows compression badge and warning for compressed logs', async () => {
      const compressedLog = {
        ...makeMockLog(1),
        compressionDetected: true,
      };
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);
      vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue([compressedLog]);

      render(<BlackboxStatus onAnalyze={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Huffman')).toBeInTheDocument();
      });

      expect(screen.getByText(/Huffman compressed/)).toBeInTheDocument();
    });

    it('disables Analyze button for compressed logs', async () => {
      const compressedLog = {
        ...makeMockLog(1),
        compressionDetected: true,
      };
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);
      vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue([compressedLog]);

      render(<BlackboxStatus onAnalyze={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Analyze')).toBeInTheDocument();
      });

      const analyzeBtn = screen.getByText('Analyze').closest('button')!;
      expect(analyzeBtn).toBeDisabled();
      expect(analyzeBtn.title).toContain('Huffman');
    });

    it('does not show compression warning for normal logs', async () => {
      vi.mocked(window.betaflight.getBlackboxInfo).mockResolvedValue(mockBlackboxInfoSupported);
      vi.mocked(window.betaflight.listBlackboxLogs).mockResolvedValue([makeMockLog(1)]);

      render(<BlackboxStatus onAnalyze={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByText('Analyze')).toBeInTheDocument();
      });

      expect(screen.queryByText('Huffman')).not.toBeInTheDocument();
      const analyzeBtn = screen.getByText('Analyze').closest('button')!;
      expect(analyzeBtn).not.toBeDisabled();
    });
  });
});
