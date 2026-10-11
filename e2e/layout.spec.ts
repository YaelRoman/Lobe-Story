import { expect, test } from '@playwright/test';
import { planetText } from '../src/test/planetText';

const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const msi = (freq: number) => planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });
const files = () => [1800, 1900, 2100].map((f) => file(`_${f}_X_CO_P45_08T_Y2.MSI`, msi(f)));

test('the simulation bar folds to one line that keeps the badge and summary, and the choice is remembered', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(files());
  const fold = page.getByRole('button', { name: /Simulation/ });
  await expect(fold).toHaveAttribute('aria-expanded', 'true'); // desktop default: unchanged
  await page.getByLabel('Electrical tilt Δ (°) value').fill('3');
  await page.getByLabel('Electrical tilt Δ (°) value').press('Enter');
  await expect(page.getByTestId('sim-badge')).toBeVisible();

  await fold.focus();
  await page.keyboard.press('Enter');
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Electrical tilt Δ (°) value')).toHaveCount(0);
  await expect(page.getByTestId('sim-badge')).toBeVisible();
  await expect(page.getByTestId('sim-summary')).toContainText('Tilt Δ 3°');
  await expect(fold).toBeFocused();

  await page.getByRole('button', { name: /Markers/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Sidelobes', exact: true })).toHaveCount(0);

  await page.waitForFunction(() => JSON.parse(localStorage.getItem('lobe-story:prefs:v1') ?? '{}').view?.collapsed?.simBar === true);
  await page.reload();
  await page.getByTestId('file-input').setInputFiles(files());
  await expect(page.getByRole('button', { name: /Simulation/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: /Markers/ })).toHaveAttribute('aria-expanded', 'false');
});

test('phone layout: no horizontal overflow, file drawer closed, first plot on the first screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(files());
  const toggle = page.getByRole('button', { name: 'Files (3)' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.panel')).toBeHidden();
  await expect(page.getByRole('button', { name: /Simulation/ })).toHaveAttribute('aria-expanded', 'false');

  const plot = page.getByTestId('plot-h');
  await expect(plot.locator('.main-svg').first()).toBeVisible();
  const box = (await plot.boundingBox())!;
  expect(box.y).toBeLessThan(500);
  expect(box.y + 200).toBeLessThan(844);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.panel')).toBeVisible();
  for (const b of await page.locator('.panel li summary, .panel li .row-main').all()) {
    const r = (await b.boundingBox())!;
    expect(r.height).toBeGreaterThanOrEqual(32);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await toggle.press('Enter');
  await expect(page.locator('.panel')).toBeHidden();
});
