/**
 * Shared data for flight guide and tuning workflow.
 * Used by TestFlightGuideStep (wizard) and TuningWorkflowModal (homepage help).
 */

export interface FlightPhase {
  title: string;
  duration: string;
  description: string;
}

export interface WorkflowStep {
  title: string;
  description: string;
}

// ---- Filter Flight Guide (hover + throttle sweeps) ----

export const FILTER_FLIGHT_PHASES: FlightPhase[] = [
  {
    title: 'Take off & Hover',
    duration: '10–15 sec',
    description:
      'Hover steadily at mid-throttle. Stay as still as possible. This gives clean baseline noise data.',
  },
  {
    title: 'Throttle Sweep',
    duration: '2–3 times',
    description:
      'Slowly increase throttle from hover to full power over 5–10 seconds, then reduce back. Repeat 2–3 times. This reveals how noise changes with motor speed.',
  },
  {
    title: 'Final Hover',
    duration: '5–10 sec',
    description: 'Hover again for additional data.',
  },
  {
    title: 'Land',
    duration: '',
    description: 'Done! Total flight: 30–45 seconds.',
  },
];

export const FILTER_FLIGHT_TIPS: string[] = [
  'Fly in calm weather — wind adds unwanted noise to the data',
  'Stay at 2–5 meters altitude',
  'Keep the drone as still as possible during hover phases',
  'Throttle sweeps should be slow and smooth — no jerky movements',
  'Make sure Blackbox logging is enabled with 2 kHz rate',
  'Set debug_mode = GYRO_SCALED in Betaflight for best results (BF 4.3–4.5 only; not needed on 2025.12+)',
  'After landing, check motor temperatures — if too hot to touch, do not reduce filters further',
];

// ---- PID Flight Guide (stick snaps) ----

export const PID_FLIGHT_PHASES: FlightPhase[] = [
  {
    title: 'Take off & Hover',
    duration: '5 sec',
    description: 'Brief hover to stabilize before starting snaps.',
  },
  {
    title: 'Roll Snaps',
    duration: '5–8 times',
    description:
      'Quick, sharp roll inputs — mix half-stick and full-stick. Stick left, center, right, center. Pause briefly between each.',
  },
  {
    title: 'Pitch Snaps',
    duration: '5–8 times',
    description:
      'Same with pitch — forward, center, back, center. Quick and decisive. Mix intensities.',
  },
  {
    title: 'Yaw Snaps',
    duration: '3–5 times',
    description: 'Quick yaw movements left and right with brief pauses.',
  },
  {
    title: 'Land',
    duration: '',
    description: 'Done! Total flight: 20–40 seconds.',
  },
];

export const PID_FLIGHT_TIPS: string[] = [
  'Fly in calm weather — wind makes step response data noisy',
  'Stay at 2–5 meters altitude',
  'Mix half-stick and full-stick snaps for better coverage',
  "Don't do flips or rolls, just snaps",
  'Use your normal rate profile (min 300 deg/s recommended)',
  'Make sure Blackbox logging is enabled with 2 kHz rate',
  'After landing, check motor temperatures',
];

// ---- Flash Tune Flight Guide (any normal flight) ----

export const QUICK_FLIGHT_PHASES: FlightPhase[] = [
  {
    title: 'Rip a Pack',
    duration: '1 flight',
    description:
      'Just fly. Freestyle, race, cruise — whatever you normally do. No special maneuvers needed. The more varied your throttle and stick inputs, the better the data.',
  },
  {
    title: 'Land & Plug In',
    duration: '',
    description: 'Done! Connect via USB and let PIDlab do the rest.',
  },
];

export const QUICK_FLIGHT_TIPS: string[] = [
  'Any flight style works — freestyle, racing, cruising, even a hover',
  'Longer flights give more data, but even 30 seconds is enough',
  'Varying throttle (punch-outs, dives) helps filter analysis',
  'Sharp stick movements (rolls, flips) help PID analysis',
  'Make sure Blackbox logging is enabled with 2 kHz rate',
  'Calm weather gives cleaner data, but windy sessions still work',
];

// ---- Verification Hover Guide (post-tuning noise check) ----

export const VERIFICATION_FLIGHT_PHASES: FlightPhase[] = [
  {
    title: 'Take off & Hover',
    duration: '15–20 sec',
    description:
      'Hover steadily at mid-throttle. Same as the filter flight — stay as still as possible to capture clean noise data.',
  },
  {
    title: 'Throttle Sweep',
    duration: '2–3 times',
    description:
      'Slowly sweep throttle from hover to full power and back. This lets the app compare noise across the RPM range before and after tuning.',
  },
  {
    title: 'Final Hover',
    duration: '10 sec',
    description: 'Hold a steady hover for additional data.',
  },
  {
    title: 'Land',
    duration: '',
    description: 'Done! Total flight: 30–60 seconds. Reconnect and download the log.',
  },
];

export const VERIFICATION_FLIGHT_TIPS: string[] = [
  'Hover + throttle sweeps — same as a filter test flight',
  'Stay at the same altitude (2–5 meters) for comparable data',
  'Keep movements gentle — this is a noise measurement, not acro',
  'After downloading, the app overlays before/after spectra automatically',
  'If noise improved, you are done. If not, consider another tuning cycle',
];

// ---- Flash Tune Verification Guide (normal flight to compare filters + PIDs) ----

export const FLASH_VERIFICATION_FLIGHT_PHASES: FlightPhase[] = [
  {
    title: 'Rip a Pack',
    duration: '1 flight',
    description:
      'Fly normally — same style as your original Flash Tune flight. The app compares noise and PID performance before and after tuning.',
  },
  {
    title: 'Land & Plug In',
    duration: '',
    description:
      'Done! Connect via USB and download the log. The app shows before/after comparison.',
  },
];

export const FLASH_VERIFICATION_FLIGHT_TIPS: string[] = [
  'Fly the same style as your original Flash Tune flight for comparable data',
  'Any flight works — freestyle, racing, cruising',
  'Longer flights give more accurate comparison data',
  'After downloading, the app compares noise and overshoot automatically',
  'If performance improved, you are done. If not, consider another tuning cycle',
];

// ---- Legacy Combined Guide (backward compatibility for mode='full') ----

export const FLIGHT_PHASES: FlightPhase[] = [
  {
    title: 'Take off & Hover',
    duration: '10–15 sec',
    description:
      'Hover steadily at mid-throttle. Stay as still as possible. This gives clean data for filter tuning.',
  },
  {
    title: 'Roll Snaps',
    duration: '3–5 times',
    description:
      'Quick, sharp roll inputs — stick fully left, center, fully right, center. Pause 1–2 sec between each.',
  },
  {
    title: 'Pitch Snaps',
    duration: '3–5 times',
    description: 'Same with pitch — forward, center, back, center. Quick and decisive.',
  },
  {
    title: 'Yaw Snaps',
    duration: '3–5 times',
    description: 'Quick yaw movements left and right with brief pauses.',
  },
  {
    title: 'Final Hover',
    duration: '5–10 sec',
    description: 'Hover again for additional filter data.',
  },
  {
    title: 'Land',
    duration: '',
    description: 'Done! Total flight time: 30–60 seconds.',
  },
];

export const FLIGHT_TIPS: string[] = [
  'Fly in calm weather — wind makes data noisy',
  'Stay at 2–5 meters altitude',
  "Don't do flips or rolls, just snaps",
  'One pack = one test flight is enough',
  'Make sure Blackbox logging is enabled before you fly',
];

// ---- Tuning Workflow (Deep Tune step labels) ----

export const TUNING_WORKFLOW: WorkflowStep[] = [
  { title: 'Connect your drone', description: 'Plug in via USB and wait for connection.' },
  {
    title: 'Create a backup',
    description: 'Save a snapshot of your current settings before making changes.',
  },
  {
    title: 'Check Blackbox setup',
    description:
      'Set logging rate to 2 kHz. On BF 4.3–4.5, also set debug_mode to GYRO_SCALED (not needed on 2025.12+).',
  },
  { title: 'Erase Blackbox data', description: 'Clear old logs for a clean recording.' },
  {
    title: 'Fly: Filter test flight',
    description: 'Hover + throttle sweeps (~30 sec). Follow the filter flight guide.',
  },
  {
    title: 'Analyze & apply filters',
    description: 'Download the log. Run the Filter Wizard. Apply changes.',
  },
  { title: 'Erase Blackbox data again', description: 'Clear the filter flight log.' },
  {
    title: 'Fly: PID test flight',
    description: 'Stick snaps on all axes (~30 sec). Follow the PID flight guide.',
  },
  {
    title: 'Analyze & apply PIDs',
    description: 'Download the log. Run the PID Wizard. Apply changes.',
  },
  {
    title: 'Optional: Verification hover',
    description:
      'Erase flash, fly a gentle 30–60 second hover with throttle sweeps (same as filter flight). Reconnect, download the log, and click Analyze. The app overlays before/after noise spectra so you can see the improvement. You can skip this step.',
  },
];
