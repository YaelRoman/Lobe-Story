import { beforeEach, describe, expect, it } from 'vitest';
import type { FileInput } from './files';
import { initialState, loadText, useStore } from './store';
import { isDirty, markOf } from './undo';
import { parseProject, projectToState, serializeProject, PROJECT_VERSION, type ProjectFile } from './project';
import { planetText } from '../test/planetText';

const enc = new TextEncoder();
const input = (path: string, text: string): FileInput => ({ path, bytes: enc.encode(text).buffer as ArrayBuffer });
const msi = (freq: number) => planetText({ headers: ['NAME X', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });
const st = useStore.getState;
const load = () => st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);

beforeEach(() => useStore.setState(initialState()));

describe('the reference file', () => {
  it('is pinned and cleared by id; an unknown id changes nothing', () => {
    load();
    st().setReference('a.MSI');
    expect(st().reference).toBe('a.MSI');
    const before = st();
    st().setReference('nope.msi');
    expect(st()).toBe(before);
    st().setReference('a.MSI');
    expect(st()).toBe(before);
    st().setReference(null);
    expect(st().reference).toBeNull();
  });

  it('can be a copy, and goes when its file, or the copy, is removed', () => {
    load();
    const c = st().duplicate('a.MSI')!;
    st().setReference(c);
    expect(st().reference).toBe(c);
    st().removeFile(c);
    expect(st().reference).toBeNull();
    st().setReference('a.MSI');
    st().duplicate('a.MSI');
    st().removeFile('a.MSI');
    expect(st().reference).toBeNull();
    st().setReference('b.MSI');
    st().removeFile('a.MSI');
    expect(st().reference).toBe('b.MSI');
  });

  it('is cleared with the session, and takes the difference view with it', () => {
    load();
    st().setReference('a.MSI');
    st().updateView({ deltaVsReference: true });
    st().setReference(null);
    expect(st().view.deltaVsReference).toBe(false);
    st().setReference('a.MSI');
    st().updateView({ deltaVsReference: true });
    st().clear();
    expect(st().reference).toBeNull();
    expect(st().view.deltaVsReference).toBe(false);
  });

  it('is restored by undo of Remove and of Clear', () => {
    load();
    st().setReference('a.MSI');
    st().removeFile('a.MSI');
    expect(st().reference).toBeNull();
    st().undoLast();
    expect(st().reference).toBe('a.MSI');
    st().clear();
    st().undoLast();
    expect(st().reference).toBe('a.MSI');
  });

  it('counts as unsaved work, by value, and an offered undo is withdrawn by it', () => {
    load();
    st().markSaved();
    expect(isDirty(st())).toBe(false);
    st().setReference('a.MSI');
    expect(isDirty(st())).toBe(true);
    st().setReference(null);
    expect(isDirty(st())).toBe(false);
    st().setReference('b.MSI');
    st().updateView({ deltaVsReference: true });
    expect(isDirty(st())).toBe(true);
    st().removeFile('a.MSI');
    expect(st().undo).not.toBeNull();
    st().setReference(null);
    expect(st().undo).toBeNull();
    expect(markOf(st()).state).toContain('"reference":null');
  });
});

describe('the reference in a project file', () => {
  const restore = (project: ProjectFile) => ({ ...initialState(), ...projectToState(project, initialState(), { theme: 'light', collapsed: initialState().view.collapsed, freqMetric: 'hHpbw' }, loadText) });

  it('is saved and comes back with the Delta view, and the version stays 1', () => {
    load();
    const c = st().duplicate('a.MSI')!;
    st().setReference(c);
    st().updateView({ deltaVsReference: true });
    const json = serializeProject(st(), true);
    expect(JSON.parse(json).version).toBe(1);
    expect(PROJECT_VERSION).toBe(1);
    expect(JSON.parse(json).state.reference).toBe(c);
    const parsed = parseProject(json);
    if (!parsed.ok) throw new Error(parsed.error);
    const s = restore(parsed.project);
    expect(s.reference).toBe(c);
    expect(s.view.deltaVsReference).toBe(true);
    // Opening it through the store is not unsaved work.
    st().loadProject(parsed.project);
    expect(st().reference).toBe(c);
    expect(isDirty(st())).toBe(false);
  });

  it('opens an old project without the field unchanged, with no reference', () => {
    load();
    const written = JSON.parse(serializeProject(st(), true));
    delete written.state.reference;
    const parsed = parseProject(JSON.stringify(written));
    if (!parsed.ok) throw new Error(parsed.error);
    const s = restore(parsed.project);
    expect(s.reference).toBeNull();
    expect(s.view.deltaVsReference).toBe(false);
    st().loadProject(parsed.project);
    expect(isDirty(st())).toBe(false);
  });

  it('drops a reference that is not a file or copy of the project (and a Delta view without one)', () => {
    load();
    st().setReference('a.MSI');
    st().updateView({ deltaVsReference: true });
    for (const bad of ['ghost.msi', 7, {}, 'a.MSI#copy-9']) {
      const written = JSON.parse(serializeProject(st(), true));
      written.state.reference = bad;
      const parsed = parseProject(JSON.stringify(written));
      if (!parsed.ok) throw new Error(parsed.error);
      const s = restore(parsed.project);
      expect(s.reference).toBeNull();
      expect(s.view.deltaVsReference).toBe(false);
    }
  });

  it('keeps a reference to a file a layout-only project still waits for', () => {
    load();
    st().setReference('b.MSI');
    const parsed = parseProject(serializeProject(st(), false));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(restore(parsed.project).reference).toBe('b.MSI');
  });
});

describe('a dismissed layout-only project', () => {
  it('takes a reference to a file that never came, and the difference view, with it', () => {
    load();
    st().setReference('b.MSI');
    st().updateView({ deltaVsReference: true });
    const parsed = parseProject(serializeProject(st(), false));
    if (!parsed.ok) throw new Error(parsed.error);
    st().clear();
    st().loadProject(parsed.project);
    expect(st().pendingFiles.length).toBeGreaterThan(0);
    expect(st().reference).toBe('b.MSI');
    st().dismissPending();
    expect(st().reference).toBeNull();
    expect(st().view.deltaVsReference).toBe(false);
  });

  it('takes a reference that is a copy of a never-loaded file, and the orphan copy with its state', () => {
    load();
    const parsed = parseProject(serializeProject(st(), false));
    if (!parsed.ok) throw new Error(parsed.error);
    st().clear();
    st().loadProject(parsed.project);
    const c = 'b.MSI#copy-2';
    useStore.setState({ copies: { [c]: { sourceId: 'b.MSI' } }, visible: { ...st().visible, [c]: true }, names: { [c]: 'mine' } });
    st().setReference(c);
    st().updateView({ deltaVsReference: true });
    expect(st().pendingFiles.length).toBeGreaterThan(0);
    st().dismissPending();
    expect(st().reference).toBeNull();
    expect(st().view.deltaVsReference).toBe(false);
    expect(st().copies).toEqual({});
    expect(st().visible[c]).toBeUndefined();
    expect(st().names[c]).toBeUndefined();
  });

  it('keeps a reference that is a copy of a loaded file', () => {
    load();
    st().addFiles([input('c.MSI', msi(2100))]);
    const c = st().duplicate('a.MSI')!;
    useStore.setState({ pendingFiles: [{ path: 'z.MSI' } as never] });
    st().setReference(c);
    st().dismissPending();
    expect(st().reference).toBe(c);
    expect(st().copies[c]).toBeDefined();
  });

  it('keeps a reference that is a loaded file', () => {
    load();
    st().setReference('a.MSI');
    st().updateView({ deltaVsReference: true });
    st().dismissPending();
    expect(st().reference).toBe('a.MSI');
    expect(st().view.deltaVsReference).toBe(true);
  });
});
