import { expect, test, type Page } from '@playwright/test';

async function loadExample(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  // Tick everything.
  const groupBoxes = page.locator('.group header input[type="checkbox"]');
  for (let i = 0; i < (await groupBoxes.count()); i++) await groupBoxes.nth(i).check();
  await expect(page.locator('.metrics tbody tr')).toHaveCount(24);
}

test('the frequency chart plots any metric, defaults to the beamwidths and remembers the choice', async ({ page }) => {
  await loadExample(page);
  const chart = page.getByTestId('plot-hpbw');
  await expect(chart.locator('.y2title')).toHaveCount(1);
  await expect(chart.locator('.ytitle')).toContainText('H-HPBW');
  const select = page.getByLabel('Metric', { exact: true });
  await expect(select).toHaveValue('hHpbw');

  await select.selectOption({ label: 'F/B 180° (dB)' });
  await expect(chart.locator('.y2title')).toHaveCount(0);
  await expect(chart.locator('.ytitle')).toContainText('F/B 180° (dB)');
  expect(await chart.locator('.scatterlayer .trace .lines path').count()).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: /^F\/B 180° vs frequency/ })).toBeVisible();

  // A display preference: it is not unsaved work, and it is remembered.
  await page.waitForFunction(() => (localStorage.getItem('lobe-story:prefs:v1') ?? '').includes('fb180'));
});

test.describe('copy to the clipboard', () => {
  // The async Clipboard API needs a permission in the test browser; Firefox has no such permission, so this is Chromium only.
  test.skip(({ browserName }) => browserName !== 'chromium', 'clipboard permissions are Chromium only');
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  const clip = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
  const rowTexts = (page: Page, n: number) =>
    page.locator('.metrics tbody tr').nth(n).locator('td[data-col]').allInnerTexts();

  test('Copy table copies the visible columns in the current order, as the cells show them', async ({ page }) => {
    await loadExample(page);
    await page.getByRole('checkbox', { name: 'Show Sidelobes columns' }).uncheck();
    await page.getByRole('button', { name: /^F\/B 180°/ }).click();
    await page.getByRole('button', { name: /^F\/B 180°/ }).click(); // descending
    await page.getByRole('button', { name: 'Copy table' }).first().click();
    await expect(page.getByTestId('load-status')).toContainText('Copied 24 rows');
    const lines = (await clip(page)).trimEnd().split('\r\n');
    expect(lines).toHaveLength(25);
    const header = lines[0].split('\t');
    expect(header.slice(0, 5)).toEqual(['File', 'Group', 'MHz', 'Gain (dBd)', 'H-HPBW (°)']);
    expect(header).not.toContain('First USLS (dB)');
    expect(header).toContain('F/B 180° (dB)');
    expect(lines[1].split('\t').slice(4)).toEqual(await rowTexts(page, 0));
    expect(lines[24].split('\t').slice(4)).toEqual(await rowTexts(page, 23));
    const fb = header.indexOf('F/B 180° (dB)');
    expect(Number(lines[1].split('\t')[fb])).toBeGreaterThanOrEqual(Number(lines[24].split('\t')[fb]));
  });

  test('Copy row, and one value by mouse and by keyboard, without changing the highlight', async ({ page }) => {
    await loadExample(page);
    const row = page.locator('.metrics tbody tr').nth(2);
    const highlighted = page.locator('.metrics tbody tr.hl');
    const before = await highlighted.getAttribute('data-row-id');
    expect(before).not.toBeNull();
    await row.hover();
    await row.getByRole('button', { name: /^Copy row / }).click();
    await expect(page.getByTestId('load-status')).toContainText('Copied 1 row');
    expect((await clip(page)).split('\t').slice(4)).toEqual(await rowTexts(page, 2));
    expect(await highlighted.getAttribute('data-row-id')).toBe(before);

    // A click on the copy mark at the left edge of a cell copies that value and is not a click on the row.
    const cell = row.locator('td[data-col="fb180"]');
    const text = (await cell.innerText()).trim();
    // The first click on a cell is a click on its row (it focuses the cell and shows the mark).
    await cell.click({ position: { x: 40, y: 8 } });
    await expect(highlighted).toHaveAttribute('data-row-id', await row.getAttribute('data-row-id') ?? '');
    const box = (await cell.boundingBox())!;
    await page.mouse.click(box.x + 6, box.y + box.height / 2);
    await expect(page.getByTestId('load-status')).toContainText('Copied the value');
    expect(await clip(page)).toBe(text);
    // Not a second click on the row: the highlight is still there (a second row click would clear it).
    await expect(highlighted).toHaveAttribute('data-row-id', (await row.getAttribute('data-row-id')) ?? '');
    // Keyboard: the file name button, Right arrow into the cells, Ctrl+C copies the focused value.
    await row.locator('.file-cell').focus();
    await page.keyboard.press('ArrowRight');
    await expect(row.locator('td[data-col]').first()).toBeFocused();
    await page.keyboard.press('ArrowRight');
    const second = (await row.locator('td[data-col]').nth(1).innerText()).trim();
    await page.keyboard.press('Control+c');
    await expect.poll(() => clip(page)).toBe(second);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(row.locator('.file-cell')).toBeFocused();
    await page.keyboard.press('Control+c');
    await expect.poll(async () => (await clip(page)).split('\t').length).toBeGreaterThan(10);
  });

  test('band statistics Copy table, and file names are guarded against spreadsheet formulas', async ({ page }) => {
    await loadExample(page);
    await page.getByTestId('band-stats').getByRole('button', { name: 'Copy table' }).click();
    await expect(page.getByTestId('load-status')).toContainText('Copied the band statistics of');
    const lines = (await clip(page)).trimEnd().split('\r\n');
    expect(lines[0].startsWith('Parameter\t')).toBe(true);
    expect(lines.length).toBeGreaterThan(5);
    const rowCells = await page.getByTestId('band-stats').locator('tbody tr').first().locator('td').allInnerTexts();
    expect(lines[1].split('\t')[1]).toBe(rowCells[0].replace(/\s*n=\d+$/, '').trim());
  });

  test('a file named like a formula is copied with a leading quote', async ({ page }) => {
    await page.goto('/');
    const text = (await import('../src/test/planetText')).planetText({ headers: ['NAME A', 'FREQUENCY 1800', 'GAIN 15 dBd', 'TILT ELECTRICAL'] });
    await page.getByTestId('file-input').setInputFiles([{ name: '=SUM(1+1).msi', mimeType: 'text/plain', buffer: Buffer.from(text) }]);
    await expect(page.locator('.metrics tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: 'Copy table' }).first().click();
    await expect(page.getByTestId('load-status')).toContainText('Copied 1 row');
    expect((await clip(page)).split('\r\n')[1].split('\t')[0]).toBe("'=SUM(1+1).msi");
  });
});
