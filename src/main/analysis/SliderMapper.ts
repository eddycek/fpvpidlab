/**
 * Slider-aligned PID recommendation mapper.
 *
 * Maps raw PID gains to Betaflight Configurator slider positions (master multiplier,
 * PD ratio, PD balance, I-term relax). This helps users who prefer slider-based
 * tuning to understand recommendations in terms of Configurator UI controls.
 *
 * BF Configurator slider system (BF 4.3+):
 * - Master multiplier: scales all PIDs proportionally (0.5x – 2.5x)
 * - PD ratio: ratio between P and D (0.6 – 2.0)
 * - Response: how sharp the quad responds (moves P+D together)
 *
 * Reference values are BF 4.4 defaults:
 *   Roll: P=45, I=80, D=30
 *   Pitch: P=47, I=84, D=32
 *   Yaw: P=45, I=80, D=0
 */

// ---- BF 4.4 Reference PIDs (Slider neutral position = 1.0x) ----

export const BF_REFERENCE_PIDS = {
  roll: { P: 45, I: 80, D: 30 },
  pitch: { P: 47, I: 84, D: 32 },
  yaw: { P: 45, I: 80, D: 0 },
} as const;

// ---- Types ----

export interface SliderPosition {
  /** Master multiplier (1.0 = BF defaults) */
  masterMultiplier: number;
  /** P/D ratio relative to defaults (1.0 = default balance) */
  pdRatio: number;
  /** Per-axis slider summary */
  axes: {
    roll: AxisSliderPosition;
    pitch: AxisSliderPosition;
    yaw: AxisSliderPosition;
  };
  /** Human-readable summary of the slider adjustment */
  summary: string;
}

export interface AxisSliderPosition {
  /** P multiplier relative to BF default */
  pMultiplier: number;
  /** I multiplier relative to BF default */
  iMultiplier: number;
  /** D multiplier relative to BF default */
  dMultiplier: number;
}

// ---- Implementation ----

/**
 * Map PID gains to slider positions relative to BF 4.4 defaults.
 *
 * @param pids - Actual PID gains per axis
 * @returns Slider positions with summary
 */
export function mapToSliders(pids: {
  roll: { P: number; I: number; D: number };
  pitch: { P: number; I: number; D: number };
  yaw: { P: number; I: number; D: number };
}): SliderPosition {
  const rollP = pids.roll.P / BF_REFERENCE_PIDS.roll.P;
  const pitchP = pids.pitch.P / BF_REFERENCE_PIDS.pitch.P;
  const rollD = BF_REFERENCE_PIDS.roll.D > 0 ? pids.roll.D / BF_REFERENCE_PIDS.roll.D : 1;
  const pitchD = BF_REFERENCE_PIDS.pitch.D > 0 ? pids.pitch.D / BF_REFERENCE_PIDS.pitch.D : 1;

  // Master multiplier: average of P multipliers across roll+pitch
  const masterMultiplier = round2((rollP + pitchP) / 2);

  // PD ratio: average D/P ratio relative to default D/P ratio
  const defaultDPRoll = BF_REFERENCE_PIDS.roll.D / BF_REFERENCE_PIDS.roll.P;
  const defaultDPPitch = BF_REFERENCE_PIDS.pitch.D / BF_REFERENCE_PIDS.pitch.P;
  const actualDPRoll = pids.roll.D / Math.max(pids.roll.P, 1);
  const actualDPPitch = pids.pitch.D / Math.max(pids.pitch.P, 1);
  const pdRatioRoll = actualDPRoll / defaultDPRoll;
  const pdRatioPitch = actualDPPitch / defaultDPPitch;
  const pdRatio = round2((pdRatioRoll + pdRatioPitch) / 2);

  const axes = {
    roll: {
      pMultiplier: round2(rollP),
      iMultiplier: round2(pids.roll.I / BF_REFERENCE_PIDS.roll.I),
      dMultiplier: round2(rollD),
    },
    pitch: {
      pMultiplier: round2(pitchP),
      iMultiplier: round2(pids.pitch.I / BF_REFERENCE_PIDS.pitch.I),
      dMultiplier: round2(pitchD),
    },
    yaw: {
      pMultiplier: round2(pids.yaw.P / BF_REFERENCE_PIDS.yaw.P),
      iMultiplier: round2(pids.yaw.I / BF_REFERENCE_PIDS.yaw.I),
      dMultiplier: 1, // Yaw D is typically 0
    },
  };

  const summary = generateSliderSummary(masterMultiplier, pdRatio);

  return { masterMultiplier, pdRatio, axes, summary };
}

/**
 * Compute the slider change between current and recommended PIDs.
 */
export function computeSliderDelta(
  current: {
    roll: { P: number; I: number; D: number };
    pitch: { P: number; I: number; D: number };
    yaw: { P: number; I: number; D: number };
  },
  recommended: {
    roll: { P: number; I: number; D: number };
    pitch: { P: number; I: number; D: number };
    yaw: { P: number; I: number; D: number };
  }
): {
  masterMultiplierDelta: number;
  pdRatioDelta: number;
  summary: string;
} {
  const currentSliders = mapToSliders(current);
  const recSliders = mapToSliders(recommended);

  const masterMultiplierDelta = round2(
    recSliders.masterMultiplier - currentSliders.masterMultiplier
  );
  const pdRatioDelta = round2(recSliders.pdRatio - currentSliders.pdRatio);

  const parts: string[] = [];

  if (Math.abs(masterMultiplierDelta) >= 0.05) {
    const dir = masterMultiplierDelta > 0 ? 'up' : 'down';
    parts.push(`Master multiplier ${dir} ${Math.abs(masterMultiplierDelta).toFixed(2)}x`);
  }

  if (Math.abs(pdRatioDelta) >= 0.05) {
    const dir = pdRatioDelta > 0 ? 'more D-heavy' : 'more P-heavy';
    parts.push(`PD balance shifts ${dir} by ${Math.abs(pdRatioDelta).toFixed(2)}`);
  }

  const summary =
    parts.length > 0
      ? `In Configurator sliders: ${parts.join(', ')}.`
      : 'No significant slider change — individual axis fine-tuning only.';

  return { masterMultiplierDelta, pdRatioDelta, summary };
}

function generateSliderSummary(master: number, pdRatio: number): string {
  const parts: string[] = [];

  if (master > 1.1) {
    parts.push(`PIDs are ${((master - 1) * 100).toFixed(0)}% above BF defaults`);
  } else if (master < 0.9) {
    parts.push(`PIDs are ${((1 - master) * 100).toFixed(0)}% below BF defaults`);
  } else {
    parts.push('PIDs are near BF defaults');
  }

  if (pdRatio > 1.15) {
    parts.push('D-heavy balance (more damping)');
  } else if (pdRatio < 0.85) {
    parts.push('P-heavy balance (more responsive)');
  } else {
    parts.push('balanced PD ratio');
  }

  return parts.join(', ') + '.';
}

/**
 * Build a recommended PID configuration by applying PID recommendations to current PIDs.
 *
 * Matches setting names like "pid_roll_p", "pid_pitch_d", "pid_yaw_i" to axis+term.
 */
export function buildRecommendedPIDs(
  current: {
    roll: { P: number; I: number; D: number };
    pitch: { P: number; I: number; D: number };
    yaw: { P: number; I: number; D: number };
  },
  recommendations: ReadonlyArray<{ setting: string; recommendedValue: number }>
): {
  roll: { P: number; I: number; D: number };
  pitch: { P: number; I: number; D: number };
  yaw: { P: number; I: number; D: number };
} {
  const result = {
    roll: { ...current.roll },
    pitch: { ...current.pitch },
    yaw: { ...current.yaw },
  };

  const axisMap: Record<string, 'roll' | 'pitch' | 'yaw'> = {
    roll: 'roll',
    pitch: 'pitch',
    yaw: 'yaw',
  };

  const termMap: Record<string, 'P' | 'I' | 'D'> = {
    p: 'P',
    i: 'I',
    d: 'D',
  };

  for (const rec of recommendations) {
    // Match "pid_<axis>_<term>" pattern
    const match = rec.setting.match(/^pid_(\w+)_([pid])$/i);
    if (!match) continue;

    const axis = axisMap[match[1].toLowerCase()];
    const term = termMap[match[2].toLowerCase()];
    if (axis && term) {
      result[axis][term] = rec.recommendedValue;
    }
  }

  return result;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
