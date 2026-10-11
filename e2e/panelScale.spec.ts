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

test('groups fold, show ticked / total, skip folded rows by arrow keys and still accept drops', async ({ page }) => {
  await load(page);
  const panel = page.locator('.panel');
  await panel.getByLabel('Actions for f1700.msi').click();
  await page.getByRole('menuitem', { name: 'Move to new group…' }).click();
  await page.getByRole('dialog', { name: 'Name of the new group' }).getByRole('textbox').fill('North');
  await page.keyboard.press('Enter');
  const north = panel.locator('section.group.custom', { hasText: 'North' });
  const rest = panel.locator('section.group:not(.custom)').first();
  await expect(north.locator('header .count')).toHaveText('1 / 1');
  await expect(rest.locator('header .count')).toHaveText('0 / 9');
  // Fold the North group: its row is gone, and the arrow keys go from its header to the next group's header.
  await north.getByRole('button', { name: 'Collapse North' }).click();
  await expect(north.locator('li')).toHaveCount(0);
  await expect(north.getByRole('button', { name: 'Expand North' })).toHaveAttribute('aria-expanded', 'false');
  await north.getByRole('button', { name: 'North', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(rest.locator('[data-nav]').first()).toBeFocused();
  // A folded group is still a drop target.
  await rest.locator('li', { hasText: 'f1710.msi' }).locator('.row-main').dragTo(north.locator('header'));
  await expect(north.locator('header .count')).toHaveText('1 / 2');
  await expect(north.locator('li')).toHaveCount(0);
  // Right unfolds from the header's keyboard.
  await north.getByRole('button', { name: 'North', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(north.locator('li')).toHaveCount(2);
  // Left folds it again.
  await page.keyboard.press('ArrowLeft');
  await expect(north.locator('li')).toHaveCount(0);
});
