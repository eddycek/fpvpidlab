/**
 * Demo mode Quick Tune cycle E2E test.
 *
 * Walks through one complete Quick Tune cycle:
 *   Start (Quick) → Erase → (auto-flight) → Download → Quick Wizard
 *   (auto-runs filter + TF analysis) → Apply All → Skip verification → Complete → Dismiss
 *
 * Then verifies the tuning history shows the completed session with "(Quick Tune)" label.
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

test.describe.serial('quick tune cycle', () => {
  test('start quick tune session', async () => {
    await demo.clickButton('Start Tuning Session');

    // StartTuningModal opens — select Quick Tune
    await demo.clickButton('Quick Tune');

    // Should show quick_flight_pending phase
    await demo.waitForText('Erase Blackbox data');
    await demo.screenshot('quick-01-started');
  });

  test('erase flash for quick flight', async () => {
    await demo.clickButton('Erase Flash');

    // After erase, demo auto-flight → reconnect → quick_log_ready
    await demo.waitForText('Flight done', 20_000);
    await demo.screenshot('quick-02-flight-done');
  });

  test('download quick log', async () => {
    await demo.clickButton('Download Log');

    // Wait for download + parse → quick_analysis phase
    await demo.waitForText('Open Quick Wizard', 20_000);
    await demo.screenshot('quick-03-log-downloaded');
  });

  test('run quick analysis in wizard', async () => {
    await demo.clickButton('Open Quick Wizard');

    // Quick wizard auto-runs both analyses in parallel
    // Wait for "Continue to Summary" to appear (both analyses done)
    await demo.page
      .getByRole('button', { name: /Continue to Summary/i })
      .waitFor({ state: 'visible', timeout: 60_000 });
    await demo.screenshot('quick-04-analysis-done');
  });

  test('apply all changes via wizard', async () => {
    await demo.clickButton(/Continue to Summary/i);

    // Summary shows "Apply All Changes" button (mode=quick)
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

  test('skip verification and complete', async () => {
    // After apply + reboot, dashboard shows quick_applied with "Skip & Complete"
    await demo.page
      .getByRole('button', { name: 'Skip & Complete' })
      .waitFor({ state: 'visible', timeout: 30_000 });

    await demo.clickButton('Skip & Complete');

    // Session completed — shows "Quick Tune Complete"
    await demo.waitForText(/Quick Tune Complete/i, 15_000);
    await demo.screenshot('quick-07-complete');
  });

  test('dismiss and check history shows quick tune', async () => {
    const dismissBtn = demo.page.getByRole('button', { name: 'Dismiss', exact: true });
    await dismissBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await dismissBtn.click();

    // Tuning History should show the completed quick tune session
    await demo.waitForText('Tuning History', 10_000);
    await demo.waitForText('Quick Tune', 10_000);
    await demo.screenshot('quick-08-history');
  });
});
