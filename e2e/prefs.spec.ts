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

const tenFiles = (from: number) =>
  Array.from({ length: 5 }, (_, i) => from + 20 * i).flatMap((f) => ['P45', 'M45'].map((pol) => file(`_${f}_X_CO_${pol}_08T_Y2.MSI`, msi(f))));

test('user sub-bands stay with the session: not stored in the browser, gone after Clear, back with its undo', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(tenFiles(1800));
  const band = page.getByTestId('band-stats');
  const header = (name: RegExp) => band.getByRole('columnheader', { name });
  await expect(header(/^1800–1880 MHz/)).toBeVisible();
  await expect(band).toContainText('Sub-bands are automatic.');
  await expect(band.getByTestId('subband-state')).toHaveCount(0);

  await band.getByRole('button', { name: 'Sub-bands' }).click();
  await band.getByRole('button', { name: 'Start from automatic' }).click();
  // Covering every file: the state is named, nothing is left out.
  await expect(band.getByTestId('subband-state')).toHaveText(/^Sub-bands: user-defined \(1\)\.\s*Back to automatic$/);
  const max = band.getByLabel('Sub-band 1 max (MHz)');
  await max.fill('1840');
  await max.press('Enter');
  await expect(header(/^1800–1840 MHz/)).toBeVisible();
  await expect(band.getByTestId('subband-state')).toContainText('Sub-bands: user-defined (1). 4 of 10 files are in no sub-band.');
  await expect(band).not.toContainText('Sub-bands are automatic.');
  // The state is said with the editor closed too.
  await band.getByRole('button', { name: 'Sub-bands' }).click();
  await expect(band.getByRole('group', { name: 'Sub-bands' })).toHaveCount(0);
  await expect(band.getByTestId('subband-state')).toBeVisible();

  // A preference written in the same session carries no sub-band.
  await page.getByRole('button', { name: 'dBi', exact: true }).click();
  await page.waitForFunction((k) => (localStorage.getItem(k) ?? '').includes('dBi'), KEY);
  expect(await page.evaluate((k) => localStorage.getItem(k)!, KEY)).not.toMatch(/subBands|1840/);

  // Clear, then other files: automatic again. The undo of the Clear brings the user's sub-bands back with their files.
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.locator('.panel')).toHaveCount(0);
  await page.getByTestId('undo-toast').getByRole('button', { name: /^Undo/ }).click();
  await expect(header(/^1800–1840 MHz/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByTestId('file-input').setInputFiles(tenFiles(2500));
  await expect(header(/^2500–2580 MHz/)).toContainText('10 files');
  await expect(band.getByTestId('subband-state')).toHaveCount(0);
  await expect(band).toContainText('Sub-bands are automatic.');

  // "Back to automatic" is the way out without the editor.
  await band.getByRole('button', { name: 'Sub-bands' }).click();
  await band.getByLabel('Add a common sub-band').selectOption({ label: '880–960 MHz' });
  await expect(band.getByTestId('subband-state')).toContainText('10 of 10 files are in no sub-band.');
  await band.getByRole('button', { name: 'Back to automatic' }).click();
  await expect(header(/^2500–2580 MHz/)).toBeVisible();
  await expect(band.getByTestId('subband-state')).toHaveCount(0);
  // It dropped typed work in one click: an undo is offered, and Ctrl+Z brings the sub-bands back as they were.
  await expect(page.getByTestId('undo-toast')).toContainText('Dropped your sub-band');
  await page.keyboard.press('Control+z');
  await expect(band.getByTestId('subband-state')).toContainText('Sub-bands: user-defined (1). 10 of 10 files are in no sub-band.');
  await expect(header(/^880–960 MHz/)).toBeVisible();
  // And the offer's own button, after dropping them again.
  await band.getByRole('button', { name: 'Back to automatic' }).click();
  await expect(band.getByTestId('subband-state')).toHaveCount(0);
  await page.getByTestId('undo-toast').getByRole('button', { name: /^Undo/ }).click();
  await expect(band.getByTestId('subband-state')).toContainText('Sub-bands: user-defined (1).');
});

test('sub-bands an earlier version left in the browser are not applied, and are forgotten', async ({ page }) => {
  await page.addInitScript((k) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(k, JSON.stringify({ version: 1, view: { gainUnit: 'dBi', subBands: [{ name: '1710–1750 MHz', minMHz: 1710, maxMHz: 1750 }] } }));
      sessionStorage.setItem('seeded', '1');
    }
  }, KEY);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(tenFiles(2500));
  const band = page.getByTestId('band-stats');
  await expect(band.getByRole('columnheader', { name: /^2500–2580 MHz/ })).toContainText('10 files');
  await expect(band).toContainText('Sub-bands are automatic.');
  // The other stored preference is kept; the sub-bands are gone from the storage.
  await expect(page.getByRole('button', { name: 'dBi', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate((k) => localStorage.getItem(k)!, KEY)).not.toMatch(/subBands|1750/);
});
