import React, { useEffect, useState } from 'react';
import type { BlackboxLogMetadata } from '@shared/types/blackbox.types';
import './LogPickerModal.css';

interface LogPickerModalProps {
  onSelect: (logId: string) => void;
  onCancel: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LogPickerModal({ onSelect, onCancel }: LogPickerModalProps) {
  const [logs, setLogs] = useState<BlackboxLogMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.betaflight
      .listBlackboxLogs()
      .then((list) => {
        if (!cancelled) {
          // Newest first
          setLogs([...list].sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load logs');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="log-picker-overlay" role="dialog" aria-label="Select existing log">
      <div className="log-picker-modal">
        <h2>Use Existing Log</h2>
        <p className="log-picker-subtitle">
          Select a previously downloaded Blackbox log to use for this phase.
        </p>

        {loading ? (
          <p style={{ color: 'var(--text-secondary, #aaa)', fontSize: 13 }}>Loading logs...</p>
        ) : error ? (
          <p role="alert" style={{ color: 'var(--error-color, #e44)', fontSize: 13 }}>
            {error}
          </p>
        ) : logs.length === 0 ? (
          <p style={{ color: 'var(--text-secondary, #aaa)', fontSize: 13 }}>
            No downloaded logs available.
          </p>
        ) : (
          <div className="log-picker-list">
            {logs.map((log) => (
              <button key={log.id} className="log-picker-item" onClick={() => onSelect(log.id)}>
                <div className="log-picker-item-info">
                  <span className="log-picker-item-name">{log.filename}</span>
                  <span className="log-picker-item-meta">
                    {formatDate(log.timestamp)} &middot; {formatSize(log.size)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        <button className="log-picker-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
