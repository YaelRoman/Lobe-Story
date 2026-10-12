import { expect, test, type Page } from '@playwright/test';
import { openSimulation } from './simulationBar';

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

  // A display preference, and it is remembered (that it is not unsaved work is covered in state.test.ts).
  await page.waitForFunction(() => (localStorage.getItem('lobe-story:prefs:v1') ?? '').includes('fb180'));
});

test('Ticked files only limits the table and the CSV to the ticked files and keeps the reference row', async ({ page }) => {
  await loadExample(page);
  const rows = page.locator('.metrics tbody tr');
  const toggle = page.getByLabel('Ticked files only');
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId('table-count')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show none', exact: true }).click();
  const boxes = page.locator('.panel li input[type="checkbox"]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await expect(rows).toHaveCount(24);
  await toggle.check();
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('table-count')).toHaveText('2 of 24 files');
  // The pinned reference stays although it is not ticked.
  await page.locator('.panel li').nth(5).getByLabel(/^Actions for /).click();
  await page.getByRole('menuitem', { name: 'Use as reference' }).click();
  await expect(rows).toHaveCount(3);
  await expect(page.locator('.metrics tbody tr.ref')).toHaveCount(1);
  await expect(page.getByTestId('table-count')).toHaveText('3 of 24 files');
  // Export CSV follows the listed rows.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const text = (await (await download).createReadStream().then(async (stream) => {
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks).toString('utf8');
  }));
  expect(text.trim().split(/\r?\n/)).toHaveLength(4);
  // Space on a row's file name unticks it: the row goes and the focus moves to the next row.
  const first = rows.nth(0).locator('.file-cell');
  const firstName = (await first.innerText()).trim();
  await first.focus();
  await page.keyboard.press('Space');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('.metrics tbody [data-nav]:focus')).toHaveCount(1);
  await expect(page.locator('.metrics tbody tr', { hasText: firstName })).toHaveCount(0);
  // The choice is a preference: remembered in the browser, never in a project.
  await page.waitForFunction(() => (localStorage.getItem('lobe-story:prefs:v1') ?? '').includes('tableTickedOnly'));
  await toggle.uncheck();
  await expect(rows).toHaveCount(24);
});

test.describe('copy to the clipboard', () => {
  // The async Clipboard API needs a permission in the test browser; Firefox has no such permission, so this is Chromium only.
  test.skip(({ browserName }) => browserName !== 'chromium', 'clipboard permissions are Chromium only');
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  const clip = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
  const rowTexts = (page: Page, n: number) =>
    page.locator('.metrics tbody tr').nth(n).locator('td[data-col]').allInnerTexts();

  test('the copy note is a floating toast: the page does not move, and the next status line replaces it', async ({ page }) => {
    await loadExample(page);
    const top = () => page.locator('.body').evaluate((el) => el.getBoundingClientRect().top);
    const before = await top();
    await page.getByRole('button', { name: 'Copy table' }).first().click();
    const note = page.getByTestId('copy-note');
    await expect(note).toContainText('Copied 24 rows');
    expect(await top()).toBe(before);
    await page.getByRole('button', { name: 'Show none', exact: true }).click();
    await expect(page.getByTestId('undo-toast')).toBeVisible();
    await expect(note).toHaveCount(0);
    expect(await top()).toBeGreaterThanOrEqual(before);
  });

  test('Copy table copies the visible columns in the current order, as the cells show them', async ({ page }) => {
    await loadExample(page);
    await page.getByRole('checkbox', { name: 'Show Sidelobes columns' }).uncheck();
    await page.getByRole('button', { name: /^F\/B 180°/ }).click();
    await page.getByRole('button', { name: /^F\/B 180°/ }).click(); // descending
    await page.getByRole('button', { name: 'Copy table' }).first().click();
    await expect(page.getByTestId('copy-note')).toContainText('Copied 24 rows');
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
    const rowName = (await row.locator('.file-cell').innerText()).trim();
    await expect(page.getByTestId('copy-note')).toContainText(`Copied row ${rowName}`);
    expect((await clip(page)).split('\t').slice(4)).toEqual(await rowTexts(page, 2));
    expect(await highlighted.getAttribute('data-row-id')).toBe(before);

    // One value by mouse: the first click on a cell is a click on its row and shows the one Copy value button in it.
    const cell = row.locator('td[data-col="fb180"]');
    const text = (await cell.innerText()).trim();
    await expect(page.locator('.copy-cell')).toHaveCount(0);
    await cell.click({ position: { x: 40, y: 8 } });
    await expect(highlighted).toHaveAttribute('data-row-id', (await row.getAttribute('data-row-id')) ?? '');
    const button = page.locator('.copy-cell');
    await expect(button).toHaveCount(1);
    await expect(button).toHaveAccessibleName(`Copy value ${text}`);
    await button.click();
    await expect(page.getByTestId('copy-note')).toContainText(`Copied ${text}`);
    expect(await clip(page)).toBe(text);
    // The button is not a click on the row: the highlight is still there. Copying again says so again (the line is re-shown).
    await expect(highlighted).toHaveAttribute('data-row-id', (await row.getAttribute('data-row-id')) ?? '');
    await cell.focus();
    await button.click();
    await expect(page.getByTestId('copy-note')).toContainText(`Copied ${text}`);
    // A second click on the cell itself is an ordinary row click: it clears the highlight.
    await cell.click({ position: { x: 40, y: 8 } });
    await expect(highlighted).toHaveCount(0);
    // By keyboard: Tab from the focused cell reaches the button, Enter on it copies.
    await cell.focus();
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
    expect(await clip(page)).toBe('sentinel');
    await page.keyboard.press('Enter');
    await expect.poll(() => clip(page)).toBe(text);
    // Arrows and Ctrl+C work from the button too, as on its cell.
    await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
    await page.keyboard.press('Control+c');
    await expect.poll(() => clip(page)).toBe(text);
    await page.keyboard.press('ArrowLeft');
    await expect(cell.locator('xpath=preceding-sibling::td[1]')).toBeFocused();
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
    await expect(page.getByTestId('copy-note')).toContainText('Copied the band statistics of');
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
    await expect(page.getByTestId('copy-note')).toContainText('Copied 1 row');
    expect((await clip(page)).split('\r\n')[1].split('\t')[0]).toBe("'=SUM(1+1).msi");
  });
});

test.describe('reference file', () => {
  const menuOf = (page: Page, n: number) => page.locator('.panel li').nth(n);

  test('a pinned reference is drawn alone when no file is ticked, and the empty hint is gone', async ({ page }) => {
    await loadExample(page);
    await menuOf(page, 2).getByLabel(/^Actions for /).click();
    await page.getByRole('menuitem', { name: 'Use as reference' }).click();
    await page.getByRole('button', { name: 'Show none', exact: true }).click();
    await expect(page.locator('.panel li input[type="checkbox"]:checked')).toHaveCount(0);
    await expect(page.getByText('Tick files in the left panel to plot them.')).toHaveCount(0);
    await expect(page.getByTestId('plot-h')).toContainText('(reference)');
    await expect(page.getByTestId('plot-h').locator('path.js-line[style*="stroke-width: 3.5"]').first()).toBeVisible();
  });

  test('under a simulation the difference view says it compares tilted values and the reference row has one number per cell', async ({ page }) => {
    await loadExample(page);
    await menuOf(page, 2).getByLabel(/^Actions for /).click();
    await page.getByRole('menuitem', { name: 'Use as reference' }).click();
    await expect(page.getByTestId('delta-tilted-note')).toHaveCount(0);
    await page.getByLabel('Δ vs reference').check();
    await openSimulation(page);
    await page.getByLabel('Electrical tilt Δ (°) value').fill('3');
    await page.getByLabel('Electrical tilt Δ (°) value').press('Enter');
    await expect(page.getByTestId('delta-tilted-note')).toHaveText(/Δ of tilted values/);
    const cells = await page.locator('.metrics tbody tr.ref td[data-col]').allInnerTexts();
    expect(cells.length).toBeGreaterThan(5);
    for (const c of cells) expect(c).not.toContain('→');
  });

  test('pin a reference, show the differences, see it in the plots, save and reopen the project', async ({ page }, testInfo) => {
    await loadExample(page);
    // Pin the third file of the panel from its ⋯ menu.
    const row = menuOf(page, 2);
    const name = (await page.locator('.metrics tbody tr').nth(2).locator('.file-cell').innerText()).trim();
    await row.getByLabel(/^Actions for /).click();
    await page.getByRole('menuitem', { name: 'Use as reference' }).click();
    await expect(row.getByRole('img', { name: 'Reference file' })).toBeVisible();
    const refRow = page.locator('.metrics tbody tr.ref');
    await expect(refRow).toHaveCount(1);
    await expect(refRow.getByRole('img', { name: 'Reference file' })).toBeVisible();
    await expect(page.getByTestId('reference-note')).toContainText(name);

    // The reference trace is in both cut plots, labelled.
    // (24 files: no legend, the note under the plot says which line it is, and the trace is drawn thick and dashed.)
    for (const cut of ['h', 'v']) await expect(page.getByTestId(`readout-${cut}`)).toContainText('thick dashed line');
    await expect(page.getByTestId('readout-h')).toContainText('(reference)');
    await expect(page.getByTestId('plot-h').locator('path.js-line[style*="stroke-width: 3.5"]')).toHaveCount(1);

    // Δ vs reference: a known cell. Another file's cell is a signed difference; the reference row keeps its absolute value.
    const cell = (tr: ReturnType<typeof page.locator>, col: string) => tr.locator(`td[data-col="${col}"]`).innerText();
    const firstOther = page.locator('.metrics tbody tr:not(.ref)').first();
    const absolute = await cell(firstOther, 'fb180');
    const refAbsolute = await cell(refRow, 'fb180');
    await page.getByLabel('Δ vs reference').check();
    const diff = await cell(firstOther, 'fb180');
    // The reference row is pinned first in the difference view.
    await expect(page.locator('.metrics tbody tr').first()).toHaveClass(/\bref\b/);
    await expect(refRow.locator('.ref-tag')).toHaveText('reference');
    expect(diff).toMatch(/^[+-]?\d+\.\d$|^0\.0$/);
    // Three values each rounded to one decimal: the difference can be off by 0.15 at most.
    expect(Math.abs(Number(diff) - (Number(absolute) - Number(refAbsolute)))).toBeLessThanOrEqual(0.15 + 1e-9);
    expect(await cell(refRow, 'fb180')).toBe(refAbsolute);
    await expect(page.getByRole('columnheader', { name: /^Δ F\/B 180°/ })).toBeVisible();
    // Another file's difference carries a sign (the example files differ from each other in F/B).
    const signs = await page.locator('.metrics tbody tr:not(.ref) td[data-col="fb180"]').allInnerTexts();
    expect(signs.some((t) => /^[+-]\d/.test(t.trim()))).toBe(true);

    // Copy follows what is displayed.
    if (testInfo.project.name === 'chromium') {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.getByRole('button', { name: 'Copy table' }).first().click();
      await expect(page.getByTestId('copy-note')).toContainText('Copied 24 rows');
      const text = await page.evaluate(() => navigator.clipboard.readText());
      expect(text.split('\r\n')[0]).toContain(`F/B 180° Δ vs ${name} (dB)`);
      expect(text.split('\r\n')[0].split('\t').slice(0, 3)).toEqual(['File', 'Group', 'Row']);
      expect(text.split('\r\n')[1].split('\t')[2]).toBe('reference');
    }

    // The frequency chart marks the reference.
    await expect(page.getByTestId('plot-hpbw').locator('.legend').first()).toContainText('(reference)');
    await expect(page.getByRole('heading', { name: /diamond = reference/ })).toBeVisible();

    // Save the project, clear, open it again: the reference is still pinned, and the difference view too.
    await page.getByRole('button', { name: 'Save project' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    const file = await (await downloadPromise).path();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.getByText('Open or drop Planet pattern files')).toBeVisible();
    await page.getByTestId('project-input').setInputFiles(file);
    await expect(page.locator('.panel li')).toHaveCount(24);
    await expect(page.locator('.metrics tbody tr.ref')).toHaveCount(1);
    await expect(page.getByTestId('reference-note')).toContainText(name);
    await expect(page.getByLabel('Δ vs reference')).toBeChecked();

    // Clear the reference from the menu: the marks and the difference view go.
    await menuOf(page, 2).getByLabel(/^Actions for /).click();
    await page.getByRole('menuitem', { name: 'Clear reference' }).click();
    await expect(page.locator('.metrics tbody tr.ref')).toHaveCount(0);
    await expect(page.getByLabel('Δ vs reference')).toBeDisabled();
    await expect(page.getByLabel('Δ vs reference')).not.toBeChecked();
  });
});

test('Ticked files only says when the highlighted file is unticked and its row is hidden', async ({ page }) => {
  await loadExample(page);
  const rows = page.locator('.metrics tbody tr');
  await page.getByRole('button', { name: 'Show none', exact: true }).click();
  const boxes = page.locator('.panel li input[type="checkbox"]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByLabel('Ticked files only').check();
  const count = page.getByTestId('table-count');
  await expect(count).toHaveAttribute('role', 'status');
  await page.locator('.panel li').nth(1).locator('.row-main').click();
  await expect(page.locator('.metrics tbody tr.hl')).toHaveCount(1);
  await expect(count).toHaveText('2 of 24 files');
  await boxes.nth(1).uncheck();
  await expect(rows).toHaveCount(1);
  await expect(count).toHaveText(/^1 of 24 files · the highlighted file is not ticked, so its row is hidden$/);
  await boxes.nth(1).check();
  await expect(count).toHaveText('2 of 24 files');
});

test('an unticked reference is still drawn, with a legend entry saying so, and the file menu is keyboard operable', async ({ page }) => {
  await page.goto('/');
  const { planetText } = await import('../src/test/planetText');
  const msi = (f: number) => planetText({ headers: ['NAME A', `FREQUENCY ${f}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });
  await page.getByTestId('file-input').setInputFiles([
    { name: 'one.msi', mimeType: 'text/plain', buffer: Buffer.from(msi(1800)) },
    { name: 'two.msi', mimeType: 'text/plain', buffer: Buffer.from(msi(1900)) },
  ]);
  await expect(page.locator('.panel li')).toHaveCount(2);
  // Keyboard: focus the menu trigger of the first file, open it with Enter and pick the first reference item.
  await page.getByLabel('Actions for one.msi').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Use as reference' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.panel li').first().getByRole('img', { name: 'Reference file' })).toBeVisible();
  // Untick the reference and tick the other: the reference is still in the plot and the legend.
  await page.getByRole('checkbox', { name: 'Show one.msi' }).uncheck();
  await page.getByRole('checkbox', { name: 'Show two.msi' }).check();
  await expect(page.getByTestId('plot-h').locator('.legend')).toContainText('one.msi (reference)');
  await expect(page.getByTestId('plot-h').locator('.legend')).toContainText('two.msi');
});

test.describe('copy value on a phone', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'clipboard permissions are Chromium only');
  test.use({ permissions: ['clipboard-read', 'clipboard-write'], hasTouch: true, viewport: { width: 390, height: 844 } });

  test('the pill is fixed in the viewport, at least 40 px high, clear of the focused cell, and copies without changing the highlight', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Load example' }).click();
    await expect(page.locator('.metrics tbody tr').first()).toBeVisible();
    const rows = page.locator('.metrics tbody tr');
    const pill = page.locator('.copy-cell');
    await expect(pill).toHaveCount(0);
    // A row that is not the highlighted one, and the last row.
    for (const index of [1, (await rows.count()) - 1]) {
      const cell = rows.nth(index).locator('td[data-col="fb180"]');
      await cell.scrollIntoViewIfNeeded();
      const text = (await cell.innerText()).trim();
      const cellBefore = await cell.boundingBox();
      await cell.tap();
      await expect(pill).toHaveCount(1);
      await expect(pill).toHaveAccessibleName(`Copy value ${text}`);
      await expect(pill).toContainText(`Copy ${text}`);
      const box = (await pill.boundingBox())!;
      const view = page.viewportSize()!;
      expect(box.height).toBeGreaterThanOrEqual(40);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(view.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(view.height);
      const cellBox = (await rows.nth(index).locator('td[data-col="fb180"]').boundingBox())!;
      const apart = box.y + box.height <= cellBox.y || box.y >= cellBox.y + cellBox.height || box.x + box.width <= cellBox.x || box.x >= cellBox.x + cellBox.width;
      expect(apart).toBe(true);
      // Focusing a cell moves no column or row (only the page may scroll it into view).
      expect(cellBox.width).toBe(cellBefore!.width);
      expect(cellBox.height).toBe(cellBefore!.height);
      await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
      const highlight = await page.locator('.metrics tbody tr.hl').getAttribute('data-row-id');
      await pill.tap();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text);
      // The tap on the pill is not a click on the row: the highlight stays, and so does the pill.
      expect(await page.locator('.metrics tbody tr.hl').getAttribute('data-row-id')).toBe(highlight);
      await expect(pill).toHaveCount(1);
    }
  });
});
