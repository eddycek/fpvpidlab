import React, { useEffect, useRef } from 'react';
import type { FilterAnalysisResult, PIDAnalysisResult } from '@shared/types/analysis.types';
import type { AnalysisProgress } from '@shared/types/analysis.types';
import { RecommendationCard } from './RecommendationCard';

interface QuickAnalysisStepProps {
  filterResult: FilterAnalysisResult | null;
  filterAnalyzing: boolean;
  filterProgress: AnalysisProgress | null;
  filterError: string | null;
  tfResult: PIDAnalysisResult | null;
  tfAnalyzing: boolean;
  tfError: string | null;
  runQuickAnalysis: () => Promise<void>;
  quickAnalyzing: boolean;
  onContinue: () => void;
}

export function QuickAnalysisStep({
  filterResult,
  filterAnalyzing,
  filterProgress,
  filterError,
  tfResult,
  tfAnalyzing,
  tfError,
  runQuickAnalysis,
  quickAnalyzing,
  onContinue,
}: QuickAnalysisStepProps) {
  const autoRunRef = useRef(false);

  // Auto-run on mount
  useEffect(() => {
    if (!autoRunRef.current && !filterResult && !tfResult && !quickAnalyzing) {
      autoRunRef.current = true;
      runQuickAnalysis();
    }
  }, [filterResult, tfResult, quickAnalyzing, runQuickAnalysis]);

  const allDone = !quickAnalyzing && (filterResult || filterError) && (tfResult || tfError);
  const hasResults = filterResult || tfResult;

  const filterRecs = filterResult?.recommendations ?? [];
  const tfRecs = tfResult?.recommendations ?? [];
  const allRecs = [...filterRecs, ...tfRecs];

  return (
    <div className="analysis-section">
      <h3>Quick Tune Analysis</h3>
      <p className="analysis-description">
        Analyzing filters (noise spectrum) and PIDs (transfer function) from your flight data...
      </p>

      {quickAnalyzing && (
        <div className="analysis-progress">
          <span className="spinner" />
          <span>
            {filterAnalyzing && 'Analyzing noise spectrum...'}
            {!filterAnalyzing && tfAnalyzing && 'Analyzing transfer function...'}
            {filterAnalyzing && tfAnalyzing && 'Analyzing noise & transfer function...'}
          </span>
          {filterProgress && (
            <div className="analysis-progress-detail">
              Filter: {filterProgress.step} ({Math.round(filterProgress.percent)}%)
            </div>
          )}
        </div>
      )}

      {filterError && <div className="analysis-error">Filter analysis failed: {filterError}</div>}

      {tfError && (
        <div className="analysis-error">Transfer function analysis failed: {tfError}</div>
      )}

      {hasResults && (
        <>
          {filterResult && (
            <div className="quick-analysis-section">
              <h4>Filter Recommendations</h4>
              <p className="analysis-summary">{filterResult.summary}</p>
              {filterRecs.length === 0 && (
                <p className="analysis-no-recs">No filter changes recommended.</p>
              )}
              {filterRecs.map((rec, i) => (
                <RecommendationCard
                  key={`filter-${i}`}
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
          )}

          {tfResult && (
            <div className="quick-analysis-section">
              <h4>PID Recommendations</h4>
              <p className="analysis-summary">{tfResult.summary}</p>
              {tfRecs.length === 0 && (
                <p className="analysis-no-recs">No PID changes recommended.</p>
              )}
              {tfRecs.map((rec, i) => (
                <RecommendationCard
                  key={`tf-${i}`}
                  setting={rec.setting}
                  currentValue={rec.currentValue}
                  recommendedValue={rec.recommendedValue}
                  reason={rec.reason}
                  impact={rec.impact}
                  confidence={rec.confidence}
                />
              ))}
            </div>
          )}
        </>
      )}

      {allDone && (
        <div className="analysis-actions">
          <button
            className="wizard-btn wizard-btn-primary"
            onClick={onContinue}
            disabled={allRecs.length === 0}
          >
            {allRecs.length > 0 ? 'Continue to Summary' : 'No Changes to Apply'}
          </button>
          <button className="wizard-btn wizard-btn-secondary" onClick={() => runQuickAnalysis()}>
            Re-analyze
          </button>
        </div>
      )}
    </div>
  );
}
