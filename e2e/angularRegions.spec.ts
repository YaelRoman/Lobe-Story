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
  // (The header names the 3D method as the exported one does: "[Sum.]" to read, "[Summation]" for a screen reader.)
  const headers = ['Sector eff. est. [Summation] (%)', 'Spatial eff. est. [Summation] (%)', 'Lower region est. [Summation] (%)'];
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
  await expect(page.getByRole('columnheader', { name: 'Sector eff. est. [Weighted] (%)' })).toHaveAttribute('title', /3D method: Weighted/);
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

test('Lower region est.: the frequency chart fits its axis to the small values, and a difference that is not zero does not read 0.000', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await page.getByLabel('Show Angular regions (est.) columns').check();
  await page.getByLabel('Metric', { exact: true }).selectOption({ label: 'Lower region est. (%)' });
  const chart = page.getByTestId('plot-hpbw');
  await expect(chart.locator('.ytitle')).toContainText('Lower region est. [Summation] (%)');

  // The table keeps three decimals; the values are a few ten-thousandths of a percent.
  const cells = page.locator('.metrics tbody td[data-col="areLower"]');
  const shown = (await cells.allTextContents()).map((t) => t.trim());
  expect(shown).toHaveLength(24);
  for (const t of shown) expect(t).toMatch(/^\d\.\d{3}$/);

  // The y axis runs over the values (not −2…+2 %), starts at zero or above, and writes its small numbers out.
  const range = await chart.evaluate((el) => {
    const plot = (el.matches('.js-plotly-plot') ? el : el.querySelector('.js-plotly-plot')) as unknown as { _fullLayout: { yaxis: { range: [number, number] } } };
    return plot._fullLayout.yaxis.range;
  });
  expect(range[0]).toBeGreaterThanOrEqual(0);
  expect(range[1]).toBeLessThan(0.01);
  expect(range[1] - range[0]).toBeGreaterThan(0);
  const ticks = await chart.locator('.ytick text').allTextContents();
  expect(ticks.length).toBeGreaterThan(1);
  for (const t of ticks) expect(t).toMatch(/^0(\.\d+)?$/);
  // Seven-character tick labels: the axis title stands to their left, not on them.
  const titleRight = await chart.locator('.ytitle').evaluate((t) => t.getBoundingClientRect().right);
  const labelsLeft = await chart.locator('.ytick text').evaluateAll((labels) => Math.min(...labels.map((l) => l.getBoundingClientRect().left)));
  expect(titleRight).toBeLessThanOrEqual(labelsLeft);
  // The lines no longer lie flat on one level: their points span a good part of the plot's height.
  const ys = await chart.locator('.scatterlayer .trace .points path').evaluateAll((points) => points.map((p) => p.getBoundingClientRect().y));
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(60);

  // Difference view: files that differ from the reference show a digit.
  await page.locator('.panel li').first().getByLabel(/^Actions for /).click();
  await page.getByRole('menuitem', { name: 'Use as reference' }).click();
  await page.getByLabel('Δ vs reference').check();
  await expect(page.getByTestId('reference-note')).toBeVisible();
  const deltas = (await cells.allTextContents()).map((t) => t.trim());
  // (The first row is the reference with its own value.)
  const others = deltas.slice(1);
  expect(others.some((t) => /^[+-]0\.0{3,}[1-9]/.test(t))).toBe(true);
  for (const t of others) expect(t).toMatch(/^(0\.000|[+-]0\.\d{3,7})$/);
});

test('the 3D method is named where it matters: a labelled control with the reason it is off, and a tag in the estimate headers', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  const fold = page.getByRole('button', { name: /Simulation/ });
  await fold.click();
  const bar = page.getByRole('group', { name: 'Simulation' });
  const method = page.getByRole('group', { name: '3D method' });
  const reason = page.getByTestId('sim-method-hint');

  // Nothing uses the method yet: the pair is greyed, with a visible name and the reason under it.
  await expect(bar.getByText('3D method', { exact: true })).toBeVisible();
  await expect(method.getByRole('button', { name: 'Weighted' })).toBeDisabled();
  await expect(reason).toBeVisible();
  await expect(reason).toHaveText('Used by the 3D view, a tilt, the horizon cut and the angular regions; none of them is on.');

  await page.getByLabel('Show Angular regions (est.) columns').check();
  await expect(method.getByRole('button', { name: 'Weighted' })).toBeEnabled();
  await expect(reason).toBeHidden();
  // Its place is kept: a control that becomes usable at the first step of a slider drag must not move the bar.
  await page.getByLabel('Show Angular regions (est.) columns').uncheck();
  await expect(reason).toBeVisible();
  for (const width of [1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const sliders = bar.getByRole('slider');
    // (Places inside the bar: the page itself may scroll.)
    const before = await sliders.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); const b = e.closest('.sim-bar')!.getBoundingClientRect(); return [r.x - b.x, r.y - b.y]; }));
    const mech = page.getByLabel('Mechanical tilt (°) value');
    await mech.fill('3');
    await mech.press('Enter');
    await expect(page.getByTestId('sim-badge')).toBeVisible();
    await expect(reason).toBeHidden();
    expect(await sliders.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); const b = e.closest('.sim-bar')!.getBoundingClientRect(); return [r.x - b.x, r.y - b.y]; }))).toEqual(before);
    await mech.fill('0');
    await mech.press('Enter');
    await expect(reason).toBeVisible();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel('Show Angular regions (est.) columns').check();

  // The headers: "[Sum.]" on screen, "[Summation]" in the accessible name, the exported header's words.
  const sector = page.locator('.metrics thead th', { hasText: 'Sector eff. est.' });
  await expect(sector.locator('.method-tag')).toHaveText('[Sum.]');
  await expect(sector.locator('.method-tag')).toBeVisible();
  for (const name of ['Sector eff. est. [Summation] (%)', 'Spatial eff. est. [Summation] (%)', 'Lower region est. [Summation] (%)']) {
    await expect(page.getByRole('columnheader', { name })).toHaveCount(1);
  }
  await expect(page.locator('.metrics thead .method-tag')).toHaveCount(3);
  await method.getByRole('button', { name: 'Weighted' }).click();
  await expect(sector.locator('.method-tag')).toHaveText('[Wtd.]');
  await expect(page.getByRole('columnheader', { name: 'Sector eff. est. [Weighted] (%)' })).toHaveCount(1);
  // The header still sorts.
  await sector.getByRole('button').click();
  await expect(sector).toHaveAttribute('aria-sort', 'ascending');
  await method.getByRole('button', { name: 'Summation' }).click();
});

test('the frequency chart image is named after the metric in words', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  const chart = page.getByTestId('plot-hpbw');
  const download = async () => {
    const pending = page.waitForEvent('download');
    await chart.getByRole('button', { name: 'Download plot as a png (with legend and values)' }).click();
    return (await pending).suggestedFilename();
  };
  const select = page.getByLabel('Metric', { exact: true });
  await select.selectOption({ label: 'Sector eff. est. (%)' });
  await expect(chart.locator('.ytitle')).toContainText('Sector eff. est.');
  expect(await download()).toBe('sector-efficiency-est-vs-frequency.png');
  await page.getByRole('button', { name: /Simulation/ }).click();
  await page.getByRole('group', { name: 'Horizontal cut' }).getByRole('button', { name: 'At the horizon' }).click();
  await select.selectOption({ label: 'Horizon level (dB)' });
  await expect(chart.locator('.ytitle')).toContainText('Horizon level');
  await expect(async () => expect(await download()).toBe('horizon-level-vs-frequency-simulated.png')).toPass();
});
