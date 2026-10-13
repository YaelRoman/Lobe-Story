import { expect, test, type Page } from '@playwright/test';
import { openSimulation } from './simulationBar';

async function example(page: Page) {
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
}

test('the status region says the newest line alone: a later line replaces the one before', async ({ page }) => {
  await example(page);
  const announcer = page.getByTestId('announcer');
  await expect(announcer).toContainText('Loaded the built-in synthetic example');
  await openSimulation(page);
  await page.getByRole('group', { name: 'Horizontal cut' }).getByRole('button', { name: 'At the horizon' }).click();
  await expect(announcer).toHaveText(/^\s*Horizontal cut at the horizon: every file shows its horizon cut\. Horizon level column added\.\s*$/);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(announcer).toHaveText(/^\s*Cleared 24 files\.[^.]*Undo[^.]*\.\s*$/);
});

test('the number of files a filter lists is read out once the typing has stopped', async ({ page }) => {
  await example(page);
  const announcer = page.getByTestId('announcer');
  const filter = page.getByLabel('Filter files');
  await filter.pressSequentially('1710', { delay: 40 });
  const shown = await page.locator('.panel li').count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(24);
  await expect(page.getByTestId('filter-count')).toHaveText(`${shown} of 24 files`);
  await expect(announcer).toHaveText(new RegExp(`^\\s*${shown} of 24 files match the filter\\s*$`));
  // No match has its own line in the panel, which is a status of its own: the announcer does not say it twice.
  await filter.fill('no such file');
  await expect(page.locator('.panel')).toContainText('No file matches "no such file".');
  await page.waitForTimeout(1200);
  await expect(announcer).not.toContainText('0 of 24');
});

test('a simulation slider reads its value with the unit', async ({ page }) => {
  await example(page);
  await openSimulation(page);
  const mech = page.getByRole('slider', { name: 'Mechanical tilt (°)' });
  await expect(mech).toHaveAttribute('aria-valuetext', '0 degrees');
  const box = page.getByLabel('Mechanical tilt (°) value');
  await box.fill('2.5');
  await box.press('Enter');
  await expect(mech).toHaveAttribute('aria-valuetext', '2.5 degrees');
  await box.fill('-1');
  await box.press('Enter');
  await expect(mech).toHaveAttribute('aria-valuetext', 'minus 1 degree');
});

test('the metrics table has a name, and a band cell with no value is not a button named with a dash', async ({ page }) => {
  await example(page);
  await expect(page.getByRole('table', { name: 'Metrics', exact: true })).toBeVisible();
  const band = page.getByTestId('band-stats');
  await band.getByRole('button', { name: 'Sub-bands' }).click();
  await band.getByLabel('Add a common sub-band').selectOption({ label: '880–960 MHz' });
  await expect(band.getByRole('columnheader', { name: /^880–960 MHz/ })).toContainText('0 files');
  const cells = band.locator('table.band td button');
  await expect(cells.first()).toHaveText('—');
  await expect(band.getByRole('button', { name: '—', exact: true })).toHaveCount(0);
  await expect(band.getByRole('button', { name: 'No value', exact: true })).toHaveCount(await cells.count());
});

test('the pressed button of a disabled choice is readable in both themes: at least 4.5:1, and not faded', async ({ page }) => {
  await example(page);
  await openSimulation(page);
  const pressed = page.getByRole('group', { name: '3D method' }).locator('button[aria-pressed="true"]');
  await expect(pressed).toBeDisabled();
  const contrast = () =>
    pressed.evaluate((el) => {
      const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = (c: string) => {
        const [r, g, b] = rgb(c).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const style = getComputedStyle(el);
      const [hi, lo] = [lum(style.color), lum(style.backgroundColor)].sort((a, b) => b - a);
      return { ratio: (hi + 0.05) / (lo + 0.05), opacity: style.opacity };
    });
  for (const theme of ['light', 'dark']) {
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const c = await contrast();
    expect(c.opacity, theme).toBe('1');
    expect(c.ratio, theme).toBeGreaterThanOrEqual(4.5);
    // The other one, which is not in force, stays faded: the pair still reads as disabled.
    expect(await page.getByRole('group', { name: '3D method' }).locator('button[aria-pressed="false"]').evaluate((el) => getComputedStyle(el).opacity)).toBe('0.5');
    if (theme === 'light') await page.getByRole('button', { name: 'Dark mode' }).click();
  }
});
