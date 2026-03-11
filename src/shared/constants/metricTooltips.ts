/**
 * Centralized tooltip strings for analysis metrics and chart descriptions.
 */

// -- Chart descriptions (shown below chart titles) --

export const CHART_DESCRIPTIONS = {
  noiseSpectrum:
    'Frequency spectrum of gyro noise. Peaks indicate vibration sources — motor harmonics, frame resonance, or electrical noise. A flat, low spectrum means a clean build.',
  throttleSpectrogram:
    'Noise spectrum across throttle levels. Bright spots indicate noise that changes with throttle — typically motor harmonics. Dark/uniform areas mean clean noise.',
  stepResponse:
    'How the quad responds to stick inputs. The dashed line is the commanded rate (setpoint), the colored line is the actual gyro. Ideally, gyro follows setpoint quickly with minimal overshoot.',
  tfStepResponse:
    'Synthetic step response derived from the transfer function (Wiener deconvolution). Shows how the PID loop tracks a step input on each axis.',
  bodePlot:
    'Frequency response of the PID loop (magnitude and phase). Shows bandwidth, gain margin, and phase margin — key indicators of loop stability.',
  noiseComparison:
    'Before/after noise spectrum overlay. Compares gyro noise from the analysis flight vs. the verification flight to show the effect of filter changes.',
  spectrogramComparison:
    'Side-by-side throttle spectrogram before and after filter changes. Shows whether noise improved across throttle ranges.',
  stepResponseComparison:
    'Before/after step response comparison. Shows how PID changes affected overshoot, rise time, and settling time.',
} as const;

// -- Metric tooltips (shown on hover over metric values) --

export const METRIC_TOOLTIPS = {
  noiseFloor:
    'Average noise power across all frequencies. Lower is better — indicates less vibration reaching the gyro.',
  peakFrequency:
    'Frequency where noise is strongest. Helps identify the vibration source (motor, frame, electrical).',
  overshoot:
    'How much the gyro exceeds the target after a stick input. 0% = perfect tracking, >20% = oscillation risk.',
  riseTime:
    'Time for gyro to reach the target value after a stick input. Lower = snappier response. Too low may cause overshoot.',
  settlingTime:
    'Time until gyro stays within 5% of the target. Lower = less wobble after stick inputs.',
  latency:
    'Delay between stick input and gyro response start. Affected by filters and PID loop rate.',
  stepsDetected:
    'Number of distinct stick input events found in flight data. More steps = more reliable metrics.',
  bandwidth:
    'Frequency range where the PID loop can effectively track inputs. Higher = more responsive, but too high causes noise amplification.',
  phaseMargin:
    'How far the system is from instability. >45\u00B0 is safe, <30\u00B0 risks oscillation.',
  dcGain:
    'Low-frequency tracking accuracy. 0 dB = perfect I-term tracking. Negative values mean steady-state error.',
  noiseLevel: 'Overall noise classification based on average noise floor across all axes.',
  dataQuality:
    'Rating of flight data suitability for analysis. Based on segment count, flight time, throttle coverage, and step quality.',
  qualityScore:
    'Composite tuning quality score (0-100). Combines noise floor, overshoot, settling time, and other metrics.',
  groupDelay:
    'Total filter processing delay. Higher delay means more latency between stick input and motor response.',
  ringing:
    'Post-step oscillation count. High ringing suggests D-term is too low or filters are too aggressive.',
  steadyStateError:
    'Tracking error after the response settles. Non-zero values suggest I-term needs adjustment.',
} as const;
