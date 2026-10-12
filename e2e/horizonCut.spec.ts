import { expect, test, type Page } from '@playwright/test';
import { openSimulation } from './simulationBar';

const DOWNLOAD = 'Download plot as a png (with legend and values)';

async function loadExample(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
}

/** The drawn lines of the horizontal plot (the ticked file's simulated cut and its dashed original). */
const hTrace = (page: Page) =>
  page.getByTestId('plot-h').locator('.scatterlayer .trace .lines path').evaluateAll((paths) => paths.map((p) => p.getAttribute('d')).join(' | '));
const hTitle = (page: Page) => page.getByTestId('plot-h').locator('.gtitle');

async function setMechanical(page: Page, value: string) {
  const mech = page.getByLabel('Mechanical tilt (°) value');
  await mech.fill(value);
  await mech.press('Enter');
  await expect(page.getByTestId('sim-badge')).toBeVisible();
}

test('the simulated horizontal cut can be taken at the horizon: plot, table, summary, exports and project follow', async ({ page }) => {
  // The exported image is drawn from an SVG: keep every SVG the page turns into an image, to read the caption in it.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { exportedSvgs: string[] }).exportedSvgs = seen;
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (obj instanceof Blob && obj.type.includes('svg')) void obj.text().then((t) => seen.push(t));
      return create(obj);
    };
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...src,
      set(value: string) {
        if (typeof value === 'string' && value.startsWith('data:image/svg+xml')) seen.push(decodeURIComponent(value.slice(value.indexOf(',') + 1)));
        src.set!.call(this, value);
      },
    });
  });
  await loadExample(page);
  await openSimulation(page);

  const choice = page.getByRole('group', { name: 'Horizontal cut' });
  const beam = choice.getByRole('button', { name: 'Through the beam peak' });
  const horizon = choice.getByRole('button', { name: 'At the horizon' });
  // The default is the cut through the beam peak; the other choice is offered without a tilt (it is a view of every file).
  await expect(beam).toHaveAttribute('aria-pressed', 'true');
  await expect(horizon).toHaveAttribute('aria-pressed', 'false');
  await expect(horizon).toBeEnabled();

  await setMechanical(page, '6');
  await expect(horizon).toBeEnabled();
  await expect(hTitle(page)).toContainText('cut through the tilted beam peak');
  await expect(page.getByTestId('updating-2d')).toHaveCount(0);
  const firstRow = page.locator('.metrics tbody tr').first();
  const hpbwCell = firstRow.locator('td[data-col="hHpbw"]');
  await expect(hpbwCell).toContainText('→');
  const beamCell = await hpbwCell.innerText();
  const beamPath = await hTrace(page);
  await expect(page.getByTestId('sim-hcut-note')).toContainText('horizontal cut through the beam peak');
  await expect(page.getByTestId('readout-h')).not.toContainText('Horizon cut');

  // By keyboard: the control is a pair of buttons.
  await horizon.focus();
  await page.keyboard.press('Enter');
  await expect(horizon).toHaveAttribute('aria-pressed', 'true');
  await expect(beam).toHaveAttribute('aria-pressed', 'false');

  // The plot: another line, the title names the cut, the read-out says how far down the cut is.
  await expect(hTitle(page)).toContainText('cut at the horizon');
  await expect(hTitle(page)).not.toContainText('beam peak');
  await expect.poll(() => hTrace(page)).not.toBe(beamPath);
  await expect(page.getByTestId('readout-h')).toContainText(/Horizon cut: maximum \d+\.\d dB below the 3D peak/);
  // The table: the tilted H-HPBW is another number, the original is the same; the note names the cut and the rule.
  await expect(hpbwCell).not.toHaveText(beamCell);
  expect((await hpbwCell.innerText()).split('→')[0]).toBe(beamCell.split('→')[0]);
  await expect(page.getByTestId('sim-hcut-note')).toContainText('horizontal cut at the horizon');
  await expect(page.getByTestId('sim-hcut-note')).toContainText('levels below the 3D peak');
  // The vertical cut does not follow the choice.
  await expect(page.getByTestId('plot-v').locator('.gtitle')).not.toContainText('horizon');

  // The exported image's caption names the choice.
  await expect(page.getByTestId('updating-2d')).toHaveCount(0);
  const [image] = await Promise.all([page.waitForEvent('download'), page.getByTestId('plot-h').getByRole('button', { name: DOWNLOAD }).click()]);
  expect(image.suggestedFilename()).toBe('horizontal-cut-simulated.png');
  const svgs = await page.evaluate(() => (window as unknown as { exportedSvgs: string[] }).exportedSvgs);
  const exported = svgs.filter((s) => s.includes('Simulated:'));
  expect(exported.length).toBeGreaterThan(0);
  const text = exported[exported.length - 1].replace(/<[^>]+>/g, ' ').replace(/&#176;|&deg;/g, '°').replace(/\s+/g, ' ');
  expect(text).toContain('mechanical 6°');
  expect(text).toContain('horizontal cut at the horizon');
  expect(text).toContain('cut at the horizon');
  expect(text).toMatch(/Horizon cut: maximum \d+\.\d dB below the 3D peak/);

  // The CSV marks the tilted horizontal columns, and only those.
  const [csvFile] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  let csv = '';
  for await (const chunk of (await csvFile.createReadStream())!) csv += chunk.toString();
  const header = csv.split('\r\n')[0];
  expect(header).toContain('H-HPBW original (°),H-HPBW tilted [horizon cut] (°)');
  expect(header).toContain('V-HPBW original (°),V-HPBW tilted (°)');

  // Folded, the bar's summary names it.
  await page.getByRole('button', { name: /Simulation/ }).click();
  await expect(page.getByTestId('sim-summary')).toContainText('Mech 6°');
  await expect(page.getByTestId('sim-summary')).toContainText('H cut: at the horizon');

  // Saved with the project, and back when the project is opened in a session that has the other choice.
  await page.getByRole('button', { name: 'Save project' }).click();
  const [project] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()]);
  const projectPath = (await project.path())!;
  await openSimulation(page);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByTestId('sim-badge')).toHaveCount(0);
  await expect(beam).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('project-input').setInputFiles(projectPath);
  const replace = page.getByRole('dialog').getByRole('button', { name: 'Replace' });
  await replace.click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await expect(page.getByLabel('Mechanical tilt (°) value')).toHaveValue('6');
  await expect(horizon).toHaveAttribute('aria-pressed', 'true');
  await expect(hTitle(page)).toContainText('cut at the horizon');
  await expect(page.getByTestId('sim-hcut-note')).toContainText('horizontal cut at the horizon');
});

test('with electrical tilt only, the horizon cut is lower than the cut through the beam peak, which stays the file cut', async ({ page }) => {
  await loadExample(page);
  await openSimulation(page);
  const elec = page.getByLabel('Electrical tilt Δ (°) value');
  await elec.fill('4');
  await elec.press('Enter');
  await expect(page.getByTestId('sim-badge')).toBeVisible();
  // Through the beam peak an electrical tilt does not change the horizontal cut: no note in the title.
  await expect(hTitle(page)).not.toContainText('·');
  await page.getByRole('group', { name: 'Horizontal cut' }).getByRole('button', { name: 'At the horizon' }).click();
  await expect(hTitle(page)).toContainText('cut at the horizon');
  const readout = page.getByTestId('readout-h');
  await expect(readout).toContainText(/Horizon cut: maximum \d+\.\d dB below the 3D peak/);
  const below = Number((await readout.innerText()).match(/maximum (\d+\.\d) dB below/)![1]);
  expect(below).toBeGreaterThan(1);
});

test('at the horizon every file shows its horizon cut without any tilt, and a port given 1° is compared with its partner\'s horizon cut', async ({ page }) => {
  await loadExample(page);
  await openSimulation(page);
  const choice = page.getByRole('group', { name: 'Horizontal cut' });
  const horizon = choice.getByRole('button', { name: 'At the horizon' });
  const method = page.getByRole('group', { name: '3D method' }).getByRole('button', { name: 'Weighted' });
  const row = (id: string) => page.locator(`.metrics tbody tr[data-row-id="${id}"]`);
  const plus = row('example_1710_P45_02T.msi');
  const minus = row('example_1710_M45_02T.msi');
  const other = row('example_1795_P45_02T.msi');

  // Nothing is simulated yet: no badge, single values, the 3D method changes nothing in 2D.
  await expect(page.getByTestId('sim-badge')).toHaveCount(0);
  await expect(plus.locator('td[data-col="hHpbw"]')).not.toContainText('→');
  await expect(method).toBeDisabled();
  // The Horizon level column and its chart metric exist only at the horizon.
  const levelHeader = page.locator('.metrics thead th', { hasText: 'Horizon level (dB)' });
  const levelOption = page.locator('#freq-metric option[value="hLevel"]');
  await expect(levelHeader).toHaveCount(0);
  await expect(levelOption).toHaveCount(0);
  const fileTracking = await plus.locator('td[data-col="tracking"]').innerText();
  const fileVHpbw = await plus.locator('td[data-col="vHpbw"]').innerText();
  // The drawn lines of a plot: the ticked file's trace and the marker lines of the highlighted file.
  const drawnLines = (id: 'h' | 'v') => page.getByTestId(`plot-${id}`).locator('.scatterlayer .trace .lines path');
  await expect(page.getByTestId('updating-2d')).toHaveCount(0);
  const hLines = await drawnLines('h').count();
  const vLines = await drawnLines('v').count();
  expect(hLines).toBeGreaterThan(0);

  await horizon.click();
  await expect(horizon).toHaveAttribute('aria-pressed', 'true');
  // A reconstructed cut is an estimate: the view is marked, and the method that makes it can be chosen.
  await expect(page.getByTestId('sim-badge')).toBeVisible();
  await expect(method).toBeEnabled();
  await expect(hTitle(page)).toContainText('cut at the horizon');
  await expect(page.getByTestId('readout-h')).toContainText(/Horizon cut: maximum \d+\.\d dB below the 3D peak/);
  await expect(page.getByTestId('sim-hcut-note')).toContainText('horizontal cut at the horizon');
  await expect(page.getByText('Simulated: Δe 0°, mech 0°')).toBeVisible();
  // Every file: horizontal cells read "file cut → horizon cut"; the vertical cells are the file's own, without an arrow.
  for (const r of [plus, minus, other]) {
    await expect(r.locator('td[data-col="hHpbw"]')).toContainText('→');
    await expect(r.locator('td[data-col="fb180"]')).toContainText('→');
    await expect(r.locator('td[data-col="vHpbw"]')).not.toContainText('→');
    await expect(r.locator('td[data-col="tilt"]')).not.toContainText('→');
  }
  await expect(plus.locator('td[data-col="vHpbw"]')).toHaveText(fileVHpbw);
  // The new column: one number per row (how far the horizon cut is below the 3D peak), explained in its tooltip,
  // and the same number as the read-out of the highlighted file.
  await expect(levelHeader).toHaveCount(1);
  await expect(levelHeader).toHaveAttribute('title', /below the strongest point of the whole pattern \(the 3D peak\).*not the main beam/);
  const level = plus.locator('td[data-col="hLevel"]');
  await expect(level).toHaveText(/^\d+\.\d$/);
  await expect(page.getByTestId('readout-h')).toContainText(`Horizon cut: maximum ${await level.innerText()} dB below the 3D peak`);
  // It can be plotted against frequency.
  await expect(levelOption).toHaveCount(1);
  await page.locator('#freq-metric').selectOption('hLevel');
  await expect(page.getByRole('heading', { name: /Horizon level vs frequency/ })).toBeVisible();
  await expect(page.getByTestId('plot-v').locator('.gtitle')).not.toContainText('horizon');
  // The horizontal plot has the dashed file cut of the ticked file; the vertical plot has no original (nothing changed).
  await expect(drawnLines('h')).toHaveCount(hLines + 1);
  await expect(drawnLines('v')).toHaveCount(vLines);
  const trackingOf = async (r: typeof plus) => Number((await r.locator('td[data-col="tracking"]').innerText()).split('→').pop()!.trim());
  const untilted = await trackingOf(plus);
  expect(Math.abs(untilted - Number(fileTracking))).toBeLessThan(1);

  // One port gets 1° of mechanical tilt: its tracking is taken against the partner's horizon cut, so it moves by a
  // fraction of a dB (not by the level of the cut), and both rows of the pair say the same.
  // (The first file is the selected one after Load example.)
  await expect(page.getByRole('group', { name: 'Per-file and group offsets' })).toContainText('example_1710_P45_02T');
  const offset = page.getByLabel('Mechanical tilt offset (°) value');
  await offset.fill('1');
  await offset.press('Enter');
  await expect(page.getByLabel('Offsets: mech +1°')).toBeVisible();
  await expect(plus.locator('td[data-col="vHpbw"]')).toContainText('→');
  await expect(minus.locator('td[data-col="vHpbw"]')).not.toContainText('→');
  await expect(minus.locator('td[data-col="hHpbw"]')).toContainText('→');
  await expect.poll(() => trackingOf(plus)).not.toBe(untilted);
  const tilted = await trackingOf(plus);
  expect(await trackingOf(minus)).toBe(tilted);
  expect(Math.abs(tilted - untilted)).toBeLessThan(2);

  // The CSV: the untilted partner's tilted horizontal column holds its horizon cut, not its file cut.
  const [csvFile] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(csvFile.suggestedFilename()).toBe('pattern-metrics-simulated.csv');
  let csv = '';
  for await (const chunk of (await csvFile.createReadStream())!) csv += chunk.toString();
  const lines = csv.split('\r\n').map((l) => l.split(','));
  const fb = lines[0].indexOf('F/B 180° tilted [horizon cut] (dB)');
  const v = lines[0].indexOf('V-HPBW tilted (°)');
  const partner = lines.find((l) => l[0].includes('1710_M45_02T'))!;
  expect(fb).toBeGreaterThan(0);
  expect(partner[fb]).not.toBe(partner[fb - 1]);
  expect(partner[v]).toBe(partner[v - 1]);
  // One column for the level, right after the tilted horizontal beamwidth; the untilted partner has its own value.
  const levelAt = lines[0].indexOf('Horizon level [horizon cut] (dB)');
  expect(levelAt).toBe(lines[0].indexOf('H-HPBW tilted [horizon cut] (°)') + 1);
  expect(partner[levelAt]).toMatch(/^\d+\.\d\d$/);
  expect(csv.split('\r\n')[0]).not.toContain('"');

  // Back to the cut through the beam peak with the offset cleared: nothing is simulated.
  await page.getByRole('button', { name: 'Clear offsets' }).click();
  await choice.getByRole('button', { name: 'Through the beam peak' }).click();
  await expect(page.getByTestId('sim-badge')).toHaveCount(0);
  await expect(plus.locator('td[data-col="hHpbw"]')).not.toContainText('→');
  await expect(hTitle(page)).not.toContainText('·');
  // The column is gone, and the chart that plotted it shows the beamwidths again.
  await expect(levelHeader).toHaveCount(0);
  await expect(levelOption).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /HPBW vs frequency/ })).toBeVisible();
});
