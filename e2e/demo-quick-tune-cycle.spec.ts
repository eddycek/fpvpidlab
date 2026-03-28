/**
 * Demo mode Flash Tune cycle E2E test.
 *
 * Walks through one complete Flash Tune cycle:
 *   Start (Flash) → Erase → (auto-flight) → Download → Flash Tune Wizard
 *   (auto-runs filter + TF analysis) → Apply All → Erase & Verify →
 *   (verification flight) → Download → Analyze → Complete → Dismiss
 *
 * Then verifies the tuning history shows the completed session with "(Flash Tune)" label.
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

test.describe.serial('Flash Tune cycle', () => {
  test('start flash tune session', async () => {
    await demo.clickButton('Start Tuning Session');

    // StartTuningModal opens — select Flash Tune
    await demo.page.locator('.start-tuning-modal .start-tuning-option', { has: demo.page.locator('.start-tuning-option-title', { hasText: 'Flash Tune' }) }).click();

    // Should show flash_flight_pending phase
    await demo.waitForText('Erase Blackbox data');
    await demo.screenshot('quick-01-started');
  });

  test('erase flash for flash tune flight', async () => {
    await demo.clickButton('Erase Flash');

    // After erase, demo auto-flight → reconnect → flash_log_ready
    await demo.waitForText('Flight done', 20_000);
    await demo.screenshot('quick-02-flight-done');
  });

  test('download flash tune log', async () => {
    await demo.clickButton('Download Log');

    // Wait for download + parse → flash_analysis phase
    await demo.waitForText('Open Flash Tune Wizard', 20_000);
    await demo.screenshot('quick-03-log-downloaded');
  });

  test('run flash tune analysis in wizard', async () => {
    await demo.clickButton('Open Flash Tune Wizard');

    // Flash Tune wizard auto-runs both analyses in parallel
    // Wait for "Continue to Summary" to appear (both analyses done)
    await demo.page
      .getByRole('button', { name: /Continue to Summary/i })
      .waitFor({ state: 'visible', timeout: 60_000 });
    await demo.screenshot('quick-04-analysis-done');
  });

  test('apply all changes via wizard', async () => {
    await demo.clickButton(/Continue to Summary/i);

    // Summary shows "Apply All Changes" button (mode=flash)
    await demo.page
      .getByRole('button', { name: 'Apply All Changes' })
      .waitFor({ state: 'visible', timeout: 10_000 });
    await demo.screenshot('quick-05-summary');

    // Click Apply All Changes → opens ApplyConfirmationModal
    await demo.clickButton('Apply All Changes');

    // Click "Apply Changes" in modal
    const applyBtns = demo.page.getByRole('button', { name: 'Apply Changes' });
    await applyBtns.last().waitFor({ state: 'visible', timeout: 5_000 });
    await applyBtns.last().click();

    // Wait for apply to complete
    await demo.page
      .getByRole('button', { name: 'Close Wizard' })
      .waitFor({ state: 'visible', timeout: 30_000 });
    await demo.screenshot('quick-06-applied');

    await demo.clickButton('Close Wizard');
  });

  test('run verification flight and complete', async () => {
    // After apply + reboot, dashboard shows flash_applied with "Erase & Verify"
    await demo.page
      .getByRole('button', { name: 'Erase & Verify' })
      .waitFor({ state: 'visible', timeout: 30_000 });

    await demo.clickButton('Erase & Verify');

    // Erase + auto-flight → reconnect with verification data → flash_verification_pending
    await demo.waitForText('Download Log', 20_000);
    await demo.clickButton('Download Log');

    // Download completes → "Analyze Verification" button appears
    await demo.waitForText('Analyze Verification', 20_000);
    await demo.clickButton('Analyze Verification');

    // VerificationSessionModal auto-analyzes single-session log → session completes
    await demo.waitForText(/Flash Tune Complete/i, 30_000);
    await demo.screenshot('quick-07-complete');
  });

  test('dismiss and check history shows flash tune', async () => {
    const dismissBtn = demo.page.getByRole('button', { name: 'Dismiss', exact: true });
    await dismissBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await dismissBtn.click();

    // Tuning History should show the completed Flash Tune session
    await demo.waitForText('Tuning History', 10_000);
    await demo.waitForText('Flash Tune', 10_000);
    await demo.screenshot('quick-08-history');
  });
});
