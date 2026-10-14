import { expect, test, type Locator, type Page } from '@playwright/test';
import { planetText } from '../src/test/planetText';
import { collectFileChoosers } from './fileChooser';
import { openSimulation } from './simulationBar';

const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const msi = (freq: number) =>
  planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });

/** Presses Tab (or Shift+Tab) until `target` has the focus; fails when it is not reached in `max` presses. */
async function tabTo(page: Page, target: Locator, max = 80, key = 'Tab'): Promise<number> {
  for (let n = 1; n <= max; n++) {
    await page.keyboard.press(key);
    if (await target.evaluate((el) => el === document.activeElement)) return n;
  }
  throw new Error(`not reached in ${max} presses of ${key}`);
}

/**
 * Whether a user sees where the focus is: the focused element is one the browser shows the focus on, its box lies on the
 * screen with a real size (not a 1 px visually hidden element), and its ring is drawn: the pixels around it differ with
 * and without the focus. The focus is put back as it was.
 */
async function focusSeen(page: Page): Promise<boolean> {
  const box = await page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body || !el.matches(':focus-visible')) return null;
    const r = el.getBoundingClientRect();
    const onScreen = r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
    return onScreen && r.width >= 8 && r.height >= 8 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
  });
  if (box === null) return false;
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const x = Math.max(0, Math.floor(box.x) - 4);
  const y = Math.max(0, Math.floor(box.y) - 4);
  const clip = { x, y, width: Math.min(viewport.width, Math.ceil(box.x + box.width) + 4) - x, height: Math.min(viewport.height, Math.ceil(box.y + box.height) + 4) - y };
  const focused = await page.screenshot({ clip, animations: 'disabled' });
  await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    (window as unknown as { __focusSeen: HTMLElement }).__focusSeen = el;
    el.blur();
  });
  const blurred = await page.screenshot({ clip, animations: 'disabled' });
  await page.evaluate(() => (window as unknown as { __focusSeen: HTMLElement }).__focusSeen.focus({ focusVisible: true } as FocusOptions));
  return !focused.equals(blurred);
}

const FILES = ['a.msi', 'b.msi', 'c.msi'];
async function load(page: Page) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(FILES.map((n, i) => file(n, msi(1800 + 100 * i))));
  await expect(page.locator('.panel li')).toHaveCount(3);
  // Start from a known place: after a file chooser upload the browser keeps no focus position.
  await page.getByRole('button', { name: 'Clear', exact: true }).focus();
}

test('the file list is one tab stop; arrows, Enter and Space work the rows', async ({ page }) => {
  await load(page);
  const panel = page.locator('.panel');
  const rowButton = (name: string) => panel.locator('li', { hasText: name }).locator('[data-nav]');

  // Entering the panel by Tab lands on its first list entry; Tab again leaves the list's other rows alone.
  const first = panel.locator('[data-nav]').first();
  await tabTo(page, first);
  await page.keyboard.press('ArrowDown');
  await expect(rowButton('a.msi')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rowButton('b.msi')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(rowButton('c.msi')).toBeFocused(); // stops at the end
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();

  // Count the tab stops inside the panel: the current row's own controls, not three per file.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // b.msi
  const stops = await panel.evaluate((el) =>
    // The filter box and the bulk buttons above the list are their own tab stops.
    Array.from(el.querySelectorAll<HTMLElement>('input, button, summary'))
      .filter((n) => !n.closest('.panel-tools') && n.tabIndex >= 0 && n.checkVisibility()).length,
  );
  expect(stops).toBe(4); // the row button, the checkbox, ✎ and ⋯ of b.msi

  // Enter highlights the row; Space shows or hides it without highlighting.
  await page.keyboard.press('Enter');
  await expect(panel.locator('li.hl')).toContainText('b.msi');
  await expect(rowButton('b.msi')).toHaveAttribute('aria-current', 'true');
  const box = panel.getByRole('checkbox', { name: 'Show b.msi' });
  const before = await box.isChecked();
  await page.keyboard.press(' ');
  expect(await box.isChecked()).toBe(!before);
  await page.keyboard.press(' ');
  expect(await box.isChecked()).toBe(before);
  await expect(rowButton('b.msi')).toBeFocused();

  // The metrics table is the same: one tab stop, arrows, Enter highlights.
  const rows = page.locator('.metrics tbody [data-nav]');
  const n = await tabTo(page, rows.first(), 300);
  expect(n).toBeLessThan(120);
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  // b.msi is already the highlighted file: Enter clears the highlight, the next Enter sets it again.
  await page.keyboard.press('Enter');
  await expect(page.locator('.metrics tbody tr.hl')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('.metrics tbody tr.hl')).toHaveCount(1);
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(panel.locator('li.hl')).toContainText('b.msi');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(panel.locator('li.hl')).toContainText('c.msi');
});

test('keyboard only: load, highlight the second file, set an offset, export CSV', async ({ page }) => {
  await load(page);
  const panel = page.locator('.panel');
  await tabTo(page, panel.locator('[data-nav]').first());
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(panel.locator('li.hl')).toContainText('b.msi');

  // The Simulation bar starts folded: reach its fold button and open it from the keyboard.
  const fold = page.getByRole('button', { name: /Simulation/ });
  await tabTo(page, fold);
  await page.keyboard.press('Enter');
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  const azimuth = page.getByLabel('Azimuth offset (°) value');
  await tabTo(page, azimuth);
  await page.keyboard.type('15');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Offsets: az +15°')).toBeVisible();

  await tabTo(page, page.getByRole('button', { name: 'Export CSV' }));
  const download = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  // An azimuth offset turns the drawing and changes no value of the table: the file is not called simulated.
  expect((await download).suggestedFilename()).toBe('pattern-metrics.csv');
});

test('menu and tag editor open from the keyboard and Esc returns the focus', async ({ page }) => {
  await load(page);
  const panel = page.locator('.panel');
  await tabTo(page, panel.locator('[data-nav]').first());
  await page.keyboard.press('ArrowDown'); // a.msi
  const tags = panel.getByLabel('Edit tags of a.msi');
  const menu = panel.getByLabel('Actions for a.msi');

  await page.keyboard.press('Tab');
  await expect(tags).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel.getByLabel('Polarization')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel.getByLabel('Polarization')).toHaveCount(0);
  await expect(tags).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(menu).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Rename…' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Rename…' })).toBeHidden();
  await expect(menu).toBeFocused();

  // Rename from the menu with the keyboard: the focus comes back to the row afterwards.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.getByLabel('Name for a.msi').fill('Renamed');
  await page.keyboard.press('Enter');
  await expect(panel.locator('li', { hasText: 'Renamed' }).locator('[data-nav]')).toBeFocused();
});

test('a custom group header is selectable from the keyboard', async ({ page }) => {
  await load(page);
  const panel = page.locator('.panel');
  await panel.getByLabel('Actions for a.msi').click();
  await page.getByRole('menuitem', { name: 'Move to new group…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Name of the new group' });
  await dialog.getByRole('textbox').fill('North');
  await page.keyboard.press('Enter');
  const header = panel.getByRole('button', { name: 'North', exact: true });
  await expect(header).toBeVisible();

  await openSimulation(page); // the bar starts folded; open it first so the focus stays on the header
  await header.focus();
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('group', { name: 'Per-file and group offsets' })).toContainText('North');
  await page.keyboard.press('ArrowDown');
  await expect(panel.locator('li', { hasText: 'a.msi' }).locator('[data-nav]')).toBeFocused();
});

test('a dialog traps Tab, closes on Esc and gives the focus back to its opener', async ({ page }) => {
  await load(page);
  const clear = page.getByRole('button', { name: 'Clear', exact: true });
  const menu = page.locator('.panel').getByLabel('Actions for b.msi');
  await menu.focus();
  await page.keyboard.press('Enter');
  // The menu is open before its item is focused (a click-less open can lag on a busy machine).
  await expect(menu.locator('..')).toHaveAttribute('open', '');
  await page.getByRole('menuitem', { name: 'Create site…' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Number of sectors (2–12)' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('textbox');
  await expect(input).toBeFocused();
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    seen.add(await page.evaluate(() => (document.activeElement as HTMLElement).closest('.dialog') ? (document.activeElement?.tagName ?? '') : 'OUTSIDE'));
  }
  expect(seen.has('OUTSIDE')).toBe(false);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('.dialog'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(menu).toBeFocused();

  // A confirm opened from the toolbar (Clear asks once a name or an offset was changed) returns to its button.
  await openSimulation(page);
  const azimuth = page.getByLabel('Azimuth offset (°) value');
  await expect(azimuth).toBeVisible();
  await azimuth.fill('10');
  await azimuth.press('Enter');
  await expect(page.getByTestId('updating-2d')).toHaveCount(0);
  await clear.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(clear).toBeFocused();
});

test('the Settings panel, which traps Tab like a dialog, says it is modal', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Analysis settings' })).toHaveAttribute('aria-modal', 'true');
});

test('Settings takes focus, closes on Esc and returns the focus', async ({ page }) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Settings' });
  await button.focus();
  await page.keyboard.press('Enter');
  const settings = page.getByRole('dialog', { name: 'Analysis settings' });
  await expect(settings.locator('input').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(button).toBeFocused();

  // A click elsewhere closes it too.
  await button.click();
  await expect(settings).toBeVisible();
  await page.locator('h1').click();
  await expect(settings).toHaveCount(0);
});

test('the Open buttons show a focus ring and open the file chooser from the keyboard', async ({ page }) => {
  const nextChooser = collectFileChoosers(page);
  await page.goto('/');
  const open = page.locator('label.button', { hasText: 'Open files' });
  await tabTo(page, page.getByTestId('file-input'));
  const outline = await open.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe('solid');
  await page.keyboard.press('Enter');
  expect((await nextChooser()).isMultiple()).toBe(true);
});

test('Shift+Tab and Tab from the dialog container itself wrap inside the dialog', async ({ page }) => {
  await load(page);
  const menu = page.locator('.panel').getByLabel('Actions for b.msi');
  await menu.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Create site…' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Number of sectors (2–12)' });
  await expect(dialog.getByRole('textbox')).toBeFocused();
  // Clicking the text puts the focus on the dialog container (tabindex -1).
  await dialog.locator('p').first().click();
  expect(await dialog.evaluate((el) => el === document.activeElement)).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator('button[type=submit]')).toBeFocused();
  await dialog.locator('p').first().click();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('textbox')).toBeFocused();
});

test('an open menu closes when the focus leaves it', async ({ page }) => {
  await load(page);
  const panel = page.locator('.panel');
  const menu = panel.getByLabel('Actions for a.msi');
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeFocused();
  // Tab walks through the items; leaving the last one closes the menu (and the focus stays where it went).
  const items = await page.getByRole('menuitem').count();
  for (let i = 0; i < items - 1; i++) {
    await page.keyboard.press('Tab');
    await expect(panel.locator('details.menu[open]')).toHaveCount(1);
  }
  await page.keyboard.press('Tab');
  await expect(panel.locator('details.menu[open]')).toHaveCount(0);
  expect(await page.evaluate(() => !!document.activeElement?.closest('details.menu'))).toBe(false);
});

test('saving the tag editor unchanged does not create an override', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800))]);
  const panel = page.locator('.panel');
  await expect(panel.locator('li')).toHaveCount(1);
  await panel.getByLabel('Edit tags of a.msi').click();
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByLabel('Polarization')).toHaveCount(0);
  // A plain file clears without asking; an override would make Clear ask first.
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(panel.locator('li')).toHaveCount(0);
});

test('a file row can be dragged by its name onto a custom group', async ({ page }) => {
  await load(page);
  const panel = page.locator('.panel');
  await panel.getByLabel('Actions for a.msi').click();
  await page.getByRole('menuitem', { name: 'Move to new group…' }).click();
  await page.getByRole('dialog', { name: 'Name of the new group' }).getByRole('textbox').fill('North');
  await page.keyboard.press('Enter');
  const north = panel.locator('section.group.custom', { hasText: 'North' });
  await expect(north.locator('li')).toHaveCount(1);
  await panel.locator('li', { hasText: 'b.msi' }).locator('.row-main').dragTo(north.locator('header'));
  await expect(north.locator('li')).toHaveCount(2);
  await expect(north.locator('li', { hasText: 'b.msi' })).toHaveCount(1);
  // The name area still activates by click.
  await north.locator('li', { hasText: 'b.msi' }).locator('.row-main').click();
  await expect(north.locator('li', { hasText: 'b.msi' })).toHaveClass(/hl/);
});

test('after Load example by the keyboard the focus is on the first file row, not lost with the empty page', async ({ page }) => {
  await page.goto('/');
  const example = page.getByTestId('empty-state').getByRole('button', { name: 'Load example' });
  await example.focus();
  await page.keyboard.press('Enter');
  const rows = page.locator('.panel li [data-nav]');
  await expect(rows).toHaveCount(24);
  await expect(rows.first()).toBeFocused();
  // Where the focus was put is shown: the row has its ring.
  expect(await focusSeen(page)).toBe(true);
  // The next Tab goes on from the file list, not from the top of the document.
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('.panel, .toolbar') !== null)).toBe(true);
});

test('after the first files opened from the empty page by the keyboard the focus is on the first file row', async ({ page }) => {
  const nextChooser = collectFileChoosers(page);
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Open files' }).focus();
  await page.keyboard.press('Enter');
  await (await nextChooser()).setFiles(FILES.map((n, i) => file(n, msi(1800 + 100 * i))));
  const rows = page.locator('.panel li [data-nav]');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toBeFocused();
  expect(await focusSeen(page)).toBe(true);
  // Files opened from the toolbar leave the focus where it is: on the toolbar's own control.
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.locator('.panel')).toHaveCount(0);
  const input = page.getByTestId('file-input');
  await input.focus();
  await input.setInputFiles(FILES.map((n, i) => file(n, msi(1800 + 100 * i))));
  await expect(rows).toHaveCount(3);
  await expect(input).toBeFocused();
});

for (const width of [390, 900]) {
  test(`in a window of ${width} px, where the file list is a closed drawer, the focus goes to the Files button, with its ring in sight`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.files-toggle')).toBeFocused();
    expect(await focusSeen(page)).toBe(true);
    // Enter opens the drawer from there.
    await page.keyboard.press('Enter');
    await expect(page.locator('.files-toggle')).toHaveAttribute('aria-expanded', 'true');
  });
}

/** How many files are ticked in the panel. */
const ticked = (page: Page) => page.locator('.panel li input[type="checkbox"]:checked').count();

test('after a mouse click on Load example the focus is not moved, and Space does not untick the shown file', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  const rows = page.locator('.panel li [data-nav]');
  await expect(rows).toHaveCount(24);
  await expect(page.getByTestId('plot-h').locator('.main-svg').first()).toBeVisible();
  // The focus went with the button, as it does for any button that is gone: nothing was focused without a ring to show it.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  const before = await ticked(page);
  expect(before).toBeGreaterThan(0);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  expect(await ticked(page)).toBe(before);
  await expect(page.getByTestId('plot-h').locator('.main-svg').first()).toBeVisible();
});

test('after the empty page’s Open files by a mouse click the focus is not moved either', async ({ page }) => {
  const nextChooser = collectFileChoosers(page);
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Open files' }).click();
  await (await nextChooser()).setFiles(FILES.map((n, i) => file(n, msi(1800 + 100 * i))));
  await expect(page.locator('.panel li [data-nav]')).toHaveCount(3);
  expect(await page.evaluate(() => document.activeElement?.closest('.panel') ?? null)).toBeNull();
  const before = await ticked(page);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  expect(await ticked(page)).toBe(before);
});

test.describe('by a finger', () => {
  test.use({ hasTouch: true });
  test('after a tap on Load example the focus is not moved', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).tap();
    await expect(page.locator('.panel li [data-nav]')).toHaveCount(24);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  });
});

test('the header row of the metrics table is one tab stop, with the arrow keys inside', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  const heads = page.locator('.metrics thead .sort-btn');
  const count = await heads.count();
  expect(count).toBeGreaterThan(10);
  await expect(page.locator('.metrics thead .sort-btn[tabindex="0"]')).toHaveCount(1);
  // From the controls above the table one Tab reaches the header row, the next one the table's body.
  await heads.first().focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('tbody') !== null && document.activeElement?.closest('.metrics') !== null)).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect(heads.first()).toBeFocused();
  // Left and Right move along the headers, Home and End to the ends; the tab stop goes with the focus.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(heads.nth(2)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(heads.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(heads.nth(count - 1)).toBeFocused();
  await expect(heads.nth(count - 1)).toBeInViewport();
  await page.keyboard.press('ArrowRight');
  await expect(heads.nth(count - 1)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(heads.first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(heads.nth(2)).toBeFocused();
  // Enter still sorts by the column.
  await page.keyboard.press('Enter');
  await expect(page.locator('.metrics thead th').nth(2)).toHaveAttribute('aria-sort', 'ascending');
  await expect(heads.nth(2)).toBeFocused();
});

test('the band table is one tab stop, with the arrow keys inside; a third skip link goes to the band statistics', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  const band = page.locator('table.band');
  const cell = (row: number, col: number) => band.locator('tbody tr').nth(row).locator('td button').nth(col);
  await expect(band.locator('td button[tabindex="0"]')).toHaveCount(1);
  await cell(0, 0).focus();
  await page.keyboard.press('ArrowDown');
  await expect(cell(1, 0)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(cell(1, 1)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(cell(1, 1)).toBeFocused(); // two sub-bands: the edge
  await page.keyboard.press('Home');
  await expect(cell(1, 0)).toBeFocused();
  await page.keyboard.press('Control+End');
  const rows = await band.locator('tbody tr').count();
  await expect(cell(rows - 1, 0)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(cell(rows - 2, 0)).toBeFocused();
  // Enter picks the cell, as a click does, and the focus stays on it.
  await page.keyboard.press('Enter');
  await expect(cell(rows - 2, 0)).toHaveAttribute('aria-pressed', 'true');
  await expect(cell(rows - 2, 0)).toBeFocused();
  // One Tab leaves the table; Shift+Tab comes back to the cell that was left.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('table.band') === null)).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect(cell(rows - 2, 0)).toBeFocused();

  const skip = page.getByRole('link', { name: 'Skip to band statistics' });
  await skip.focus();
  expect((await skip.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Band statistics', exact: true })).toBeFocused();
  // The next Tab starts inside the section.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="band-stats"]') !== null)).toBe(true);
});
