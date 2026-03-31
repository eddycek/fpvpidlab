import React, { useState } from 'react';
import '../ProfileWizard.css';
import './ApplyConfirmationModal.css';

interface ChangePreview {
  setting: string;
  currentValue: number;
  recommendedValue: number;
}

interface ApplyConfirmationModalProps {
  filterCount: number;
  pidCount: number;
  feedforwardCount?: number;
  filterChanges?: ChangePreview[];
  pidChanges?: ChangePreview[];
  feedforwardChanges?: ChangePreview[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function ApplyConfirmationModal({
  filterCount,
  pidCount,
  feedforwardCount = 0,
  filterChanges,
  pidChanges,
  feedforwardChanges,
  onConfirm,
  onCancel,
}: ApplyConfirmationModalProps) {
  const totalChanges = filterCount + pidCount + feedforwardCount;
  const [showDetails, setShowDetails] = useState(false);
  const allChanges = [
    ...(filterChanges ?? []),
    ...(pidChanges ?? []),
    ...(feedforwardChanges ?? []),
  ];

  return (
    <div className="profile-wizard-overlay" onClick={onCancel}>
      <div
        className="profile-wizard-modal apply-confirm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="profile-wizard-header">
          <h2>Apply Tuning Changes</h2>
          <p>
            {totalChanges} change{totalChanges !== 1 ? 's' : ''} will be written to your flight
            controller.
          </p>
        </div>

        <div className="apply-confirm-summary">
          {filterCount > 0 && (
            <span className="analysis-meta-pill">
              {filterCount} filter change{filterCount !== 1 ? 's' : ''} (via CLI)
            </span>
          )}
          {pidCount > 0 && (
            <span className="analysis-meta-pill">
              {pidCount} PID change{pidCount !== 1 ? 's' : ''} (via MSP)
            </span>
          )}
          {feedforwardCount > 0 && (
            <span className="analysis-meta-pill">
              {feedforwardCount} feedforward change{feedforwardCount !== 1 ? 's' : ''} (via CLI)
            </span>
          )}
        </div>

        {allChanges.length > 0 && (
          <div className="apply-confirm-details">
            <button className="apply-confirm-toggle" onClick={() => setShowDetails(!showDetails)}>
              {showDetails ? 'Hide details' : 'Review changes'}
            </button>
            {showDetails && (
              <table className="apply-confirm-table">
                <thead>
                  <tr>
                    <th>Setting</th>
                    <th>Current</th>
                    <th>New</th>
                  </tr>
                </thead>
                <tbody>
                  {allChanges.map((c) => (
                    <tr key={c.setting}>
                      <td className="apply-confirm-setting">{c.setting}</td>
                      <td>{c.currentValue}</td>
                      <td className="apply-confirm-new">{Math.round(c.recommendedValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        <div className="apply-confirm-warning">
          Your FC will reboot after applying. You will need to reconnect.
        </div>

        <div className="apply-confirm-actions">
          <button className="wizard-btn wizard-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className="wizard-btn wizard-btn-success" onClick={onConfirm}>
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}
