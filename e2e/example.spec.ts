import { expect, test } from '@playwright/test';
import { planetText } from '../src/test/planetText';
import { collectFileChoosers } from './fileChooser';

const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const msi = (freq: number) => planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });

test('first run: Load example fills the plots, the table and the band statistics', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const empty = page.getByTestId('empty-state');
  await expect(empty).toContainText('Planet pattern files');
  await expect(empty).toContainText('never uploaded');
  await empty.getByRole('button', { name: 'Load example' }).click();

  await expect(page.getByTestId('load-status')).toContainText('Loaded the built-in synthetic example: 24 files (not a real antenna)');
  await expect(page.getByTestId('empty-state')).toHaveCount(0);
  await expect(page.locator('.panel li')).toHaveCount(24);
  await expect(page.locator('.panel li').first()).toContainText('example_');
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await expect(page.getByTestId('plot-h').locator('.main-svg').first()).toBeVisible();

  // Tick everything: the table and the HPBW chart have rows, tracking pairs are found, band statistics appear.
  const groupBoxes = page.locator('.group header input[type="checkbox"]');
  for (let i = 0; i < (await groupBoxes.count()); i++) await groupBoxes.nth(i).check();
  await expect(page.locator('.metrics tbody tr')).toHaveCount(24);
  await expect(page.getByTestId('band-stats').locator('table')).toBeVisible();
  await expect(page.getByTestId('band-stats-hint')).toHaveCount(0);
  const firstRow = page.locator('.metrics tbody tr').first();
  await expect(firstRow).not.toContainText('No opposite-polarization partner');
});

test('Help / glossary: keyboard accessible, Esc closes, focus comes back, links come from one constant', async ({ page }) => {
  await page.goto('/');
  const help = page.getByRole('button', { name: 'Help / glossary' });
  await help.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Help and glossary' });
  await expect(dialog).toBeVisible();
  for (const term of ['HPBW', 'Squint', 'Tilt', 'F/B', 'USLS', 'Null fill', 'Roll-off', 'SPR / AIR', 'P2P tracking', 'D/U aperture', 'Band statistics']) {
    await expect(dialog.getByText(term, { exact: true })).toBeVisible();
  }
  await expect(dialog.getByRole('link', { name: 'metric definitions' })).toHaveAttribute('href', 'https://github.com/YaelRoman/Lobe-Story/blob/main/docs/metrics.md');
  await expect(dialog.getByRole('link', { name: 'README' })).toHaveAttribute('href', 'https://github.com/YaelRoman/Lobe-Story#readme');
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('link', { name: 'metric definitions' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(help).toBeFocused();

  // The toolbar entry works too (also with files loaded) and the Close button closes it.
  const toolbarHelp = page.getByRole('banner').getByRole('button', { name: 'Help' });
  await toolbarHelp.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toolbarHelp).toBeFocused();
});

test('empty state: the three open actions are real buttons that use the toolbar inputs', async ({ page }) => {
  const nextChooser = collectFileChoosers(page);
  await page.goto('/');
  const empty = page.getByTestId('empty-state');
  for (const [name, input] of [['Open files', 'file-input'], ['Open folder', 'folder-input'], ['Open project', 'project-input']] as const) {
    await empty.getByRole('button', { name }).click();
    const chooser = await nextChooser();
    expect(chooser.isMultiple()).toBe(input !== 'project-input');
  }
  // Keyboard: focus the button, press Enter.
  const open = empty.getByRole('button', { name: 'Open files' });
  await open.focus();
  await page.keyboard.press('Enter');
  const chooser = await nextChooser();
  await chooser.setFiles([file('a.msi', msi(1800))]);
  await expect(page.locator('.panel li')).toHaveCount(1);
});

test('empty state: no Load example while a layout-only project waits for its pattern files', async ({ page }) => {
  await page.goto('/');
  const layoutOnly = JSON.stringify({
    format: 'lobe-story-project',
    version: 1,
    savedAt: '2026-01-01T00:00:00.000Z',
    files: [{ path: 'a.MSI' }],
    state: {},
  });
  await page.getByTestId('project-input').setInputFiles([file('p.lobestory.json', layoutOnly)]);
  await expect(page.getByTestId('pending-files')).toBeVisible();
  const empty = page.getByTestId('empty-state');
  await expect(empty).toBeVisible();
  await expect(empty.getByRole('button', { name: 'Load example' })).toHaveCount(0);
  await expect(empty.getByRole('button', { name: 'Open files' })).toBeVisible();
  await expect(empty).toContainText('Planet pattern files');
  await page.getByTestId('pending-files').getByRole('button', { name: 'Dismiss' }).click();
  await expect(empty.getByRole('button', { name: 'Load example' })).toBeVisible();
});

test('Definitions buttons in the metrics table and the band statistics open the glossary and get the focus back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await expect(page.locator('.metrics tbody tr').first()).toBeVisible();
  // Let the page settle after Load example: band statistics section shown and at least one Plotly plot rendered.
  await expect(page.getByTestId('load-status')).toBeVisible();
  await expect(page.getByTestId('band-stats')).toBeVisible();
  await expect(page.getByTestId('plot-h').locator('.main-svg').first()).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Help and glossary' });
  for (const section of [page.locator('section', { has: page.locator('table.metrics') }), page.getByTestId('band-stats')]) {
    const button = section.getByRole('button', { name: 'Definitions' });
    // The button is not remounted while the page settles (checked in a real browser), so this retry is only a guard:
    // the plots finish laying out right after Load example and a click can land while the page is still moving.
    await expect(async () => {
      await button.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
  }
  // Every column header of the table has a tooltip.
  const titles = await page.locator('table.metrics thead th').evaluateAll((ths) => ths.map((th) => th.getAttribute('title')));
  expect(titles.slice(4).every((t) => t && t.length > 0)).toBe(true);
});

test('Help dialog: a click in its padding does not close it, a click on the backdrop does', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Help / glossary' }).click();
  const dialog = page.getByRole('dialog', { name: 'Help and glossary' });
  const box = (await dialog.boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + 4);
  await expect(dialog).toBeVisible();
  await page.mouse.click(box.x - 20, box.y + 20);
  await expect(dialog).toHaveCount(0);
});

test('selection and labels: a panel click ticks and highlights, a second click or Esc clears; labels follow the beamwidth level', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);

  const item = page.locator('.panel li').nth(5);
  await expect(item.getByRole('checkbox')).not.toBeChecked();
  await item.locator('.row-main').click();
  await expect(item.getByRole('checkbox')).toBeChecked();
  await expect(item).toHaveClass(/hl/);
  await item.locator('.row-main').click();
  await expect(item).not.toHaveClass(/hl/);
  await expect(item.getByRole('checkbox')).toBeChecked();
  await item.locator('.row-main').click();
  await expect(item).toHaveClass(/hl/);
  await page.keyboard.press('Escape');
  await expect(item).not.toHaveClass(/hl/);

  // Esc belongs to an open menu first: the highlight stays.
  await item.locator('.row-main').click();
  await item.locator('summary').click();
  await page.keyboard.press('Escape');
  await expect(item).toHaveClass(/hl/);

  // A refused setting says why; the beamwidth level renames the beamwidth labels.
  await page.getByRole('button', { name: 'Settings' }).click();
  const level = page.getByLabel('Beamwidth level (dB)');
  await level.fill('-5');
  await level.press('Enter');
  await expect(page.getByRole('alert')).toContainText('from 0.5 to 20');
  await level.fill('10');
  await level.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('table.metrics thead th', { hasText: 'H-BW@10 dB (°)' })).toBeVisible();
  await expect(page.getByTestId('readout-h')).toContainText('BW@10 dB');
  await expect(page.locator('.marker-options')).toContainText('−10 dB / BW@10 dB');
});
