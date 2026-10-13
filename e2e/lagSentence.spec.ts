import { expect, test } from '@playwright/test';
import { holdSlider, loadMany, MECHANICAL, settled, stopOn, WAITING } from './manyFiles';

test('with the top of the bar scrolled away the sentence about a held slider stays in the top margin of the page, not on a row of controls', async ({ page }) => {
  await loadMany(page, 48);
  await page.getByRole('button', { name: 'Dismiss message' }).click();
  // Far enough for the bar's top edge to be gone, not so far that the slider's row is.
  await page.locator('main').evaluate((m) => m.scrollBy(0, 20));
  const main = (await page.locator('main').boundingBox())!;
  expect((await page.locator('.sim-bar').boundingBox())!.y).toBeLessThan(main.y);
  await holdSlider(page);
  const note = page.getByTestId('sim-lag');
  await expect(note).toHaveText(WAITING);
  const said = (await note.boundingBox())!;
  // One small line: it starts at the page's top edge and ends two px under the 12 px margin (it was 21 px high, 10 of them on the controls).
  expect(said.height).toBeLessThanOrEqual(14);
  expect(said.y).toBeGreaterThanOrEqual(main.y);
  expect(said.y + said.height).toBeLessThanOrEqual(main.y + 14);
  await stopOn(page, 4);
  await page.mouse.up();
  await settled(page);
  await expect(note).toHaveCount(0);
});

test('a slider moved by a held key with the table on the screen: the dimmed table says why, at the top of the page, and the sentence goes with the dimming', async ({ page }) => {
  await loadMany(page, 48);
  await page.getByRole('button', { name: 'Dismiss message' }).click();
  const slider = page.getByRole('slider', { name: MECHANICAL, exact: true });
  await slider.focus();
  await page.locator('#metrics-heading').evaluate((h) => h.scrollIntoView({ block: 'start' }));
  await expect(page.locator('.sim-bar')).not.toBeInViewport();
  const followers = page.locator('.follows-sim');
  const note = page.getByTestId('follows-note');
  await expect(note).toHaveCount(0);
  const tableBefore = (await page.locator('.metrics-wrap').boundingBox())!;

  await page.keyboard.down('ArrowRight');
  await expect(followers).toHaveAttribute('aria-busy', 'true');
  await expect(note).toHaveText(WAITING);
  await expect(note).toBeInViewport();
  const main = (await page.locator('main').boundingBox())!;
  const said = (await note.boundingBox())!;
  expect(said.y).toBeGreaterThanOrEqual(main.y);
  expect(said.y + said.height).toBeLessThanOrEqual(main.y + 14);
  // Not dimmed with the table, and nothing moved for it.
  expect(await note.evaluate((el) => getComputedStyle(el.closest('.follows-sim') ?? el).opacity)).toBe('1');
  expect((await page.locator('.metrics-wrap').boundingBox())!).toEqual(tableBefore);

  await page.keyboard.up('ArrowRight');
  await settled(page);
  await expect(followers).not.toHaveAttribute('aria-busy', 'true');
  await expect(note).toHaveCount(0);
});
