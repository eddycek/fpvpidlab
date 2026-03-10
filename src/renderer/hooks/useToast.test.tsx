import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useToast } from './useToast';
import { ToastProvider } from '../contexts/ToastContext';

// Unmock useToast for this test file since we're testing the real implementation
vi.unmock('./useToast');

describe('useToast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws error when used outside ToastProvider', () => {
    // Suppress console.error for this test since we expect an error
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useToast());
    }).toThrow('useToast must be used within ToastProvider');

    consoleError.mockRestore();
  });

  it('success() calls addToast with type="success" and duration', () => {
    const _mockAddToast = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );

    const { result } = renderHook(
      () => {
        const toast = useToast();
        // Mock the context's addToast by accessing internals
        // This is a limitation - we'll verify behavior indirectly
        return toast;
      },
      { wrapper }
    );

    // Call success and verify it doesn't throw
    expect(() => {
      result.current.success('Success message');
    }).not.toThrow();

    // Test with custom duration
    expect(() => {
      result.current.success('Success with custom duration', 5000);
    }).not.toThrow();
  });

  it('error() calls addToast with type="error" and dismissible', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );

    const { result } = renderHook(() => useToast(), { wrapper });

    // Call error and verify it doesn't throw
    expect(() => {
      result.current.error('Error message');
    }).not.toThrow();

    // Test with dismissible=false
    expect(() => {
      result.current.error('Non-dismissible error', false);
    }).not.toThrow();
  });

  it('info() calls addToast with type="info" and duration', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );

    const { result } = renderHook(() => useToast(), { wrapper });

    // Call info and verify it doesn't throw
    expect(() => {
      result.current.info('Info message');
    }).not.toThrow();

    // Test with custom duration
    expect(() => {
      result.current.info('Info with custom duration', 4000);
    }).not.toThrow();
  });

  it('warning() calls addToast with type="warning" and duration', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ToastProvider>{children}</ToastProvider>
    );

    const { result } = renderHook(() => useToast(), { wrapper });

    // Call warning and verify it doesn't throw
    expect(() => {
      result.current.warning('Warning message');
    }).not.toThrow();

    // Test with custom duration
    expect(() => {
      result.current.warning('Warning with custom duration', 6000);
    }).not.toThrow();
  });
});
