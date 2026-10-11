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
