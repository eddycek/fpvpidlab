import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import React from 'react';
import userEvent from '@testing-library/user-event';

// Unmock useToast for these tests - we need the real implementation
vi.unmock('../../hooks/useToast');

import { ToastProvider } from '../../contexts/ToastContext';
import { ToastContainer } from './ToastContainer';
import { useToast } from '../../hooks/useToast';

// Test component that uses useToast
function TestComponent({ onMount }: { onMount: (helpers: ReturnType<typeof useToast>) => void }) {
  const toast = useToast();

  React.useEffect(() => {
    onMount(toast);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

describe('ToastContainer', () => {
  beforeEach(() => {
    // Clear any existing portal containers
    document.body.innerHTML = '';
  });

  it('renders using createPortal to document.body', () => {
    render(
      <ToastProvider>
        <ToastContainer />
      </ToastProvider>
    );

    // Container should be in document.body, not in the React tree
    const container = document.body.querySelector('.toast-container');
    expect(container).toBeInTheDocument();
  });

  it('renders no toasts initially', () => {
    render(
      <ToastProvider>
        <ToastContainer />
      </ToastProvider>
    );

    const container = document.body.querySelector('.toast-container');
    expect(container?.children).toHaveLength(0);
  });

  it('renders multiple toasts', () => {
    let toastHelpers: ReturnType<typeof useToast>;

    render(
      <ToastProvider>
        <TestComponent
          onMount={(helpers) => {
            toastHelpers = helpers;
          }}
        />
        <ToastContainer />
      </ToastProvider>
    );

    act(() => {
      toastHelpers.success('Toast 1');
      toastHelpers.error('Toast 2');
      toastHelpers.info('Toast 3');
    });

    expect(screen.getByText('Toast 1')).toBeInTheDocument();
    expect(screen.getByText('Toast 2')).toBeInTheDocument();
    expect(screen.getByText('Toast 3')).toBeInTheDocument();
  });

  it('removes toast when dismissed', async () => {
    const user = userEvent.setup();
    let toastHelpers: ReturnType<typeof useToast>;

    render(
      <ToastProvider>
        <TestComponent
          onMount={(helpers) => {
            toastHelpers = helpers;
          }}
        />
        <ToastContainer />
      </ToastProvider>
    );

    act(() => {
      toastHelpers.success('Dismissible toast');
    });

    expect(screen.getByText('Dismissible toast')).toBeInTheDocument();

    const dismissButton = screen.getByRole('button', { name: /dismiss notification/i });
    await user.click(dismissButton);

    expect(screen.queryByText('Dismissible toast')).not.toBeInTheDocument();
  });

  it('renders toasts in correct order (newest at bottom)', () => {
    let toastHelpers: ReturnType<typeof useToast>;

    render(
      <ToastProvider>
        <TestComponent
          onMount={(helpers) => {
            toastHelpers = helpers;
          }}
        />
        <ToastContainer />
      </ToastProvider>
    );

    act(() => {
      toastHelpers.info('First');
      toastHelpers.info('Second');
      toastHelpers.info('Third');
    });

    const container = document.body.querySelector('.toast-container');
    const toasts = container?.querySelectorAll('.toast');

    expect(toasts).toHaveLength(3);
    // flex-direction: column-reverse means newest appears last in DOM but visually on bottom
    expect(toasts![0].textContent).toContain('First');
    expect(toasts![1].textContent).toContain('Second');
    expect(toasts![2].textContent).toContain('Third');
  });

  it('throws error when used outside ToastProvider', () => {
    // Suppress console.error for this test
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<ToastContainer />);
    }).toThrow('ToastContainer must be used within ToastProvider');

    spy.mockRestore();
  });
});
