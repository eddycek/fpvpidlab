/**
 * Generates 5 completed tuning sessions in demo mode.
 *
 * Wipes the demo state, then clicks through 5 full tuning cycles
 * (filter + PID, skipping verification) to populate tuning history
 * with progressive quality scores.
 *
 * Run: npm run demo:generate-history
 */
import { test, expect } from '@playwright/test';
import { launchDemoApp, type DemoApp } from './electron-app';

// Generous timeout — 5 cycles take ~2-3 minutes
test.setTimeout(300_000);

let demo: DemoApp;

test.beforeAll(async () => {
  demo = await launchDemoApp();
  await demo.waitForDemoReady();
});

test.afterAll(async () => {
  // Take final screenshot showing all 5 sessions in history
  if (demo) {
    await demo.screenshot('history-5-sessions-final');
    await demo.close();
  }
});

/**
 * Run one complete tuning cycle: filter → PID → skip verify → dismiss.
 */
async function runTuningCycle(cycleNum: number): Promise<void> {
  const page = demo.page;
  const WAIT = 30_000;
  const ANALYSIS_WAIT = 60_000;

  console.log(`\n=== Starting tuning cycle ${cycleNum} ===`);

  // 1. Start Tuning Session (modal → Guided Tune)
  await demo.clickButton('Start Tuning Session');
  await demo.clickButton('Guided Tune');
  await demo.waitForText('Erase Blackbox data', WAIT);

  // 2. Filter flight: erase → auto-flight → download → analysis → apply
  await demo.clickButton('Erase Flash');
  await demo.waitForText('Filter flight done', WAIT);
  await demo.clickButton('Download Log');
  await demo.waitForText('Open Filter Wizard', WAIT);
  await demo.clickButton('Open Filter Wizard');
  await demo.clickButton('Run Filter Analysis');
  await page
    .getByRole('button', { name: /Continue to Summary/i })
    .waitFor({ state: 'visible', timeout: ANALYSIS_WAIT });
  await demo.clickButton(/Continue to Summary/i);
  await page
    .getByRole('button', { name: 'Apply Filters' })
    .waitFor({ state: 'visible', timeout: WAIT });
  await demo.clickButton('Apply Filters');
  const filterApplyBtns = page.getByRole('button', { name: 'Apply Changes' });
  await filterApplyBtns.last().waitFor({ state: 'visible', timeout: 5_000 });
  await filterApplyBtns.last().click();
  await page
    .getByRole('button', { name: 'Close Wizard' })
    .waitFor({ state: 'visible', timeout: WAIT });
  await demo.clickButton('Close Wizard');

  console.log(`  Cycle ${cycleNum}: filters applied, continuing to PID...`);

  // 3. Continue to PID phase
  const continueBtn = page.getByRole('button', { name: 'Continue' });
  const eraseBtn = page.getByRole('button', { name: 'Erase Flash' });
  await expect(continueBtn.or(eraseBtn)).toBeVisible({ timeout: WAIT });
  if (await continueBtn.isVisible().catch(() => false)) {
    await continueBtn.click();
  } else {
    await eraseBtn.click();
  }

  // 4. PID flight: auto-flight → download → analysis → apply
  await demo.waitForText('PID flight done', WAIT);
  await demo.clickButton('Download Log');
  await demo.waitForText('Open PID Wizard', WAIT);
  await demo.clickButton('Open PID Wizard');
  await demo.clickButton('Run PID Analysis');
  await page
    .getByRole('button', { name: /Continue to Summary/i })
    .waitFor({ state: 'visible', timeout: ANALYSIS_WAIT });
  await demo.clickButton(/Continue to Summary/i);
  await page
    .getByRole('button', { name: 'Apply PIDs' })
    .waitFor({ state: 'visible', timeout: WAIT });
  await demo.clickButton('Apply PIDs');
  const pidApplyBtns = page.getByRole('button', { name: 'Apply Changes' });
  await pidApplyBtns.last().waitFor({ state: 'visible', timeout: 5_000 });
  await pidApplyBtns.last().click();
  await page
    .getByRole('button', { name: 'Close Wizard' })
    .waitFor({ state: 'visible', timeout: WAIT });
  await demo.clickButton('Close Wizard');

  console.log(`  Cycle ${cycleNum}: PIDs applied, completing...`);

  // 5. Skip verification → complete → dismiss
  await page
    .getByRole('button', { name: 'Skip & Complete' })
    .waitFor({ state: 'visible', timeout: WAIT });
  await demo.clickButton('Skip & Complete');
  await demo.waitForText(/Tuning Complete/i, 15_000);

  // Take screenshot of completion summary
  await demo.screenshot(`history-cycle-${cycleNum}-complete`);

  // Dismiss to archive to history
  const dismissBtn = page.getByRole('button', { name: 'Dismiss', exact: true });
  await dismissBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await dismissBtn.click();

  // Wait for dashboard to return (Start Tuning Session button)
  await page
    .getByRole('button', { name: /start tuning/i })
    .waitFor({ state: 'visible', timeout: WAIT });

  console.log(`  Cycle ${cycleNum}: complete and dismissed`);
}

test('generate 5 tuning sessions', async () => {
  for (let i = 1; i <= 5; i++) {
    await runTuningCycle(i);
  }

  // Verify history shows 5 sessions
  await demo.waitForText('Tuning History', 10_000);

  // Scroll to Tuning History section for screenshot
  const historySection = demo.page.getByText('Tuning History');
  await historySection.scrollIntoViewIfNeeded();

  // Check that quality badges are visible
  const badges = demo.page.locator('.quality-badge, [class*="quality"]');
  await expect(badges.first()).toBeVisible({ timeout: 5_000 });

  await demo.screenshot('history-5-sessions');
});
