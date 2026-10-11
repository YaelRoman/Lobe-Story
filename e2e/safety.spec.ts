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
});
