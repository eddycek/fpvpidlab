import React from 'react';
import type { WizardStep } from '../../hooks/useTuningWizard';
import type { TuningMode } from '@shared/types/tuning.types';

interface WizardProgressProps {
  currentStep: WizardStep;
  mode?: TuningMode;
}

const ALL_STEPS: { key: WizardStep; label: string }[] = [
  { key: 'guide', label: 'Flight Guide' },
  { key: 'session', label: 'Session' },
  { key: 'filter', label: 'Filters' },
  { key: 'pid', label: 'PIDs' },
  { key: 'summary', label: 'Summary' },
];

const QUICK_STEPS: { key: WizardStep; label: string }[] = [
  { key: 'session', label: 'Session' },
  { key: 'flash_analysis', label: 'Analysis' },
  { key: 'summary', label: 'Summary' },
];

function getStepsForMode(mode: TuningMode): { key: WizardStep; label: string }[] {
  switch (mode) {
    case 'filter':
      return ALL_STEPS.filter((s) => s.key !== 'pid' && s.key !== 'guide');
    case 'pid':
      return ALL_STEPS.filter((s) => s.key !== 'filter' && s.key !== 'guide');
    case 'flash':
      return QUICK_STEPS;
    default:
      return ALL_STEPS;
  }
}

export function WizardProgress({ currentStep, mode = 'full' }: WizardProgressProps) {
  const steps = getStepsForMode(mode);
  const currentIndex = steps.findIndex((s) => s.key === currentStep);

  return (
    <div className="wizard-progress">
      {steps.map((s, i) => {
        const isDone = i < currentIndex;
        const isCurrent = i === currentIndex;
        const className = isDone ? 'done' : isCurrent ? 'current' : 'upcoming';

        return (
          <React.Fragment key={s.key}>
            {i > 0 && <div className={`wizard-progress-line ${isDone ? 'done' : ''}`} />}
            <div className={`wizard-progress-step ${className}`}>
              <div className="wizard-progress-indicator">{isDone ? '\u2713' : i + 1}</div>
              <span className="wizard-progress-label">{s.label}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
