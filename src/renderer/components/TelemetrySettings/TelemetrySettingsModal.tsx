import React, { useState, useEffect, useRef } from 'react';
import { useTelemetrySettings } from '../../hooks/useTelemetrySettings';
import './TelemetrySettingsModal.css';

interface TelemetrySettingsModalProps {
  onClose: () => void;
}

export function TelemetrySettingsModal({ onClose }: TelemetrySettingsModalProps) {
  const { settings, loading, toggleEnabled, sendNow, sending } = useTelemetrySettings();
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'telemetry' | 'logs'>('telemetry');
  const [logs, setLogs] = useState<string[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const logBoxRef = useRef<HTMLDivElement>(null);

  const handleCopyId = async () => {
    if (!settings) return;
    try {
      await navigator.clipboard.writeText(settings.installationId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied
    }
  };

  const formatLastUpload = (iso: string | null): string => {
    if (!iso) return 'Never';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return 'Unknown';
    }
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const lines = await window.betaflight.getAppLogs(50);
      setLogs(lines);
    } catch {
      setLogs(['Failed to load logs']);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleExportLogs = async () => {
    setExporting(true);
    try {
      await window.betaflight.exportAppLogs();
    } catch {
      // Dialog cancelled or error
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'logs' && logs.length === 0) {
      loadLogs();
    }
  }, [activeTab]);

  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="telemetry-modal" onClick={(e) => e.stopPropagation()}>
        <div className="telemetry-modal-header">
          <h2>Settings</h2>
          <button className="telemetry-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="settings-tabs">
          <button
            className={`settings-tab ${activeTab === 'telemetry' ? 'settings-tab-active' : ''}`}
            onClick={() => setActiveTab('telemetry')}
          >
            Telemetry
          </button>
          <button
            className={`settings-tab ${activeTab === 'logs' ? 'settings-tab-active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            Logs
          </button>
        </div>

        {activeTab === 'telemetry' && (
          <>
            {loading ? (
              <div className="telemetry-modal-body">
                <p>Loading...</p>
              </div>
            ) : !settings ? (
              <div className="telemetry-modal-body">
                <p>Failed to load telemetry settings.</p>
              </div>
            ) : (
              <div className="telemetry-modal-body">
                <div className="telemetry-toggle-row">
                  <label className="telemetry-toggle-label" htmlFor="telemetry-toggle">
                    Send anonymous usage data
                  </label>
                  <button
                    id="telemetry-toggle"
                    role="switch"
                    aria-checked={settings.enabled}
                    className={`telemetry-toggle ${settings.enabled ? 'telemetry-toggle-on' : ''}`}
                    onClick={toggleEnabled}
                  >
                    <span className="telemetry-toggle-thumb" />
                  </button>
                </div>

                <p className="telemetry-description">
                  Help improve PIDlab by sharing anonymous usage data. We collect tuning mode usage,
                  drone sizes, flight quality scores, and Betaflight versions. No flight data, PID
                  values, or personal information is ever sent.
                </p>

                <div className="telemetry-info-row">
                  <span className="telemetry-info-label">Installation ID</span>
                  <span className="telemetry-info-value">
                    <code>{settings.installationId.substring(0, 8)}...</code>
                    <button className="telemetry-copy-btn" onClick={handleCopyId}>
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </span>
                </div>

                <div className="telemetry-info-row">
                  <span className="telemetry-info-label">Last upload</span>
                  <span className="telemetry-info-value">
                    {formatLastUpload(settings.lastUploadAt)}
                  </span>
                </div>

                {settings.lastUploadError && (
                  <div className="telemetry-info-row">
                    <span className="telemetry-info-label">Last error</span>
                    <span className="telemetry-info-value telemetry-error-value">
                      {settings.lastUploadError}
                    </span>
                  </div>
                )}

                <div className="telemetry-actions">
                  <button
                    className="wizard-btn wizard-btn-secondary"
                    onClick={sendNow}
                    disabled={!settings.enabled || sending}
                  >
                    {sending ? 'Sending...' : 'Send Now'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'logs' && (
          <div className="telemetry-modal-body">
            <p className="telemetry-description">
              Application logs for troubleshooting. Share these with the developer when reporting
              issues.
            </p>

            <div className="logs-box" ref={logBoxRef}>
              {logsLoading ? (
                <p className="logs-loading">Loading logs...</p>
              ) : (
                logs.map((line, i) => (
                  <div key={i} className="logs-line">
                    {line}
                  </div>
                ))
              )}
            </div>

            <div className="logs-actions">
              <button
                className="wizard-btn wizard-btn-secondary"
                onClick={loadLogs}
                disabled={logsLoading}
              >
                Refresh
              </button>
              <button
                className="wizard-btn wizard-btn-secondary"
                onClick={handleExportLogs}
                disabled={exporting}
              >
                {exporting ? 'Exporting...' : 'Export to file'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
