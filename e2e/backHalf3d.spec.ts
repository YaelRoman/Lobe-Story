import { expect, test, type Page } from '@playwright/test';
import { openSimulation } from './simulationBar';

const BACK = 'Use the back of the vertical cut';
const CHIP = '3D: back of the vertical cut used';

async function loadExample(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
}

const cells = (page: Page, col: string) => page.locator(`.metrics tbody td[data-col="${col}"]`).allTextContents();
const line = (page: Page) => page.getByRole('group', { name: 'Not at default' });

async function csvHeader(page: Page): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  let csv = '';
  for await (const chunk of await download.createReadStream()) csv += chunk.toString();
  return csv.split('\r\n')[0];
}

test('the back of the vertical cut: off by default, used only where the 3D method is, named with the numbers it changes, put back by its chip', async ({ page }) => {
  await loadExample(page);
  await openSimulation(page);
  const box = page.getByLabel(BACK);
  await expect(box).not.toBeChecked();
  // Like the 3D method, it changes nothing until something reads the reconstruction.
  await expect(box).toBeDisabled();

  await page.getByLabel('Show Angular regions (est.) columns').check();
  await expect(box).toBeEnabled();
  await expect(page.getByRole('columnheader', { name: 'Lower region est. [Summation] (%)' })).toBeVisible();
  const lowerOff = await cells(page, 'areLower');
  const sectorOff = await cells(page, 'areSector');
  const fbOff = await cells(page, 'fb180');

  await box.check();
  await expect(page.getByRole('columnheader', { name: 'Lower region est. [Summation + back of V cut] (%)' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Lower region est. [Summation + back of V cut] (%)' })).toContainText('[Sum. + back]');
  // The poles are no longer weighted by the azimuth cut: the lower region gets more power.
  await expect.poll(async () => Number((await cells(page, 'areLower'))[0])).toBeGreaterThan(Number(lowerOff[0]));
  // Untilted, the cuts' own metrics do not depend on it.
  expect(await cells(page, 'fb180')).toEqual(fbOff);
  await expect(line(page).getByRole('button', { name: `${CHIP}, stop using it` })).toBeVisible();
  expect(await csvHeader(page)).toContain(',Sector eff. est. [Summation + back of V cut] (%),Spatial eff. est. [Summation + back of V cut] (%),Lower region est. [Summation + back of V cut] (%)');

  // The folded bar names it with the method.
  await page.getByRole('button', { name: /Simulation/ }).click();
  await expect(page.getByTestId('sim-summary')).toContainText('3D method: Summation + back of V cut');
  await openSimulation(page);

  // Its chip puts it back; every number is the one before.
  await line(page).getByRole('button', { name: `${CHIP}, stop using it` }).click();
  await expect(box).not.toBeChecked();
  await expect(page.getByRole('columnheader', { name: 'Lower region est. [Summation] (%)' })).toBeVisible();
  await expect.poll(() => cells(page, 'areLower')).toEqual(lowerOff);
  expect(await cells(page, 'areSector')).toEqual(sectorOff);
  await expect(page.getByTestId('undo-toast')).toContainText('Stop using the back of the vertical cut');
  await page.getByTestId('undo-toast').getByRole('button', { name: /Undo/ }).click();
  await expect(box).toBeChecked();
});

test('under a mechanical tilt it reads F/B behind the antenna from the vertical cut, and it is remembered by the browser', async ({ page }) => {
  await loadExample(page);
  await openSimulation(page);
  const mech = page.getByLabel('Mechanical tilt (°) value');
  await mech.fill('8');
  await mech.press('Enter');
  const box = page.getByLabel(BACK);
  await expect(box).toBeEnabled();
  const fbOff = await cells(page, 'fb180');
  await box.check();
  await expect.poll(() => cells(page, 'fb180')).not.toEqual(fbOff);
  // The horizon-cut headers name it too (a horizon cut is read from the reconstruction).
  await page.getByRole('group', { name: 'Horizontal cut' }).getByRole('button', { name: 'At the horizon' }).click();
  expect(await csvHeader(page)).toContain('H-HPBW tilted [horizon cut] [Summation + back of V cut] (°)');

  await page.reload();
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await openSimulation(page);
  await expect(page.getByLabel(BACK)).toBeChecked();
});

test('the 3D view draws the reconstruction chosen and says so, also when the methods are compared', async ({ page }) => {
  await loadExample(page);
  await page.getByRole('group', { name: 'Dimension' }).getByRole('button', { name: '3D' }).click();
  const plot = page.getByTestId('plot-3d');
  await expect(plot.locator('canvas').first()).toBeVisible();
  const fingerprint = () =>
    page.evaluate(() => {
      const gd = document.querySelector('[data-testid="plot-3d"] .js-plotly-plot') as unknown as { data: { surfacecolor?: number[][] }[] } | null;
      return gd?.data.map((t) => (t.surfacecolor ?? []).flat().reduce((a, b) => a + b, 0).toFixed(6)).join('|') ?? '';
    });
  await expect.poll(fingerprint).not.toBe('');
  const off = await fingerprint();

  await openSimulation(page);
  const box = page.getByLabel(BACK);
  await expect(box).toBeEnabled();
  await box.check();
  await expect.poll(fingerprint).not.toBe(off);
  await expect(page.getByText('3D shape reconstructed from the H and V cuts (summation, with the back of the vertical cut); an estimate, not measured data.')).toBeVisible();

  await page.getByLabel('Compare methods').check();
  await expect(page.getByTestId('compare-numbers-method')).toContainText('Numbers use: Summation + back of V cut');
  await expect(page.getByTestId('compare-intro')).toContainText('both with the back of the vertical cut');
  await expect(plot.locator('.annotation-text').first()).toContainText('Summation + back of V cut');
  await expect(plot.locator('.annotation-text').nth(1)).toContainText('Weighted + back of V cut');

  await box.uncheck();
  await expect(page.getByTestId('compare-numbers-method')).toContainText('Numbers use: Summation (');
  await expect(plot.locator('.annotation-text').nth(1)).not.toContainText('back of V cut');
});
