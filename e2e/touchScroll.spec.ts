import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const DOWNLOAD = 'Download plot as a png (with legend and values)';

/** The button titles of the toolbar of chart `testId`, in order. */
const buttons = (page: Page, testId: string) =>
  page.getByTestId(testId).locator('.modebar-btn').evaluateAll((els) => els.map((el) => el.getAttribute('data-title') ?? ''));

async function loadExample(page: Page) {
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.getByTestId('plot-h').locator('.main-svg').first()).toBeVisible();
  await expect(page.getByTestId('plot-hpbw').locator('.main-svg').first()).toBeVisible();
}

/** One finger put down at (x, y0), moved to y1 in steps and lifted: touch events as a phone sends them (emulated). */
async function swipe(context: BrowserContext, page: Page, x: number, y0: number, y1: number) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / 10 }] });
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

const scrollTop = (page: Page) => page.locator('main').evaluate((m) => Math.round(m.scrollTop));

/** Brings the middle of `testId` to the middle of the screen and swipes up from there; returns how far the page went. */
async function swipeOn(context: BrowserContext, page: Page, testId: string): Promise<number> {
  const plot = page.getByTestId(testId);
  await plot.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = (await plot.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = Math.round(box.y + box.height / 2);
  const before = await scrollTop(page);
  await swipe(context, page, x, y + 100, y - 100);
  await expect.poll(async () => (await scrollTop(page)) - before, { timeout: 3000 }).not.toBe(0).catch(() => undefined);
  return (await scrollTop(page)) - before;
}

test.describe('touch: a swipe that starts on a plot scrolls the page (R4-09)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('one finger moved up on the polar cut, the rectangular cut and the frequency chart moves the page, and nothing in the plot changes', async ({ page, context, browserName }) => {
    // A swipe is sent as raw touch events through a DevTools session; Playwright has no such way in Firefox (only taps).
    test.skip(browserName !== 'chromium', 'one-finger swipes can only be sent through a Chromium DevTools session');
    await loadExample(page);
    const ranges = (testId: string) =>
      page.getByTestId(testId).locator('.js-plotly-plot').evaluate((el) => {
        const l = (el as unknown as { _fullLayout: { xaxis?: { range: number[] }; yaxis?: { range: number[] }; polar?: { radialaxis: { range: number[] } } } })._fullLayout;
        return JSON.stringify([l.xaxis?.range, l.yaxis?.range, l.polar?.radialaxis.range]);
      });

    const polar = await ranges('plot-h');
    expect(await swipeOn(context, page, 'plot-h')).toBeGreaterThan(100);
    expect(await ranges('plot-h')).toBe(polar);

    const chart = await ranges('plot-hpbw');
    expect(await swipeOn(context, page, 'plot-hpbw')).toBeGreaterThan(100);
    expect(await ranges('plot-hpbw')).toBe(chart);

    await page.locator('main').evaluate((m) => m.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Rectangular', exact: true }).click();
    await expect(page.getByTestId('plot-h').locator('.nsewdrag')).toHaveCount(1);
    const rect = await ranges('plot-h');
    expect(await swipeOn(context, page, 'plot-h')).toBeGreaterThan(100);
    expect(await ranges('plot-h')).toBe(rect);
  });

  test('zooming is by the toolbar there: Zoom in and Zoom out on the charts with axes, and a tap still reads a point', async ({ page }) => {
    await loadExample(page);
    await expect.poll(() => buttons(page, 'plot-h')).toEqual(['Reset view', DOWNLOAD]);
    await expect.poll(() => buttons(page, 'plot-hpbw')).toEqual(['Zoom in', 'Zoom out', 'Reset axes', DOWNLOAD]);
    await page.getByRole('button', { name: 'Rectangular', exact: true }).click();
    await expect.poll(() => buttons(page, 'plot-h')).toEqual(['Zoom in', 'Zoom out', 'Reset axes', DOWNLOAD]);

    // Zoom in narrows the axis, Reset axes puts it back.
    const span = () =>
      page.getByTestId('plot-h').locator('.js-plotly-plot').evaluate((el) => {
        const r = (el as unknown as { _fullLayout: { xaxis: { range: number[] } } })._fullLayout.xaxis.range;
        return Math.round(r[1] - r[0]);
      });
    expect(await span()).toBe(360);
    await page.getByTestId('plot-h').locator('.modebar-btn[data-title="Zoom in"]').tap();
    await expect.poll(span).toBeLessThan(360);
    await page.getByTestId('plot-h').locator('.modebar-btn[data-title="Reset axes"]').tap();
    await expect.poll(span).toBe(360);

    // A tap on a line of the cut reads the point under the finger, and the reading stays.
    const [tapX, tapY] = await page.getByTestId('plot-h').locator('.js-plotly-plot').evaluate((gd) => {
      const l = (gd as unknown as { _fullLayout: Record<'xaxis' | 'yaxis', { _offset: number; l2p: (v: number) => number }> })._fullLayout;
      const r = gd.getBoundingClientRect();
      return [r.left + l.xaxis._offset + l.xaxis.l2p(0), r.top + l.yaxis._offset + l.yaxis.l2p(-0.5)];
    });
    await page.touchscreen.tap(tapX, tapY);
    const reading = page.getByTestId('plot-h').locator('.hoverlayer');
    await expect(reading).toContainText('0.00 dB');
    await page.waitForTimeout(800);
    await expect(reading).toContainText('0.00 dB');

    // A tap on a point of the frequency chart highlights its file, as a click does (the first file is highlighted as loaded).
    const chart = page.getByTestId('plot-hpbw');
    await chart.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(page.locator('.metrics tbody tr.hl')).toContainText('example_1710_P45_02T');
    const point = chart.locator('.scatterlayer .trace .points path.point').nth(2);
    const box = (await point.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('.metrics tbody tr.hl')).toContainText('example_2110_P45_02T');
  });
});

test('with a mouse nothing changes: a drag on the rectangular cut zooms, and the toolbars are the same', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadExample(page);
  await expect.poll(() => buttons(page, 'plot-hpbw')).toEqual(['Zoom', 'Reset axes', DOWNLOAD]);
  await page.getByRole('button', { name: 'Rectangular', exact: true }).click();
  await expect.poll(() => buttons(page, 'plot-h')).toEqual(['Reset axes', DOWNLOAD]);
  const plot = page.getByTestId('plot-h');
  const dragmode = () => plot.locator('.js-plotly-plot').evaluate((el) => (el as unknown as { _fullLayout: { dragmode: unknown } })._fullLayout.dragmode);
  expect(await dragmode()).toBe('zoom');
  const span = () =>
    plot.locator('.js-plotly-plot').evaluate((el) => {
      const r = (el as unknown as { _fullLayout: { xaxis: { range: number[] } } })._fullLayout.xaxis.range;
      return Math.round(r[1] - r[0]);
    });
  const box = (await plot.locator('.nsewdrag').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();
  await expect.poll(span).toBeLessThan(360);
});
