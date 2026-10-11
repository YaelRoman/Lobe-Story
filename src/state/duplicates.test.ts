import { describe, expect, it } from 'vitest';
import {
  fingerprint,
  isCleanLoad,
  isFingerprint,
  loadSummary,
  normalizeText,
  numberedAs,
  numberedPath,
  plainName,
  planLoad,
  type IncomingFile,
  type KnownFile,
} from './duplicates';

const known = (path: string, text: string, ok = true, id = path): KnownFile => ({ id, path, text, ok });
const file = (path: string, text: string, ok = true): IncomingFile => ({ path, text, ok });
const placed = (plan: ReturnType<typeof planLoad>) => plan.add.map((a) => [a.index, a.id]);
const NONE = { loaded: 0, failed: 0, skipped: 0, renamed: 0 };

describe('names and numbers', () => {
  it('numbers a path before its extension', () => {
    expect(numberedAs('dir/a.msi', 2)).toBe('dir/a (2).msi');
    expect(numberedAs('a', 3)).toBe('a (3)');
    expect(numberedAs('d.x/a', 2)).toBe('d.x/a (2)');
    expect(numberedPath('a.msi', (p) => p === 'a (2).msi')).toBe('a (3).msi');
  });

  it("reduces a path to its file name without a duplicate's number", () => {
    expect(plainName('site/a (2).msi')).toBe('a.msi');
    expect(plainName('site\\a (12).MSI')).toBe('a.MSI');
    expect(plainName('a.msi')).toBe('a.msi');
    expect(plainName('a (2)')).toBe('a');
    // Only a number directly before the extension, with the space: anything else is the name itself.
    expect(plainName('a (2) b.msi')).toBe('a (2) b.msi');
    expect(plainName('a(2).msi')).toBe('a(2).msi');
    expect(plainName('a (x).msi')).toBe('a (x).msi');
  });
});

describe('fingerprint', () => {
  it('is stable, short and independent of line endings', () => {
    const fp = fingerprint('NAME X\nGAIN 1\n');
    expect(fp).toBe(fingerprint('NAME X\r\nGAIN 1\r\n'));
    expect(fp).toBe(fingerprint('NAME X\rGAIN 1\r'));
    expect(fp).toMatch(/^[0-9a-z]+-[0-9a-f]{8}$/);
    expect(fp.startsWith(`${(14).toString(36)}-`)).toBe(true);
    expect(normalizeText('a\r\nb\rc\n')).toBe('a\nb\nc\n');
  });

  it('matches the published FNV-1a test vectors', () => {
    expect(fingerprint('')).toBe('0-811c9dc5');
    expect(fingerprint('a')).toBe('1-e40c292c');
    expect(fingerprint('foobar')).toBe('6-bf9cf968');
  });

  it('tells different content apart, also at the same length', () => {
    expect(fingerprint('FREQUENCY 1800')).not.toBe(fingerprint('FREQUENCY 1850'));
    expect(fingerprint('ab')).not.toBe(fingerprint('ba'));
  });

  it('recognises its own shape and nothing else', () => {
    expect(isFingerprint(fingerprint('x'))).toBe(true);
    for (const bad of [undefined, null, 7, {}, [], '', 'abc', '1-xyz', `1-${'a'.repeat(9)}`, `${'1'.repeat(40)}-00000000`]) {
      expect(isFingerprint(bad)).toBe(false);
    }
  });
});

describe('planLoad: plain loads and duplicates', () => {
  it('adds new files under their own paths', () => {
    const plan = planLoad([], [], [file('a.msi', 'A'), file('d/b.msi', 'B')]);
    expect(plan.add).toEqual([
      { index: 0, id: 'a.msi', path: 'a.msi', matched: false },
      { index: 1, id: 'd/b.msi', path: 'd/b.msi', matched: false },
    ]);
    expect(plan.counts).toEqual({ ...NONE, loaded: 2 });
    expect(plan.pending).toEqual([]);
  });

  it('skips content that is already loaded under the same name, whatever the folder, number or line endings', () => {
    const existing = [known('site/a.msi', 'A\r\n'), known('site/a (3).msi', 'C')];
    const plan = planLoad(existing, [], [file('a.msi', 'A\n'), file('other/a.msi', 'C'), file('a (7).msi', 'A\n')]);
    expect(plan.add).toEqual([]);
    expect(plan.counts).toEqual({ ...NONE, skipped: 3 });
  });

  it('does not skip the same content under another name', () => {
    const plan = planLoad([known('a.msi', 'A')], [], [file('b.msi', 'A')]);
    expect(placed(plan)).toEqual([[0, 'b.msi']]);
  });

  it('keeps a same-path file with other content under the smallest free number', () => {
    const existing = [known('a.msi', 'A'), known('a (3).msi', 'C')];
    const plan = planLoad(existing, [], [file('a.msi', 'B'), file('a.msi', 'D'), file('a.msi', 'B')]);
    expect(placed(plan)).toEqual([[0, 'a (2).msi'], [1, 'a (4).msi']]);
    expect(plan.counts).toEqual({ loaded: 2, failed: 0, skipped: 1, renamed: 2 });
  });

  it('does not number a file onto a path the project is still waiting for', () => {
    // Two pending entries share the name, so neither is guessed; their paths stay reserved.
    const pending = [{ path: 'a (2).msi' }, { path: 'a (3).msi' }];
    const plan = planLoad([known('a.msi', 'A')], pending, [file('a.msi', 'B')]);
    expect(plan.add).toEqual([{ index: 0, id: 'a (4).msi', path: 'a (4).msi', matched: false }]);
    expect(plan.pending).toEqual(pending);
  });

  it('does not number a different file of the same name from another folder', () => {
    const plan = planLoad([known('x/a.msi', 'A')], [], [file('y/a.msi', 'B')]);
    expect(placed(plan)).toEqual([[0, 'y/a.msi']]);
    expect(plan.counts.renamed).toBe(0);
  });
});

describe('planLoad: files that do not parse', () => {
  it('lists a failed same-path file once, next to the good one, without a number', () => {
    const plan = planLoad([known('a.msi', 'A')], [], [file('a.msi', 'bad', false)]);
    expect(plan.add).toEqual([{ index: 0, id: 'a.msi#failed', path: 'a.msi', matched: false }]);
    expect(plan.counts).toEqual({ ...NONE, failed: 1 });
    const again = planLoad([known('a.msi', 'A'), known('a.msi', 'bad', false, 'a.msi#failed')], [], [file('a.msi', 'bad2', false)]);
    expect(again.add).toEqual([{ index: 0, id: 'a.msi#failed', path: 'a.msi', matched: false, replaces: 'a.msi#failed' }]);
  });

  it('replaces an earlier failed entry of the path, by a failed or by a good file', () => {
    const failedFirst = [known('a.msi', 'bad', false)];
    expect(planLoad(failedFirst, [], [file('a.msi', 'bad2', false)]).add).toEqual([
      { index: 0, id: 'a.msi', path: 'a.msi', matched: false, replaces: 'a.msi' },
    ]);
    const good = planLoad(failedFirst, [], [file('a.msi', 'A')]);
    expect(good.add).toEqual([{ index: 0, id: 'a.msi', path: 'a.msi', matched: false, replaces: 'a.msi' }]);
    expect(good.counts).toEqual({ ...NONE, loaded: 1 });
    // The good file was removed and only the failed sibling is left: a good file takes the path back.
    const orphan = planLoad([known('a.msi', 'bad', false, 'a.msi#failed')], [], [file('a.msi', 'A')]);
    expect(orphan.add).toEqual([{ index: 0, id: 'a.msi', path: 'a.msi', matched: false, replaces: 'a.msi#failed' }]);
  });

  it('handles a failed and a good file of one name in one selection, in either order', () => {
    expect(placed(planLoad([], [], [file('a.msi', 'bad', false), file('a.msi', 'A')]))).toEqual([[0, 'a.msi'], [1, 'a.msi']]);
    expect(placed(planLoad([], [], [file('a.msi', 'A'), file('a.msi', 'bad', false)]))).toEqual([
      [0, 'a.msi'],
      [1, 'a.msi#failed'],
    ]);
  });

  it('does not let a failed file use up a pending entry by path or name, only by fingerprint', () => {
    const pending = [{ path: 'site/a.msi' }];
    const plan = planLoad([], pending, [file('a.msi', 'bad', false)]);
    expect(plan.pending).toEqual(pending);
    expect(plan.add).toEqual([{ index: 0, id: 'a.msi', path: 'a.msi', matched: false }]);
    // The project itself held this unparsable file: it goes back where it was.
    const byFp = planLoad([], [{ path: 'site/a.msi', fp: fingerprint('bad') }], [file('a.msi', 'bad', false)]);
    expect(byFp.add).toEqual([{ index: 0, id: 'site/a.msi', path: 'site/a.msi', matched: true }]);
    expect(byFp.pending).toEqual([]);
  });
});

describe('planLoad: files a layout-only project is waiting for', () => {
  const fpA = fingerprint('A');
  const fpB = fingerprint('B');

  it('matches by fingerprint first, whatever the name or order', () => {
    const pending = [{ path: 'a.msi', fp: fpA }, { path: 'a (2).msi', fp: fpB }];
    for (const order of [['A', 'B'], ['B', 'A']]) {
      const plan = planLoad([], pending, order.map((t) => file('a.msi', t)));
      const byText = Object.fromEntries(plan.add.map((a) => [order[a.index], a.id]));
      expect(byText).toEqual({ A: 'a.msi', B: 'a (2).msi' });
      expect(plan.add.every((a) => a.matched)).toBe(true);
      expect(plan.pending).toEqual([]);
      expect(plan.counts).toEqual({ ...NONE, loaded: 2 });
    }
    expect(placed(planLoad([], pending, [file('renamed.msi', 'B')]))).toEqual([[0, 'a (2).msi']]);
  });

  it('prefers, among entries with the same fingerprint, the same path, then the same name', () => {
    const pending = [{ path: 'x/c.msi', fp: fpA }, { path: 'y/c.msi', fp: fpA }, { path: 'y/d.msi', fp: fpA }];
    expect(placed(planLoad([], pending, [file('y/c.msi', 'A')]))).toEqual([[0, 'y/c.msi']]);
    expect(placed(planLoad([], pending, [file('d.msi', 'A')]))).toEqual([[0, 'y/d.msi']]);
    expect(placed(planLoad([], pending, [file('y/c.msi', 'A'), file('x/c.msi', 'A'), file('z.msi', 'A')]))).toEqual([
      [0, 'y/c.msi'],
      [1, 'x/c.msi'],
      [2, 'y/d.msi'],
    ]);
  });

  it('matches every fingerprint of the selection before any path or name', () => {
    const pending = [{ path: 'a.msi', fp: fpA }, { path: 'a (2).msi', fp: fpB }];
    // The edited file comes first, but the unchanged one keeps its own entry.
    const plan = planLoad([], pending, [file('a.msi', 'edited'), file('a.msi', 'A')]);
    expect(placed(plan)).toEqual([[0, 'a (2).msi'], [1, 'a.msi']]);
  });

  it('falls back to the exact path, then the unique file name, then the unique name without its number', () => {
    const pending = [{ path: 'site/a.msi' }, { path: 'site/b.msi' }, { path: 'x/c.msi' }, { path: 'y/c.msi' }, { path: 'site/d (2).msi' }];
    const one = (path: string) => planLoad([], pending, [file(path, path)]).add[0];
    expect(one('site/a.msi')).toMatchObject({ id: 'site/a.msi', matched: true });
    expect(one('elsewhere/b.msi')).toMatchObject({ id: 'site/b.msi', matched: true });
    expect(one('b.msi')).toMatchObject({ id: 'site/b.msi', matched: true });
    expect(one('z/c.msi')).toMatchObject({ id: 'z/c.msi', matched: false }); // two candidates: not guessed
    expect(one('x/c.msi')).toMatchObject({ id: 'x/c.msi', matched: true });
    expect(one('d.msi')).toMatchObject({ id: 'site/d (2).msi', matched: true });
    expect(one('d (5).msi')).toMatchObject({ id: 'site/d (2).msi', matched: true });
    expect(one('new.msi')).toMatchObject({ id: 'new.msi', matched: false });
  });

  it('gives the un-numbered entry to an un-numbered file first, then the numbered one', () => {
    const pending = [{ path: 'a.msi' }, { path: 'a (2).msi' }];
    const plan = planLoad([], pending, [file('dl/a.msi', 'A'), file('dl/a.msi', 'B')]);
    expect(placed(plan)).toEqual([[0, 'a.msi'], [1, 'a (2).msi']]);
    expect(plan.pending).toEqual([]);
  });

  it('keeps two same-content files of different folders apart when the project lists both', () => {
    const plan = planLoad([], [{ path: 'x/c.msi' }, { path: 'y/c.msi' }], [file('x/c.msi', 'A'), file('y/c.msi', 'A')]);
    expect(placed(plan)).toEqual([[0, 'x/c.msi'], [1, 'y/c.msi']]);
  });

  it('does not hand a pending entry to content that is already loaded', () => {
    const plan = planLoad([known('a.msi', 'A')], [{ path: 'a (2).msi' }], [file('a.msi', 'A')]);
    expect(plan.add).toEqual([]);
    expect(plan.counts.skipped).toBe(1);
    expect(plan.pending).toEqual([{ path: 'a (2).msi' }]);
  });

  it('leaves its inputs alone', () => {
    const pending = [{ path: 'a.msi' }];
    const existing = [known('b.msi', 'B')];
    planLoad(existing, pending, [file('a.msi', 'A')]);
    expect(pending).toEqual([{ path: 'a.msi' }]);
    expect(existing).toEqual([known('b.msi', 'B')]);
  });
});

describe('loadSummary', () => {
  it('names every count, in one line that does not contradict itself', () => {
    expect(loadSummary({ loaded: 60, failed: 1, skipped: 2, renamed: 1, unreadable: 1 })).toBe(
      'Loaded 60 files · 1 could not be loaded · 1 could not be read · 2 already loaded (skipped) · 1 same-name file with different content added as a numbered copy',
    );
    expect(loadSummary({ ...NONE, unreadable: 0, failed: 2 })).toBe('No new files loaded: 2 could not be loaded');
    expect(loadSummary({ ...NONE, unreadable: 0 })).toBe('Nothing new was loaded');
    expect(loadSummary({ ...NONE, unreadable: 0, loaded: 2, renamed: 2 })).toContain('2 same-name files with different content added as numbered copies');
  });

  it('calls a load clean only when every file simply loaded', () => {
    const base = { ...NONE, unreadable: 0, loaded: 3 };
    expect(isCleanLoad(base)).toBe(true);
    expect(isCleanLoad({ ...base, loaded: 0 })).toBe(false);
    for (const k of ['failed', 'skipped', 'renamed', 'unreadable'] as const) expect(isCleanLoad({ ...base, [k]: 1 })).toBe(false);
  });
});
