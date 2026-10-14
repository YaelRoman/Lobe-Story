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

/** The text of a download. */
async function downloaded(page: Page, click: () => Promise<void>): Promise<string> {
  const [file] = await Promise.all([page.waitForEvent('download'), click()]);
  let text = '';
  for await (const chunk of (await file.createReadStream())!) text += chunk.toString();
  return text;
}

test('settings typed with many decimals are written with at most two: on the page, in the images and in the CSV headers', async ({ page }) => {
  test.slow();
  await keepExportedSvgs(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await page.getByRole('button', { name: 'Settings' }).click();
  for (const [key, value] of [
    ['levelDb', '19.123456789012344'],
    ['fbWindowDeg', '29.87654321'],
    ['uslsRangeDeg', '12.3456789'],
    ['sectorEdgeDeg', '45.678901'],
  ]) {
    const field = page.locator(`#setting-${key}`);
    await field.fill(value);
    await field.press('Enter');
  }
  await page.keyboard.press('Escape');
  // The values are kept as typed: only how they are written changes.
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('#setting-levelDb')).toHaveValue('19.123456789012344');
  await page.keyboard.press('Escape');
  await page.getByRole('checkbox', { name: 'F/B window', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Sector', exact: true }).check();
  await expect(page.getByTestId('updating-2d')).toHaveCount(0);

  // On the page: the band statistics, the table's headers, the plots' labels.
  await expect(page.getByTestId('band-stats')).toContainText('Beamwidth level is 19.12 dB: the beamwidth');
  await expect(page.locator('.metrics thead')).toContainText('F/B ±29.88°');
  await expect(page.locator('.metrics thead')).toContainText('USLS peak to 12.35°');
  await expect(page.locator('.metrics thead')).toContainText('H-BW@19.12 dB');
  const names = await page.getByTestId('plot-h').locator('.js-plotly-plot').evaluate((gd) => (gd as unknown as { data: { name?: string }[] }).data.map((t) => t.name ?? ''));
  expect(names).toEqual(expect.arrayContaining(['F/B window ±29.88°', 'Sector edge +45.68°', 'Sector edge −45.68°']));
  expect(await page.locator('body').innerText()).not.toMatch(/\d\.\d{3}/);

  // In the image of the horizontal cut.
  await exportedFoot(page, 'plot-h');
  const image = await page.evaluate(() => {
    const svgs = (window as unknown as { exportedSvgs: string[] }).exportedSvgs.filter((s) => s.includes('Lobe-Story'));
    const host = document.createElement('div');
    host.innerHTML = svgs[svgs.length - 1];
    return [...host.querySelectorAll('text')].map((t) => t.textContent ?? '').join('\n');
  });
  expect(image).toContain('the −19.12 dB level');
  expect(image).toContain('Roll-off at ±45.68°');
  expect(image).toContain('sector edges (±45.68°)');
  expect(image).not.toMatch(/\d\.\d{3}/);

  // The headers of the metrics CSV and the band statistics CSV.
  const csv = await downloaded(page, () => page.getByRole('button', { name: 'Export CSV' }).click());
  const header = csv.split(/\r?\n/)[0];
  expect(header).toContain('F/B ±29.88° (dB)');
  expect(header).toContain('USLS peak to 12.35° (dB)');
  expect(header).not.toMatch(/\d\.\d{3}/);
  const band = await downloaded(page, () => page.getByRole('button', { name: 'Export band CSV' }).click());
  expect(band).toContain('F/B ±29.88°');
  expect(band).toContain('USLS peak to 12.35°');
  expect(band).not.toContain('29.876');
  expect(band).not.toContain('12.345');
});
