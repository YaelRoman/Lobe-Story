import { expect, test } from '@playwright/test';
import { planetText } from '../src/test/planetText';

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
