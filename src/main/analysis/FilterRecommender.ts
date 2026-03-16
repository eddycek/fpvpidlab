/**
 * Filter recommendation engine.
 *
 * Takes a noise profile and current filter settings, then applies rule-based
 * heuristics to generate tuning recommendations with beginner-friendly explanations.
 */
import type {
  NoiseProfile,
  FilterRecommendation,
  CurrentFilterSettings,
  NoisePeak,
} from '@shared/types/analysis.types';
import { DEFAULT_FILTER_SETTINGS } from '@shared/types/analysis.types';
import {
  GYRO_LPF1_MIN_HZ,
  GYRO_LPF1_MAX_HZ,
  DTERM_LPF1_MIN_HZ,
  DTERM_LPF1_MAX_HZ,
  GYRO_LPF1_MAX_HZ_RPM,
  DTERM_LPF1_MAX_HZ_RPM,
  DYN_NOTCH_COUNT_WITH_RPM,
  DYN_NOTCH_Q_WITH_RPM,
  NOISE_FLOOR_VERY_NOISY_DB,
  NOISE_FLOOR_VERY_CLEAN_DB,
  NOISE_TARGET_DEADZONE_HZ,
  RESONANCE_ACTION_THRESHOLD_DB,
  RESONANCE_CUTOFF_MARGIN_HZ,
  PROPWASH_GYRO_LPF1_FLOOR_HZ,
  PROPWASH_FLOOR_BYPASS_DB,
  GYRO_LPF2_DISABLE_THRESHOLD_DB,
} from './constants';

/** Detect whether RPM filter is active from settings */
export function isRpmFilterActive(settings: CurrentFilterSettings): boolean {
  return (settings.rpm_filter_harmonics ?? 0) > 0;
}

/**
 * Generate filter recommendations based on noise analysis.
 *
 * @param noise - Analyzed noise profile from NoiseAnalyzer
 * @param current - Current filter settings from FC (defaults to Betaflight 4.4 defaults)
 * @returns Array of recommendations, sorted by impact
 */
export function recommend(
  noise: NoiseProfile,
  current: CurrentFilterSettings = DEFAULT_FILTER_SETTINGS
): FilterRecommendation[] {
  const recommendations: FilterRecommendation[] = [];
  const rpmActive = isRpmFilterActive(current);

  // 1. Noise-floor-based lowpass adjustments
  recommendNoiseFloorAdjustments(noise, current, recommendations, rpmActive);

  // 2. Resonance-peak-based recommendations
  recommendResonanceFixes(noise, current, recommendations, rpmActive);

  // 3. Dynamic notch validation
  recommendDynamicNotchAdjustments(noise, current, recommendations);

  // 4. RPM-aware dynamic notch count/Q recommendations (conditional on resonance peaks)
  if (rpmActive) {
    recommendDynamicNotchForRPM(noise, current, recommendations);
  }

  // 5. LPF2 recommendations (disable when clean + RPM, enable when noisy)
  recommendLpf2Adjustments(noise, current, recommendations, rpmActive);

  // Deduplicate: if multiple rules recommend the same setting, keep the more aggressive one
  return deduplicateRecommendations(recommendations);
}

/**
 * Compute an absolute target cutoff from the noise floor dB level.
 * Linear interpolation: VERY_NOISY_DB → minHz, VERY_CLEAN_DB → maxHz.
 * Result is clamped to [minHz, maxHz] and rounded.
 */
export function computeNoiseBasedTarget(
  worstNoiseFloorDb: number,
  minHz: number,
  maxHz: number
): number {
  // Linear interpolation: noisyDb maps to minHz, cleanDb maps to maxHz
  const t =
    (worstNoiseFloorDb - NOISE_FLOOR_VERY_NOISY_DB) /
    (NOISE_FLOOR_VERY_CLEAN_DB - NOISE_FLOOR_VERY_NOISY_DB);
  const target = minHz + t * (maxHz - minHz);
  return Math.round(clamp(target, minHz, maxHz));
}

/**
 * Adjust lowpass filters based on overall noise level using absolute noise-based targets.
 * Targets depend only on the noise floor dB, NOT on current settings → convergent.
 * When RPM filter is active, wider safety bounds are used.
 */
function recommendNoiseFloorAdjustments(
  noise: NoiseProfile,
  current: CurrentFilterSettings,
  out: FilterRecommendation[],
  rpmActive: boolean
): void {
  const { overallLevel } = noise;

  // Skip gyro LPF noise-floor adjustment when gyro_lpf1 is disabled (0 = common in BF 4.4+ with RPM filter)
  const gyroLpfDisabled = current.gyro_lpf1_static_hz === 0;

  // Select bounds based on RPM filter state
  const gyroMaxHz = rpmActive ? GYRO_LPF1_MAX_HZ_RPM : GYRO_LPF1_MAX_HZ;
  const dtermMaxHz = rpmActive ? DTERM_LPF1_MAX_HZ_RPM : DTERM_LPF1_MAX_HZ;

  // Compute worst noise floor across roll and pitch (the critical axes).
  // Yaw is excluded: yaw noise is less critical for motor heating and flight feel,
  // and yaw gyro often picks up frame vibrations differently than roll/pitch.
  const worstFloor = Math.max(noise.roll.noiseFloorDb, noise.pitch.noiseFloorDb);

  // Compute absolute targets from noise data (independent of current settings)
  let targetGyroLpf1 = computeNoiseBasedTarget(worstFloor, GYRO_LPF1_MIN_HZ, gyroMaxHz);
  const targetDtermLpf1 = computeNoiseBasedTarget(worstFloor, DTERM_LPF1_MIN_HZ, dtermMaxHz);

  // Propwash-aware floor: prevent gyro LPF1 from going so low that phase delay
  // degrades propwash recovery. Only bypass when noise is extreme.
  let propwashNote = '';
  if (targetGyroLpf1 < PROPWASH_GYRO_LPF1_FLOOR_HZ && worstFloor <= PROPWASH_FLOOR_BYPASS_DB) {
    targetGyroLpf1 = PROPWASH_GYRO_LPF1_FLOOR_HZ;
    propwashNote =
      ' (Raised to propwash safety floor — lowering further would add phase delay that hurts propwash handling during flips and rolls.)';
  }

  const rpmNote = rpmActive
    ? ' With RPM filter active, motor noise is already handled, allowing higher filter cutoffs for better response.'
    : '';

  if (overallLevel === 'high') {
    // High noise → recommend noise-based targets (typically lower cutoffs)
    if (
      !gyroLpfDisabled &&
      Math.abs(targetGyroLpf1 - current.gyro_lpf1_static_hz) > NOISE_TARGET_DEADZONE_HZ
    ) {
      out.push({
        setting: 'gyro_lpf1_static_hz',
        currentValue: current.gyro_lpf1_static_hz,
        recommendedValue: targetGyroLpf1,
        reason:
          'Your gyro data has a lot of noise. Adjusting the gyro lowpass filter will clean up the signal, ' +
          'which helps your flight controller respond to real movement instead of vibrations.' +
          rpmNote +
          propwashNote,
        impact: 'both',
        confidence: 'high',
        ruleId: 'F-NF-H-GYRO',
      });
    }

    if (Math.abs(targetDtermLpf1 - current.dterm_lpf1_static_hz) > NOISE_TARGET_DEADZONE_HZ) {
      out.push({
        setting: 'dterm_lpf1_static_hz',
        currentValue: current.dterm_lpf1_static_hz,
        recommendedValue: targetDtermLpf1,
        reason:
          'High noise is reaching the D-term (derivative) calculation. Adjusting this filter reduces motor ' +
          'heating and oscillation caused by noisy D-term output.' +
          rpmNote,
        impact: 'both',
        confidence: 'high',
        ruleId: 'F-NF-H-DTERM',
      });
    }
  } else if (overallLevel === 'low') {
    // Low noise → recommend noise-based targets (typically higher cutoffs = less latency)
    if (
      !gyroLpfDisabled &&
      Math.abs(targetGyroLpf1 - current.gyro_lpf1_static_hz) > NOISE_TARGET_DEADZONE_HZ
    ) {
      out.push({
        setting: 'gyro_lpf1_static_hz',
        currentValue: current.gyro_lpf1_static_hz,
        recommendedValue: targetGyroLpf1,
        reason:
          'Your quad is very clean with minimal vibrations. Raising the gyro filter cutoff will give you ' +
          'faster response and sharper control with almost no downside.' +
          rpmNote +
          propwashNote,
        impact: 'latency',
        confidence: 'medium',
        ruleId: 'F-NF-L-GYRO',
      });
    }

    if (Math.abs(targetDtermLpf1 - current.dterm_lpf1_static_hz) > NOISE_TARGET_DEADZONE_HZ) {
      out.push({
        setting: 'dterm_lpf1_static_hz',
        currentValue: current.dterm_lpf1_static_hz,
        recommendedValue: targetDtermLpf1,
        reason:
          'Low noise means the D-term filter cutoff can be raised for sharper stick response. ' +
          'This makes your quad feel more locked-in during fast moves.' +
          rpmNote,
        impact: 'latency',
        confidence: 'medium',
        ruleId: 'F-NF-L-DTERM',
      });
    }
  } else {
    // Medium noise → only recommend if current settings are significantly off-target (>20 Hz)
    const mediumDeadzone = 20;

    if (
      !gyroLpfDisabled &&
      Math.abs(targetGyroLpf1 - current.gyro_lpf1_static_hz) > mediumDeadzone
    ) {
      out.push({
        setting: 'gyro_lpf1_static_hz',
        currentValue: current.gyro_lpf1_static_hz,
        recommendedValue: targetGyroLpf1,
        reason:
          'Noise levels are moderate but your gyro filter cutoff is significantly off from the optimal range. ' +
          'Adjusting it will better balance noise rejection and response.' +
          rpmNote +
          propwashNote,
        impact: 'both',
        confidence: 'low',
        ruleId: 'F-NF-M-GYRO',
      });
    }

    if (Math.abs(targetDtermLpf1 - current.dterm_lpf1_static_hz) > mediumDeadzone) {
      out.push({
        setting: 'dterm_lpf1_static_hz',
        currentValue: current.dterm_lpf1_static_hz,
        recommendedValue: targetDtermLpf1,
        reason:
          'Noise levels are moderate but your D-term filter cutoff is significantly off from the optimal range. ' +
          'Adjusting it will reduce motor heating without sacrificing too much response.' +
          rpmNote,
        impact: 'both',
        confidence: 'low',
        ruleId: 'F-NF-M-DTERM',
      });
    }
  }
}

/**
 * Check if a peak frequency falls within the dynamic notch filter's tracking range.
 * If the notch can handle it, we prefer notch tracking over lowering the LPF cutoff
 * (less phase delay).
 */
function isPeakInDynNotchRange(freq: number, current: CurrentFilterSettings): boolean {
  return freq >= current.dyn_notch_min_hz && freq <= current.dyn_notch_max_hz;
}

/**
 * Recommend fixes for detected resonance peaks.
 * Notch-aware: if a peak is within dyn_notch range, prefer notch handling
 * over lowering the lowpass cutoff (less phase delay).
 */
function recommendResonanceFixes(
  noise: NoiseProfile,
  current: CurrentFilterSettings,
  out: FilterRecommendation[],
  rpmActive: boolean
): void {
  // Collect significant peaks from roll and pitch.
  // Note: peak frequency bands are fixed (frame resonance 80-200 Hz, electrical >500 Hz).
  // These work across quad sizes because the noise analysis detects peaks at their actual
  // frequencies, which naturally vary by frame size (smaller quads resonate higher).
  const significantPeaks: NoisePeak[] = [];
  for (const axis of [noise.roll, noise.pitch]) {
    for (const peak of axis.peaks) {
      if (peak.amplitude >= RESONANCE_ACTION_THRESHOLD_DB) {
        significantPeaks.push(peak);
      }
    }
  }

  if (significantPeaks.length === 0) return;

  // Select bounds based on RPM filter state
  const gyroMaxHz = rpmActive ? GYRO_LPF1_MAX_HZ_RPM : GYRO_LPF1_MAX_HZ;
  const dtermMaxHz = rpmActive ? DTERM_LPF1_MAX_HZ_RPM : DTERM_LPF1_MAX_HZ;

  // Filter out peaks that the dynamic notch can already handle (prefer notch over LPF)
  const peaksNeedingLpf = significantPeaks.filter(
    (p) => !isPeakInDynNotchRange(p.frequency, current)
  );

  // If all peaks are within notch range, no LPF changes needed
  if (peaksNeedingLpf.length === 0) return;

  // Find the lowest significant peak frequency that the notch can't handle
  const lowestPeakFreq = Math.min(...peaksNeedingLpf.map((p) => p.frequency));

  // If the gyro LPF is disabled (0) or the peak is below the cutoff, the filter isn't catching it
  const gyroLpfDisabled = current.gyro_lpf1_static_hz === 0;
  if (gyroLpfDisabled || lowestPeakFreq < current.gyro_lpf1_static_hz) {
    const targetCutoff = Math.round(
      clamp(lowestPeakFreq - RESONANCE_CUTOFF_MARGIN_HZ, GYRO_LPF1_MIN_HZ, gyroMaxHz)
    );

    // When disabled, always recommend enabling; otherwise check it's lower than current
    if (gyroLpfDisabled || targetCutoff < current.gyro_lpf1_static_hz) {
      const peakType =
        peaksNeedingLpf.find((p) => p.frequency === lowestPeakFreq)?.type || 'unknown';
      const typeLabel =
        peakType === 'frame_resonance'
          ? 'frame resonance'
          : peakType === 'motor_harmonic'
            ? 'motor harmonic'
            : peakType === 'electrical'
              ? 'electrical noise'
              : 'noise spike';

      const reasonText = gyroLpfDisabled
        ? `A strong ${typeLabel} was detected at ${Math.round(lowestPeakFreq)} Hz, but your gyro lowpass filter is disabled. ` +
          `Enabling it at ${targetCutoff} Hz will block this vibration.`
        : `A strong ${typeLabel} was detected at ${Math.round(lowestPeakFreq)} Hz, which is below your current ` +
          `gyro filter cutoff of ${current.gyro_lpf1_static_hz} Hz. Lowering the filter will block this vibration.`;

      out.push({
        setting: 'gyro_lpf1_static_hz',
        currentValue: current.gyro_lpf1_static_hz,
        recommendedValue: targetCutoff,
        reason: reasonText,
        impact: 'both',
        confidence: 'high',
        ruleId: 'F-RES-GYRO',
      });
    }
  }

  // Check D-term LPF similarly
  if (lowestPeakFreq < current.dterm_lpf1_static_hz) {
    const targetCutoff = Math.round(
      clamp(lowestPeakFreq - RESONANCE_CUTOFF_MARGIN_HZ, DTERM_LPF1_MIN_HZ, dtermMaxHz)
    );

    if (targetCutoff < current.dterm_lpf1_static_hz) {
      out.push({
        setting: 'dterm_lpf1_static_hz',
        currentValue: current.dterm_lpf1_static_hz,
        recommendedValue: targetCutoff,
        reason:
          `A strong resonance peak at ${Math.round(lowestPeakFreq)} Hz is getting through to the D-term. ` +
          'Lowering the D-term filter will reduce motor heat and improve flight smoothness.',
        impact: 'both',
        confidence: 'high',
        ruleId: 'F-RES-DTERM',
      });
    }
  }
}

/**
 * Check if the dynamic notch filter range covers the detected noise peaks.
 */
function recommendDynamicNotchAdjustments(
  noise: NoiseProfile,
  current: CurrentFilterSettings,
  out: FilterRecommendation[]
): void {
  // Collect all significant peaks across axes
  const allPeaks: NoisePeak[] = [];
  for (const axis of [noise.roll, noise.pitch, noise.yaw]) {
    for (const peak of axis.peaks) {
      if (peak.amplitude >= RESONANCE_ACTION_THRESHOLD_DB) {
        allPeaks.push(peak);
      }
    }
  }

  if (allPeaks.length === 0) return;

  // Check if any peaks fall outside the dynamic notch range
  const peaksBelow = allPeaks.filter((p) => p.frequency < current.dyn_notch_min_hz);
  const peaksAbove = allPeaks.filter((p) => p.frequency > current.dyn_notch_max_hz);

  if (peaksBelow.length > 0) {
    const lowestPeak = Math.min(...peaksBelow.map((p) => p.frequency));
    const newMin = Math.max(50, Math.round(lowestPeak - 20));

    if (newMin < current.dyn_notch_min_hz) {
      out.push({
        setting: 'dyn_notch_min_hz',
        currentValue: current.dyn_notch_min_hz,
        recommendedValue: newMin,
        reason:
          `There's a noise peak at ${Math.round(lowestPeak)} Hz that falls below the dynamic notch filter's ` +
          `minimum of ${current.dyn_notch_min_hz} Hz. Lowering the minimum lets the notch filter track and remove it.`,
        impact: 'noise',
        confidence: 'medium',
        ruleId: 'F-DN-MIN',
      });
    }
  }

  if (peaksAbove.length > 0) {
    const highestPeak = Math.max(...peaksAbove.map((p) => p.frequency));
    const newMax = Math.min(1000, Math.round(highestPeak + 20));

    if (newMax > current.dyn_notch_max_hz) {
      out.push({
        setting: 'dyn_notch_max_hz',
        currentValue: current.dyn_notch_max_hz,
        recommendedValue: newMax,
        reason:
          `A noise peak at ${Math.round(highestPeak)} Hz is above the dynamic notch filter's ` +
          `maximum of ${current.dyn_notch_max_hz} Hz. Raising the maximum lets the notch filter catch it.`,
        impact: 'noise',
        confidence: 'medium',
        ruleId: 'F-DN-MAX',
      });
    }
  }
}

/**
 * Recommend dynamic notch count and Q adjustments when RPM filter is active.
 * With RPM filter handling motor harmonics, the dynamic notch only needs to catch
 * frame resonances — fewer notches with narrower Q.
 *
 * Exception: if significant resonance peaks are detected, keep Q at 300 (wider)
 * to better track the resonance. Q=500 is too narrow for strong frame resonances.
 */
function recommendDynamicNotchForRPM(
  noise: NoiseProfile,
  current: CurrentFilterSettings,
  out: FilterRecommendation[]
): void {
  const currentCount = current.dyn_notch_count;
  const currentQ = current.dyn_notch_q;

  // Check for significant resonance peaks — affects Q recommendation
  const hasStrongResonance = [noise.roll, noise.pitch, noise.yaw].some((axis) =>
    axis.peaks.some(
      (p) => p.amplitude >= RESONANCE_ACTION_THRESHOLD_DB && p.type === 'frame_resonance'
    )
  );

  // Only recommend if we have the data and it differs from RPM-optimal values
  if (currentCount !== undefined && currentCount > DYN_NOTCH_COUNT_WITH_RPM) {
    out.push({
      setting: 'dyn_notch_count',
      currentValue: currentCount,
      recommendedValue: DYN_NOTCH_COUNT_WITH_RPM,
      reason:
        'With RPM filter active, motor harmonics are already removed. The dynamic notch filter only needs to ' +
        'catch frame resonances, so fewer notches are needed. This reduces CPU load and filter delay.',
      impact: 'latency',
      confidence: 'high',
      ruleId: 'F-DN-COUNT',
    });
  }

  // Q recommendation: keep 300 (wider) if strong frame resonance, else narrow to 500
  if (!hasStrongResonance && currentQ !== undefined && currentQ < DYN_NOTCH_Q_WITH_RPM) {
    out.push({
      setting: 'dyn_notch_q',
      currentValue: currentQ,
      recommendedValue: DYN_NOTCH_Q_WITH_RPM,
      reason:
        'With RPM filter handling motor noise, the dynamic notch can use a higher Q (narrower bandwidth). ' +
        'This means less signal distortion while still catching frame resonances.',
      impact: 'latency',
      confidence: 'high',
      ruleId: 'F-DN-Q',
    });
  } else if (hasStrongResonance && currentQ !== undefined && currentQ > 300) {
    // Strong resonance present — keep Q at 300 (wider) for better tracking
    out.push({
      setting: 'dyn_notch_q',
      currentValue: currentQ,
      recommendedValue: 300,
      reason:
        'Strong frame resonance detected. Keeping the dynamic notch Q at 300 (wider bandwidth) ' +
        'ensures the notch can effectively track and suppress the resonance.',
      impact: 'noise',
      confidence: 'medium',
      ruleId: 'F-DN-Q',
    });
  }
}

/**
 * Deduplicate recommendations for the same setting.
 * When multiple rules target the same setting, keep the more aggressive change.
 */
function deduplicateRecommendations(recs: FilterRecommendation[]): FilterRecommendation[] {
  const byKey = new Map<string, FilterRecommendation>();

  for (const rec of recs) {
    const existing = byKey.get(rec.setting);
    if (!existing) {
      byKey.set(rec.setting, rec);
      continue;
    }

    // For lowpass filters, "more aggressive" = lower cutoff
    if (rec.setting.includes('lpf') || rec.setting.includes('min')) {
      if (rec.recommendedValue < existing.recommendedValue) {
        // Merge: keep the more aggressive value but upgrade confidence
        byKey.set(rec.setting, {
          ...rec,
          confidence:
            existing.confidence === 'high' || rec.confidence === 'high' ? 'high' : 'medium',
        });
      }
    } else {
      // For max filters, more aggressive = higher value
      if (rec.recommendedValue > existing.recommendedValue) {
        byKey.set(rec.setting, {
          ...rec,
          confidence:
            existing.confidence === 'high' || rec.confidence === 'high' ? 'high' : 'medium',
        });
      }
    }
  }

  return Array.from(byKey.values());
}

/**
 * Generate a beginner-friendly summary of the analysis.
 */
export function generateSummary(
  noise: NoiseProfile,
  recommendations: FilterRecommendation[],
  rpmActive: boolean = false
): string {
  const { overallLevel } = noise;
  const parts: string[] = [];

  if (overallLevel === 'high') {
    parts.push('Your quad has significant vibration or noise.');
  } else if (overallLevel === 'low') {
    parts.push('Your quad is running very clean!');
  } else {
    parts.push('Your noise levels are moderate.');
  }

  if (rpmActive) {
    parts.push('RPM filter is active — motor noise is handled dynamically.');
  }

  // Mention resonance if detected
  const allPeaks = [...noise.roll.peaks, ...noise.pitch.peaks];
  const frameRes = allPeaks.find((p) => p.type === 'frame_resonance');
  const motorHarm = allPeaks.find((p) => p.type === 'motor_harmonic');

  if (frameRes) {
    parts.push(`Frame resonance detected around ${Math.round(frameRes.frequency)} Hz.`);
  }
  if (motorHarm) {
    parts.push(`Motor harmonic noise detected around ${Math.round(motorHarm.frequency)} Hz.`);
  }

  if (recommendations.length === 0) {
    parts.push('Current filter settings look good — no changes needed.');
  } else {
    parts.push(
      `${recommendations.length} filter change${recommendations.length > 1 ? 's' : ''} recommended.`
    );
  }

  return parts.join(' ');
}

/**
 * Recommend LPF2 adjustments:
 * - With RPM filter + clean noise: disable LPF2 for less latency
 * - Without RPM + high noise + LPF2 disabled: warn to enable
 */
function recommendLpf2Adjustments(
  noise: NoiseProfile,
  current: CurrentFilterSettings,
  out: FilterRecommendation[],
  rpmActive: boolean
): void {
  const worstFloor = Math.max(noise.roll.noiseFloorDb, noise.pitch.noiseFloorDb);

  // Clean signal + RPM active → disable LPF2 for less phase delay
  if (rpmActive && worstFloor < GYRO_LPF2_DISABLE_THRESHOLD_DB) {
    if (current.gyro_lpf2_static_hz > 0) {
      out.push({
        setting: 'gyro_lpf2_static_hz',
        currentValue: current.gyro_lpf2_static_hz,
        recommendedValue: 0,
        reason:
          'With RPM filter active and very clean gyro data, the second gyro lowpass filter can be ' +
          'disabled to reduce phase delay and improve response.',
        impact: 'latency',
        confidence: 'medium',
        ruleId: 'F-LPF2-DIS-GYRO',
      });
    }
    if (current.dterm_lpf2_static_hz > 0) {
      out.push({
        setting: 'dterm_lpf2_static_hz',
        currentValue: current.dterm_lpf2_static_hz,
        recommendedValue: 0,
        reason:
          'With RPM filter active and low noise, the second D-term lowpass filter can be ' +
          'disabled to reduce latency and improve stick feel.',
        impact: 'latency',
        confidence: 'medium',
        ruleId: 'F-LPF2-DIS-DTERM',
      });
    }
  }

  // High noise + no RPM + LPF2 disabled → recommend enabling
  if (!rpmActive && noise.overallLevel === 'high') {
    if (current.gyro_lpf2_static_hz === 0) {
      out.push({
        setting: 'gyro_lpf2_static_hz',
        currentValue: 0,
        recommendedValue: 250,
        reason:
          'High noise detected without RPM filter. Enabling the second gyro lowpass filter ' +
          'provides additional noise rejection that helps with motor temperatures.',
        impact: 'noise',
        confidence: 'low',
        ruleId: 'F-LPF2-EN-GYRO',
      });
    }
    if (current.dterm_lpf2_static_hz === 0) {
      out.push({
        setting: 'dterm_lpf2_static_hz',
        currentValue: 0,
        recommendedValue: 150,
        reason:
          'High noise detected without RPM filter. Enabling the second D-term lowpass filter ' +
          'helps reduce motor heating from noisy D-term output.',
        impact: 'noise',
        confidence: 'low',
        ruleId: 'F-LPF2-EN-DTERM',
      });
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
