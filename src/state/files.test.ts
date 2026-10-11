import { describe, expect, it } from 'vitest';
import { inputsFromFileList, isProjectCandidate, planSelection } from './files';

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
