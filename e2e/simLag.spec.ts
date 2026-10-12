import { expect, test, type Download, type Page } from '@playwright/test';
import { holdSlider, keepMoving, loadMany, MECHANICAL, settled, stopAndClick, stopOn, WAITING } from './manyFiles';
import { openSimulation } from './simulationBar';

const DOWNLOAD = '.modebar-btn[data-title^="Download plot"]';
const IMAGE_BEHIND = 'Not saved: the picture is still following the sliders. Save it again once it has caught up.';

const text = async (download: Download) => {
  let out = '';
  for await (const chunk of (await download.createReadStream())!) out += chunk.toString();
  return { name: download.suggestedFilename(), text: out };
};

/** The file a click downloads. */
async function saved(page: Page, click: () => Promise<unknown>) {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  return text(download);
}
const press = (page: Page, name: string, within = 'main') => () => page.locator(within).getByRole('button', { name, exact: true }).click();

/** What the page copies goes to a list in the page instead of the clipboard (no permission is needed, in any browser). */
const catchCopies = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { copies: string[] };
    w.copies = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void w.copies.push(t) } });
  });
const copies = (page: Page) => page.evaluate(() => (window as unknown as { copies: string[] }).copies);
/** What a click copies. */
async function copied(page: Page, click: () => Promise<unknown>) {
  const before = (await copies(page)).length;
  await click();
  await expect.poll(async () => (await copies(page)).length).toBe(before + 1);
  return (await copies(page))[before];
}
const TABLE = 'section:has(.metrics)';
const BAND = '[data-testid="band-stats"]';

async function setDirect(page: Page, value: string) {
  const box = page.getByLabel(`${MECHANICAL} value`, { exact: true });
  await box.fill(value);
  await box.press('Enter');
  await settled(page);
}

test('while a slider is held with many files, the table, the band statistics and the frequency chart are marked busy and dimmed', async ({ page }) => {
  await loadMany(page, 48);
  const marked = page.locator('.follows-sim');
  for (const part of ['.metrics', '[data-testid="band-stats"]', '[data-testid="plot-hpbw"]']) await expect(marked.locator(part)).toHaveCount(1);
  await expect(marked).not.toHaveAttribute('aria-busy');
  const opacity = () => marked.evaluate((e) => Number(getComputedStyle(e).opacity));
  expect(await opacity()).toBe(1);

  const slider = await holdSlider(page);
  await expect(page.getByTestId('sim-lag')).toHaveText(WAITING);
  await expect(marked).toHaveAttribute('aria-busy', 'true');
  await expect.poll(opacity).toBeLessThanOrEqual(0.6);
  // The table is the one from before the drag: that is what the mark says.
  await expect(page.locator('p.count', { hasText: 'Simulated:' })).toHaveCount(0);

  await stopOn(page, 4);
  await page.mouse.up();
  await settled(page);
  // Where the slider ended (a browser may take the released thumb back to the pointer): the table is of that value.
  await expect(page.locator('p.count', { hasText: 'Simulated:' })).toContainText(`mech +${await slider.inputValue()}°`);
  await expect(marked).not.toHaveAttribute('aria-busy');
  await expect.poll(opacity).toBe(1);
});

test('with the built-in example (the page follows the drag) no sentence comes in the bar and nothing is marked busy', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await openSimulation(page);
  await settled(page);
  // Notes whether the sentence or the mark was there at any moment (they could come and go between two checks).
  await page.evaluate(() => {
    const w = window as unknown as { sawLag: boolean };
    w.sawLag = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="sim-lag"], .follows-sim[aria-busy], main[data-sim-behind]')) w.sawLag = true;
    }).observe(document.body, { childList: true, subtree: true, attributes: true });
  });
  const slider = page.getByRole('slider', { name: MECHANICAL, exact: true });
  const box = (await slider.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + i * 6, y);
  await expect(page.locator('p.count', { hasText: 'Simulated:' })).toContainText(`mech +${await slider.inputValue()}°`);
  await page.mouse.up();
  await settled(page);
  expect(await page.evaluate(() => (window as unknown as { sawLag: boolean }).sawLag)).toBe(false);
});

/** With the slider held and the hand moving: clicks `button` in the task in which the slider reaches `value` (the page has not followed, the mouse is still down), and the hand moves on. */
const heldClick = (page: Page, value: number, within: string, button: string) => async () => {
  await stopAndClick(page, value, within, button);
  await keepMoving(page, MECHANICAL);
};

test('the metrics table exported or copied while a slider is held is of the value the slider shows: the same as after typing it', async ({ page }) => {
  // Loads 48 files and waits for six full passes: long on a busy machine.
  test.slow();
  await catchCopies(page);
  await loadMany(page, 48);
  const slider = await holdSlider(page);
  await expect(page.getByTestId('sim-lag')).toHaveText(WAITING);
  const held = { csv: await saved(page, heldClick(page, 4, TABLE, 'Export CSV')), copy: await copied(page, heldClick(page, 5, TABLE, 'Copy table')) };
  expect(held.csv.name).toBe('pattern-metrics-simulated.csv');
  expect(held.csv.text).toContain('H-HPBW tilted');

  // Once more with the hand standing still on its value: the table has caught up with it, and the slider is still held.
  await stopAndClick(page, 8, TABLE, 'Export CSV');
  await expect(page.locator('p.count', { hasText: 'Simulated:' })).toContainText('mech +8°');
  await expect(page.getByTestId('sim-lag')).toHaveCount(0);
  await expect(page.locator('.follows-sim')).not.toHaveAttribute('aria-busy');
  await expect(slider).toHaveValue('8');
  await page.mouse.up();
  await settled(page);

  // The same values typed, from a reset bar.
  await setDirect(page, '0');
  expect((await saved(page, press(page, 'Export CSV'))).name).toBe('pattern-metrics.csv');
  await setDirect(page, '4');
  expect(await saved(page, press(page, 'Export CSV'))).toEqual(held.csv);
  await setDirect(page, '5');
  expect(await copied(page, press(page, 'Copy table', TABLE))).toBe(held.copy);
});

test('the band statistics exported or copied while a slider is held are of the value the slider shows: the same as after typing it', async ({ page }) => {
  test.slow();
  await catchCopies(page);
  await loadMany(page, 48);
  await holdSlider(page);
  await expect(page.getByTestId('sim-lag')).toHaveText(WAITING);
  const held = { csv: await saved(page, heldClick(page, 6, BAND, 'Export band CSV')), copy: await copied(page, heldClick(page, 7, BAND, 'Copy table')) };
  expect(held.csv.name).toBe('band-statistics-simulated.csv');
  await stopOn(page, 7);
  await page.mouse.up();
  await settled(page);

  await setDirect(page, '0');
  expect((await saved(page, press(page, 'Export band CSV'))).name).toBe('band-statistics.csv');
  await setDirect(page, '6');
  expect(await saved(page, press(page, 'Export band CSV'))).toEqual(held.csv);
  await setDirect(page, '7');
  expect(await copied(page, press(page, 'Copy table', BAND))).toBe(held.copy);
});

test('a picture is not saved while a slider is held: the click says why, and it is saved once the page has caught up', async ({ page }) => {
  await loadMany(page, 48);
  const downloads: Download[] = [];
  page.on('download', (d) => downloads.push(d));
  await holdSlider(page);
  await expect(page.getByTestId('sim-lag')).toHaveText(WAITING);
  // A picture cannot be made of what is not drawn yet.
  for (const plot of ['plot-h', 'plot-hpbw']) {
    await heldClick(page, 3, `[data-testid="${plot}"]`, 'Download plot')();
    await expect(page.getByTestId('copy-note')).toHaveText(IMAGE_BEHIND);
  }
  expect(await page.getByTestId('plot-hpbw').locator(DOWNLOAD).evaluate((b) => Number(getComputedStyle(b).opacity))).toBeLessThan(0.5);
  await stopOn(page, 3);
  await page.mouse.up();
  await settled(page);
  expect(downloads).toHaveLength(0);

  // Caught up, the pictures are saved again, and the button is as it was.
  expect(await page.getByTestId('plot-hpbw').locator(DOWNLOAD).evaluate((b) => Number(getComputedStyle(b).opacity))).toBeGreaterThan(0.5);
  const image = await Promise.all([page.waitForEvent('download'), page.getByTestId('plot-hpbw').locator(DOWNLOAD).click()]);
  expect(image[0].suggestedFilename()).toMatch(/-simulated\.png$/);
  const cut = await Promise.all([page.waitForEvent('download'), page.getByTestId('plot-h').locator(DOWNLOAD).click()]);
  expect(cut[0].suggestedFilename()).toBe('horizontal-cut-simulated.png');
});

test('an export clicked at once after a typed value does not give the table from before it', async ({ page }) => {
  await loadMany(page, 48);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    // In one task, so that the page cannot have followed in between: the value is typed and committed, and Export is clicked.
    page.evaluate((label) => {
      const box = document.querySelector<HTMLInputElement>(`input[aria-label="${label} value"]`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, '7');
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Export CSV')!.click();
    }, MECHANICAL),
  ]);
  const atOnce = await text(download);
  await settled(page);
  await expect(page.getByRole('slider', { name: MECHANICAL, exact: true })).toHaveValue('7');
  expect(atOnce.name).toBe('pattern-metrics-simulated.csv');
  expect(atOnce).toEqual(await saved(page, press(page, 'Export CSV')));
});

test('on a phone the sentence is on the screen during a touch drag, also with the top of the bar scrolled away', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch input is sent through the Chromium DevTools protocol');
  const viewport = { width: 390, height: 844 };
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await loadMany(page, 48, viewport);
  const cdp = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number }[]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ ...p, id: 1 })) });
  const note = page.getByTestId('sim-lag');
  const onScreen = async () => {
    const box = (await note.boundingBox())!;
    const top = (await page.locator('main').boundingBox())!.y;
    expect(box.y).toBeGreaterThanOrEqual(top);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    return box;
  };
  /** A finger goes down on the slider and moves right; it stays down. */
  async function drag(name: string) {
    const slider = page.getByRole('slider', { name, exact: true });
    const box = (await slider.boundingBox())!;
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    const before = await slider.inputValue();
    await touch('touchStart', [{ x, y }]);
    for (let i = 1; i <= 6; i++) {
      await touch('touchMove', [{ x: x + i * 6, y }]);
      await page.waitForTimeout(60);
    }
    expect(await slider.inputValue()).not.toBe(before);
    await keepMoving(page, name);
    return box;
  }
  /** The finger is lifted. */
  async function lift() {
    await stopOn(page, 3);
    await touch('touchEnd', []);
  }

  const first = await drag(MECHANICAL);
  await expect(note).toHaveText(WAITING);
  // On the screen, above the finger; the line over the plots is not (it is below the fold on a phone).
  expect((await onScreen()).y + 1).toBeLessThan(first.y);
  await lift();
  await settled(page);
  await expect(note).toHaveCount(0);

  // The page scrolled until the bar's top edge is gone and a lower slider is under the finger: the sentence stays in view.
  const bar = (await page.locator('.sim-bar').boundingBox())!;
  const main = (await page.locator('main').boundingBox())!;
  await page.locator('main').evaluate((m, by) => m.scrollBy(0, by), bar.y - main.y + 60);
  expect((await page.locator('.sim-bar').boundingBox())!.y).toBeLessThan(main.y);
  await drag('Azimuth (°)');
  await expect(note).toHaveText(WAITING);
  await onScreen();
  await lift();
  await expect(note).toHaveCount(0);
  await context.close();
});
