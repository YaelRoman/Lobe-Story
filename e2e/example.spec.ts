import { expect, test } from '@playwright/test';

test('first run: Load example fills the plots, the table and the band statistics', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const empty = page.getByTestId('empty-state');
  await expect(empty).toContainText('Planet pattern files');
  await expect(empty).toContainText('never uploaded');
  await empty.getByRole('button', { name: 'Load example' }).click();

  await expect(page.getByTestId('load-status')).toContainText('Loaded the built-in synthetic example (not a real antenna)');
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
