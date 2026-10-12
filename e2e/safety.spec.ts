import { expect, test } from '@playwright/test';
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
