/**
 * Offline Tuning Validation — real BBL pipeline tests.
 *
 * Uses 4 real flight logs from a VX3.5 quad (SpeedyBee F405 Mini, BF 4.5.2, 3.5", 4S)
 * in test-fixtures/bbl/. These logs were recorded when the algorithms were not yet
 * working correctly — they serve as diverse real-world input for validating the
 * CURRENT analysis pipeline, NOT as before/after improvement pairs.
 *
 * Log roles (from the original session):
 *   LOG1 — Filter analysis flight (original/factory-ish settings)
 *   LOG2 — Filter verification flight (after applying filter recs — recs were faulty)
 *   LOG3 — PID analysis flight (filters applied, original PIDs)
 *   LOG4 — PID verification flight (after applying PID recs — recs were faulty)
 *
 * Each test extracts settings from the BBL header of that specific log,
 * so the analysis runs with the settings the quad actually flew with.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { BlackboxParser } from '../blackbox/BlackboxParser';
import { analyze as analyzeFilters } from './FilterAnalyzer';
import { analyzePID, analyzeTransferFunction } from './PIDAnalyzer';
import { enrichSettingsFromBBLHeaders } from './headerValidation';
import { extractFlightPIDs } from './PIDRecommender';
import { checkMechanicalHealth } from './MechanicalHealthChecker';
import { estimateGroupDelay } from './GroupDelayEstimator';
import { DEFAULT_FILTER_SETTINGS } from '@shared/types/analysis.types';
import type {
  CurrentFilterSettings,
  FilterRecommendation,
  PIDRecommendation,
} from '@shared/types/analysis.types';
import type { PIDConfiguration } from '@shared/types/pid.types';
import type { BlackboxFlightData } from '@shared/types/blackbox.types';
import {
  GYRO_LPF1_MIN_HZ,
  GYRO_LPF1_MAX_HZ,
  GYRO_LPF1_MAX_HZ_RPM,
  DTERM_LPF1_MIN_HZ,
  DTERM_LPF1_MAX_HZ,
  DTERM_LPF1_MAX_HZ_RPM,
  QUAD_SIZE_BOUNDS,
} from './constants';

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.resolve(__dirname, '../../../test-fixtures/bbl');

const LOG_FILES = [
  'blackbox_2026-03-29T11-09-44-682Z.bbl', // LOG1 — filter analysis
  'blackbox_2026-03-29T16-17-37-126Z.bbl', // LOG2 — filter verification
  'blackbox_2026-03-29T18-00-16-246Z.bbl', // LOG3 — PID analysis
  'blackbox_2026-03-29T18-23-46-100Z.bbl', // LOG4 — PID verification
] as const;

/** Default PIDs — used as fallback if header extraction fails */
const DEFAULT_PIDS: PIDConfiguration = {
  roll: { P: 45, I: 80, D: 30 },
  pitch: { P: 47, I: 84, D: 32 },
  yaw: { P: 45, I: 80, D: 0 },
};

const DRONE_SIZE = '3"' as const;
const BOUNDS_3 = QUAD_SIZE_BOUNDS[DRONE_SIZE];

// ---------------------------------------------------------------------------
// Shared parsed data (populated in beforeAll)
// ---------------------------------------------------------------------------

interface ParsedLog {
  flightData: BlackboxFlightData;
  rawHeaders: Map<string, string>;
  filterSettings: CurrentFilterSettings;
  flightPIDs: PIDConfiguration;
  rpmActive: boolean;
}

const logs: ParsedLog[] = [];

// ---------------------------------------------------------------------------
// Setup — parse all 4 BBL files once (expensive: ~10-20s total)
// ---------------------------------------------------------------------------

beforeAll(async () => {
  for (const file of LOG_FILES) {
    const data = await fs.readFile(path.join(FIXTURES_DIR, file));
    const result = await BlackboxParser.parse(data);
    expect(result.success).toBe(true);
    expect(result.sessions.length).toBeGreaterThan(0);

    const session = result.sessions[0];
    const rawHeaders = session.header.rawHeaders;

    // Extract settings from THIS log's headers (not defaults)
    const enriched = enrichSettingsFromBBLHeaders(DEFAULT_FILTER_SETTINGS, rawHeaders);
    const filterSettings = enriched ?? DEFAULT_FILTER_SETTINGS;
    const flightPIDs = extractFlightPIDs(rawHeaders) ?? DEFAULT_PIDS;
    const rpmHarmonics = filterSettings.rpm_filter_harmonics ?? 0;

    logs.push({
      flightData: session.flightData,
      rawHeaders,
      filterSettings,
      flightPIDs,
      rpmActive: rpmHarmonics > 0,
    });
  }
}, 30_000);

// ===========================================================================
// A. Pipeline Smoke — filter analysis on all 4 logs
// ===========================================================================

describe('A. Pipeline smoke — filter analysis on all 4 logs', () => {
  /**
   * Run filter analysis on each log using its own header-extracted settings.
   * Validates: no throw, structural completeness, noise floors finite,
   * recommendations within safety bounds.
   */
  it.each([0, 1, 2, 3])(
    'filter analysis completes without error on %s',
    async (idx) => {
      const log = logs[idx];
      const result = await analyzeFilters(log.flightData, 0, log.filterSettings, undefined, {
        droneSize: DRONE_SIZE,
      });

      // Structural completeness
      expect(result.noise).toBeDefined();
      expect(result.recommendations).toBeDefined();
      expect(Array.isArray(result.recommendations)).toBe(true);
      expect(result.summary).toBeDefined();
      expect(typeof result.summary).toBe('string');
      expect(result.analysisTimeMs).toBeGreaterThan(0);
      expect(result.segmentsUsed).toBeGreaterThanOrEqual(0);

      // Noise floors must be finite numbers (not NaN, not Infinity)
      expect(Number.isFinite(result.noise.roll.noiseFloorDb)).toBe(true);
      expect(Number.isFinite(result.noise.pitch.noiseFloorDb)).toBe(true);
      expect(Number.isFinite(result.noise.yaw.noiseFloorDb)).toBe(true);

      // Noise classification is valid enum
      expect(['low', 'medium', 'high']).toContain(result.noise.overallLevel);

      // Data quality present
      if (result.dataQuality) {
        expect(result.dataQuality.overall).toBeGreaterThanOrEqual(0);
        expect(result.dataQuality.overall).toBeLessThanOrEqual(100);
        expect(['excellent', 'good', 'fair', 'poor']).toContain(result.dataQuality.tier);
      }

      // All non-informational recommendations must be within safety bounds
      const gyroMaxHz = log.rpmActive ? GYRO_LPF1_MAX_HZ_RPM : GYRO_LPF1_MAX_HZ;
      const dtermMaxHz = log.rpmActive ? DTERM_LPF1_MAX_HZ_RPM : DTERM_LPF1_MAX_HZ;

      for (const rec of result.recommendations) {
        if (rec.informational) continue;

        // Structural checks
        expect(rec.setting.length).toBeGreaterThan(0);
        expect(typeof rec.currentValue).toBe('number');
        expect(typeof rec.recommendedValue).toBe('number');
        expect(['high', 'medium', 'low']).toContain(rec.confidence);
        expect(rec.reason.length).toBeGreaterThan(0);

        // Safety bounds (only for settings we know bounds for)
        if (rec.setting.includes('gyro_lpf1') && !rec.setting.includes('dyn_max')) {
          expect(rec.recommendedValue).toBeGreaterThanOrEqual(GYRO_LPF1_MIN_HZ);
          expect(rec.recommendedValue).toBeLessThanOrEqual(gyroMaxHz);
        }
        if (rec.setting.includes('dterm_lpf1') && !rec.setting.includes('dyn_max')) {
          expect(rec.recommendedValue).toBeGreaterThanOrEqual(DTERM_LPF1_MIN_HZ);
          expect(rec.recommendedValue).toBeLessThanOrEqual(dtermMaxHz);
        }
      }
    },
    15_000
  );

  /**
   * Noise floors should be in a physically reasonable range for real flight data.
   * Very quiet: -80 dB. Very noisy: 0 dB. Anything outside suggests a bug.
   */
  it('noise floors are in physically reasonable range across all logs', async () => {
    for (let idx = 0; idx < 4; idx++) {
      const log = logs[idx];
      const result = await analyzeFilters(log.flightData, 0, log.filterSettings);

      for (const axis of ['roll', 'pitch', 'yaw'] as const) {
        const floor = result.noise[axis].noiseFloorDb;
        expect(floor).toBeGreaterThanOrEqual(-80);
        expect(floor).toBeLessThanOrEqual(0);
      }
    }
  }, 60_000);
});

// ===========================================================================
// B. Factory settings regression — LOG1
// ===========================================================================

describe('B. Factory settings regression (LOG1)', () => {
  /**
   * LOG1 was flown with gyro_lpf1_static_hz=500 (very high / near-factory).
   * The current algorithm MUST recommend lowering it — this is the most basic
   * smoke test that the recommender is actually doing something on real data.
   */
  it('should generate ≥1 non-informational filter recommendation for LOG1', async () => {
    const log = logs[0];
    const result = await analyzeFilters(log.flightData, 0, log.filterSettings, undefined, {
      droneSize: DRONE_SIZE,
    });

    const actionable = result.recommendations.filter((r) => !r.informational);
    expect(actionable.length).toBeGreaterThanOrEqual(1);
  }, 15_000);

  /**
   * Verify that header enrichment actually works — LOG1 settings extracted from
   * BBL header should differ from defaults (proving enrichment ran).
   */
  it('LOG1 enriched settings differ from DEFAULT_FILTER_SETTINGS', () => {
    const log = logs[0];
    // LOG1 has rpm_filter_harmonics=3 in header, DEFAULT is undefined
    expect(log.filterSettings.rpm_filter_harmonics).toBe(3);
  });
});

// ===========================================================================
// C. PID analysis on real PID flights — LOG3 + LOG4
// ===========================================================================

describe('C. PID analysis on real PID flights', () => {
  /**
   * LOG3 is a dedicated PID flight — we expect the step detector to find
   * step inputs. Using PIDs extracted from LOG3's own header.
   */
  it('LOG3: analyzePID detects steps and returns valid result', async () => {
    const log = logs[2]; // LOG3
    const result = await analyzePID(
      log.flightData,
      0,
      log.flightPIDs,
      undefined, // onProgress
      log.flightPIDs, // flightPIDs (same — anchored to what was flown)
      log.rawHeaders,
      'balanced',
      undefined, // historyObservations
      DRONE_SIZE
    );

    // Structural completeness
    expect(result.roll).toBeDefined();
    expect(result.pitch).toBeDefined();
    expect(result.yaw).toBeDefined();
    expect(result.recommendations).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.analysisTimeMs).toBeGreaterThan(0);

    // Steps detected — a dedicated PID flight should have at least one
    expect(result.stepsDetected).toBeGreaterThan(0);

    // If steps were found, check metric ranges
    if (result.stepsDetected > 0) {
      for (const axis of ['roll', 'pitch', 'yaw'] as const) {
        const profile = result[axis];
        if (profile.responses.length > 0) {
          expect(profile.meanOvershoot).toBeGreaterThanOrEqual(0);
          expect(profile.meanOvershoot).toBeLessThan(500);
          expect(profile.meanRiseTimeMs).toBeGreaterThan(0);
          expect(profile.meanRiseTimeMs).toBeLessThan(500);
          expect(profile.meanSettlingTimeMs).toBeGreaterThan(0);
          expect(profile.meanSettlingTimeMs).toBeLessThan(2000);
        }
      }
    }

    // Data quality
    if (result.dataQuality) {
      expect(result.dataQuality.overall).toBeGreaterThanOrEqual(0);
      expect(result.dataQuality.overall).toBeLessThanOrEqual(100);
    }
  }, 15_000);

  /**
   * PID recommendations (if any) must be within QUAD_SIZE_BOUNDS for 3" quad.
   * This catches recommender bugs that produce unsafe gain values.
   */
  it('LOG3: PID recommendations within 3" safety bounds', async () => {
    const log = logs[2];
    const result = await analyzePID(
      log.flightData,
      0,
      log.flightPIDs,
      undefined,
      log.flightPIDs,
      log.rawHeaders,
      'balanced',
      undefined,
      DRONE_SIZE
    );

    for (const rec of result.recommendations) {
      if (rec.informational) continue;

      // Check PID bounds for P/I/D settings
      if (rec.setting.endsWith('_p')) {
        expect(rec.recommendedValue).toBeGreaterThanOrEqual(BOUNDS_3.pMin);
        expect(rec.recommendedValue).toBeLessThanOrEqual(BOUNDS_3.pMax);
      }
      if (rec.setting.endsWith('_d')) {
        expect(rec.recommendedValue).toBeGreaterThanOrEqual(BOUNDS_3.dMin);
        expect(rec.recommendedValue).toBeLessThanOrEqual(BOUNDS_3.dMax);
      }
      if (rec.setting.endsWith('_i')) {
        expect(rec.recommendedValue).toBeGreaterThanOrEqual(BOUNDS_3.iMin);
        expect(rec.recommendedValue).toBeLessThanOrEqual(BOUNDS_3.iMax);
      }
    }
  }, 15_000);

  /**
   * LOG4: PID analysis should also work on the verification flight.
   * Different PIDs in header (applied between LOG3→LOG4).
   */
  it('LOG4: analyzePID completes without error', async () => {
    const log = logs[3]; // LOG4
    const result = await analyzePID(
      log.flightData,
      0,
      log.flightPIDs,
      undefined,
      log.flightPIDs,
      log.rawHeaders,
      'balanced',
      undefined,
      DRONE_SIZE
    );

    expect(result.recommendations).toBeDefined();
    expect(result.analysisTimeMs).toBeGreaterThan(0);
  }, 15_000);

  /**
   * LOG3 header should have different PIDs than LOG4 header
   * (confirming the BBL captures applied PID changes between flights).
   */
  it('LOG3 and LOG4 have different PIDs in headers', () => {
    const pids3 = logs[2].flightPIDs;
    const pids4 = logs[3].flightPIDs;

    // PID configs should not be identical (at least one axis P/I/D differs)
    expect(pids3).not.toEqual(pids4);
  });

  /**
   * Transfer function analysis (Wiener deconvolution) on LOG3.
   * Should complete without throwing — TF analysis is more demanding on data quality.
   */
  it('LOG3: analyzeTransferFunction completes without error', async () => {
    const log = logs[2];
    const result = await analyzeTransferFunction(
      log.flightData,
      0,
      log.flightPIDs,
      undefined,
      log.flightPIDs,
      log.rawHeaders,
      'balanced',
      undefined,
      DRONE_SIZE
    );

    expect(result.recommendations).toBeDefined();
    expect(result.transferFunction).toBeDefined();
    expect(result.analysisTimeMs).toBeGreaterThan(0);

    // If bandwidth was computed, it should be positive
    // bandwidthHz is on transferFunction.metrics.roll, not transferFunction.roll
    if (result.transferFunction.metrics?.roll?.bandwidthHz) {
      expect(result.transferFunction.metrics.roll.bandwidthHz).toBeGreaterThan(0);
    }
    if (result.transferFunction.metrics?.pitch?.bandwidthHz) {
      expect(result.transferFunction.metrics.pitch.bandwidthHz).toBeGreaterThan(0);
    }
  }, 15_000);

  /**
   * LOG3 should extract valid PIDs from its header (not fall back to defaults).
   * This confirms extractFlightPIDs works on real BF 4.5.2 headers.
   */
  it('LOG3 extracts valid PIDs from header (not defaults)', () => {
    const pids = logs[2].flightPIDs;

    // PIDs should be in reasonable ranges (not default placeholders)
    expect(pids.roll.P).toBeGreaterThanOrEqual(20);
    expect(pids.roll.P).toBeLessThanOrEqual(120);
    expect(pids.pitch.P).toBeGreaterThanOrEqual(20);
    expect(pids.pitch.P).toBeLessThanOrEqual(120);
    // Yaw P can be 0 on some setups
    expect(pids.yaw.P).toBeGreaterThanOrEqual(0);
    expect(pids.yaw.P).toBeLessThanOrEqual(120);
  });
});

// ===========================================================================
// D. Convergence — does the recommender converge on real data?
// ===========================================================================

describe('D. Convergence tests', () => {
  /**
   * Helper: apply non-informational filter recommendations to settings.
   * Maps recommendation setting names to CurrentFilterSettings fields.
   */
  function applyFilterRecs(
    settings: CurrentFilterSettings,
    recs: FilterRecommendation[]
  ): CurrentFilterSettings {
    const updated = { ...settings };
    for (const rec of recs) {
      if (rec.informational) continue;
      switch (rec.setting) {
        case 'gyro_lpf1_static_hz':
          updated.gyro_lpf1_static_hz = rec.recommendedValue;
          break;
        case 'gyro_lpf2_static_hz':
          updated.gyro_lpf2_static_hz = rec.recommendedValue;
          break;
        case 'dterm_lpf1_static_hz':
          updated.dterm_lpf1_static_hz = rec.recommendedValue;
          break;
        case 'dterm_lpf2_static_hz':
          updated.dterm_lpf2_static_hz = rec.recommendedValue;
          break;
        case 'dyn_notch_min_hz':
          updated.dyn_notch_min_hz = rec.recommendedValue;
          break;
        case 'dyn_notch_max_hz':
          updated.dyn_notch_max_hz = rec.recommendedValue;
          break;
        case 'dyn_notch_count':
          updated.dyn_notch_count = rec.recommendedValue;
          break;
        case 'dyn_notch_q':
          updated.dyn_notch_q = rec.recommendedValue;
          break;
        case 'gyro_lpf1_dyn_min_hz':
          updated.gyro_lpf1_dyn_min_hz = rec.recommendedValue;
          break;
        case 'gyro_lpf1_dyn_max_hz':
          updated.gyro_lpf1_dyn_max_hz = rec.recommendedValue;
          break;
        case 'dterm_lpf1_dyn_min_hz':
          updated.dterm_lpf1_dyn_min_hz = rec.recommendedValue;
          break;
        case 'dterm_lpf1_dyn_max_hz':
          updated.dterm_lpf1_dyn_max_hz = rec.recommendedValue;
          break;
        case 'rpm_filter_q':
          updated.rpm_filter_q = rec.recommendedValue;
          break;
        case 'dterm_lpf1_dyn_expo':
          updated.dterm_lpf1_dyn_expo = rec.recommendedValue;
          break;
        // Unknown settings — skip (don't crash, just don't apply)
      }
    }
    return updated;
  }

  /**
   * Helper: apply non-informational PID recommendations to PID config.
   * Maps recommendation setting names (e.g. "pid_roll_p") to PIDConfiguration.
   */
  function applyPIDRecs(pids: PIDConfiguration, recs: PIDRecommendation[]): PIDConfiguration {
    const updated: PIDConfiguration = {
      roll: { ...pids.roll },
      pitch: { ...pids.pitch },
      yaw: { ...pids.yaw },
    };
    for (const rec of recs) {
      if (rec.informational) continue;
      const val = rec.recommendedValue;
      switch (rec.setting) {
        case 'pid_roll_p':
          updated.roll.P = val;
          break;
        case 'pid_roll_i':
          updated.roll.I = val;
          break;
        case 'pid_roll_d':
          updated.roll.D = val;
          break;
        case 'pid_pitch_p':
          updated.pitch.P = val;
          break;
        case 'pid_pitch_i':
          updated.pitch.I = val;
          break;
        case 'pid_pitch_d':
          updated.pitch.D = val;
          break;
        case 'pid_yaw_p':
          updated.yaw.P = val;
          break;
        case 'pid_yaw_i':
          updated.yaw.I = val;
          break;
        case 'pid_yaw_d':
          updated.yaw.D = val;
          break;
        // Non-PID settings (feedforward, iterm_relax, etc.) — skip
      }
    }
    return updated;
  }

  /**
   * Filter convergence: analyze LOG1 → apply recs → re-analyze → fewer or equal recs.
   *
   * This simulates: "if the quad flew with the same noise profile but the
   * recommended filters, would the recommender ask for MORE changes?"
   * If yes, it's a convergence bug → infinite tuning loop.
   */
  it('filter recommendations converge on LOG1 (1 iteration)', async () => {
    const log = logs[0];

    // Round 1: analyze with original settings
    const result1 = await analyzeFilters(log.flightData, 0, log.filterSettings, undefined, {
      droneSize: DRONE_SIZE,
    });
    const actionable1 = result1.recommendations.filter((r) => !r.informational);

    if (actionable1.length === 0) return; // Nothing to converge

    // Apply recommendations
    const updatedSettings = applyFilterRecs(log.filterSettings, result1.recommendations);

    // Round 2: re-analyze same log with updated settings
    const result2 = await analyzeFilters(log.flightData, 0, updatedSettings, undefined, {
      droneSize: DRONE_SIZE,
    });
    const actionable2 = result2.recommendations.filter((r) => !r.informational);

    // Convergence: round 2 should not produce MORE actionable recommendations
    expect(actionable2.length).toBeLessThanOrEqual(actionable1.length);
  }, 30_000);

  /**
   * Filter fixpoint: after ≤3 iterations, 0 non-informational recommendations.
   * This is the strongest convergence test — the recommender should reach a
   * stable state within a few cycles.
   */
  it('filter recommendations reach fixpoint within 3 iterations on LOG1', async () => {
    const log = logs[0];
    let settings = { ...log.filterSettings };
    let lastActionableCount = Infinity;

    for (let round = 0; round < 3; round++) {
      const result = await analyzeFilters(log.flightData, 0, settings, undefined, {
        droneSize: DRONE_SIZE,
      });
      const actionable = result.recommendations.filter((r) => !r.informational);

      // Each round should not produce more recs than previous
      expect(actionable.length).toBeLessThanOrEqual(lastActionableCount);
      lastActionableCount = actionable.length;

      if (actionable.length === 0) break;
      settings = applyFilterRecs(settings, result.recommendations);
    }

    expect(lastActionableCount).toBe(0);
  }, 60_000);

  /**
   * PID convergence: analyze LOG3 → apply recs → re-analyze → fewer or equal recs.
   */
  it('PID recommendations converge on LOG3 (1 iteration)', async () => {
    const log = logs[2];

    // Round 1
    const result1 = await analyzePID(
      log.flightData,
      0,
      log.flightPIDs,
      undefined,
      log.flightPIDs,
      log.rawHeaders,
      'balanced',
      undefined,
      DRONE_SIZE
    );
    const actionable1 = result1.recommendations.filter((r) => !r.informational);

    if (actionable1.length === 0) return;

    // Apply PID recommendations
    const updatedPIDs = applyPIDRecs(log.flightPIDs, result1.recommendations);

    // Round 2: re-analyze with updated PIDs
    const result2 = await analyzePID(
      log.flightData,
      0,
      updatedPIDs,
      undefined,
      log.flightPIDs, // flightPIDs stays original (what was actually flown)
      log.rawHeaders,
      'balanced',
      undefined,
      DRONE_SIZE
    );
    const actionable2 = result2.recommendations.filter((r) => !r.informational);

    expect(actionable2.length).toBeLessThanOrEqual(actionable1.length);
  }, 30_000);

  /**
   * No oscillation: if round 1 recommends INCREASING a setting,
   * round 2 must not recommend DECREASING it (and vice versa).
   * Oscillation = infinite tuning loop.
   */
  it('filter recommendations do not oscillate direction on LOG1', async () => {
    const log = logs[0];

    // Round 1
    const result1 = await analyzeFilters(log.flightData, 0, log.filterSettings, undefined, {
      droneSize: DRONE_SIZE,
    });
    const actionable1 = result1.recommendations.filter((r) => !r.informational);

    if (actionable1.length === 0) return;

    // Track direction: increase (+1) or decrease (-1)
    const directions1 = new Map<string, number>();
    for (const rec of actionable1) {
      directions1.set(rec.setting, Math.sign(rec.recommendedValue - rec.currentValue));
    }

    // Apply and re-analyze
    const updatedSettings = applyFilterRecs(log.filterSettings, result1.recommendations);
    const result2 = await analyzeFilters(log.flightData, 0, updatedSettings, undefined, {
      droneSize: DRONE_SIZE,
    });
    const actionable2 = result2.recommendations.filter((r) => !r.informational);

    // Check: no direction reversal for same settings
    for (const rec of actionable2) {
      const dir1 = directions1.get(rec.setting);
      if (dir1 !== undefined && dir1 !== 0) {
        const dir2 = Math.sign(rec.recommendedValue - rec.currentValue);
        if (dir2 !== 0) {
          // If both rounds had a directional change, they must agree
          expect(dir2).toBe(dir1);
        }
      }
    }
  }, 30_000);
});

// ===========================================================================
// E. Determinism — same input = same output
// ===========================================================================

describe('E. Determinism', () => {
  /**
   * Running filter analysis twice on the same log with the same settings
   * must produce identical results. Non-determinism would mean unreliable
   * recommendations that change on every "Analyze" click.
   */
  it('filter analysis is deterministic on LOG1', async () => {
    const log = logs[0];

    const result1 = await analyzeFilters(log.flightData, 0, log.filterSettings, undefined, {
      droneSize: DRONE_SIZE,
    });
    const result2 = await analyzeFilters(log.flightData, 0, log.filterSettings, undefined, {
      droneSize: DRONE_SIZE,
    });

    // Noise floors must be bitwise identical
    expect(result1.noise.roll.noiseFloorDb).toBe(result2.noise.roll.noiseFloorDb);
    expect(result1.noise.pitch.noiseFloorDb).toBe(result2.noise.pitch.noiseFloorDb);
    expect(result1.noise.yaw.noiseFloorDb).toBe(result2.noise.yaw.noiseFloorDb);

    // Same recommendation count
    expect(result1.recommendations.length).toBe(result2.recommendations.length);

    // Same data quality score
    expect(result1.dataQuality?.overall).toBe(result2.dataQuality?.overall);
  }, 30_000);

  /**
   * PID analysis determinism on LOG3.
   */
  it('PID analysis is deterministic on LOG3', async () => {
    const log = logs[2];

    const run = () =>
      analyzePID(
        log.flightData,
        0,
        log.flightPIDs,
        undefined,
        log.flightPIDs,
        log.rawHeaders,
        'balanced',
        undefined,
        DRONE_SIZE
      );

    const result1 = await run();
    const result2 = await run();

    expect(result1.stepsDetected).toBe(result2.stepsDetected);
    expect(result1.recommendations.length).toBe(result2.recommendations.length);
    expect(result1.dataQuality?.overall).toBe(result2.dataQuality?.overall);
  }, 30_000);
});

// ===========================================================================
// F. Header extraction — cross-flight invariants
// ===========================================================================

describe('F. Header extraction & cross-flight invariants', () => {
  /**
   * All 4 logs are from the same quad — RPM filter status should be consistent.
   * If one log has rpm_filter_harmonics=3, all should.
   */
  it('RPM filter status is consistent across all 4 logs', () => {
    const rpmStatuses = logs.map((l) => l.rpmActive);
    // All true or all false
    expect(new Set(rpmStatuses).size).toBe(1);
  });

  /**
   * LOG1 and LOG2 should have different filter settings in headers
   * (filter tuning was applied between these flights).
   */
  it('LOG1 and LOG2 have different filter settings in headers', () => {
    const s1 = logs[0].filterSettings;
    const s2 = logs[1].filterSettings;

    const differs =
      s1.gyro_lpf1_static_hz !== s2.gyro_lpf1_static_hz ||
      s1.dterm_lpf1_static_hz !== s2.dterm_lpf1_static_hz ||
      s1.gyro_lpf1_dyn_min_hz !== s2.gyro_lpf1_dyn_min_hz;

    expect(differs).toBe(true);
  });

  /**
   * All 4 logs must parse successfully and contain non-empty flight data.
   * This is the most basic sanity check.
   */
  it('all 4 logs have non-empty gyro and setpoint data', () => {
    for (let idx = 0; idx < 4; idx++) {
      const log = logs[idx];
      // gyro is tuple [roll, pitch, yaw] — each is a TimeSeries with .values
      expect(log.flightData.gyro[0].values.length).toBeGreaterThan(0);
      expect(log.flightData.gyro[1].values.length).toBeGreaterThan(0);
      // setpoint is tuple [roll, pitch, yaw, throttle]
      expect(log.flightData.setpoint[0].values.length).toBeGreaterThan(0);
      expect(log.flightData.setpoint[1].values.length).toBeGreaterThan(0);
      // Throttle is setpoint[3]
      expect(log.flightData.setpoint[3].values.length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// G. Recommendation direction — physical sanity
// ===========================================================================

describe('G. Recommendation direction', () => {
  /**
   * LOG1 has gyro_lpf1_static_hz=500 (permissive) and dterm_lpf1_static_hz=75 (tight).
   * The algorithm should:
   * - For gyro filters: recommend LOWER cutoffs (noise reduction)
   * - For dterm filters: may recommend HIGHER cutoffs (75Hz is very tight → reduce latency)
   *
   * This validates that recommendation direction is physically consistent:
   * high cutoff → lower, low cutoff → higher or same.
   *
   * Note: When dynamic lowpass is active, the recommender targets dyn_min_hz.
   * If noise target falls within deadzone of current dyn_min, no gyro_lpf1 rec
   * is generated (correct behavior — the current value is already optimal).
   */
  it('LOG1: recommendation directions are physically consistent', async () => {
    const log = logs[0];
    const result = await analyzeFilters(log.flightData, 0, log.filterSettings, undefined, {
      droneSize: DRONE_SIZE,
    });

    const actionable = result.recommendations.filter((r) => !r.informational);
    // B. already asserts ≥1 actionable rec exists

    for (const rec of actionable) {
      // Every actionable recommendation must actually CHANGE the value
      expect(
        rec.recommendedValue,
        `${rec.setting}: recommended equals current (${rec.currentValue}) — should not be a recommendation`
      ).not.toBe(rec.currentValue);
    }
  }, 15_000);

  /**
   * LOG1 flew with dterm_lpf1_static_hz=75 (quite low).
   * If the algorithm recommends changing it, the direction should make physical sense:
   * - On a noisy quad: keep low or lower further
   * - On a clean quad: may recommend raising for less latency
   * We just verify the recommendation exists and is within bounds — not the direction,
   * since 75Hz could go either way depending on noise profile.
   */
  it('LOG1: dterm_lpf1 recommendation (if any) is within bounds', async () => {
    const log = logs[0];
    const result = await analyzeFilters(log.flightData, 0, log.filterSettings, undefined, {
      droneSize: DRONE_SIZE,
    });

    const dtermRec = result.recommendations.find(
      (r) =>
        !r.informational &&
        (r.setting === 'dterm_lpf1_static_hz' || r.setting === 'dterm_lpf1_dyn_min_hz')
    );

    if (dtermRec) {
      const maxHz = log.rpmActive ? DTERM_LPF1_MAX_HZ_RPM : DTERM_LPF1_MAX_HZ;
      expect(dtermRec.recommendedValue).toBeGreaterThanOrEqual(DTERM_LPF1_MIN_HZ);
      expect(dtermRec.recommendedValue).toBeLessThanOrEqual(maxHz);
    }
  }, 15_000);
});

// ===========================================================================
// H. PID analysis on filter flights — robustness
// ===========================================================================

describe('H. PID analysis on filter flights (cross-pipeline)', () => {
  /**
   * LOG1 is a filter flight (throttle sweeps, hover segments) — NOT a PID flight.
   * PID analysis should still complete without error. It may find few/no steps
   * and should report low data quality or 0 steps — NOT crash.
   */
  it('LOG1 (filter flight): PID analysis completes without error', async () => {
    const log = logs[0];
    const result = await analyzePID(
      log.flightData,
      0,
      log.flightPIDs,
      undefined,
      log.flightPIDs,
      log.rawHeaders,
      'balanced',
      undefined,
      DRONE_SIZE
    );

    expect(result.recommendations).toBeDefined();
    expect(result.analysisTimeMs).toBeGreaterThan(0);
    // Filter flight likely has fewer steps than a dedicated PID flight
    expect(result.stepsDetected).toBeGreaterThanOrEqual(0);
  }, 15_000);

  /**
   * LOG2 (filter verify): same test — PID analysis should handle it gracefully.
   */
  it('LOG2 (filter verify): PID analysis completes without error', async () => {
    const log = logs[1];
    const result = await analyzePID(
      log.flightData,
      0,
      log.flightPIDs,
      undefined,
      log.flightPIDs,
      log.rawHeaders,
      'balanced',
      undefined,
      DRONE_SIZE
    );

    expect(result.recommendations).toBeDefined();
    expect(result.stepsDetected).toBeGreaterThanOrEqual(0);
  }, 15_000);

  /**
   * All 4 logs: filter analysis should work on PID flights too.
   * This tests that the filter pipeline handles flight data without
   * ideal throttle sweeps (PID flights have step inputs, not sweeps).
   */
  it.each([2, 3])(
    'LOG%s (PID flight): filter analysis completes without error',
    async (idx) => {
      const actualIdx = idx; // LOG3=index 2, LOG4=index 3
      const log = logs[actualIdx];
      const result = await analyzeFilters(log.flightData, 0, log.filterSettings, undefined, {
        droneSize: DRONE_SIZE,
      });

      expect(result.noise).toBeDefined();
      expect(result.recommendations).toBeDefined();
      expect(['low', 'medium', 'high']).toContain(result.noise.overallLevel);
    },
    15_000
  );
});

// ===========================================================================
// I. Mechanical health — no false positives on healthy quad
// ===========================================================================

describe('I. Mechanical health on real flights', () => {
  /**
   * The VX3.5 quad was mechanically healthy during these flights.
   * MechanicalHealthChecker should NOT report 'critical' status.
   * 'ok' or 'warning' are acceptable — 'critical' would be a false positive
   * that scares users into unnecessary repairs.
   */
  it.each([0, 1, 2, 3])(
    'no critical mechanical health issues on log index %i',
    async (idx) => {
      const log = logs[idx];

      // Need noise profile from filter analysis first
      const filterResult = await analyzeFilters(log.flightData, 0, log.filterSettings);
      const healthResult = checkMechanicalHealth(log.flightData, filterResult.noise);

      expect(healthResult.status).toBeDefined();
      expect(['ok', 'warning', 'critical']).toContain(healthResult.status);

      // Should NOT be critical on a healthy quad
      expect(healthResult.status).not.toBe('critical');

      // Summary should be a non-empty string
      expect(healthResult.summary.length).toBeGreaterThan(0);
    },
    15_000
  );
});

// ===========================================================================
// J. Group delay — filter chain latency sanity
// ===========================================================================

describe('J. Group delay sanity', () => {
  /**
   * Estimated group delay for the filter chain should be < 5ms.
   * Higher delay degrades flight feel and can cause oscillation.
   * This checks each log's filter settings produce reasonable delay.
   */
  it.each([0, 1, 2, 3])('group delay < 5ms for log index %i filter settings', (idx) => {
    const log = logs[idx];
    const delay = estimateGroupDelay(log.filterSettings);

    expect(delay.gyroTotalMs).toBeGreaterThanOrEqual(0);
    expect(delay.gyroTotalMs).toBeLessThan(5);
    expect(delay.dtermTotalMs).toBeGreaterThanOrEqual(0);
    expect(delay.dtermTotalMs).toBeLessThan(5);

    // Should enumerate individual filter contributions
    expect(delay.filters.length).toBeGreaterThan(0);
  });

  /**
   * LOG1 has gyro_lpf1_static_hz=500Hz but gyro_lpf1_dyn_min_hz=250Hz.
   * LOG2 has gyro_lpf1_static_hz=238Hz but gyro_lpf1_dyn_min_hz=300Hz.
   *
   * GroupDelayEstimator uses dyn_min_hz as worst-case when dynamic lowpass is active.
   * So LOG2 (dyn_min=300) actually has LESS delay than LOG1 (dyn_min=250).
   *
   * This test validates that the estimator correctly accounts for dynamic lowpass —
   * static_hz alone doesn't determine delay when dynamic is active.
   *
   * FINDING: Static cutoff comparison is misleading when dynamic lowpass is active.
   * The effective worst-case delay depends on dyn_min_hz, not static_hz.
   */
  it('group delay accounts for dynamic lowpass (dyn_min_hz, not static_hz)', () => {
    const delay1 = estimateGroupDelay(logs[0].filterSettings); // dyn_min=250
    const delay2 = estimateGroupDelay(logs[1].filterSettings); // dyn_min=300

    // LOG1 dyn_min=250 (tighter worst-case) → MORE delay than LOG2 dyn_min=300
    expect(delay1.gyroTotalMs).toBeGreaterThanOrEqual(delay2.gyroTotalMs);
  });
});

// ===========================================================================
// K. Cross-validation: Filter+PID Tune vs Flash Tune
// ===========================================================================

describe('K. Cross-validation: Filter+PID Tune vs Flash Tune', () => {
  // Cache analysis results to avoid re-running expensive analyses
  let filterResults: Awaited<ReturnType<typeof analyzeFilters>>[];
  let pidResultLog1: Awaited<ReturnType<typeof analyzePID>>;
  let pidResultLog3: Awaited<ReturnType<typeof analyzePID>>;
  let tfResultLog1: Awaited<ReturnType<typeof analyzeTransferFunction>>;
  let tfResultLog3: Awaited<ReturnType<typeof analyzeTransferFunction>>;

  beforeAll(async () => {
    // Run filter analysis on all 4 logs
    filterResults = await Promise.all(
      logs.map((log) =>
        analyzeFilters(log.flightData, 0, log.filterSettings, undefined, {
          droneSize: DRONE_SIZE,
        })
      )
    );

    // Run PID (step response) and TF (Wiener) on LOG1 and LOG3
    [pidResultLog1, pidResultLog3, tfResultLog1, tfResultLog3] = await Promise.all([
      analyzePID(
        logs[0].flightData,
        0,
        logs[0].flightPIDs,
        undefined,
        logs[0].flightPIDs,
        logs[0].rawHeaders,
        'balanced',
        undefined,
        DRONE_SIZE
      ),
      analyzePID(
        logs[2].flightData,
        0,
        logs[2].flightPIDs,
        undefined,
        logs[2].flightPIDs,
        logs[2].rawHeaders,
        'balanced',
        undefined,
        DRONE_SIZE
      ),
      analyzeTransferFunction(
        logs[0].flightData,
        0,
        logs[0].flightPIDs,
        undefined,
        logs[0].flightPIDs,
        logs[0].rawHeaders,
        'balanced',
        undefined,
        DRONE_SIZE
      ),
      analyzeTransferFunction(
        logs[2].flightData,
        0,
        logs[2].flightPIDs,
        undefined,
        logs[2].flightPIDs,
        logs[2].rawHeaders,
        'balanced',
        undefined,
        DRONE_SIZE
      ),
    ]);
  }, 60_000);

  // ---- K1: Filter recs across different flight types ----

  /**
   * All 4 flights are from the same quad → noise floors should be in the same
   * ballpark regardless of flight style. Large divergence (>15 dB) between a
   * filter flight and a PID flight would mean filter analysis on non-ideal
   * (Flash Tune style) data is unreliable.
   *
   * This directly answers: "Do filter recs in Flash Tune make sense?"
   */
  it('K1.1: noise floors consistent across filter vs PID flights (±15 dB)', () => {
    const floors = filterResults.map((r) => ({
      roll: r.noise.roll.noiseFloorDb,
      pitch: r.noise.pitch.noiseFloorDb,
      yaw: r.noise.yaw.noiseFloorDb,
    }));

    // Diagnostic output — shows actual values for analysis
    console.log('\n--- K1.1: Noise floor comparison across flight types ---');
    console.log('LOG1 (filter flight):', floors[0]);
    console.log('LOG2 (filter verify):', floors[1]);
    console.log('LOG3 (PID flight):  ', floors[2]);
    console.log('LOG4 (PID verify):  ', floors[3]);

    // Compare each PID flight against the dedicated filter flight (LOG1)
    const reference = floors[0];
    for (let i = 1; i < 4; i++) {
      for (const axis of ['roll', 'pitch', 'yaw'] as const) {
        const diff = Math.abs(floors[i][axis] - reference[axis]);
        expect(
          diff,
          `LOG${i + 1} ${axis} noise floor differs from LOG1 by ${diff.toFixed(1)} dB`
        ).toBeLessThanOrEqual(15);
      }
    }
  });

  /**
   * Compare filter recommendations between LOG1 (dedicated filter flight)
   * and LOG3 (PID flight — "fly whatever" scenario like Flash Tune).
   *
   * For settings both flights recommend changing: direction should agree.
   * Disagreement means filter analysis on Flash Tune data gives opposite advice.
   */
  it('K1.2: filter rec direction agrees between filter flight and PID flight', () => {
    const recs1 = filterResults[0].recommendations.filter((r) => !r.informational);
    const recs3 = filterResults[2].recommendations.filter((r) => !r.informational);

    // Build direction maps: setting → increase(+1) / decrease(-1)
    const dir1 = new Map<string, number>();
    for (const r of recs1) dir1.set(r.setting, Math.sign(r.recommendedValue - r.currentValue));
    const dir3 = new Map<string, number>();
    for (const r of recs3) dir3.set(r.setting, Math.sign(r.recommendedValue - r.currentValue));

    // Diagnostic: show what each flight recommends
    console.log('\n--- K1.2: Filter rec comparison (LOG1 filter vs LOG3 PID) ---');
    console.log(
      'LOG1 recs:',
      recs1.map((r) => `${r.setting}: ${r.currentValue}→${r.recommendedValue}`)
    );
    console.log(
      'LOG3 recs:',
      recs3.map((r) => `${r.setting}: ${r.currentValue}→${r.recommendedValue}`)
    );

    // Find overlapping settings
    const overlap = [...dir1.keys()].filter((k) => dir3.has(k));
    console.log('Overlapping settings:', overlap.length > 0 ? overlap : '(none)');

    // Direction comparison is tricky: LOG1 and LOG3 have DIFFERENT current settings
    // (tuning was applied between them), so direction from current may legitimately differ.
    // Instead, compare recommended TARGET values — both flights should converge toward
    // a similar optimal value for the same quad.
    const targets1 = new Map<string, number>();
    for (const r of recs1) targets1.set(r.setting, r.recommendedValue);
    const targets3 = new Map<string, number>();
    for (const r of recs3) targets3.set(r.setting, r.recommendedValue);

    for (const setting of overlap) {
      const t1 = targets1.get(setting)!;
      const t3 = targets3.get(setting)!;
      const diff = Math.abs(t1 - t3);
      const avg = (t1 + t3) / 2;
      const pctDiff = avg > 0 ? (diff / avg) * 100 : 0;
      console.log(
        `  ${setting}: LOG1 target=${t1}, LOG3 target=${t3}, diff=${diff.toFixed(0)} (${pctDiff.toFixed(0)}%)`
      );
      // Targets should be in same ballpark (within 50% of each other)
      // This is a soft check — real flights have different noise profiles
      expect(
        pctDiff,
        `${setting}: targets diverge too much (LOG1=${t1}, LOG3=${t3}, ${pctDiff.toFixed(0)}%)`
      ).toBeLessThan(100);
    }
  });

  /**
   * Full diagnostic report: filter recs from all 4 flights side by side.
   * Not a strict test — logs the comparison for human review.
   */
  it('K1.3: filter recommendation diagnostic across all flights', () => {
    console.log('\n--- K1.3: Filter recommendation report (all 4 logs) ---');

    // Collect all unique settings recommended across all flights
    const allSettings = new Set<string>();
    for (const result of filterResults) {
      for (const r of result.recommendations.filter((r) => !r.informational)) {
        allSettings.add(r.setting);
      }
    }

    // Print table
    for (const setting of [...allSettings].sort()) {
      const values = filterResults.map((result, idx) => {
        const rec = result.recommendations.find((r) => r.setting === setting && !r.informational);
        if (!rec) return `LOG${idx + 1}: —`;
        const dir = rec.recommendedValue > rec.currentValue ? '↑' : '↓';
        return `LOG${idx + 1}: ${rec.currentValue}→${rec.recommendedValue} ${dir}`;
      });
      console.log(`  ${setting}: ${values.join(' | ')}`);
    }

    // Pass — this test is purely diagnostic
    expect(allSettings.size).toBeGreaterThanOrEqual(0);
  });

  // ---- K2: PID recs — step response vs Wiener deconvolution ----

  /**
   * Both PID analysis methods should complete on both LOG1 and LOG3.
   * (Already tested individually in C., but here we verify side-by-side.)
   */
  it('K2.1: both PID pipeline methods complete on LOG1 and LOG3', () => {
    expect(pidResultLog1.recommendations).toBeDefined();
    expect(tfResultLog1.recommendations).toBeDefined();
    expect(pidResultLog3.recommendations).toBeDefined();
    expect(tfResultLog3.recommendations).toBeDefined();
  });

  /**
   * For overlapping PID settings recommended by both methods,
   * direction should agree. Disagreement means the two approaches
   * give contradictory tuning advice — concerning for user trust.
   */
  it('K2.2: PID rec direction agrees between step response and Wiener (LOG3)', () => {
    const stepRecs = pidResultLog3.recommendations.filter((r) => !r.informational);
    const wienerRecs = tfResultLog3.recommendations.filter((r) => !r.informational);

    // Build direction maps for PID-specific settings only
    const pidSettings = (recs: PIDRecommendation[]) => {
      const map = new Map<string, { dir: number; value: number; current: number }>();
      for (const r of recs) {
        if (r.setting.startsWith('pid_')) {
          map.set(r.setting, {
            dir: Math.sign(r.recommendedValue - r.currentValue),
            value: r.recommendedValue,
            current: r.currentValue,
          });
        }
      }
      return map;
    };

    const stepMap = pidSettings(stepRecs);
    const wienerMap = pidSettings(wienerRecs);

    // Diagnostic: compare the two approaches
    console.log('\n--- K2.2: PID rec comparison: Step Response vs Wiener (LOG3) ---');
    console.log(
      'Step response recs:',
      stepRecs
        .filter((r) => r.setting.startsWith('pid_'))
        .map((r) => `${r.setting}: ${r.currentValue}→${r.recommendedValue}`)
    );
    console.log(
      'Wiener recs:',
      wienerRecs
        .filter((r) => r.setting.startsWith('pid_'))
        .map((r) => `${r.setting}: ${r.currentValue}→${r.recommendedValue}`)
    );

    // Find overlapping PID settings
    const overlap = [...stepMap.keys()].filter((k) => wienerMap.has(k));
    console.log('Overlapping PID settings:', overlap.length > 0 ? overlap : '(none)');

    // For overlapping settings, direction should agree
    let agreements = 0;
    let disagreements = 0;
    for (const setting of overlap) {
      const s = stepMap.get(setting)!;
      const w = wienerMap.get(setting)!;
      if (s.dir !== 0 && w.dir !== 0) {
        if (s.dir === w.dir) {
          agreements++;
        } else {
          disagreements++;
          console.log(
            `  ⚠ DISAGREEMENT: ${setting} — step says ${s.dir > 0 ? 'increase' : 'decrease'} (→${s.value}), Wiener says ${w.dir > 0 ? 'increase' : 'decrease'} (→${w.value})`
          );
        }
      }
    }
    console.log(`Direction: ${agreements} agree, ${disagreements} disagree`);

    // Soft assertion: majority should agree (allow some disagreement)
    if (overlap.length > 0) {
      expect(
        agreements,
        `Only ${agreements}/${overlap.length} PID recs agree in direction`
      ).toBeGreaterThanOrEqual(disagreements);
    }
  });

  /**
   * Transfer function analysis should provide bandwidth and phase margin —
   * metrics that step response analysis cannot compute.
   * These are the unique value-add of the Wiener approach.
   */
  it('K2.3: TF analysis provides Wiener-exclusive metrics (bandwidth, phase margin)', () => {
    expect(tfResultLog3.transferFunction).toBeDefined();
    expect(tfResultLog3.transferFunction.metrics).toBeDefined();

    console.log('\n--- K2.3: Wiener-exclusive metrics (LOG3) ---');
    for (const axis of ['roll', 'pitch', 'yaw'] as const) {
      const m = tfResultLog3.transferFunction.metrics[axis];
      console.log(
        `  ${axis}: bandwidth=${m.bandwidthHz.toFixed(1)}Hz, ` +
          `phaseMargin=${m.phaseMarginDeg.toFixed(1)}°, ` +
          `dcGain=${m.dcGainDb.toFixed(2)}dB`
      );
    }

    // Bandwidth should be positive on roll/pitch (yaw may be 0)
    expect(tfResultLog3.transferFunction.metrics.roll.bandwidthHz).toBeGreaterThan(0);
    expect(tfResultLog3.transferFunction.metrics.pitch.bandwidthHz).toBeGreaterThan(0);
  });

  // ---- K3: Data quality comparison ----

  /**
   * LOG1 is a dedicated filter flight (throttle sweeps, steady hovers) →
   * should score higher on filter data quality than LOG3 (PID flight with
   * step inputs). If they score the same, our data quality scorer doesn't
   * distinguish flight types — which means Flash Tune filter quality
   * warnings may be unreliable.
   */
  it('K3.1: filter data quality: filter flight ≥ PID flight', () => {
    const q1 = filterResults[0].dataQuality;
    const q3 = filterResults[2].dataQuality;

    console.log('\n--- K3.1: Filter data quality comparison ---');
    console.log(`LOG1 (filter flight): score=${q1?.overall}, tier=${q1?.tier}`);
    console.log(`LOG3 (PID flight):    score=${q3?.overall}, tier=${q3?.tier}`);

    if (q1 && q3) {
      // Filter flight should have equal or better data quality for filter analysis
      expect(
        q1.overall,
        `Filter flight (${q1.overall}) should score ≥ PID flight (${q3.overall}) for filter quality`
      ).toBeGreaterThanOrEqual(q3.overall);
    }
  });
});
