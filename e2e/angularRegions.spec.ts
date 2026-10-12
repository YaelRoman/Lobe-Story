import { expect, test } from '@playwright/test';

test('Angular regions (est.): off by default; switched on, three plausible percent columns marked as estimates, plottable against frequency', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  const groupBoxes = page.locator('.group header input[type="checkbox"]');
  for (let i = 0; i < (await groupBoxes.count()); i++) await groupBoxes.nth(i).check();
  const rows = page.locator('.metrics tbody tr');
  await expect(rows).toHaveCount(24);

  const toggle = page.getByLabel('Show Angular regions (est.) columns');
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole('columnheader', { name: /est\./ })).toHaveCount(0);

  await toggle.check();
  const headers = ['Sector eff. est. (%)', 'Spatial eff. est. (%)', 'Lower region est. (%)'];
  for (const name of headers) {
    const th = page.getByRole('columnheader', { name });
    await expect(th).toBeVisible();
    await expect(th).toHaveAttribute('title', /estimate/i);
    await expect(th).toHaveAttribute('title', /not BASTA-compliant/);
  }

  const numbers = async (col: string) =>
    (await page.locator(`.metrics tbody td[data-col="${col}"]`).allTextContents()).map((t) => Number(t.trim()));
  const sector = await numbers('areSector');
  const spatial = await numbers('areSpatial');
  const lower = await numbers('areLower');
  expect(sector).toHaveLength(24);
  for (let i = 0; i < 24; i++) {
    for (const v of [sector[i], spatial[i], lower[i]]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(sector[i]).toBeGreaterThan(lower[i]);
    expect(spatial[i]).toBeGreaterThanOrEqual(sector[i]);
    // A 65° panel with an 8° elevation beam: most of the power is in the sector.
    expect(sector[i]).toBeGreaterThan(50);
  }

  // The 3D method changes the estimate, so its control (otherwise only for the 3D view and a tilt) is enabled.
  const fold = page.getByRole('button', { name: /Simulation/ });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  const weighted = page.getByRole('button', { name: 'Weighted' });
  await expect(weighted).toBeEnabled();
  await weighted.click();
  await expect(page.getByRole('columnheader', { name: headers[0] })).toHaveAttribute('title', /3D method: Weighted/);
  await expect.poll(async () => (await numbers('areSector'))[0]).toBeLessThan(sector[0]);
  await page.getByRole('button', { name: 'Summation' }).click();
  await expect.poll(async () => (await numbers('areSector'))[0]).toBe(sector[0]);

  // The frequency chart can plot one of them.
  const select = page.getByLabel('Metric', { exact: true });
  await select.selectOption({ label: 'Sector eff. est. (%)' });
  const chart = page.getByTestId('plot-hpbw');
  // The axis title names the 3D method, as the CSV header does: it travels with the number into the PNG.
  await expect(chart.locator('.ytitle')).toContainText('Sector eff. est. [Summation] (%)');
  expect(await chart.locator('.scatterlayer .trace .lines path').count()).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: /^Sector eff\. est\. vs frequency/ })).toBeVisible();

  // Hidden again, the chart still has its values (they are computed while the chart plots them).
  await toggle.uncheck();
  await expect(page.getByRole('columnheader', { name: /est\./ })).toHaveCount(0);
  await expect(page.getByTestId('freq-no-value')).toHaveCount(0);
  expect(await chart.locator('.scatterlayer .trace .lines path').count()).toBeGreaterThan(0);
});

test('the 3D method travels with the angular-region estimate: collapsed Simulation summary, copied table and CSV headers', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await expect(page.locator('.metrics tbody tr').first()).toBeVisible();

  const fold = page.getByRole('button', { name: /Simulation/ });
  if ((await fold.getAttribute('aria-expanded')) === 'true') await fold.click();
  const summary = page.getByTestId('sim-summary');
  // No tilt, no estimate on screen: the method changes nothing, so the summary does not name it.
  await expect(summary).toBeVisible();
  await expect(summary).not.toContainText('3D method');

  const toggle = page.getByLabel('Show Angular regions (est.) columns');
  // The one group that is exported only while shown says so where it is switched on.
  await expect(toggle.locator('xpath=..')).toHaveAttribute('title', /exported to CSV only while/);
  await toggle.check();
  await expect(summary).toContainText('3D method: Summation');

  await page.getByTitle(/^Copy the table as shown \(visible columns/).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Sector eff. est. [Summation] (%)\tSpatial eff. est. [Summation] (%)\tLower region est. [Summation] (%)');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk.toString();
  expect(csv.split('\r\n')[0]).toContain(',Sector eff. est. [Summation] (%),Spatial eff. est. [Summation] (%),Lower region est. [Summation] (%)');

  await toggle.uncheck();
  await expect(summary).not.toContainText('3D method');
});
