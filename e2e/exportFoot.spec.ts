import { expect, test, type Page } from '@playwright/test';
import { openSimulation } from './simulationBar';

const DOWNLOAD = 'Download plot as a png (with legend and values)';

/** Keeps every SVG the page turns into an image (the exported image is drawn from one). */
async function keepExportedSvgs(page: Page) {
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
}

interface FootGeometry {
  /** The foot line's text. */
  foot: string;
  /** From the foot line's lower edge to the image's, in px. */
  toEdge: number;
  /** The texts that reach down to within 3 px of the foot line's upper edge, or below it. */
  touching: string[];
  /** Whether the foot line ends inside the image. */
  inside: boolean;
}

/**
 * Downloads the image of the plot `testId` and measures, in the SVG it was drawn from, where the foot line (the text
 * that ends in the app's name) lies against every other text of the image.
 */
async function exportedFoot(page: Page, testId: string): Promise<FootGeometry> {
  await page.evaluate(() => ((window as unknown as { exportedSvgs: string[] }).exportedSvgs.length = 0));
  await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).getByRole('button', { name: DOWNLOAD }).click()]);
  await expect.poll(() => page.evaluate(() => (window as unknown as { exportedSvgs: string[] }).exportedSvgs.some((s) => s.includes('Lobe-Story')))).toBe(true);
  return page.evaluate(() => {
    const svgs = (window as unknown as { exportedSvgs: string[] }).exportedSvgs.filter((s) => s.includes('Lobe-Story'));
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden';
    host.innerHTML = svgs[svgs.length - 1];
    document.body.appendChild(host);
    const image = host.querySelector('svg')!.getBoundingClientRect();
    const texts = [...host.querySelectorAll('text')].filter((t) => (t.textContent ?? '').trim() !== '');
    const footEl = texts.find((t) => (t.textContent ?? '').trimEnd().endsWith('Lobe-Story'))!;
    const foot = footEl.getBoundingClientRect();
    const touching = texts.filter((t) => t !== footEl && t.getBoundingClientRect().bottom > foot.top - 3).map((t) => t.textContent ?? '');
    const out = { foot: footEl.textContent ?? '', toEdge: image.bottom - foot.bottom, touching, inside: foot.right <= image.right && foot.left >= image.left };
    host.remove();
    return out;
  });
}

test('the foot line of an exported image lies under everything else, whatever the plot and however long the axis title', async ({ page }) => {
  test.slow();
  await keepExportedSvgs(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  // A tilt, so the foot line names the 3D method as well: its longest form.
  await openSimulation(page);
  const mech = page.getByLabel('Mechanical tilt (°) value');
  await mech.fill('2');
  await mech.press('Enter');
  await expect(page.getByTestId('sim-badge')).toBeVisible();
  await expect(page.getByTestId('updating-2d')).toHaveCount(0);

  const check = async (testId: string) => {
    const g = await exportedFoot(page, testId);
    expect(g.foot, testId).toContain('3D method: ');
    expect(g.touching, `${testId}: texts on or under the foot line`).toEqual([]);
    expect(g.toEdge, testId).toBeGreaterThanOrEqual(0);
    expect(g.toEdge, testId).toBeLessThanOrEqual(10);
    expect(g.inside, testId).toBe(true);
  };

  // The histogram of the band parameter with the longest name: its axis title used to be drawn on the foot line.
  await page.getByTestId('band-stats').getByRole('row', { name: /^P2P tracking \(sector edges\)/ }).getByRole('button').first().click();
  await expect(page.getByTestId('plot-band').locator('.main-svg').first()).toBeVisible();
  await check('plot-band');
  // Polar cuts (nothing of the library's under the circle but the lowest angle label), then rectangular ones (an axis with a title).
  await check('plot-h');
  await check('plot-v');
  await page.getByRole('button', { name: 'Rectangular', exact: true }).click();
  await check('plot-h');
  await check('plot-v');
  // The frequency chart, with the metric of the longest name.
  await page.locator('#freq-metric').selectOption({ label: 'USLS horizon to 20° (dB)' });
  await check('plot-hpbw');
});
