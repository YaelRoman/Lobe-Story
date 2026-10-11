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
/** Remembers the arrays of every drawn file trace of both cut plots, to see later whether they were built again. */
const rememberArrays = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { __arrays: unknown[][] }).__arrays = ['plot-h', 'plot-v'].map((id) =>
      (document.querySelector(`[data-testid="${id}"] .js-plotly-plot`) as unknown as { data: { uid?: string; r?: unknown; y?: unknown }[] }).data.filter((t) => typeof t.uid === 'string').map((t) => t.r ?? t.y),
    );
  });
const sameArrays = (page: Page) =>
  page.evaluate(() =>
    ['plot-h', 'plot-v'].every((id, k) => {
      const now = (document.querySelector(`[data-testid="${id}"] .js-plotly-plot`) as unknown as { data: { uid?: string; r?: unknown; y?: unknown }[] }).data.filter((t) => typeof t.uid === 'string').map((t) => t.r ?? t.y);
      const before = (window as unknown as { __arrays: unknown[][] }).__arrays[k];
      return now.length === before.length && now.every((a, i) => a === before[i]);
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

test('3D: scenes that a redraw drops release their WebGL contexts, so the browser never takes one away', async ({ page }) => {
  test.slow();
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (/WebGL context/i.test(m.text())) warnings.push(m.text());
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
  await mech.fill('10');
  await mech.press('Enter');
  await expect(page.locator('.sim-bar').getByText('Simulated')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(scenes).toHaveCount(6);
  expect(await page.evaluate(() => (window as unknown as { __gl: { made: number } }).__gl.made)).toBe(made);
  // Leaving 3D releases all of them.
  await page.getByRole('group', { name: 'Dimension' }).getByRole('button', { name: '2D' }).click();
  await expect.poll(live).toBe(0);
  expect(warnings).toEqual([]);
});
