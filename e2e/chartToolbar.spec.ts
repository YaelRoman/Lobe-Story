import { expect, test, type Page } from '@playwright/test';
import { planetText } from '../src/test/planetText';
import { openSimulation } from './simulationBar';

const DOWNLOAD = 'Download plot as a png (with legend and values)';
/** Nothing in a chart toolbar may offer to share or upload the chart, or link to the charting library's site. */
const FORBIDDEN = /share|cloud|chart studio|plotly/i;

async function loadExample(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
}

/** The button titles of the toolbar of chart `testId`, in order. */
const buttons = (page: Page, testId: string) =>
  page.getByTestId(testId).locator('.modebar-btn').evaluateAll((els) => els.map((el) => el.getAttribute('data-title') ?? el.getAttribute('aria-label') ?? ''));

/** Every title, label, link target and text of every element inside any chart toolbar on the page. */
const toolbarWords = (page: Page) =>
  page.locator('.modebar-container, .modebar').evaluateAll((bars) =>
    bars.flatMap((bar) =>
      [bar, ...Array.from(bar.querySelectorAll('*'))].flatMap((el) =>
        [el.getAttribute('title'), el.getAttribute('data-title'), el.getAttribute('aria-label'), el.getAttribute('href'), el.getAttribute('data-attr'), el.getAttribute('data-val'), el.tagName === 'TITLE' ? el.textContent : null].filter(
          (v): v is string => v !== null && v !== '',
        ),
      ),
    ),
  );

async function expectNothingForbidden(page: Page, charts: number) {
  await expect(page.locator('.modebar')).toHaveCount(charts);
  const words = await toolbarWords(page);
  expect(words.length).toBeGreaterThanOrEqual(charts);
  expect(words.filter((w) => FORBIDDEN.test(w))).toEqual([]);
  // The logo link of the charting library is not drawn either.
  await expect(page.locator('.modebar a, .plotlyjsicon')).toHaveCount(0);
}

test('no chart toolbar offers to share or upload a chart, and each has only the buttons that do something', async ({ page, baseURL }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!/^(data:|blob:)/.test(r.url()) && new URL(r.url()).origin !== new URL(baseURL!).origin) external.push(r.url());
  });
  await loadExample(page);

  // 2D, polar: the two cuts and the frequency chart.
  await expect(page.getByTestId('plot-h').locator('.polarlayer')).toHaveCount(1);
  await expect.poll(() => buttons(page, 'plot-h')).toEqual(['Reset view', DOWNLOAD]);
  await expect.poll(() => buttons(page, 'plot-v')).toEqual(['Reset view', DOWNLOAD]);
  await expect.poll(() => buttons(page, 'plot-hpbw')).toEqual(['Zoom', 'Reset axes', DOWNLOAD]);
  await expectNothingForbidden(page, 3);

  // 2D, rectangular: a drag zooms, so the cuts get a reset.
  await page.getByRole('button', { name: 'Rectangular', exact: true }).click();
  await expect.poll(() => buttons(page, 'plot-h')).toEqual(['Reset axes', DOWNLOAD]);
  await expect.poll(() => buttons(page, 'plot-v')).toEqual(['Reset axes', DOWNLOAD]);
  await expectNothingForbidden(page, 3);

  // The band histogram.
  const cell = page.getByTestId('band-stats').getByRole('row', { name: /^Azimuth beamwidth/ }).getByRole('button').first();
  await cell.click();
  await expect(page.getByTestId('plot-band').locator('.main-svg').first()).toBeVisible();
  await expect.poll(() => buttons(page, 'plot-band')).toEqual(['Zoom', 'Reset axes', DOWNLOAD]);
  await expectNothingForbidden(page, 4);

  // 3D.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect.poll(() => buttons(page, 'plot-3d')).toEqual(['Turntable rotation', 'Zoom', 'Reset camera to default', DOWNLOAD]);
  await expect.poll(() => buttons(page, 'plot-hpbw')).toEqual(['Zoom', 'Reset axes', DOWNLOAD]);
  await expectNothingForbidden(page, 3);

  // And the page asked no other host for anything on the way.
  expect(external).toEqual([]);
});

test('the chart toolbars are seven tab stops between the marker checkboxes and "Export CSV", not seventeen', async ({ page }) => {
  await loadExample(page);
  await expect(page.getByTestId('plot-h').locator('.modebar-btn')).toHaveCount(2);
  await expect(page.getByTestId('plot-hpbw').locator('.modebar-btn')).toHaveCount(3);

  await page.locator('#marker-options input[type="checkbox"]').last().focus();
  const target = page.getByRole('button', { name: 'Export CSV' });
  const stops: string[] = [];
  for (let n = 0; n < 60; n++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) break;
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        return el?.closest('.modebar') ? `toolbar: ${el.getAttribute('data-title')}` : (el?.tagName ?? 'none');
      }),
    );
  }
  await expect(target).toBeFocused();
  // A reset and a download per cut plot; zoom, reset and download on the frequency chart.
  expect(stops.filter((s) => s.startsWith('toolbar: '))).toEqual([
    'toolbar: Reset view',
    `toolbar: ${DOWNLOAD}`,
    'toolbar: Reset view',
    `toolbar: ${DOWNLOAD}`,
    'toolbar: Zoom',
    'toolbar: Reset axes',
    `toolbar: ${DOWNLOAD}`,
  ]);
});

test('exported images are white whatever the screen theme, named by cut, and say when they are simulated', async ({ page }) => {
  await loadExample(page);
  await page.getByRole('button', { name: 'Dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const screenBackground = () => page.getByTestId('plot-h').locator('.main-svg').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const before = await screenBackground();

  const download = async (testId: string) => {
    const pending = page.waitForEvent('download');
    await page.getByTestId(testId).getByRole('button', { name: DOWNLOAD }).click();
    const d = await pending;
    return { name: d.suggestedFilename(), path: (await d.path())! };
  };
  const pixel = async (path: string, x: number, y: number) => {
    const base64 = (await import('node:fs')).readFileSync(path).toString('base64');
    return page.evaluate(
      async ([data, px, py]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(px as number, py as number, 1, 1).data);
      },
      [base64, x, y] as const,
    );
  };

  const h = await download('plot-h');
  expect(h.name).toBe('horizontal-cut.png');
  expect(await pixel(h.path, 4, 4)).toEqual([255, 255, 255, 255]);
  // The screen figure is untouched by the export: still the dark background.
  expect(await screenBackground()).toBe(before);
  expect(before).not.toBe('rgb(255, 255, 255)');

  await page.getByRole('button', { name: 'Vertical', exact: true }).click();
  const v = await download('plot-v');
  expect(v.name).toBe('vertical-cut.png');

  // While a simulation is active the names say so.
  await openSimulation(page);
  await page.getByLabel('Electrical tilt Δ (°) value').fill('3');
  await page.getByLabel('Electrical tilt Δ (°) value').press('Enter');
  const simulated = await download('plot-v');
  expect(simulated.name).toBe('vertical-cut-simulated.png');
  const freq = await download('plot-hpbw');
  expect(freq.name).toBe('beamwidth-vs-frequency-simulated.png');
});

test('an offset on a file that is not drawn does not make the exports simulated', async ({ page }) => {
  await loadExample(page);
  const download = async (testId: string) => {
    const pending = page.waitForEvent('download');
    await page.getByTestId(testId).getByRole('button', { name: DOWNLOAD }).click();
    return (await pending).suggestedFilename();
  };
  // The first file is highlighted on load: put a tilt offset on it, then draw only the second file.
  await page.getByRole('button', { name: 'Show none', exact: true }).click();
  await openSimulation(page);
  const offset = page.getByLabel('Mechanical tilt offset (°) value');
  await offset.fill('3');
  await offset.press('Enter');
  await expect(page.getByLabel('Offsets: mech +3°')).toBeVisible();
  await page.locator('.panel li input[type="checkbox"]').nth(1).check();
  expect(await download('plot-h')).toBe('horizontal-cut.png');
  // The frequency chart plots every file of a group with a ticked file, so it does show the offset file.
  expect(await download('plot-hpbw')).toBe('beamwidth-vs-frequency-simulated.png');
  // The CSV counts the rows it lists: all files (simulated), or only the ticked ones (not).
  const csvName = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    return (await pending).suggestedFilename();
  };
  expect(await csvName()).toBe('pattern-metrics-simulated.csv');
  await page.getByLabel('Ticked files only').check();
  expect(await csvName()).toBe('pattern-metrics.csv');
  // Drawing the file with the offset makes the picture simulated.
  await page.locator('.panel li input[type="checkbox"]').nth(0).check();
  expect(await download('plot-h')).toBe('horizontal-cut-simulated.png');
});

test('a reset that throws at once shows the plot\'s error box, like a draw that throws', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loadExample(page);
  await page.getByTestId('plot-h').locator('.js-plotly-plot').evaluate((el) => {
    // The library reads this first when it relayouts the chart.
    Object.defineProperty(el, '_promises', {
      configurable: true,
      get() {
        throw new Error('injected: relayout failed');
      },
    });
  });
  await page.getByTestId('plot-h').hover();
  await page.getByTestId('plot-h').getByRole('button', { name: 'Reset view' }).click();
  const failed = page.getByRole('alert').filter({ hasText: 'This plot could not be drawn' });
  await expect(failed).toHaveCount(1);
  await expect(failed).toContainText('injected: relayout failed');
  // Nothing escaped to the page, and the rest of it is alive.
  expect(errors).toEqual([]);
  await expect(page.getByRole('button', { name: 'Save project' })).toBeVisible();
  await expect(page.getByTestId('plot-v').locator('.polarlayer')).toHaveCount(1);
});

test('"Reset view" puts a polar cut back after a drag has zoomed it', async ({ page }) => {
  await loadExample(page);
  const plot = page.getByTestId('plot-h');
  await expect(plot.locator('.polarlayer')).toHaveCount(1);
  /** The level range and the rotation the plot shows now. */
  const view = () =>
    plot.locator('.js-plotly-plot').evaluate((el) => {
      const polar = (el as unknown as { _fullLayout: { polar: { radialaxis: { range: number[]; angle: number }; angularaxis: { rotation: number } } } })._fullLayout.polar;
      return { range: polar.radialaxis.range.map((v) => Math.round(v * 100) / 100), angle: polar.radialaxis.angle, rotation: polar.angularaxis.rotation };
    });
  const built = await view();
  expect(built).toMatchObject({ range: [-40, 0], rotation: 90 });

  // A drag across the plot, from near the centre outwards, zooms the level axis.
  const box = (await plot.locator('.polarlayer .plotbg, .polarlayer .bg').first().boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + box.width * 0.1, cy - box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(cx + box.width * 0.2, cy - box.height * 0.2, { steps: 6 });
  await page.mouse.move(cx + box.width * 0.3, cy - box.height * 0.3, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => JSON.stringify((await view()).range)).not.toBe(JSON.stringify(built.range));

  await plot.getByRole('button', { name: 'Reset view' }).click();
  await expect.poll(view).toEqual(built);
  // The traces are still there.
  expect(await plot.locator('.js-plotly-plot').evaluate((el) => (el as unknown as { data: unknown[] }).data.length)).toBeGreaterThan(0);
});

/** The ranges the chart shows now, per axis, rounded to two decimals. */
const axisRanges = (page: Page, testId: string, axes: string[]) =>
  page
    .getByTestId(testId)
    .locator('.js-plotly-plot')
    .evaluate(
      (el, names) => {
        const full = (el as unknown as { _fullLayout: Record<string, { range: number[] } | undefined> })._fullLayout;
        return names.map((name) => full[name]?.range.map((v) => Math.round(v * 100) / 100) ?? null);
      },
      axes,
    );
/** The level range of a polar cut. */
const polarRange = (page: Page, testId: string) =>
  page
    .getByTestId(testId)
    .locator('.js-plotly-plot')
    .evaluate((el) => (el as unknown as { _fullLayout: { polar: { radialaxis: { range: number[] } } } })._fullLayout.polar.radialaxis.range.map((v) => Math.round(v * 100) / 100));

/** Drags a zoom box over the middle of an x/y chart. */
async function dragZoom(page: Page, testId: string) {
  const area = page.getByTestId(testId).locator('.draglayer .nsewdrag').first();
  await area.scrollIntoViewIfNeeded();
  const box = (await area.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
}
/** Double-clicks the middle of a chart's plot area. */
async function doubleClickPlot(page: Page, testId: string, area: string) {
  const target = page.getByTestId(testId).locator(area).first();
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
}
async function setPlotFloor(page: Page, floor: number) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const field = page.getByRole('dialog', { name: 'Analysis settings' }).getByLabel('Plot floor (dB)');
  await field.fill(String(floor));
  await field.press('Enter');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Analysis settings' })).toHaveCount(0);
}

test('"Reset axes" and a double click return a rectangular cut to the view of the figure it shows now, not of an earlier one', async ({ page }) => {
  await loadExample(page);
  await page.getByRole('button', { name: 'Rectangular', exact: true }).click();
  await expect(page.getByTestId('plot-h').locator('.xtitle')).toHaveCount(1);
  const view = () => axisRanges(page, 'plot-h', ['xaxis', 'yaxis']);
  await expect.poll(view).toEqual([[-180, 180], [-40, 0]]);

  // Another floor: the plot is updated in place.
  await setPlotFloor(page, 30);
  await expect.poll(view).toEqual([[-180, 180], [-30, 0]]);

  await dragZoom(page, 'plot-h');
  await expect.poll(async () => JSON.stringify(await view())).not.toBe(JSON.stringify([[-180, 180], [-30, 0]]));
  await page.getByTestId('plot-h').getByRole('button', { name: 'Reset axes' }).click();
  await expect.poll(view).toEqual([[-180, 180], [-30, 0]]);

  await dragZoom(page, 'plot-h');
  await expect.poll(async () => JSON.stringify(await view())).not.toBe(JSON.stringify([[-180, 180], [-30, 0]]));
  await doubleClickPlot(page, 'plot-h', '.draglayer .nsewdrag');
  await expect.poll(view).toEqual([[-180, 180], [-30, 0]]);
  // And once more from the built view: a double click there changes nothing (it is not a toggle to another scale).
  await doubleClickPlot(page, 'plot-h', '.draglayer .nsewdrag');
  await page.getByTestId('plot-h').getByRole('button', { name: 'Reset axes' }).click();
  await expect.poll(view).toEqual([[-180, 180], [-30, 0]]);
});

test('the frequency chart resets to the scale of the metric it shows now', async ({ page }) => {
  // Two frequencies of one pattern: every metric is flat, so each figure comes with a y range of its own.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const text = (freq: number) => planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });
  await page.getByTestId('file-input').setInputFiles([1910, 1930].map((freq) => ({ name: `f${freq}.msi`, mimeType: 'text/plain', buffer: Buffer.from(text(freq)) })));
  await expect(page.locator('.panel li')).toHaveCount(2);
  const chart = page.getByTestId('plot-hpbw');
  await expect(chart.locator('.y2title')).toHaveCount(1);
  const view = () => axisRanges(page, 'plot-hpbw', ['xaxis', 'yaxis']);
  const beamwidths = await view();

  await page.getByLabel('Metric', { exact: true }).selectOption({ label: 'F/B 180° (dB)' });
  await expect(chart.locator('.ytitle')).toContainText('F/B 180° (dB)');
  await expect.poll(async () => JSON.stringify((await view())[1])).not.toBe(JSON.stringify(beamwidths[1]));
  const built = await view();

  await dragZoom(page, 'plot-hpbw');
  await expect.poll(async () => JSON.stringify(await view())).not.toBe(JSON.stringify(built));
  await chart.getByRole('button', { name: 'Reset axes' }).click();
  await expect.poll(view).toEqual(built);

  await dragZoom(page, 'plot-hpbw');
  await expect.poll(async () => JSON.stringify(await view())).not.toBe(JSON.stringify(built));
  await doubleClickPlot(page, 'plot-hpbw', '.draglayer .nsewdrag');
  await expect.poll(view).toEqual(built);
});

test('a double click returns a polar cut to the floor it shows now', async ({ page }) => {
  await loadExample(page);
  const plot = page.getByTestId('plot-h');
  await expect(plot.locator('.polarlayer')).toHaveCount(1);
  await expect.poll(() => polarRange(page, 'plot-h')).toEqual([-40, 0]);
  await setPlotFloor(page, 30);
  await expect.poll(() => polarRange(page, 'plot-h')).toEqual([-30, 0]);

  // A drag from near the centre outwards zooms the level axis.
  const box = (await plot.locator('.polarlayer .plotbg, .polarlayer .bg').first().boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx + box.width * 0.1, cy - box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(cx + box.width * 0.2, cy - box.height * 0.2, { steps: 6 });
  await page.mouse.move(cx + box.width * 0.3, cy - box.height * 0.3, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => JSON.stringify(await polarRange(page, 'plot-h'))).not.toBe(JSON.stringify([-30, 0]));

  await page.mouse.dblclick(cx + box.width * 0.2, cy - box.height * 0.2);
  await expect.poll(() => polarRange(page, 'plot-h')).toEqual([-30, 0]);
  await plot.getByRole('button', { name: 'Reset view' }).click();
  await expect.poll(() => polarRange(page, 'plot-h')).toEqual([-30, 0]);
});
