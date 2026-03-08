import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import type { CompletedTuningRecord } from '@shared/types/tuning-history.types';
import { computeTuneQualityScore } from '@shared/utils/tuneQualityScore';
import './QualityTrendChart.css';

interface QualityTrendChartProps {
  history: CompletedTuningRecord[];
}

interface TrendDataPoint {
  date: string;
  score: number;
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function QualityTrendChart({ history }: QualityTrendChartProps) {
  const data = useMemo<TrendDataPoint[]>(() => {
    const points: TrendDataPoint[] = [];
    // history is newest-first from API, reverse for chronological chart
    for (let i = history.length - 1; i >= 0; i--) {
      const record = history[i];
      const score = computeTuneQualityScore({
        filterMetrics: record.filterMetrics,
        pidMetrics: record.pidMetrics,
        verificationMetrics: record.verificationMetrics,
      });
      if (score) {
        points.push({
          date: formatDateShort(record.completedAt),
          score: score.overall,
        });
      }
    }
    return points;
  }, [history]);

  if (data.length < 2) return null;

  return (
    <div className="quality-trend-chart">
      <h4 className="quality-trend-title">Tune Quality Trend</h4>
      <div className="quality-trend-container">
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={{ top: 8, right: 56, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#aaa' }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#aaa' }} width={32} />
            <Tooltip
              contentStyle={{
                background: '#1a1a1a',
                border: '1px solid #444',
                borderRadius: 4,
                fontSize: 12,
              }}
              formatter={((value: number | undefined) => [`${value ?? 0}`, 'Score']) as any}
            />
            <ReferenceLine
              y={80}
              stroke="#51cf66"
              strokeDasharray="4 3"
              strokeOpacity={0.4}
              label={{
                value: 'Excellent',
                position: 'right',
                fill: '#51cf66',
                fontSize: 10,
                opacity: 0.6,
              }}
            />
            <ReferenceLine
              y={60}
              stroke="#ffd43b"
              strokeDasharray="4 3"
              strokeOpacity={0.4}
              label={{
                value: 'Good',
                position: 'right',
                fill: '#ffd43b',
                fontSize: 10,
                opacity: 0.6,
              }}
            />
            <ReferenceLine
              y={40}
              stroke="#ff6b6b"
              strokeDasharray="4 3"
              strokeOpacity={0.4}
              label={{
                value: 'Fair',
                position: 'right',
                fill: '#ff6b6b',
                fontSize: 10,
                opacity: 0.6,
              }}
            />
            <Line
              type="monotone"
              dataKey="score"
              stroke="#4dabf7"
              strokeWidth={2}
              dot={{ fill: '#4dabf7', r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
