import { expect, test, type Page } from '@playwright/test';
import { isReferenceUid, seriesIdOf } from '../src/ui/traceUid';

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

/** What the horizontal cut plot holds now: per file trace [uid, line width, opacity], the count of the other traces, the title, the shapes. */
const cutState = (page: Page, testId = 'plot-h') =>
  page.evaluate((id) => {
    const gd = document.querySelector(`[data-testid="${id}"] .js-plotly-plot`) as unknown as {
      data: { uid?: string; line?: { width?: number }; opacity?: number; name?: string }[];
      layout: { title?: { text?: string }; shapes?: unknown[] };
    };
    const files = gd.data.filter((t) => typeof t.uid === 'string');
    return {
      files: files.map((t) => [t.uid!, t.line?.width, t.opacity ?? 1] as const),
      markers: gd.data.filter((t) => typeof t.uid !== 'string').map((t) => t.name ?? ''),
      title: gd.layout.title?.text ?? '',
      shapes: gd.layout.shapes?.length ?? 0,
    };
  }, testId);
type ArraysByUid = Record<string, unknown>[];
/** Remembers the arrays of every drawn file trace of both cut plots, by trace uid, to see later whether they were built again. */
const rememberArrays = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __arrays: ArraysByUid }).__arrays = ['plot-h', 'plot-v'].map((id) => {
      const data = (document.querySelector(`[data-testid="${id}"] .js-plotly-plot`) as unknown as { data: { uid?: string; r?: unknown; y?: unknown }[] }).data;
      return Object.fromEntries(data.filter((t) => typeof t.uid === 'string').map((t) => [t.uid!, t.r ?? t.y]));
    });
  });
/** By uid, not by place: a highlight moves its trace on top of the others. */
const sameArrays = (page: Page) =>
  page.evaluate(() =>
    ['plot-h', 'plot-v'].every((id, k) => {
      const now = (document.querySelector(`[data-testid="${id}"] .js-plotly-plot`) as unknown as { data: { uid?: string; r?: unknown; y?: unknown }[] }).data.filter((t) => typeof t.uid === 'string');
      const before = (window as unknown as { __arrays: ArraysByUid }).__arrays[k];
      return now.length === Object.keys(before).length && now.every((t) => (t.r ?? t.y) === before[t.uid!]);
    }),
  );

test('a highlight restyles the traces that are drawn: no trace is built again, and emphasis, markers, title and read-out follow', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  await loadExample(page);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect.poll(async () => (await cutState(page)).files.length).toBe(24);
  // Pin a reference: it is never dimmed.
  await page.locator('.panel li').nth(2).getByLabel(/^Actions for /).click();
  await page.getByRole('menuitem', { name: 'Use as reference' }).click();
  await page.locator('body').press('Escape');
  await expect(page.locator('tr.hl[data-row-id]')).toHaveCount(0);
  await expect.poll(async () => (await cutState(page)).title).toBe('Horizontal cut');
  const plain = await cutState(page);
  expect(plain.markers).toEqual([]);
  expect(plain.files.filter((t) => t[1] === 3.5)).toHaveLength(1);
  expect(plain.files.filter((t) => t[1] === 1.5 && t[2] === 1)).toHaveLength(23);
  await rememberArrays(page);
  const ids = await plotIds(page, ['plot-h', 'plot-v']);

  for (const n of [7, 12]) {
    const row = page.locator('tr[data-row-id]').nth(n);
    await row.click();
    await expect(row).toHaveClass(/hl/);
    // The pointer still rests on the row: move it away, so what is seen is the highlight's own emphasis, not a preview.
    await page.mouse.move(2, 2);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect.poll(async () => (await cutState(page)).markers.length).toBeGreaterThan(0);
    const lit = await cutState(page);
    // One file thick, the reference as it was, every other file dimmed.
    expect(lit.files.filter((t) => t[1] === 2.5 && t[2] === 1)).toHaveLength(1);
    expect(lit.files.filter((t) => t[1] === 3.5 && t[2] === 1)).toHaveLength(1);
    expect(lit.files.filter((t) => t[1] === 1.5 && t[2] === 0.35)).toHaveLength(22);
    // Its markers are drawn after the file traces, the title names its beamwidth, the read-out its name.
    expect(lit.markers.some((name) => /^HPBW \d/.test(name))).toBe(true);
    expect(lit.title).toMatch(/^Horizontal cut — HPBW \d+\.\d°$/);
    await expect(page.getByTestId('readout-h')).toContainText('HPBW');
    // The vertical cut follows as well.
    await expect.poll(async () => (await cutState(page, 'plot-v')).title).toMatch(/^Vertical cut — HPBW/);
    expect((await cutState(page, 'plot-v')).files.filter((t) => t[1] === 2.5)).toHaveLength(1);
    // Nothing was built again: the same arrays, the same charts.
    expect(await sameArrays(page)).toBe(true);
    expect(await plotIds(page, ['plot-h', 'plot-v'])).toEqual(ids);
  }

  // Esc: every trace plain again, the markers and the beamwidth in the title gone, still the same arrays.
  await page.locator('body').press('Escape');
  await expect.poll(async () => JSON.stringify(await cutState(page))).toBe(JSON.stringify(plain));
  expect(await sameArrays(page)).toBe(true);

  // Rectangular: the markers are partly shapes; they come and go with the highlight too.
  await page.getByRole('group', { name: 'Plot type' }).getByRole('button', { name: 'Rectangular' }).click();
  await expect(page.locator('[data-testid="plot-h"] .xtitle')).toHaveCount(1);
  expect((await cutState(page)).shapes).toBe(0);
  await rememberArrays(page);
  await page.locator('tr[data-row-id]').nth(9).click();
  await page.mouse.move(2, 2);
  await expect.poll(async () => (await cutState(page)).shapes).toBeGreaterThan(0);
  expect((await cutState(page)).files.filter((t) => t[1] === 2.5)).toHaveLength(1);
  expect(await sameArrays(page)).toBe(true);
  await page.locator('body').press('Escape');
  await expect.poll(async () => (await cutState(page)).shapes).toBe(0);
  expect(problems).toEqual([]);
});

/** The file traces of a cut plot in the order the charting library holds (and draws) them: [file id, line width, is the reference]. */
const drawingOrder = async (page: Page, testId = 'plot-h') =>
  (await cutState(page, testId)).files.map(([uid, width]) => [seriesIdOf(uid), width, isReferenceUid(uid)] as const);
/** The file ids of the drawn traces, bottom to top, as the SVG has them. */
const paintedOrder = (page: Page, testId = 'plot-h') =>
  page.evaluate((id) => {
    const gd = document.querySelector(`[data-testid="${id}"] .js-plotly-plot`) as unknown as HTMLElement & { data: { uid?: string }[] };
    const uids = gd.data.map((t) => t.uid).filter((uid): uid is string => typeof uid === 'string');
    return Array.from(gd.querySelectorAll('.scatterlayer .trace'))
      .map((el) => uids.find((uid) => el.classList.contains(`trace${uid}`)))
      .filter((uid): uid is string => uid !== undefined);
  }, testId);

test('the highlighted file is drawn on top of the other files, under the reference only, and goes back to its place when the highlight ends', async ({ page }) => {
  await loadExample(page);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect.poll(async () => (await cutState(page)).files.length).toBe(24);
  await page.locator('.panel li').nth(2).getByLabel(/^Actions for /).click();
  await page.getByRole('menuitem', { name: 'Use as reference' }).click();
  await page.locator('body').press('Escape');
  await expect(page.locator('tr.hl[data-row-id]')).toHaveCount(0);
  await expect.poll(async () => (await cutState(page)).title).toBe('Horizontal cut');
  const series = await drawingOrder(page);
  const seriesV = await drawingOrder(page, 'plot-v');
  const ids = series.map((t) => t[0]);
  // The reference is the last trace, whatever is highlighted.
  expect(series.map((t) => t[2])).toEqual([...Array.from({ length: 23 }, () => false), true]);
  const charts = await plotIds(page, ['plot-h', 'plot-v']);
  const legend = await page.getByTestId('plot-h').locator('.legend .legendtext').allTextContents();

  /** Series order with `id` moved to the place just under the reference. */
  const withOnTop = (id: string) => [...ids.slice(0, 23).filter((x) => x !== id), id, ids[23]];
  const rowId = async (n: number) => (await page.locator('tr[data-row-id]').nth(n).getAttribute('data-row-id'))!;
  const first = await rowId(7);
  const second = await rowId(12);
  expect(ids.indexOf(first)).toBeLessThan(22);
  expect(ids.indexOf(second)).toBeLessThan(22);

  // A highlight: its trace is the last file trace but the reference, and thick.
  await page.locator('tr[data-row-id]').nth(7).click();
  await page.mouse.move(2, 2);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(async () => (await drawingOrder(page)).map((t) => t[0])).toEqual(withOnTop(first));
  await expect.poll(async () => (await drawingOrder(page))[22]).toEqual([first, 2.5, false]);
  await expect.poll(async () => (await drawingOrder(page, 'plot-v'))[22]).toEqual([first, 2.5, false]);
  expect((await paintedOrder(page)).map((uid) => seriesIdOf(uid))).toEqual(withOnTop(first));
  // The legend keeps the order of the files.
  expect(await page.getByTestId('plot-h').locator('.legend .legendtext').allTextContents()).toEqual(legend);

  // A hover preview of another row restyles that file's trace, wherever the traces now are.
  await page.locator('tr[data-row-id]').nth(12).hover();
  await expect.poll(async () => (await drawingOrder(page)).filter((t) => t[1] === 2.5).map((t) => t[0])).toEqual([second]);
  expect((await cutState(page)).files.filter((t) => t[2] === 0.35)).toHaveLength(22);
  expect((await drawingOrder(page)).map((t) => t[0])).toEqual(withOnTop(first));
  await page.mouse.move(2, 2);
  await expect.poll(async () => (await drawingOrder(page)).filter((t) => t[1] === 2.5).map((t) => t[0])).toEqual([first]);

  // Another highlight: the first file is back in its place, the new one on top.
  await page.locator('tr[data-row-id]').nth(12).click();
  await page.mouse.move(2, 2);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(async () => (await drawingOrder(page)).map((t) => t[0])).toEqual(withOnTop(second));
  await expect.poll(async () => (await drawingOrder(page)).filter((t) => t[1] === 2.5).map((t) => t[0])).toEqual([second]);

  // A second click on the highlighted row, and Esc, put every trace back in series order.
  await page.locator('tr[data-row-id]').nth(12).click();
  await page.mouse.move(2, 2);
  await expect.poll(async () => JSON.stringify(await drawingOrder(page))).toBe(JSON.stringify(series));
  await page.locator('tr[data-row-id]').nth(7).click();
  await page.mouse.move(2, 2);
  await expect.poll(async () => (await drawingOrder(page)).map((t) => t[0])).toEqual(withOnTop(first));
  await page.locator('body').press('Escape');
  await expect.poll(async () => JSON.stringify(await drawingOrder(page))).toBe(JSON.stringify(series));
  await expect.poll(async () => JSON.stringify(await drawingOrder(page, 'plot-v'))).toBe(JSON.stringify(seriesV));
  expect((await paintedOrder(page)).map((uid) => seriesIdOf(uid))).toEqual(ids);
  // All of it in the charts that were there, updated in place.
  expect(await plotIds(page, ['plot-h', 'plot-v'])).toEqual(charts);
});

test('with a reference and a tilt simulation (originals drawn), the highlighted file goes under the reference with its dashed original right under it, in both plot types', async ({ page }) => {
  await loadExample(page);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect.poll(async () => (await cutState(page)).files.length).toBe(24);
  await page.locator('.panel li').nth(2).getByLabel(/^Actions for /).click();
  await page.getByRole('menuitem', { name: 'Use as reference' }).click();
  // A mechanical tilt makes every file but the reference tilted, so each has a dashed original (23 of them).
  const mech = page.getByRole('group', { name: 'Mechanical tilt (°)' }).locator('input[type="number"]');
  if (!(await mech.isVisible())) await page.getByRole('button', { name: /Simulation/ }).first().click();
  await mech.fill('6');
  await mech.press('Enter');
  await page.getByLabel('Show original').check();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.locator('body').press('Escape');
  await expect(page.locator('tr.hl[data-row-id]')).toHaveCount(0);
  await expect.poll(async () => (await cutState(page)).files.length).toBe(47);

  for (const mode of ['Polar', 'Rectangular']) {
    await page.getByRole('group', { name: 'Plot type' }).getByRole('button', { name: mode }).click();
    await expect.poll(async () => (await cutState(page)).files.length).toBe(47);
    await expect.poll(async () => (await cutState(page)).title).toMatch(/^Horizontal cut/);
    const series = (await drawingOrder(page)).map((t) => t[0]);
    const seriesV = (await drawingOrder(page, 'plot-v')).map((t) => t[0]);
    const refAt = (await drawingOrder(page)).findIndex((t) => t[2]);
    const legend = await page.getByTestId('plot-h').locator('.legend .legendtext').allTextContents();
    const live = series.filter((id): id is string => id !== null && !id.endsWith('#original'));
    const target = live.find((id, k) => k === 7 && !(refAt >= 0 && series[refAt] === id))!;
    const row = page.locator(`tr[data-row-id="${target.replace(/"/g, '\\"')}"]`);

    /** The series order with `target` and its original moved to just under the reference. */
    const expected = (() => {
      const rest = series.filter((id) => id !== target && id !== `${target}#original`);
      const at = rest.indexOf(series[refAt]);
      return [...rest.slice(0, at), `${target}#original`, target, ...rest.slice(at)];
    })();

    await row.click();
    await page.mouse.move(2, 2);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (const id of ['plot-h', 'plot-v']) {
      await expect.poll(async () => (await drawingOrder(page, id)).map((t) => t[0])).toEqual(expected);
    }
    const order = await drawingOrder(page);
    const at = order.findIndex((t) => t[0] === target);
    // The highlighted trace is thick, directly above its original and directly under the reference.
    expect(order[at][1]).toBe(2.5);
    expect(order[at - 1][0]).toBe(`${target}#original`);
    expect(order[at + 1][2]).toBe(true);
    expect((await paintedOrder(page)).map((uid) => seriesIdOf(uid))).toEqual(expected);
    // The legend keeps the order of the files.
    expect(await page.getByTestId('plot-h').locator('.legend .legendtext').allTextContents()).toEqual(legend);

    // Esc puts every trace back in series order.
    await page.locator('body').press('Escape');
    await expect.poll(async () => (await drawingOrder(page)).map((t) => t[0])).toEqual(series);
    await expect.poll(async () => (await drawingOrder(page, 'plot-v')).map((t) => t[0])).toEqual(seriesV);
    expect((await paintedOrder(page)).map((uid) => seriesIdOf(uid))).toEqual(series);
  }
});

test('3D: scenes that a redraw drops release their WebGL contexts, so the browser never takes one away', async ({ page }) => {
  test.slow();
  const warnings: string[] = [];
  page.on('console', (m) => {
    // Chromium: "Too many active WebGL contexts. Oldest context will be lost."; Firefox: "Exceeded 16 live WebGL contexts…".
    // (Firefox also notes every context that is released on purpose, "WebGL context was lost.": that one is expected.)
    if (/too many active WebGL contexts|live WebGL contexts/i.test(m.text())) warnings.push(m.text());
  });
  // Count the WebGL contexts made and the ones released.
  await page.addInitScript(() => {
    const counts = { made: 0, released: 0 };
    (window as unknown as { __gl: typeof counts }).__gl = counts;
    const getContext = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, ...args: unknown[]) => unknown;
    const seen = new WeakSet<HTMLCanvasElement>();
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
      const context = getContext.apply(this, args);
      if (context && /webgl/.test(String(args[0])) && !seen.has(this)) {
        seen.add(this);
        counts.made++;
        this.addEventListener('webglcontextlost', () => counts.released++);
      }
      return context;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  const live = () => page.evaluate(() => { const c = (window as unknown as { __gl: { made: number; released: number } }).__gl; return c.made - c.released; });
  const scenes = page.locator('[data-testid="plot-3d"] canvas');
  const layout = (name: string) => page.getByRole('group', { name: '3D layout' }).getByRole('button', { name }).click();

  await loadExample(page);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await page.getByRole('group', { name: 'Dimension' }).getByRole('button', { name: '3D' }).click();
  // Three rounds of overlay (1 scene) and side by side (6 scenes): 5 scenes dropped and 5 made each time.
  for (let round = 0; round < 3; round++) {
    await layout('Overlay');
    await expect(scenes).toHaveCount(1);
    await expect.poll(live).toBe(1);
    await layout('Side by side');
    await expect(scenes).toHaveCount(6);
    await expect.poll(live).toBe(6);
  }
  // A tilt change redraws the six scenes in place: no new context.
  const made = await page.evaluate(() => (window as unknown as { __gl: { made: number } }).__gl.made);
  const mech = page.getByRole('group', { name: 'Mechanical tilt (°)' }).locator('input[type="number"]');
  if (!(await mech.isVisible())) await page.getByRole('button', { name: /Simulation/ }).first().click();
  // Count the 3D chart's finished draws from here on: the tilted surfaces are on screen when one has ended.
  await page.evaluate(() => {
    const w = window as unknown as { __drawn3d: number };
    w.__drawn3d = 0;
    (document.querySelector('[data-testid="plot-3d"] .js-plotly-plot') as unknown as { on: (event: string, cb: () => void) => void }).on('plotly_afterplot', () => w.__drawn3d++);
  });
  await mech.fill('10');
  await mech.press('Enter');
  await expect(page.locator('.sim-bar').getByText('Simulated')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __drawn3d: number }).__drawn3d), { timeout: 20000 }).toBeGreaterThan(0);
  await expect(page.getByText('Updating the 3D view…')).toHaveCount(0);
  await expect(scenes).toHaveCount(6);
  expect(await page.evaluate(() => (window as unknown as { __gl: { made: number } }).__gl.made)).toBe(made);
  // Leaving 3D releases all of them.
  await page.getByRole('group', { name: 'Dimension' }).getByRole('button', { name: '2D' }).click();
  await expect.poll(live).toBe(0);
  expect(warnings).toEqual([]);
});
