/**
 * D-term effectiveness analyzer.
 *
 * Measures how effectively the D-term dampens oscillations by comparing
 * pidD energy to error energy (setpoint - gyro) in the 20-150 Hz band.
 */
import type { BlackboxFlightData } from '@shared/types/blackbox.types';
import type { DTermEffectiveness } from '@shared/types/analysis.types';
import { computePowerSpectrum, trimSpectrum } from './FFTCompute';
import { FFT_WINDOW_SIZE } from './constants';

/** Frequency band for D-term effectiveness analysis */
const DTERM_ANALYSIS_MIN_HZ = 20;
const DTERM_ANALYSIS_MAX_HZ = 150;

/**
 * Analyze D-term effectiveness across all axes.
 *
 * Returns undefined if pidD data is missing or too short for FFT.
 */
export function analyzeDTermEffectiveness(
  flightData: BlackboxFlightData
): DTermEffectiveness | undefined {
  if (!flightData.pidD || flightData.pidD.length < 3) return undefined;

  const axes: number[] = [];

  for (let axis = 0; axis < 3; axis++) {
    const pidDValues = flightData.pidD[axis].values;
    const gyroValues = flightData.gyro[axis].values;
    const setpointValues = flightData.setpoint[axis]?.values;

    if (pidDValues.length < FFT_WINDOW_SIZE || gyroValues.length < FFT_WINDOW_SIZE) {
      axes.push(0);
      continue;
    }

    // Compute error signal: setpoint - gyro
    const errorSignal = new Float64Array(gyroValues.length);
    for (let i = 0; i < gyroValues.length; i++) {
      errorSignal[i] = (setpointValues?.[i] ?? 0) - gyroValues[i];
    }

    // Compute power spectra via Welch's method
    const errorSpectrum = computePowerSpectrum(
      errorSignal,
      flightData.sampleRateHz,
      FFT_WINDOW_SIZE
    );
    const dTermSpectrum = computePowerSpectrum(
      pidDValues,
      flightData.sampleRateHz,
      FFT_WINDOW_SIZE
    );

    const errorTrimmed = trimSpectrum(errorSpectrum, DTERM_ANALYSIS_MIN_HZ, DTERM_ANALYSIS_MAX_HZ);
    const dTermTrimmed = trimSpectrum(dTermSpectrum, DTERM_ANALYSIS_MIN_HZ, DTERM_ANALYSIS_MAX_HZ);

    // Sum energy in band (convert dB to linear power)
    const errorEnergy = sumLinearEnergy(errorTrimmed.magnitudes);
    const dTermEnergy = sumLinearEnergy(dTermTrimmed.magnitudes);

    // Effectiveness ratio (clamped 0-1)
    const ratio = errorEnergy > 0 ? Math.min(1, dTermEnergy / errorEnergy) : 0;
    axes.push(ratio);
  }

  const [roll, pitch, yaw] = axes;
  const overall = (roll + pitch) / 2;

  return {
    roll,
    pitch,
    yaw,
    overall,
    dCritical: overall > 0.7,
  };
}

/** Sum linear power from dB magnitudes: Σ 10^(dB/10) */
function sumLinearEnergy(magnitudesDb: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < magnitudesDb.length; i++) {
    sum += Math.pow(10, magnitudesDb[i] / 10);
  }
  return sum;
}
