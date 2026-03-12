import React, { useState } from 'react';
import type { TuningType } from '@shared/types/tuning.types';
import type { FCInfo } from '@shared/types/common.types';
import { TUNING_TYPE, TUNING_TYPE_LABELS } from '@shared/constants';
import './StartTuningModal.css';

interface StartTuningModalProps {
  onStart: (tuningType: TuningType, bfPidProfileIndex?: number) => void;
  onCancel: () => void;
  fcInfo?: FCInfo;
  defaultPidProfileIndex?: number;
  pidProfileLabels?: Record<number, string>;
}

export function StartTuningModal({
  onStart,
  onCancel,
  fcInfo,
  defaultPidProfileIndex,
  pidProfileLabels,
}: StartTuningModalProps) {
  const profileCount = fcInfo?.pidProfileCount ?? 0;
  const currentFcProfile = fcInfo?.pidProfileIndex ?? 0;
  const showProfileSelector = profileCount > 1;

  const [selectedProfile, setSelectedProfile] = useState<number>(
    defaultPidProfileIndex ?? currentFcProfile
  );

  const handleStart = (tuningType: TuningType) => {
    onStart(tuningType, showProfileSelector ? selectedProfile : undefined);
  };

  return (
    <div className="start-tuning-overlay" onClick={onCancel}>
      <div className="start-tuning-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Choose Tuning Mode</h2>
        <p className="start-tuning-subtitle">
          Each mode uses a dedicated test flight + a verification flight to confirm results.
        </p>

        {showProfileSelector && (
          <div className="start-tuning-profile-section">
            <label className="start-tuning-profile-label">BF PID Profile</label>
            <div className="start-tuning-profile-selector">
              {Array.from({ length: profileCount }, (_, i) => {
                const label = pidProfileLabels?.[i];
                const isCurrent = i === currentFcProfile;
                return (
                  <button
                    key={i}
                    className={`start-tuning-profile-btn${selectedProfile === i ? ' active' : ''}`}
                    onClick={() => setSelectedProfile(i)}
                  >
                    <span className="start-tuning-profile-num">{i + 1}</span>
                    {label && <span className="start-tuning-profile-name">{label}</span>}
                    {isCurrent && <span className="start-tuning-profile-current">current</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="start-tuning-options">
          <button className="start-tuning-option" onClick={() => handleStart(TUNING_TYPE.FILTER)}>
            <div className="start-tuning-option-header">
              <span className="start-tuning-option-title">
                {TUNING_TYPE_LABELS[TUNING_TYPE.FILTER]}
              </span>
              <span className="start-tuning-option-badge">2 flights</span>
              <span className="start-tuning-option-recommended">Start here</span>
            </div>
            <p className="start-tuning-option-desc">
              Dedicated hover + throttle sweeps (~30 sec). FFT noise analysis optimizes gyro and
              D-term filter cutoffs. Best accuracy for filter tuning.
            </p>
          </button>

          <button className="start-tuning-option" onClick={() => handleStart(TUNING_TYPE.PID)}>
            <div className="start-tuning-option-header">
              <span className="start-tuning-option-title">
                {TUNING_TYPE_LABELS[TUNING_TYPE.PID]}
              </span>
              <span className="start-tuning-option-badge">2 flights</span>
            </div>
            <p className="start-tuning-option-desc">
              Dedicated stick snaps on all axes (~30 sec). Step response analysis tunes P, I, D
              gains. Run after Filter Tune for best results.
            </p>
          </button>

          <button className="start-tuning-option" onClick={() => handleStart(TUNING_TYPE.FLASH)}>
            <div className="start-tuning-option-header">
              <span className="start-tuning-option-title">
                {TUNING_TYPE_LABELS[TUNING_TYPE.FLASH]}
              </span>
              <span className="start-tuning-option-badge">2 flights</span>
            </div>
            <p className="start-tuning-option-desc">
              Fly any style — freestyle, racing, cruising. Estimates filters and PIDs from normal
              flight data via Wiener deconvolution. Faster and easier, but less precise than
              dedicated test flights.
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
