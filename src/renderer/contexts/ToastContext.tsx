import React, { createContext, useState, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Toast, ToastContextValue } from '@shared/types/toast.types';

export const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 5;

interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const removeToast = useCallback((id: string) => {
    // Clear timer if exists
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }

    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(
    (toast: Omit<Toast, 'id'>): string => {
      const id = uuidv4();
      const newToast: Toast = {
        id,
        ...toast,
        dismissible: toast.dismissible ?? true,
      };

      setToasts((prev) => {
        // Check if duplicate already exists (same type and message)
        const duplicate = prev.find(
          (t) => t.type === newToast.type && t.message === newToast.message
        );

        if (duplicate) {
          // Duplicate exists, don't add new toast
          return prev;
        }

        const updated = [...prev, newToast];
        // FIFO removal if exceeds limit
        if (updated.length > MAX_TOASTS) {
          const removedToast = updated.shift();
          if (removedToast) {
            // Clear timer for removed toast
            const timer = timersRef.current.get(removedToast.id);
            if (timer) {
              clearTimeout(timer);
              timersRef.current.delete(removedToast.id);
            }
          }
        }
        return updated;
      });

      // Setup auto-dismiss timer if duration provided
      if (toast.duration !== undefined) {
        const timer = setTimeout(() => {
          removeToast(id);
        }, toast.duration);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [removeToast]
  );

  const clearToasts = useCallback(() => {
    // Clear all timers
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
    setToasts([]);
  }, []);

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const value: ToastContextValue = {
    toasts,
    addToast,
    removeToast,
    clearToasts,
  };

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}
