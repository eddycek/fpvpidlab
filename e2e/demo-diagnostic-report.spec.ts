/**
 * Demo mode Diagnostic Report E2E test.
 *
 * Complete integration flow:
 *   Start Filter Tune → full cycle → completion →
 *   Report Issue → fill modal → send to dev worker →
 *   Dismiss → history → Report Issue from history
 *
 * This test sends real diagnostic data to the dev telemetry worker.
 * Run separately via: npm run test:e2e:diagnostic
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

test.describe.serial('Diagnostic Report flow', () => {
  // ── Phase 1: Complete a filter tune session ──────────────────────

  test('complete a filter tune session', async () => {
    const { page } = demo;

    // Start tuning
    await demo.clickButton('Start Tuning Session');
    await page
      .locator('.start-tuning-modal .start-tuning-option', {
        has: page.locator('.start-tuning-option-title', { hasText: 'Filter Tune' }),
      })
      .click();
    await demo.waitForText('Erase Blackbox data');

    // Erase → auto-flight → reconnect
    await demo.clickButton('Erase Flash');
    await demo.waitForText('Filter flight done', 20_000);

    // Download → parse
    await demo.clickButton('Download Log');
    await demo.waitForText('Open Filter Wizard', 20_000);

    // Open wizard → run analysis
    await demo.clickButton('Open Filter Wizard');
    await demo.clickButton('Run Filter Analysis');
    await page
      .getByRole('button', { name: /Continue to Summary/i })
      .waitFor({ state: 'visible', timeout: 60_000 });

    // Apply filters
    await demo.clickButton(/Continue to Summary/i);
    await page
      .getByRole('button', { name: 'Apply Filters' })
      .waitFor({ state: 'visible', timeout: 10_000 });
    await demo.clickButton('Apply Filters');

    const applyBtns = page.getByRole('button', { name: 'Apply Changes' });
    await applyBtns.last().waitFor({ state: 'visible', timeout: 5_000 });
    await applyBtns.last().click();

    await page
      .getByRole('button', { name: 'Close Wizard' })
      .waitFor({ state: 'visible', timeout: 30_000 });
    await demo.clickButton('Close Wizard');

    // Verification flight
    await page
      .getByRole('button', { name: 'Erase & Verify' })
      .waitFor({ state: 'visible', timeout: 30_000 });
    await demo.clickButton('Erase & Verify');

    await demo.waitForText('Download Log', 20_000);
    await demo.clickButton('Download Log');

    await demo.waitForText('Analyze Verification', 20_000);
    await demo.clickButton('Analyze Verification');

    // Wait for completion
    await demo.waitForText(/Filter Tune Complete/i, 30_000);
    await demo.screenshot('diagnostic-01-tuning-complete');
  });

  // ── Phase 2: Report Issue from completion summary ────────────────

  test('Report Issue button is visible in completion summary', async () => {
    // History reloads asynchronously after completion — wait for button to appear
    const reportBtn = demo.page.getByRole('button', { name: 'Report Issue' });
    await expect(reportBtn.first()).toBeVisible({ timeout: 15_000 });
    // Scroll to make sure it's in viewport for screenshot
    await reportBtn.first().scrollIntoViewIfNeeded();
    await demo.screenshot('diagnostic-02-report-button-visible');
  });

  test('opens Report Issue modal and shows form', async () => {
    await demo.page.getByRole('button', { name: 'Report Issue' }).first().click();

    // Modal opens
    await demo.waitForText('Report Tuning Issue');

    // Form fields present
    await expect(demo.page.getByLabel('Email (optional)')).toBeVisible();
    await expect(demo.page.getByLabel('What went wrong? (optional)')).toBeVisible();

    // Privacy note
    await expect(demo.page.getByText('No personal data')).toBeVisible();

    // Buttons
    await expect(demo.page.getByRole('button', { name: 'Send Report' })).toBeVisible();
    await expect(demo.page.getByRole('button', { name: 'Cancel' })).toBeVisible();

    await demo.screenshot('diagnostic-03-modal-open');
  });

  test('submit diagnostic report to dev worker', async () => {
    const { page } = demo;

    // Fill in email and note
    await page.getByLabel('Email (optional)').fill('e2e-test@pidlab.app');
    await page
      .getByLabel('What went wrong? (optional)')
      .fill('E2E integration test — this is an automated diagnostic report from Playwright');

    await demo.screenshot('diagnostic-04-modal-filled');

    // Submit
    await page.getByRole('button', { name: 'Send Report' }).click();

    // Button shows "Sending..." briefly
    // Then modal closes on success
    await expect(page.getByText('Report Tuning Issue')).toBeHidden({ timeout: 15_000 });

    // Success toast appears
    await expect(page.getByText(/Diagnostic report sent/i)).toBeVisible({ timeout: 5_000 });

    await demo.screenshot('diagnostic-05-report-sent');
  });

  // ── Phase 3: Dismiss and check history ───────────────────────────

  test('dismiss session and verify history', async () => {
    const dismissBtn = demo.page.getByRole('button', { name: 'Dismiss', exact: true });
    await dismissBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await dismissBtn.click();

    // History section appears
    await demo.waitForText('Tuning History', 10_000);
    await demo.screenshot('diagnostic-06-history-visible');
  });

  test('Report Issue button visible in history detail', async () => {
    const { page } = demo;

    // Expand the first history card
    const historyCard = page.locator('.tuning-history-card').first();
    await historyCard.click();

    // Wait for detail to expand — Report Issue button should be visible
    const reportBtn = page.getByRole('button', { name: 'Report Issue' });
    await expect(reportBtn.first()).toBeVisible({ timeout: 10_000 });

    await demo.screenshot('diagnostic-07-history-report-button');
  });

  test('open and cancel Report Issue modal from history', async () => {
    const { page } = demo;

    // Click Report Issue in history
    await page.getByRole('button', { name: 'Report Issue' }).first().click();

    // Modal opens
    await demo.waitForText('Report Tuning Issue');
    await expect(page.getByLabel('Email (optional)')).toBeVisible();

    await demo.screenshot('diagnostic-08-history-modal-open');

    // Cancel closes the modal without sending (avoids rate limit from first submit)
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Report Tuning Issue')).toBeHidden({ timeout: 5_000 });

    await demo.screenshot('diagnostic-09-history-modal-cancelled');
  });
});
