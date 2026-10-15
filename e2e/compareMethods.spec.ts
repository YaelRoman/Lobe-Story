import { expect, test, type Page } from '@playwright/test';
import { openSimulation } from './simulationBar';
import { loadMany, MECHANICAL, settled } from './manyFiles';

const DOWNLOAD = 'Download plot as a png (with legend and values)';
const COMPARE = 'Compare methods';
const WAITING_3D = 'The 3D view and the table follow when the slider stops.';

async function loadExample(page: Page, viewport = { width: 1440, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
}

const to3d = (page: Page) => page.getByRole('group', { name: 'Dimension' }).getByRole('button', { name: '3D' }).click();
const plot = (page: Page) => page.getByTestId('plot-3d');
const scenes = (page: Page) => page.locator('[data-testid="plot-3d"] canvas');
const panelTitles = (page: Page) => plot(page).locator('.annotation-text');

/** What the 3D chart draws: per trace its scene, name and a fingerprint of its surface. */
const drawnSurfaces = (page: Page) =>
  page.evaluate(() => {
    const gd = document.querySelector('[data-testid="plot-3d"] .js-plotly-plot') as unknown as { data: { scene: string; name: string; surfacecolor: number[][]; z: number[][] }[] };
    return gd.data.map((t) => ({ scene: t.scene, name: t.name, color: t.surfacecolor.flat().reduce((a, b) => a + b, 0).toFixed(6), z: t.z.flat().reduce((a, b) => a + b, 0).toFixed(6) }));
  });
/** The camera eye each scene of the 3D chart shows (the scene's own camera: the library's layout can lag behind it). */
const allEyes = (page: Page) =>
  page.evaluate(() => {
    const gd = document.querySelector('[data-testid="plot-3d"] .js-plotly-plot') as unknown as { _fullLayout: Record<string, { _scene?: { getCamera(): { eye: { x: number; y: number; z: number } } } }> };
    return Object.keys(gd._fullLayout)
      .filter((id) => /^scene\d*$/.test(id))
      .sort((a, b) => Number(a.slice(5) || 1) - Number(b.slice(5) || 1))
      .map((id) => {
        const e = gd._fullLayout[id]?._scene?.getCamera().eye;
        return e ? [e.x, e.y, e.z].map((v) => Number(v.toFixed(3))) : null;
      });
  });
const eyes = async (page: Page) => {
  const all = await allEyes(page);
  return [all[0] ?? null, all[1] ?? null];
};
/** The view the scenes are built with (surfaceFigure `BUILT_CAMERA`). */
const BUILT_EYE = [1.5, -1.5, 0.9];
/** All scenes show one view, other than `not`. */
const inStepAway = (page: Page, not: number[] | null) =>
  expect
    .poll(async () => {
      const all = await allEyes(page);
      return all.length > 0 && all.every((e) => e !== null && JSON.stringify(e) === JSON.stringify(all[0])) && JSON.stringify(all[0]) !== JSON.stringify(not);
    })
    .toBe(true);
/** A sideways drag on scene `k` of the 3D chart (a turn about the vertical axis). */
async function turnScene(page: Page, k: number, dx: number) {
  const box = (await page.locator('[data-testid="plot-3d"] canvas').nth(k).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y);
  await page.mouse.up();
}
const switchTheme = async (page: Page) => {
  const before = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="plot-3d"] .main-svg')!).backgroundColor);
  await page.getByRole('button', { name: 'Dark mode' }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="plot-3d"] .main-svg')!).backgroundColor)).not.toBe(before);
};
const RESET_CAMERA = 'Reset camera to default';

/** Counts the WebGL contexts the page makes and the ones released (see plotEngine.spec). */
async function countContexts(page: Page) {
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
  return () => page.evaluate(() => { const c = (window as unknown as { __gl: { made: number; released: number } }).__gl; return c.made - c.released; });
}

test('"Compare methods" shows Summation and Weighted side by side, labelled, and is reached and switched by keyboard', async ({ page }) => {
  await loadExample(page);
  await to3d(page);
  await expect(scenes(page)).toHaveCount(1);
  const toggle = page.getByRole('checkbox', { name: COMPARE });
  await expect(toggle).not.toBeChecked();

  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toBeChecked();
  await expect(scenes(page)).toHaveCount(2);
  await expect(panelTitles(page)).toHaveText(['Summation · used for the numbers', 'Weighted']);
  await expect(plot(page)).toHaveAttribute('aria-label', '3D radiation pattern, the two methods compared: Summation on the left (used for the numbers), Weighted on the right');
  await expect.poll(async () => (await drawnSurfaces(page)).map((t) => [t.scene, t.name])).toEqual([
    ['scene', 'Summation'],
    ['scene2', 'Weighted'],
  ]);
  await expect(page.getByTestId('compare-numbers-method')).toContainText('Numbers use: Summation');
  await expect(page.getByTestId('compare-difference')).toContainText(/The methods differ by up to \d+\.\d dB, \d+\.\d dB on average over the sphere/);
  // The layout of several files has nothing to lay out while one file is compared.
  await expect(page.getByRole('group', { name: '3D layout' }).getByRole('button', { name: 'Overlay' })).toBeDisabled();
  // Side by side: the first panel left of the second, on one row.
  const boxes = await scenes(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y })));
  expect(boxes[0].x).toBeLessThan(boxes[1].x);

  await page.keyboard.press('Space');
  await expect(toggle).not.toBeChecked();
  await expect(scenes(page)).toHaveCount(1);
  await expect(page.getByTestId('compare-numbers-method')).toHaveCount(0);
  await expect(page.getByRole('group', { name: '3D layout' }).getByRole('button', { name: 'Overlay' })).toBeEnabled();
});

test('comparing leaves the 3D method of the numbers alone; choosing another method moves the label, not the surfaces', async ({ page }) => {
  await loadExample(page);
  // The angular-region columns use the 3D method: the table shows what the numbers are made with.
  await page.getByLabel('Show Angular regions (est.) columns').check();
  const table = () => page.locator('.metrics tbody').innerText();
  await expect(page.locator('.metrics thead')).toContainText('[Sum.]');
  const before = await table();
  await to3d(page);
  await page.getByRole('checkbox', { name: COMPARE }).check();
  await expect(scenes(page)).toHaveCount(2);
  await openSimulation(page);
  const methodSeg = page.getByRole('group', { name: '3D method' });
  await expect(methodSeg.getByRole('button', { name: 'Summation' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.metrics thead')).toContainText('[Sum.]');
  expect(await table()).toBe(before);
  await expect.poll(async () => (await drawnSurfaces(page)).length).toBe(2);
  const surfaces = await drawnSurfaces(page);

  await methodSeg.getByRole('button', { name: 'Weighted' }).click();
  await expect(page.getByTestId('compare-numbers-method')).toContainText('Numbers use: Weighted');
  await expect(panelTitles(page)).toHaveText(['Summation', 'Weighted · used for the numbers']);
  await expect(page.locator('.metrics thead')).toContainText('[Wtd.]');
  expect(await drawnSurfaces(page)).toEqual(surfaces);

  // Back to one surface: the method chosen, Weighted.
  await page.getByRole('checkbox', { name: COMPARE }).uncheck();
  await expect(scenes(page)).toHaveCount(1);
  await expect.poll(async () => (await drawnSurfaces(page)).map((t) => t.color)).toEqual([surfaces[1].color]);
});

test('turning one panel turns the other the same way, also after a redraw', async ({ page }) => {
  await loadExample(page);
  await to3d(page);
  await page.getByRole('checkbox', { name: COMPARE }).check();
  await expect(scenes(page)).toHaveCount(2);
  await expect.poll(async () => (await eyes(page)).every((e) => e !== null)).toBe(true);
  const start = await eyes(page);
  expect(start[0]).toEqual(start[1]);

  const inStep = async (from: (number[] | null)[]) => {
    await expect
      .poll(async () => {
        const [a, b] = await eyes(page);
        return a !== null && JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(from[0]);
      })
      .toBe(true);
    return eyes(page);
  };
  /** A sideways drag on panel `k` (a turn about the vertical axis). */
  const turn = async (k: number, dx: number) => {
    const box = (await scenes(page).nth(k).boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y);
    await page.mouse.up();
  };
  await turn(0, 120);
  let now = await inStep(start);
  await turn(1, -60);
  now = await inStep(now);
  // A redraw (another theme) keeps the turned view in both panels, and they stay linked after it.
  await page.getByRole('button', { name: 'Dark mode' }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="plot-3d"] .main-svg')!).backgroundColor)).not.toBe('rgb(255, 255, 255)');
  await expect.poll(() => eyes(page)).toEqual(now);
  await turn(0, 60);
  await inStep(now);
});

test('the exported image of the comparison holds both panels, labelled, and names the method of the numbers', async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { exportedSvgs: string[] }).exportedSvgs = seen;
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (obj instanceof Blob && obj.type.includes('svg')) void obj.text().then((t) => seen.push(t));
      return create(obj);
    };
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...src,
      set(value: string) {
        if (typeof value === 'string' && value.startsWith('data:image/svg+xml')) seen.push(decodeURIComponent(value.slice(value.indexOf(',') + 1)));
        src.set!.call(this, value);
      },
    });
  });
  await loadExample(page);
  await to3d(page);
  await page.getByRole('checkbox', { name: COMPARE }).check();
  await expect(scenes(page)).toHaveCount(2);
  await expect(page.getByTestId('compare-difference')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), plot(page).getByRole('button', { name: DOWNLOAD }).click()]);
  expect(download.suggestedFilename()).toBe('antenna-pattern-3d-methods.png');
  await expect.poll(() => page.evaluate(() => (window as unknown as { exportedSvgs: string[] }).exportedSvgs.some((s) => s.includes('Lobe-Story')))).toBe(true);
  const svg = await page.evaluate(() => (window as unknown as { exportedSvgs: string[] }).exportedSvgs.filter((s) => s.includes('Lobe-Story')).pop()!);
  // One picture per 3D scene, and each panel's title.
  expect(svg.match(/<image/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  expect(svg).toContain('Summation');
  expect(svg).toContain('Weighted');
  expect(svg).toContain('The numbers use Summation');
  expect(svg).toContain('the two methods compared');
});

test('toggling the comparison twenty times leaves no WebGL context behind and logs no error', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || /too many active WebGL contexts|live WebGL contexts/i.test(m.text())) errors.push(m.text());
  });
  const live = await countContexts(page);
  await loadExample(page);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await to3d(page);
  await expect(scenes(page)).toHaveCount(6);
  const toggle = page.getByRole('checkbox', { name: COMPARE });
  for (let n = 0; n < 20; n++) {
    await toggle.click();
    await expect(scenes(page)).toHaveCount(n % 2 === 0 ? 2 : 6);
  }
  await expect.poll(live).toBe(6);
  // Into the comparison once more, then the overlay and back: each drops the scenes it no longer draws.
  await toggle.check();
  await expect.poll(live).toBe(2);
  await toggle.uncheck();
  await page.getByRole('group', { name: '3D layout' }).getByRole('button', { name: 'Overlay' }).click();
  await expect(scenes(page)).toHaveCount(1);
  await expect.poll(live).toBe(1);
  await toggle.check();
  await expect.poll(live).toBe(2);
  await expect(plot(page).locator('.plot-error')).toHaveCount(0);
  // Leaving 3D releases them all.
  await page.getByRole('group', { name: 'Dimension' }).getByRole('button', { name: '2D' }).click();
  await expect.poll(live).toBe(0);
  expect(errors).toEqual([]);
});

test('with many files ticked, a held slider released while comparing leaves both panels at the released value', async ({ page }) => {
  test.slow();
  await loadMany(page, 48);
  await to3d(page);
  await page.getByRole('checkbox', { name: COMPARE }).check();
  await expect(scenes(page)).toHaveCount(2);
  const slider = page.getByRole('slider', { name: MECHANICAL, exact: true });
  const box = (await slider.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + i * 6, y);
  const value = await slider.inputValue();
  expect(Number(value)).toBeGreaterThan(0);
  await page.mouse.up();
  await settled(page);
  const caughtUp = async () => {
    await expect(page.getByText(WAITING_3D)).toHaveCount(0);
    await expect(page.getByText('Updating the 3D view…')).toHaveCount(0);
  };
  await caughtUp();

  // The same value typed from zero: the panels drawn after the release are the ones of that value.
  const typed = page.getByLabel(`${MECHANICAL} value`, { exact: true });
  await typed.fill('0');
  await typed.press('Enter');
  await settled(page);
  await caughtUp();
  await expect.poll(async () => (await drawnSurfaces(page)).length).toBe(2);
  const atZero = await drawnSurfaces(page);
  await typed.fill(value);
  await typed.press('Enter');
  await settled(page);
  await caughtUp();
  await expect.poll(async () => JSON.stringify(await drawnSurfaces(page)) !== JSON.stringify(atZero)).toBe(true);
  const atValue = await drawnSurfaces(page);

  // Drag again from zero and release at the value: no stale surface.
  await typed.fill('0');
  await typed.press('Enter');
  await settled(page);
  await expect.poll(() => drawnSurfaces(page)).toEqual(atZero);
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + i * 6, y);
  await expect(slider).toHaveValue(value);
  await page.mouse.up();
  await settled(page);
  await caughtUp();
  await expect.poll(() => drawnSurfaces(page), { timeout: 20000 }).toEqual(atValue);
});

test('on a phone the two panels are stacked, the toggle is on screen and the page does not scroll sideways', async ({ page }) => {
  await loadExample(page, { width: 390, height: 844 });
  await to3d(page);
  const toggle = page.getByRole('checkbox', { name: COMPARE });
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeVisible();
  await toggle.check();
  await expect(scenes(page)).toHaveCount(2);
  await expect(plot(page)).toHaveAttribute('aria-label', /Summation on top \(used for the numbers\), Weighted below/);
  const boxes = await scenes(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })));
  expect(boxes[0].y + boxes[0].h).toBeLessThanOrEqual(boxes[1].y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.getByTestId('compare-difference').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('the comparison is remembered in the browser, like the 3D layout', async ({ page }) => {
  await loadExample(page);
  await to3d(page);
  await page.getByRole('checkbox', { name: COMPARE }).check();
  await expect(scenes(page)).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('lobe-story:prefs:v1') ?? '{}').view?.compare3d)).toBe(true);
  await page.reload();
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await to3d(page);
  await expect(page.getByRole('checkbox', { name: COMPARE })).toBeChecked();
  await expect(scenes(page)).toHaveCount(2);
});

for (const view of ['compare', 'grid', 'overlay'] as const) {
  test(`${view}: "Reset camera to default" returns every scene to the built view, and a redraw keeps it`, async ({ page }) => {
    await loadExample(page);
    const scenesWanted = view === 'compare' ? 2 : view === 'grid' ? 6 : 1;
    if (view !== 'compare') await page.getByRole('button', { name: 'Show all', exact: true }).click();
    await to3d(page);
    if (view === 'compare') await page.getByRole('checkbox', { name: COMPARE }).check();
    if (view === 'overlay') await page.getByRole('group', { name: '3D layout' }).getByRole('button', { name: 'Overlay' }).click();
    await expect(scenes(page)).toHaveCount(scenesWanted);
    await expect.poll(async () => (await allEyes(page)).every((e) => JSON.stringify(e) === JSON.stringify(BUILT_EYE))).toBe(true);
    // A redraw first (the scenes then outlive the layout they were made with), then a turn.
    await switchTheme(page);
    await turnScene(page, 0, 120);
    await inStepAway(page, BUILT_EYE);
    await plot(page).getByRole('button', { name: RESET_CAMERA }).click();
    await expect.poll(async () => (await allEyes(page)).every((e) => JSON.stringify(e) === JSON.stringify(BUILT_EYE))).toBe(true);
    await switchTheme(page);
    await expect.poll(async () => (await allEyes(page)).every((e) => JSON.stringify(e) === JSON.stringify(BUILT_EYE))).toBe(true);
    expect((await allEyes(page)).length).toBe(scenesWanted);
  });
}

test('the exported image of the comparison shows the view on screen: the turned one, and after a reset the built one', async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { exportedSvgs: string[] }).exportedSvgs = seen;
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (obj instanceof Blob && obj.type.includes('svg')) void obj.text().then((t) => seen.push(t));
      return create(obj);
    };
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...src,
      set(value: string) {
        if (typeof value === 'string' && value.startsWith('data:image/svg+xml')) seen.push(decodeURIComponent(value.slice(value.indexOf(',') + 1)));
        src.set!.call(this, value);
      },
    });
  });
  /** The scene pictures of the next exported image. */
  const exported = async () => {
    await page.evaluate(() => ((window as unknown as { exportedSvgs: string[] }).exportedSvgs.length = 0));
    await Promise.all([page.waitForEvent('download'), plot(page).getByRole('button', { name: DOWNLOAD }).click()]);
    await expect.poll(() => page.evaluate(() => (window as unknown as { exportedSvgs: string[] }).exportedSvgs.some((s) => s.includes('Lobe-Story')))).toBe(true);
    const svg = await page.evaluate(() => (window as unknown as { exportedSvgs: string[] }).exportedSvgs.filter((s) => s.includes('Lobe-Story')).pop()!);
    return svg.match(/<image[^>]*>/g) ?? [];
  };
  await loadExample(page);
  await to3d(page);
  await page.getByRole('checkbox', { name: COMPARE }).check();
  await expect(scenes(page)).toHaveCount(2);
  const built = await exported();
  expect(built.length).toBeGreaterThanOrEqual(2);
  await turnScene(page, 0, 120);
  await inStepAway(page, BUILT_EYE);
  const turned = await exported();
  expect(turned).not.toEqual(built);
  await plot(page).getByRole('button', { name: RESET_CAMERA }).click();
  await expect.poll(async () => (await allEyes(page)).every((e) => JSON.stringify(e) === JSON.stringify(BUILT_EYE))).toBe(true);
  expect(await exported()).toEqual(built);
});

test('side by side with six files: turning any panel turns all, and they stay in step through a redraw and a resize', async ({ page }) => {
  await loadExample(page);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await to3d(page);
  await expect(scenes(page)).toHaveCount(6);
  await switchTheme(page);
  await turnScene(page, 0, 120);
  await inStepAway(page, BUILT_EYE);
  let now = (await allEyes(page))[0];
  await switchTheme(page);
  await expect.poll(async () => (await allEyes(page)).every((e) => JSON.stringify(e) === JSON.stringify(now))).toBe(true);
  await turnScene(page, 3, -60);
  await inStepAway(page, now);
  now = (await allEyes(page))[0];
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect.poll(async () => (await allEyes(page)).every((e) => JSON.stringify(e) === JSON.stringify(now))).toBe(true);
  expect((await allEyes(page)).length).toBe(6);
});

for (const view of ['compare', 'grid'] as const) {
  test(`${view}: crossing the phone width both ways redraws the panels at the new size`, async ({ page }) => {
    await loadExample(page);
    if (view === 'grid') await page.getByRole('button', { name: 'Show all', exact: true }).click();
    await to3d(page);
    if (view === 'compare') await page.getByRole('checkbox', { name: COMPARE }).check();
    const n = view === 'compare' ? 2 : 6;
    await expect(scenes(page)).toHaveCount(n);
    /** Each canvas's width as a share of the chart's. */
    const shares = () => scenes(page).evaluateAll((els) => {
      const chart = document.querySelector('[data-testid="plot-3d"]')!.getBoundingClientRect().width;
      return els.map((e) => Math.round((e.getBoundingClientRect().width / chart) * 100) / 100);
    });
    const desk = await shares();
    const columns = view === 'compare' ? 2 : 3;
    // A share of the width each, less the colour bar and margins (broken, they kept a phone’s size: about a third of this).
    for (const s of desk) expect(s).toBeGreaterThan(0.8 / columns);
    await page.setViewportSize({ width: 390, height: 844 });
    // A phone: the comparison stacks (whole width), the grid takes one column below 420 px.
    await expect.poll(async () => (await shares()).every((s) => s > 0.9)).toBe(true);
    await expect(scenes(page)).toHaveCount(n);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(async () => (await shares()).every((s) => s > 0.8 / columns && s < 1 / columns + 0.01)).toBe(true);
    await expect(scenes(page)).toHaveCount(n);
  });
}
