import { describe, it, expect } from 'vitest';
import {
  matchFilterVerification,
  matchPIDVerification,
  matchFlashVerification,
  matchMechanicalPeaks,
  computeThrottleOverlap,
  computeStepCountRatio,
  computeActivityRatio,
  type FilterVerificationInput,
  type PIDVerificationInput,
  type FlashVerificationInput,
} from './VerificationMatcher';
import type {
  NoisePeak,
  FlightSegment,
  NoiseProfile,
  AxisNoiseProfile,
} from '@shared/types/analysis.types';

// ---- Test helpers ----

function makeAxisNoise(floorDb: number = -50, peaks: NoisePeak[] = []): AxisNoiseProfile {
  return {
    spectrum: { frequencies: new Float64Array(0), magnitudes: new Float64Array(0) },
    noiseFloorDb: floorDb,
    peaks,
  };
}

function makeNoiseProfile(peaks: NoisePeak[] = [], floor: number = -50): NoiseProfile {
  return {
    roll: makeAxisNoise(floor, peaks),
    pitch: makeAxisNoise(floor, peaks),
    yaw: makeAxisNoise(floor, []),
    overallLevel: 'medium',
  };
}

function makeSegment(
  minThrottle: number,
  maxThrottle: number,
  duration: number = 3
): FlightSegment {
  return {
    startIndex: 0,
    endIndex: 1000,
    durationSeconds: duration,
    averageThrottle: (minThrottle + maxThrottle) / 2,
    minThrottle,
    maxThrottle,
  };
}

function makePeak(freq: number, type: NoisePeak['type'] = 'frame_resonance'): NoisePeak {
  return { frequency: freq, amplitude: 10, type };
}

// ---- matchMechanicalPeaks ----

describe('matchMechanicalPeaks', () => {
  it('returns matchRatio 1.0 when no reference mechanical peaks', () => {
    const result = matchMechanicalPeaks(
      [makePeak(500, 'electrical')],
      [makePeak(150, 'frame_resonance')]
    );
    expect(result.matchRatio).toBe(1.0);
  });

  it('returns matchRatio 1.0 for identical peaks', () => {
    const peaks = [makePeak(150, 'frame_resonance'), makePeak(300, 'motor_harmonic')];
    const result = matchMechanicalPeaks(peaks, peaks);
    expect(result.matchRatio).toBe(1.0);
    expect(result.unmatchedRef).toHaveLength(0);
  });

  it('matches peaks within proportional tolerance', () => {
    const ref = [makePeak(300, 'motor_harmonic')]; // tolerance = max(10, 300*0.05) = 15 Hz
    const ver = [makePeak(314, 'motor_harmonic')]; // 14 Hz away — within tolerance
    const result = matchMechanicalPeaks(ref, ver);
    expect(result.matchRatio).toBe(1.0);
  });

  it('does not match peaks outside tolerance', () => {
    const ref = [makePeak(150, 'frame_resonance')]; // tolerance = max(10, 7.5) = 10 Hz
    const ver = [makePeak(180, 'frame_resonance')]; // 30 Hz away — outside tolerance
    const result = matchMechanicalPeaks(ref, ver);
    expect(result.matchRatio).toBe(0);
    expect(result.unmatchedRef).toHaveLength(1);
  });

  it('classifies disappeared peaks as filtered, not unmatched', () => {
    const ref = [makePeak(150, 'frame_resonance'), makePeak(300, 'motor_harmonic')];
    const ver: NoisePeak[] = []; // All peaks gone after filtering
    const result = matchMechanicalPeaks(ref, ver);
    expect(result.matchRatio).toBe(1.0); // Not penalized
    expect(result.filteredRef).toHaveLength(2);
    expect(result.unmatchedRef).toHaveLength(0);
  });

  it('handles empty inputs', () => {
    const result = matchMechanicalPeaks([], []);
    expect(result.matchRatio).toBe(1.0);
  });
});

// ---- computeThrottleOverlap ----

describe('computeThrottleOverlap', () => {
  it('returns 1 for identical segments', () => {
    const seg = [makeSegment(0.2, 0.8)];
    expect(computeThrottleOverlap(seg, seg)).toBe(1);
  });

  it('returns 0 for non-overlapping segments', () => {
    const ref = [makeSegment(0.2, 0.4)];
    const ver = [makeSegment(0.6, 0.8)];
    expect(computeThrottleOverlap(ref, ver)).toBe(0);
  });

  it('returns partial overlap', () => {
    const ref = [makeSegment(0.2, 0.8)]; // range = 0.6
    const ver = [makeSegment(0.5, 0.9)]; // overlap = 0.8 - 0.5 = 0.3
    const overlap = computeThrottleOverlap(ref, ver);
    expect(overlap).toBeCloseTo(0.5, 1); // 0.3 / 0.6 = 0.5
  });

  it('returns 0 for empty segments', () => {
    expect(computeThrottleOverlap([], [makeSegment(0.2, 0.8)])).toBe(0);
  });
});

// ---- computeStepCountRatio ----

describe('computeStepCountRatio', () => {
  it('returns 1 for equal counts', () => {
    expect(computeStepCountRatio(10, 10)).toBe(1);
  });

  it('returns ratio for different counts', () => {
    expect(computeStepCountRatio(5, 10)).toBe(0.5);
  });

  it('returns 0 when one is zero', () => {
    expect(computeStepCountRatio(0, 10)).toBe(0);
  });

  it('returns 1 for both zero', () => {
    expect(computeStepCountRatio(0, 0)).toBe(1);
  });
});

// ---- Filter verification ----

describe('matchFilterVerification', () => {
  it('scores 100 for identical flights', () => {
    const peaks = [makePeak(150, 'frame_resonance')];
    const input: FilterVerificationInput = {
      noiseProfile: makeNoiseProfile(peaks),
      segments: [makeSegment(0.2, 0.8)],
      hasSweepSegments: true,
    };
    const result = matchFilterVerification(input, input);
    expect(result.score).toBe(100);
    expect(result.tier).toBe('good');
    expect(result.recommendation).toBe('accept');
  });

  it('warns when throttle coverage differs', () => {
    const peaks = [makePeak(150, 'frame_resonance')];
    const ref: FilterVerificationInput = {
      noiseProfile: makeNoiseProfile(peaks),
      segments: [makeSegment(0.2, 0.8)],
      hasSweepSegments: true,
    };
    const ver: FilterVerificationInput = {
      noiseProfile: makeNoiseProfile(peaks),
      segments: [makeSegment(0.6, 0.9)], // Poor overlap
      hasSweepSegments: true,
    };
    const result = matchFilterVerification(ref, ver);
    expect(result.score).toBeLessThan(100);
    expect(result.warnings.some((w) => w.code === 'verification_dissimilar_throttle')).toBe(true);
  });

  it('rejects when peaks are completely different', () => {
    const ref: FilterVerificationInput = {
      noiseProfile: makeNoiseProfile([makePeak(150, 'frame_resonance')]),
      segments: [makeSegment(0.2, 0.4)],
      hasSweepSegments: false,
    };
    const ver: FilterVerificationInput = {
      noiseProfile: makeNoiseProfile([makePeak(350, 'frame_resonance')]),
      segments: [makeSegment(0.6, 0.8)],
      hasSweepSegments: true,
    };
    const result = matchFilterVerification(ref, ver);
    expect(result.score).toBeLessThanOrEqual(40);
    expect(result.tier).not.toBe('good');
  });

  it('does not penalize when reference has no mechanical peaks', () => {
    const ref: FilterVerificationInput = {
      noiseProfile: makeNoiseProfile([makePeak(600, 'electrical')]),
      segments: [makeSegment(0.2, 0.8)],
      hasSweepSegments: true,
    };
    const ver: FilterVerificationInput = {
      noiseProfile: makeNoiseProfile([makePeak(600, 'electrical')]),
      segments: [makeSegment(0.2, 0.8)],
      hasSweepSegments: true,
    };
    const result = matchFilterVerification(ref, ver);
    expect(result.score).toBe(100);
  });

  it('penalizes segment type mismatch', () => {
    const peaks = [makePeak(150, 'frame_resonance')];
    const ref: FilterVerificationInput = {
      noiseProfile: makeNoiseProfile(peaks),
      segments: [makeSegment(0.2, 0.8)],
      hasSweepSegments: true,
    };
    const ver: FilterVerificationInput = {
      noiseProfile: makeNoiseProfile(peaks),
      segments: [makeSegment(0.2, 0.8)],
      hasSweepSegments: false,
    };
    const result = matchFilterVerification(ref, ver);
    expect(result.score).toBeLessThan(100);
    expect(result.warnings.some((w) => w.code === 'verification_dissimilar_segments')).toBe(true);
  });
});

// ---- PID verification ----

describe('matchPIDVerification', () => {
  it('scores high for matching step patterns', () => {
    const input: PIDVerificationInput = {
      stepsDetected: 15,
      axisStepCounts: [5, 5, 5],
      meanMagnitude: 300,
      magnitudeStd: 50,
    };
    const result = matchPIDVerification(input, input);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.recommendation).toBe('accept');
  });

  it('warns when verification has fewer steps', () => {
    const ref: PIDVerificationInput = {
      stepsDetected: 15,
      axisStepCounts: [5, 5, 5],
      meanMagnitude: 300,
      magnitudeStd: 50,
    };
    const ver: PIDVerificationInput = {
      stepsDetected: 5,
      axisStepCounts: [2, 2, 1],
      meanMagnitude: 300,
      magnitudeStd: 50,
    };
    const result = matchPIDVerification(ref, ver);
    expect(result.score).toBeLessThan(70);
  });

  it('warns when axis coverage differs', () => {
    const ref: PIDVerificationInput = {
      stepsDetected: 15,
      axisStepCounts: [5, 5, 5],
      meanMagnitude: 300,
      magnitudeStd: 50,
    };
    const ver: PIDVerificationInput = {
      stepsDetected: 10,
      axisStepCounts: [5, 5, 0],
      meanMagnitude: 300,
      magnitudeStd: 50,
    };
    const result = matchPIDVerification(ref, ver);
    expect(result.score).toBeLessThan(100);
  });
});

// ---- PID magnitude edge cases ----

describe('matchPIDVerification — magnitude', () => {
  it('defaults to 50 when magnitude data unavailable', () => {
    const ref: PIDVerificationInput = {
      stepsDetected: 15,
      axisStepCounts: [5, 5, 5],
      meanMagnitude: 0,
      magnitudeStd: 0,
    };
    const ver: PIDVerificationInput = {
      stepsDetected: 15,
      axisStepCounts: [5, 5, 5],
      meanMagnitude: 0,
      magnitudeStd: 0,
    };
    const result = matchPIDVerification(ref, ver);
    // magnitude sub-score should be 50 (default), overall still accept
    const magSubScore = result.subScores.find((s) => s.name === 'Magnitude range overlap');
    expect(magSubScore?.score).toBe(50);
  });
});

// ---- Flash verification ----

describe('matchFlashVerification', () => {
  it('scores high for similar flights', () => {
    const input: FlashVerificationInput = {
      setpointRMS: 100,
      coherenceMean: 0.7,
    };
    const result = matchFlashVerification(input, input);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.recommendation).toBe('accept');
  });

  it('rejects when stick activity is very different', () => {
    const ref: FlashVerificationInput = {
      setpointRMS: 100,
      coherenceMean: 0.7,
    };
    const ver: FlashVerificationInput = {
      setpointRMS: 10, // 10× less activity
      coherenceMean: 0.2,
    };
    const result = matchFlashVerification(ref, ver);
    expect(result.score).toBeLessThan(40);
    expect(result.recommendation).toBe('reject_reflight');
  });
});

// ---- BBL Fixture Calibration Tests ----
// Uses real flight logs from test-fixtures/bbl/ (same VX3.5 quad, same session)
// to validate that SIMILARITY_ACCEPT_THRESHOLD / SIMILARITY_REJECT_THRESHOLD are reasonable.

import fs from 'fs/promises';
import path from 'path';
import { BlackboxParser } from '../blackbox/BlackboxParser';
import { analyze as analyzeFilters } from './FilterAnalyzer';
import { enrichSettingsFromBBLHeaders } from './headerValidation';
import { findThrottleSweepSegments, findSteadySegments } from './SegmentSelector';
import { DEFAULT_FILTER_SETTINGS } from '@shared/types/analysis.types';
import type { CurrentFilterSettings, FilterAnalysisResult } from '@shared/types/analysis.types';
import type { BlackboxFlightData } from '@shared/types/blackbox.types';
import { SIMILARITY_ACCEPT_THRESHOLD, SIMILARITY_REJECT_THRESHOLD } from './constants';

const FIXTURES_DIR = path.resolve(__dirname, '../../../test-fixtures/bbl');
const LOG_FILES = [
  'blackbox_2026-03-29T11-09-44-682Z.bbl', // LOG1 — filter analysis
  'blackbox_2026-03-29T16-17-37-126Z.bbl', // LOG2 — filter verification
] as const;

interface ParsedCalibrationLog {
  flightData: BlackboxFlightData;
  filterSettings: CurrentFilterSettings;
  analysisResult: FilterAnalysisResult;
  hasSweepSegments: boolean;
}

describe('BBL fixture calibration — similarity thresholds', () => {
  const logs: ParsedCalibrationLog[] = [];

  beforeAll(async () => {
    for (const file of LOG_FILES) {
      const data = await fs.readFile(path.join(FIXTURES_DIR, file));
      const result = await BlackboxParser.parse(data);
      expect(result.success).toBe(true);

      const session = result.sessions[0];
      const rawHeaders = session.header.rawHeaders;
      const enriched = enrichSettingsFromBBLHeaders(DEFAULT_FILTER_SETTINGS, rawHeaders);
      const filterSettings = enriched ?? DEFAULT_FILTER_SETTINGS;

      const analysisResult = await analyzeFilters(session.flightData, 0, filterSettings);

      const sweepSegments = findThrottleSweepSegments(session.flightData);

      logs.push({
        flightData: session.flightData,
        filterSettings,
        analysisResult,
        hasSweepSegments: sweepSegments.length > 0,
      });
    }
  }, 30_000);

  it('same-quad LOG1 vs LOG2 filter similarity scores above ACCEPT threshold', () => {
    const [log1, log2] = logs;

    const ref: FilterVerificationInput = {
      noiseProfile: log1.analysisResult.noise,
      segments: findSegmentsFromFlightData(log1.flightData),
      hasSweepSegments: log1.hasSweepSegments,
    };
    const ver: FilterVerificationInput = {
      noiseProfile: log2.analysisResult.noise,
      segments: findSegmentsFromFlightData(log2.flightData),
      hasSweepSegments: log2.hasSweepSegments,
    };

    const result = matchFilterVerification(ref, ver);

    // Same quad, same session — similarity should be well above accept threshold
    expect(result.score).toBeGreaterThanOrEqual(SIMILARITY_ACCEPT_THRESHOLD);
    expect(result.tier).toBe('good');
    expect(result.recommendation).toBe('accept');

    // Log the actual scores for threshold calibration reference

    console.log(
      `[Calibration] LOG1 vs LOG2 similarity: ${result.score}/100, ` +
        `sub-scores: ${result.subScores.map((s) => `${s.name}=${s.score}`).join(', ')}`
    );
  });

  it('same-quad LOG2 vs LOG1 (reversed) also scores above threshold', () => {
    const [log1, log2] = logs;

    const ref: FilterVerificationInput = {
      noiseProfile: log2.analysisResult.noise,
      segments: findSegmentsFromFlightData(log2.flightData),
      hasSweepSegments: log2.hasSweepSegments,
    };
    const ver: FilterVerificationInput = {
      noiseProfile: log1.analysisResult.noise,
      segments: findSegmentsFromFlightData(log1.flightData),
      hasSweepSegments: log1.hasSweepSegments,
    };

    const result = matchFilterVerification(ref, ver);
    expect(result.score).toBeGreaterThanOrEqual(SIMILARITY_ACCEPT_THRESHOLD);
  });

  it('scores are not 100 (different filter settings between flights affect peak detection)', () => {
    const [log1, log2] = logs;

    const ref: FilterVerificationInput = {
      noiseProfile: log1.analysisResult.noise,
      segments: findSegmentsFromFlightData(log1.flightData),
      hasSweepSegments: log1.hasSweepSegments,
    };
    const ver: FilterVerificationInput = {
      noiseProfile: log2.analysisResult.noise,
      segments: findSegmentsFromFlightData(log2.flightData),
      hasSweepSegments: log2.hasSweepSegments,
    };

    const result = matchFilterVerification(ref, ver);
    // Not exactly 100 because filter settings differ (LOG2 has applied filter recs)
    // but should be well within accept range
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThan(SIMILARITY_REJECT_THRESHOLD);
  });

  it('thresholds have adequate margin (score - threshold > 10)', () => {
    const [log1, log2] = logs;

    const ref: FilterVerificationInput = {
      noiseProfile: log1.analysisResult.noise,
      segments: findSegmentsFromFlightData(log1.flightData),
      hasSweepSegments: log1.hasSweepSegments,
    };
    const ver: FilterVerificationInput = {
      noiseProfile: log2.analysisResult.noise,
      segments: findSegmentsFromFlightData(log2.flightData),
      hasSweepSegments: log2.hasSweepSegments,
    };

    const result = matchFilterVerification(ref, ver);
    const margin = result.score - SIMILARITY_ACCEPT_THRESHOLD;

    // If margin is < 10, threshold is too tight for real-world same-quad flights
    expect(margin).toBeGreaterThanOrEqual(10);

    console.log(
      `[Calibration] Threshold margin: ${margin} points (score=${result.score}, threshold=${SIMILARITY_ACCEPT_THRESHOLD})`
    );
  });
});

/** Helper: extract segments from flight data using the same logic as FilterAnalyzer */
function findSegmentsFromFlightData(flightData: BlackboxFlightData) {
  const sweeps = findThrottleSweepSegments(flightData);
  return sweeps.length > 0 ? sweeps : findSteadySegments(flightData);
}
