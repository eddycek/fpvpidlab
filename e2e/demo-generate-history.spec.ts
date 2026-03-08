/**
 * Generates completed tuning sessions in demo mode.
 *
 * Three modes (run via npm scripts):
 *   npm run demo:generate-history       — 5 mixed sessions (3 guided + 2 quick)
 *   npm run demo:generate-history:full  — 5 guided sessions
 *   npm run demo:generate-history:quick — 5 quick tune sessions
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
  if (demo) {
    await demo.screenshot('history-sessions-final');
    await demo.close();
  }
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function runGuidedCycle(cycleNum: number): Promise<void> {
  const page = demo.page;
  const WAIT = 30_000;
  const ANALYSIS_WAIT = 60_000;

  console.log(`\n=== Starting guided cycle ${cycleNum} ===`);

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

  await demo.screenshot(`history-cycle-${cycleNum}-guided-complete`);

  const dismissBtn = page.getByRole('button', { name: 'Dismiss', exact: true });
  await dismissBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await dismissBtn.click();

  await page
    .getByRole('button', { name: /start tuning/i })
    .waitFor({ state: 'visible', timeout: WAIT });

  console.log(`  Cycle ${cycleNum}: guided complete and dismissed`);
}

async function runQuickCycle(cycleNum: number): Promise<void> {
  const page = demo.page;
  const WAIT = 30_000;
  const ANALYSIS_WAIT = 60_000;

  console.log(`\n=== Starting quick tune cycle ${cycleNum} ===`);

  // 1. Start Quick Tune Session (modal → Quick Tune)
  await demo.clickButton('Start Tuning Session');
  await demo.clickButton('Quick Tune');
  await demo.waitForText('Erase Blackbox data', WAIT);

  // 2. Quick flight: erase → auto-flight → download → quick wizard → apply
  await demo.clickButton('Erase Flash');
  await demo.waitForText('Flight done', WAIT);
  await demo.clickButton('Download Log');
  await demo.waitForText('Open Quick Wizard', WAIT);
  await demo.clickButton('Open Quick Wizard');

  // Quick wizard auto-runs both analyses — wait for Continue to Summary
  await page
    .getByRole('button', { name: /Continue to Summary/i })
    .waitFor({ state: 'visible', timeout: ANALYSIS_WAIT });
  await demo.clickButton(/Continue to Summary/i);

  // Apply All Changes
  await page
    .getByRole('button', { name: 'Apply All Changes' })
    .waitFor({ state: 'visible', timeout: WAIT });
  await demo.clickButton('Apply All Changes');
  const applyBtns = page.getByRole('button', { name: 'Apply Changes' });
  await applyBtns.last().waitFor({ state: 'visible', timeout: 5_000 });
  await applyBtns.last().click();
  await page
    .getByRole('button', { name: 'Close Wizard' })
    .waitFor({ state: 'visible', timeout: WAIT });
  await demo.clickButton('Close Wizard');

  console.log(`  Cycle ${cycleNum}: all changes applied, completing...`);

  // 3. Skip verification → complete → dismiss
  await page
    .getByRole('button', { name: 'Skip & Complete' })
    .waitFor({ state: 'visible', timeout: WAIT });
  await demo.clickButton('Skip & Complete');
  await demo.waitForText(/Tune Complete/i, 15_000);

  await demo.screenshot(`history-cycle-${cycleNum}-quick-complete`);

  const dismissBtn = page.getByRole('button', { name: 'Dismiss', exact: true });
  await dismissBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await dismissBtn.click();

  await page
    .getByRole('button', { name: /start tuning/i })
    .waitFor({ state: 'visible', timeout: WAIT });

  console.log(`  Cycle ${cycleNum}: quick tune complete and dismissed`);
}

async function verifyHistory(): Promise<void> {
  await demo.waitForText('Tuning History', 10_000);
  const historySection = demo.page.getByText('Tuning History');
  await historySection.scrollIntoViewIfNeeded();
  const badges = demo.page.locator('.quality-badge, [class*="quality"]');
  await expect(badges.first()).toBeVisible({ timeout: 5_000 });
  await demo.screenshot('history-sessions');
}

// ---------------------------------------------------------------------------
// Tests — each selectable via --grep
// ---------------------------------------------------------------------------

test('generate 5 mixed sessions', async () => {
  // guided → quick → guided → quick → guided
  for (let i = 1; i <= 5; i++) {
    if (i % 2 === 0) {
      await runQuickCycle(i);
    } else {
      await runGuidedCycle(i);
    }
  }
  await verifyHistory();
});

test('generate 5 guided sessions', async () => {
  for (let i = 1; i <= 5; i++) {
    await runGuidedCycle(i);
  }
  await verifyHistory();
});

test('generate 5 quick sessions', async () => {
  for (let i = 1; i <= 5; i++) {
    await runQuickCycle(i);
  }
  await verifyHistory();
});
