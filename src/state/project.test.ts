import { beforeEach, describe, expect, it } from 'vitest';
import {
  matchPending,
  parseProject,
  pendingLabel,
  PROJECT_FORMAT,
  projectToState,
  serializeProject,
} from './project';
import { DEFAULT_TABLE_GROUPS, initialState, loadText, useStore, type StoreData } from './store';
import { selectInstances } from './selectors';
import { planetText } from '../test/planetText';

const enc = new TextEncoder();
const msi = (freq: number) =>
  planetText({ headers: ['NAME X', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });
const input = (path: string, text: string) => ({ path, bytes: enc.encode(text).buffer as ArrayBuffer });

beforeEach(() => useStore.setState(initialState()));

export function buildSession(): StoreData {
  const st = useStore.getState;
  st().addFiles([input('site/a.MSI', msi(1800)), input('site/b.MSI', msi(1900)), input('site/bad.pln', 'NAME X\n')]);
  st().setTags('site/b.MSI', { tiltDeg: 3 });
  const g = st().createSite('site/a.MSI', 3)!;
  st().rename('site/b.MSI', 'Bee');
  st().setGroupOffset(g, { azimuthDeg: 30 });
  st().setOffset('site/b.MSI', { mechanicalDeg: 2 });
  st().updateSimulation({ electricalDeg: 1 });
  st().updateSettings({ fbWindowDeg: 20 });
  st().updateView({ mode: 'rect', gainUnit: 'dBi' });
  return st();
}

export const snapshot = (s: StoreData) => {
  const view: Record<string, unknown> = { ...s.view };
  delete view.theme;
  return {
    files: s.files.map((f) => ({ id: f.id, text: f.text, ok: f.result.ok })),
    tagOverrides: s.tagOverrides,
    visible: s.visible,
    copies: s.copies,
    names: s.names,
    customGroups: s.customGroups,
    membership: s.membership,
    highlighted: s.highlighted,
    selected: s.selected,
    settings: s.settings,
    view,
  };
};

const restore = (json: string, theme: 'light' | 'dark' = 'light'): StoreData => {
  const parsed = parseProject(json);
  if (!parsed.ok) throw new Error(parsed.error);
  return { ...initialState(), ...projectToState(parsed.project, initialState(), theme, loadText) };
};

describe('source text', () => {
  it('keeps the decoded text of each loaded file', () => {
    useStore.getState().addFiles([input('a.MSI', msi(1800))]);
    expect(useStore.getState().files[0].text).toBe(msi(1800));
  });
});

describe('serializeProject / parseProject / projectToState', () => {
  it('round-trips a session and keeps the given theme', () => {
    const before = buildSession();
    const json = serializeProject(before, true, new Date('2026-10-10T08:00:00Z'));
    const raw = JSON.parse(json);
    expect(raw).toMatchObject({ format: PROJECT_FORMAT, version: 1, savedAt: '2026-10-10T08:00:00.000Z' });
    expect(raw.state.view.theme).toBeUndefined();
    const after = restore(json, 'dark');
    expect(snapshot(after)).toEqual(snapshot(before));
    expect(after.view.theme).toBe('dark');
    expect(after.pendingFiles).toEqual([]);
  });

  it('writes layout-only projects without file text and restores them as pending', () => {
    const before = buildSession();
    const json = serializeProject(before, false);
    expect(JSON.parse(json).files).toEqual([{ path: 'site/a.MSI' }, { path: 'site/b.MSI' }, { path: 'site/bad.pln' }]);
    const after = restore(json);
    expect(after.files).toEqual([]);
    expect(after.pendingFiles).toEqual(['site/a.MSI', 'site/b.MSI', 'site/bad.pln']);
    expect(after.names).toEqual(before.names);
    expect(after.copies).toEqual(before.copies);
  });

  it.each([
    ['{oops', 'This file is not valid JSON.'],
    ['[1,2]', 'Not a Lobe-Story project.'],
    ['{"format":"other","version":1,"files":[],"state":{}}', 'Not a Lobe-Story project.'],
    ['{"format":"lobe-story-project","version":2,"files":[],"state":{}}', 'This project was saved by a newer version of the app.'],
    ['{"format":"lobe-story-project","version":"1","files":[],"state":{}}', 'This project was saved by a newer version of the app.'],
    ['{"format":"lobe-story-project","version":1,"files":[{"text":"x"}],"state":{}}', 'The project file is damaged (files).'],
    ['{"format":"lobe-story-project","version":1,"files":"no","state":{}}', 'The project file is damaged (files).'],
    ['{"format":"lobe-story-project","version":1,"files":[],"state":7}', 'The project file is damaged (state).'],
  ])('rejects %s', (text, error) => {
    expect(parseProject(text)).toEqual({ ok: false, error });
  });

  it('falls back to defaults for wrongly shaped parts and drops stale group references', () => {
    const json = JSON.stringify({
      format: PROJECT_FORMAT,
      version: 1,
      savedAt: 'x',
      extra: true,
      files: [{ path: 'a.MSI', text: msi(1800), junk: 1 }],
      state: {
        tagOverrides: 'nope',
        names: { 'a.MSI': 'Ay' },
        customGroups: [{ id: 'g1', name: 'Site 1' }, { id: 5 }],
        membership: { 'a.MSI': 'g1', 'b.MSI': 'g9' },
        selected: { kind: 'group', id: 'g9' },
        settings: { levelDb: -1, fbWindowDeg: 25 },
        view: {
          mode: 'weird',
          cut: 'H',
          floorDb: -3,
          markers: { fb: true, hpbw: 'yes' },
          theme: 'dark',
          simulation: {
            electricalDeg: 999,
            showOriginal: 'no',
            offsets: { 'a.MSI': { mechanicalDeg: 2.3 }, bad: 5 },
            groupOffsets: { g1: { azimuthDeg: 400 }, g9: { azimuthDeg: 10 } },
          },
        },
      },
    });
    const s = restore(json, 'light');
    expect(s.tagOverrides).toEqual({});
    expect(s.names).toEqual({ 'a.MSI': 'Ay' });
    expect(s.customGroups).toEqual([{ id: 'g1', name: 'Site 1' }]);
    expect(s.membership).toEqual({ 'a.MSI': 'g1' });
    expect(s.selected).toBeNull();
    expect(s.settings).toMatchObject({ levelDb: 3, fbWindowDeg: 25, uslsRangeDeg: 20 });
    expect(s.view).toMatchObject({ mode: 'polar', cut: 'H', floorDb: 40, theme: 'light' });
    expect(s.view.markers).toEqual({ hpbw: true, fb: true, usls: false, null: false, peak: true, sector: false });
    expect(s.view.simulation).toEqual({
      electricalDeg: 15,
      mechanicalDeg: 0,
      azimuthDeg: 0,
      showOriginal: true,
      offsets: { 'a.MSI': { electricalDeg: 0, mechanicalDeg: 2.5, azimuthDeg: 0 } },
      groupOffsets: { g1: { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 180 } },
    });
    expect(s.files.map((f) => f.id)).toEqual(['a.MSI']);
  });
});

describe('damaged values', () => {
  const withState = (state: unknown, files: unknown[] = [{ path: 'a.MSI', text: msi(1800) }]) =>
    JSON.stringify({ format: PROJECT_FORMAT, version: 1, savedAt: '', files, state });

  it('keeps only well-formed copies, names, visible and tag overrides', () => {
    const s = restore(
      withState({
        copies: { x: null, y: { sourceId: 5 }, 'a.MSI#copy-2': { sourceId: 'a.MSI', extra: 1 } },
        names: { a: {}, b: '', c: 'C' },
        visible: { a: 'x', b: true },
        tagOverrides: {
          p: 'bad',
          q: { polarization: 5, tiltDeg: 'x', port: 'P1', array: 'A', junk: 1 },
          r: { tiltDeg: Infinity },
          t: { tiltDeg: 4 },
        },
      }),
    );
    expect(s.copies).toEqual({ 'a.MSI#copy-2': { sourceId: 'a.MSI' } });
    expect(s.names).toEqual({ c: 'C' });
    expect(s.visible).toEqual({ b: true });
    expect(s.tagOverrides).toEqual({ q: { port: 'P1', array: 'A' }, r: {}, t: { tiltDeg: 4 } });
  });

  it('falls back to defaults for settings above their bounds', () => {
    const big = { levelDb: 1e9, fbWindowDeg: 1e9, uslsRangeDeg: 1e9, nullSearchDeg: 1e9, sectorEdgeDeg: 1e9 };
    expect(restore(withState({ settings: big })).settings).toEqual(initialState().settings);
    expect(restore(withState({ settings: { levelDb: 100, fbWindowDeg: 360 } })).settings).toMatchObject({
      levelDb: 100,
      fbWindowDeg: 360,
    });
  });

  it('sanitises the sector settings and migrates the legacy tracking window', () => {
    const settings = (raw: object) => restore(withState({ settings: raw })).settings;
    expect(settings({ trackingWindowDeg: 45 }).sectorEdgeDeg).toBe(45);
    expect(settings({ trackingWindowDeg: 45, sectorEdgeDeg: 30 }).sectorEdgeDeg).toBe(30);
    expect(settings({ sectorEdgeDeg: 400 }).sectorEdgeDeg).toBe(60);
    expect(settings({ sectorEdgeDeg: 179 }).sectorEdgeDeg).toBe(179);
    expect(settings({ siteSectors: 2.5 }).siteSectors).toBe(3);
    expect(settings({ siteSectors: 99 }).siteSectors).toBe(3);
    expect(settings({ siteSectors: 1 }).siteSectors).toBe(3);
    expect(settings({ siteSectors: 6 }).siteSectors).toBe(6);
  });

  it('round-trips the sector marker', () => {
    const s = restore(withState({ view: { markers: { sector: true } } }));
    expect(s.view.markers.sector).toBe(true);
    expect(restore(withState({ view: { markers: { sector: 'on' } } })).view.markers.sector).toBe(false);
  });

  it('restores the table column groups', () => {
    expect(restore(withState({})).view.tableGroups).toEqual(DEFAULT_TABLE_GROUPS);
    const s = restore(withState({ view: { tableGroups: { sector: false, declared: 'yes', bogus: true } } }));
    expect(s.view.tableGroups).toEqual({ beam: true, fb: true, sidelobes: true, sector: false, declared: false });
  });

  it('round-trips the table column groups', () => {
    const before = { ...initialState() };
    before.view = { ...before.view, tableGroups: { ...DEFAULT_TABLE_GROUPS, sector: false, declared: true } };
    const s = restore(serializeProject(before, true));
    expect(s.view.tableGroups).toEqual({ ...DEFAULT_TABLE_GROUPS, sector: false, declared: true });
  });

  it('dedupes files by path, first wins', () => {
    const s = restore(
      withState({}, [
        { path: 'a.MSI', text: msi(1800) },
        { path: 'a.MSI', text: msi(1900) },
        { path: 'p.MSI' },
        { path: 'p.MSI' },
      ]),
    );
    expect(s.files.map((f) => f.id)).toEqual(['a.MSI']);
    expect(s.files[0].text).toBe(msi(1800));
    expect(s.pendingFiles).toEqual(['p.MSI']);
  });

  it('lets a project built from damaged values pass through selectInstances', () => {
    const s = restore(
      withState({
        copies: { x: null, y: { sourceId: 5 }, z: { sourceId: 'missing' } },
        names: { 'a.MSI': {} },
        tagOverrides: { 'a.MSI': 'bad' },
      }),
    );
    expect(() => selectInstances(s.files, s.tagOverrides, s.copies, s.names, s.membership)).not.toThrow();
  });
});

describe('saving with pending files', () => {
  it('keeps still-pending paths in both modes and restores them', () => {
    const st = useStore.getState;
    st().loadProject({
      format: PROJECT_FORMAT,
      version: 1,
      savedAt: '',
      files: [{ path: 'site/a.MSI' }, { path: 'site/b.MSI' }],
      state: { names: { 'site/a.MSI': 'Ay' }, copies: { 'site/a.MSI#copy-2': { sourceId: 'site/a.MSI' } } },
    });
    st().addFiles([input('site/a.MSI', msi(1800))]);
    expect(st().pendingFiles).toEqual(['site/b.MSI']);

    const layout = JSON.parse(serializeProject(st(), false));
    expect(layout.files).toEqual([{ path: 'site/a.MSI' }, { path: 'site/b.MSI' }]);
    const withFiles = JSON.parse(serializeProject(st(), true));
    expect(withFiles.files).toEqual([{ path: 'site/a.MSI', text: msi(1800) }, { path: 'site/b.MSI' }]);

    const a = restore(serializeProject(st(), true));
    expect(a.pendingFiles).toEqual(['site/b.MSI']);
    expect(a.files.map((f) => f.id)).toEqual(['site/a.MSI']);
    const b = restore(serializeProject(st(), false));
    expect(b.pendingFiles).toEqual(['site/a.MSI', 'site/b.MSI']);
    for (const r of [a, b]) {
      expect(r.names).toEqual({ 'site/a.MSI': 'Ay' });
      expect(r.copies).toEqual({ 'site/a.MSI#copy-2': { sourceId: 'site/a.MSI' } });
    }
  });
});

describe('pending files', () => {
  it('matches pending files by exact path, then by unique file name', () => {
    const pending = ['site/a.MSI', 'site/b.MSI', 'x/c.MSI', 'y/c.MSI'];
    expect(matchPending(pending, 'site/a.MSI')).toBe('site/a.MSI');
    expect(matchPending(pending, 'elsewhere/b.MSI')).toBe('site/b.MSI');
    expect(matchPending(pending, 'b.MSI')).toBe('site/b.MSI');
    expect(matchPending(pending, 'z/c.MSI')).toBeNull();
    expect(matchPending(pending, 'x/c.MSI')).toBe('x/c.MSI');
    expect(matchPending(pending, 'new.MSI')).toBeNull();
  });

  it('labels the pending list', () => {
    expect(pendingLabel(['s/a.MSI'])).toBe('1 pattern file needed: a.MSI');
    expect(pendingLabel(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => `s/${n}.MSI`))).toBe(
      '7 pattern files needed: a.MSI, b.MSI, c.MSI, d.MSI, e.MSI and 2 more',
    );
  });
});

describe('store.loadProject', () => {
  const st = useStore.getState;
  const open = (json: string) => {
    const parsed = parseProject(json);
    if (!parsed.ok) throw new Error(parsed.error);
    st().loadProject(parsed.project);
  };

  it('replaces the session and keeps the current theme', () => {
    const before = snapshot(buildSession());
    const json = serializeProject(st(), true);
    st().clear();
    st().addFiles([input('other.MSI', msi(700))]);
    st().updateView({ theme: 'dark' });
    open(json);
    expect(snapshot(st())).toEqual(before);
    expect(st().view.theme).toBe('dark');
    expect(st().files.some((f) => f.id === 'other.MSI')).toBe(false);
  });

  it('attaches re-opened files of a layout-only project under their saved paths', () => {
    buildSession();
    const json = serializeProject(st(), false);
    const saved = { names: st().names, selected: st().selected, visible: st().visible };
    st().clear();
    open(json);
    expect(st().pendingFiles).toEqual(['site/a.MSI', 'site/b.MSI', 'site/bad.pln']);

    st().addFiles([input('downloads/a.MSI', msi(1800))]);
    expect(st().files.map((f) => f.id)).toEqual(['site/a.MSI']);
    expect(st().pendingFiles).toEqual(['site/b.MSI', 'site/bad.pln']);
    expect(st().selected).toEqual(saved.selected);
    expect(st().visible).toEqual(saved.visible);
    const s = st();
    const ids = selectInstances(s.files, s.tagOverrides, s.copies, s.names, s.membership).map((i) => i.pattern.id);
    expect(ids).toEqual(['site/a.MSI', 'site/a.MSI#copy-2', 'site/a.MSI#copy-3', 'site/a.MSI#copy-4']);
  });

  it('loads unmatched and ambiguous files normally', () => {
    st().loadProject({
      format: PROJECT_FORMAT,
      version: 1,
      savedAt: '',
      files: [{ path: 'x/c.MSI' }, { path: 'y/c.MSI' }],
      state: {},
    });
    st().addFiles([input('z/c.MSI', msi(900)), input('new.MSI', msi(800))]);
    expect(st().files.map((f) => f.id)).toEqual(['z/c.MSI', 'new.MSI']);
    expect(st().pendingFiles).toEqual(['x/c.MSI', 'y/c.MSI']);
    expect(st().highlighted).toBe('z/c.MSI');
    st().dismissPending();
    expect(st().pendingFiles).toEqual([]);
  });
});
