import { useState } from 'react';

import { PresetSelector } from './PresetSelector';
import { SIZE_DEFAULTS, PRESET_PROFILES } from '@shared/constants';
import type {
  DroneSize,
  BatteryType,
  FlightStyle,
  ProfileCreationInput,
} from '@shared/types/profile.types';
import type { FCInfo } from '@shared/types/common.types';
import './ProfileWizard.css';

interface ProfileWizardProps {
  fcSerial: string;
  fcInfo: FCInfo;
  onComplete: (
    input:
      | ProfileCreationInput
      | { presetId: string; customName?: string; flightStyle?: FlightStyle }
  ) => void;
}

type WizardStep = 'method' | 'preset' | 'basic' | 'review';
type CreationMethod = 'preset' | 'custom';

// Flight style derived from preset definitions in constants.ts

export function ProfileWizard({ fcSerial, fcInfo, onComplete }: ProfileWizardProps) {
  const [step, setStep] = useState<WizardStep>('method');
  const [method, setMethod] = useState<CreationMethod | null>(null);

  // Preset path
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [presetCustomName, setPresetCustomName] = useState('');

  // Flight style (shared between custom and preset paths)
  const [flightStyle, setFlightStyle] = useState<FlightStyle>('balanced');

  // Custom path - basic
  const [name, setName] = useState('');
  const [size, setSize] = useState<DroneSize>('5"');
  const [propSize, setPropSize] = useState('5.1"');
  const [battery, setBattery] = useState<BatteryType>('4S');
  const [weight, setWeight] = useState(650);
  const [motorKV, setMotorKV] = useState(2400);
  const [notes, setNotes] = useState('');

  // Apply size defaults when size changes
  const handleSizeChange = (newSize: DroneSize) => {
    setSize(newSize);
    const defaults = SIZE_DEFAULTS[newSize];
    if (defaults) {
      setWeight(defaults.weight);
      setMotorKV(defaults.motorKV);
      setBattery(defaults.battery);
      setPropSize(defaults.propSize);
    }
  };

  const handlePresetSelect = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = PRESET_PROFILES[presetId as keyof typeof PRESET_PROFILES];
    setFlightStyle(preset?.flightStyle ?? 'balanced');
  };

  const handleMethodSelect = (selectedMethod: CreationMethod) => {
    setMethod(selectedMethod);
    if (selectedMethod === 'preset') {
      setStep('preset');
    } else {
      setStep('basic');
    }
  };

  const handlePresetContinue = () => {
    if (!selectedPresetId) return;
    setStep('review');
  };

  const handleBasicContinue = () => {
    setStep('review');
  };

  const handleComplete = () => {
    if (method === 'preset' && selectedPresetId) {
      onComplete({
        presetId: selectedPresetId,
        customName: presetCustomName || undefined,
        flightStyle,
      });
    } else {
      const input: ProfileCreationInput = {
        fcSerialNumber: fcSerial,
        fcInfo,
        name,
        size,
        propSize,
        battery,
        weight,
        motorKV,
        notes: notes || undefined,
        flightStyle,
      };
      onComplete(input);
    }
  };

  const canContinueBasic = name.trim().length > 0;
  const canContinuePreset = selectedPresetId !== null;

  const modalContent = (
    <div className="profile-wizard-overlay">
      <div className="profile-wizard-modal">
        {/* Header */}
        <div className="profile-wizard-header">
          <h2>Create Drone Profile</h2>
          <p>
            New flight controller detected:{' '}
            <span className="fc-name">{fcInfo.boardName || 'Unknown'}</span>
          </p>
        </div>

        {/* Steps */}
        {step === 'method' && <MethodStep onSelect={handleMethodSelect} />}

        {step === 'preset' && (
          <PresetStep
            selectedPresetId={selectedPresetId}
            customName={presetCustomName}
            onPresetSelect={handlePresetSelect}
            onNameChange={setPresetCustomName}
            onBack={() => setStep('method')}
            onContinue={handlePresetContinue}
            canContinue={canContinuePreset}
          />
        )}

        {step === 'basic' && (
          <BasicStep
            name={name}
            size={size}
            propSize={propSize}
            battery={battery}
            weight={weight}
            motorKV={motorKV}
            notes={notes}
            flightStyle={flightStyle}
            onNameChange={setName}
            onSizeChange={handleSizeChange}
            onPropSizeChange={setPropSize}
            onBatteryChange={setBattery}
            onWeightChange={setWeight}
            onMotorKVChange={setMotorKV}
            onNotesChange={setNotes}
            onFlightStyleChange={setFlightStyle}
            onBack={() => setStep('method')}
            onContinue={handleBasicContinue}
            canContinue={canContinueBasic}
          />
        )}

        {step === 'review' && (
          <ReviewStep
            method={method!}
            presetId={selectedPresetId}
            presetCustomName={presetCustomName}
            name={name}
            size={size}
            propSize={propSize}
            battery={battery}
            weight={weight}
            motorKV={motorKV}
            notes={notes}
            flightStyle={flightStyle}
            onBack={() => setStep(method === 'preset' ? 'preset' : 'basic')}
            onCreate={handleComplete}
          />
        )}
      </div>
    </div>
  );

  return modalContent;
}

// Method selection step
function MethodStep({ onSelect }: { onSelect: (method: CreationMethod) => void }) {
  return (
    <div>
      <div className="method-options">
        <button onClick={() => onSelect('preset')} className="method-option">
          <div className="method-option-title">Use a Preset</div>
          <div className="method-option-description">
            Quick setup with pre-configured values for common drone types
          </div>
        </button>

        <button onClick={() => onSelect('custom')} className="method-option">
          <div className="method-option-title">Custom Configuration</div>
          <div className="method-option-description">
            Manually configure all parameters for maximum control
          </div>
        </button>
      </div>
    </div>
  );
}

// Preset selection step
function PresetStep({
  selectedPresetId,
  customName,
  onPresetSelect,
  onNameChange,
  onBack,
  onContinue,
  canContinue,
}: {
  selectedPresetId: string | null;
  customName: string;
  onPresetSelect: (id: string) => void;
  onNameChange: (name: string) => void;
  onBack: () => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  return (
    <div>
      <PresetSelector selectedPresetId={selectedPresetId} onSelect={onPresetSelect} />

      {selectedPresetId && (
        <div className="wizard-form-group">
          <label>Custom Name (optional)</label>
          <input
            type="text"
            value={customName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Leave empty to use preset name"
          />
        </div>
      )}

      <div className="wizard-actions">
        <button onClick={onBack} className="wizard-btn wizard-btn-secondary">
          Back
        </button>
        <button
          onClick={onContinue}
          disabled={!canContinue}
          className="wizard-btn wizard-btn-primary"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

const FLIGHT_STYLE_OPTIONS: { value: FlightStyle; label: string; description: string }[] = [
  {
    value: 'smooth',
    label: 'Smooth',
    description: 'Cinematic, smooth transitions, minimal overshoot',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'General freestyle, good all-around response',
  },
  { value: 'aggressive', label: 'Aggressive', description: 'Racing, maximum snap, fast tracking' },
];

function FlightStyleSelector({
  value,
  onChange,
}: {
  value: FlightStyle;
  onChange: (style: FlightStyle) => void;
}) {
  return (
    <div className="wizard-form-group">
      <label>Flying Style</label>
      <div className="flight-style-options">
        {FLIGHT_STYLE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`flight-style-option${value === opt.value ? ' selected' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            <div className="flight-style-option-name">
              {opt.label}
              {opt.value === 'balanced' ? ' (default)' : ''}
            </div>
            <div className="flight-style-option-desc">{opt.description}</div>
          </button>
        ))}
      </div>
      <div className="flight-style-note">
        This affects how PID tuning thresholds are calibrated for your flying preference.
      </div>
    </div>
  );
}

// Basic info step
function BasicStep({
  name,
  size,
  propSize,
  battery,
  weight,
  motorKV,
  notes,
  flightStyle,
  onNameChange,
  onSizeChange,
  onPropSizeChange,
  onBatteryChange,
  onWeightChange,
  onMotorKVChange,
  onNotesChange,
  onFlightStyleChange,
  onBack,
  onContinue,
  canContinue,
}: {
  name: string;
  size: DroneSize;
  propSize: string;
  battery: BatteryType;
  weight: number;
  motorKV: number;
  notes: string;
  flightStyle: FlightStyle;
  onNameChange: (value: string) => void;
  onSizeChange: (value: DroneSize) => void;
  onPropSizeChange: (value: string) => void;
  onBatteryChange: (value: BatteryType) => void;
  onWeightChange: (value: number) => void;
  onMotorKVChange: (value: number) => void;
  onNotesChange: (value: string) => void;
  onFlightStyleChange: (value: FlightStyle) => void;
  onBack: () => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  const sizes: DroneSize[] = ['1"', '2"', '2.5"', '3"', '4"', '5"', '6"', '7"', '10"'];
  const batteries: BatteryType[] = ['1S', '2S', '3S', '4S', '6S'];

  return (
    <div>
      <div className="wizard-form-group">
        <label>
          Profile Name <span className="required">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g., My 5 inch freestyle"
        />
      </div>

      <div className="wizard-form-grid">
        <div className="wizard-form-group">
          <label>
            Drone Size <span className="required">*</span>
          </label>
          <select value={size} onChange={(e) => onSizeChange(e.target.value as DroneSize)}>
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="wizard-form-group">
          <label>Prop Size</label>
          <input
            type="text"
            value={propSize}
            onChange={(e) => onPropSizeChange(e.target.value)}
            placeholder='e.g., 5.1"'
          />
        </div>
      </div>

      <div className="wizard-form-grid">
        <div className="wizard-form-group">
          <label>
            Battery <span className="required">*</span>
          </label>
          <select value={battery} onChange={(e) => onBatteryChange(e.target.value as BatteryType)}>
            {batteries.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        <div className="wizard-form-group">
          <label>Weight (grams)</label>
          <input
            type="number"
            value={weight}
            onChange={(e) => onWeightChange(parseInt(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="wizard-form-group">
        <label>Motor KV</label>
        <input
          type="number"
          value={motorKV}
          onChange={(e) => onMotorKVChange(parseInt(e.target.value) || 0)}
          placeholder="e.g., 2400"
        />
      </div>

      <FlightStyleSelector value={flightStyle} onChange={onFlightStyleChange} />

      <div className="wizard-form-group">
        <label>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Any additional information about this drone..."
          rows={3}
        />
      </div>

      <div className="wizard-actions">
        <button onClick={onBack} className="wizard-btn wizard-btn-secondary">
          Back
        </button>
        <button
          onClick={onContinue}
          disabled={!canContinue}
          className="wizard-btn wizard-btn-primary"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// Review step
const FLIGHT_STYLE_LABELS: Record<FlightStyle, string> = {
  smooth: 'Smooth',
  balanced: 'Balanced',
  aggressive: 'Aggressive',
};

function ReviewStep({
  method,
  presetId,
  presetCustomName,
  name,
  size,
  propSize,
  battery,
  weight,
  motorKV,
  notes,
  flightStyle,
  onBack,
  onCreate,
}: {
  method: CreationMethod;
  presetId: string | null;
  presetCustomName: string;
  name: string;
  size: DroneSize;
  propSize: string;
  battery: BatteryType;
  weight: number;
  motorKV: number;
  notes: string;
  flightStyle: FlightStyle;
  onBack: () => void;
  onCreate: () => void;
}) {
  const preset = presetId ? PRESET_PROFILES[presetId as keyof typeof PRESET_PROFILES] : null;
  const displayName = method === 'preset' ? presetCustomName || preset?.name || '' : name;

  return (
    <div>
      <div className="review-section">
        {method === 'preset' && (
          <div className="review-row">
            <div className="review-label">Source</div>
            <div className="review-value">Preset: {preset?.name}</div>
          </div>
        )}

        <div className="review-row">
          <div className="review-label">Name</div>
          <div className="review-value">{displayName}</div>
        </div>

        <div className="review-row">
          <div className="review-label">Size</div>
          <div className="review-value">{method === 'preset' ? preset?.size : size}</div>
        </div>

        <div className="review-row">
          <div className="review-label">Prop Size</div>
          <div className="review-value">{method === 'preset' ? preset?.propSize : propSize}</div>
        </div>

        <div className="review-row">
          <div className="review-label">Battery</div>
          <div className="review-value">{method === 'preset' ? preset?.battery : battery}</div>
        </div>

        <div className="review-row">
          <div className="review-label">Weight</div>
          <div className="review-value">{method === 'preset' ? preset?.weight : weight}g</div>
        </div>

        <div className="review-row">
          <div className="review-label">Motor KV</div>
          <div className="review-value">{method === 'preset' ? preset?.motorKV : motorKV}</div>
        </div>

        <div className="review-row">
          <div className="review-label">Flying Style</div>
          <div className="review-value">{FLIGHT_STYLE_LABELS[flightStyle]}</div>
        </div>

        {notes && (
          <div className="review-row">
            <div className="review-label">Notes</div>
            <div className="review-value">{notes}</div>
          </div>
        )}
      </div>

      <div className="wizard-actions">
        <button onClick={onBack} className="wizard-btn wizard-btn-secondary">
          Back
        </button>
        <button onClick={onCreate} className="wizard-btn wizard-btn-success">
          Create Profile
        </button>
      </div>
    </div>
  );
}
