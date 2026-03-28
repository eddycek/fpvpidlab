/**
 * Demo mode PID Tune cycle E2E test.
 *
 * Walks through one complete PID Tune cycle:
 *   Start (PID) → Erase → (auto-flight) → Download → PID Wizard → Apply →
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

test.describe.serial('PID Tune cycle', () => {
  test('start pid tune session', async () => {
    await demo.clickButton('Start Tuning Session');

    // StartTuningModal opens — select PID Tune
    await demo.page.locator('.start-tuning-modal .start-tuning-option', { has: demo.page.locator('.start-tuning-option-title', { hasText: 'PID Tune' }) }).click();

    // Should show pid_flight_pending phase
    await demo.waitForText('Erase Blackbox data');
    await demo.screenshot('pid-02-tuning-started');
  });

  test('erase flash for pid flight', async () => {
    await demo.clickButton('Erase Flash');

    // After erase, demo auto-flight kicks in (3s) then reconnects (1.5s)
    // Wait for the phase to advance to pid_log_ready
    await demo.waitForText('PID flight done', 20_000);
    await demo.screenshot('pid-03-pid-flight-done');
  });

  test('download pid log', async () => {
    await demo.clickButton('Download Log');

    // Wait for download + parse to complete → pid_analysis phase
    await demo.waitForText('Open PID Wizard', 20_000);
    await demo.screenshot('pid-04-pid-log-downloaded');
  });

  test('run pid analysis in wizard', async () => {
    await demo.clickButton('Open PID Wizard');

    // Wizard opens at PIDs step — analysis does NOT auto-run
    await demo.clickButton('Run PID Analysis');

    // Wait for analysis to complete — shows "Continue to Summary"
    await demo.page
      .getByRole('button', { name: /Continue to Summary/i })
      .waitFor({ state: 'visible', timeout: 60_000 });
    await demo.screenshot('pid-05-pid-analysis-done');
  });

  test('apply pids via wizard', async () => {
    // Navigate to summary step
    await demo.clickButton(/Continue to Summary/i);

    // Summary shows "Apply PIDs" button (mode=pid)
    await demo.page
      .getByRole('button', { name: 'Apply PIDs' })
      .waitFor({ state: 'visible', timeout: 10_000 });
    await demo.screenshot('pid-06-pid-summary');

    // Click Apply PIDs → opens ApplyConfirmationModal
    await demo.clickButton('Apply PIDs');

    // Modal has "Apply Changes" button — click it
    const applyBtns = demo.page.getByRole('button', { name: 'Apply Changes' });
    await applyBtns.last().waitFor({ state: 'visible', timeout: 5_000 });
    await applyBtns.last().click();

    // Wait for apply to complete — shows "Close Wizard"
    await demo.page
      .getByRole('button', { name: 'Close Wizard' })
      .waitFor({ state: 'visible', timeout: 30_000 });
    await demo.screenshot('pid-07-pids-applied');

    // Close wizard — return to dashboard
    await demo.clickButton('Close Wizard');
  });

  test('run verification flight and complete', async () => {
    // After pid apply + reboot, dashboard shows pid_applied with "Erase & Verify"
    await demo.page
      .getByRole('button', { name: 'Erase & Verify' })
      .waitFor({ state: 'visible', timeout: 30_000 });

    await demo.clickButton('Erase & Verify');

    // Erase + auto-flight → reconnect with verification data → pid_verification_pending
    await demo.waitForText('Download Log', 20_000);
    await demo.clickButton('Download Log');

    // Download completes → "Analyze Verification" button appears
    await demo.waitForText('Analyze Verification', 20_000);
    await demo.clickButton('Analyze Verification');

    // VerificationSessionModal auto-analyzes single-session log → session completes
    await demo.waitForText(/PID Tune Complete/i, 30_000);
    await demo.screenshot('pid-08-tuning-complete');
  });

  test('dismiss completed session and check history', async () => {
    // Click Dismiss to archive and return to dashboard
    const dismissBtn = demo.page.getByRole('button', { name: 'Dismiss', exact: true });
    await dismissBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await dismissBtn.click();

    // Tuning History should now show the completed session
    await demo.waitForText('Tuning History', 10_000);
    await demo.screenshot('pid-09-history-visible');

    // Verify quality score badge is displayed
    const badge = demo.page.locator('.quality-badge, [class*="quality"]');
    await expect(badge.first()).toBeVisible({ timeout: 5000 });
  });
});
