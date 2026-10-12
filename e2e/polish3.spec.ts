import { expect, test, type Page } from '@playwright/test';
import { openSimulation } from './simulationBar';

async function loadExample(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li, .drawer li')).not.toHaveCount(0);
}

test('a metric no file has a value for says so in place of an empty chart', async ({ page }) => {
  await loadExample(page);
  const menu = page.getByLabel('Metric', { exact: true });
  await menu.selectOption({ label: 'H-SLS (dB)' });
  const note = page.getByTestId('freq-no-value');
  await expect(note).toContainText('No file has a value for H-SLS');
  await expect(page.getByTestId('plot-hpbw')).toHaveCount(0);
  // The heading and the menu stay; another metric brings the chart back.
  await menu.selectOption({ label: 'F/B 180° (dB)' });
  await expect(page.getByTestId('plot-hpbw')).toBeVisible();
  await expect(note).toHaveCount(0);
});

test('lines of the frequency chart that lie exactly on top of each other are named under it', async ({ page }) => {
  await loadExample(page);
  const menu = page.getByLabel('Metric', { exact: true });
  const group = page.locator('.group header input[type="checkbox"]');
  for (let i = 0; i < (await group.count()); i++) await group.nth(i).check();
  await menu.selectOption({ label: 'F/B 180° (dB)' });
  // The example's +45 and −45 groups are the same patterns: their lines coincide.
  const note = page.getByTestId('freq-coincide');
  await expect(note).toContainText('lines coincide:');
  await expect(note).toContainText(' = ');
  // With one ticked file only its own group is drawn: nothing to coincide with.
  await page.getByRole('button', { name: 'Show none', exact: true }).click();
  await page.locator('.panel li input[type="checkbox"]').first().check();
  await expect(note).toHaveCount(0);
});

test('the trace note says "dashed = original" only while a simulation draws originals', async ({ page }) => {
  await loadExample(page);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  const note = page.getByTestId('readout-h').locator('p.count');
  await expect(note).toContainText('24 traces: colours as in the file panel');
  await expect(note).not.toContainText('dashed = original');
  await openSimulation(page);
  await page.getByLabel('Mechanical tilt (°) value').fill('4');
  await page.getByLabel('Mechanical tilt (°) value').press('Enter');
  await expect(note).toContainText('(dashed = original)');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(note).not.toContainText('dashed = original');
  // A pinned reference is the thick dashed line.
  await page.getByLabel(/^Actions for /).first().click();
  await page.getByRole('menuitem', { name: 'Use as reference' }).click();
  await expect(note).toContainText('The thick dashed line in the text colour is the reference');
});

test.describe('phone hit areas', () => {
  test.use({ hasTouch: true });

  test('every control a finger has to hit is at least 32 x 32 px at 390 px wide', async ({ page }) => {
    await loadExample(page, 390, 844);
    await page.getByRole('button', { name: /^Files \(/ }).click();
    await expect(page.locator('.panel')).toBeVisible();
    // The area a tap on `locator` reaches: the control itself, or its label when it has one.
    const hit = (selector: string) =>
      page.locator(selector).first().evaluate((el) => {
        const r = (el.closest('label') ?? el).getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      });
    const targets: Record<string, string> = {
      'file checkbox': '.group li input[type="checkbox"]',
      'group Show all checkbox': '.group header input[type="checkbox"]',
      'Dismiss message': 'button[aria-label="Dismiss message"]',
      'column group checkbox': 'input[aria-label="Show Beam columns"]',
      'Δ vs reference': '.delta-toggle input',
      'Ticked files only': '.delta-toggle:nth-of-type(2) input',
      'table header sort button': '.metrics .sort-btn',
      'chart toolbar button': '[data-testid="plot-h"] .modebar-btn',
    };
    const small: string[] = [];
    for (const [name, selector] of Object.entries(targets)) {
      await page.locator(selector).first().waitFor({ state: 'attached' });
      const { w, h } = await hit(selector);
      if (w < 32 || h < 32) small.push(`${name}: ${w}x${h}`);
    }
    expect(small).toEqual([]);
    // Nothing spills sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test('Settings keeps Tab inside while open and Esc gives the focus back to the Settings button', async ({ page }) => {
  await loadExample(page);
  const button = page.getByRole('button', { name: 'Settings', exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog', { name: 'Analysis settings' });
  await expect(panel).toBeVisible();
  const where = () => page.evaluate(() => (document.activeElement?.closest('.settings') ? 'panel' : document.activeElement?.tagName ?? 'none'));
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    expect(await where(), `Tab ${i + 1}`).toBe('panel');
  }
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await where(), `Shift+Tab ${i + 1}`).toBe('panel');
  }
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('Help: Tab wraps from Close to the first control and Shift+Tab back, never resting on the page body', async ({ page }) => {
  await loadExample(page);
  await page.getByRole('button', { name: 'Help', exact: true }).focus();
  await page.keyboard.press('Enter');
  const help = page.locator('dialog.help');
  await expect(help).toBeVisible();
  const at = () => page.evaluate(() => {
    const a = document.activeElement;
    return a === document.body ? 'body' : a?.closest('dialog.help') ? (a.textContent ?? '').trim().slice(0, 30) || a.tagName : 'outside';
  });
  const seen: string[] = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    seen.push(await at());
  }
  expect(seen).not.toContain('body');
  expect(seen).not.toContain('outside');
  // The links are first, Close last; one more Tab from Close goes to the first control.
  const close = help.getByRole('button', { name: 'Close' });
  await close.focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('dialog.help') !== null && document.activeElement?.tagName === 'A')).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
});
