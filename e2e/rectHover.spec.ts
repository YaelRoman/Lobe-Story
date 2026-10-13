import { expect, test } from '@playwright/test';

test('rectangular plot with many files: the hover names the nearest trace only, and no marker trace', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await page.getByRole('button', { name: 'Rectangular', exact: true }).click();
  const plot = page.getByTestId('plot-h');
  await expect(plot.locator('.scatterlayer .trace .lines path').first()).toBeVisible();
  const area = (await plot.locator('.nsewdrag').first().boundingBox())!;
  // Down the middle of the plot (boresight), from the top: the traces meet near 0 dB there.
  const x = area.x + area.width / 2;
  const labels = page.locator('.hoverlayer .hovertext');
  let seen = 0;
  for (let y = area.y + 2; y < area.y + area.height && seen === 0; y += 4) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(60);
    seen = await labels.count();
  }
  // One box for one trace: its angle, its level and its name. Not a list of every trace at that angle.
  expect(seen).toBe(1);
  await expect(labels.first()).toContainText(/°\s+-?\d+\.\d\d dB/);
  await expect(page.locator('.hoverlayer .legend')).toHaveCount(0);
});
