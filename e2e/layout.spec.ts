import { expect, test } from '@playwright/test';
import { planetText } from '../src/test/planetText';

const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const msi = (freq: number) => planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });
const files = () => [1800, 1900, 2100].map((f) => file(`_${f}_X_CO_P45_08T_Y2.MSI`, msi(f)));

test('the simulation bar folds to one line that keeps the badge and summary, and the choice is remembered', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(files());
  const fold = page.getByRole('button', { name: /Simulation/ });
  // Folded by default (nothing simulated, nothing stored): the plots start higher; the one-line summary says what is set.
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('sim-summary')).toBeVisible();
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await page.getByLabel('Electrical tilt Δ (°) value').fill('3');
  await page.getByLabel('Electrical tilt Δ (°) value').press('Enter');
  await expect(page.getByTestId('sim-badge')).toBeVisible();

  await fold.focus();
  await page.keyboard.press('Enter');
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  // Folded means hidden, not removed: aria-controls keeps pointing at an element that exists.
  await expect(page.getByLabel('Electrical tilt Δ (°) value')).toBeHidden();
  await expect(page.locator('#sim-body')).toBeHidden();
  await expect(fold).toHaveAttribute('aria-controls', 'sim-body');
  await expect(page.getByTestId('sim-badge')).toBeVisible();
  await expect(page.getByTestId('sim-summary')).toContainText('Tilt Δ 3°');
  await expect(fold).toBeFocused();

  await page.getByRole('button', { name: /Markers/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Sidelobes', exact: true })).toBeHidden();
  await expect(page.locator('#marker-options')).toBeHidden();

  await page.waitForFunction(() => JSON.parse(localStorage.getItem('lobe-story:prefs:v1') ?? '{}').view?.collapsed?.simBar === true);
  await page.reload();
  await page.getByTestId('file-input').setInputFiles(files());
  await expect(page.getByRole('button', { name: /Simulation/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: /Markers/ })).toHaveAttribute('aria-expanded', 'false');
});

test('phone layout: no horizontal overflow, file drawer closed, first plot on the first screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(files());
  const toggle = page.getByRole('button', { name: 'Files (3)' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.panel')).toBeHidden();
  await expect(page.getByRole('button', { name: /Simulation/ })).toHaveAttribute('aria-expanded', 'false');

  const plot = page.getByTestId('plot-h');
  await expect(plot.locator('.main-svg').first()).toBeVisible();
  const box = (await plot.boundingBox())!;
  expect(box.y).toBeLessThan(500);
  expect(box.y + 200).toBeLessThan(844);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.panel')).toBeVisible();
  for (const b of await page.locator('.panel li summary, .panel li .row-main').all()) {
    const r = (await b.boundingBox())!;
    expect(r.height).toBeGreaterThanOrEqual(32);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await toggle.press('Enter');
  await expect(page.locator('.panel')).toBeHidden();
});

for (const label of ['Mechanical tilt (°)', 'Electrical tilt Δ (°)']) {
  test(`the first drag of the ${label} slider follows the pointer: the bar does not move when the simulation becomes active`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
    await expect(page.locator('.panel li')).toHaveCount(24);
    const fold = page.getByRole('button', { name: /Simulation/ });
    await fold.click();
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('sim-badge')).toHaveCount(0);

    const slider = page.getByRole('slider', { name: label, exact: true });
    await expect(slider).toHaveValue('0');
    const before = (await slider.boundingBox())!;
    const [min, max] = [Number(await slider.getAttribute('min')), Number(await slider.getAttribute('max'))];
    // The thumb of a slider at 0: its centre travels the track width less one thumb (about 16 px) over min…max.
    const thumb = 16;
    const perDegree = (before.width - thumb) / (max - min);
    const x = before.x + thumb / 2 + (0 - min) * perDegree;
    const y = before.y + before.height / 2;
    const dragPx = 28;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 6, y, { steps: 2 });
    // The simulation is active from the first step on: the badge shows while the pointer is still held.
    await expect(page.getByTestId('sim-badge')).toBeVisible();
    await page.mouse.move(x + dragPx, y, { steps: 4 });
    const during = (await slider.boundingBox())!;
    await page.mouse.up();

    const expected = dragPx / perDegree;
    const value = Number(await slider.inputValue());
    expect(Math.abs(value - expected), `value ${value}, expected about ${expected.toFixed(1)}`).toBeLessThanOrEqual(1);
    expect(during.x).toBe(before.x);
    expect(during.y).toBe(before.y);
    const after = (await slider.boundingBox())!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });
}

test('the folded Simulation bar is one line on a phone: no room is kept for the badge while there is no slider to protect', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.getByRole('button', { name: 'Files (24)' })).toBeVisible();
  const fold = page.getByRole('button', { name: /Simulation/ });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  const bar = page.locator('.sim-bar');
  const summary = page.getByTestId('sim-summary');
  await expect(summary).toHaveText('Tilt Δ 0° · Mech 0° · Az 0°');
  // One row: the fold button (32 px on a phone) plus the bar's padding and border.
  expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(52);
  // The summary sits beside the fold button, not under it.
  expect(Math.abs((await summary.boundingBox())!.y - (await fold.boundingBox())!.y)).toBeLessThan(16);
});

test('an undo offer does not move the page: Reset stays under the pointer, and a slider dragged right after it does not jump', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await page.getByRole('button', { name: 'Dismiss message' }).click();
  await page.getByRole('button', { name: /Simulation/ }).click();
  const value = page.getByLabel('Mechanical tilt (°) value');
  await value.fill('4');
  await value.press('Enter');
  await expect(page.getByTestId('sim-badge')).toBeVisible();

  const reset = page.getByRole('button', { name: 'Reset', exact: true });
  const offer = page.getByTestId('undo-toast');
  const resetBefore = (await reset.boundingBox())!;
  await reset.click();
  await expect(offer).toContainText('Reset the simulation.');
  expect((await reset.boundingBox())!).toEqual(resetBefore);
  // The offer lies over the page, clear of the bar it was made from.
  const offerBox = (await offer.boundingBox())!;
  const bar = (await page.locator('.sim-bar').boundingBox())!;
  expect(offerBox.y).toBeGreaterThan(bar.y + bar.height);

  // The first step of the drag withdraws the offer (the session changed) while the button is held.
  const slider = page.getByRole('slider', { name: 'Mechanical tilt (°)', exact: true });
  await expect(slider).toHaveValue('0');
  const before = (await slider.boundingBox())!;
  const [min, max] = [Number(await slider.getAttribute('min')), Number(await slider.getAttribute('max'))];
  const thumb = 16;
  const perDegree = (before.width - thumb) / (max - min);
  const x = before.x + thumb / 2 + (0 - min) * perDegree;
  const y = before.y + before.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 6, y, { steps: 2 });
  await expect(offer).toHaveCount(0);
  expect((await slider.boundingBox())!).toEqual(before);
  await page.mouse.move(x + 28, y, { steps: 4 });
  expect((await slider.boundingBox())!).toEqual(before);
  await page.mouse.up();
  expect(Math.abs(Number(await slider.inputValue()) - 28 / perDegree)).toBeLessThanOrEqual(1);
  expect((await slider.boundingBox())!).toEqual(before);
});

for (const [width, height] of [[1440, 900], [390, 844]]) {
  test(`at ${width} px an undo offer that comes while the load line shows moves nothing, and hiding it brings no line back`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
    await expect(page.getByTestId('load-status')).toBeVisible();
    if (width < 760) await page.getByRole('button', { name: 'Files (24)' }).click();
    await expect(page.locator('.panel li')).toHaveCount(24);
    const showAll = page.getByRole('button', { name: 'Show all', exact: true });
    const at = (await showAll.boundingBox())!;
    await showAll.click();
    const offer = page.getByTestId('undo-toast');
    await expect(offer).toContainText('Showed all files');
    expect((await showAll.boundingBox())!).toEqual(at);
    // It covers neither the toolbar nor the status line, and stays inside the screen.
    const box = (await offer.boundingBox())!;
    expect(box.y).toBeGreaterThan(height / 2);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    // Hidden by its cross: nothing moves, and the load line is neither removed nor put back by it.
    const lines = await page.getByTestId('load-status').count();
    await offer.getByRole('button', { name: 'Hide undo offer' }).click();
    await expect(offer).toHaveCount(0);
    expect((await showAll.boundingBox())!).toEqual(at);
    expect(await page.getByTestId('load-status').count()).toBe(lines);
  });
}

/** Where every control of the open bar sits, relative to the bar (the page itself may scroll). */
const placesInBar = (page: import('@playwright/test').Page) =>
  page.locator('.sim-bar').evaluate((bar) => {
    const b = bar.getBoundingClientRect();
    return Array.from(bar.querySelectorAll('input, button')).map((e) => {
      const r = e.getBoundingClientRect();
      return [Math.round((r.x - b.x) * 10) / 10, Math.round((r.y - b.y) * 10) / 10];
    });
  });

test('the open bar at 1024 px is compact: Reset stays on the Horizontal cut row and no empty band is kept under the 3D method', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await page.getByRole('button', { name: /Simulation/ }).click();
  const methodButtons = page.getByRole('group', { name: '3D method' });
  const cutButtons = page.getByRole('group', { name: 'Horizontal cut', exact: true });
  const reset = page.getByRole('button', { name: 'Reset', exact: true });
  const reason = page.getByTestId('sim-method-hint');
  const use = page.getByTestId('sim-method-use');
  const box = async (l: import('@playwright/test').Locator) => (await l.boundingBox())!;

  // Nothing uses the method: the reason is beside the control, not a band under it.
  await expect(reason).toBeVisible();
  await expect(use).toBeHidden();
  const gap = async () => (await box(cutButtons)).y - ((await box(methodButtons)).y + (await box(methodButtons)).height);
  expect(await gap()).toBeLessThanOrEqual(16);
  expect((await box(reason)).x).toBeGreaterThan((await box(methodButtons)).x + (await box(methodButtons)).width);
  // Reset and "Show original" share the row of the Horizontal cut buttons; the hint line is under that row.
  const cut = await box(cutButtons);
  const hint = await box(page.getByTestId('sim-hcut-hint'));
  for (const control of [reset, page.getByLabel('Show original')]) {
    const b = await box(control);
    expect(b.y + b.height / 2).toBeGreaterThan(cut.y);
    expect(b.y + b.height / 2).toBeLessThan(cut.y + cut.height);
    expect(b.x).toBeGreaterThan(cut.x + cut.width);
  }
  expect(hint.y).toBeGreaterThanOrEqual(cut.y + cut.height);
  expect(hint.y - (cut.y + cut.height)).toBeLessThanOrEqual(12);

  // In use (a tilt): the same place says so; nothing in the bar has moved.
  const idle = await placesInBar(page);
  const mech = page.getByLabel('Mechanical tilt (°) value');
  await mech.fill('3');
  await mech.press('Enter');
  await expect(methodButtons.getByRole('button', { name: 'Weighted' })).toBeEnabled();
  await expect(reason).toBeHidden();
  await expect(use).toBeVisible();
  await expect(use).toHaveText('In use by a tilt.');
  expect(await gap()).toBeLessThanOrEqual(16);
  expect(await placesInBar(page)).toEqual(idle);
  await mech.fill('0');
  await mech.press('Enter');
  await expect(reason).toBeVisible();
  expect(await placesInBar(page)).toEqual(idle);

  // The first plot: no more of it below the fold than before the hint lines came (about 40 % at 1024 x 768).
  const plot = await box(page.getByTestId('plot-h'));
  expect((plot.y + plot.height - 768) / plot.height).toBeLessThanOrEqual(0.45);
});

test('on a phone the line under the 3D method keeps its size when a tilt puts the method to use: nothing in the bar moves', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.getByRole('button', { name: 'Files (24)' })).toBeVisible();
  await page.getByRole('button', { name: /Simulation/ }).click();
  await expect(page.getByTestId('sim-method-hint')).toBeVisible();
  const idle = await placesInBar(page);
  const mech = page.getByLabel('Mechanical tilt (°) value');
  await mech.fill('3');
  await mech.press('Enter');
  await expect(page.getByTestId('sim-method-use')).toBeVisible();
  await expect(page.getByTestId('sim-method-hint')).toBeHidden();
  expect(await placesInBar(page)).toEqual(idle);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('a slider held while the calm load line runs out does not jump: the line goes when the pointer is released', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  const loaded = Date.now();
  const line = page.getByTestId('load-status');
  await expect(line).toBeVisible();
  await page.getByRole('button', { name: /Simulation/ }).click();
  const slider = page.getByRole('slider', { name: 'Mechanical tilt (°)', exact: true });
  const before = (await slider.boundingBox())!;
  const x = before.x + before.width / 2;
  const y = before.y + before.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 10, y, { steps: 2 });
  // Held past the line's six seconds (and a margin): the line is still there and the slider where it was pressed.
  await page.waitForTimeout(Math.max(0, 7000 - (Date.now() - loaded)));
  await page.mouse.move(x + 20, y, { steps: 2 });
  await expect(line).toBeVisible();
  expect((await slider.boundingBox())!).toEqual(before);
  await page.mouse.up();
  await expect(line).toHaveCount(0);
  expect((await slider.boundingBox())!.y).toBeLessThan(before.y);
});
