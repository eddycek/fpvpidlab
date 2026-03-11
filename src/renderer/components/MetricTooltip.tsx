import React from 'react';

interface MetricTooltipProps {
  label: string;
  tooltip: string;
  children: React.ReactNode;
}

export function MetricTooltip({ label, tooltip, children }: MetricTooltipProps) {
  return (
    <span className="metric-with-tooltip" title={tooltip}>
      <span className="metric-label">{label}</span>
      {children}
    </span>
  );
}
