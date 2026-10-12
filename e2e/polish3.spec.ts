import { expect, test, type Page } from '@playwright/test';
import { openSimulation } from './simulationBar';

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

test('lines of the frequency chart that lie exactly on top of each other are named under it', async ({ page }) => {
  await loadExample(page);
  const menu = page.getByLabel('Metric', { exact: true });
  const group = page.locator('.group header input[type="checkbox"]');
  for (let i = 0; i < (await group.count()); i++) await group.nth(i).check();
  await menu.selectOption({ label: 'F/B 180° (dB)' });
  // The example's +45 and −45 groups are the same patterns: their lines coincide.
  const note = page.getByTestId('freq-coincide');
  await expect(note).toContainText('lines coincide:');
  await expect(note).toContainText(' = ');
  // With one ticked file only its own group is drawn: nothing to coincide with.
  await page.getByRole('button', { name: 'Show none', exact: true }).click();
  await page.locator('.panel li input[type="checkbox"]').first().check();
  await expect(note).toHaveCount(0);
});

test('the trace note says "dashed = original" only while a simulation draws originals', async ({ page }) => {
  await loadExample(page);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  const note = page.getByTestId('readout-h').locator('p.count');
  await expect(note).toContainText('24 traces: colours as in the file panel');
  await expect(note).not.toContainText('dashed = original');
  await openSimulation(page);
  await page.getByLabel('Mechanical tilt (°) value').fill('4');
  await page.getByLabel('Mechanical tilt (°) value').press('Enter');
  await expect(note).toContainText('(dashed = original)');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(note).not.toContainText('dashed = original');
  // A pinned reference is the thick dashed line.
  await page.getByLabel(/^Actions for /).first().click();
  await page.getByRole('menuitem', { name: 'Use as reference' }).click();
  await expect(note).toContainText('The thick dashed line in the text colour is the reference');
});
