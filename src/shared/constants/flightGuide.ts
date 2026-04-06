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
      'Hover steadily at mid-throttle. Stay as still as possible — this captures your baseline noise floor, which the app uses to set filter cutoff frequencies.',
  },
  {
    title: 'Throttle Sweep',
    duration: '2–3 times',
    description:
      'Slowly push throttle from hover to full power while counting to 8, then smoothly reduce back while counting to 8. Repeat 2–3 times. This reveals how noise shifts with motor RPM — essential for dynamic filter tuning.',
  },
  {
    title: 'Final Hover',
    duration: '5–10 sec',
    description: 'Hover again to capture additional low-throttle data for comparison.',
  },
  {
    title: 'Land',
    duration: '',
    description: 'Done! Total flight: 30–45 seconds.',
  },
];

export const FILTER_FLIGHT_TIPS: string[] = [
  'Check props for damage before flying — a chipped prop creates false noise peaks that ruin filter tuning',
  'Fly in calm weather — wind adds unwanted noise to the data',
  'Stay at 2–5 meters altitude',
  'If you struggle to hover steadily in Acro, use Angle or Horizon mode — stable hover matters more than flight mode',
  'Throttle sweeps should be slow and smooth — count to 8 on the way up, 8 on the way down',
  'Make sure Blackbox logging is enabled with 2 kHz rate',
  'Set debug_mode = GYRO_SCALED in Betaflight for best results (BF 4.3–4.5 only; not needed on 2025.12+)',
  'After landing, check motor temperatures — if too hot to touch, do not reduce filters further',
];

// ---- PID Flight Guide (stick snaps) ----

export const PID_FLIGHT_PHASES: FlightPhase[] = [
  {
    title: 'Take off & Hover',
    duration: '5 sec',
    description: 'Brief hover to stabilize. The app needs a calm baseline before your first snap.',
  },
  {
    title: 'Roll Snaps',
    duration: '4–6 times',
    description:
      'Flick the roll stick sharply to ~75% deflection, hold for about half a second, then snap back to center. Wait 1–2 seconds at center before the next snap — this pause is critical for measuring how quickly the quad settles. Alternate left and right.',
  },
  {
    title: 'Pitch Snaps',
    duration: '4–6 times',
    description:
      'Same technique on pitch — sharp flick forward or back to ~75%, hold half a second, snap to center, wait 1–2 seconds. Alternate directions. Mix in a couple of full-stick snaps for linearity coverage.',
  },
  {
    title: 'Yaw Snaps',
    duration: '3–5 times',
    description:
      'Quick yaw flicks left and right. Yaw responds slower than roll/pitch, so hold each snap for about 1 second and wait 2–3 seconds between snaps.',
  },
  {
    title: 'Land',
    duration: '',
    description: 'Done! Total flight: 20–40 seconds.',
  },
];

export const PID_FLIGHT_TIPS: string[] = [
  'Check props for damage before flying — imbalanced props create vibrations that mask the real step response',
  'Fly in calm weather — wind makes step response data noisy',
  'Stay at 2–5 meters altitude',
  'The pause at center between snaps is critical — the app measures overshoot and settling time during this window',
  'Mix half-stick and full-stick snaps — different amplitudes test how linear your PID response is',
  "Don't do flips or rolls, just snaps — continuous rotation makes step detection unreliable",
  'Use your normal rate profile (min 300 deg/s recommended)',
  'Make sure Blackbox logging is enabled with 2 kHz rate',
  'If your FC has multiple PID profiles, select the one you want to tune before starting',
  'After landing, check motor temperatures',
];

// ---- Flash Tune Flight Guide (any normal flight) ----

export const QUICK_FLIGHT_PHASES: FlightPhase[] = [
  {
    title: 'Rip a Pack',
    duration: '1 flight',
    description:
      'Just fly. Freestyle, race, cruise — whatever you normally do. No special maneuvers needed. The app uses frequency-domain analysis to extract tuning data from any flight style. The more varied your throttle and stick inputs, the better the data.',
  },
  {
    title: 'Land & Plug In',
    duration: '',
    description: 'Done! Connect via USB and let FPVPIDlab do the rest.',
  },
];

export const QUICK_FLIGHT_TIPS: string[] = [
  'Check props for damage before flying — damaged props distort both noise and PID data',
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
      'Hover steadily at mid-throttle. Same as the filter flight — the app needs matching conditions to compare noise before and after your tune.',
  },
  {
    title: 'Throttle Sweep',
    duration: '2–3 times',
    description:
      'Slowly sweep throttle from hover to full power and back (count to 8 each way). This lets the app compare noise across the RPM range before and after tuning.',
  },
  {
    title: 'Final Hover',
    duration: '10 sec',
    description: 'Hold a steady hover for additional low-throttle comparison data.',
  },
  {
    title: 'Land',
    duration: '',
    description: 'Done! Total flight: 30–60 seconds. Reconnect and download the log.',
  },
];

export const VERIFICATION_FLIGHT_TIPS: string[] = [
  'Check props for damage before flying — changed props between flights invalidate the comparison',
  'Hover + throttle sweeps — same as a filter test flight',
  'Stay at the same altitude (2–5 meters) for comparable data',
  'Keep movements gentle — this is a noise measurement, not acro',
  'After downloading, the app overlays before/after spectra automatically',
  'Verification is required to score your tune quality',
];

// ---- Filter Verification Guide (throttle sweep to compare spectrogram before/after) ----

export const FILTER_VERIFICATION_FLIGHT_PHASES: FlightPhase[] = [
  {
    title: 'Take off & Hover',
    duration: '10–15 sec',
    description:
      'Hover steadily at mid-throttle. Match the same conditions as your filter analysis flight so the spectrogram comparison is accurate.',
  },
  {
    title: 'Throttle Sweep',
    duration: '2–3 times',
    description:
      'Slowly sweep throttle from hover to full power and back (count to 8 each way). Same pattern as before — this allows direct before/after spectrogram comparison.',
  },
  {
    title: 'Final Hover',
    duration: '5–10 sec',
    description: 'Hold a steady hover for additional low-throttle data.',
  },
  {
    title: 'Land',
    duration: '',
    description: 'Done! Total flight: 30–45 seconds. Reconnect and download the log.',
  },
];

export const FILTER_VERIFICATION_FLIGHT_TIPS: string[] = [
  'Check props for damage before flying — changed props between flights invalidate the comparison',
  'Fly the same throttle sweep pattern as the original filter flight',
  'Stay at the same altitude (2–5 meters) for comparable data',
  'Keep movements gentle — this is a noise measurement, not acro',
  'After downloading, the app shows side-by-side spectrogram comparison',
  'If noise reduced, consider starting PID Tune next',
];

// ---- PID Verification Guide (stick snaps to compare step response before/after) ----

export const PID_VERIFICATION_FLIGHT_PHASES: FlightPhase[] = [
  {
    title: 'Take off & Hover',
    duration: '5 sec',
    description: 'Brief hover to stabilize before starting snaps.',
  },
  {
    title: 'Roll Snaps',
    duration: '4–6 times',
    description:
      'Same technique as your PID analysis flight — sharp flick to ~75%, hold half a second, snap to center, wait 1–2 seconds. The app compares overshoot and settling time before vs after.',
  },
  {
    title: 'Pitch Snaps',
    duration: '4–6 times',
    description:
      'Same with pitch — flick, hold, center, pause. Mix in full-stick snaps for consistency with the analysis flight.',
  },
  {
    title: 'Yaw Snaps',
    duration: '3–5 times',
    description:
      'Quick yaw flicks left and right. Hold each snap ~1 second, wait 2–3 seconds between.',
  },
  {
    title: 'Land',
    duration: '',
    description: 'Done! Total flight: 20–40 seconds. Reconnect and download the log.',
  },
];

export const PID_VERIFICATION_FLIGHT_TIPS: string[] = [
  'Check props for damage before flying — changed props between flights invalidate the comparison',
  'Fly the same stick snap pattern as the original PID flight',
  'Mix half-stick and full-stick snaps for consistent comparison',
  'Stay at 2–5 meters altitude',
  'After downloading, the app compares overshoot, rise time, and settling time',
  'If step response improved, your PIDs are dialed in',
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
  'Check props for damage before flying — changed props between flights invalidate the comparison',
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
      'Hover steadily at mid-throttle. Stay as still as possible — this captures your baseline noise floor for filter tuning.',
  },
  {
    title: 'Roll Snaps',
    duration: '4–6 times',
    description:
      'Sharp flick to ~75% deflection, hold half a second, snap to center, wait 1–2 seconds. Alternate left and right.',
  },
  {
    title: 'Pitch Snaps',
    duration: '4–6 times',
    description:
      'Same technique on pitch — flick, hold, center, pause. Mix in full-stick snaps for linearity coverage.',
  },
  {
    title: 'Yaw Snaps',
    duration: '3–5 times',
    description: 'Quick yaw flicks left and right. Hold ~1 second, wait 2–3 seconds between snaps.',
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
  'Check props for damage before flying — imbalanced props distort both noise and step response data',
  'Fly in calm weather — wind makes data noisy',
  'Stay at 2–5 meters altitude',
  "Don't do flips or rolls, just snaps — the pause at center is where the app measures settling",
  'One pack = one test flight is enough',
  'Make sure Blackbox logging is enabled before you fly',
];

// ---- Tuning Workflow (Filter + PID Tune step labels) ----

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
    title: 'Verification flight',
    description:
      'Erase flash, fly a verification flight (same pattern as the analysis flight). Reconnect, download the log, and click Analyze. The app compares before/after data to score your tune quality.',
  },
];
