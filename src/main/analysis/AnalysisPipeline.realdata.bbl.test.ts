/**
 * Integration test: parse a REAL BBL file and validate header extraction.
 *
 * Uses test-fixtures/bbl/blackbox_2026-03-29T11-09-44-682Z.bbl from a
 * VX3.5 quad (SpeedyBee F405 Mini, BF 4.5.2, 3.5", 4S).
 *
 * This test ensures our BBL parser + header enrichment + extractor functions
 * produce correct values from actual flight controller output — not synthetic data.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { BlackboxParser } from '../blackbox/BlackboxParser';
import { enrichSettingsFromBBLHeaders } from './headerValidation';
import { DEFAULT_FILTER_SETTINGS } from '@shared/types/analysis.types';
import {
  extractFlightPIDs,
  extractDMinContext,
  extractTPAContext,
  extractItermRelaxMode,
  extractItermRelaxCutoff,
} from './PIDRecommender';

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../test-fixtures/bbl/blackbox_2026-03-29T11-09-44-682Z.bbl'
);

describe('real BBL integration test (VX3.5 BF 4.5.2)', () => {
  let rawHeaders: Map<string, string>;

  // Parse once, reuse across tests
  beforeAll(async () => {
    const data = await fs.readFile(FIXTURE_PATH);
    const result = await BlackboxParser.parse(data);
    expect(result.success).toBe(true);
    expect(result.sessions.length).toBeGreaterThan(0);
    rawHeaders = result.sessions[0].header.rawHeaders;
  });

  // ---- Raw header presence ----

  it('should have key BBL headers present', () => {
    expect(rawHeaders.get('rollPID')).toBeDefined();
    expect(rawHeaders.get('pitchPID')).toBeDefined();
    expect(rawHeaders.get('yawPID')).toBeDefined();
    expect(rawHeaders.get('d_min')).toBeDefined();
    expect(rawHeaders.get('d_max_gain')).toBeDefined();
    expect(rawHeaders.get('iterm_relax')).toBeDefined();
    expect(rawHeaders.get('iterm_relax_cutoff')).toBeDefined();
    expect(rawHeaders.get('tpa_rate')).toBeDefined();
    expect(rawHeaders.get('gyro_lpf1_dyn_hz')).toBeDefined();
    expect(rawHeaders.get('dterm_lpf1_dyn_hz')).toBeDefined();
    expect(rawHeaders.get('rpm_filter_harmonics')).toBeDefined();
    expect(rawHeaders.get('dyn_notch_count')).toBeDefined();
  });

  // ---- Filter settings enrichment ----

  it('should enrich dynamic lowpass from CSV headers', () => {
    const enriched = enrichSettingsFromBBLHeaders(DEFAULT_FILTER_SETTINGS, rawHeaders);
    expect(enriched).not.toBeNull();

    // gyro_lpf1_dyn_hz:250,500
    expect(enriched!.gyro_lpf1_dyn_min_hz).toBe(250);
    expect(enriched!.gyro_lpf1_dyn_max_hz).toBe(500);

    // dterm_lpf1_dyn_hz:75,150
    expect(enriched!.dterm_lpf1_dyn_min_hz).toBe(75);
    expect(enriched!.dterm_lpf1_dyn_max_hz).toBe(150);

    // dterm_lpf1_dyn_expo:5
    expect(enriched!.dterm_lpf1_dyn_expo).toBe(5);
  });

  it('should enrich RPM and dynamic notch settings', () => {
    const enriched = enrichSettingsFromBBLHeaders(DEFAULT_FILTER_SETTINGS, rawHeaders);
    expect(enriched).not.toBeNull();

    expect(enriched!.rpm_filter_harmonics).toBe(3);
    expect(enriched!.rpm_filter_min_hz).toBe(100);
    expect(enriched!.rpm_filter_q).toBe(500);
    expect(enriched!.dyn_notch_count).toBe(1);
    expect(enriched!.dyn_notch_q).toBe(500);
  });

  // ---- Flight PIDs ----

  it('should extract flight PIDs from CSV format (rollPID:45,80,40)', () => {
    const pids = extractFlightPIDs(rawHeaders);
    expect(pids).toBeDefined();
    expect(pids!.roll).toEqual({ P: 45, I: 80, D: 40 });
    expect(pids!.pitch).toEqual({ P: 47, I: 84, D: 46 });
    expect(pids!.yaw).toEqual({ P: 45, I: 80, D: 0 });
  });

  // ---- D-min context ----

  it('should extract d_min from CSV format (d_min:30,34,0)', () => {
    const ctx = extractDMinContext(rawHeaders);
    expect(ctx.active).toBe(true);
    expect(ctx.roll).toBe(30);
    expect(ctx.pitch).toBe(34);
    expect(ctx.yaw).toBe(0);
  });

  it('should extract d_max_gain (not d_min_gain)', () => {
    const ctx = extractDMinContext(rawHeaders);
    expect(ctx.gain).toBe(37); // d_max_gain:37
  });

  // ---- I-term relax ----

  it('should extract iterm_relax mode', () => {
    const mode = extractItermRelaxMode(rawHeaders);
    expect(mode).toBe(1); // 1 = RP mode
  });

  it('should extract iterm_relax_cutoff', () => {
    const cutoff = extractItermRelaxCutoff(rawHeaders);
    expect(cutoff).toBe(15);
  });

  // ---- TPA ----

  it('should extract TPA context', () => {
    const ctx = extractTPAContext(rawHeaders);
    expect(ctx.active).toBe(true);
    expect(ctx.rate).toBe(65);
    expect(ctx.breakpoint).toBe(1350);
    expect(ctx.mode).toBe(1); // PD mode
  });

  it('should extract TPA low-throttle fields (BF 4.5+)', () => {
    const ctx = extractTPAContext(rawHeaders);
    expect(ctx.lowRate).toBe(20);
    expect(ctx.lowBreakpoint).toBe(1050);
    expect(ctx.lowAlways).toBe(0);
  });
});
