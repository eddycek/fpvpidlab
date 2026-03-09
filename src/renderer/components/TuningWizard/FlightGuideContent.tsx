import React from 'react';
import type { FlightGuideMode } from '@shared/types/tuning.types';
import {
  FLIGHT_PHASES,
  FLIGHT_TIPS,
  FILTER_FLIGHT_PHASES,
  FILTER_FLIGHT_TIPS,
  PID_FLIGHT_PHASES,
  PID_FLIGHT_TIPS,
  QUICK_FLIGHT_PHASES,
  QUICK_FLIGHT_TIPS,
  VERIFICATION_FLIGHT_PHASES,
  VERIFICATION_FLIGHT_TIPS,
  FLASH_VERIFICATION_FLIGHT_PHASES,
  FLASH_VERIFICATION_FLIGHT_TIPS,
} from '@shared/constants/flightGuide';
import { PhaseIllustration } from './PhaseIllustration';
import './FlightGuideContent.css';

interface FlightGuideContentProps {
  mode?: FlightGuideMode;
  /** Connected FC version string (e.g. '4.5.1'). When provided, version-specific tips are filtered. */
  fcVersion?: string;
}

/** BF 4.6+ logs unfiltered gyro by default — GYRO_SCALED tip not needed */
function shouldHideGyroScaledTip(version?: string): boolean {
  if (!version) return false;
  const match = version.match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  return parseInt(match[1]) > 4 || (parseInt(match[1]) === 4 && parseInt(match[2]) >= 6);
}

function getPhasesForMode(mode: FlightGuideMode) {
  switch (mode) {
    case 'filter':
      return FILTER_FLIGHT_PHASES;
    case 'pid':
      return PID_FLIGHT_PHASES;
    case 'quick':
      return QUICK_FLIGHT_PHASES;
    case 'verification':
      return VERIFICATION_FLIGHT_PHASES;
    case 'flash_verification':
      return FLASH_VERIFICATION_FLIGHT_PHASES;
    default:
      return FLIGHT_PHASES;
  }
}

function getTipsForMode(mode: FlightGuideMode) {
  switch (mode) {
    case 'filter':
      return FILTER_FLIGHT_TIPS;
    case 'pid':
      return PID_FLIGHT_TIPS;
    case 'quick':
      return QUICK_FLIGHT_TIPS;
    case 'verification':
      return VERIFICATION_FLIGHT_TIPS;
    case 'flash_verification':
      return FLASH_VERIFICATION_FLIGHT_TIPS;
    default:
      return FLIGHT_TIPS;
  }
}

export function FlightGuideContent({ mode = 'full', fcVersion }: FlightGuideContentProps) {
  const phases = getPhasesForMode(mode);

  const hideGyroTip = shouldHideGyroScaledTip(fcVersion);
  const allTips = getTipsForMode(mode);
  const tips = hideGyroTip ? allTips.filter((t) => !t.includes('GYRO_SCALED')) : allTips;

  return (
    <>
      <div className="flight-guide-phases">
        {phases.map((phase, i) => (
          <div key={i} className="flight-guide-phase">
            <div className="flight-guide-phase-number">{i + 1}</div>
            <div className="flight-guide-phase-content">
              <div className="flight-guide-phase-header">
                <strong>{phase.title}</strong>
                {phase.duration && (
                  <span className="flight-guide-phase-duration">{phase.duration}</span>
                )}
              </div>
              <span className="flight-guide-phase-desc">{phase.description}</span>
            </div>
            <PhaseIllustration title={phase.title} />
          </div>
        ))}
      </div>

      <div className="flight-guide-tips">
        <strong>Tips</strong>
        <ul>
          {tips.map((tip, i) => (
            <li key={i} className="flight-guide-tip">
              {tip}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
