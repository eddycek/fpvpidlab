import React, { useState } from 'react';
import { TUNING_WORKFLOW } from '@shared/constants/flightGuide';
import { TUNING_TYPE, TUNING_MODE, TUNING_TYPE_LABELS } from '@shared/constants';
import type { FlightGuideMode } from '@shared/types/tuning.types';
import { useConnection } from '../../hooks/useConnection';
import { FlightGuideContent } from '../TuningWizard/FlightGuideContent';
import '../../components/ProfileWizard.css';
import './TuningWorkflowModal.css';

/** Strip GYRO_SCALED mention from workflow step description for BF 4.6+ */
function filterWorkflowDescription(desc: string, hideGyroScaled: boolean): string {
  if (!hideGyroScaled) return desc;
  // Remove the "On BF 4.3–4.5, also set debug_mode to GYRO_SCALED (not needed on 2025.12+)." portion
  return desc.replace(/\s*On BF 4\.3–4\.5.*$/, '').replace(/\s*$/, '');
}

function isGyroScaledNotNeeded(version?: string): boolean {
  if (!version) return false;
  const match = version.match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  return parseInt(match[1]) > 4 || (parseInt(match[1]) === 4 && parseInt(match[2]) >= 6);
}

type WorkflowTab = 'deep' | 'flash';

interface TuningWorkflowModalProps {
  onClose: () => void;
  mode?: FlightGuideMode; // 'filter' | 'pid' | 'verification' — undefined = show all
}

function getSubtitle(mode?: FlightGuideMode): string {
  if (mode === TUNING_MODE.FILTER) return 'Follow these steps for the filter tuning flight.';
  if (mode === TUNING_MODE.PID) return 'Follow these steps for the PID tuning flight.';
  if (mode === TUNING_MODE.FLASH)
    return 'Rip a pack, land, tune. Any flight works — no special maneuvers needed.';
  if (mode === 'verification') return 'Fly a short hover to verify noise improvement after tuning.';
  if (mode === 'flash_verification')
    return 'Fly normally to verify noise and PID improvements after tuning.';
  return 'Follow this workflow each time you tune. Repeat until your quad feels dialed in.';
}

function getWorkflowSteps(mode?: FlightGuideMode) {
  if (mode === TUNING_MODE.FILTER) {
    // Steps 0–5: Connect → Analyze & apply filters
    return TUNING_WORKFLOW.slice(0, 6);
  }
  if (mode === TUNING_MODE.PID) {
    // Steps 6–8: Erase again → Analyze & apply PIDs
    return TUNING_WORKFLOW.slice(6, 9);
  }
  if (mode === TUNING_MODE.FLASH || mode === 'verification' || mode === 'flash_verification') {
    return [];
  }
  return TUNING_WORKFLOW;
}

function DeepTuneContent({
  hideGyroScaled,
  fcVersion,
}: {
  hideGyroScaled: boolean;
  fcVersion?: string;
}) {
  const steps = getWorkflowSteps(undefined);
  return (
    <>
      <p className="workflow-tab-subtitle">{getSubtitle(undefined)}</p>

      <div className="workflow-steps">
        {steps.map((step, i) => (
          <div key={i} className="workflow-step">
            <div className="workflow-step-number">{i + 1}</div>
            <div className="workflow-step-content">
              <div className="workflow-step-title">{step.title}</div>
              <div className="workflow-step-desc">
                {filterWorkflowDescription(step.description, hideGyroScaled)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <hr className="workflow-divider" />
      <h3 className="workflow-subheading">Flight 1: Filter Test Flight</h3>
      <FlightGuideContent mode="filter" fcVersion={fcVersion} />

      <hr className="workflow-divider" />
      <h3 className="workflow-subheading">Flight 2: PID Test Flight</h3>
      <FlightGuideContent mode="pid" fcVersion={fcVersion} />

      <hr className="workflow-divider" />
      <h3 className="workflow-subheading">Optional: Verification Hover</h3>
      <FlightGuideContent mode="verification" fcVersion={fcVersion} />
    </>
  );
}

function FlashTuneContent({ fcVersion }: { fcVersion?: string }) {
  return (
    <>
      <p className="workflow-tab-subtitle">
        Rip a pack, land, tune. Any flight works — no special maneuvers needed.
      </p>
      <FlightGuideContent mode="quick" fcVersion={fcVersion} />
    </>
  );
}

export function TuningWorkflowModal({ onClose, mode }: TuningWorkflowModalProps) {
  const { status } = useConnection();
  const fcVersion = status.fcInfo?.version;
  const hideGyroScaled = isGyroScaledNotNeeded(fcVersion);
  const isOverviewMode = mode === undefined;
  const [activeTab, setActiveTab] = useState<WorkflowTab>('deep');

  // Non-overview modes: original behavior (single-mode view)
  const steps = !isOverviewMode ? getWorkflowSteps(mode) : [];
  const isQuickMode = mode === TUNING_MODE.FLASH;
  const showFilter = !isOverviewMode && !isQuickMode && mode === TUNING_MODE.FILTER;
  const showPid = !isOverviewMode && !isQuickMode && mode === TUNING_MODE.PID;
  const showQuick = !isOverviewMode && isQuickMode;
  const isVerificationMode = mode === 'verification' || mode === 'flash_verification';

  const title = isOverviewMode
    ? 'How to Tune'
    : mode === 'flash_verification'
      ? 'Verification Flight'
      : mode === 'verification'
        ? 'Verification Hover'
        : isQuickMode
          ? `${TUNING_TYPE_LABELS[TUNING_TYPE.FLASH]} Flight Guide`
          : 'How to Prepare Blackbox Data';

  return (
    <div className="profile-wizard-overlay" onClick={onClose}>
      <div className="profile-wizard-modal" onClick={(e) => e.stopPropagation()}>
        <div className="profile-wizard-header">
          <h2>{title}</h2>
          {!isOverviewMode && <p>{getSubtitle(mode)}</p>}
        </div>

        {isOverviewMode && (
          <>
            <div className="workflow-tabs">
              <button
                className={`workflow-tab ${activeTab === 'deep' ? 'active' : ''}`}
                onClick={() => setActiveTab('deep')}
              >
                {TUNING_TYPE_LABELS[TUNING_TYPE.DEEP]}
                <span className="workflow-tab-meta">2 flights</span>
              </button>
              <button
                className={`workflow-tab ${activeTab === 'flash' ? 'active' : ''}`}
                onClick={() => setActiveTab('flash')}
              >
                {TUNING_TYPE_LABELS[TUNING_TYPE.FLASH]}
                <span className="workflow-tab-meta">1 flight</span>
              </button>
            </div>

            {activeTab === 'deep' && (
              <DeepTuneContent hideGyroScaled={hideGyroScaled} fcVersion={fcVersion} />
            )}
            {activeTab === 'flash' && <FlashTuneContent fcVersion={fcVersion} />}
          </>
        )}

        {!isOverviewMode && steps.length > 0 && (
          <div className="workflow-steps">
            {steps.map((step, i) => (
              <div key={i} className="workflow-step">
                <div className="workflow-step-number">{i + 1}</div>
                <div className="workflow-step-content">
                  <div className="workflow-step-title">{step.title}</div>
                  <div className="workflow-step-desc">
                    {filterWorkflowDescription(step.description, hideGyroScaled)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {isVerificationMode && (
          <FlightGuideContent
            mode={mode === 'flash_verification' ? 'flash_verification' : 'verification'}
            fcVersion={fcVersion}
          />
        )}

        {showQuick && (
          <>
            <hr className="workflow-divider" />
            <FlightGuideContent mode="quick" fcVersion={fcVersion} />
          </>
        )}

        {showFilter && (
          <>
            <hr className="workflow-divider" />
            <h3 className="workflow-subheading">Flight 1: Filter Test Flight</h3>
            <FlightGuideContent mode="filter" fcVersion={fcVersion} />
          </>
        )}

        {showPid && (
          <>
            <hr className="workflow-divider" />
            <h3 className="workflow-subheading">Flight 2: PID Test Flight</h3>
            <FlightGuideContent mode="pid" fcVersion={fcVersion} />
          </>
        )}

        <div className="workflow-modal-actions">
          <button className="wizard-btn wizard-btn-primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
