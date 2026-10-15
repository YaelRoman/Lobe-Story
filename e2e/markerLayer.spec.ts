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
  // On the beam: a file trace is named by the chart, and the layer names nothing.
  await page.mouse.move(centre.x, box.y + 4);
  await expect(plot.locator('.chart-under-layer .hovertext')).toHaveCount(1);
  await expect(page.getByTestId('plot-h-layer').locator('.hovertext')).toHaveCount(0);

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
