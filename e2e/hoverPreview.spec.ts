import { expect, test, type Page } from '@playwright/test';
import { planetText } from '../src/test/planetText';

const COUNT = 24;
const text = (freq: number) => planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });

async function loadAllShown(page: Page) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(
    Array.from({ length: COUNT }, (_, i) => ({ name: `f${1700 + 10 * i}.msi`, mimeType: 'text/plain', buffer: Buffer.from(text(1700 + 10 * i)) })),
  );
  await expect(page.locator('.panel li')).toHaveCount(COUNT);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(page.locator('.panel li input[type="checkbox"]:checked')).toHaveCount(COUNT);
  // The first file is highlighted on load; start with no highlight.
  await page.locator('body').press('Escape');
  await expect(page.locator('[aria-current]')).toHaveCount(0);
}

/** [uid, line width, opacity] of every file trace of the horizontal cut plot, as Plotly holds them now. */
const traces = (page: Page) =>
  page.evaluate(() => {
    const gd = document.querySelector('[data-testid="plot-h"] .js-plotly-plot') as unknown as { data: { uid?: string; line?: { width?: number }; opacity?: number }[] };
    return gd.data.filter((t) => typeof t.uid === 'string').map((t) => [t.uid, t.line?.width, t.opacity ?? 1] as const);
  });
const widthOf = async (page: Page, fileName: string) => {
  const row = page.locator('tr[data-row-id]', { hasText: fileName });
  const id = await row.getAttribute('data-row-id');
  return (await traces(page)).find((t) => t[0] === id)!;
};

test('hovering or focusing a table or panel row thickens its trace and dims the others, and leaving restores it', async ({ page }) => {
  await loadAllShown(page);
  const before = await traces(page);
  expect(before).toHaveLength(COUNT);
  expect(new Set(before.map((t) => t[1]))).toEqual(new Set([1.5]));

  const row = page.locator('tr[data-row-id]', { hasText: 'f1730.msi' });
  await row.hover();
  await expect.poll(async () => (await widthOf(page, 'f1730.msi'))[1]).toBe(2.5);
  const during = await traces(page);
  expect(during.filter((t) => t[1] === 2.5)).toHaveLength(1);
  expect(during.filter((t) => t[2] === 0.35)).toHaveLength(COUNT - 1);

  await page.mouse.move(2, 2);
  await expect.poll(async () => (await traces(page)).every((t) => t[1] === 1.5 && t[2] === 1)).toBe(true);

  // A panel row, by keyboard focus (Up/Down in the panel previews the next trace).
  const first = page.locator('.panel li [data-nav]').first();
  await first.focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await traces(page)).filter((t) => t[1] === 2.5).length).toBe(1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(async () => (await traces(page)).every((t) => t[1] === 1.5)).toBe(true);
});

test('Esc ends a keyboard-focus preview', async ({ page }) => {
  await loadAllShown(page);
  await page.locator('.panel li [data-nav]').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await traces(page)).filter((t) => t[1] === 2.5).length).toBe(1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await traces(page)).every((t) => t[1] === 1.5 && t[2] === 1)).toBe(true);
});

test('a hover composes with the highlighted file: hover wins, and the highlight emphasis returns exactly', async ({ page }) => {
  await loadAllShown(page);
  await page.locator('tr[data-row-id]', { hasText: 'f1700.msi' }).click();
  await expect(page.locator('.panel li.hl')).toHaveCount(1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(async () => (await widthOf(page, 'f1700.msi'))[1]).toBe(2.5);
  const highlighted = await traces(page);
  expect(highlighted.filter((t) => t[2] === 0.35)).toHaveLength(COUNT - 1);

  await page.locator('.panel li', { hasText: 'f1750.msi' }).hover();
  await expect.poll(async () => (await widthOf(page, 'f1750.msi'))[1]).toBe(2.5);
  expect((await widthOf(page, 'f1700.msi'))[1]).toBe(1.5);

  await page.mouse.move(2, 2);
  await expect.poll(async () => JSON.stringify(await traces(page))).toBe(JSON.stringify(highlighted));
});

test.describe('touch device', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test.skip(({ browserName }) => browserName === 'firefox', 'Firefox has no touch emulation');

  test('tapping files in the drawer previews nothing: only the highlighted file is emphasised', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Load example' }).click();
    await page.getByRole('button', { name: /^Files/ }).tap();
    await expect(page.locator('.panel')).toBeVisible();
    await expect(page.locator('tr.hl[data-row-id]')).toHaveCount(1);
    const highlighted = await page.locator('tr.hl[data-row-id]').getAttribute('data-row-id');

    const boxes = page.locator('.panel li input[type="checkbox"]:not(:checked)');
    for (let i = 0; i < 3; i++) await boxes.nth(i).tap();
    await expect(page.locator('.panel li input[type="checkbox"]:checked')).toHaveCount(4);
    // Let any (wrong) preview reach the plot before looking at it.
    await page.waitForTimeout(400);
    const now = await traces(page);
    expect(now).toHaveLength(4);
    // The highlight's own emphasis: its trace thick, the others dimmed; never a preview of a tapped file.
    expect(now.filter((t) => t[1] === 2.5).map((t) => t[0])).toEqual([highlighted]);
    expect(now.filter((t) => t[2] === 0.35)).toHaveLength(3);
  });
});
