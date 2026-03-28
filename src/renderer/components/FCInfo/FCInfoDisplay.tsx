import React, { useEffect, useState } from 'react';
import { useConnection, markIntentionalDisconnect } from '../../hooks/useConnection';
import { useFCInfo } from '../../hooks/useFCInfo';
import { useDemoMode } from '../../hooks/useDemoMode';
import { computeBBSettingsStatus } from '../../utils/bbSettingsUtils';
import { FixSettingsConfirmModal } from './FixSettingsConfirmModal';
import type { BlackboxSettings } from '@shared/types/blackbox.types';
import type { FeedforwardConfiguration, RatesConfiguration } from '@shared/types/pid.types';
import './FCInfoDisplay.css';

export function FCInfoDisplay() {
  const { status } = useConnection();
  const { fcInfo, loading, error, fetchFCInfo, exportCLI } = useFCInfo();
  const { isDemoMode } = useDemoMode();
  const [bbSettings, setBbSettings] = useState<BlackboxSettings | null>(null);
  const [bbLoading, setBbLoading] = useState(false);
  const [ffConfig, setFfConfig] = useState<FeedforwardConfiguration | null>(null);
  const [ratesConfig, setRatesConfig] = useState<RatesConfiguration | null>(null);
  const [fixing, setFixing] = useState(false);
  const [showFixConfirm, setShowFixConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    if (status.connected && status.fcInfo) {
      // Use FC info from connection status
    } else if (status.connected) {
      fetchFCInfo();
    }
  }, [status.connected, status.fcInfo, fetchFCInfo]);

  useEffect(() => {
    if (status.connected) {
      setBbLoading(true);
      window.betaflight
        .getBlackboxSettings()
        .then((settings) => setBbSettings(settings))
        .catch(() => setBbSettings(null))
        .finally(() => setBbLoading(false));

      window.betaflight
        .getFeedforwardConfig()
        .then((config) => setFfConfig(config))
        .catch(() => setFfConfig(null));

      window.betaflight
        .getRatesConfig()
        .then((config) => setRatesConfig(config))
        .catch(() => setRatesConfig(null));
    } else {
      setBbSettings(null);
      setFfConfig(null);
      setRatesConfig(null);
    }
  }, [status.connected]);

  const handleExport = async (format: 'diff' | 'dump') => {
    const cli = await exportCLI(format);
    if (cli) {
      // Create download
      const blob = new Blob([cli], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `betaflight-${format}-${new Date().toISOString().split('T')[0]}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleApplyCommands = async (commands: string[]) => {
    setShowFixConfirm(false);
    setShowResetConfirm(false);
    setFixing(true);
    try {
      markIntentionalDisconnect();
      await window.betaflight.fixBlackboxSettings({ commands });
    } catch {
      // FC reboots — reconnect will re-fetch settings
    } finally {
      setFixing(false);
    }
  };

  if (!status.connected) {
    return null;
  }

  const info = status.fcInfo || fcInfo;
  const fcVersion = info?.version || '';
  const bbStatus = computeBBSettingsStatus(bbSettings, fcVersion);

  return (
    <div className="panel">
      <h2 className="panel-title">Flight Controller Information</h2>

      {error && <div className="error">{error}</div>}

      {loading && <div>Loading FC information...</div>}

      {info && (
        <>
          <div className="fc-info-row">
            <div className="info-grid">
              <span className="info-label">Variant:</span>
              <span className="info-value">{info.variant}</span>

              <span className="info-label">Version:</span>
              <span className="info-value">{info.version}</span>

              <span className="info-label">Target:</span>
              <span className="info-value">{info.target}</span>

              {info.boardName && info.boardName !== info.target && (
                <>
                  <span className="info-label">Board:</span>
                  <span className="info-value">{info.boardName}</span>
                </>
              )}

              <span className="info-label">API Version:</span>
              <span className="info-value">
                {info.apiVersion.major}.{info.apiVersion.minor}
              </span>

              {info.pidProfileIndex != null && info.pidProfileCount != null && (
                <>
                  <span className="info-label">PID Profile:</span>
                  <span className="info-value">
                    {info.pidProfileIndex + 1} / {info.pidProfileCount}
                  </span>
                </>
              )}
            </div>

            {bbSettings && (
              <div className="fc-bb-settings">
                {!bbStatus.gyroScaledNotNeeded && (
                  <div className={`fc-bb-setting ${bbStatus.debugModeOk ? 'ok' : 'warn'}`}>
                    <span className="fc-bb-indicator">
                      {bbStatus.debugModeOk ? '\u2713' : '\u26A0'}
                    </span>
                    <span className="fc-bb-label">Debug Mode:</span>
                    <span className="fc-bb-value">{bbSettings.debugMode}</span>
                    {bbStatus.resetCommands.length > 0 && !fixing && (
                      <button
                        className="fc-bb-reset-btn"
                        onClick={() => setShowResetConfirm(true)}
                        disabled={isDemoMode}
                        title={isDemoMode ? 'Not available in demo mode' : undefined}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                )}
                <div className={`fc-bb-setting ${bbStatus.loggingRateOk ? 'ok' : 'warn'}`}>
                  <span className="fc-bb-indicator">
                    {bbStatus.loggingRateOk ? '\u2713' : '\u26A0'}
                  </span>
                  <span className="fc-bb-label">Logging Rate:</span>
                  <span className="fc-bb-value">{formatRate(bbSettings.loggingRateHz)}</span>
                </div>
                {!bbStatus.debugModeOk && !bbStatus.gyroScaledNotNeeded && (
                  <div className="fc-bb-hint">
                    Set <code>debug_mode = GYRO_SCALED</code> for noise analysis (BF 4.3–4.5)
                  </div>
                )}
                {!bbStatus.loggingRateOk && (
                  <div className="fc-bb-hint">Increase logging rate to 2 kHz or higher</div>
                )}
                {bbStatus.fixCommands.length > 0 && !fixing && (
                  <button
                    className="fc-bb-fix-btn"
                    onClick={() => setShowFixConfirm(true)}
                    disabled={isDemoMode}
                    title={isDemoMode ? 'Not available in demo mode' : undefined}
                  >
                    Fix Settings
                  </button>
                )}
                {fixing && <span className="fc-bb-fixing">Fixing settings...</span>}
              </div>
            )}
            {bbLoading && (
              <div className="fc-bb-settings">
                <span className="fc-bb-loading">Reading settings...</span>
              </div>
            )}
          </div>

          {ffConfig && (
            <div className="fc-ff-section">
              <h3 className="fc-ff-title">Feedforward</h3>
              <div className="fc-ff-grid">
                <span className="fc-ff-label">Boost:</span>
                <span className="fc-ff-value">{ffConfig.boost}</span>
                <span className="fc-ff-label">Gains (R/P/Y):</span>
                <span className="fc-ff-value">
                  {ffConfig.rollGain} / {ffConfig.pitchGain} / {ffConfig.yawGain}
                </span>
                <span className="fc-ff-label">Smoothing:</span>
                <span className="fc-ff-value">{ffConfig.smoothFactor}</span>
                <span className="fc-ff-label">Jitter Factor:</span>
                <span className="fc-ff-value">{ffConfig.jitterFactor}</span>
                <span className="fc-ff-label">Transition:</span>
                <span className="fc-ff-value">{ffConfig.transition}</span>
                <span className="fc-ff-label">Max Rate Limit:</span>
                <span className="fc-ff-value">{ffConfig.maxRateLimit}</span>
              </div>
            </div>
          )}

          {ratesConfig && (
            <div className="fc-rates-section">
              <h3 className="fc-rates-title">
                Rates <span className="fc-rates-type">{ratesConfig.ratesType}</span>
              </h3>
              <div className="fc-rates-grid">
                <span className="fc-rates-label">RC Rate (R/P/Y):</span>
                <span className="fc-rates-value">
                  {ratesConfig.roll.rcRate} / {ratesConfig.pitch.rcRate} / {ratesConfig.yaw.rcRate}
                </span>
                <span className="fc-rates-label">Rate (R/P/Y):</span>
                <span className="fc-rates-value">
                  {ratesConfig.roll.rate} / {ratesConfig.pitch.rate} / {ratesConfig.yaw.rate}
                </span>
                <span className="fc-rates-label">Expo (R/P/Y):</span>
                <span className="fc-rates-value">
                  {ratesConfig.roll.rcExpo} / {ratesConfig.pitch.rcExpo} / {ratesConfig.yaw.rcExpo}
                </span>
                <span className="fc-rates-label">Rate Limit (R/P/Y):</span>
                <span className="fc-rates-value">
                  {ratesConfig.roll.rateLimit} / {ratesConfig.pitch.rateLimit} /{' '}
                  {ratesConfig.yaw.rateLimit}
                </span>
              </div>
            </div>
          )}

          <div className="fc-export-buttons">
            <button className="secondary" onClick={() => handleExport('diff')} disabled={loading}>
              Export CLI Diff
            </button>
            <button className="secondary" onClick={() => handleExport('dump')} disabled={loading}>
              Export CLI Dump
            </button>
          </div>
        </>
      )}

      {showFixConfirm && (
        <FixSettingsConfirmModal
          commands={bbStatus.fixCommands}
          onConfirm={() => handleApplyCommands(bbStatus.fixCommands)}
          onCancel={() => setShowFixConfirm(false)}
        />
      )}

      {showResetConfirm && (
        <FixSettingsConfirmModal
          commands={bbStatus.resetCommands}
          onConfirm={() => handleApplyCommands(bbStatus.resetCommands)}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}
    </div>
  );
}

function formatRate(hz: number): string {
  if (hz >= 1000) {
    return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`;
  }
  return `${hz} Hz`;
}
