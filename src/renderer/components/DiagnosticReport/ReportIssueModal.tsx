import React, { useState } from 'react';
import './ReportIssueModal.css';

interface ReportIssueModalProps {
  onSubmit: (email?: string, note?: string) => void;
  onClose: () => void;
  submitting: boolean;
}

export function ReportIssueModal({ onSubmit, onClose, submitting }: ReportIssueModalProps) {
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');

  const handleSubmit = () => {
    onSubmit(email.trim() || undefined, note.trim() || undefined);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="report-modal" onClick={(e) => e.stopPropagation()}>
        <div className="report-modal-header">
          <h2>Report Tuning Issue</h2>
          <button type="button" className="report-modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="report-modal-body">
          <p className="report-modal-description">
            We'll send diagnostic data from this session to help us improve PIDlab.
          </p>

          <label className="report-field-label" htmlFor="report-email">
            Email (optional)
          </label>
          <input
            id="report-email"
            type="email"
            className="report-field-input"
            placeholder="So we can follow up on your report"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
          />

          <label className="report-field-label" htmlFor="report-note">
            What went wrong? (optional)
          </label>
          <textarea
            id="report-note"
            className="report-field-textarea"
            placeholder="e.g. Recommends lowering LPF1 to 80 Hz but my quad vibrates..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            disabled={submitting}
          />

          <div className="report-privacy-note">
            <strong>What we'll send:</strong>
            <ul>
              <li>Analysis results &amp; recommendations</li>
              <li>Flight controller settings</li>
              <li>Data quality metrics</li>
            </ul>
            <p>No personal data, file paths, or raw flight recordings.</p>
          </div>
        </div>

        <div className="report-modal-footer">
          <button
            className="wizard-btn wizard-btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="wizard-btn wizard-btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Sending...' : 'Send Report'}
          </button>
        </div>
      </div>
    </div>
  );
}
