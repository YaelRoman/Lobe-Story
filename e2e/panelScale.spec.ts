import { expect, test, type Page } from '@playwright/test';
import { planetText } from '../src/test/planetText';

const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const msi = (freq: number) => planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });

// Ten files in a single group (same polarization and tilt tags): 1700, 1710, ... 1790.
const NAMES = Array.from({ length: 10 }, (_, i) => `f${1700 + 10 * i}.msi`);
async function load(page: Page) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(NAMES.map((n, i) => file(n, msi(1700 + 10 * i))));
  await expect(page.locator('.panel li')).toHaveCount(10);
}
const ticked = (page: Page) => page.locator('.panel li input[type="checkbox"]:checked');

test('the filter narrows the list, counts matches, leaves the ticks alone and Esc clears it', async ({ page }) => {
  await load(page);
  const panel = page.locator('.panel');
  const filter = page.getByLabel('Filter files');
  await expect(page.getByTestId('filter-count')).toHaveText('10 files · 1 shown');
  await filter.fill('f171');
  await expect(panel.locator('li')).toHaveCount(1);
  await expect(page.getByTestId('filter-count')).toHaveText('1 of 10 files');
  await filter.fill('17 mhz');
  await expect(panel.locator('li')).toHaveCount(10);
  await filter.fill('zzz');
  await expect(panel.getByText('No file matches "zzz".')).toBeVisible();
  await filter.fill('1730');
  await expect(panel.locator('li')).toHaveCount(1);
  // Down from the box enters the list; filtered-out rows are not stops, so End lands on the one match.
  await filter.press('ArrowDown');
  await expect(panel.locator('[data-nav]').first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(panel.locator('li', { hasText: 'f1730.msi' }).locator('[data-nav]')).toBeFocused();
  await filter.focus();
  // Filtering ticked or unticked nothing: the one auto-ticked file is still the only one shown.
  await filter.press('Escape');
  await expect(filter).toHaveValue('');
  await expect(panel.locator('li')).toHaveCount(10);
  await expect(ticked(page)).toHaveCount(1);
  await expect(page.getByTestId('filter-count')).toHaveText('10 files · 1 shown');
});

test('Show all / none / only matches are one undoable step each', async ({ page }) => {
  await load(page);
  const filter = page.getByLabel('Filter files');
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(ticked(page)).toHaveCount(10);
  await expect(page.getByTestId('undo-toast')).toContainText('Showed all files');
  await page.getByRole('button', { name: 'Show none', exact: true }).click();
  await expect(ticked(page)).toHaveCount(0);
  await page.getByTestId('undo-toast').getByRole('button', { name: /^Undo/ }).click();
  await expect(ticked(page)).toHaveCount(10);
  await filter.fill('f172');
  await page.getByRole('button', { name: 'Only matches' }).click();
  await filter.fill('');
  await expect(ticked(page)).toHaveCount(1);
  await expect(page.getByTestId('filter-count')).toHaveText('10 files · 1 shown');
  await filter.fill('f175');
  await page.getByRole('button', { name: 'Add matches' }).click();
  await filter.fill('');
  await expect(ticked(page)).toHaveCount(2);
});

test('an undo that only restores ticks keeps the filter and the folds; one that brings the files back starts them afresh', async ({ page }) => {
  await load(page);
  const panel = page.locator('.panel');
  await page.getByLabel('Filter files').fill('f171');
  await page.getByRole('button', { name: 'Only matches' }).click();
  await panel.locator('section.group:not(.custom)').first().getByRole('button', { name: /^Collapse / }).click();
  await expect(panel.locator('li')).toHaveCount(0);
  await page.getByTestId('undo-toast').getByRole('button', { name: /^Undo/ }).click();
  await expect(page.getByLabel('Filter files')).toHaveValue('f171');
  await expect(panel.locator('li')).toHaveCount(0);
  // Clear and its undo replace the set of loaded files: the list starts afresh.
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByTestId('undo-toast').getByRole('button', { name: /^Undo/ }).click();
  await expect(page.getByLabel('Filter files')).toHaveValue('');
  await expect(panel.locator('li')).toHaveCount(10);
});
