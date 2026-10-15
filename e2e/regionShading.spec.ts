import { expect, test, type Page } from '@playwright/test';
import { loadMany, MECHANICAL, settled, WAITING } from './manyFiles';

/**
 * The angular regions (est.) of the file whose markers are drawn are shaded on the cut plots while their columns are
 * shown (see src/ui/regionShading.ts): bands of elevation on the vertical cut, the service sector on the horizontal
 * one, with a caption that states the bounds. With many files they are drawn in the marker layer like the markers.
 */

const TOGGLE = 'Show Angular regions (est.) columns';

interface Shading {
  /** Region traces of the chart (polar) and shapes (rectangular): [name, start, end]. */
  chart: [string, number, number][];
  /** The same in the marker layer, when the plot has one. */
  layer: [string, number, number][];
}

/** The shading a cut plot draws now, in its chart and in its marker layer. */
const shadingOf = (page: Page, id: 'plot-h' | 'plot-v') =>
  page.evaluate((testId): Shading => {
    type Gd = HTMLElement & { data?: { name?: string; theta?: number[]; x?: number[] }[]; layout?: { shapes?: { name?: string; x0?: number; x1?: number }[] } };
    const of = (gd: Gd | null): [string, number, number][] => {
      if (!gd) return [];
      const fromTraces = (gd.data ?? [])
        .filter((t) => t.name?.endsWith(' region'))
        .map((t): [string, number, number] => {
          const a = (t.theta ?? t.x)!;
          return [t.name!, a[0], a[a.length - 1]];
        });
      const fromShapes = (gd.layout?.shapes ?? []).filter((s) => s.name?.endsWith(' region')).map((s): [string, number, number] => [s.name!, s.x0!, s.x1!]);
      return [...fromTraces, ...fromShapes];
    };
    const root = document.querySelector(`[data-testid="${testId}"]`)!;
    const layer = document.querySelector(`[data-testid="${testId}-layer"]`) as Gd | null;
    const chart = (root.querySelector('.chart-under-layer') ?? root.querySelector('.js-plotly-plot')) as Gd | null;
    return { chart: of(chart), layer: of(layer) };
  }, id);

/** A signed angle as the caption writes it ("+2.3°", "−90°"). */
const angle = (text: string) => Number(text.replace('−', '-').replace('°', ''));

/** The service region's start in the vertical cut's caption. */
async function captionServiceStart(page: Page): Promise<number> {
  const text = await page.getByTestId('regions-v').innerText();
  const m = /service \(green\) ([+−]?[\d.]+°) to/.exec(text);
  expect(m, text).not.toBeNull();
  return angle(m![1]);
}

/** A table cell's value; of an original → simulated pair, the simulated one. */
const cellValue = async (page: Page, rowId: string, col: string) => {
  const text = await page.locator(`tr[data-row-id="${rowId}"] td[data-col="${col}"]`).innerText();
  const parts = text.split('→');
  return Number(parts[parts.length - 1].trim().replace('−', '-'));
};

/** The service region starts half a V-HPBW above the beam peak: the caption says what the table's columns give. */
async function expectCaptionMatchesTable(page: Page, rowId: string) {
  const peak = await cellValue(page, rowId, 'vPeak');
  const hpbw = await cellValue(page, rowId, 'vHpbw');
  // (Both cells and the caption are rounded to a tenth.)
  expect(Math.abs((await captionServiceStart(page)) - (peak - hpbw / 2))).toBeLessThan(0.16);
}

const rowId = async (page: Page, n: number) => (await page.locator('tr[data-row-id]').nth(n).getAttribute('data-row-id'))!;
async function clickRow(page: Page, n: number) {
  await page.locator('tr[data-row-id]').nth(n).click();
  await page.mouse.move(2, 2);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(page.locator('tr.hl[data-row-id]')).toHaveCount(1);
}

const plotType = (page: Page, mode: 'Polar' | 'Rectangular') => page.getByRole('group', { name: 'Plot type' }).getByRole('button', { name: mode, exact: true }).click();

test('example set: the highlighted file\'s regions are shaded while their columns are shown, polar and rectangular, and follow the highlight', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await clickRow(page, 3);
  const first = await rowId(page, 3);

  // Off with the columns.
  for (const id of ['plot-h', 'plot-v'] as const) expect(await shadingOf(page, id)).toEqual({ chart: [], layer: [] });
  await expect(page.getByTestId('regions-v')).toHaveCount(0);

  await page.getByLabel(TOGGLE).check();
  await expect.poll(async () => (await shadingOf(page, 'plot-v')).chart.length).toBeGreaterThan(3);
  const v = await shadingOf(page, 'plot-v');
  // 24 files: one chart, no layer.
  expect(v.layer).toEqual([]);
  expect(v.chart.map(([name]) => name)).toEqual(expect.arrayContaining(['upper region', 'interference region', 'service region', 'lower region']));
  expect((await shadingOf(page, 'plot-h')).chart.map(([name]) => name)).toEqual(['service region', 'interference region']);
  // The caption names the file and its bounds, the ones the table's peak tilt and V-HPBW give.
  const label = (await page.getByTestId('readout-v').locator('strong').innerText()).replace(/:$/, '');
  await expect(page.getByTestId('regions-v')).toContainText(`Tinted: angular regions (est.) of ${label}`);
  await expect(page.getByTestId('regions-v')).toContainText('lower (purple) +75° to +90°');
  await expect(page.getByTestId('regions-h')).toContainText('service (green) within ±60°');
  await expectCaptionMatchesTable(page, first);

  // Rectangular: bands (shapes), no traces.
  await plotType(page, 'Rectangular');
  // (The polar wedge of the lower region runs 75…105° too: the bands are told by the upper region, which starts near
  // 185° on the polar plot and near −175° on the rectangular axis.)
  await expect.poll(async () => (await shadingOf(page, 'plot-v')).chart.find(([name]) => name === 'upper region')?.[1]).toBeLessThan(-170);
  const rect = (await shadingOf(page, 'plot-v')).chart;
  expect(rect.filter(([name]) => name === 'lower region')).toEqual([['lower region', 75, 105]]);
  for (const [, from, to] of rect) {
    expect(from).toBeGreaterThanOrEqual(-180);
    expect(to).toBeLessThanOrEqual(180);
  }

  // Another file highlighted: its regions.
  await clickRow(page, 20);
  const second = await rowId(page, 20);
  const label2 = (await page.getByTestId('readout-v').locator('strong').innerText()).replace(/:$/, '');
  expect(label2).not.toBe(label);
  await expect(page.getByTestId('regions-v')).toContainText(label2);
  await expectCaptionMatchesTable(page, second);

  // No marker target: nothing shaded.
  await page.locator('body').press('Escape');
  await expect(page.locator('tr.hl[data-row-id]')).toHaveCount(0);
  await expect(page.getByTestId('regions-v')).toHaveCount(0);
  await expect.poll(async () => (await shadingOf(page, 'plot-v')).chart).toEqual([]);

  // Columns hidden again: gone.
  await clickRow(page, 3);
  await expect(page.getByTestId('regions-v')).toHaveCount(1);
  await page.getByLabel(TOGGLE).uncheck();
  await expect(page.getByTestId('regions-v')).toHaveCount(0);
  await expect(page.getByTestId('regions-h')).toHaveCount(0);
  await plotType(page, 'Polar');
  await expect.poll(async () => [(await shadingOf(page, 'plot-v')).chart, (await shadingOf(page, 'plot-h')).chart]).toEqual([[], []]);
  expect(problems).toEqual([]);
});

/** Redraws both plots from nothing (the dark theme and back) and returns their shading then. */
async function redrawn(page: Page) {
  const dark = page.getByRole('button', { name: 'Dark mode', exact: true });
  await dark.click();
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await settled(page);
  await dark.click();
  await expect(dark).toHaveAttribute('aria-pressed', 'false');
  await settled(page);
  return { h: await shadingOf(page, 'plot-h'), v: await shadingOf(page, 'plot-v') };
}

const chartUids = (page: Page) =>
  page.evaluate(() => ['plot-h', 'plot-v'].map((id) => (document.querySelector(`[data-testid="${id}"] .chart-under-layer`) as unknown as { _fullLayout: { _uid: string } })._fullLayout._uid));

for (const mode of ['Polar', 'Rectangular'] as const) {
  test(`48 files, ${mode.toLowerCase()}: the shading is drawn in the marker layer, a highlight redraws no trace, and after a held tilt drag it follows the table`, async ({ page }) => {
    test.slow();
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await loadMany(page, 48);
    await page.getByLabel(TOGGLE).check();
    await plotType(page, mode);
    await expect(page.getByTestId('plot-v-layer')).toHaveCount(1);
    await page.locator('body').press('Escape');
    await settled(page);
    const charts = await chartUids(page);

    await clickRow(page, 5);
    const target = await rowId(page, 5);
    await settled(page);
    const shown = { h: await shadingOf(page, 'plot-h'), v: await shadingOf(page, 'plot-v') };
    // In the layer only; the chart under it was not drawn anew.
    expect(shown.v.chart).toEqual([]);
    expect(shown.h.chart).toEqual([]);
    expect(shown.v.layer.length).toBeGreaterThan(3);
    expect(shown.h.layer.length).toBeGreaterThan(0);
    expect(await chartUids(page)).toEqual(charts);
    await expectCaptionMatchesTable(page, target);
    const before = await captionServiceStart(page);
    expect(await redrawn(page)).toEqual(shown);

    // A mechanical tilt dragged with the slider: held while gripped, applied at release. The shading then follows the
    // tilted beam, as the table does.
    const slider = page.getByRole('slider', { name: MECHANICAL, exact: true });
    // (The row click may have scrolled the page.)
    await slider.scrollIntoViewIfNeeded();
    const box = (await slider.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + i * 6, y);
    // Held: the shading, like the table, still shows the untilted beam while the slider is gripped.
    await expect(page.getByTestId('updating-2d')).toHaveText(WAITING);
    expect(await captionServiceStart(page)).toBe(before);
    await page.mouse.up();
    await settled(page);
    expect(Number(await slider.inputValue())).toBeGreaterThan(1);
    await expectCaptionMatchesTable(page, target);
    expect(await captionServiceStart(page)).toBeGreaterThan(before + 0.5);
    const tilted = { h: await shadingOf(page, 'plot-h'), v: await shadingOf(page, 'plot-v') };
    expect(tilted.v).not.toEqual(shown.v);
    expect(tilted.v.chart).toEqual([]);
    expect(await redrawn(page)).toEqual(tilted);
    expect(problems).toEqual([]);
  });
}
