/**
 * Demo mode Filter Tune cycle E2E test.
 *
 * Walks through one complete Filter Tune cycle:
 *   Start (Filter) → Erase → (auto-flight) → Download → Filter Wizard → Apply →
 *   Erase & Verify → (verification flight) → Download → Analyze → Complete → Dismiss
 *
 * Then verifies the tuning history shows the completed session.
 */
import { test, expect } from '@playwright/test';
import { launchDemoApp, type DemoApp } from './electron-app';

let demo: DemoApp;

test.beforeAll(async () => {
  demo = await launchDemoApp();
  await demo.waitForDemoReady();
});

test.afterAll(async () => {
  await demo?.close();
});

test.describe.serial('Filter Tune cycle', () => {
  test('start filter tune session', async () => {
    await demo.clickButton('Start Tuning Session');

    // StartTuningModal opens — select Filter Tune
    await demo.page.locator('.start-tuning-modal .start-tuning-option', { has: demo.page.locator('.start-tuning-option-title', { hasText: 'Filter Tune' }) }).click();

    // Should show filter_flight_pending phase
    await demo.waitForText('Erase Blackbox data');
    await demo.screenshot('02-tuning-started');
  });

  test('erase flash for filter flight', async () => {
    await demo.clickButton('Erase Flash');

    // After erase, demo auto-flight kicks in (3s) then reconnects (1.5s)
    // Wait for the phase to advance to filter_log_ready
    await demo.waitForText('Filter flight done', 20_000);
    await demo.screenshot('03-filter-flight-done');
  });

  test('download filter log', async () => {
    await demo.clickButton('Download Log');

    // Wait for download + parse to complete → filter_analysis phase
    await demo.waitForText('Open Filter Wizard', 20_000);
    await demo.screenshot('04-filter-log-downloaded');
  });

  test('run filter analysis in wizard', async () => {
    await demo.clickButton('Open Filter Wizard');

    // Wizard opens at Filters step — analysis does NOT auto-run
    await demo.clickButton('Run Filter Analysis');

    // Wait for analysis to complete — shows "Continue to Summary"
    await demo.page
      .getByRole('button', { name: /Continue to Summary/i })
      .waitFor({ state: 'visible', timeout: 60_000 });
    await demo.screenshot('05-filter-analysis-done');
  });

  test('apply filters via wizard', async () => {
    // Navigate to summary step
    await demo.clickButton(/Continue to Summary/i);

    // Summary shows "Apply Filters" button (mode=filter)
    await demo.page
      .getByRole('button', { name: 'Apply Filters' })
      .waitFor({ state: 'visible', timeout: 10_000 });
    await demo.screenshot('06-filter-summary');

    // Click Apply Filters → opens ApplyConfirmationModal
    await demo.clickButton('Apply Filters');

    // Modal has "Apply Changes" button — click it
    const applyBtns = demo.page.getByRole('button', { name: 'Apply Changes' });
    await applyBtns.last().waitFor({ state: 'visible', timeout: 5_000 });
    await applyBtns.last().click();

    // Wait for apply to complete — shows "Close Wizard"
    await demo.page
      .getByRole('button', { name: 'Close Wizard' })
      .waitFor({ state: 'visible', timeout: 30_000 });
    await demo.screenshot('07-filters-applied');

    // Close wizard — return to dashboard
    await demo.clickButton('Close Wizard');
  });

  test('run verification flight and complete', async () => {
    // After filter apply + reboot, dashboard shows filter_applied with "Erase & Verify"
    await demo.page
      .getByRole('button', { name: 'Erase & Verify' })
      .waitFor({ state: 'visible', timeout: 30_000 });

    await demo.clickButton('Erase & Verify');

    // Erase + auto-flight → reconnect with verification data → filter_verification_pending
    await demo.waitForText('Download Log', 20_000);
    await demo.clickButton('Download Log');

    // Download completes → "Analyze Verification" button appears
    await demo.waitForText('Analyze Verification', 20_000);
    await demo.clickButton('Analyze Verification');

    // VerificationSessionModal auto-analyzes single-session log → session completes
    await demo.waitForText(/Filter Tune Complete/i, 30_000);
    await demo.screenshot('08-tuning-complete');
  });

  test('dismiss completed session and check history', async () => {
    // Click Dismiss to archive and return to dashboard
    const dismissBtn = demo.page.getByRole('button', { name: 'Dismiss', exact: true });
    await dismissBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await dismissBtn.click();

    // Tuning History should now show the completed session
    await demo.waitForText('Tuning History', 10_000);
    await demo.screenshot('09-history-visible');

    // Verify quality score badge is displayed
    const badge = demo.page.locator('.quality-badge, [class*="quality"]');
    await expect(badge.first()).toBeVisible({ timeout: 5000 });
  });
});
