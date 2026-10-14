import { expect, test, type Download, type Page } from '@playwright/test';
import { dismissLoadLine } from './loadLine';
import { openSimulation } from './simulationBar';

const DOWNLOAD = 'Download plot as a png (with legend and values)';

async function loadExample(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
}

async function readText(download: Download): Promise<string> {
  let text = '';
  for await (const chunk of (await download.createReadStream())!) text += chunk.toString();
  return text;
}

test('the Azimuth slider turns the drawing and nothing else: the page, the table and the exports say so', async ({ page }) => {
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

  // What the three sliders do is said where they are: a tooltip each, and a description (read out, not shown: the bar has no room for a line) for the one that changes no number.
  const field = (name: string) => page.getByRole('group', { name, exact: true });
  await expect(field('Electrical tilt Δ (°)')).toHaveAttribute('title', /added to the tilt each file already has/);
  await expect(field('Mechanical tilt (°)')).toHaveAttribute('title', /whole antenna is tipped/);
  await expect(field('Azimuth (°)')).toHaveAttribute('title', /turns the pattern on the plot.*the metrics are not affected/);
  await expect(page.getByTestId('sim-az-hint')).toHaveText('Azimuth turns the pattern on the plot (a pointing direction, for a site view); the metrics are not affected.');
  await expect(page.getByRole('slider', { name: 'Azimuth (°)', exact: true })).toHaveAttribute('aria-describedby', 'sim-az-hint');

  const readout = page.getByTestId('readout-h');
  await expect(readout).toContainText(/Squint -?[\d.]+°/);
  const squint = (await readout.innerText()).match(/Squint (-?[\d.]+°)/)![1];
  const before = await page.locator('.metrics tbody tr').first().innerText();
  const hTrace = () => page.getByTestId('plot-h').locator('.scatterlayer .trace .lines path').first().getAttribute('d');
  const drawn = await hTrace();

  const azimuth = page.getByLabel('Azimuth (°) value');
  await azimuth.fill('20');
  await azimuth.press('Enter');

  // The trace turns; the badge says "Turned", not "Simulated".
  await expect.poll(hTrace).not.toBe(drawn);
  await expect(page.getByTestId('sim-badge')).toHaveText('Turned');
  // The read-out does not contradict the ray: the squint is the antenna's, the plot points to 20°.
  await expect(readout).toContainText(`Squint ${squint} (antenna) · pointing 20°`);
  // The angle labels stay where they were: 0° at the top of the circle.
  const zero = await page.getByTestId('plot-h').locator('.angularaxistick text', { hasText: /^0°$/ }).first().boundingBox();
  const plot = await page.getByTestId('plot-h').locator('.polarlayer').first().boundingBox();
  expect(Math.abs(zero!.x + zero!.width / 2 - (plot!.x + plot!.width / 2))).toBeLessThan(12);
  // The table: the same numbers, no pair, no "Simulated:" line.
  expect(await page.locator('.metrics tbody tr').first().innerText()).toBe(before);
  await expect(page.locator('.metrics tbody')).not.toContainText('→');
  await expect(page.getByText(/Simulated:/)).toHaveCount(0);

  // The CSV is not called simulated, has one column per metric, and says where each file points.
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(csv.suggestedFilename()).toBe('pattern-metrics.csv');
  const lines = (await readText(csv)).trimEnd().split('\r\n');
  expect(lines[0]).not.toMatch(/original|tilted|Electrical tilt|Mechanical tilt/);
  expect(lines[0].endsWith(',Azimuth pointing (°)')).toBe(true);
  expect(lines).toHaveLength(25);
  for (const line of lines.slice(1)) expect(line.endsWith(',20')).toBe(true);
  // Nor are the band statistics.
  const [bandCsv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export band CSV' }).click()]);
  expect(bandCsv.suggestedFilename()).toBe('band-statistics.csv');

  // The picture of the horizontal cut is turned and says so; the vertical cut is not touched.
  await expect(page.getByTestId('updating-2d')).toHaveCount(0);
  const [image] = await Promise.all([page.waitForEvent('download'), page.getByTestId('plot-h').getByRole('button', { name: DOWNLOAD }).click()]);
  expect(image.suggestedFilename()).toBe('horizontal-cut-turned.png');
  const svgs = await page.evaluate(() => (window as unknown as { exportedSvgs: string[] }).exportedSvgs);
  const text = svgs.map((s) => s.replace(/<[^>]+>/g, ' ').replace(/&#176;|&deg;/g, '°').replace(/\s+/g, ' ')).filter((s) => s.includes('Turned on the plot'));
  expect(text.length).toBeGreaterThan(0);
  expect(text[text.length - 1]).toContain('Turned on the plot: azimuth 20°. The metrics are not affected.');
  expect(text[text.length - 1]).not.toContain('Simulated:');
  const [vImage] = await Promise.all([page.waitForEvent('download'), page.getByTestId('plot-v').getByRole('button', { name: DOWNLOAD }).click()]);
  expect(vImage.suggestedFilename()).toBe('vertical-cut.png');

  // With a tilt on top it is a simulation, and the azimuth column stands next to the two tilt columns.
  const mech = page.getByLabel('Mechanical tilt (°) value');
  await mech.fill('2');
  await mech.press('Enter');
  await expect(page.getByTestId('sim-badge')).toHaveText('Simulated');
  await expect(page.locator('.metrics tbody tr').first()).toContainText('→');
  const [csv2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(csv2.suggestedFilename()).toBe('pattern-metrics-simulated.csv');
  const lines2 = (await readText(csv2)).trimEnd().split('\r\n');
  expect(lines2[0].endsWith('Electrical tilt Δ (°),Mechanical tilt (°),Azimuth pointing (°)')).toBe(true);
  expect(lines2[1].endsWith(',0,2,20')).toBe(true);
});

test('the badge keeps its width between "Turned" and "Simulated", so no slider moves when a tilt joins an azimuth', async ({ page }) => {
  await loadExample(page);
  // The load line goes by itself after six seconds and the page moves up with it: gone before the slider is measured.
  await dismissLoadLine(page);
  await openSimulation(page);
  const slider = page.getByRole('slider', { name: 'Electrical tilt Δ (°)', exact: true });
  const empty = await slider.boundingBox();
  const azimuth = page.getByLabel('Azimuth (°) value');
  await azimuth.fill('20');
  await azimuth.press('Enter');
  await expect(page.getByTestId('sim-badge')).toHaveText('Turned');
  const turned = { badge: await page.getByTestId('sim-badge').boundingBox(), slider: await slider.boundingBox() };
  const mech = page.getByLabel('Mechanical tilt (°) value');
  await mech.fill('2');
  await mech.press('Enter');
  await expect(page.getByTestId('sim-badge')).toHaveText('Simulated');
  const simulated = { badge: await page.getByTestId('sim-badge').boundingBox(), slider: await slider.boundingBox() };
  expect(Math.abs(turned.badge!.width - simulated.badge!.width)).toBeLessThan(0.5);
  expect(turned.slider).toEqual(simulated.slider);
  expect(turned.slider).toEqual(empty);
});
