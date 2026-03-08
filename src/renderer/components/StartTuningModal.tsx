import React from 'react';
import type { TuningType } from '@shared/types/tuning.types';
import './StartTuningModal.css';

interface StartTuningModalProps {
  onStart: (tuningType: TuningType) => void;
  onCancel: () => void;
}

export function StartTuningModal({ onStart, onCancel }: StartTuningModalProps) {
  return (
    <div className="start-tuning-overlay" onClick={onCancel}>
      <div className="start-tuning-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Choose Tuning Mode</h2>
        <p className="start-tuning-subtitle">Select how you want to tune your drone.</p>

        <div className="start-tuning-options">
          <button className="start-tuning-option" onClick={() => onStart('guided')}>
            <div className="start-tuning-option-header">
              <span className="start-tuning-option-title">Guided Tune</span>
              <span className="start-tuning-option-badge">2 flights</span>
            </div>
            <p className="start-tuning-option-desc">
              Two dedicated flights: hover for filters, stick snaps for PIDs. Best accuracy for
              beginners or first-time tuning.
            </p>
          </button>

          <button
            className="start-tuning-option start-tuning-option-quick"
            onClick={() => onStart('quick')}
          >
            <div className="start-tuning-option-header">
              <span className="start-tuning-option-title">Quick Tune</span>
              <span className="start-tuning-option-badge start-tuning-badge-quick">1 flight</span>
            </div>
            <p className="start-tuning-option-desc">
              Analyze filters and PIDs from any single flight. Faster iteration for experienced
              pilots with an existing tune.
            </p>
          </button>
        </div>

        <button className="start-tuning-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
