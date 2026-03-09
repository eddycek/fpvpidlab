import React from 'react';
import type { TuningMode } from '@shared/types/tuning.types';
import { TUNING_TYPE, TUNING_MODE, TUNING_TYPE_LABELS } from '@shared/constants';
import { useConnection } from '../../hooks/useConnection';
import { FlightGuideContent } from './FlightGuideContent';

interface TestFlightGuideStepProps {
  onContinue: () => void;
  mode?: TuningMode;
}

const INTRO_TEXT: Record<TuningMode, string> = {
  [TUNING_MODE.FILTER]: 'Follow this flight plan to collect noise data for filter tuning.',
  [TUNING_MODE.PID]:
    'Follow this flight plan to collect step response data for PID tuning. Your filters have been tuned — this flight will produce cleaner data.',
  [TUNING_MODE.FULL]:
    "Your Blackbox log has been downloaded. Here's what the analysis needs from your flight data — if you haven't flown yet, follow these steps for the best results.",
  [TUNING_MODE.FLASH]: `Rip a pack — freestyle, race, cruise, whatever you normally fly. ${TUNING_TYPE_LABELS[TUNING_TYPE.FLASH]} analyzes both filters and PIDs from any single flight.`,
};

export function TestFlightGuideStep({
  onContinue,
  mode = TUNING_MODE.FULL,
}: TestFlightGuideStepProps) {
  const { status } = useConnection();
  const fcVersion = status.fcInfo?.version;

  return (
    <div className="analysis-section">
      <h3>Test Flight Guide</h3>
      <p>{INTRO_TEXT[mode]}</p>

      <FlightGuideContent mode={mode} fcVersion={fcVersion} />

      <div className="analysis-actions">
        <button className="wizard-btn wizard-btn-primary" onClick={onContinue}>
          Got it — Start Analysis
        </button>
      </div>
    </div>
  );
}
