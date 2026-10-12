import { expect, test, type Page } from '@playwright/test';
import { openSimulation } from './simulationBar';
import { planetText } from '../src/test/planetText';

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

test('table cells: Home/End go to the first/last cell of the row, Ctrl+Home/End to the first/last row', async ({ page }) => {
  await loadExample(page);
  const rows = page.locator('.metrics tbody tr');
  const cellsOf = (n: number) => rows.nth(n).locator('td[data-col]');
  await rows.nth(2).locator('[data-nav]').first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(cellsOf(2).nth(2)).toBeFocused();
  await page.keyboard.press('End');
  await expect(cellsOf(2).last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(cellsOf(2).first()).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+End');
  await expect(cellsOf(23).nth(2)).toBeFocused();
  await page.keyboard.press('Control+Home');
  await expect(cellsOf(0).nth(2)).toBeFocused();
});

test('a hidden "Cut plots" heading and the skip links "Skip to plots" / "Skip to table" are the first Tab stops, visible on focus', async ({ page }) => {
  await loadExample(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Cut plots' })).toBeAttached();
  const skipPlots = page.getByRole('link', { name: 'Skip to plots' });
  const skipTable = page.getByRole('link', { name: 'Skip to table' });
  // Off screen until focused.
  expect((await skipPlots.boundingBox())!.y).toBeLessThan(0);
  // They come right before the toolbar: Shift+Tab from its first button reaches the table link, then the plots link.
  await page.getByRole('button', { name: 'Open files' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(skipTable).toBeFocused();
  expect((await skipTable.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Shift+Tab');
  await expect(skipPlots).toBeFocused();
  expect((await skipPlots.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  // Nothing in the page precedes them.
  expect(await page.evaluate(() => document.querySelector('.app')?.firstElementChild?.className)).toBe('skip-links');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Cut plots' })).toBeFocused();
  await skipTable.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Metrics', exact: true })).toBeFocused();
  await expect(page.getByTestId('plot-h')).toBeAttached();
});

test.describe('long file names', () => {
  const file = (name: string, freq: number) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] })) });
  const names = ['ACME_ANT-1_Wideband_Panel_1710_X_CO_P45_02T_Y2.MSI', 'ACME_ANT-1_Wideband_Panel_1710_X_CO_P45_05T_Y2.MSI', 'ACME_ANT-1_Wideband_Panel_1710_X_CO_P45_08T_Y2.MSI'];

  test('the file panel and the table cut a long name in the middle: the start gets the ellipsis, the end stays whole', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(names.map((n) => file(n, 1710)));
    const tails = await page.locator('.panel .fname .mid-tail').allInnerTexts();
    expect(tails).toHaveLength(3);
    expect(new Set(tails).size).toBe(3); // the ends differ (02T, 05T, 08T) and all three are on screen
    for (const t of tails) expect(t).toMatch(/0[258]T_Y2\.MSI$/);
    const head = page.locator('.panel .fname .mid-head').first();
    expect(await head.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis')).toBe(true);
    // The tail is inside the panel, not cut off by it.
    const panel = (await page.locator('.panel').boundingBox())!;
    const tail = (await page.locator('.panel .fname .mid-tail').first().boundingBox())!;
    expect(tail.x + tail.width).toBeLessThanOrEqual(panel.x + panel.width);
    // The full name stays in the title and in the DOM text.
    const fname = page.locator('.panel .fname').first();
    expect(names).toContain(await fname.getAttribute('title'));
    expect(await fname.evaluate((el) => el.textContent)).toBe(await fname.getAttribute('title'));
  });

  test('the file buttons of the panel and of the table have the whole file name as their accessible name', async ({ page }) => {
    await loadExample(page);
    const name = 'example_1710_P45_02T.msi';
    // No space inside the name, although it is drawn in two pieces.
    await expect(page.locator('.panel').getByRole('button', { name: `1710 MHz ${name}`, exact: true })).toBeVisible();
    await expect(page.locator('.metrics').getByRole('button', { name, exact: true })).toBeVisible();
  });

  test('on a phone the sticky File column says "MHz · group" under the name and keeps the name end', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(names.map((n) => file(n, 1710)));
    const rows = page.locator('.metrics tbody tr');
    await expect(rows).toHaveCount(3);
    const sub = rows.first().locator('.file-sub');
    await expect(sub).toBeVisible();
    await expect(sub).toContainText('1710 MHz · ');
    const tails = await page.locator('.metrics .file-cell .mid-tail').allInnerTexts();
    expect(new Set(tails).size).toBe(3);
    // Desktop does not show the sub line.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(sub).toBeHidden();
  });
});

test.describe('3D side by side titles', () => {
  const titleBoxes = async (page: Page) => {
    const boxes = await page.getByTestId('plot-3d').locator('.infolayer g.annotation').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
    return boxes.filter((b) => b.w > 0);
  };
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  for (const width of [390, 600, 800, 1024, 1440]) {
    test(`at ${width} px wide the six scene titles do not overlap and sit in their own scene's column`, async ({ page }) => {
      await loadExample(page, width, width < 700 ? 844 : 900);
      if (width < 700) await page.getByRole('button', { name: /^Files \(/ }).click();
      await page.getByRole('button', { name: 'Show all', exact: true }).click();
      if (width < 700) await page.getByRole('button', { name: /^Files \(/ }).click();
      await page.getByRole('button', { name: '3D', exact: true }).click();
      const plot = page.getByTestId('plot-3d');
      await expect(plot.locator('.infolayer g.annotation')).toHaveCount(6);
      await expect.poll(async () => (await titleBoxes(page)).length).toBe(6);
      const boxes = await titleBoxes(page);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j]), `titles ${i} and ${j}`).toBe(false);
      const columns = new Set(boxes.map((b) => Math.round(b.x / 20))).size;
      expect(columns).toBe(width < 420 ? 1 : width <= 760 ? 2 : 3);
      // Each title lies inside the plot's width.
      const area = (await plot.boundingBox())!;
      for (const b of boxes) expect(b.x + b.w).toBeLessThanOrEqual(area.x + area.width + 1);
    });
  }

  // Fewer scenes use fewer columns and wider titles: two and three ticked files, on a narrow and a wide desktop.
  for (const width of [800, 1024]) {
    for (const ticked of [2, 3]) {
      test(`at ${width} px wide ${ticked} ticked files have non-overlapping titles in two columns`, async ({ page }) => {
        await loadExample(page, width, 900);
        await page.getByRole('button', { name: 'Show none', exact: true }).click();
        const boxesToTick = page.locator('.panel li input[type="checkbox"]');
        for (let i = 0; i < ticked; i++) await boxesToTick.nth(i).check();
        await page.getByRole('button', { name: '3D', exact: true }).click();
        const plot = page.getByTestId('plot-3d');
        await expect(plot.locator('.infolayer g.annotation')).toHaveCount(ticked);
        await expect.poll(async () => (await titleBoxes(page)).length).toBe(ticked);
        const boxes = await titleBoxes(page);
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j]), `titles ${i} and ${j}`).toBe(false);
        expect(new Set(boxes.map((b) => Math.round(b.x / 20))).size).toBe(2);
        const area = (await plot.boundingBox())!;
        for (const b of boxes) expect(b.x + b.w).toBeLessThanOrEqual(area.x + area.width + 1);
      });
    }
  }
});

test('a double click on a point of the frequency chart highlights its file once, it does not toggle twice', async ({ page }) => {
  await loadExample(page);
  const hl = page.locator('.metrics tbody tr.hl');
  await page.keyboard.press('Escape');
  await expect(hl).toHaveCount(0);
  const chart = page.getByTestId('plot-hpbw');
  const points = chart.locator('.scatterlayer .trace').first().locator('.points path');
  await expect(points.first()).toBeAttached();
  await chart.scrollIntoViewIfNeeded();
  const box = (await points.nth((await points.count()) - 1).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 - 5, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await expect(chart.locator('.hoverlayer .hovertext').first()).toBeAttached();
  // Record every change of the number of highlighted rows and the clicks the page receives, from before the double click.
  await page.evaluate(() => {
    const w = window as unknown as { hlCounts: number[]; clicks: number };
    w.hlCounts = [];
    w.clicks = 0;
    document.addEventListener('click', () => w.clicks++, true);
    const body = document.querySelector('.metrics tbody')!;
    const count = () => body.querySelectorAll('tr.hl').length;
    new MutationObserver(() => {
      if (w.hlCounts[w.hlCounts.length - 1] !== count()) w.hlCounts.push(count());
    }).observe(body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  });
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(hl).toHaveCount(1);
  // Both clicks reached the page, and whatever they trigger has had its frames and tasks to run: the state is the
  // same afterwards. (Not a fixed wait: the second click is what could undo the first.)
  await expect.poll(() => page.evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(2);
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 0)))));
  await expect(hl).toHaveCount(1);
  // The count went from none to one and never back: no toggle on and off again.
  expect(await page.evaluate(() => (window as unknown as { hlCounts: number[] }).hlCounts)).toEqual([1]);
});

test('on a phone the chart toolbar lies in a strip above each plot, not over its title or labels', async ({ page }) => {
  await loadExample(page, 390, 844);
  for (const id of ['plot-h', 'plot-v', 'plot-hpbw']) {
    const plot = page.getByTestId(id);
    await plot.scrollIntoViewIfNeeded();
    const { bar, box } = await plot.evaluate((el) => {
      const b = el.querySelector('.modebar-container')!.getBoundingClientRect();
      const p = el.getBoundingClientRect();
      return { bar: { top: b.top, bottom: b.bottom, left: b.left, right: b.right }, box: { top: p.top, left: p.left, right: p.right } };
    });
    // The whole toolbar is on screen (the plot was scrolled into view above).
    expect(bar.top, id).toBeGreaterThanOrEqual(0);
    expect(bar.bottom, id).toBeLessThanOrEqual(844);
    expect(await plot.locator('.modebar-btn').count(), id).toBeGreaterThan(0);
    const btn = (await plot.locator('.modebar-btn').first().boundingBox())!;
    expect(btn.y + btn.height, `${id}: toolbar bottom ${btn.y + btn.height} against plot top ${box.top}`).toBeLessThanOrEqual(box.top + 1);
    expect(btn.x).toBeGreaterThanOrEqual(box.left - 1);
  }
});

test('metrics table rows have whole-pixel heights so the sticky File column and the other cells draw their row lines at the same place', async ({ page }) => {
  for (const [w, h] of [[1440, 900], [390, 844]] as const) {
    await loadExample(page, w, h);
    const heights = await page.locator('.metrics tbody tr').evaluateAll((rows) =>
      rows.map((tr) => {
        const [a, b] = [...tr.children].slice(0, 2).map((c) => c.getBoundingClientRect());
        return { row: tr.getBoundingClientRect().height, first: a.height, second: b.height, bottomGap: Math.abs(a.bottom - b.bottom) };
      }),
    );
    expect(heights).toHaveLength(24);
    for (const r of heights) {
      expect(Math.abs(r.row - Math.round(r.row)), `${w}: row height ${r.row}`).toBeLessThan(0.02);
      expect(r.first).toBeCloseTo(r.second, 2);
      expect(r.bottomGap).toBeLessThan(0.02);
    }
  }
});

test.describe('phone file drawer', () => {
  test.use({ hasTouch: true });

  const inside = (inner: { y: number; height: number }, outer: { y: number; height: number }) => inner.y >= outer.y - 1 && inner.y + inner.height <= outer.y + outer.height + 1;

  test('uses about 70 % of the screen height, and an opened ⋯ menu or tag editor is scrolled fully into view', async ({ page }) => {
    await loadExample(page, 390, 844);
    await page.getByRole('button', { name: /^Files \(/ }).click();
    const panel = page.locator('.panel');
    await expect(panel).toBeVisible();
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.height).toBeGreaterThan(844 * 0.6);
    expect(panelBox.height).toBeLessThanOrEqual(844 * 0.7 + 1);

    // The ⋯ menu of a row near the bottom of what the drawer shows: every item, down to Remove, ends up inside it.
    const rows = panel.locator('.group li');
    const index = 5;
    await rows.nth(index).scrollIntoViewIfNeeded();
    await rows.nth(index).locator('summary').click();
    const remove = rows.nth(index).getByRole('menuitem', { name: 'Remove' });
    await expect(remove).toBeVisible();
    await expect.poll(async () => inside((await remove.boundingBox())!, (await panel.boundingBox())!)).toBe(true);
    await page.keyboard.press('Escape');

    // The tag editor's Save and Cancel are not cut by the drawer edge.
    const last = rows.nth(8);
    await last.scrollIntoViewIfNeeded();
    await last.getByRole('button', { name: /^Edit tags of / }).click();
    const save = panel.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeVisible();
    await expect.poll(async () => inside((await save.boundingBox())!, (await panel.boundingBox())!)).toBe(true);
  });
});

test('clicking a point of the frequency chart highlights that file (again: clears) and scrolls its table row into view', async ({ page }) => {
  await loadExample(page);
  const hl = page.locator('.metrics tbody tr.hl');
  // The example highlights its first file on load; clear it so the click is what highlights.
  await page.keyboard.press('Escape');
  await expect(hl).toHaveCount(0);
  const chart = page.getByTestId('plot-hpbw');
  await expect(chart.locator('.scatterlayer .trace').first()).toBeAttached();
  // The ticked file's group is drawn (the first group); click the last point of its H line.
  const points = chart.locator('.scatterlayer .trace').first().locator('.points path');
  const count = await points.count();
  expect(count).toBeGreaterThanOrEqual(4);
  const clickLast = async () => {
    await chart.scrollIntoViewIfNeeded();
    const box = (await points.nth(count - 1).boundingBox())!;
    // The library finds the point under the pointer on a move, then reports the click.
    await page.mouse.move(box.x + box.width / 2 - 5, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await expect(chart.locator('.hoverlayer .hovertext').first()).toBeAttached();
    await page.mouse.down();
    await page.mouse.up();
  };
  await clickLast();
  await expect(hl).toHaveCount(1);
  await expect(hl.locator('td').nth(2)).toHaveText('2170');
  await expect(page.locator('.panel li.hl')).toHaveCount(1);
  // The row is inside the table's scroll area.
  const wrap = (await page.locator('.metrics-wrap').boundingBox())!;
  const row = (await hl.boundingBox())!;
  expect(row.y).toBeGreaterThanOrEqual(wrap.y - 1);
  expect(row.y + row.height).toBeLessThanOrEqual(wrap.y + wrap.height + 1);
  // Again: clears, as a second click on a row does.
  await clickLast();
  await expect(hl).toHaveCount(0);

  // With every file ticked, a point of the last group is a file far down the table: the table scrolls to it.
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(page.locator('.metrics tbody tr')).toHaveCount(24);
  await chart.scrollIntoViewIfNeeded();
  const lastTrace = chart.locator('.scatterlayer .trace').last();
  await expect.poll(async () => lastTrace.locator('.points path').count()).toBeGreaterThanOrEqual(1);
  const lastPoints = lastTrace.locator('.points path');
  const n = await lastPoints.count();
  const p = (await lastPoints.nth(n - 1).boundingBox())!;
  await page.mouse.move(p.x + p.width / 2 - 5, p.y + p.height / 2);
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2, { steps: 4 });
  await page.mouse.down();
  await page.mouse.up();
  await expect(hl).toHaveCount(1);
  const index = await page.locator('.metrics tbody tr').evaluateAll((rows) => rows.findIndex((r) => r.classList.contains('hl')));
  expect(index).toBeGreaterThanOrEqual(16);
  await expect.poll(async () => page.locator('.metrics-wrap').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const wrap2 = (await page.locator('.metrics-wrap').boundingBox())!;
  const row2 = (await hl.boundingBox())!;
  expect(row2.y).toBeGreaterThanOrEqual(wrap2.y - 1);
  expect(row2.y + row2.height).toBeLessThanOrEqual(wrap2.y + wrap2.height + 1);
});

test('the sub-band editor says when a typed minimum above the maximum was swapped', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  const band = page.getByTestId('band-stats');
  await band.getByRole('button', { name: 'Sub-bands' }).click();
  await band.getByRole('button', { name: 'Start from automatic' }).click();
  const note = band.getByTestId('subband-note');
  await expect(note).toBeHidden();
  const min = band.getByLabel('Sub-band 1 min (MHz)');
  await min.fill('3000');
  await min.press('Enter');
  // The range is kept by swapping, as before, and now it is said (visibly, and in a status region).
  await expect(band.locator('table.band thead th', { hasText: /^1795–3000 MHz/ })).toBeVisible();
  await expect(note).toBeVisible();
  await expect(note).toHaveText('Sub-band 1: the minimum 3000 MHz is above the maximum 1795 MHz, so the two were swapped (1795–3000 MHz).');
  await expect(note).toHaveAttribute('role', 'status');
  await expect(band.getByLabel('Sub-band 1 min (MHz)')).toHaveValue('1795');
  await expect(band.getByLabel('Sub-band 1 max (MHz)')).toHaveValue('3000');
  // An ordinary edit clears it.
  const max = band.getByLabel('Sub-band 1 max (MHz)');
  await max.fill('2500');
  await max.press('Enter');
  await expect(note).toBeHidden();
});

test('Load example then Show all leaves one status bar: the undo offer takes the place of the load line', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('.panel li')).toHaveCount(24);
  const bars = page.locator('.status-area .load-message');
  await expect(page.getByTestId('load-status')).toContainText('Loaded the built-in synthetic example');
  await expect(bars).toHaveCount(1);
  const top = (await page.locator('.sim-bar').boundingBox())!.y;
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(page.getByTestId('undo-toast')).toContainText('Showed all files');
  await expect(bars).toHaveCount(1);
  await expect(page.getByTestId('load-status')).toHaveCount(0);
  // The page under the bar has not moved down by a line.
  expect((await page.locator('.sim-bar').boundingBox())!.y).toBe(top);
  // Both lines were read out.
  await expect(page.getByTestId('announcer')).toContainText('Showed all files');
});
