import { expect, test, type Page } from '@playwright/test';

async function loadExample(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await expect(page.locator('[data-testid="plot-h"] .js-plotly-plot')).toHaveCount(1);
}

/**
 * The id the charting library gives a chart when it plots it from nothing; an update in place keeps it. One per
 * chart, in page order.
 */
const plotIds = (page: Page, testIds: string[]) =>
  page.evaluate(
    (ids) => ids.map((id) => (document.querySelector(`[data-testid="${id}"] .js-plotly-plot`) as unknown as { _fullLayout?: { _uid?: string } } | null)?._fullLayout?._uid ?? null),
    testIds,
  );
/** Number of traces the chart holds now. */
const traceCount = (page: Page, testId: string) =>
  page.evaluate((id) => (document.querySelector(`[data-testid="${id}"] .js-plotly-plot`) as unknown as { data: unknown[] }).data.length, testId);

test('a redraw updates the charts in place: ticking and highlighting never plot them from nothing', async ({ page }) => {
  await loadExample(page);
  const charts = ['plot-h', 'plot-v', 'plot-hpbw'];
  const before = await plotIds(page, charts);
  expect(before.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);

  // More traces (a redraw of every chart).
  const drawn = await traceCount(page, 'plot-h');
  await page.locator('.panel li input[type="checkbox"]:not(:checked)').first().check();
  await expect.poll(() => traceCount(page, 'plot-h')).toBeGreaterThan(drawn);
  expect(await plotIds(page, charts)).toEqual(before);

  // Another highlighted file (its markers and the title change).
  const readout = await page.getByTestId('readout-h').textContent();
  await page.locator('tr[data-row-id]').nth(5).click();
  await expect(page.locator('tr.hl[data-row-id]')).toHaveCount(1);
  await expect(page.getByTestId('readout-h')).not.toHaveText(readout ?? '');
  expect(await plotIds(page, charts)).toEqual(before);

  // Another plot type changes the cut plots' toolbar (the one case that plots a chart anew); the frequency chart stays.
  await page.getByRole('group', { name: 'Plot type' }).getByRole('button', { name: 'Rectangular' }).click();
  await expect(page.locator('[data-testid="plot-h"] .modebar-btn[data-title="Reset axes"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="plot-h"] .xtitle')).toHaveCount(1);
  const rect = await plotIds(page, charts);
  expect(rect[2]).toBe(before[2]);
  // From then on the rectangular plots are updated in place as well.
  const shown = await traceCount(page, 'plot-h');
  await page.locator('.panel li input[type="checkbox"]:not(:checked)').first().check();
  await expect.poll(() => traceCount(page, 'plot-h')).toBeGreaterThan(shown);
  expect(await plotIds(page, charts)).toEqual(rect);
});
