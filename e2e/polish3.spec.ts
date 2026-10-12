import { expect, test, type Page } from '@playwright/test';

async function loadExample(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li, .drawer li')).not.toHaveCount(0);
}

test('a metric no file has a value for says so in place of an empty chart', async ({ page }) => {
  await loadExample(page);
  const menu = page.getByLabel('Metric', { exact: true });
  await menu.selectOption({ label: 'H-SLS (dB)' });
  const note = page.getByTestId('freq-no-value');
  await expect(note).toContainText('No file has a value for H-SLS');
  await expect(page.getByTestId('plot-hpbw')).toHaveCount(0);
  // The heading and the menu stay; another metric brings the chart back.
  await menu.selectOption({ label: 'F/B 180° (dB)' });
  await expect(page.getByTestId('plot-hpbw')).toBeVisible();
  await expect(note).toHaveCount(0);
});
