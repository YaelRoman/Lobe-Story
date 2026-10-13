import { expect, test } from '@playwright/test';
import { planetText, points } from '../src/test/planetText';

const file = (name: string, content: string | Buffer) => ({ name, mimeType: 'application/octet-stream', buffer: typeof content === 'string' ? Buffer.from(content) : content });
const good = (freq = 1800, eol = '\r\n') => planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'], eol });

test('a file that cannot be loaded is named with its cause: empty, UTF-16, decimal commas', async ({ page }) => {
  await page.goto('/');
  const comma = points((a) => Math.min(40, Math.abs(a) / 2)).map((l) => l.replace(/\./g, ','));
  await page.getByTestId('file-input').setInputFiles([
    file('empty.msi', ''),
    file('utf16.msi', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(good(), 'utf16le')])),
    file('comma.msi', planetText({ h: comma })),
  ]);
  const errors = page.getByTestId('panel-errors');
  const entry = (name: string) => errors.locator('li', { hasText: name });
  await expect(entry('empty.msi')).toContainText('The file is empty');
  await expect(entry('utf16.msi')).toContainText('The file looks like UTF-16 text: save it as UTF-8 (or ANSI) and open it again');
  await expect(entry('comma.msi')).toContainText('Non-numeric value in HORIZONTAL block: "0,0 0,00". Decimal commas are not read: write the values with points (0.5, not 0,5) (line 6)');
  await expect(page.getByTestId('load-status')).toContainText('3 could not be loaded');
});

test('lines that end in a carriage return alone are read, and a pattern under another name or none is taken by its content', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('cr-only.msi', good(1800, '\r')), file('other.dat', good(1900)), file('bare', good(2000)), file('photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))]);
  await expect(page.getByTestId('load-status')).toContainText('Loaded 3 files');
  await expect(page.locator('.panel li')).toHaveCount(3);
  await expect(page.getByTestId('panel-errors')).toHaveCount(0);
  const table = page.locator('.metrics tbody');
  for (const name of ['cr-only.msi', 'other.dat', 'bare']) await expect(table.locator('tr', { hasText: name })).toHaveCount(1);
  // The file with the bare carriage returns has the numbers of the same file with CR LF.
  const cells = (name: string) => table.locator('tr', { hasText: name }).locator('td[data-col]').allInnerTexts();
  expect((await cells('cr-only.msi')).slice(0, 6)).toEqual((await cells('other.dat')).slice(0, 6));
});

test('a file picked by itself that is no pattern: the line says what was looked for; one that only starts like a pattern says why it does not load', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))]);
  await expect(page.getByTestId('load-status')).toContainText('No pattern files found in the selection (.msi, .pln, .txt, or a Planet pattern under another name)');
  await page.getByTestId('file-input').setInputFiles([file('cut.dat', good().slice(0, 900))]);
  await expect(page.getByTestId('panel-errors').locator('li', { hasText: 'cut.dat' })).toContainText(/HORIZONTAL block declares 360 points but only \d+ found/);
});

test('the list of errors shows more than a handful at once and can be dismissed in one go, with an undo', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const bad = Array.from({ length: 9 }, (_, i) => file(`bad${i + 1}.msi`, i % 2 ? '' : 'meeting notes\n'));
  await page.getByTestId('file-input').setInputFiles([file('a.msi', good()), ...bad]);
  const errors = page.getByTestId('panel-errors');
  await expect(errors.locator('li')).toHaveCount(9);
  // All nine are on the screen without scrolling the list (it showed four in a box of 200 px).
  const list = (await errors.locator('.errors-list').boundingBox())!;
  const last = (await errors.locator('li').last().boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(list.y + list.height + 1);

  await errors.getByRole('button', { name: 'Dismiss all' }).click();
  await expect(errors).toHaveCount(0);
  await expect(page.locator('.panel li')).toHaveCount(1);
  await expect(page.getByTestId('undo-toast')).toContainText('Dismissed 9 files that could not be loaded');
  // The focus is not lost with the button: it is on the file panel.
  expect(await page.evaluate(() => document.activeElement?.closest('.panel') !== null)).toBe(true);
  await page.keyboard.press('Control+z');
  await expect(errors.locator('li')).toHaveCount(9);
  // One error alone needs no "Dismiss all": its own ✕ is there.
  for (let i = 0; i < 8; i++) await errors.getByRole('button', { name: /^Remove bad/ }).first().click();
  await expect(errors.locator('li')).toHaveCount(1);
  await expect(errors.getByRole('button', { name: 'Dismiss all' })).toHaveCount(0);
});
