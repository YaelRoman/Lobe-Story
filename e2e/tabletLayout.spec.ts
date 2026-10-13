import { expect, test, type Page } from '@playwright/test';

async function loadExample(page: Page) {
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await expect(page.getByTestId('plot-h').locator('.main-svg').first()).toBeVisible();
}

const size = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { width: Math.round(box.width), height: Math.round(box.height) };
};

/** The sizes of the small controls a finger has to hit: in the file panel, above the table and on a plot. */
const targets = async (page: Page) => ({
  menu: await size(page, '.panel li summary'),
  edit: await size(page, '.panel li button[aria-label^="Edit tags"]'),
  tick: await size(page, '.panel li input[type="checkbox"]'),
  sort: await size(page, '.metrics .sort-btn'),
  fold: await size(page, 'button.fold'),
  chartButton: await size(page, '[data-testid="plot-h"] .modebar-btn'),
});

test.describe('a tablet upright (768 px): the file panel is a drawer, the page has the whole width (R4-12)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('the panel is closed behind the Files bar and the plots, the bar and the table are as wide as the window', async ({ page }) => {
    await loadExample(page);
    const toggle = page.getByRole('button', { name: 'Files (24)' });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.panel')).toBeHidden();
    expect((await size(page, 'main')).width).toBe(768);
    expect((await size(page, '[data-testid="plot-h"]')).width).toBeGreaterThan(700);
    await toggle.click();
    await expect(page.locator('.panel')).toBeVisible();
    expect((await size(page, '.panel')).width).toBe(768);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

for (const width of [900, 901]) {
  test(`the drawer ends at 900 px: at ${width} px the panel is ${width <= 900 ? 'a drawer' : 'beside the page'}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await loadExample(page);
    if (width <= 900) {
      await expect(page.locator('.files-toggle')).toBeVisible();
      await expect(page.locator('.panel')).toBeHidden();
    } else {
      await expect(page.locator('.files-toggle')).toBeHidden();
      await expect(page.locator('.panel')).toBeVisible();
      expect((await size(page, '.panel')).width).toBe(300);
    }
  });
}

test.describe('a touch screen of any width has finger-sized targets', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test('at 1024 px with a coarse pointer the small controls are at least 32 px, and the panel stays beside the page', async ({ page }) => {
    await loadExample(page);
    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
    await expect(page.locator('.files-toggle')).toBeHidden();
    expect((await size(page, '.panel')).width).toBe(300);
    const t = await targets(page);
    for (const key of ['menu', 'edit', 'sort', 'fold', 'chartButton'] as const) {
      expect(t[key].height, key).toBeGreaterThanOrEqual(32);
      if (key !== 'sort') expect(t[key].width, key).toBeGreaterThanOrEqual(32);
    }
    expect(t.tick).toEqual({ width: 20, height: 20 });
    // The chart's buttons are in a strip above the plot, not on it.
    const plot = (await page.getByTestId('plot-h').boundingBox())!;
    const button = (await page.getByTestId('plot-h').locator('.modebar-btn').first().boundingBox())!;
    expect(button.y + button.height).toBeLessThanOrEqual(plot.y + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

test('with a mouse at 1024 px nothing is larger than before: the controls keep their desktop sizes', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await loadExample(page);
  expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(false);
  // Pinned from the page before this change (main at fc476f6, 1024 x 768, example loaded).
  expect(await targets(page)).toEqual(DESKTOP_TARGETS);
  expect((await size(page, '.panel')).width).toBe(300);
  const plot = (await page.getByTestId('plot-h').boundingBox())!;
  const button = (await page.getByTestId('plot-h').locator('.modebar-btn').first().boundingBox())!;
  expect(button.y).toBeGreaterThanOrEqual(plot.y);
});

const DESKTOP_TARGETS = {
  menu: { width: 28, height: 22 },
  edit: { width: 26, height: 22 },
  tick: { width: 13, height: 13 },
  sort: { width: 246, height: 26 },
  fold: { width: 112, height: 30 },
  chartButton: { width: 24, height: 22 },
};
