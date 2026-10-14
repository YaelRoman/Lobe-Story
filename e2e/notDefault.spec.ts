import { expect, test, type Locator, type Page } from '@playwright/test';
import { planetText } from '../src/test/planetText';
import { dismissLoadLine } from './loadLine';
import { openSimulation } from './simulationBar';
import { focusSeen } from './focusSeen';

const msi = (freq: number) => planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });
const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const files = () => [1800, 1900, 2100].map((f) => file(`_${f}_X_CO_P45_08T_Y2.MSI`, msi(f)));

const line = (page: Page) => page.getByRole('group', { name: 'Not at default' });
const chip = (page: Page, text: string) => line(page).getByRole('button', { name: text });
const chipTexts = (page: Page) => line(page).locator('.chip > span:first-child').allTextContents();
const offer = (page: Page) => page.getByTestId('undo-toast');

/** Loads three files with the browser's preferences `prefs` already stored (as a user who set them on an earlier day). */
async function load(page: Page, prefs?: { settings?: Record<string, number>; view?: Record<string, unknown> }) {
  if (prefs) await page.addInitScript((text) => localStorage.setItem('lobe-story:prefs:v1', text), JSON.stringify({ version: 1, settings: {}, view: {}, ...prefs }));
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(files());
  await expect(page.getByTestId('plot-h')).toBeVisible();
  await dismissLoadLine(page);
}

/** Where a slider's thumb is at `value`, for a mouse (as in layout.spec.ts: the thumb is about 16 px wide). */
async function thumbAt(slider: Locator, value: number) {
  const box = (await slider.boundingBox())!;
  const [min, max] = [Number(await slider.getAttribute('min')), Number(await slider.getAttribute('max'))];
  const perDegree = (box.width - 16) / (max - min);
  return { x: box.x + 8 + (value - min) * perDegree, y: box.y + box.height / 2, perDegree };
}

test('at the defaults there is no line and it takes no room; a tilt brings its chip, which resets the tilt, and the reset is undone', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await load(page);
  await expect(line(page)).toHaveCount(0);
  expect((await page.locator('.not-default-box').boundingBox())!.height).toBe(0);
  // The azimuth turns the drawing only: no number changes, no chip.
  await openSimulation(page);
  const azimuth = page.getByLabel('Azimuth (°) value');
  await azimuth.fill('30');
  await azimuth.press('Enter');
  await expect(page.getByTestId('sim-badge')).toHaveText('Turned');
  await expect(line(page)).toHaveCount(0);

  const mech = page.getByLabel('Mechanical tilt (°) value');
  await mech.fill('4');
  await mech.press('Enter');
  await expect(await chipTexts(page)).toEqual(['Simulated: mechanical 4°']);
  const tilt = chip(page, 'Simulated: mechanical 4°, reset the tilt sliders to 0°');
  await expect(tilt).toHaveAttribute('title', 'Reset the tilt sliders to 0°');

  await tilt.click();
  await expect(line(page)).toHaveCount(0);
  await expect(mech).toHaveValue('0');
  // The azimuth is not the chip's: it stays.
  await expect(azimuth).toHaveValue('30');
  await expect(offer(page)).toContainText('Reset the tilt sliders.');
  await expect(page.getByTestId('announcer')).toContainText('Reset the tilt sliders.');
  await offer(page).getByRole('button', { name: /Undo/ }).click();
  await expect(mech).toHaveValue('4');
  await expect(await chipTexts(page)).toEqual(['Simulated: mechanical 4°']);

  // Ctrl/Cmd+Z undoes it too, also after the offer was hidden.
  await chip(page, 'Simulated: mechanical 4°').click();
  await expect(mech).toHaveValue('0');
  await offer(page).getByRole('button', { name: 'Hide undo offer' }).click();
  await page.keyboard.press('Control+z');
  await expect(mech).toHaveValue('4');
  await expect(line(page)).toBeVisible();
});

test('an opened project is shown in the line at once, and each chip puts back its own thing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const project = {
    format: 'lobe-story-project',
    version: 1,
    savedAt: '2026-10-14T00:00:00Z',
    files: [{ path: 'a.msi', text: msi(1800) }, { path: 'b.msi', text: msi(2100) }],
    state: {
      visible: { 'a.msi': true },
      settings: { levelDb: 6 },
      view: {
        method3d: 'weighted',
        subBands: [{ name: 'Low', minMHz: 1700, maxMHz: 1900 }, { name: 'High', minMHz: 2000, maxMHz: 2200 }],
        simulation: { electricalDeg: 2, mechanicalDeg: 0, azimuthDeg: 0, showOriginal: true, hCut: 'horizon', offsets: { 'a.msi': { electricalDeg: 1, mechanicalDeg: 0, azimuthDeg: 90 } }, groupOffsets: {} },
      },
    },
  };
  await page.getByTestId('project-input').setInputFiles({ name: 'p.lobestory.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(line(page)).toBeVisible();
  expect(await chipTexts(page)).toEqual(['Simulated: electrical Δ 2°', 'Tilt offsets: 1 file', 'Horizontal cut: at the horizon', '3D method: Weighted', 'Beamwidth level 6 dB', 'Sub-bands: 2 user-defined']);
  await dismissLoadLine(page);
  await page.getByRole('checkbox', { name: 'Ticked files only' }).check();
  await expect(chip(page, 'Ticked files only, reset to all files')).toBeVisible();
  await openSimulation(page);

  // The 3D method first: with no tilt and the cut through the beam peak nothing would use it, and its chip would go by itself.
  await chip(page, '3D method: Weighted, reset to Summation').click();
  await expect(page.getByRole('group', { name: '3D method' }).getByRole('button', { name: 'Summation' })).toHaveAttribute('aria-pressed', 'true');
  await expect(offer(page)).toContainText('Reset the 3D method.');

  await chip(page, 'Simulated: electrical Δ 2°, reset the tilt sliders to 0°').click();
  await expect(page.getByLabel('Electrical tilt Δ (°) value')).toHaveValue('0');

  await chip(page, 'Tilt offsets: 1 file, reset the tilt offsets to 0°').click();
  await expect(offer(page)).toContainText('Reset the tilt offsets.');
  // The file's azimuth offset (a pointing) stays: the drawing is still turned.
  await expect(page.getByTestId('sim-badge')).toHaveText('Simulated');

  await chip(page, 'Horizontal cut: at the horizon, reset to Through the beam peak').click();
  await expect(page.getByRole('group', { name: 'Horizontal cut' }).getByRole('button', { name: 'Through the beam peak' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('sim-badge')).toHaveText('Turned');

  await chip(page, 'Beamwidth level 6 dB, reset to 3 dB').click();
  await expect(offer(page)).toContainText('Reset the beamwidth level.');
  await expect(page.getByRole('columnheader', { name: /^H-HPBW/ })).toBeVisible();

  await chip(page, 'Sub-bands: 2 user-defined, reset to automatic').click();
  await expect(offer(page)).toContainText('Dropped your 2 sub-bands.');

  await chip(page, 'Ticked files only, reset to all files').click();
  await expect(page.getByRole('checkbox', { name: 'Ticked files only' })).not.toBeChecked();
  await expect(page.getByTestId('announcer')).toContainText('Ticked files only is off: the metrics table lists every file again.');
  await expect(line(page)).toHaveCount(0);
  // The Simulation bar is open: the line keeps its row, and says that nothing differs.
  await expect(page.getByTestId('not-default-empty')).toHaveText('All at default');
  // "Ticked files only" offers no undo of its own and leaves the one on offer: the sub-bands come back.
  await page.keyboard.press('Control+z');
  await expect(await chipTexts(page)).toEqual(['Sub-bands: 2 user-defined']);
});

test('the keyboard: the chips follow the toolbar, show their focus, and the focus goes on to the next chip after a reset', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await load(page, { settings: { sectorEdgeDeg: 45 }, view: { tableTickedOnly: true } });
  expect(await chipTexts(page)).toEqual(['Sector edge ±45°', 'Ticked files only']);
  await page.getByRole('button', { name: 'Clear', exact: true }).focus();
  await page.keyboard.press('Tab');
  const sector = chip(page, 'Sector edge ±45°, reset to ±60°');
  await expect(sector).toBeFocused();
  expect(await focusSeen(page)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(chip(page, 'Ticked files only, reset to all files')).toBeFocused();
  expect(await focusSeen(page)).toBe(true);
  await expect(page.getByTestId('announcer')).toContainText('Reset the sector edge.');
  await page.keyboard.press('Enter');
  await expect(line(page)).toHaveCount(0);
  // No chip left: the focus goes to the plots, where it is seen.
  await expect(page.locator('#cut-plots-heading')).toBeFocused();
  expect(await focusSeen(page)).toBe(true);
  // A reset of a remembered setting is remembered, and its undo is too.
  await page.keyboard.press('Control+z');
  await expect(await chipTexts(page)).toEqual(['Sector edge ±45°']);
  // (The test's own start stored them; a reload would store them again, so the browser's storage is read.)
  await page.waitForFunction(() => {
    const stored = JSON.parse(localStorage.getItem('lobe-story:prefs:v1') ?? '{}');
    return stored.settings?.sectorEdgeDeg === 45 && stored.view?.tableTickedOnly === false;
  });
});

test('the line stays as it was while a slider is dragged and comes when it is let go; neither moves the slider under the pointer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await load(page);
  await openSimulation(page);
  const slider = page.getByRole('slider', { name: 'Mechanical tilt (°)', exact: true });
  const before = (await slider.boundingBox())!;
  const { x, y, perDegree } = await thumbAt(slider, 0);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 6, y, { steps: 2 });
  await expect(page.getByTestId('sim-badge')).toBeVisible();
  await page.mouse.move(x + 28, y, { steps: 4 });
  await expect(line(page)).toHaveCount(0);
  expect((await slider.boundingBox())!).toEqual(before);
  await page.mouse.up();
  await expect(line(page)).toBeVisible();
  expect(Math.abs(Number(await slider.inputValue()) - 28 / perDegree)).toBeLessThanOrEqual(1);
  expect((await slider.boundingBox())!).toEqual(before);
  // Its chip puts the tilt back, and the line goes without moving the bar.
  await line(page).getByRole('button', { name: /^Simulated: mechanical/ }).click();
  await expect(line(page)).toHaveCount(0);
  expect((await slider.boundingBox())!).toEqual(before);
});

test('on a phone the line keeps its chips and its height through a drag, also where the page cannot be scrolled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page, { settings: { levelDb: 6 } });
  const height = async () => (await page.locator('.not-default-box').boundingBox())!.height;
  const oneRow = await height();
  expect(oneRow).toBeGreaterThan(0);
  await openSimulation(page);
  const slider = page.getByRole('slider', { name: 'Mechanical tilt (°)', exact: true });
  await slider.scrollIntoViewIfNeeded();
  const before = (await slider.boundingBox())!;
  const start = await thumbAt(slider, 0);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y, { steps: 4 });
  await expect(page.getByTestId('sim-badge')).toBeVisible();
  // Held: no chip for the tilt yet, the same height, the slider where it was pressed.
  await expect(line(page).getByRole('button', { name: /^Simulated/ })).toHaveCount(0);
  expect(await height()).toBe(oneRow);
  expect((await slider.boundingBox())!).toEqual(before);
  await page.mouse.up();
  // Let go: the tilt's chip goes to a second row, and the page under the line keeps its place.
  await expect(line(page).getByRole('button', { name: /^Simulated: mechanical/ })).toBeVisible();
  expect(await height()).toBeGreaterThan(oneRow);
  expect((await slider.boundingBox())!).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  // With the page scrolled back to its top there is no room above to scroll it by: a drag to 0, which takes the chip
  // away, still moves nothing while the slider is held.
  const value = page.getByLabel('Mechanical tilt (°) value');
  await value.fill('3');
  await value.press('Enter');
  await expect(line(page).getByRole('button', { name: /^Simulated: mechanical 3°/ })).toBeVisible();
  await page.locator('main').evaluate((main) => (main.scrollTop = 0));
  const twoRows = await height();
  const at = (await slider.boundingBox())!;
  const from = await thumbAt(slider, 3);
  const to = await thumbAt(slider, 0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await expect(slider).toHaveValue('0');
  await expect(line(page).getByRole('button', { name: /^Simulated: mechanical 3°/ })).toBeVisible();
  expect(await height()).toBe(twoRows);
  expect((await slider.boundingBox())!).toEqual(at);
  await page.mouse.up();
  await expect(line(page).getByRole('button', { name: /^Simulated/ })).toHaveCount(0);
  // Let go: the chip goes, and the line keeps the room (the page is at its top: nothing to scroll back), so the slider
  // stays under the pointer. Scrolled down, the room is given back.
  expect(await height()).toBe(twoRows);
  expect((await slider.boundingBox())!).toEqual(at);
  await page.locator('main').evaluate((main) => (main.scrollTop += 200));
  await expect.poll(height).toBe(oneRow);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`at ${viewport.width} px the open Simulation bar keeps a row for the line: the first chip fills it, and nothing in the bar moves or is hidden`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await load(page);
    // Folded (the default): no line and no room, as before the line existed.
    expect((await page.locator('.not-default-box').boundingBox())!.height).toBe(0);
    await openSimulation(page);
    const reserved = page.getByTestId('not-default-empty');
    await expect(reserved).toHaveText('All at default');
    const row = (await page.locator('.not-default-box').boundingBox())!.height;
    expect(row).toBeGreaterThan(0);
    const main = page.locator('main');
    await main.evaluate((m) => (m.scrollTop = 0));
    const fold = page.getByRole('button', { name: /Simulation/ });
    const value = page.getByLabel('Mechanical tilt (°) value');
    const [foldAt, valueAt] = [(await fold.boundingBox())!, (await value.boundingBox())!];

    await value.fill('4');
    await value.press('Enter');
    await expect(chip(page, 'Simulated: mechanical 4°')).toBeVisible();
    await expect(reserved).toHaveCount(0);
    expect((await page.locator('.not-default-box').boundingBox())!.height).toBe(row);
    expect(await main.evaluate((m) => m.scrollTop)).toBe(0);
    expect((await fold.boundingBox())!).toEqual(foldAt);
    expect((await value.boundingBox())!).toEqual(valueAt);
    // The bar's top is not under the line: the fold button and the field just used lie wholly inside the working area.
    const top = (await main.boundingBox())!.y;
    expect(foldAt.y).toBeGreaterThanOrEqual(top);

    // The horizon cut too: a second chip in the row (desktop) or the measured scroll for a second row (phone); never a hidden bar at the first.
    await chip(page, 'Simulated: mechanical 4°').click();
    await expect(reserved).toHaveText('All at default');
    await page.getByRole('group', { name: 'Horizontal cut' }).getByRole('button', { name: 'At the horizon' }).click();
    await expect(chip(page, 'Horizontal cut: at the horizon')).toBeVisible();
    expect(await main.evaluate((m) => m.scrollTop)).toBe(0);
    expect((await fold.boundingBox())!).toEqual(foldAt);
  });
}

test('a line that gets lower with the page at its top moves nothing under the pointer: the room is given back when the page is scrolled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page, { view: { tableTickedOnly: true } });
  await openSimulation(page);
  const box = page.locator('.not-default-box');
  const height = async () => (await box.boundingBox())!.height;
  const oneRow = await height();
  const value = page.getByLabel('Mechanical tilt (°) value');
  await value.fill('4');
  await value.press('Enter');
  await expect(chip(page, 'Simulated: mechanical 4°')).toBeVisible();
  const twoRows = await height();
  expect(twoRows).toBeGreaterThan(oneRow);
  // Back at the top, as a user does after the line came; then the bar's Reset takes the tilt's chip away.
  const main = page.locator('main');
  await main.evaluate((m) => (m.scrollTop = 0));
  const reset = page.getByRole('button', { name: 'Reset', exact: true });
  await reset.scrollIntoViewIfNeeded();
  const scrolled = await main.evaluate((m) => m.scrollTop);
  const at = (await reset.boundingBox())!;
  await reset.click();
  await expect(chip(page, 'Simulated: mechanical 4°')).toHaveCount(0);
  // The work area had less room above than the row: the line keeps its height, and Reset stays under the pointer.
  expect(scrolled).toBeLessThan(twoRows - oneRow);
  expect(await height()).toBe(twoRows);
  expect((await reset.boundingBox())!).toEqual(at);
  // Scrolled down by the user: the room is given back as it can be taken from the scroll, and nothing jumps.
  await main.evaluate((m) => (m.scrollTop += 200));
  await expect.poll(height).toBe(oneRow);
  expect((await reset.boundingBox())!.y).toBeCloseTo(at.y - 200, 0);
});
