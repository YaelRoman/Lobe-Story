import { expect, test, type Page } from '@playwright/test';
import { openSimulation } from './simulationBar';
import { loadMany, MECHANICAL, settled, WAITING } from './manyFiles';

/** Notes from now on whether the waiting line was on the page at any moment (it can come and go between two checks). */
const watchWaiting = (page: Page) =>
  page.evaluate((text) => {
    const w = window as unknown as { sawWaiting: boolean };
    w.sawWaiting = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="updating-2d"]')?.textContent === text) w.sawWaiting = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, WAITING);
const sawWaiting = (page: Page) => page.evaluate(() => (window as unknown as { sawWaiting: boolean }).sawWaiting);

/** Everything on the page a tilt changes: the table, what the plots draw, the read-outs, the band statistics, the bar. */
async function shown(page: Page) {
  const [csvFile] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  let csv = '';
  for await (const chunk of (await csvFile.createReadStream())!) csv += chunk.toString();
  const dom = await page.evaluate(() => {
    const text = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector), (e) => e.innerText.replace(/\s+/g, ' ').trim());
    const plots = Array.from(document.querySelectorAll('.js-plotly-plot'), (el) => {
      const gd = el as unknown as { data?: { name?: string; r?: number[]; theta?: number[]; x?: number[]; y?: number[]; line?: { dash?: string } }[]; layout?: { title?: { text?: string } } };
      return { title: gd.layout?.title?.text, traces: (gd.data ?? []).map((t) => [t.name, t.line?.dash, t.r ?? t.y, t.theta ?? t.x]) };
    });
    return {
      table: text('.metrics tbody tr'),
      tableNotes: text('[data-testid="sim-hcut-note"], [data-testid="sim-pair-note"]'),
      readouts: text('.readout'),
      band: text('[data-testid="band-stats"]'),
      bar: text('.sim-bar'),
      sliders: Array.from(document.querySelectorAll<HTMLInputElement>('.sim-bar input'), (i) => i.value),
      paths: Array.from(document.querySelectorAll('[data-testid="plot-h"] .scatterlayer .trace .lines path, [data-testid="plot-v"] .scatterlayer .trace .lines path'), (p) => p.getAttribute('d')),
      plots,
    };
  });
  return { csv, ...dom };
}

async function setDirect(page: Page, label: string, value: string) {
  const box = page.getByLabel(`${label} value`, { exact: true });
  await box.fill(value);
  await box.press('Enter');
  await settled(page);
}

test('with many files ticked a slider drag is followed when it stops, and ends exactly where a typed value does', async ({ page }) => {
  await loadMany(page, 48);
  const slider = page.getByRole('slider', { name: MECHANICAL, exact: true });
  const box = (await slider.boundingBox())!;
  const y = box.y + box.height / 2;
  await watchWaiting(page);

  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + i * 6, y);
  // The thumb and its number follow the pointer while the button is held.
  const during = await slider.inputValue();
  expect(Number(during)).toBeGreaterThan(0);
  await expect(page.getByLabel(`${MECHANICAL} value`, { exact: true })).toHaveValue(during);
  await page.mouse.up();

  expect(await sawWaiting(page)).toBe(true);
  await settled(page);
  const value = await slider.inputValue();
  expect(value).toBe(during);
  await expect(page.locator('p.count', { hasText: 'Simulated:' })).toContainText(`mech +${value}°`);
  const afterDrag = await shown(page);
  expect(afterDrag.table.some((row) => row.includes('→'))).toBe(true);

  // The same value typed, from a reset bar.
  await setDirect(page, MECHANICAL, '0');
  expect((await shown(page)).table.some((row) => row.includes('→'))).toBe(false);
  await setDirect(page, MECHANICAL, value);
  expect(await shown(page)).toEqual(afterDrag);

  // Reset and its undo work as before, and are followed at once (no slider is held).
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await settled(page);
  await expect(slider).toHaveValue('0');
  await expect(page.getByTestId('sim-badge')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(slider).toHaveValue(value);
  await settled(page);
  expect(await shown(page)).toEqual(afterDrag);
});

test('with many files ticked the arrow keys on a slider are followed when the key is let go', async ({ page }) => {
  await loadMany(page, 48);
  const slider = page.getByRole('slider', { name: 'Electrical tilt Δ (°)', exact: true });
  await slider.focus();
  await watchWaiting(page);
  // A held key repeats: several key downs, one key up.
  for (let i = 0; i < 6; i++) await page.keyboard.down('ArrowRight');
  await expect(slider).toHaveValue('3');
  await page.keyboard.up('ArrowRight');
  expect(await sawWaiting(page)).toBe(true);
  await settled(page);
  await expect(page.locator('p.count', { hasText: 'Simulated:' })).toContainText('Δe +3°');
  const afterKeys = await shown(page);

  await setDirect(page, 'Electrical tilt Δ (°)', '0');
  await setDirect(page, 'Electrical tilt Δ (°)', '3');
  expect(await shown(page)).toEqual(afterKeys);
});

// One ticked file is followed on any machine. (With all 24 ticked it goes by what a pass takes on the machine: see the next test.)
test('with the built-in example and one file ticked the plots and the table follow a slider while it is dragged', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await expect(page.locator('.metrics tbody tr')).toHaveCount(24);
  await openSimulation(page);
  await settled(page);
  const slider = page.getByRole('slider', { name: MECHANICAL, exact: true });
  const box = (await slider.boundingBox())!;
  const y = box.y + box.height / 2;
  await watchWaiting(page);

  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + i * 6, y);
  const during = await slider.inputValue();
  // Still holding the button: the table already shows the simulation of the value under the pointer.
  await expect(page.locator('p.count', { hasText: 'Simulated:' })).toContainText(`mech +${during}°`);
  await expect(page.locator('.metrics tbody tr').first()).toContainText('→');
  await page.mouse.up();
  expect(await sawWaiting(page)).toBe(false);
});

test('with the built-in example and all 24 files ticked a drag is followed or waited for, as the machine allows, and ends exactly where a typed value does', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await openSimulation(page);
  await settled(page);
  const slider = page.getByRole('slider', { name: MECHANICAL, exact: true });
  const box = (await slider.boundingBox())!;
  const y = box.y + box.height / 2;
  // Two drags: the first is followed on the first guess, the second goes by what the first one's passes took.
  for (const from of [0, 48]) {
    await page.mouse.move(box.x + box.width / 2 + from, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + from + i * 6, y);
    const during = await slider.inputValue();
    await expect(page.getByLabel(`${MECHANICAL} value`, { exact: true })).toHaveValue(during);
    await page.mouse.up();
    await settled(page);
  }
  const value = await slider.inputValue();
  expect(Number(value)).toBeGreaterThan(0);
  await expect(page.locator('p.count', { hasText: 'Simulated:' })).toContainText(`mech +${value}°`);
  const afterDrag = await shown(page);
  expect(afterDrag.table.some((row) => row.includes('→'))).toBe(true);
  // The same value typed, from a reset bar.
  await setDirect(page, MECHANICAL, '0');
  await setDirect(page, MECHANICAL, value);
  expect(await shown(page)).toEqual(afterDrag);
});

test('a right click on a slider grips nothing: a value typed after it is followed at once, with no waiting line', async ({ page }) => {
  await loadMany(page, 48);
  const slider = page.getByRole('slider', { name: MECHANICAL, exact: true });
  const box = (await slider.boundingBox())!;
  await watchWaiting(page);
  // A context menu takes the release of the button that opened it: the page sees a pointer go down and never come up.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  const typed = page.getByLabel(`${MECHANICAL} value`, { exact: true });
  await typed.fill('5');
  await typed.press('Enter');
  await settled(page);
  await expect(page.locator('p.count', { hasText: 'Simulated:' })).toContainText('mech +5°');
  expect(await sawWaiting(page)).toBe(false);
  await page.mouse.up({ button: 'right' });
});

test('with many files ticked a run of arrow-key taps is followed once: the line waits through the taps and does not flip at each', async ({ page }) => {
  await loadMany(page, 48);
  const slider = page.getByRole('slider', { name: 'Electrical tilt Δ (°)', exact: true });
  await slider.focus();
  // Every text the line over the plots had, in order (null: no line), without repeats.
  await page.evaluate(() => {
    const w = window as unknown as { lineLog: (string | null)[] };
    w.lineLog = [];
    const note = () => {
      const text = document.querySelector('[data-testid="updating-2d"]')?.textContent ?? null;
      if (w.lineLog[w.lineLog.length - 1] !== text) w.lineLog.push(text);
    };
    new MutationObserver(note).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  for (let tap = 0; tap < 6; tap++) {
    await page.keyboard.press('ArrowRight', { delay: 40 });
    await page.waitForTimeout(140);
  }
  await expect(slider).toHaveValue('3');
  await settled(page);
  await expect(page.locator('p.count', { hasText: 'Simulated:' })).toContainText('Δe +3°');
  const log = await page.evaluate(() => (window as unknown as { lineLog: (string | null)[] }).lineLog);
  // One wait, from the first tap to the pass after the last: the waiting sentence came once.
  expect(log.filter((text) => text === WAITING), JSON.stringify(log)).toHaveLength(1);
  expect(log[0]).toBe(WAITING);
  const afterTaps = await shown(page);

  await setDirect(page, 'Electrical tilt Δ (°)', '0');
  await setDirect(page, 'Electrical tilt Δ (°)', '3');
  expect(await shown(page)).toEqual(afterTaps);
});
