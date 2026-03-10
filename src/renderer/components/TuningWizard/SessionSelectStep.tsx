import React, { useEffect } from 'react';
import type { BlackboxLogSession, BlackboxParseProgress } from '@shared/types/blackbox.types';

interface SessionSelectStepProps {
  sessions: BlackboxLogSession[] | null;
  parsing: boolean;
  parseProgress: BlackboxParseProgress | null;
  parseError: string | null;
  parseLog: () => Promise<void>;
  sessionIndex: number;
  onSelectSession: (idx: number) => void;
}

export function SessionSelectStep({
  sessions,
  parsing,
  parseProgress,
  parseError,
  parseLog,
  onSelectSession,
}: SessionSelectStepProps) {
  useEffect(() => {
    if (!sessions && !parsing && !parseError) {
      parseLog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (parsing) {
    return (
      <div className="analysis-section">
        <h3>Parsing Blackbox Log</h3>
        <p>Reading flight data from the log file...</p>
        {parseProgress && (
          <div className="analysis-progress">
            <div className="analysis-progress-label">
              <span>Session {parseProgress.currentSession + 1}</span>
              <span>{parseProgress.percent}%</span>
            </div>
            <div className="analysis-progress-bar">
              <div
                className="analysis-progress-fill"
                style={{ width: `${parseProgress.percent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (parseError) {
    return (
      <div className="analysis-section">
        <h3>Parse Error</h3>
        <div className="analysis-error">{parseError}</div>
        <button className="wizard-btn wizard-btn-primary" onClick={parseLog}>
          Retry
        </button>
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="analysis-section">
        <div className="analysis-empty">
          <span className="analysis-empty-icon">&#128269;</span>
          <span>No flight sessions found in this log.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="analysis-section">
      <h3>Select Flight Session</h3>
      <p>This log contains {sessions.length} flight sessions. Select one to analyze.</p>
      <div className="session-list">
        {[...sessions].reverse().map((session) => (
          <div
            key={session.index}
            className="session-item"
            role="button"
            tabIndex={0}
            onClick={() => onSelectSession(session.index)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectSession(session.index);
              }
            }}
          >
            <div className="session-item-info">
              <span className="session-item-title">Session {session.index + 1}</span>
              <span className="session-item-meta">
                <span>{session.flightData.durationSeconds.toFixed(1)}s</span>
                <span>{session.flightData.frameCount.toLocaleString()} frames</span>
                <span>{session.flightData.sampleRateHz} Hz</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
