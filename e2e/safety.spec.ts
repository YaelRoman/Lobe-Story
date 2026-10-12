import { expect, test, type Page } from '@playwright/test';
import { planetText } from '../src/test/planetText';
import { openSimulation } from './simulationBar';

const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const msi = (freq: number) =>
  planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });
const project = (path: string, freq: number) =>
  JSON.stringify({
    format: 'lobe-story-project',
    version: 1,
    savedAt: '2026-01-01T00:00:00.000Z',
    files: [{ path, text: msi(freq) }],
    state: { names: { [path]: 'From project' } },
  });

test('a failed file among many is reported, listed first and reachable from the status line', async ({ page }) => {
  await page.goto('/');
  const good = Array.from({ length: 60 }, (_, i) => file(`_${1700 + i}_X_CO_P45_08T_Y2.MSI`, msi(1700 + i)));
  await page.getByTestId('file-input').setInputFiles([
    ...good,
    file('corrupt.pln', 'NAME X\nFREQUENCY 900\n'),
    file('notes.txt', 'buy cables\nmeeting at 10\n'),
  ]);
  const status = page.getByTestId('load-status');
  await expect(status).toContainText('Loaded 60 files · 2 could not be loaded');
  // The one live region says the same, and the Errors section is named in the same words.
  await expect(page.getByRole('status')).toContainText('2 could not be loaded');
  await expect(page.getByRole('region', { name: 'Files that could not be loaded' })).toBeVisible();

  const panel = page.locator('.panel');
  const errors = page.getByTestId('panel-errors');
  await expect(errors).toContainText('Missing HORIZONTAL block');
  await expect(errors).toContainText('Not a Planet pattern file');
  // The Errors section is the first thing in the panel, not below 60 rows.
  const [p, e] = await Promise.all([panel.boundingBox(), errors.boundingBox()]);
  expect(e!.y - p!.y).toBeLessThan(40);

  await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await status.getByRole('button', { name: 'Show errors' }).click();
  await expect(errors).toBeInViewport();
  await expect(errors).toBeFocused();
});

test('same name with different content is kept as a numbered entry; identical content is skipped', async ({ page }) => {
  await page.goto('/');
  const input = page.getByTestId('file-input');
  await input.setInputFiles([file('antenna.msi', msi(1910))]);
  await expect(page.getByRole('status')).toHaveText(/^Loaded 1 file/);

  await input.setInputFiles([file('antenna.msi', msi(1930))]);
  await expect(page.getByRole('status')).toContainText('1 same-name file with different content added as a numbered copy');
  const panel = page.locator('.panel');
  await expect(panel.getByText('1910 MHz')).toBeVisible();
  await expect(panel.getByText('1930 MHz')).toBeVisible();
  await expect(panel.getByText('antenna (2).msi', { exact: true })).toBeVisible();
  await expect(panel.locator('li')).toHaveCount(2);

  await input.setInputFiles([file('antenna.msi', msi(1930)), file('antenna.msi', msi(1910))]);
  await expect(page.getByRole('status')).toContainText('2 already loaded (skipped)');
  await expect(panel.locator('li')).toHaveCount(2);
});

test('a project chosen through Open files opens as a project', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('p.lobestory.json', project('p.MSI', 2100))]);
  await expect(page.locator('.panel').getByText('From project', { exact: true })).toBeVisible();

  // With pattern files next to it the app asks; opening over a session then asks to replace it.
  await page.getByTestId('file-input').setInputFiles([file('other.msi', msi(1800)), file('q.lobestory.json', project('q.MSI', 2200))]);
  const ask = page.getByRole('dialog', { name: 'This selection contains a project file: q.lobestory.json' });
  await ask.getByRole('button', { name: 'Open the project' }).click();
  await page.getByRole('dialog', { name: 'Replace the current session?' }).getByRole('button', { name: 'Replace' }).click();
  await expect(page.locator('.panel').getByText('2200 MHz')).toBeVisible();
  await expect(page.locator('.panel').getByText('1800 MHz')).toBeVisible();
  await expect(page.locator('.panel').getByText('2100 MHz')).toHaveCount(0);
  await expect(page.getByTestId('undo-toast')).toBeVisible();
});

test('pattern files with one project file: the three answers', async ({ page }) => {
  await page.goto('/');
  const input = page.getByTestId('file-input');
  const panel = page.locator('.panel');
  const selection = [file('a.msi', msi(1800)), file('p.lobestory.json', project('p.MSI', 2100))];
  const ask = page.getByRole('dialog', { name: 'This selection contains a project file: p.lobestory.json' });

  await input.setInputFiles(selection);
  await expect(ask.getByRole('button')).toHaveText(['Cancel', 'Open the project', 'Load the pattern files only']);
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Open or drop Planet pattern files')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('');

  await input.setInputFiles(selection);
  await ask.getByRole('button', { name: 'Load the pattern files only' }).click();
  await expect(panel.getByText('1800 MHz')).toBeVisible();
  await expect(panel.getByText('From project', { exact: true })).toHaveCount(0);
  await expect(panel.locator('li')).toHaveCount(1);

  // A session is open now: "Open the project" still asks before replacing it, and Cancel there keeps it.
  await input.setInputFiles(selection);
  await ask.getByRole('button', { name: 'Open the project' }).click();
  const replace = page.getByRole('dialog', { name: 'Replace the current session?' });
  await replace.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel.locator('li')).toHaveCount(1);
  await input.setInputFiles(selection);
  await ask.getByRole('button', { name: 'Open the project' }).click();
  await replace.getByRole('button', { name: 'Replace' }).click();
  await expect(panel.getByText('From project', { exact: true })).toBeVisible();
  await expect(panel.getByText('1800 MHz')).toBeVisible();
});

test('a stray .json or several project files among pattern files open nothing', async ({ page }) => {
  await page.goto('/');
  const input = page.getByTestId('file-input');
  const panel = page.locator('.panel');
  // Any other .json in a multi-file selection is not a project candidate: no question, no error.
  await input.setInputFiles([file('a.msi', msi(1800)), file('export.json', project('x.MSI', 2500))]);
  await expect(panel.getByText('1800 MHz')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('load-status')).toHaveText(/^Loaded 1 file/);

  await input.setInputFiles([
    file('b.msi', msi(1900)),
    file('p.lobestory.json', project('p.MSI', 2100)),
    file('q.lobestory.json', project('q.MSI', 2200)),
  ]);
  await expect(page.getByTestId('load-status')).toContainText('Loaded 1 file · 2 project files found — open one with Open project');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(panel.locator('li')).toHaveCount(2);

  // On its own, any .json is tried as a project; the dedicated input takes any .json too.
  await input.setInputFiles([file('export.json', '{"some":"thing"}')]);
  await expect(page.getByTestId('load-status')).toContainText('Not a Lobe-Story project.');
  await expect(panel.locator('li')).toHaveCount(2);
});

test('the status line: one live region, clean loads go away, warnings stay', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveText('');
  const input = page.getByTestId('file-input');
  const line = page.getByTestId('load-status');

  await input.setInputFiles([file('a.msi', msi(1800))]);
  await expect(line).toHaveText(/^Loaded 1 file/);
  await expect(line).toHaveClass(/info/);
  await expect(page.getByRole('status')).toHaveText('Loaded 1 file');
  await page.clock.fastForward(7000);
  await expect(line).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('');

  await input.setInputFiles([file('a.msi', msi(1800)), file('bad.pln', 'NAME X\nFREQUENCY 900\n')]);
  await expect(line).toContainText('1 could not be loaded · 1 already loaded (skipped)');
  await expect(line).not.toHaveClass(/info/);
  await page.clock.fastForward(60_000);
  await expect(line).toBeVisible();
  // Removing the file the line is about takes the line with it; focus stays in the panel.
  await page.getByRole('button', { name: 'Remove bad.pln' }).click();
  await expect(line).toHaveCount(0);
  await expect(page.locator('.panel')).toBeFocused();
  await expect(page.getByRole('status')).toContainText('Removed bad.pln. Undo: ');
});

test('the undo offer waits while it is hovered or focused, and focus moves to a neighbour after Remove', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800)), file('b.msi', msi(1900)), file('c.msi', msi(2000))]);
  const toast = page.getByTestId('undo-toast');

  await page.getByLabel('Actions for b.msi').click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(toast.getByRole('button', { name: /^Undo · (Ctrl\+Z|⌘Z)$/ })).toBeVisible();
  await expect(page.getByLabel('Actions for c.msi')).toBeFocused();

  await toast.hover();
  await page.clock.fastForward(30_000);
  await expect(toast).toBeVisible();
  await page.locator('h1').hover();
  await toast.getByRole('button', { name: 'Hide undo offer' }).focus();
  await page.clock.fastForward(30_000);
  await expect(toast).toBeVisible();
  await page.getByLabel('Actions for c.msi').focus();
  await page.clock.fastForward(11_000);
  await expect(toast).toHaveCount(0);

  // The last row: focus goes to the one before it.
  await page.getByLabel('Actions for c.msi').click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(page.getByLabel('Actions for a.msi')).toBeFocused();
});

test('hiding the undo offer keeps the focus on the page and says that Ctrl/Cmd+Z still undoes', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800)), file('b.msi', msi(1900)), file('c.msi', msi(2000))]);
  const toast = page.getByTestId('undo-toast');
  await page.getByLabel('Actions for b.msi').click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(toast).toBeVisible();
  const hide = toast.getByRole('button', { name: 'Hide undo offer' });

  // Focus came from a row's menu button: it goes back there.
  const before = page.getByLabel('Actions for c.msi');
  await before.focus();
  await hide.focus();
  await page.keyboard.press('Enter');
  await expect(toast).toHaveCount(0);
  await expect(before).toBeFocused();
  // The hint is text, shown and announced once, not only a tooltip.
  await expect(page.getByTestId('copy-note')).toContainText(/(Ctrl|⌘)\+?Z still undoes/);
  await expect(page.getByTestId('announcer')).toContainText('still undoes');
  // And the undo still works.
  await page.locator('h1').click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.panel li')).toHaveCount(3);
});

test('hiding the undo offer with nothing focused before it does not drop the focus to the page body', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800)), file('b.msi', msi(1900))]);
  const toast = page.getByTestId('undo-toast');
  await page.getByLabel('Actions for b.msi').click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(toast).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await toast.getByRole('button', { name: 'Hide undo offer' }).click();
  await expect(toast).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
});

test('an edit after Remove withdraws the undo; Ctrl+Z then does nothing', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800)), file('b.msi', msi(1900))]);
  const panel = page.locator('.panel');
  const toast = page.getByTestId('undo-toast');
  await page.getByLabel('Actions for b.msi').click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(toast).toBeVisible();
  // Selecting a row is not an edit.
  await panel.getByText('1800 MHz').click();
  await expect(toast).toBeVisible();
  await page.getByLabel('Actions for a.msi').click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(toast).toHaveCount(0);
  await page.locator('h1').click();
  await page.keyboard.press('Control+z');
  await expect(panel.locator('li')).toHaveCount(2);
  await expect(panel.getByText('1900 MHz')).toHaveCount(0);
});

test('Clear asks first, then Undo and Ctrl+Z bring the whole session back', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800)), file('b.msi', msi(1900))]);
  const panel = page.locator('.panel');
  await page.getByLabel('Actions for a.msi').click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  await page.getByLabel('Name for a.msi').fill('Alpha');
  await page.getByLabel('Name for a.msi').press('Enter');
  await expect(panel.getByText('Alpha', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(panel.getByText('Alpha', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByText('Open or drop Planet pattern files')).toBeVisible();
  const toast = page.getByTestId('undo-toast');
  await expect(toast).toContainText('Cleared 2 files');
  await toast.getByRole('button', { name: /^Undo/ }).click();
  await expect(panel.getByText('Alpha', { exact: true })).toBeVisible();
  await expect(panel.getByText('1900 MHz')).toBeVisible();
  await expect(toast).toHaveCount(0);

  // Ctrl+Z, but not while typing in a text field.
  await page.getByLabel('Actions for b.msi').click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(toast).toContainText('Removed b.msi');
  await expect(panel.getByText('1900 MHz')).toHaveCount(0);
  await openSimulation(page);
  await page.getByLabel('Mechanical tilt (°) value').focus();
  await page.keyboard.press('Control+z');
  await expect(panel.getByText('1900 MHz')).toHaveCount(0);
  // A checkbox is not a text field: the shortcut works from there.
  await page.getByLabel('Show Alpha').focus();
  await page.keyboard.press('Control+z');
  await expect(panel.getByText('1900 MHz')).toBeVisible();
});

test('Delete group can be undone', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800))]);
  await page.getByLabel('Actions for a.msi').click();
  await page.getByRole('menuitem', { name: 'Create site…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
  const panel = page.locator('.panel');
  await expect(panel.getByText('Site 1', { exact: true })).toBeVisible();
  await page.getByLabel('Actions for group Site 1').click();
  await page.getByRole('menuitem', { name: 'Delete group' }).click();
  await expect(panel.getByText('Site 1', { exact: true })).toHaveCount(0);
  await page.getByTestId('undo-toast').getByRole('button', { name: /^Undo/ }).click();
  await expect(panel.getByText('Site 1', { exact: true })).toBeVisible();
  await expect(panel.getByText('Sector A', { exact: true })).toBeVisible();
});

test('the page asks before unloading only while there is unsaved work', async ({ page }) => {
  await page.goto('/');
  // Dispatch the event ourselves: a real reload would raise a dialog and could hang the test.
  const prevented = () =>
    page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
  expect(await prevented()).toBe(false);
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800))]);
  await expect(page.locator('.panel')).toBeVisible();
  expect(await prevented()).toBe(true);

  await page.getByRole('button', { name: 'Save project' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await download;
  expect(await prevented()).toBe(false);
  // Everything a project stores counts, e.g. the plot type; putting it back makes the session saved again.
  await page.getByRole('button', { name: 'Rectangular' }).click();
  expect(await prevented()).toBe(true);
  await page.getByRole('button', { name: 'Polar' }).click();
  expect(await prevented()).toBe(false);
  await page.getByLabel('Actions for a.msi').click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  expect(await prevented()).toBe(true);
});

test('Reset offers sliders only or everything', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800))]);
  await openSimulation(page);
  const mech = page.getByLabel('Mechanical tilt (°) value');
  await mech.fill('4');
  await mech.press('Enter');
  const offset = page.getByLabel('Azimuth offset (°) value');
  await offset.fill('20');
  await offset.press('Enter');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('"Reset everything" also returns the horizontal cut to "Through the beam peak"');
  await page.getByRole('dialog').getByRole('button', { name: 'Reset sliders only' }).click();
  await expect(mech).toHaveValue('0');
  await expect(page.getByLabel('Offsets: az +20°')).toBeVisible();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset everything' }).click();
  await expect(page.getByLabel('Offsets: az +20°')).toHaveCount(0);
});

test('opening a project together with its own pattern files says so calmly instead of "already loaded"', async ({ page }) => {
  await page.goto('/');
  // The project holds p.MSI; the selection carries the same file next to it.
  await page.getByTestId('file-input').setInputFiles([file('p.MSI', msi(2100)), file('p.lobestory.json', project('p.MSI', 2100))]);
  await page.getByRole('dialog', { name: 'This selection contains a project file: p.lobestory.json' }).getByRole('button', { name: 'Open the project' }).click();
  const status = page.getByTestId('load-status');
  await expect(status).toHaveText(/^Opened project p\.lobestory\.json: 1 file/);
  await expect(status).not.toContainText('skipped');
  await expect(status).toHaveClass(/info/);
  await expect(page.locator('.panel').getByText('From project', { exact: true })).toBeVisible();
});

test('a file with an implausible gain or a frequency of 0 loads with a warning mark and is left out of the frequency chart', async ({ page }) => {
  await page.goto('/');
  const text = (freq: number, gain: string) => planetText({ headers: ['NAME A', `FREQUENCY ${freq}`, `GAIN ${gain}`, 'TILT ELECTRICAL'] });
  await page.getByTestId('file-input').setInputFiles([
    file('ok.msi', text(1800, '15 dBd')),
    file('loud.msi', text(1900, '999 dBi')),
    file('zero.msi', text(0, '15 dBd')),
  ]);
  const panel = page.locator('.panel');
  await expect(panel.locator('li')).toHaveCount(3);
  await expect(panel.locator('li', { hasText: 'ok.msi' }).locator('.warn')).toHaveCount(0);
  await expect(panel.locator('li', { hasText: 'loud.msi' }).locator('.warn')).toHaveAttribute('title', /outside -10 to 40 dBi/);
  await expect(panel.locator('li', { hasText: 'zero.msi' }).locator('.warn')).toHaveAttribute('title', /not above 0 MHz/);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(page.getByTestId('freq-left-out')).toHaveText('1 ticked file has no frequency above 0 MHz and is left out of this chart.');
});

test('Ctrl+Z still undoes a Remove after the toast has faded, and says "Nothing to undo" afterwards', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800)), file('b.msi', msi(1900))]);
  const panel = page.locator('.panel');
  await page.getByLabel('Actions for b.msi').click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(panel.locator('li')).toHaveCount(1);
  await page.locator('h1').hover();
  await page.clock.fastForward(11_000);
  await expect(page.getByTestId('undo-toast')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(panel.locator('li')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('copy-note')).toHaveText('Nothing to undo');
  await expect(page.getByRole('status')).toContainText('Nothing to undo');
  await expect(panel.locator('li')).toHaveCount(2);
});

test('Save project and Open project say what they did in the status line', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800)), file('b.msi', msi(1900))]);
  const status = page.getByTestId('load-status');
  await page.getByRole('button', { name: 'Save project' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await download;
  await expect(status).toHaveText(/^Saved lobe-story-\d{4}-\d{2}-\d{2}\.lobestory\.json \(2 files, with pattern data\)/);
  const path = await saved.path();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByTestId('project-input').setInputFiles(path);
  await expect(status).toHaveText(/^Opened project .*: 2 files/);
});

test('on a phone the undo offer of a Remove is one line: the button says Undo and the file name keeps its end', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('empty-state').getByRole('button', { name: 'Load example' }).click();
  await page.locator('.files-toggle').click();
  await page.getByLabel('Actions for example_1710_P45_02T.msi').click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  const toast = page.getByTestId('undo-toast');
  await expect(toast).toBeVisible();
  // The button is short in the phone's layout: the room goes to the name.
  await expect(toast.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  // The whole name is in the page, on one line with the words before it and the buttons (it was three lines, 73 px).
  await expect(toast.locator('.undo-label')).toHaveText('Removed example_1710_P45_02T.msi.');
  const box = (await toast.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(52);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  // The end of the name, which tells the files apart, is whole and inside the offer; the start is cut, on the same line.
  const tail = toast.locator('.mid-tail');
  await expect(tail).toHaveText('P45_02T.msi');
  const parts = await toast.evaluate((offer) => {
    const rect = (selector: string) => offer.querySelector(selector)!.getBoundingClientRect();
    const [name, shown, tail, button] = ['.undo-name', '.mid-head.cut > :first-child', '.mid-tail', 'button'].map(rect);
    return { name, shown, tail, button, kept: offer.querySelector('.mid-head.cut > :first-child')!.textContent ?? '' };
  });
  expect(Math.round(parts.tail.top)).toBe(Math.round(parts.shown.top));
  expect(parts.tail.right).toBeLessThanOrEqual(parts.name.right + 0.5);
  expect(parts.name.right).toBeLessThanOrEqual(parts.button.left);
  // The cut is where the room ends, not earlier: some of the start is kept, and no gap is left between the ellipsis and
  // the end of the name (the ellipsis is drawn at the end of the kept start; a gap there reads as a space in the name).
  expect(parts.kept.length).toBeGreaterThanOrEqual(3);
  expect('example_1710_'.startsWith(parts.kept)).toBe(true);
  expect(Math.abs(parts.tail.left - parts.shown.right)).toBeLessThanOrEqual(0.5);
  // The text of the offer is what it says, in one piece: no ellipsis character, no break inside the name or before the full stop.
  expect(await toast.locator('.undo-label').innerText()).toBe('Removed example_1710_P45_02T.msi.');
  expect(await toast.ariaSnapshot()).toContain('Removed example_1710_P45_02T.msi.');

  // With room for the whole name nothing is cut.
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(toast.locator('.mid-head.cut')).toHaveCount(0);
  expect(await toast.locator('.undo-label').innerText()).toBe('Removed example_1710_P45_02T.msi.');
  // And back: the cut is measured again.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toast.locator('.mid-head.cut')).toHaveCount(1);
  expect((await toast.boundingBox())!.height).toBeLessThanOrEqual(52);
});

test('pressing Undo in the offer by keyboard does not drop the focus to the page body', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800)), file('b.msi', msi(1900)), file('c.msi', msi(2000))]);
  const toast = page.getByTestId('undo-toast');
  await page.getByLabel('Actions for b.msi').click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  // After a Remove the focus is on the neighbour's menu button: from there into the offer, and back there after Undo.
  const neighbour = page.getByLabel('Actions for c.msi');
  await expect(neighbour).toBeFocused();
  await toast.getByRole('button', { name: /^Undo/ }).focus();
  await page.keyboard.press('Enter');
  await expect(toast).toHaveCount(0);
  await expect(page.locator('.panel li')).toHaveCount(3);
  await expect(neighbour).toBeFocused();

  // An undone Clear: nothing was focused before the offer (the page was empty), and the plots' heading is back to take it.
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'Clear' });
  if (await confirm.count()) await confirm.click();
  await expect(page.locator('.panel li')).toHaveCount(0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await toast.getByRole('button', { name: /^Undo/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.panel li')).toHaveCount(3);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
});

/** What the page says about the undo key after a Remove: on the offer's button, its cross, the note after hiding and in the status region. */
async function undoWordsAfterRemove(page: Page) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800)), file('b.msi', msi(1900)), file('c.msi', msi(2000))]);
  // The drawer button exists only once the files are in the store; isVisible() does not wait for that.
  await expect(page.locator('.panel li')).toHaveCount(3);
  const drawer = page.locator('.files-toggle');
  if (await drawer.isVisible()) await drawer.click();
  await page.getByLabel('Actions for b.msi').click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  const toast = page.getByTestId('undo-toast');
  await expect(toast).toBeVisible();
  await expect(page.getByTestId('announcer')).toContainText('Removed b.msi.');
  const hide = toast.getByRole('button', { name: 'Hide undo offer' });
  const words = {
    button: await toast.getByRole('button', { name: /^Undo/ }).innerText(),
    offer: await toast.innerText(),
    hideTitle: await hide.getAttribute('title'),
    spoken: await page.getByTestId('announcer').innerText(),
    note: '',
  };
  await hide.click();
  words.note = await page.getByTestId('copy-note').innerText();
  return words;
}

const KEY = /Ctrl|Cmd|⌘/;

for (const [device, viewport] of [
  ['a phone', { width: 390, height: 844 }],
  ['a phone on its side', { width: 844, height: 390 }],
  ['a tablet', { width: 1024, height: 768 }],
] as const) {
  test(`on ${device} (touch only, ${viewport.width} px wide) nothing says that Ctrl+Z undoes: not the offer, its cross, the note after hiding, the status region or the Clear question`, async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'a device with touch only is emulated in Chromium');
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    // The device, not the width, is what the wording goes by.
    expect(await page.evaluate(() => window.matchMedia('(hover: none) and (pointer: coarse)').matches)).toBe(true);
    const words = await undoWordsAfterRemove(page);
    expect(words.button).toBe('Undo');
    expect(words.offer).not.toMatch(KEY);
    expect(words.hideTitle).toBe('Hide');
    expect(words.spoken).not.toMatch(KEY);
    expect(words.note).toBe('Undo offer hidden.');
    expect(await page.getByTestId('announcer').innerText()).not.toMatch(KEY);

    // The question before a Clear (asked once an offset was set) promises the offer, not a key.
    await openSimulation(page);
    const azimuth = page.getByLabel('Azimuth (°) value');
    await azimuth.fill('10');
    await azimuth.press('Enter');
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('You can undo this right afterwards.');
    expect(await dialog.innerText()).not.toMatch(KEY);
    await context.close();
  });
}

test('in a narrow window on a desktop the button is short, and the cross, its note and the status region still say that Ctrl+Z undoes (it does)', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  const words = await undoWordsAfterRemove(page);
  // The layout is the phone's (the room goes to the name); the keyboard is still there.
  expect(words.button).toBe('Undo');
  expect(words.hideTitle).toBe('Hide (Ctrl/Cmd+Z still undoes)');
  expect(words.spoken).toMatch(/Removed b\.msi\. Undo: (Ctrl\+Z|⌘Z)\./);
  expect(words.note).toMatch(/^Undo offer hidden\. (Ctrl\+Z|⌘Z) still undoes\.$/);
  await page.locator('h1').click();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: 'Files (3)' })).toBeVisible();

  await openSimulation(page);
  const azimuth = page.getByLabel('Azimuth (°) value');
  await azimuth.fill('10');
  await azimuth.press('Enter');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('You can undo this with Ctrl/Cmd+Z until your next change.');
});

test('Clear also puts the simulation sliders and the horizontal cut back, says so first, and its undo brings them back; the next files are not simulated', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles([file('a.msi', msi(1800)), file('b.msi', msi(1900))]);
  await openSimulation(page);
  const mech = page.getByLabel('Mechanical tilt (°) value');
  await mech.fill('5');
  await mech.press('Enter');
  await page.getByRole('group', { name: 'Horizontal cut' }).getByRole('button', { name: 'At the horizon' }).click();
  await page.getByRole('group', { name: '3D method' }).getByRole('button', { name: 'Weighted' }).click();
  await expect(page.getByTestId('sim-badge')).toBeVisible();
  await expect(page.getByTestId('plot-h').locator('.gtitle')).toContainText('cut at the horizon');

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Clear 2 files and all groups, names and offsets? The simulation sliders and the horizontal cut (back to the one through the beam peak) are reset too.');
  await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByText('Open or drop Planet pattern files')).toBeVisible();

  // The undo brings the files back as they were: simulated, at the horizon.
  await page.getByTestId('undo-toast').getByRole('button', { name: /^Undo/ }).click();
  await expect(page.locator('.panel li')).toHaveCount(2);
  await expect(mech).toHaveValue('5');
  await expect(page.getByRole('group', { name: 'Horizontal cut' }).getByRole('button', { name: 'At the horizon' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('sim-badge')).toBeVisible();

  // Cleared for good, other files start as their files are. The 3D method (a browser preference) stays, and names nothing as simulated.
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByTestId('file-input').setInputFiles([file('c.msi', msi(2100)), file('d.msi', msi(2200))]);
  await expect(page.locator('.panel li')).toHaveCount(2);
  await expect(page.getByTestId('sim-badge')).toHaveCount(0);
  await expect(mech).toHaveValue('0');
  await expect(page.getByRole('group', { name: 'Horizontal cut' }).getByRole('button', { name: 'Through the beam peak' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: '3D method' }).getByRole('button', { name: 'Weighted' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('plot-h').locator('.gtitle')).toHaveText(/^Horizontal cut — HPBW [\d.]+°$/);
  await expect(page.locator('.metrics tbody')).not.toContainText('→');
  await expect(page.getByText(/Simulated:/)).toHaveCount(0);
  await expect(page.getByTestId('sim-weighted-note')).toHaveCount(0);
});

test('a file written as negative levels is read the right way up and says so; a frequency in GHz is read as MHz, a bare 1.8 is marked', async ({ page }) => {
  await page.goto('/');
  const headers = (freq: string) => ['NAME A', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'];
  const signed = (a: number) => (a > 180 ? a - 360 : a);
  const levels = (fn: (a: number) => number) => Array.from({ length: 360 }, (_, a) => `${a.toFixed(1)} ${(-fn(signed(a))).toFixed(2)}`);
  const negative = planetText({
    headers: headers('1800'),
    h: levels((a) => Math.min(40, 3 * (a / 32.5) ** 2)),
    v: levels((a) => Math.min(40, 3 * ((a - 8) / 4) ** 2)),
  });
  await page.getByTestId('file-input').setInputFiles([
    file('plain.msi', planetText({ headers: headers('1800') })),
    file('negative.msi', negative),
    file('ghz.msi', planetText({ headers: headers('1.8 GHz') })),
    file('bare.msi', planetText({ headers: headers('1.8') })),
  ]);
  const panel = page.locator('.panel');
  await expect(panel.locator('li')).toHaveCount(4);
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  const mark = (name: string) => panel.locator('li', { hasText: name }).locator('.warn');
  await expect(mark('plain.msi')).toHaveCount(0);
  await expect(mark('negative.msi')).toHaveAttribute('title', /HORIZONTAL cut: values look like negative levels \(dB relative to peak written with a minus sign\); read as attenuation/);
  await expect(mark('negative.msi')).toHaveAttribute('title', /VERTICAL cut: values look like negative levels/);
  await expect(mark('negative.msi')).not.toHaveAttribute('title', /minimum is -40 dB/);
  await expect(mark('ghz.msi')).toHaveCount(0);
  await expect(mark('bare.msi')).toHaveAttribute('title', /frequency looks like GHz/);

  // The table: the negative file reads as the plain one (it was analysed upside down: a wide beam and F/B 0.0).
  const row = (name: string) => page.locator('.metrics tbody tr', { hasText: name });
  const cells = (name: string) => row(name).locator('td[data-col]').allInnerTexts();
  expect(await cells('negative.msi')).toEqual(await cells('plain.msi'));
  await expect(row('negative.msi').locator('td[data-col="hHpbw"]')).toHaveText('65.0');
  // The MHz column: 1800 for the GHz file, 1.8 (marked) for the bare one.
  await expect(row('ghz.msi')).toContainText('1800');
  await expect(row('bare.msi').locator('td').nth(2)).toHaveText('1.8');
});
