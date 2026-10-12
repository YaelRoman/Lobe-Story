import { expect, test, type Page } from '@playwright/test';
import { planetText } from '../src/test/planetText';
import { seriesIdOf } from '../src/ui/traceUid';

const file = (name: string, freq: number) => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from(planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] })),
});

/** Collects the page's uncaught errors. */
function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** The page is alive (toolbar and table there) and the horizontal cut is drawn as a rectangular plot with `traces` lines. */
async function expectRectangularPlot(page: Page, traces: number) {
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  await expect(page.locator('.metrics tbody tr').first()).toBeVisible();
  await expect(page.getByTestId('plot-h').locator('.scatterlayer .trace .lines path')).toHaveCount(traces);
}

/** Ticks every file (the button is disabled when all are ticked already). */
async function showAll(page: Page, count: number) {
  const all = page.getByRole('button', { name: 'Show all', exact: true });
  if (await all.isEnabled()) await all.click();
  await expect(page.locator('.panel li input[type="checkbox"]:checked')).toHaveCount(count);
}

test('a numbered copy of a same-name file survives a plot redraw', async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto('/');
  const input = page.getByTestId('file-input');
  await input.setInputFiles([file('a.msi', 1910)]);
  await expect(page.getByRole('status')).toHaveText(/^Loaded 1 file/);
  await input.setInputFiles([file('a.msi', 1930)]);
  await expect(page.getByRole('status')).toContainText('added as a numbered copy');
  await expect(page.locator('.panel li')).toHaveCount(2);
  await showAll(page, 2);

  await page.getByRole('button', { name: 'Rectangular', exact: true }).click();
  await expectRectangularPlot(page, 2);
  await page.getByRole('button', { name: 'Polar', exact: true }).click();
  await expect(page.getByTestId('plot-h').locator('.polarlayer')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a file name full of selector characters survives plot redraws, hover preview and unticking', async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto('/');
  const hostile = `quote'=<b>:(2).msi`;
  await page.getByTestId('file-input').setInputFiles([file(hostile, 1910), file('plain.msi', 1930)]);
  await expect(page.locator('.panel li')).toHaveCount(2);
  await showAll(page, 2);

  await page.getByRole('button', { name: 'Rectangular', exact: true }).click();
  await expectRectangularPlot(page, 2);

  // The trace uids are plain CSS identifiers, and the hover preview still finds the file's trace through them.
  const drawn = () =>
    page.evaluate(() => {
      const gd = document.querySelector('[data-testid="plot-h"] .js-plotly-plot') as unknown as { data: { uid?: string; line?: { width?: number } }[] };
      return gd.data.filter((t) => typeof t.uid === 'string').map((t) => [t.uid!, t.line?.width] as const);
    });
  const uids = (await drawn()).map((t) => t[0]);
  expect(uids).toHaveLength(2);
  for (const uid of uids) expect(uid).toMatch(/^[a-z][A-Za-z0-9_-]*$/);
  await page.locator('body').press('Escape');
  const row = page.locator('tr[data-row-id]', { hasText: hostile });
  const id = await row.getAttribute('data-row-id');
  expect(id).toContain(hostile);
  await row.hover();
  await expect.poll(async () => (await drawn()).find((t) => seriesIdOf(t[0]) === id)?.[1]).toBe(2.5);
  await page.mouse.move(2, 2);

  // Removing the trace from the plot is the redraw that used to blank the page.
  await page.locator('.panel li', { hasText: hostile }).locator('input[type="checkbox"]').uncheck();
  await expectRectangularPlot(page, 1);
  expect(errors).toEqual([]);
});

test('a plot that throws while it redraws is replaced by a message; the rest of the page stays and "Try again" redraws it', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', 1910), file('b.msi', 1930)]);
  await expect(page.locator('.panel li')).toHaveCount(2);
  await showAll(page, 2);
  await expect(page.getByTestId('plot-h').locator('.polarlayer')).toHaveCount(1);

  // Make the charting library fail as it did on an unsafe trace id: the selector it clears a plot with throws.
  await page.evaluate(() => {
    const original = Element.prototype.querySelector;
    const w = window as unknown as { restoreQuerySelector: () => void };
    w.restoreQuerySelector = () => {
      Element.prototype.querySelector = original;
    };
    Element.prototype.querySelector = function (this: Element, selector: string) {
      if (selector.startsWith('.cb')) throw new SyntaxError('injected: not a valid selector');
      return original.call(this, selector);
    } as typeof original;
  });
  await page.getByRole('button', { name: 'Rectangular', exact: true }).click();

  const failed = page.getByRole('alert').filter({ hasText: 'This plot could not be drawn' });
  await expect(failed.first()).toBeVisible();
  await expect(failed.first()).toContainText('injected: not a valid selector');
  // The toolbar, the file panel, the plot controls and the table are still there and still work.
  await expect(page.getByRole('button', { name: 'Save project' })).toBeVisible();
  await expect(page.locator('.panel li')).toHaveCount(2);
  await expect(page.locator('.metrics tbody tr')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rectangular', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.evaluate(() => (window as unknown as { restoreQuerySelector: () => void }).restoreQuerySelector());
  while ((await failed.count()) > 0) await failed.first().getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('plot-h').locator('.scatterlayer .trace .lines path')).toHaveCount(2);
});

test('the message of a plot that failed goes away by itself when what the plot is made from changes', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', 1910), file('b.msi', 1930)]);
  await expect(page.locator('.panel li')).toHaveCount(2);
  await showAll(page, 2);
  await expect(page.getByTestId('plot-h').locator('.polarlayer')).toHaveCount(1);

  await page.evaluate(() => {
    const original = Element.prototype.querySelector;
    const w = window as unknown as { restoreQuerySelector: () => void };
    w.restoreQuerySelector = () => {
      Element.prototype.querySelector = original;
    };
    Element.prototype.querySelector = function (this: Element, selector: string) {
      if (selector.startsWith('.cb')) throw new SyntaxError('injected: not a valid selector');
      return original.call(this, selector);
    } as typeof original;
  });
  await page.getByRole('button', { name: 'Rectangular', exact: true }).click();
  const failed = page.getByRole('alert').filter({ hasText: 'This plot could not be drawn' });
  await expect(failed).toHaveCount(2);
  // The plot controls are above the failed plots, not replaced by them.
  await expect(page.getByRole('group', { name: 'Plot type' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Cut' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Markers/ })).toBeVisible();

  // Nothing the plots are made from has changed yet: the messages stay.
  await page.evaluate(() => (window as unknown as { restoreQuerySelector: () => void }).restoreQuerySelector());
  await expect(failed).toHaveCount(2);

  // Unticking a file is a change of the figure: both plots are drawn again, nobody pressed "Try again".
  await page.locator('.panel li', { hasText: 'b.msi' }).locator('input[type="checkbox"]').uncheck();
  await expect(failed).toHaveCount(0);
  await expect(page.getByTestId('plot-h').locator('.scatterlayer .trace .lines path')).toHaveCount(1);
  await expect(page.getByTestId('plot-v').locator('.scatterlayer .trace .lines path')).toHaveCount(1);
});

test('a plot that throws while it draws a highlight\'s markers is replaced by the message too, and other inputs clear it', async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', 1910), file('b.msi', 1930)]);
  await expect(page.locator('.panel li')).toHaveCount(2);
  await showAll(page, 2);
  await expect(page.getByTestId('plot-h').locator('.polarlayer')).toHaveCount(1);
  // Start from a highlighted file with its markers drawn: taking the highlight off drops marker traces, which is where the library clears.
  const rows = page.locator('tr[data-row-id]');
  // (The first file is highlighted on load.)
  await expect(rows.nth(0)).toHaveClass(/hl/);
  const markerTraces = () =>
    page.evaluate(() => (document.querySelector('[data-testid="plot-h"] .js-plotly-plot') as unknown as { data: { uid?: string }[] }).data.filter((t) => typeof t.uid !== 'string').length);
  await expect.poll(markerTraces).toBeGreaterThan(0);

  await page.evaluate(() => {
    const original = Element.prototype.querySelector;
    const w = window as unknown as { restoreQuerySelector: () => void };
    w.restoreQuerySelector = () => {
      Element.prototype.querySelector = original;
    };
    Element.prototype.querySelector = function (this: Element, selector: string) {
      if (selector.startsWith('.cb')) throw new SyntaxError('injected: not a valid selector');
      return original.call(this, selector);
    } as typeof original;
  });
  // A click on the highlighted row takes the highlight off: the plots are not built again, only the markers are
  // redrawn, a moment later and outside any render.
  await rows.nth(0).click();

  const failed = page.getByRole('alert').filter({ hasText: 'This plot could not be drawn' });
  await expect(failed).toHaveCount(2);
  await expect(failed.first()).toContainText('injected: not a valid selector');
  // Nothing escaped to the page, the redraw counts as over, and the rest of the app is alive.
  expect(errors).toEqual([]);
  await expect(page.getByTestId('updating-2d')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save project' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Plot type' })).toBeVisible();
  await expect(page.locator('.metrics tbody tr')).toHaveCount(2);
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveClass(/hl/);

  // Other inputs (a file unticked) draw both plots again once the library works.
  await page.evaluate(() => (window as unknown as { restoreQuerySelector: () => void }).restoreQuerySelector());
  await page.locator('.panel li', { hasText: 'a.msi' }).locator('input[type="checkbox"]').uncheck();
  await expect(failed).toHaveCount(0);
  await expect(page.getByTestId('plot-h').locator('.polarlayer')).toHaveCount(1);
  await expect(page.getByTestId('plot-v').locator('.polarlayer')).toHaveCount(1);
  expect(errors).toEqual([]);
});
