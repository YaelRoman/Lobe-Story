import { expect, test, type Page } from '@playwright/test';
import { loadMany } from './manyFiles';
import { seriesIdOf } from '../src/ui/traceUid';

/**
 * With many files a cut plot draws the highlighted file's markers and title in a layer of their own over the chart
 * (see src/ui/markerLayer.ts): a highlight restyles the chart's traces and moves the highlighted one on top in the
 * page, without a redraw. What it then shows must be what a redraw from nothing shows.
 */

interface Drawn {
  /** The file traces as the page paints them, bottom to top: [file id, line width, opacity]. */
  traces: [string | null, string, string][];
  /** The layer's traces (the markers), by name, the empty first one left out. */
  markers: string[];
  title: string;
  shapes: number;
  /** The layer's view: polar [rotation, level range]; x/y [x range, y range]. */
  view: unknown;
}

/** What a cut plot shows, from the page: its chart's painted traces and its marker layer. */
const drawn = (page: Page, id = 'plot-h') =>
  page.evaluate((testId): Drawn => {
    type Gd = HTMLElement & { data: { uid?: string; name?: string }[]; layout: { title?: { text?: string }; shapes?: unknown[] }; _fullLayout: Record<string, { range?: number[]; rotation?: number; radialaxis?: { range: number[] }; angularaxis?: { rotation: number } }> };
    const chart = document.querySelector(`[data-testid="${testId}"] .chart-under-layer`) as Gd;
    const layer = document.querySelector(`[data-testid="${testId}-layer"]`) as Gd;
    const uids = chart.data.map((t) => t.uid).filter((uid): uid is string => typeof uid === 'string');
    const traces = Array.from(chart.querySelectorAll('.scatterlayer .trace')).map((el) => {
      const uid = uids.find((u) => el.classList.contains(`trace${u}`)) ?? null;
      const line = el.querySelector('path.js-line') as SVGPathElement | null;
      return [uid, line?.style.strokeWidth ?? '', (el as SVGGElement).style.opacity] as [string | null, string, string];
    });
    const f = layer._fullLayout;
    return {
      traces,
      markers: layer.data.slice(1).map((t) => t.name ?? ''),
      title: layer.layout.title?.text ?? '',
      shapes: layer.layout.shapes?.length ?? 0,
      view: f.polar ? [f.polar.angularaxis!.rotation, f.polar.radialaxis!.range] : [f.xaxis.range, f.yaxis.range],
    };
  }, id);

const ids = (d: Drawn) => d.traces.map(([uid]) => (uid === null ? null : seriesIdOf(uid)));

/** Both plots as they are drawn now, once they have settled. */
async function settledState(page: Page) {
  await expect(page.getByTestId('updating-2d')).toHaveCount(0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return { h: await drawn(page, 'plot-h'), v: await drawn(page, 'plot-v') };
}

/** Redraws both plots from nothing (the dark theme and back: new figures) and returns what they show then. */
async function redrawnState(page: Page) {
  const dark = page.getByRole('button', { name: 'Dark mode', exact: true });
  await dark.click();
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => (document.querySelector('[data-testid="plot-h"] .chart-under-layer') as unknown as { layout: { paper_bgcolor?: string } }).layout.paper_bgcolor)).not.toBe('#ffffff');
  await dark.click();
  await expect(dark).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => (document.querySelector('[data-testid="plot-h"] .chart-under-layer') as unknown as { layout: { paper_bgcolor?: string } }).layout.paper_bgcolor)).toBe('#ffffff');
  return settledState(page);
}

const rowId = async (page: Page, n: number) => (await page.locator('tr[data-row-id]').nth(n).getAttribute('data-row-id'))!;
async function clickRow(page: Page, n: number) {
  await page.locator('tr[data-row-id]').nth(n).click();
  // The pointer and the focus away from the table: what is seen is the highlight, not a preview.
  await page.mouse.move(2, 2);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

for (const mode of ['Polar', 'Rectangular'] as const) {
  test(`48 files, ${mode.toLowerCase()}: highlight, clear and highlight another file over the marker layer draw what a redraw from nothing draws`, async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(m.text());
    });
    await loadMany(page, 48);
    await page.getByRole('group', { name: 'Plot type' }).getByRole('button', { name: mode, exact: true }).click();
    await expect(page.getByTestId('plot-h-layer')).toHaveCount(1);
    await expect(page.getByTestId('plot-v-layer')).toHaveCount(1);
    // Loading highlights a file: none to start from.
    await page.locator('body').press('Escape');
    await expect(page.locator('tr.hl[data-row-id]')).toHaveCount(0);
    const plain = await settledState(page);
    const series = ids(plain.h);
    expect(series).toHaveLength(48);
    const charts = await page.evaluate(() => ['plot-h', 'plot-v'].map((id) => (document.querySelector(`[data-testid="${id}"] .chart-under-layer`) as unknown as { _fullLayout: { _uid: string } })._fullLayout._uid));

    const first = await rowId(page, 5);
    const second = await rowId(page, 30);
    for (const [step, act, target] of [
      ['highlight', () => clickRow(page, 5), first],
      ['clear', () => page.locator('body').press('Escape'), null],
      ['highlight another', () => clickRow(page, 30), second],
    ] as const) {
      await act();
      if (target) await expect(page.locator(`tr.hl[data-row-id="${target}"]`)).toHaveCount(1);
      else await expect(page.locator('tr.hl[data-row-id]')).toHaveCount(0);
      const now = await settledState(page);
      for (const cut of ['h', 'v'] as const) {
        const d = now[cut];
        // The highlighted file is painted last, thick; the others dimmed. Without one, every file plain in its place.
        expect(ids(d), `${step} ${cut}`).toEqual(target ? [...series.filter((id) => id !== target), target] : series);
        expect(d.traces.filter(([, w]) => w === '2.5px').length).toBe(target ? 1 : 0);
        expect(d.traces.filter(([, w, o]) => w === '1.5px' && o === (target ? '0.35' : '1')).length).toBe(target ? 47 : 48);
        expect(d.title).toMatch(target ? / — HPBW \d+\.\d°/ : /^(Horizontal|Vertical) cut$/);
        expect(d.markers.length + d.shapes > 0).toBe(target !== null);
      }
      // The charts were not plotted anew, and the read-out follows.
      expect(await page.evaluate(() => ['plot-h', 'plot-v'].map((id) => (document.querySelector(`[data-testid="${id}"] .chart-under-layer`) as unknown as { _fullLayout: { _uid: string } })._fullLayout._uid))).toEqual(charts);
      if (target) await expect(page.getByTestId('readout-h')).toContainText('HPBW');
      // A redraw from nothing draws the same.
      expect(await redrawnState(page), step).toEqual(now);
    }
    expect(problems).toEqual([]);
  });
}

test('48 files, polar: the marker layer follows a turn, a zoom and a reset of the chart, and the hover names a marker where no trace is near', async ({ page }) => {
  await loadMany(page, 48);
  await clickRow(page, 5);
  await expect(page.locator('tr.hl[data-row-id]')).toHaveCount(1);
  await settledState(page);
  const chartView = () =>
    page.evaluate(() => {
      const f = (document.querySelector('[data-testid="plot-h"] .chart-under-layer') as unknown as { _fullLayout: { polar: { angularaxis: { rotation: number }; radialaxis: { range: number[] } } } })._fullLayout.polar;
      return [f.angularaxis.rotation, f.radialaxis.range];
    });
  const plot = page.getByTestId('plot-h');
  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.locator('.chart-under-layer .maindrag').boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // In the beam's sector, halfway out: inside the beamwidth wedge, far from every trace.
  await page.mouse.move(centre.x, centre.y - box.height * 0.22);
  await expect(page.getByTestId('plot-h-layer').locator('.hovertext')).toContainText(/HPBW \d/);
  // At the beam's peak a file trace and the end of the squint ray meet: the chart and the layer both have a label, and
  // one only is shown (which one, as in one chart, is the test "…from any direction" below).
  await page.mouse.move(centre.x, box.y + 4);
  await expect(plot.locator('.chart-under-layer .hovertext')).toHaveCount(1);
  await expect.poll(() => shownHoverText(page)).not.toBe('');
  await expect.poll(() => shownHoverText(page)).not.toContain('|');

  // A turn by the rim: the layer turns along while the pointer moves, and keeps the chart's turn when it is let go.
  const rim = (deg: number) => ({ x: centre.x + (box.width / 2 + 15) * Math.cos((deg * Math.PI) / 180), y: centre.y - (box.width / 2 + 15) * Math.sin((deg * Math.PI) / 180) });
  await page.mouse.move(rim(45).x, rim(45).y);
  await page.mouse.down();
  await page.mouse.move(rim(100).x, rim(100).y, { steps: 5 });
  await expect.poll(async () => ((await drawn(page)).view as [number, number[]])[0]).not.toBe(90);
  await page.mouse.up();
  await expect.poll(async () => (await chartView())[0]).not.toBe(90);
  await expect.poll(async () => (await drawn(page)).view).toEqual(await chartView());

  // A drag zoom in the plot area.
  await page.mouse.move(centre.x + 15, centre.y + 15);
  await page.mouse.down();
  await page.mouse.move(centre.x + 60, centre.y + 50, { steps: 5 });
  await page.mouse.up();
  await expect.poll(chartView).not.toEqual([90, [-40, 0]]);
  await expect.poll(async () => (await drawn(page)).view).toEqual(await chartView());

  // The toolbar's reset.
  await plot.hover();
  await plot.locator('.modebar-btn[data-title="Reset view"]').click();
  await expect.poll(chartView).toEqual([90, [-40, 0]]);
  await expect.poll(async () => (await drawn(page)).view).toEqual([90, [-40, 0]]);
});

/** The hover text shown over the horizontal plot now, the visible label only (the chart's or the layer's), or '' for none. */
const shownHoverText = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="plot-h"] .hovertext'))
      .filter((el) => getComputedStyle(el).visibility !== 'hidden')
      .map((el) => el.textContent ?? '')
      .join(' | '),
  );

/**
 * Hover texts along the beam (the 0° ray of the horizontal polar plot) at `fractions` of the plot height from the
 * centre (negative: below it), visited in that order, the pointer moving in small steps from one to the next.
 */
async function beamSweep(page: Page, fractions: number[]): Promise<string[]> {
  const plot = page.getByTestId('plot-h');
  await plot.scrollIntoViewIfNeeded();
  // Measured at every step: the page must not have moved under the pointer.
  const at = async (f: number) => {
    const box = (await plot.locator('.js-plotly-plot .maindrag').first().boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 - box.height * f };
  };
  const out: string[] = [];
  await page.mouse.move(2, 2);
  const start = await at(fractions[0]);
  await page.mouse.move(start.x, start.y);
  for (const f of fractions) {
    const p = await at(f);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(250);
    out.push(await shownHoverText(page));
  }
  await page.mouse.move(2, 2);
  await page.waitForTimeout(150);
  return out;
}

/** The hover text after the pointer rests on the beam at `f` and then leaves the plot area for the chart's margin. */
async function leaveFrom(page: Page, f: number): Promise<string> {
  const box = (await page.getByTestId('plot-h').locator('.js-plotly-plot .maindrag').first().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - box.height * f, { steps: 3 });
  await page.waitForTimeout(250);
  await page.mouse.move(box.x + box.width + 8, box.y + 5, { steps: 4 });
  await page.waitForTimeout(250);
  const text = await shownHoverText(page);
  await page.mouse.move(2, 2);
  return text;
}

const OUTWARD = [0.01, 0.03, 0.1, 0.2, 0.3, 0.4, 0.43, 0.46, 0.48, 0.5];
const INWARD = [0.5, 0.46, 0.43, 0.3, 0.2, 0.08, 0.03, 0.01];
const FROM_BELOW = [-0.1, -0.05, -0.02, 0.01, 0.03];
const FROM_WEDGE = [0.2, 0.08, 0.03];

test('polar hover over the marker layer names the markers that lie on the highlighted trace, as one chart does, from any direction', async ({ page }) => {
  await loadMany(page, 25);
  await clickRow(page, 5);
  const target = await rowId(page, 5);
  await expect(page.locator(`tr.hl[data-row-id="${target}"]`)).toHaveCount(1);
  const sweeps = async () => ({
    outward: await beamSweep(page, OUTWARD),
    inward: await beamSweep(page, INWARD),
    below: await beamSweep(page, FROM_BELOW),
    wedge: await beamSweep(page, FROM_WEDGE),
    // Off the plot area into the margin, from a marker on the trace and from the wedge.
    leave: [await leaveFrom(page, 0.46), await leaveFrom(page, 0.2)],
  });
  // Another file unticked: 24 traces, one chart with the markers among its traces.
  const other = page.locator('.panel li').filter({ hasNotText: target }).last().locator('input[type="checkbox"]');
  await other.uncheck();
  await expect(page.getByTestId('plot-h-layer')).toHaveCount(0);
  await settledState2d(page);
  const single = await sweeps();
  // Ticked again: 25 traces, markers in the layer.
  await other.check();
  await expect(page.getByTestId('plot-h-layer')).toHaveCount(1);
  await settledState2d(page);
  const layered = await sweeps();
  const all = Object.values(single).flat().join(' ');
  expect(all).toMatch(/Squint/);
  expect(all).toMatch(/−3 dB/);
  expect(all).toMatch(/HPBW \d/);
  // Where one chart names a marker, the layered plot names the same; where it names a file's trace (one file fewer
  // there, so not necessarily the same one), the layered plot names a trace too; where nothing, nothing.
  for (const sweep of ['outward', 'inward', 'below', 'wedge', 'leave'] as const) {
    single[sweep].forEach((text, k) => {
      const what = `${sweep} ${k}: one chart "${text}", layered "${layered[sweep][k]}"`;
      if (text.includes('.msi')) expect(layered[sweep][k], what).toContain('.msi');
      else expect(layered[sweep][k], what).toBe(text);
    });
  }
});

/** The plots have settled after a change of the drawn files. */
async function settledState2d(page: Page) {
  await expect(page.getByTestId('updating-2d')).toHaveCount(0);
  await page.waitForTimeout(300);
}

/** Where a cut plot draws the highlighted file's part: in its layer (with no marker or title in the chart), or in the chart. */
const markersIn = (page: Page, id = 'plot-h') =>
  page.evaluate((testId) => {
    type Gd = HTMLElement & { data: { uid?: string }[]; layout: { title?: { text?: string }; shapes?: unknown[] }; _fullLayout: { _size: { w: number; h: number } } };
    const chart = document.querySelector(`[data-testid="${testId}"] .js-plotly-plot`) as Gd;
    const layer = document.querySelector(`[data-testid="${testId}-layer"]`) as Gd | null;
    const inChart = chart.data.filter((t) => typeof t.uid !== 'string').length;
    return {
      where: layer ? 'layer' : 'chart',
      chartMarkers: inChart,
      chartTitle: chart.layout.title?.text ?? '',
      // Marker traces and (rectangular) marker shapes.
      layerMarkers: layer ? layer.data.length - 1 + (layer.layout.shapes?.length ?? 0) : 0,
      sameArea: layer ? JSON.stringify([chart._fullLayout._size.w, chart._fullLayout._size.h]) === JSON.stringify([layer._fullLayout._size.w, layer._fullLayout._size.h]) : null,
    };
  }, id);

test('25 files: the layer comes and goes across 24 by untick, Remove and Undo, and with plot type changes', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  await loadMany(page, 25);
  await clickRow(page, 3);
  const target = await rowId(page, 3);
  const layeredNow = async () => {
    await settledState2d(page);
    await expect.poll(async () => (await markersIn(page)).where).toBe('layer');
    const m = await markersIn(page);
    expect(m).toMatchObject({ chartMarkers: 0, chartTitle: '', sameArea: true });
    expect(m.layerMarkers).toBeGreaterThan(0);
  };
  const singleNow = async () => {
    await settledState2d(page);
    await expect.poll(async () => (await markersIn(page)).where).toBe('chart');
    const m = await markersIn(page);
    expect(m.chartTitle).toMatch(/^Horizontal cut/);
  };
  await layeredNow();

  // Untick one (24): markers back in the chart; tick it again (25): in the layer.
  const other = page.locator('.panel li').filter({ hasNotText: target }).last();
  await other.locator('input[type="checkbox"]').uncheck();
  await singleNow();
  expect((await markersIn(page)).chartMarkers).toBeGreaterThan(0);
  await other.locator('input[type="checkbox"]').check();
  await layeredNow();

  // Remove the highlighted file (24, nothing highlighted any more), then Undo (25 again).
  const row = page.locator('.panel li').filter({ hasText: target }).first();
  await row.getByLabel(/^Actions for /).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await singleNow();
  expect((await markersIn(page)).chartMarkers).toBe(0);
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('Control+z');
  await expect(page.locator('.panel li')).toHaveCount(25);
  // (Undo may bring the highlight back with the file.)
  if ((await page.locator('tr.hl[data-row-id]').count()) === 0) await clickRow(page, 3);
  await expect(page.locator('tr.hl[data-row-id]')).toHaveCount(1);
  await layeredNow();

  // Rectangular, 3D and back: the layer is laid out as the chart each time.
  await page.getByRole('group', { name: 'Plot type' }).getByRole('button', { name: 'Rectangular' }).click();
  await layeredNow();
  await page.getByRole('group', { name: 'Dimension' }).getByRole('button', { name: '3D' }).click();
  await expect(page.getByTestId('plot-3d')).toHaveCount(1);
  await page.getByRole('group', { name: 'Dimension' }).getByRole('button', { name: '2D' }).click();
  await layeredNow();
  await page.getByRole('group', { name: 'Plot type' }).getByRole('button', { name: 'Polar' }).click();
  await layeredNow();
  expect(problems).toEqual([]);
});

test('48 files: a marker layer the library fails to draw is given up, and the markers and the title are drawn in the chart', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loadMany(page, 48);
  await clickRow(page, 5);
  await expect(page.locator('tr.hl[data-row-id]')).toHaveCount(1);
  await expect.poll(async () => (await markersIn(page)).layerMarkers).toBeGreaterThan(0);
  // The library throws while it takes marker traces out of a chart: here only the layer does (a cleared highlight).
  await page.evaluate(() => {
    const original = Element.prototype.querySelector;
    Element.prototype.querySelector = function (this: Element, selector: string) {
      if (selector.startsWith('.cb') && this.closest('.marker-layer')) throw new SyntaxError('injected: not a valid selector');
      return original.call(this, selector);
    } as typeof original;
  });
  await page.locator('body').press('Escape');
  await expect(page.locator('tr.hl[data-row-id]')).toHaveCount(0);
  // No layer any more; the chart has its title (and axes) again, and no message replaces the plot.
  await expect(page.getByTestId('plot-h-layer')).toHaveCount(0);
  await expect.poll(async () => (await markersIn(page)).chartTitle).toBe('Horizontal cut');
  await expect(page.getByRole('alert').filter({ hasText: 'This plot could not be drawn' })).toHaveCount(0);
  const labels = page.getByTestId('plot-h').locator('.angularaxistick text').first();
  await expect.poll(() => labels.evaluate((el) => getComputedStyle(el).fill)).not.toBe('rgba(0, 0, 0, 0)');
  // A highlight now draws its markers in the chart, and the plots are not left behind (the export is not held).
  await clickRow(page, 9);
  await expect.poll(async () => (await markersIn(page)).chartMarkers).toBeGreaterThan(0);
  await expect.poll(async () => (await markersIn(page)).chartTitle).toMatch(/ — HPBW /);
  await expect(page.getByTestId('updating-2d')).toHaveCount(0);
  expect(errors).toEqual([]);
});
