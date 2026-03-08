import React, { useState } from 'react';
import { RecommendationCard } from './RecommendationCard';
import { SpectrumChart } from './charts/SpectrumChart';
import type { FilterAnalysisResult, AnalysisProgress } from '@shared/types/analysis.types';
import type { TuningMode } from '@shared/types/tuning.types';

interface FilterAnalysisStepProps {
  filterResult: FilterAnalysisResult | null;
  filterAnalyzing: boolean;
  filterProgress: AnalysisProgress | null;
  filterError: string | null;
  runFilterAnalysis: () => Promise<void>;
  onContinue: () => void;
  mode?: TuningMode;
}

const STEP_LABELS: Record<string, string> = {
  segmenting: 'Finding steady flight segments...',
  fft: 'Computing frequency spectrum...',
  analyzing: 'Analyzing noise patterns...',
  recommending: 'Generating recommendations...',
};

const PEAK_TYPE_LABELS: Record<string, string> = {
  frame_resonance: 'Frame',
  motor_harmonic: 'Motor',
  electrical: 'Electrical',
  unknown: 'Unknown',
};

export function FilterAnalysisStep({
  filterResult,
  filterAnalyzing,
  filterProgress,
  filterError,
  runFilterAnalysis,
  onContinue,
  mode = 'full',
}: FilterAnalysisStepProps) {
  const continueLabel = mode === 'filter' ? 'Continue to Summary' : 'Continue to PID Analysis';
  const skipLabel = mode === 'filter' ? 'Skip to Summary' : 'Skip to PIDs';
  const [noiseDetailsOpen, setNoiseDetailsOpen] = useState(true);

  if (filterAnalyzing) {
    return (
      <div className="analysis-section">
        <h3>Filter Analysis</h3>
        <p>Analyzing gyro noise to optimize filter settings...</p>
        {filterProgress && (
          <div className="analysis-progress">
            <div className="analysis-progress-label">
              <span>{STEP_LABELS[filterProgress.step] || filterProgress.step}</span>
              <span>{filterProgress.percent}%</span>
            </div>
            <div className="analysis-progress-bar">
              <div
                className="analysis-progress-fill"
                style={{ width: `${filterProgress.percent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (filterError) {
    return (
      <div className="analysis-section">
        <h3>Filter Analysis</h3>
        <div className="analysis-error">{filterError}</div>
        <div className="analysis-actions">
          <button className="wizard-btn wizard-btn-primary" onClick={runFilterAnalysis}>
            Retry
          </button>
          <button className="wizard-btn wizard-btn-secondary" onClick={onContinue}>
            {skipLabel}
          </button>
        </div>
      </div>
    );
  }

  if (filterResult) {
    return (
      <div className="analysis-section">
        <h3>Filter Analysis Results</h3>
        <p>
          Noise level:{' '}
          <span className={`noise-level-badge ${filterResult.noise.overallLevel}`}>
            {filterResult.noise.overallLevel}
          </span>{' '}
          &mdash; {filterResult.summary}
        </p>

        <div className="analysis-meta">
          <span className="analysis-meta-pill">
            {filterResult.segmentsUsed} segment{filterResult.segmentsUsed !== 1 ? 's' : ''} analyzed
          </span>
          {filterResult.rpmFilterActive !== undefined && (
            <span
              className={`analysis-meta-pill ${filterResult.rpmFilterActive ? 'rpm-active' : 'rpm-inactive'}`}
            >
              RPM Filter: {filterResult.rpmFilterActive ? 'Active' : 'Not detected'}
            </span>
          )}
          {filterResult.dataQuality && (
            <span
              className={`analysis-meta-pill quality-${filterResult.dataQuality.tier}`}
              title={`Data quality: ${filterResult.dataQuality.overall}/100`}
            >
              Data: {filterResult.dataQuality.tier} ({filterResult.dataQuality.overall}/100)
            </span>
          )}
          {filterResult.windDisturbance && (
            <span
              className={`analysis-meta-pill wind-${filterResult.windDisturbance.level}`}
              title={filterResult.windDisturbance.summary}
            >
              Wind: {filterResult.windDisturbance.level}
            </span>
          )}
        </div>

        {filterResult.rpmFilterActive && (
          <div className="analysis-warning analysis-warning--info">
            <span className="analysis-warning-icon">{'\u2139\uFE0F'}</span>
            <span>
              RPM filter is active — filter recommendations are optimized for lower latency.
            </span>
          </div>
        )}

        {filterResult.warnings && filterResult.warnings.length > 0 && (
          <div className="analysis-warnings">
            {filterResult.warnings.map((w, i) => (
              <div key={i} className={`analysis-warning analysis-warning--${w.severity}`}>
                <span className="analysis-warning-icon">
                  {w.severity === 'error'
                    ? '\u274C'
                    : w.severity === 'info'
                      ? '\u2139\uFE0F'
                      : '\u26A0\uFE0F'}
                </span>
                <span>{w.message}</span>
              </div>
            ))}
          </div>
        )}

        <button
          className="noise-details-toggle"
          onClick={() => setNoiseDetailsOpen(!noiseDetailsOpen)}
        >
          {noiseDetailsOpen ? 'Hide noise details' : 'Show noise details'}
        </button>

        {noiseDetailsOpen && (
          <div className="noise-details">
            <p className="chart-description">
              Frequency spectrum of gyro noise during stable hover. Peaks indicate noise sources
              &mdash; <strong>motor harmonics</strong> (propeller vibrations),{' '}
              <strong>frame resonance</strong> (structural vibrations), or{' '}
              <strong>electrical</strong> noise. A flat, low spectrum means a clean build. Tall
              peaks may need filter adjustments.
            </p>
            <p className="chart-legend">
              <span className="chart-legend-item">
                <span className="chart-legend-line" style={{ borderColor: '#ff6b6b' }} /> Roll
              </span>
              <span className="chart-legend-item">
                <span className="chart-legend-line" style={{ borderColor: '#51cf66' }} /> Pitch
              </span>
              <span className="chart-legend-item">
                <span className="chart-legend-line" style={{ borderColor: '#4dabf7' }} /> Yaw
              </span>
              <span className="chart-legend-item">
                <span className="chart-legend-line chart-legend-line--dashed" /> Noise floor
              </span>
              <span className="chart-legend-item">
                <span
                  className="chart-legend-line chart-legend-line--dashed"
                  style={{ borderColor: '#ffd43b' }}
                />{' '}
                Peak marker
              </span>
            </p>
            <SpectrumChart noise={filterResult.noise} />
            <div className="axis-summary">
              {(['roll', 'pitch', 'yaw'] as const).map((axis) => {
                const profile = filterResult.noise[axis];
                return (
                  <div key={axis} className="axis-summary-card">
                    <div className="axis-summary-card-title">{axis}</div>
                    <div className="axis-summary-card-stat">
                      <span>Noise floor: </span>
                      {profile.noiseFloorDb.toFixed(0)} dB
                    </div>
                    <div className="axis-summary-card-stat">
                      <span>Peaks: </span>
                      {profile.peaks.length}
                    </div>
                    {profile.peaks.map((peak, i) => (
                      <div key={i} className="axis-summary-card-stat">
                        <span>{peak.frequency.toFixed(0)} Hz </span>
                        <span className={`noise-peak-badge ${peak.type}`}>
                          {PEAK_TYPE_LABELS[peak.type] || peak.type}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {filterResult.recommendations.length > 0 ? (
          <div className="recommendation-list">
            {filterResult.recommendations.map((rec) => (
              <RecommendationCard
                key={rec.setting}
                setting={rec.setting}
                currentValue={rec.currentValue}
                recommendedValue={rec.recommendedValue}
                reason={rec.reason}
                impact={rec.impact}
                confidence={rec.confidence}
                unit="Hz"
              />
            ))}
          </div>
        ) : (
          <div className="analysis-empty">
            <span className="analysis-empty-icon">&#9989;</span>
            <span>Your filter settings look good! No changes recommended.</span>
          </div>
        )}

        <div className="analysis-actions">
          <button className="wizard-btn wizard-btn-primary" onClick={onContinue}>
            {continueLabel}
          </button>
        </div>
      </div>
    );
  }

  // Initial state — not yet run
  return (
    <div className="analysis-section">
      <h3>Filter Analysis</h3>
      <p>
        Analyze gyro noise from your flight data to find optimal filter settings. This uses FFT
        (Fast Fourier Transform) to identify noise frequencies and recommend filter adjustments.
      </p>
      <button className="wizard-btn wizard-btn-primary" onClick={runFilterAnalysis}>
        Run Filter Analysis
      </button>
    </div>
  );
}
