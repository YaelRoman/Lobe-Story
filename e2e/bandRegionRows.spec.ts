import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import { holdSlider, loadMany, settled, stopOn } from './manyFiles';

/**
 * The band statistics rows of the angular-region estimate and the Horizon level: there while the metrics table has
 * those values, gone when it no longer has them, and the same numbers as the table (a band mean is the mean of the
 * table's cells, as far as the table's rounding lets one tell).
 */

const band = (page: Page) => page.getByTestId('band-stats');
const rowHeads = (page: Page) => band(page).locator('tbody th[scope="row"]');
const bandCell = (page: Page, label: string | RegExp) => band(page).getByRole('row', { name: typeof label === 'string' ? new RegExp(`^${label.replace(/[[\]().]/g, '\\$&')}`) : label }).getByRole('button').first();
const toggle = (page: Page) => page.getByLabel('Show Angular regions (est.) columns');
const horizontalCut = (page: Page, name: 'At the horizon' | 'Through the beam peak') =>
  page.getByRole('group', { name: 'Horizontal cut' }).getByRole('button', { name });

/** The number a cell shows last: the simulated one of an `a → b` pair, else its only one. */
const lastValue = (text: string): number => Number(/-?\d+(\.\d+)?/.exec(text.split('→').pop()!)![0]);

/** The values of a metrics table column (every file is ticked): the simulated value of each pair. */
async function tableValues(page: Page, col: string): Promise<number[]> {
  return (await page.locator(`.metrics tbody td[data-col="${col}"]`).allInnerTexts()).map(lastValue);
}

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const powerMean = (v: number[]) => 10 * Math.log10(mean(v.map((x) => 10 ** (x / 10))));

/** The band cell's mean (of the simulated statistic under a simulation) is the table's mean, within the table's rounding. */
async function expectMeanOfTable(page: Page, cell: Locator, col: string, kind: 'arithmetic' | 'power', tolerance = 0.11) {
  await expect(async () => {
    const values = await tableValues(page, col);
    expect(values.every(Number.isFinite)).toBe(true);
    const expected = kind === 'power' ? powerMean(values) : mean(values);
    expect(Math.abs(lastValue(await cell.innerText()) - expected), `${await cell.innerText()} vs ${expected}`).toBeLessThanOrEqual(tolerance);
  }).toPass();
}

const ARE_ROWS = ['Sector efficiency est. [Summation]', 'Spatial efficiency est. [Summation]', 'Lower region ratio est. [Summation]'];

test('angular-region and Horizon level rows come and go with the table columns, follow the 3D method, the cut and a held slider', async ({ page }) => {
  test.slow();
  await loadMany(page, 30);
  await expect(band(page).locator('table')).toHaveCount(1);
  const annexRows = await rowHeads(page).count();
  await expect(rowHeads(page).filter({ hasText: /est\.|Horizon level/ })).toHaveCount(0);

  // Angular regions shown: three rows at the end, over every file, the same numbers as the table.
  await toggle(page).check();
  await expect(rowHeads(page)).toHaveCount(annexRows + 3);
  expect((await rowHeads(page).allInnerTexts()).slice(-3)).toEqual(ARE_ROWS);
  await expect(bandCell(page, ARE_ROWS[0])).toHaveText(/^\d+\.\d % ± \d+\.\d % n=30$/);
  await expect(bandCell(page, ARE_ROWS[2])).toHaveText(/^\d+\.\d{3} % ± \d+\.\d{3} % n=30$/);
  await expect(rowHeads(page).filter({ hasText: ARE_ROWS[0] })).toHaveAttribute('title', /not BASTA-compliant/);
  await expectMeanOfTable(page, bandCell(page, ARE_ROWS[0]), 'areSector', 'arithmetic');
  await expectMeanOfTable(page, bandCell(page, ARE_ROWS[1]), 'areSpatial', 'arithmetic');
  await expectMeanOfTable(page, bandCell(page, ARE_ROWS[2]), 'areLower', 'arithmetic', 0.0011);

  // A click shows the histogram of the cell.
  await bandCell(page, ARE_ROWS[0]).click();
  await expect(band(page).getByText(/^Sector efficiency est\. \[Summation\] — .* — N = 30$/)).toBeVisible();
  await expect(page.getByTestId('plot-band')).toBeVisible();

  // The 3D method changes the estimate: the rows name it and follow.
  const summation = await bandCell(page, ARE_ROWS[0]).innerText();
  await page.getByRole('group', { name: '3D method' }).getByRole('button', { name: 'Weighted' }).click();
  await expect(rowHeads(page).filter({ hasText: 'Sector efficiency est. [Weighted]' })).toHaveCount(1);
  await expect(bandCell(page, 'Sector efficiency est. [Weighted]')).not.toHaveText(summation);
  await expectMeanOfTable(page, bandCell(page, 'Sector efficiency est. [Weighted]'), 'areSector', 'arithmetic');
  await page.getByRole('group', { name: '3D method' }).getByRole('button', { name: 'Summation' }).click();
  await expect(bandCell(page, ARE_ROWS[0])).toHaveText(summation);

  // The cut at the horizon: the Horizon level row after the azimuth beamwidth, one value (no "→"), the table's level.
  await horizontalCut(page, 'At the horizon').click();
  await expect(rowHeads(page)).toHaveCount(annexRows + 4);
  const heads = await rowHeads(page).allInnerTexts();
  expect(heads[heads.indexOf('Azimuth beamwidth') + 1]).toBe('Horizon level');
  const level = bandCell(page, 'Horizon level');
  await expect(level).toHaveText(/^\d+\.\d dB ± \d+\.\d dB n=30$/);
  await expectMeanOfTable(page, level, 'hLevel', 'power');
  // The estimate does not depend on the cut: one value, as before.
  await expect(bandCell(page, ARE_ROWS[0])).toHaveText(summation);

  // A held slider (30 files with the estimate are applied when the slider stops): after the release the rows are of the
  // value the slider stopped on, as the table is.
  const untilted = await level.innerText();
  await holdSlider(page);
  await stopOn(page, 4);
  await page.mouse.up();
  await settled(page);
  await expect(level).not.toHaveText(untilted);
  await expect(level).not.toContainText('→');
  await expectMeanOfTable(page, level, 'hLevel', 'power');
  await expect(bandCell(page, ARE_ROWS[0])).toContainText('→');
  await expectMeanOfTable(page, bandCell(page, ARE_ROWS[0]), 'areSector', 'arithmetic');

  // Back through the beam peak: the Horizon level row goes; the estimate stays.
  await horizontalCut(page, 'Through the beam peak').click();
  await expect(rowHeads(page)).toHaveCount(annexRows + 3);
  await expect(rowHeads(page).filter({ hasText: 'Horizon level' })).toHaveCount(0);
  await expectMeanOfTable(page, bandCell(page, ARE_ROWS[0]), 'areSector', 'arithmetic');

  // Angular regions hidden: their rows go, and so does the picked cell's histogram.
  await toggle(page).uncheck();
  await expect(rowHeads(page)).toHaveCount(annexRows);
  await expect(page.getByTestId('plot-band')).toHaveCount(0);
});

async function text(download: Download): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of await download.createReadStream()) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

test.describe('exports', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'clipboard permissions are Chromium only');
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('Copy table and the band CSV carry the rows as shown; without them both are as before', async ({ page }) => {
    await loadMany(page, 12);
    const b = band(page);
    const clip = () => page.evaluate(() => navigator.clipboard.readText());
    const csv = async () => {
      const download = page.waitForEvent('download');
      await b.getByRole('button', { name: 'Export band CSV' }).click();
      return text(await download);
    };
    await b.getByRole('button', { name: 'Copy table' }).click();
    const plainCopy = await clip();
    const plainCsv = await csv();

    await toggle(page).check();
    await horizontalCut(page, 'At the horizon').click();
    await expect(rowHeads(page)).toHaveCount(plainCopy.trimEnd().split('\r\n').length - 1 + 4);

    await b.getByRole('button', { name: 'Copy table' }).click();
    await expect.poll(clip).toContain('Horizon level');
    const lines = (await clip()).split('\r\n');
    expect(lines[0].split('\t')[0]).toBe('Parameter [H cut at the horizon]');
    const first = lines.map((l) => l.split('\t')[0]);
    expect(first[first.indexOf('Azimuth beamwidth') + 1]).toBe('Horizon level');
    expect(first.slice(-4, -1)).toEqual(ARE_ROWS);
    expect(lines.find((l) => l.startsWith('Horizon level\t'))!.split('\t')[1]).toBe((await bandCell(page, 'Horizon level').innerText()).replace(/ n=\d+$/, ''));

    const out = await csv();
    // A plain CSV: the byte-order mark and the header, no comment lines before it.
    expect(out.startsWith('\ufeffAntenna,State,Sub-band,')).toBe(true);
    const rows = out.replace(/^\ufeff/, '').split('\r\n');
    const of = (parameter: string) => rows.filter((l) => l.split(',')[5] === parameter);
    expect(of('Horizon level').map((l) => l.split(',')[1])).toEqual(['horizon cut']);
    expect(of('Horizon level')[0].split(',')[6]).toBe('dB');
    for (const label of ARE_ROWS) expect(of(label).map((l) => l.split(',')[1])).toEqual(['original', 'simulated']);
    expect(of(ARE_ROWS[2])[0].split(',')[16]).toMatch(/^\d+\.\d{4}$/);
    expect(out).not.toMatch(/tilted/);

    // Back to the default: the copy and the CSV are as they were.
    await toggle(page).uncheck();
    await horizontalCut(page, 'Through the beam peak').click();
    await settled(page);
    await b.getByRole('button', { name: 'Copy table' }).click();
    await expect.poll(clip).toBe(plainCopy);
    expect(await csv()).toBe(plainCsv);
  });
});
