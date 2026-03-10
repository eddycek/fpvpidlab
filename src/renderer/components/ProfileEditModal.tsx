import { useState } from 'react';
import type {
  DroneProfile,
  DroneSize,
  BatteryType,
  FlightStyle,
  ProfileUpdateInput,
} from '@shared/types/profile.types';
import './ProfileWizard.css';

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

interface ProfileEditModalProps {
  profile: DroneProfile;
  onSave: (input: ProfileUpdateInput) => Promise<void>;
  onCancel: () => void;
}

export function ProfileEditModal({ profile, onSave, onCancel }: ProfileEditModalProps) {
  const [name, setName] = useState(profile.name);
  const [size, setSize] = useState(profile.size);
  const [propSize, setPropSize] = useState(profile.propSize || '');
  const [battery, setBattery] = useState(profile.battery);
  const [weight, setWeight] = useState(profile.weight || 0);
  const [motorKV, setMotorKV] = useState(profile.motorKV || 0);
  const [notes, setNotes] = useState(profile.notes || '');
  const [flightStyle, setFlightStyle] = useState<FlightStyle>(profile.flightStyle ?? 'balanced');
  const [isSaving, setIsSaving] = useState(false);

  const sizes: DroneSize[] = ['1"', '2"', '2.5"', '3"', '4"', '5"', '6"', '7"', '10"'];
  const batteries: BatteryType[] = ['1S', '2S', '3S', '4S', '6S'];

  const canSave = name.trim().length > 0;

  const handleSave = async () => {
    if (!canSave || isSaving) return;

    setIsSaving(true);
    try {
      const input: ProfileUpdateInput = {
        name,
        size,
        propSize: propSize || undefined,
        battery,
        weight: weight || undefined,
        motorKV: motorKV || undefined,
        notes: notes || undefined,
        flightStyle,
      };
      await onSave(input);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="profile-wizard-overlay">
      <div className="profile-wizard-modal">
        <div className="profile-wizard-header">
          <h2>Edit Profile</h2>
          <p>Update drone configuration for {profile.fcInfo.boardName || 'Unknown'}</p>
        </div>

        <div className="wizard-form-group">
          <label>
            Profile Name <span className="required">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., My 5 inch freestyle"
          />
        </div>

        <div className="wizard-form-grid">
          <div className="wizard-form-group">
            <label>
              Drone Size <span className="required">*</span>
            </label>
            <select value={size} onChange={(e) => setSize(e.target.value as DroneSize)}>
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
              onChange={(e) => setPropSize(e.target.value)}
              placeholder='e.g., 5.1"'
            />
          </div>
        </div>

        <div className="wizard-form-grid">
          <div className="wizard-form-group">
            <label>
              Battery <span className="required">*</span>
            </label>
            <select value={battery} onChange={(e) => setBattery(e.target.value as BatteryType)}>
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
              onChange={(e) => setWeight(parseInt(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="wizard-form-group">
          <label>Motor KV</label>
          <input
            type="number"
            value={motorKV}
            onChange={(e) => setMotorKV(parseInt(e.target.value) || 0)}
            placeholder="e.g., 2400"
          />
        </div>

        <div className="wizard-form-group">
          <label>Flying Style</label>
          <div className="flight-style-options">
            {FLIGHT_STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`flight-style-option${flightStyle === opt.value ? ' selected' : ''}`}
                onClick={() => setFlightStyle(opt.value)}
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

        <div className="wizard-form-group">
          <label>Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional information about this drone..."
            rows={3}
          />
        </div>

        <div className="wizard-actions">
          <button
            onClick={onCancel}
            disabled={isSaving}
            className="wizard-btn wizard-btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || isSaving}
            className="wizard-btn wizard-btn-success"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
