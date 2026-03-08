import React, { useMemo, useState } from 'react';
import type { CompletedTuningRecord, TuneQualityScore } from '@shared/types/tuning-history.types';
import { computeTuneQualityScore, TIER_LABELS } from '@shared/utils/tuneQualityScore';
import { TuningSessionDetail } from './TuningSessionDetail';
import { QualityTrendChart } from './QualityTrendChart';
import './TuningHistoryPanel.css';

interface TuningHistoryPanelProps {
  history: CompletedTuningRecord[];
  loading: boolean;
  onReanalyzeHistory?: (record: CompletedTuningRecord) => void;
  availableLogIds?: Set<string>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function recordSummary(record: CompletedTuningRecord): string {
  const parts: string[] = [];
  const fc = record.appliedFilterChanges.length;
  const pc = record.appliedPIDChanges.length;
  if (fc > 0) parts.push(`${fc} filter`);
  if (pc > 0) parts.push(`${pc} PID`);
  const changes = parts.length > 0 ? `${parts.join(' + ')} changes` : 'No changes';
  const suffix = record.tuningType === 'quick' ? ' (Quick Tune)' : '';

  const noise = record.filterMetrics ? `Noise: ${record.filterMetrics.noiseLevel}` : '';

  return noise ? `${changes}${suffix} \u2022 ${noise}` : `${changes}${suffix}`;
}

export function TuningHistoryPanel({
  history,
  loading,
  onReanalyzeHistory,
  availableLogIds,
}: TuningHistoryPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const scoreMap = useMemo(() => {
    const map = new Map<string, TuneQualityScore | null>();
    for (const record of history) {
      map.set(
        record.id,
        computeTuneQualityScore({
          filterMetrics: record.verificationMetrics ?? record.filterMetrics,
          pidMetrics: record.pidMetrics,
        })
      );
    }
    return map;
  }, [history]);

  if (loading) return null;
  if (history.length === 0) return null;

  return (
    <div className="tuning-history-panel">
      <h3 className="tuning-history-title">Tuning History</h3>

      <QualityTrendChart history={history} />

      <div className="tuning-history-list">
        {history.map((record) => {
          const isExpanded = expandedId === record.id;
          const score = scoreMap.get(record.id);
          return (
            <div key={record.id} className={`tuning-history-card ${isExpanded ? 'expanded' : ''}`}>
              <button
                className="tuning-history-card-header"
                onClick={() => setExpandedId(isExpanded ? null : record.id)}
                aria-expanded={isExpanded}
              >
                <div className="tuning-history-card-info">
                  <span className="tuning-history-card-date">{formatDate(record.completedAt)}</span>
                  <span className="tuning-history-card-summary">{recordSummary(record)}</span>
                </div>
                <div className="tuning-history-card-right">
                  {score && (
                    <span className={`quality-score-badge quality-score-${score.tier}`}>
                      {score.overall} {TIER_LABELS[score.tier]}
                    </span>
                  )}
                  <span className={`tuning-history-card-chevron ${isExpanded ? 'open' : ''}`}>
                    {'\u25B8'}
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div className="tuning-history-card-body">
                  <TuningSessionDetail
                    record={record}
                    onReanalyzeVerification={
                      onReanalyzeHistory &&
                      record.verificationLogId &&
                      availableLogIds?.has(record.verificationLogId)
                        ? () => onReanalyzeHistory(record)
                        : undefined
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
