import { expect, test, type Page } from '@playwright/test';

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
  await expect.poll(() => buttons(page, 'plot-h')).toEqual([DOWNLOAD]);
  await expect.poll(() => buttons(page, 'plot-v')).toEqual([DOWNLOAD]);
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

test('the chart toolbars are five tab stops between the marker checkboxes and "Export CSV", not seventeen', async ({ page }) => {
  await loadExample(page);
  await expect(page.getByTestId('plot-h').locator('.modebar-btn')).toHaveCount(1);
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
  // One download per cut plot; zoom, reset and download on the frequency chart.
  expect(stops.filter((s) => s.startsWith('toolbar: '))).toEqual([`toolbar: ${DOWNLOAD}`, `toolbar: ${DOWNLOAD}`, 'toolbar: Zoom', 'toolbar: Reset axes', `toolbar: ${DOWNLOAD}`]);
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
  await page.getByLabel('Electrical tilt Δ (°) value').fill('3');
  await page.getByLabel('Electrical tilt Δ (°) value').press('Enter');
  const simulated = await download('plot-v');
  expect(simulated.name).toBe('vertical-cut-simulated.png');
  const freq = await download('plot-hpbw');
  expect(freq.name).toBe('beamwidth-vs-frequency-simulated.png');
});
