import { expect, test, type Page } from '@playwright/test';

async function loadExample(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.metrics tbody tr')).toHaveCount(24);
}

test('the line above the metrics table says what the focused cell\'s column means and why a value is missing, by keyboard', async ({ page }) => {
  await loadExample(page);
  const line = page.getByTestId('cell-line');
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute('aria-live', 'polite');
  await expect(line).toContainText('Select a cell');
  // (Measured from the line's own top: the page scrolls when a cell takes the focus.)
  const gap = async () => (await page.locator('.metrics-wrap').boundingBox())!.y - (await line.boundingBox())!.y;
  const before = await gap();

  // Arrow right from the file name moves into the cells: the line follows the cell.
  const first = page.locator('.metrics tbody tr').first();
  await first.locator('[data-nav]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(first.locator('td[data-col="hHpbw"]')).toBeFocused();
  await expect(line).toContainText('example_1710_P45_02T.msi · H-HPBW (°): 66.0.');
  await expect(line).toContainText('Horizontal half-power beamwidth (BASTA 6.1.6)');
  await page.keyboard.press('ArrowRight');
  await expect(line).toContainText('V-HPBW (°): 8.6.');
  await page.keyboard.press('ArrowDown');
  await expect(line).toContainText('example_1795_P45_02T.msi · V-HPBW (°)');
  // The table has not moved: the line keeps its height whatever it says.
  expect(await gap()).toBe(before);

  // A missing value: the reason its tooltip gives is in the line.
  await page.getByLabel('Show Declared Δ columns').check();
  await page.getByRole('button', { name: /Simulation/ }).click();
  await page.getByRole('group', { name: 'Horizontal cut' }).getByRole('button', { name: 'At the horizon' }).click();
  const blank = page.locator('.metrics tbody td.has-reason[data-col="dH"]').first();
  await expect(blank).toContainText('—');
  const reason = (await blank.getAttribute('title'))!;
  expect(reason.length).toBeGreaterThan(10);
  await blank.focus();
  await expect(line).toContainText('Why: ');
  for (const part of reason.split('\n')) await expect(line).toContainText(part.replace(/[.\s]+$/, ''));
  // The note points to it.
  await expect(page.getByTestId('sim-blank-note')).toContainText('select a dotted cell for the reason');

  // The line stays when the focus leaves the table, and can be reached and scrolled by keyboard.
  await page.getByRole('button', { name: 'Export CSV' }).focus();
  await expect(line).toContainText('Why: ');
  await line.focus();
  await expect(line).toBeFocused();
});

test('on a phone a tap on a cell shows its column definition and the estimate caveat above the table', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.metrics tbody tr')).toHaveCount(24);
  await page.getByLabel('Show Angular regions (est.) columns').check();
  const line = page.getByTestId('cell-line');
  const cell = page.locator('.metrics tbody tr').nth(1).locator('td[data-col="areSector"]');
  await cell.scrollIntoViewIfNeeded();
  await cell.tap();
  await expect(line).toContainText('Sector eff. est. [Summation] (%)');
  await expect(line).toContainText('not BASTA-compliant');
  await expect(line).toContainText('Estimate from the two co-polar cuts');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await context.close();
});
