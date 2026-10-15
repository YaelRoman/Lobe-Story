import { expect, test, type Download, type Page } from '@playwright/test';
import { planetText, points } from '../src/test/planetText';

const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

/**
 * Two synthetic antennas: array Y2 (65° azimuth beamwidth, 15 dBd) at five frequencies × two ports, and array Y3
 * (70°, 16 dBd) at the same ten plus two files at 2600 MHz, a sub-band only Y3 has.
 */
function twoAntennas() {
  const y2 = (f: number) => planetText({ headers: ['NAME A', `FREQUENCY ${f}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });
  const y3 = (f: number) =>
    planetText({ headers: ['NAME B', `FREQUENCY ${f}`, 'GAIN 16 dBd', 'TILT ELECTRICAL'], h: points((a) => Math.min(40, 3 * (a / 35) ** 2)) });
  const ports = (f: number, array: string, text: (f: number) => string) => ['P45', 'M45'].map((pol) => file(`_${f}_X_CO_${pol}_08T_${array}.MSI`, text(f)));
  return [
    ...[1800, 1820, 1840, 1860, 1880].flatMap((f) => ports(f, 'Y2', y2)),
    ...[1800, 1820, 1840, 1860, 1880, 2600].flatMap((f) => ports(f, 'Y3', y3)),
  ];
}

async function load(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(twoAntennas());
  await expect(page.getByTestId('band-stats').locator('table')).toHaveCount(1);
}

async function text(download: Download): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of await download.createReadStream()) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

const band = (page: Page) => page.getByTestId('band-stats');

async function compareY3WithY2(page: Page) {
  await band(page).getByLabel('Antenna', { exact: true }).selectOption({ label: 'Array Y2 (10 files)' });
  await band(page).getByLabel('Compare with').selectOption({ label: 'Array Y3 (12 files)' });
  await expect(band(page).getByRole('table', { name: 'Band statistics: Array Y3 compared with Array Y2' })).toBeVisible();
}

test('compares two antennas: A | B | B − A per sub-band, and leaves the comparison', async ({ page }) => {
  await load(page);
  const b = band(page);
  await expect(b.getByLabel('Compare with')).toHaveValue('');
  await compareY3WithY2(page);
  // Antenna A is not offered as B.
  await expect(b.getByLabel('Compare with').locator('option')).toHaveText(['No comparison', 'Array Y3 (12 files)']);

  const table = b.getByRole('table');
  await expect(table.getByRole('columnheader', { name: '1800–1880 MHz', exact: true })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: '2600 MHz', exact: true })).toBeVisible();
  // Each header of the second row names its sub-band for a screen reader, which may not read the spanning header.
  await expect(table.getByRole('columnheader', { name: '1800–1880 MHz, A: Array Y2, 10 files', exact: true })).toHaveCount(1);
  await expect(table.getByRole('columnheader', { name: '2600 MHz, B: Array Y3, 2 files', exact: true })).toHaveCount(1);
  await expect(table.getByRole('columnheader', { name: '1800–1880 MHz, B − A', exact: true })).toHaveCount(1);
  await expect(table.getByRole('columnheader', { name: '2600 MHz, B − A', exact: true })).toHaveCount(1);
  await expect(b).toContainText('Comparing A = Array Y2 with B = Array Y3: B − A per sub-band');

  const row = (name: RegExp) => table.getByRole('row', { name });
  const cells = (name: RegExp) => row(name).getByRole('button');
  await expect(cells(/^Azimuth beamwidth/).nth(0)).toHaveText('65.0° ± 0.0° n=10');
  await expect(cells(/^Azimuth beamwidth/).nth(1)).toHaveText('70.0° ± 0.0° n=10');
  await expect(cells(/^Azimuth beamwidth/).nth(2)).toHaveText('+5.0° (tol 0.0°)');
  await expect(cells(/^Gain, all tilts/).nth(2)).toHaveText('+1.0 dB (tol 0.0 dB)');
  await expect(cells(/^Electrical tilt range/).nth(2)).toHaveText('0°');
  // 2600 MHz: files of B only; A has no values, so no difference.
  await expect(cells(/^Azimuth beamwidth/).nth(3)).toHaveAccessibleName('No value');
  await expect(cells(/^Azimuth beamwidth/).nth(4)).toHaveText('70.0° n=2');
  await expect(cells(/^Azimuth beamwidth/).nth(5)).toHaveAccessibleName('No difference');

  // A B − A cell: its rule in the detail line, and both antennas in one histogram.
  await cells(/^Azimuth beamwidth/).nth(2).click();
  await expect(b.getByTestId('band-detail')).toContainText('B − A of the mean');
  await expect(b.getByText('Azimuth beamwidth — 1800–1880 MHz — B − A — N = 10 (A), 10 (B)')).toBeVisible();
  const plot = page.getByTestId('plot-band');
  await expect(plot.locator('.legend .traces')).toHaveCount(2);
  await expect(plot.locator('.legend')).toContainText('A: Array Y2');
  // A cell of B: B's own histogram.
  await cells(/^Azimuth beamwidth/).nth(1).click();
  await expect(b.getByText('Azimuth beamwidth — 1800–1880 MHz — B: Array Y3 — N = 10')).toBeVisible();
  await expect(plot.locator('.legend')).toHaveCount(0);
  await cells(/^Azimuth beamwidth/).nth(5).click();
  await expect(b.getByTestId('band-detail')).toContainText('A (Array Y2) has no values in this sub-band');
  await expect(plot).toHaveCount(0);

  // Choosing B as A swaps the two.
  await b.getByLabel('Antenna', { exact: true }).selectOption({ label: 'Array Y3 (12 files)' });
  await expect(b.getByRole('table', { name: 'Band statistics: Array Y2 compared with Array Y3' })).toBeVisible();
  await expect(cells(/^Azimuth beamwidth/).nth(2)).toHaveText('-5.0° (tol 0.0°)');

  await b.getByLabel('Compare with').selectOption({ label: 'No comparison' });
  await expect(b.getByRole('table', { name: 'Band statistics for Array Y3' })).toBeVisible();
  await expect(b).not.toContainText('Comparing');
});

test('the band table is one tab stop with the arrow keys over A, B and B − A', async ({ page }) => {
  await load(page);
  await compareY3WithY2(page);
  const table = band(page).getByRole('table');
  await expect(table.locator('tbody button[tabindex="0"]')).toHaveCount(1);
  const first = table.locator('tbody button[tabindex="0"]');
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(':focus')).toHaveText('+1.0 dB (tol 0.0 dB)');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator(':focus')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('End');
  await expect(page.locator(':focus')).toHaveAttribute('data-col', '5');
  await expect(table.locator('tbody button[tabindex="0"]')).toHaveCount(1);
});

test.describe('exports while comparing', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'clipboard permissions are Chromium only');
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('Copy table copies A, B and B − A; the band CSV gets difference lines; without the comparison both are as before', async ({ page }) => {
    await load(page);
    const b = band(page);
    await b.getByLabel('Antenna', { exact: true }).selectOption({ label: 'Array Y2 (10 files)' });
    const clip = () => page.evaluate(() => navigator.clipboard.readText());

    await b.getByRole('button', { name: 'Copy table' }).click();
    const single = await clip();
    expect(single.split('\r\n')[0]).toBe('Parameter\t1800–1880 MHz (10 files)');
    let download = page.waitForEvent('download');
    await b.getByRole('button', { name: 'Export band CSV' }).click();
    const singleCsv = await text(await download);
    expect(singleCsv.startsWith('\ufeffAntenna,Sub-band,')).toBe(true);

    await compareY3WithY2(page);
    await b.getByRole('button', { name: 'Copy table' }).click();
    await expect.poll(clip).toContain('B − A');
    const lines = (await clip()).split('\r\n');
    expect(lines[0].split('\t')).toEqual([
      'Parameter',
      '1800–1880 MHz A: Array Y2 (10 files)',
      '1800–1880 MHz B: Array Y3 (10 files)',
      '1800–1880 MHz B − A',
      '2600 MHz A: Array Y2 (0 files)',
      '2600 MHz B: Array Y3 (2 files)',
      '2600 MHz B − A',
    ]);
    expect(lines.find((l) => l.startsWith('Azimuth beamwidth\t'))!.split('\t').slice(1, 4)).toEqual(['65.0° ± 0.0°', '70.0° ± 0.0°', "'+5.0° (tol 0.0°)"]);

    download = page.waitForEvent('download');
    await b.getByRole('button', { name: 'Export band CSV' }).click();
    const csv = (await text(await download)).replace(/^\ufeff/, '').split('\r\n');
    expect(csv[0].startsWith('Row,Antenna,Sub-band,')).toBe(true);
    // Every line of the plain CSV, plus A's lines over 2600 MHz, a comparison sub-band that is not A's own: each
    // difference line has its two statistic lines in the file.
    const stats = csv.filter((l) => l.startsWith('statistic,'));
    expect(stats).toHaveLength(singleCsv.trimEnd().split('\r\n').length - 1 + 20);
    expect(stats.filter((l) => l.startsWith('statistic,Array Y2,2600 MHz,'))).toHaveLength(20);
    expect(csv.find((l) => l.startsWith('difference,Array Y3 − Array Y2,1800–1880 MHz,1800,1880,Azimuth beamwidth,°,double-sided,,\'+5.0° (tol 0.0°),5.00,'))).toBeDefined();

    await b.getByLabel('Compare with').selectOption({ label: 'No comparison' });
    await b.getByRole('button', { name: 'Copy table' }).click();
    await expect.poll(clip).toBe(single);
    download = page.waitForEvent('download');
    await b.getByRole('button', { name: 'Export band CSV' }).click();
    expect(await text(await download)).toBe(singleCsv);
  });
});

test('the comparison is saved with the project and comes back when it is opened', async ({ page }) => {
  await load(page);
  await compareY3WithY2(page);
  await page.getByRole('button', { name: 'Save project' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  const projectPath = await (await downloadPromise).path();

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByText('Open or drop Planet pattern files')).toBeVisible();

  await page.getByTestId('project-input').setInputFiles(projectPath);
  await expect(band(page).getByRole('table', { name: 'Band statistics: Array Y3 compared with Array Y2' })).toBeVisible();
  await expect(band(page).getByLabel('Compare with')).toHaveValue(/Y3/);
});

test('at phone width the comparison scrolls inside the table with the Parameter column kept in view', async ({ page }) => {
  await load(page, 390);
  await compareY3WithY2(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const wrap = band(page).locator('.table-wrap');
  expect(await wrap.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const label = band(page).getByRole('rowheader', { name: 'Azimuth beamwidth' });
  const before = (await label.boundingBox())!.x;
  await wrap.evaluate((el) => el.scrollBy(400, 0));
  expect(Math.abs((await label.boundingBox())!.x - before)).toBeLessThan(1);
  const last = band(page).getByRole('row', { name: /^Azimuth beamwidth/ }).getByRole('button').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  const controls = band(page).locator('.controls');
  expect(await controls.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});
