import React, { useState } from 'react';
import { useLicense } from '../../hooks/useLicense';
import './LicenseSettingsModal.css';

interface LicenseSettingsModalProps {
  onClose: () => void;
}

export function LicenseSettingsModal({ onClose }: LicenseSettingsModalProps) {
  const { status, loading, activating, error, activate, remove, isPro } = useLicense();
  const [keyInput, setKeyInput] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const handleActivate = async () => {
    if (!keyInput.trim()) return;
    try {
      await activate(keyInput.trim());
      setKeyInput('');
    } catch {
      // Error is set in hook
    }
  };

  const handleRemove = async () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    await remove();
    setConfirmRemove(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleActivate();
    }
  };

  const formatDate = (iso: string | undefined): string => {
    if (!iso) return 'N/A';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return 'Unknown';
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="license-modal" onClick={(e) => e.stopPropagation()}>
        <div className="license-modal-header">
          <h2>License</h2>
          <button
            type="button"
            className="license-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {loading ? (
          <div className="license-modal-body">
            <p>Loading...</p>
          </div>
        ) : (
          <div className="license-modal-body">
            <div className="license-status-row">
              <span className="license-status-label">Status</span>
              <span
                className={`license-badge ${isPro ? 'license-badge-pro' : 'license-badge-free'}`}
              >
                {isPro ? 'Pro' : 'Free'}
              </span>
            </div>

            <div className="license-comparison">
              <div className="license-comparison-col">
                <h3 className="license-comparison-title license-comparison-free">Free</h3>
                <ul className="license-comparison-list">
                  <li className="license-comparison-limit">1 drone profile</li>
                  <li>Filter Tune</li>
                  <li>PID Tune</li>
                  <li>Flash Tune</li>
                  <li>Analysis overview</li>
                  <li>Tuning history</li>
                  <li>Snapshots &amp; restore</li>
                </ul>
              </div>
              <div className="license-comparison-col">
                <h3 className="license-comparison-title license-comparison-pro">Pro</h3>
                <ul className="license-comparison-list">
                  <li className="license-comparison-highlight">Unlimited drone profiles</li>
                  <li>Filter Tune</li>
                  <li>PID Tune</li>
                  <li>Flash Tune</li>
                  <li>Analysis overview</li>
                  <li>Tuning history</li>
                  <li>Snapshots &amp; restore</li>
                </ul>
              </div>
            </div>

            <div className="license-pitch">
              <p>
                {isPro ? (
                  <>
                    Thank you for supporting PIDlab! Your Pro license gives you{' '}
                    <strong>lifetime access</strong> to all current and future features.
                  </>
                ) : (
                  <>
                    With a Pro license you get <strong>lifetime access</strong> to all current and
                    future features. We don't guarantee that all functionality will remain in the
                    free version as PIDlab evolves. By upgrading you also directly support the
                    development of this project.
                  </>
                )}
              </p>
            </div>

            {isPro && status && (
              <>
                {status.key && (
                  <div className="license-info-row">
                    <span className="license-info-label">Key</span>
                    <span className="license-info-value">
                      <code>{status.key}</code>
                    </span>
                  </div>
                )}
                <div className="license-info-row">
                  <span className="license-info-label">Activated</span>
                  <span className="license-info-value">{formatDate(status.activatedAt)}</span>
                </div>
                <div className="license-info-row">
                  <span className="license-info-label">Last validated</span>
                  <span className="license-info-value">{formatDate(status.lastValidatedAt)}</span>
                </div>

                <div className="license-actions">
                  <button
                    className="wizard-btn wizard-btn-secondary license-remove-btn"
                    onClick={handleRemove}
                  >
                    {confirmRemove ? 'Confirm Remove' : 'Remove License'}
                  </button>
                  {confirmRemove && (
                    <button
                      className="wizard-btn wizard-btn-secondary"
                      onClick={() => setConfirmRemove(false)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </>
            )}

            {!isPro && (
              <>
                {/* Buy button — hidden until Stripe integration is ready
                <div className="license-buy-row">
                  <a
                    className="wizard-btn wizard-btn-primary license-buy-btn"
                    href="https://pidlab.app/pricing"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Buy Pro License
                  </a>
                </div>
                */}

                <div className="license-activate-section">
                  <p className="license-description">Already have a license key?</p>
                  <div className="license-key-input-row">
                    <input
                      type="text"
                      className="license-key-input"
                      placeholder="PIDLAB-XXXX-XXXX-XXXX"
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
                      onKeyDown={handleKeyDown}
                      maxLength={21}
                      disabled={activating}
                    />
                    <button
                      className="wizard-btn wizard-btn-primary"
                      onClick={handleActivate}
                      disabled={!keyInput.trim() || activating}
                    >
                      {activating ? 'Activating...' : 'Activate'}
                    </button>
                  </div>

                  {error && <p className="license-error">{error}</p>}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
