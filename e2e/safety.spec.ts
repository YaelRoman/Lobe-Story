import { expect, test } from '@playwright/test';
import { planetText } from '../src/test/planetText';

const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const msi = (freq: number) =>
  planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });
const project = (path: string, freq: number) =>
  JSON.stringify({
    format: 'lobe-story-project',
    version: 1,
    savedAt: '2026-01-01T00:00:00.000Z',
    files: [{ path, text: msi(freq) }],
    state: { names: { [path]: 'From project' } },
  });

test('a failed file among many is reported, listed first and reachable from the status line', async ({ page }) => {
  await page.goto('/');
  const good = Array.from({ length: 60 }, (_, i) => file(`_${1700 + i}_X_CO_P45_08T_Y2.MSI`, msi(1700 + i)));
  await page.getByTestId('file-input').setInputFiles([
    ...good,
    file('corrupt.pln', 'NAME X\nFREQUENCY 900\n'),
    file('notes.txt', 'buy cables\nmeeting at 10\n'),
  ]);
  const status = page.getByRole('status').filter({ hasText: 'Loaded 60 files' });
  await expect(status).toContainText('2 could not be parsed');

  const panel = page.locator('.panel');
  const errors = page.getByTestId('panel-errors');
  await expect(errors).toContainText('Missing HORIZONTAL block');
  await expect(errors).toContainText('Not a Planet pattern file');
  // The Errors section is the first thing in the panel, not below 60 rows.
  const [p, e] = await Promise.all([panel.boundingBox(), errors.boundingBox()]);
  expect(e!.y - p!.y).toBeLessThan(40);

  await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await status.getByRole('button', { name: 'Show errors' }).click();
  await expect(errors).toBeInViewport();
  await expect(errors).toBeFocused();
});

test('same name with different content is kept as a numbered entry; identical content is skipped', async ({ page }) => {
  await page.goto('/');
  const input = page.getByTestId('file-input');
  await input.setInputFiles([file('antenna.msi', msi(1910))]);
  await expect(page.getByRole('status')).toHaveText(/^Loaded 1 file/);

  await input.setInputFiles([file('antenna.msi', msi(1930))]);
  await expect(page.getByRole('status')).toContainText('1 same-name file with different content added as a numbered copy');
  const panel = page.locator('.panel');
  await expect(panel.getByText('1910 MHz')).toBeVisible();
  await expect(panel.getByText('1930 MHz')).toBeVisible();
  await expect(panel.getByText('antenna (2).msi', { exact: true })).toBeVisible();
  await expect(panel.locator('li')).toHaveCount(2);

  await input.setInputFiles([file('antenna.msi', msi(1930)), file('antenna.msi', msi(1910))]);
  await expect(page.getByRole('status')).toContainText('2 already loaded (skipped)');
  await expect(panel.locator('li')).toHaveCount(2);
});

test('a project chosen through Open files opens as a project', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('p.lobestory.json', project('p.MSI', 2100))]);
  await expect(page.locator('.panel').getByText('From project', { exact: true })).toBeVisible();

  await page.getByTestId('file-input').setInputFiles([file('other.msi', msi(1800)), file('q.lobestory.json', project('q.MSI', 2200))]);
  await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
  await expect(page.locator('.panel').getByText('2200 MHz')).toBeVisible();
  await expect(page.locator('.panel').getByText('2100 MHz')).toHaveCount(0);
  await expect(page.getByTestId('undo-toast')).toBeVisible();
});

test('Clear asks first, then Undo and Ctrl+Z bring the whole session back', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800)), file('b.msi', msi(1900))]);
  const panel = page.locator('.panel');
  await page.getByLabel('Actions for a.msi').click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await page.getByLabel('Name for a.msi').fill('Alpha');
  await page.getByLabel('Name for a.msi').press('Enter');
  await expect(panel.getByText('Alpha', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(panel.getByText('Alpha', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByText('Open or drop Planet pattern files')).toBeVisible();
  const toast = page.getByTestId('undo-toast');
  await expect(toast).toContainText('Cleared 2 files');
  await toast.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(panel.getByText('Alpha', { exact: true })).toBeVisible();
  await expect(panel.getByText('1900 MHz')).toBeVisible();
  await expect(toast).toHaveCount(0);

  // Ctrl+Z, but not while typing in a text field.
  await page.getByLabel('Actions for b.msi').click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(toast).toContainText('Removed b.msi');
  await expect(panel.getByText('1900 MHz')).toHaveCount(0);
  await page.getByLabel('Mechanical tilt (°) value').focus();
  await page.keyboard.press('Control+z');
  await expect(panel.getByText('1900 MHz')).toHaveCount(0);
  await page.locator('h1').click();
  await page.keyboard.press('Control+z');
  await expect(panel.getByText('1900 MHz')).toBeVisible();
});

test('Delete group can be undone', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800))]);
  await page.getByLabel('Actions for a.msi').click();
  await page.getByRole('menuitem', { name: 'Create site…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
  const panel = page.locator('.panel');
  await expect(panel.getByText('Site 1', { exact: true })).toBeVisible();
  await page.getByLabel('Actions for group Site 1').click();
  await page.getByRole('menuitem', { name: 'Delete group' }).click();
  await expect(panel.getByText('Site 1', { exact: true })).toHaveCount(0);
  await page.getByTestId('undo-toast').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(panel.getByText('Site 1', { exact: true })).toBeVisible();
  await expect(panel.getByText('Sector A', { exact: true })).toBeVisible();
});

test('the page asks before unloading only while there is unsaved work', async ({ page }) => {
  await page.goto('/');
  // Dispatch the event ourselves: a real reload would raise a dialog and could hang the test.
  const prevented = () =>
    page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
  expect(await prevented()).toBe(false);
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800))]);
  await expect(page.locator('.panel')).toBeVisible();
  expect(await prevented()).toBe(true);

  await page.getByRole('button', { name: 'Save project' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await download;
  expect(await prevented()).toBe(false);
  await page.getByLabel('Actions for a.msi').click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  expect(await prevented()).toBe(true);
});

test('Reset offers sliders only or everything', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800))]);
  const mech = page.getByLabel('Mechanical tilt (°) value');
  await mech.fill('4');
  await mech.press('Enter');
  const offset = page.getByLabel('Azimuth offset (°) value');
  await offset.fill('20');
  await offset.press('Enter');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset sliders only' }).click();
  await expect(mech).toHaveValue('0');
  await expect(page.getByLabel('Offsets: az +20°')).toBeVisible();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset everything' }).click();
  await expect(page.getByLabel('Offsets: az +20°')).toHaveCount(0);
});
