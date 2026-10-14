import { expect, test, type Page } from '@playwright/test';
import { planetText } from '../src/test/planetText';
import { dismissLoadLine } from './loadLine';
import { openSimulation } from './simulationBar';

const file = (name: string, content: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(content) });
const msi = (freq: number) => planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });
/** Three patterns and one file that does not load: its status line stays until dismissed. */
const files = () => [...[1800, 1900, 2100].map((f) => file(`a_${f}.msi`, msi(f))), file('empty.msi', '')];

const box = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!;
/** How far the page itself and the working area can scroll. */
const scrollRoom = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('main')!;
    return { page: document.documentElement.scrollHeight - window.innerHeight, main: main.scrollHeight - main.clientHeight };
  });

// 1280 x 720 and 1440 x 900 at 200 % zoom, as the browser reports them.
for (const [width, height] of [[640, 360], [720, 450]]) {
  test(`in a ${width} x ${height} window the toolbar and the Files bar scroll away with the page; the status line stays (R4-10)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(files());
    await expect(page.getByTestId('load-status')).toContainText('could not be loaded');
    await openSimulation(page);
    await expect(page.getByTestId('plot-h').locator('.main-svg').first()).toBeVisible();

    // The page scrolls as a whole: the working area is not a box of its own under three fixed bars.
    const room = await scrollRoom(page);
    expect(room.page).toBeGreaterThan(1000);
    expect(room.main).toBeLessThanOrEqual(1);
    expect((await box(page, '.toolbar')).y).toBe(0);

    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, 700);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(700);
    const toolbar = await box(page, '.toolbar');
    expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(0);
    const toggle = await box(page, '.files-toggle');
    expect(toggle.y + toggle.height).toBeLessThanOrEqual(0);
    // Only the status line is left at the top; the rest of the window is the page.
    const status = await box(page, '[data-testid="load-status"]');
    expect(status.y).toBe(0);
    expect(status.height).toBeLessThan(height / 4);
    await expect(page.getByTestId('load-status')).toBeInViewport();
    // It is on top of what scrolls under it.
    const onTop = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="load-status"]') !== null, [width / 2, status.height / 2]);
    expect(onTop).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

    // A heading reached by its skip link is not hidden under the status line.
    await page.evaluate(() => document.getElementById('metrics-heading')?.scrollIntoView({ block: 'start' }));
    expect((await box(page, '#metrics-heading')).y).toBeGreaterThanOrEqual(status.height - 1);
  });

  test(`in a ${width} x ${height} window the undo offer does not lie on a slider or a number box of the Simulation bar, and moves nothing`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
    await expect(page.locator('.panel li')).toHaveCount(24);
    await dismissLoadLine(page);
    await openSimulation(page);
    const value = page.getByLabel('Mechanical tilt (°) value');
    await value.fill('4');
    await value.press('Enter');
    await expect(page.getByTestId('sim-badge')).toBeVisible();
    const reset = page.getByRole('button', { name: 'Reset', exact: true });
    await reset.scrollIntoViewIfNeeded();
    const before = (await reset.boundingBox())!;
    await reset.click();
    const offer = page.getByTestId('undo-toast');
    await expect(offer).toContainText('Reset the simulation.');
    expect((await reset.boundingBox())!).toEqual(before);
    const at = (await offer.boundingBox())!;
    expect(at.y).toBeGreaterThanOrEqual(0);
    expect(at.y + at.height).toBeLessThanOrEqual(height);
    const covered = await page.locator('.sim-bar input[type="range"], .sim-bar input[type="number"]').evaluateAll(
      (inputs, o) =>
        inputs
          .map((el) => ({ name: el.getAttribute('aria-label'), r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.left < o.x + o.width && r.right > o.x && r.top < o.y + o.height && r.bottom > o.y)
          .map(({ name }) => name),
      at,
    );
    expect(covered).toEqual([]);
  });
}

test('a window of ordinary height keeps the toolbar and the Files bar in place: the working area scrolls under them', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 700 });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(files());
  await openSimulation(page);
  await expect(page.getByTestId('plot-h').locator('.main-svg').first()).toBeVisible();
  const room = await scrollRoom(page);
  expect(room.page).toBeLessThanOrEqual(0);
  expect(room.main).toBeGreaterThan(1000);
  await page.mouse.move(320, 500);
  await page.mouse.wheel(0, 700);
  await expect.poll(() => page.locator('main').evaluate((m) => m.scrollTop)).toBe(700);
  expect((await box(page, '.toolbar')).y).toBe(0);
  expect((await box(page, '.files-toggle')).y).toBeGreaterThan(0);
});
