import { describe, expect, it } from 'vitest';
import { inputsFromFileList, isProjectCandidate, planSelection } from './files';
import { planetText } from '../test/planetText';

describe('isProjectCandidate', () => {
  it("accepts the app's own project extension anywhere", () => {
    expect(isProjectCandidate('site/session.lobestory.json', false)).toBe(true);
    expect(isProjectCandidate('SESSION.LOBESTORY.JSON', false)).toBe(true);
  });

  it('accepts any .json only when it is the sole file of the selection', () => {
    expect(isProjectCandidate('export.json', true)).toBe(true);
    expect(isProjectCandidate('site/package.json', false)).toBe(false);
    expect(isProjectCandidate('notes.txt', true)).toBe(false);
    expect(isProjectCandidate('a.json.bak', true)).toBe(false);
  });
});

describe('planSelection', () => {
  it('loads pattern files when there is no project candidate', () => {
    expect(planSelection(3, 0)).toEqual({ kind: 'patterns', ignoredProjects: 0 });
    expect(planSelection(0, 0)).toEqual({ kind: 'patterns', ignoredProjects: 0 });
  });

  it('opens a lone project candidate', () => {
    expect(planSelection(0, 1)).toEqual({ kind: 'project' });
  });

  it('asks when pattern files come with exactly one project candidate', () => {
    expect(planSelection(1, 1)).toEqual({ kind: 'ask' });
    expect(planSelection(60, 1)).toEqual({ kind: 'ask' });
  });

  it('opens none of several candidates and reports how many there were', () => {
    expect(planSelection(5, 2)).toEqual({ kind: 'patterns', ignoredProjects: 2 });
    expect(planSelection(0, 3)).toEqual({ kind: 'patterns', ignoredProjects: 3 });
  });
});

describe('inputsFromFileList', () => {
  const enc = new TextEncoder();
  const fake = (name: string, relative = '') => {
    const read = { text: 0, bytes: 0 };
    const file = {
      name,
      webkitRelativePath: relative,
      text: async () => (read.text++, '{}'),
      arrayBuffer: async () => (read.bytes++, enc.encode('x').buffer),
    };
    return { file, read };
  };
  const list = (...files: unknown[]) => files as unknown as FileList;

  it('reads only pattern files and project candidates out of a folder', async () => {
    const pattern = fake('a.msi', 'site/a.msi');
    const other = fake('package.json', 'site/package.json');
    const project = fake('s.lobestory.json', 'site/s.lobestory.json');
    const result = await inputsFromFileList(list(pattern.file, other.file, project.file));
    expect(result.inputs.map((i) => i.path)).toEqual(['site/a.msi']);
    expect(result.projects).toEqual([{ path: 'site/s.lobestory.json', text: '{}' }]);
    expect(other.read).toEqual({ text: 0, bytes: 0 });
  });

  describe('a file with another extension, or none', () => {
    const planet = planetText();
    /** A file whose bytes are `text`; counts what is read of it. */
    const withText = (name: string, text: string, relative = '') => {
      const bytes = enc.encode(text);
      const read = { head: 0, whole: 0 };
      const file = {
        name,
        webkitRelativePath: relative,
        size: bytes.length,
        text: async () => text,
        arrayBuffer: async () => (read.whole++, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
        slice: (from: number, to: number) => ({ arrayBuffer: async () => (read.head++, bytes.slice(from, to).buffer) }),
      };
      return { file, read };
    };

    it('is taken when its content is a valid pattern: its start is looked at, and the whole only if that looks like one', async () => {
      const dat = withText('good.dat', planet, 'site/good.dat');
      const bare = withText('good', planet, 'site/good');
      const photo = withText('photo.png', '\u0089PNG\r\n' + 'x'.repeat(100_000), 'site/photo.png');
      const result = await inputsFromFileList(list(dat.file, bare.file, photo.file));
      expect(result.inputs.map((i) => [i.path, i.byContent])).toEqual([['site/good.dat', true], ['site/good', true]]);
      expect(new TextDecoder().decode(result.inputs[0].bytes)).toBe(planet);
      expect(photo.read).toEqual({ head: 1, whole: 0 });
      expect(dat.read).toEqual({ head: 1, whole: 1 });
      expect(result.failed).toBe(0);
    });

    it('among other files it is left out when it only looks like a pattern and is none (notes with a line "Name …")', async () => {
      const notes = withText('notes.md', 'Name of the site\nMake sure to call\n', 'site/notes.md');
      const cut = withText('cut.dat', planet.slice(0, 900), 'site/cut.dat');
      const result = await inputsFromFileList(list(notes.file, cut.file, fake('a.msi', 'site/a.msi').file));
      expect(result.inputs.map((i) => i.path)).toEqual(['site/a.msi']);
    });

    it('picked by itself it is taken as soon as it looks like a pattern, so that the reason it does not load is shown', async () => {
      const cut = withText('cut.dat', planet.slice(0, 900));
      expect((await inputsFromFileList(list(cut.file))).inputs.map((i) => [i.path, i.byContent])).toEqual([['cut.dat', true]]);
      // What does not look like one at all is not: the status line says that no pattern file was found.
      const photo = withText('photo.png', '\u0089PNG\r\n');
      expect((await inputsFromFileList(list(photo.file))).inputs).toEqual([]);
    });

    it('an empty file or UTF-16 text under another name does not look like a pattern: it is not taken, so no cause is listed for it (the README says so)', async () => {
      // Under .msi, .pln or .txt the same two files are listed with their cause; here only the status line speaks.
      // UTF-16 (little endian, no byte order mark) of plain text: a zero byte after every character.
      const utf16 = Array.from(planet.slice(0, 400), (c) => `${c}\u0000`).join('');
      for (const text of ['', utf16]) {
        expect((await inputsFromFileList(list(withText('odd.dat', text).file))).inputs, 'picked by itself').toEqual([]);
        expect((await inputsFromFileList(list(withText('odd.dat', text, 'site/odd.dat').file, fake('a.msi', 'site/a.msi').file))).inputs.map((i) => i.path), 'in a folder').toEqual(['site/a.msi']);
      }
    });

    it('a .json is never looked into for a pattern', async () => {
      const json = withText('package.json', planet, 'site/package.json');
      expect((await inputsFromFileList(list(json.file))).inputs).toEqual([]);
      expect(json.read).toEqual({ head: 0, whole: 0 });
    });
  });

  it('takes a .json picked on its own as a candidate, but not the only file of a folder', async () => {
    const alone = fake('export.json');
    expect((await inputsFromFileList(list(alone.file))).projects).toEqual([{ path: 'export.json', text: '{}' }]);
    const inFolder = fake('export.json', 'site/export.json');
    expect((await inputsFromFileList(list(inFolder.file))).projects).toEqual([]);
    expect(inFolder.read.text).toBe(0);
    const two = [fake('a.json'), fake('b.json')];
    expect((await inputsFromFileList(list(two[0].file, two[1].file))).projects).toEqual([]);
  });
});
