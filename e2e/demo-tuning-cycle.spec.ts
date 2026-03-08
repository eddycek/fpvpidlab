/**
 * Demo mode tuning cycle E2E test.
 *
 * Walks through one complete tuning cycle:
 *   Start → Erase → (auto-flight) → Download → Filter Wizard → Apply →
 *   (reconnect cycles) → Continue → Erase → (auto-flight) → Download →
 *   PID Wizard → Apply → Skip verification → Complete → Dismiss
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

test.describe.serial('single tuning cycle', () => {
  test('start tuning session', async () => {
    await demo.clickButton('Start Tuning Session');

    // StartTuningModal opens — select Guided Tune
    await demo.clickButton('Guided Tune');

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
    // There may be two "Apply Changes" buttons (summary + modal), click the modal one (last)
    const applyBtns = demo.page.getByRole('button', { name: 'Apply Changes' });
    await applyBtns.last().waitFor({ state: 'visible', timeout: 5_000 });
    await applyBtns.last().click();

    // Wait for apply to complete — shows "Filters applied!" + "Close Wizard"
    await demo.page
      .getByRole('button', { name: 'Close Wizard' })
      .waitFor({ state: 'visible', timeout: 30_000 });
    await demo.screenshot('07-filters-applied');

    // Close wizard — return to dashboard
    await demo.clickButton('Close Wizard');
  });

  test('continue to PID flight phase', async () => {
    // After filter apply + reboot cycles, dashboard shows filter_applied phase
    // with "Continue" button, or may already be at pid_flight_pending
    // Wait for either "Continue" or "Erase Flash" (PID phase)
    const continueBtn = demo.page.getByRole('button', { name: 'Continue' });
    const eraseBtn = demo.page.getByRole('button', { name: 'Erase Flash' });

    // Wait for dashboard to stabilize after reconnect cycles
    await expect(continueBtn.or(eraseBtn)).toBeVisible({ timeout: 30_000 });

    // If "Continue" is visible, click it (transitions filter_applied → pid_flight_pending + erase)
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
    } else {
      // Already at pid_flight_pending — click Erase Flash
      await eraseBtn.click();
    }

    // Wait for PID auto-flight → reconnect → pid_log_ready
    await demo.waitForText('PID flight done', 30_000);
    await demo.screenshot('08-pid-flight-done');
  });

  test('download PID log', async () => {
    await demo.clickButton('Download Log');

    // Wait for download + parse → pid_analysis
    await demo.waitForText('Open PID Wizard', 20_000);
    await demo.screenshot('09-pid-log-downloaded');
  });

  test('run PID analysis in wizard', async () => {
    await demo.clickButton('Open PID Wizard');

    // Wizard opens at PID step — click Run PID Analysis
    await demo.clickButton('Run PID Analysis');

    // Wait for PID analysis to complete
    await demo.page
      .getByRole('button', { name: /Continue to Summary/i })
      .waitFor({ state: 'visible', timeout: 60_000 });
    await demo.screenshot('10-pid-analysis-done');
  });

  test('apply PIDs via wizard', async () => {
    // Navigate to summary step
    await demo.clickButton(/Continue to Summary/i);

    // Summary shows "Apply PIDs" button (mode=pid)
    await demo.page
      .getByRole('button', { name: 'Apply PIDs' })
      .waitFor({ state: 'visible', timeout: 10_000 });

    // Click Apply PIDs → opens ApplyConfirmationModal
    await demo.clickButton('Apply PIDs');

    // Click "Apply Changes" in modal
    const applyBtns = demo.page.getByRole('button', { name: 'Apply Changes' });
    await applyBtns.last().waitFor({ state: 'visible', timeout: 5_000 });
    await applyBtns.last().click();

    // Wait for apply to complete
    await demo.page
      .getByRole('button', { name: 'Close Wizard' })
      .waitFor({ state: 'visible', timeout: 30_000 });
    await demo.screenshot('11-pids-applied');

    // Close wizard
    await demo.clickButton('Close Wizard');
  });

  test('skip verification and complete', async () => {
    // After PID apply + reboot, dashboard shows pid_applied with "Skip & Complete"
    await demo.page
      .getByRole('button', { name: 'Skip & Complete' })
      .waitFor({ state: 'visible', timeout: 30_000 });

    await demo.clickButton('Skip & Complete');

    // Session should be completed — TuningCompletionSummary shows "Tuning Complete"
    await demo.waitForText(/Tuning Complete/i, 15_000);
    await demo.screenshot('12-tuning-complete');
  });

  test('dismiss completed session and check history', async () => {
    // Click Dismiss to archive and return to dashboard
    // Use exact match to avoid matching toast "Dismiss notification" button
    const dismissBtn = demo.page.getByRole('button', { name: 'Dismiss', exact: true });
    await dismissBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await dismissBtn.click();

    // Tuning History should now show the completed session
    await demo.waitForText('Tuning History', 10_000);
    await demo.screenshot('13-history-visible');

    // Verify quality score badge is displayed
    const badge = demo.page.locator('.quality-badge, [class*="quality"]');
    await expect(badge.first()).toBeVisible({ timeout: 5000 });
  });
});
