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

test('the 3D overlay and the side-by-side view draw a capped number of files and say so', async ({ page }) => {
  await page.goto('/');
  const n = 15;
  await page.getByTestId('file-input').setInputFiles(Array.from({ length: n }, (_, i) => file(`g${i}.msi`, msi(1700 + 10 * i))));
  await expect(page.locator('.panel li')).toHaveCount(n);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: 'Overlay' }).click();
  await expect(page.getByTestId('cap-notice-3d')).toContainText('The 3D overlay draws at most 12 files: showing 12 of the 15 ticked');
  await expect(page.getByTestId('cap-notice-3d')).toContainText('Only matches');
  await page.getByRole('button', { name: 'Side by side' }).click();
  await expect(page.getByTestId('cap-notice-3d')).toContainText('draws at most 6 files: showing 6 of the 15 ticked');
  // Fewer ticked files than the cap: no note.
  await page.getByRole('button', { name: 'Show none', exact: true }).click();
  await page.locator('.panel li input[type="checkbox"]').first().check();
  await expect(page.getByTestId('cap-notice-3d')).toHaveCount(0);
});

// Sixty files in one group (one frequency each): the panel scrolls.
const MANY = 60;
const manyName = (i: number) => `m${1700 + 10 * i}.msi`;
async function loadMany(page: Page) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(Array.from({ length: MANY }, (_, i) => file(manyName(i), msi(1700 + 10 * i))));
  await expect(page.locator('.panel li')).toHaveCount(MANY);
}
/** Whether the element is inside the panel's scrollport and below the sticky tools block. */
const clearOfTools = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const panel = document.querySelector('.panel') as HTMLElement;
    const tools = document.querySelector('.panel-tools') as HTMLElement;
    const el = document.querySelector(sel) as HTMLElement;
    const r = el.getBoundingClientRect();
    return { top: r.top - tools.getBoundingClientRect().bottom, bottom: panel.getBoundingClientRect().bottom - r.bottom };
  }, selector);

test('keyboard focus and a highlight never leave a row under the sticky tools block', async ({ page }) => {
  await loadMany(page);
  const panel = page.locator('.panel');
  await expect.poll(() => panel.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--panel-tools-h'))).toMatch(/^\d+px$/);
  await panel.locator('[data-nav]').nth(1).focus();
  // Down to the bottom of the list, then back up to the top: the focused row is always fully below the tools block.
  for (let k = 0; k < MANY + 3; k++) {
    await page.keyboard.press('ArrowDown');
    const gap = await clearOfTools(page, ':focus');
    expect(gap.top, `down ${k}`).toBeGreaterThanOrEqual(-1);
    expect(gap.bottom, `down ${k}`).toBeGreaterThanOrEqual(-1);
  }
  for (let k = 0; k < MANY + 3; k++) {
    await page.keyboard.press('ArrowUp');
    const gap = await clearOfTools(page, ':focus');
    expect(gap.top, `up ${k}`).toBeGreaterThanOrEqual(-1);
    expect(gap.bottom, `up ${k}`).toBeGreaterThanOrEqual(-1);
  }
  // A highlight from the table brings the row into view below the tools block.
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await page.locator('tr[data-row-id]', { hasText: manyName(MANY - 1) }).click();
  await expect(panel.locator('li.hl')).toHaveCount(1);
  await expect.poll(async () => (await clearOfTools(page, '.panel li.hl')).top).toBeGreaterThanOrEqual(-1);
  expect((await clearOfTools(page, '.panel li.hl')).bottom).toBeGreaterThanOrEqual(-1);
});

test('a highlight in a folded group unfolds it and scrolls the row into view', async ({ page }) => {
  await loadMany(page);
  const panel = page.locator('.panel');
  await panel.getByLabel('Actions for m1700.msi').click();
  await page.getByRole('menuitem', { name: 'Move to new group…' }).click();
  await page.getByRole('dialog', { name: 'Name of the new group' }).getByRole('textbox').fill('North');
  await page.keyboard.press('Enter');
  const rest = panel.locator('section.group:not(.custom)').first();
  await rest.getByRole('button', { name: /^Collapse / }).click();
  await expect(rest.locator('li')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await page.locator('tr[data-row-id]', { hasText: manyName(MANY - 1) }).click();
  await expect(rest.locator('li')).toHaveCount(MANY - 1);
  await expect(panel.locator('li.hl')).toContainText(manyName(MANY - 1));
  await expect.poll(async () => (await clearOfTools(page, '.panel li.hl')).bottom).toBeGreaterThanOrEqual(-1);
  expect((await clearOfTools(page, '.panel li.hl')).top).toBeGreaterThanOrEqual(-1);
});

test('a filter that hides the highlighted file says so and offers to clear it', async ({ page }) => {
  await load(page);
  const panel = page.locator('.panel');
  const filter = page.getByLabel('Filter files');
  await expect(panel.locator('li.hl')).toHaveCount(1); // the first file is highlighted on load
  await expect(page.getByTestId('highlight-hidden')).toHaveCount(0);
  await filter.fill('f1730');
  await expect(panel.locator('li')).toHaveCount(1);
  await expect(page.getByTestId('highlight-hidden')).toContainText('The highlighted file is hidden by the filter');
  await page.getByTestId('highlight-hidden').getByRole('button', { name: 'Clear filter' }).click();
  await expect(filter).toHaveValue('');
  await expect(panel.locator('li')).toHaveCount(10);
  await expect(page.getByTestId('highlight-hidden')).toHaveCount(0);
  // Filtering to the highlighted file itself needs no note.
  await filter.fill('f1700');
  await expect(page.getByTestId('highlight-hidden')).toHaveCount(0);
});

test('while filtering the group checkbox names the matching files; Only/Add matches wait for the applied filter', async ({ page }) => {
  await load(page);
  const filter = page.getByLabel('Filter files');
  await expect(page.getByRole('checkbox', { name: /^Show all in / })).toHaveCount(1);
  await filter.fill('f171');
  await expect(page.getByRole('checkbox', { name: /^Show the 1 matching file in / })).toHaveCount(1);
  await filter.fill('f17');
  await expect(page.getByRole('checkbox', { name: /^Show the 10 matching files in / })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Only matches' })).toBeEnabled();
  // One more typed character: until the list has caught up with it, the buttons that act on the matches are off.
  const states = await filter.evaluate(async (el: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, 'f173');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const only = () => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Only matches') as HTMLButtonElement;
    const during = only().disabled;
    await new Promise((r) => setTimeout(r, 300));
    return { during, after: only().disabled };
  });
  expect(states).toEqual({ during: true, after: false });
});

test('folding the group that holds the tab stop moves the stop to that group header, not to the top of the list', async ({ page }) => {
  await load(page);
  const panel = page.locator('.panel');
  await panel.getByLabel('Actions for f1700.msi').click();
  await page.getByRole('menuitem', { name: 'Move to new group…' }).click();
  await page.getByRole('dialog', { name: 'Name of the new group' }).getByRole('textbox').fill('North');
  await page.keyboard.press('Enter');
  const rest = panel.locator('section.group:not(.custom)').first();
  await rest.locator('li', { hasText: 'f1740.msi' }).locator('[data-nav]').focus();
  await expect(panel.locator('[data-nav][tabindex="0"]')).toHaveCount(1);
  // A click that does not move the focus (some browsers do not focus a clicked button): the stop must still follow.
  await rest.getByRole('button', { name: /^Collapse / }).evaluate((b: HTMLElement) => b.click());
  await expect(rest.locator('li')).toHaveCount(0);
  await expect(panel.locator('[data-nav][tabindex="0"]')).toHaveCount(1);
  await expect(rest.locator('header [data-nav]')).toHaveAttribute('tabindex', '0');
});
