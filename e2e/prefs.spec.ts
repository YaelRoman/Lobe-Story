import { expect, test } from '@playwright/test';
import { planetText } from '../src/test/planetText';

const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const msi = (freq: number) =>
  planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });
const KEY = 'lobe-story:prefs:v1';

test('theme, gain unit, markers and analysis settings come back after a reload; sessions do not', async ({ page }) => {
  // The unsaved-work prompt of the page would block the reload: accept it (the session is not what is tested).
  page.on('dialog', (d) => void d.accept());
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('secret-name.msi', msi(1800))]);
  await expect(page.locator('.panel li')).toHaveCount(1);

  await page.getByRole('button', { name: 'Dark mode' }).click();
  await page.getByRole('button', { name: 'dBi', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Sidelobes', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Beam direction', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Rectangular' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  const level = page.getByLabel('Beamwidth level (dB)');
  await level.fill('6');
  await level.press('Enter');

  // Written after a short quiet time: wait for it, then look at exactly what is stored.
  await page.waitForFunction((k) => localStorage.getItem(k) !== null && JSON.parse(localStorage.getItem(k)!).settings.levelDb === 6, KEY);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toEqual([KEY]);
  const stored = await page.evaluate((k) => localStorage.getItem(k)!, KEY);
  expect(stored).not.toMatch(/secret|1800|\.msi|offsets|names/i);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.panel')).toHaveCount(0); // the session itself is not remembered
  await page.getByTestId('file-input').setInputFiles([file('other.msi', msi(1900))]);
  await expect(page.locator('.panel li')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'dBi', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('checkbox', { name: 'Sidelobes', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Beam direction', exact: true })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Rectangular' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByLabel('Beamwidth level (dB)')).toHaveValue('6');

  // Reset preferences asks first, then restores the defaults and forgets the key.
  await page.getByRole('button', { name: 'Reset preferences' }).click();
  const ask = page.getByRole('dialog', { name: /Reset the theme, gain unit/ });
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'dBi', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Reset preferences' })).toBeFocused();
  await page.getByRole('button', { name: 'Reset preferences' }).click();
  await ask.getByRole('button', { name: 'Reset preferences' }).click();
  await expect(page.getByRole('button', { name: 'dBd', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('checkbox', { name: 'Sidelobes', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Beam direction', exact: true })).toBeChecked();
  await expect(page.getByLabel('Beamwidth level (dB)')).toHaveValue('3');
  await page.waitForTimeout(600);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
});

test('a damaged stored value is ignored', async ({ page }) => {
  await page.addInitScript((k) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(k, '{"version":1,"view":{"theme":"purple","gainUnit":3},"settings":{"levelDb":"x"}}');
      sessionStorage.setItem('seeded', '1');
    }
  }, KEY);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'dBd', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
