import { expect, test, type Page } from '@playwright/test';
import { openSimulation } from './simulationBar';

async function loadExample(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.getByTestId('plot-h').locator('.main-svg').first()).toBeVisible();
  await openSimulation(page);
}

/** Where the label, the slider and the number box of every slider field of the bar are. */
const fields = (page: Page) =>
  page.locator('.sim-bar .sim-field').evaluateAll((els) =>
    els.map((el) => {
      const r = (e: Element | null) => {
        const b = e!.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height, mid: b.y + b.height / 2 };
      };
      return { name: el.getAttribute('aria-label'), field: r(el), label: r(el.querySelector('span')), slider: r(el.querySelector('input[type="range"]')), box: r(el.querySelector('input[type="number"]')) };
    }),
  );

async function pinReference(page: Page, drawer: boolean) {
  if (drawer) await page.getByRole('button', { name: /^Files \(/ }).click();
  await page.locator('summary[aria-label="Actions for example_1710_M45_02T.msi"]').click();
  await page.getByRole('menuitem', { name: 'Use as reference' }).click();
  if (drawer) await page.getByRole('button', { name: /^Files \(/ }).click();
  await page.getByLabel('Δ vs reference').check();
  const value = page.getByLabel('Mechanical tilt (°) value');
  await value.fill('2');
  await value.press('Enter');
  await expect(page.getByTestId('delta-tilted-note')).toBeVisible();
}

/** The three parts of the reference line above the table: the name, the note about tilted values, the button. */
const referenceParts = (page: Page) =>
  page.getByTestId('reference-note').evaluate((note) => {
    const r = (e: Element) => {
      const b = e.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    return { note: r(note), name: r(note.querySelector('.ref-name') ?? note), tilted: r(note.querySelector('[data-testid="delta-tilted-note"]')!), clear: r(note.querySelector('button')!) };
  });

test('on a phone a slider is as wide as its row and its number box is beside the label (R4-13)', async ({ page }) => {
  await loadExample(page, 390, 844);
  const bar = (await page.locator('.sim-bar').boundingBox())!;
  const all = await fields(page);
  // The three global sliders and the three offsets of the highlighted file.
  expect(all.map((f) => f.name)).toEqual(['Electrical tilt Δ (°)', 'Mechanical tilt (°)', 'Azimuth (°)', 'Electrical tilt offset (°)', 'Mechanical tilt offset (°)', 'Azimuth offset (°)']);
  for (const f of all) {
    // The slider has the row: the bar less its padding (it was 110 px).
    expect(f.slider.w, f.name!).toBeGreaterThanOrEqual(bar.width - 20);
    expect(f.slider.x + f.slider.w, f.name!).toBeLessThanOrEqual(bar.x + bar.width);
    // The number box is on the label's line, at the right end, and the slider is the line below.
    expect(Math.abs(f.box.mid - f.label.mid), f.name!).toBeLessThanOrEqual(8);
    expect(f.box.x, f.name!).toBeGreaterThan(f.label.x + f.label.w);
    expect(f.slider.y, f.name!).toBeGreaterThanOrEqual(Math.max(f.label.y + f.label.h, f.box.y + f.box.h) - 1);
    expect(f.box.w, f.name!).toBeGreaterThanOrEqual(60);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('on a phone the reference line above the table is three lines, each as wide as it needs', async ({ page }) => {
  await loadExample(page, 390, 844);
  await pinReference(page, true);
  const p = await referenceParts(page);
  // One under the other, from the same left edge; nothing is squeezed into a narrow column.
  expect(p.tilted.y).toBeGreaterThanOrEqual(p.name.y + p.name.h - 1);
  expect(p.clear.y).toBeGreaterThanOrEqual(p.tilted.y + p.tilted.h - 1);
  expect(Math.abs(p.tilted.x - p.name.x)).toBeLessThanOrEqual(4);
  expect(Math.abs(p.clear.x - p.name.x)).toBeLessThanOrEqual(4);
  // "Reference: example_1710_M45_02T.msi" and "Δ of tilted values" are one line each.
  expect(p.name.h).toBeLessThanOrEqual(24);
  expect(p.tilted.h).toBeLessThanOrEqual(24);
  expect(p.note.w).toBeGreaterThanOrEqual(300);
});

test('on a desktop the sliders and the reference line are as before: 140 px sliders in a row, the reference on one line', async ({ page }) => {
  await loadExample(page, 1440, 900);
  for (const f of await fields(page)) {
    expect(f.slider.w, f.name!).toBe(140);
    expect(f.box.w, f.name!).toBe(70);
    // Label, slider and number box on one line.
    expect(Math.abs(f.slider.mid - f.label.mid), f.name!).toBeLessThanOrEqual(8);
    expect(f.box.x, f.name!).toBeGreaterThan(f.slider.x + f.slider.w);
  }
  await pinReference(page, false);
  const p = await referenceParts(page);
  // Pinned from the page before this change (1440 x 900): one line, the note and the button where they were.
  expect({ height: p.note.h, tilted: p.tilted.x - p.note.x, clear: p.clear.x - p.note.x }).toEqual(REFERENCE_LINE_BEFORE);
  expect(Math.abs(p.note.w - 569)).toBeLessThanOrEqual(1);
});

const REFERENCE_LINE_BEFORE = { height: 30, tilted: 306, clear: 440 };
