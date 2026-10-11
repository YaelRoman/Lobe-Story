import { expect, test } from '@playwright/test';
import { planetText, points } from '../src/test/planetText';

const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const msi = (freq: number) =>
  planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });

test('loads files, plots them and fills the metrics table', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Open or drop Planet pattern files')).toBeVisible();

  await page.getByTestId('file-input').setInputFiles([
    file('_1800_X_CO_P45_08T_Y2.MSI', msi(1800)),
    file('_1900_X_CO_P45_08T_Y2.MSI', msi(1900)),
    file('broken.pln', 'NAME X\nFREQUENCY 900\n'),
  ]);

  await expect(page.getByText('+45 · 8°T · Y2', { exact: true }).first()).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByText('Missing HORIZONTAL block')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^SPR/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^H-BW 10 dB/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^Peak tilt/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^D\/U 256QAM/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^First USLS/ })).toBeVisible();
  await expect(page.getByTestId('band-stats-hint')).toContainText('Largest set loaded: 2.');
  await expect(page.getByTestId('band-stats').locator('table')).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: /^USLS peak to 20°/ })).toBeVisible();
  const declared = page.getByRole('checkbox', { name: 'Show Declared Δ columns' });
  await expect(declared).not.toBeChecked();
  await expect(page.getByRole('columnheader', { name: /^ΔH-HPBW/ })).toHaveCount(0);
  await declared.check();
  await expect(page.getByRole('columnheader', { name: /^ΔH-HPBW/ })).toBeVisible();
  const sectorCols = page.getByRole('checkbox', { name: 'Show Sector columns' });
  await sectorCols.uncheck();
  await expect(page.getByRole('columnheader', { name: /^SPR/ })).toHaveCount(0);
  await sectorCols.check();
  await expect(page.getByRole('columnheader', { name: /^SPR/ })).toBeVisible();

  await expect(page.getByTestId('plot-h').locator('.main-svg').first()).toBeVisible();
  await expect(page.getByTestId('plot-v').locator('.main-svg').first()).toBeVisible();
  await expect(page.getByTestId('plot-hpbw').locator('.main-svg').first()).toBeVisible();
  await expect(page.getByText('Horizontal cut — HPBW 65.0°')).toBeVisible();

  await page.getByRole('checkbox', { name: 'Sector', exact: true }).check();
  await expect(page.getByTestId('plot-h').locator('.main-svg').first()).toBeVisible();
  await expect(page.getByTestId('plot-h').getByText(/error/i)).toHaveCount(0);

  await page.getByRole('checkbox', { name: 'Sidelobes', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Null fill', exact: true }).check();
  for (const id of ['plot-v', 'plot-h']) {
    await expect(page.getByTestId(id).locator('.main-svg').first()).toBeVisible();
    await expect(page.getByTestId(id).getByText(/error/i)).toHaveCount(0);
  }

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Analysis settings' });
  await expect(settings.getByText('USLS window (°)')).toBeVisible();
  await expect(settings.getByText('Null search range (°)')).toHaveCount(0);
  await expect(settings.getByText('First-lobe limit (× V-HPBW)')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  await page.getByRole('button', { name: 'Rectangular' }).click();
  await expect(page.getByText('Angle (°)').first()).toBeVisible();

  await page.getByRole('checkbox', { name: 'Show all in +45 · 8°T · Y2' }).check();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const plot3d = page.getByTestId('plot-3d');
  // Plotly puts every gl3d scene inside one shared `.gl-container`, one `div[id^="scene"]`
  // child per scene (ids "scene", "scene2", ...), so the scene divs — not `.gl-container`
  // itself — are what counts side-by-side (2) vs. overlay (1) scenes.
  await expect(plot3d.locator('.gl-container > div[id^="scene"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Overlay' }).click();
  await expect(plot3d.locator('.gl-container > div[id^="scene"]')).toHaveCount(1);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(page.getByTestId('plot-h')).toBeVisible();

  await expect(page.getByTestId('sim-badge')).toHaveCount(0);
  const mech = page.getByLabel('Mechanical tilt (°) value');
  await mech.fill('4');
  await mech.press('Enter');
  await expect(page.getByTestId('sim-badge')).toBeVisible();
  await expect(page.getByText('Simulated: Δe 0°, mech +4°')).toBeVisible();
  await expect(page.locator('tbody tr').first()).toContainText('→');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByTestId('sim-badge')).toHaveCount(0);
  await expect(page.locator('tbody tr').first()).not.toContainText('→');

  const mechOffset = page.getByLabel('Mechanical tilt offset (°) value');
  await mechOffset.fill('3');
  await mechOffset.press('Enter');
  await expect(page.getByLabel('Offsets: mech +3°')).toBeVisible();
  await expect(page.getByTestId('sim-badge')).toBeVisible();
  await expect(page.getByText('Simulated: Δe 0°, mech 0° + offsets on 1 file')).toBeVisible();
  await expect(page.locator('tbody tr').nth(0)).toContainText('→');
  await expect(page.locator('tbody tr').nth(1)).not.toContainText('→');
  await page.getByRole('button', { name: 'Clear offsets' }).click();
  await expect(page.getByLabel('Offsets: mech +3°')).toHaveCount(0);
  await expect(page.getByTestId('sim-badge')).toHaveCount(0);
  await expect(page.locator('tbody tr').nth(0)).not.toContainText('→');
});

test('computes band statistics over a sub-band', async ({ page }) => {
  await page.goto('/');
  const text = (f: number) => planetText({ headers: ['NAME A', `FREQUENCY ${f}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });
  const files = [1800, 1820, 1840, 1860, 1880].flatMap((f) =>
    ['P45', 'M45'].map((pol) => file(`_${f}_X_CO_${pol}_08T_Y2.MSI`, text(f))),
  );
  await page.getByTestId('file-input').setInputFiles(files);

  const band = page.getByTestId('band-stats');
  const row = (name: RegExp) => band.getByRole('row', { name });
  const header = (name: RegExp) => band.getByRole('columnheader', { name });
  await expect(header(/^1800–1880 MHz/)).toBeVisible();
  await expect(row(/^Azimuth beamwidth/)).toContainText('65.0° ± 0.0°');
  await expect(row(/^Azimuth beamwidth/)).toContainText('n=10');
  await expect(row(/^Gain, all tilts/)).toContainText('15.0 dBd ± 0.0 dB');
  await expect(row(/^P2P tracking/)).toContainText('< 0.0 dB');
  await expect(row(/^P2P tracking/)).toContainText('n=10');
  await expect(row(/^Downtilt deviation/)).toContainText('< 0.0°');
  await expect(row(/^Electrical tilt range/)).toContainText('8°');
  await expect(band.getByTestId('band-adjusted-legend')).toHaveCount(0);
  await expect(band).not.toContainText('*');

  await band.getByRole('button', { name: 'Sub-bands' }).click();
  await band.getByRole('button', { name: 'Start from automatic' }).click();
  const max = band.getByLabel('Sub-band 1 max (MHz)');
  await max.fill('1840');
  await max.press('Enter');
  await expect(header(/^1800–1840 MHz/)).toBeVisible();
  await expect(row(/^Azimuth beamwidth/)).toContainText('n=6');
  await expect(row(/^Azimuth beamwidth/)).toContainText('65.0°');
  await expect(row(/^Azimuth beamwidth/)).not.toContainText('±');
  await band.getByRole('button', { name: 'Use automatic' }).click();
  await expect(header(/^1800–1880 MHz/)).toBeVisible();

  await band.getByLabel('Add a common sub-band').selectOption({ label: '880–960 MHz' });
  await expect(header(/^880–960 MHz/)).toContainText('0 files');
  await expect(row(/^Azimuth beamwidth/)).toContainText('—');
  await band.getByRole('button', { name: 'Use automatic' }).click();

  const azimuthCell = row(/^Azimuth beamwidth/).getByRole('cell').first();
  await azimuthCell.click();
  await expect(page.getByTestId('plot-band').locator('.main-svg').first()).toBeVisible();
  await expect(band.getByText(/Azimuth beamwidth — 1800–1880 MHz — N = 10/)).toBeVisible();
  await expect(band.getByTestId('band-detail')).toContainText('Double-sided (BASTA 12.4.2)');
  await azimuthCell.click();
  await expect(page.getByTestId('plot-band')).toHaveCount(0);
  await expect(band.getByTestId('band-detail')).toHaveCount(0);
  await azimuthCell.focus();
  await azimuthCell.press('Enter');
  await expect(page.getByTestId('plot-band')).toBeVisible();
  await azimuthCell.press(' ');
  await expect(page.getByTestId('plot-band')).toHaveCount(0);
  await expect(band.getByRole('table', { name: 'Band statistics for Array Y2' })).toBeVisible();

  const download = page.waitForEvent('download');
  await band.getByRole('button', { name: 'Export band CSV' }).click();
  expect((await download).suggestedFilename()).toBe('band-statistics.csv');
  await expect(band.getByText(/error/i)).toHaveCount(0);
});

test('marks band values changed by the 3 dB excursion rule', async ({ page }) => {
  await page.goto('/');
  const files = [1800, 1820, 1840, 1860, 1880].flatMap((f, i) =>
    ['P45', 'M45'].map((pol, j) => {
      // One file with a weak back lobe (25 dB instead of 40 dB) pulls the F/B minimum down.
      const weak = i === 0 && j === 0;
      const h = points((a) => Math.min(weak ? 25 : 40, 3 * (a / 32.5) ** 2));
      return file(`_${f}_X_CO_${pol}_08T_Y2.MSI`, planetText({ headers: ['NAME A', `FREQUENCY ${f}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'], h }));
    }),
  );
  await page.getByTestId('file-input').setInputFiles(files);
  const band = page.getByTestId('band-stats');
  const row = (name: RegExp) => band.getByRole('row', { name });
  await expect(row(/^F\/B/)).toContainText('> 28.0 dB*');
  await expect(row(/^Null fill/)).not.toContainText('*');
  await expect(band.getByTestId('band-adjusted-legend')).toHaveText('* adjusted by the 3 dB excursion rule (BASTA 12.2)');
});

test('builds a three-sector site from one pattern', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('_1800_X_CO_P45_08T_Y2.MSI', msi(1800))]);
  const panel = page.locator('.panel');

  await page.getByLabel('Actions for _1800_X_CO_P45_08T_Y2.MSI').click();
  await page.getByRole('menuitem', { name: 'Create site…' }).click();
  const sectors = page.getByRole('dialog');
  await sectors.getByRole('textbox').fill('3');
  await sectors.getByRole('button', { name: 'OK' }).click();

  await expect(panel.getByText('Site 1', { exact: true })).toBeVisible();
  for (const s of ['Sector A', 'Sector B', 'Sector C']) await expect(panel.getByText(s, { exact: true })).toBeVisible();
  const plot3d = page.getByTestId('plot-3d');
  await expect(plot3d.locator('.gl-container > div[id^="scene"]')).toHaveCount(1);
  await expect(plot3d.locator('.legend .traces')).toHaveCount(3);

  await panel.getByText('Site 1', { exact: true }).click();
  await expect(page.getByText('Offsets for group Site 1')).toBeVisible();
  const az = page.getByLabel('Azimuth offset (°) value');
  await az.fill('30');
  await az.press('Enter');
  await expect(page.getByLabel('Group offsets: az +30°')).toBeVisible();

  await page.getByLabel('Actions for Sector A').click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  const nameBox = page.getByLabel('Name for Sector A');
  await nameBox.fill('North');
  await nameBox.press('Enter');
  await expect(page.locator('tbody')).toContainText('North');
});

test('saves a project and opens it again', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('_1800_X_CO_P45_08T_Y2.MSI', msi(1800))]);
  const panel = page.locator('.panel');

  await page.getByLabel('Actions for _1800_X_CO_P45_08T_Y2.MSI').click();
  await page.getByRole('menuitem', { name: 'Create site…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
  await expect(panel.getByText('Site 1', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Save project' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^lobe-story-\d{4}-\d{2}-\d{2}\.lobestory\.json$/);
  const projectPath = await download.path();

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByText('Open or drop Planet pattern files')).toBeVisible();

  await page.getByTestId('project-input').setInputFiles(projectPath);
  await expect(panel.getByText('Site 1', { exact: true })).toBeVisible();
  for (const s of ['Sector A', 'Sector B', 'Sector C']) await expect(panel.getByText(s, { exact: true })).toBeVisible();

  await page.getByTestId('project-input').setInputFiles([
    { name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') },
  ]);
  await expect(page.getByText('Not a Lobe-Story project.')).toBeVisible();
  await expect(panel.getByText('Site 1', { exact: true })).toBeVisible();

  await page.getByTestId('project-input').setInputFiles(projectPath);
  await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
  await expect(panel.getByText('Site 1', { exact: true })).toBeVisible();
});

test('legends never cover axis titles or squeeze the plot', async ({ page }) => {
  await page.goto('/');
  const files = Array.from({ length: 12 }, (_, i) => {
    const f = 1700 + i * 10;
    return file(`_${f}_X_CO_P45_08T_Y2.MSI`, msi(f));
  });
  await page.getByTestId('file-input').setInputFiles(files);
  await page.getByRole('checkbox', { name: /Show all in/ }).first().check();
  await page.getByRole('button', { name: 'Rectangular' }).click();

  const box = async (loc: import('@playwright/test').Locator) => {
    await expect(loc.first()).toBeVisible();
    const b = await loc.first().boundingBox();
    if (!b) throw new Error('element has no bounding box');
    return b;
  };
  const apart = (a: { y: number; height: number }, b: { y: number; height: number }) =>
    a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;

  for (const [id, title] of [
    ['plot-h', '.xtitle'],
    ['plot-hpbw', '.xtitle'],
  ] as const) {
    const plot = page.getByTestId(id);
    await expect(plot.locator('.legend')).toBeVisible();
    const card = await box(plot);
    const legend = await box(plot.locator('.legend'));
    const xtitle = await box(plot.locator(title));
    expect(apart(xtitle, legend), `${id}: x-axis title vs legend`).toBe(true);
    // Plot area = span of all subplot backgrounds (the HPBW chart stacks two).
    const bgs = await plot.locator('.bglayer .bg').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return [r.top, r.bottom];
      }),
    );
    const span = Math.max(...bgs.map((b) => b[1])) - Math.min(...bgs.map((b) => b[0]));
    expect(span / card.height, `${id}: plot area share`).toBeGreaterThanOrEqual(0.55);
  }
});
