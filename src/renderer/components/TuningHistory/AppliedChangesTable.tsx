import React from 'react';
import type { AppliedChange } from '@shared/types/tuning.types';

interface AppliedChangesTableProps {
  title: string;
  changes: AppliedChange[];
}

function formatChange(prev: number, next: number): string {
  if (prev === 0) return next === 0 ? '0%' : 'new';
  const pct = ((next - prev) / Math.abs(prev)) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${Math.round(pct)}%`;
}

export function AppliedChangesTable({ title, changes }: AppliedChangesTableProps) {
  if (changes.length === 0) return null;

  return (
    <div className="applied-changes-section">
      <h4 className="applied-changes-title">
        {title} ({changes.length})
      </h4>
      <table className="applied-changes-table">
        <tbody>
          {changes.map((c) => (
            <tr key={c.setting}>
              <td className="applied-changes-setting">{c.setting}</td>
              <td className="applied-changes-values">
                <span className="applied-changes-prev">{c.previousValue}</span>
                <span className="applied-changes-arrow">{'\u2192'}</span>
                <span className="applied-changes-next">{c.newValue}</span>
              </td>
              <td className="applied-changes-pct">{formatChange(c.previousValue, c.newValue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
