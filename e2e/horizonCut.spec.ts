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
  // The default is the cut through the beam peak; without a tilted file the choice changes nothing and is not offered.
  await expect(beam).toHaveAttribute('aria-pressed', 'true');
  await expect(horizon).toHaveAttribute('aria-pressed', 'false');
  await expect(horizon).toBeDisabled();

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
