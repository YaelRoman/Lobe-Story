import { beforeEach, describe, expect, it } from 'vitest';
import {
  parseProject,
  pendingLabel,
  PROJECT_FORMAT,
  projectToState,
  serializeProject,
} from './project';
import { DEFAULT_TABLE_GROUPS, initialState, loadText, useStore, type StoreData } from './store';
import { selectInstances } from './selectors';
import { fingerprint } from './duplicates';
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
  delete view.collapsed;
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

const restore = (json: string, theme: 'light' | 'dark' = 'light', collapsed = initialState().view.collapsed): StoreData => {
  const parsed = parseProject(json);
  if (!parsed.ok) throw new Error(parsed.error);
  return { ...initialState(), ...projectToState(parsed.project, initialState(), { theme, collapsed, freqMetric: 'hHpbw', tableTickedOnly: false }, loadText) };
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
    expect(JSON.parse(json).files).toEqual([
      { path: 'site/a.MSI', fp: fingerprint(msi(1800)) },
      { path: 'site/b.MSI', fp: fingerprint(msi(1900)) },
      { path: 'site/bad.pln', fp: fingerprint('NAME X\n') },
    ]);
    const after = restore(json);
    expect(after.files).toEqual([]);
    expect(after.pendingFiles.map((p) => p.path)).toEqual(['site/a.MSI', 'site/b.MSI', 'site/bad.pln']);
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
    const big = { levelDb: 1e9, fbWindowDeg: 1e9, uslsRangeDeg: 1e9, sectorEdgeDeg: 1e9, lobeLimitFactor: 1e9 };
    expect(restore(withState({ settings: big })).settings).toEqual(initialState().settings);
    // Wider values that older project files may hold are out of range now.
    expect(restore(withState({ settings: { levelDb: 100, fbWindowDeg: 360 } })).settings).toMatchObject({
      levelDb: 3,
      fbWindowDeg: 30,
    });
  });

  it('accepts each setting at its bounds and falls back just outside them', () => {
    const settings = (raw: object) => restore(withState({ settings: raw })).settings;
    const cases: [string, number, number][] = [
      ['levelDb', 0.5, 20],
      ['fbWindowDeg', 1, 180],
      ['uslsRangeDeg', 1, 90],
      ['sectorEdgeDeg', 1, 179],
      ['siteSectors', 2, 12],
      ['lobeLimitFactor', 1, 10],
    ];
    const defaults = initialState().settings as unknown as Record<string, number>;
    for (const [key, min, max] of cases) {
      const get = (v: number) => (settings({ [key]: v }) as unknown as Record<string, number>)[key];
      expect(get(min), key).toBe(min);
      expect(get(max), key).toBe(max);
      expect(get(min - 0.01), key).toBe(defaults[key]);
      expect(get(max + 0.01), key).toBe(defaults[key]);
    }
  });

  it('sanitises the plot floor against its range', () => {
    const floor = (v: unknown) => restore(withState({ view: { floorDb: v } })).view.floorDb;
    expect(floor(10)).toBe(10);
    expect(floor(80)).toBe(80);
    expect(floor(500)).toBe(40);
    expect(floor(9)).toBe(40);
  });

  it('raises a plot floor that lies less than 1 dB beyond the beamwidth level, and says so', () => {
    const json = withState({ settings: { levelDb: 20 }, view: { floorDb: 15 } });
    const r = restore(json);
    expect(r.view.floorDb).toBe(21);
    expect(r.loadMessage).toContain('Plot floor raised to 21 dB');
    expect(restore(withState({ settings: { levelDb: 3 }, view: { floorDb: 15 } })).loadMessage).toBeNull();
    useStore.setState(initialState());
    const parsed = parseProject(json);
    if (!parsed.ok) throw new Error(parsed.error);
    useStore.getState().loadProject(parsed.project);
    expect(useStore.getState().view.floorDb).toBe(21);
    expect(useStore.getState().loadMessage).toContain('Plot floor raised');
  });

  it('ignores the removed null search setting', () => {
    const s = restore(withState({ settings: { nullSearchDeg: 45, uslsRangeDeg: 15 } })).settings;
    expect(s.uslsRangeDeg).toBe(15);
    expect('nullSearchDeg' in s).toBe(false);
  });

  it('sanitises the first-lobe limit', () => {
    const factor = (raw: object) => restore(withState({ settings: raw })).settings.lobeLimitFactor;
    expect(factor({ lobeLimitFactor: 0.5 })).toBe(1.78);
    expect(factor({ lobeLimitFactor: 11 })).toBe(1.78);
    expect(factor({ lobeLimitFactor: 2.25 })).toBe(2.25);
    expect(factor({ lobeLimitFactor: 1 })).toBe(1);
    expect(factor({ lobeLimitFactor: 10 })).toBe(10);
    expect(factor({ levelDb: 3 })).toBe(1.78); // old project file without the key
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
    expect(s.view.tableGroups).toEqual({ beam: true, fb: true, sidelobes: true, sector: false, declared: false, are: false });
    expect(restore(withState({ view: { tableGroups: { are: true } } })).view.tableGroups).toEqual({ ...DEFAULT_TABLE_GROUPS, are: true });
  });

  it('keeps the current fold state: a saved one is ignored, and none is written', () => {
    const folded = { simBar: true, markers: false };
    const raw = JSON.parse(serializeProject(buildSession(), true));
    expect(raw.state.view.collapsed).toBeUndefined();
    raw.state.view.collapsed = { simBar: false, markers: true };
    // The session has an active simulation, so the simulation bar opens; the marker fold stays as it was and the saved values are ignored.
    expect(restore(JSON.stringify(raw), 'light', folded).view.collapsed).toEqual({ ...folded, simBar: false });
  });

  it('round-trips the table column groups', () => {
    const before = { ...initialState() };
    before.view = { ...before.view, tableGroups: { ...DEFAULT_TABLE_GROUPS, sector: false, declared: true } };
    const s = restore(serializeProject(before, true));
    expect(s.view.tableGroups).toEqual({ ...DEFAULT_TABLE_GROUPS, sector: false, declared: true });
  });

  it('restores and round-trips sub-bands', () => {
    expect(restore(withState({})).view.subBands).toEqual([]);
    const s = restore(withState({ view: { subBands: [{ name: 'L', minMHz: 1920, maxMHz: 1710 }, 'junk'] } }));
    expect(s.view.subBands).toEqual([{ name: 'L', minMHz: 1710, maxMHz: 1920 }]);
    const before = { ...initialState() };
    const two = [
      { name: 'A', minMHz: 880, maxMHz: 960 },
      { name: 'B', minMHz: 1710, maxMHz: 1880 },
    ];
    before.view = { ...before.view, subBands: two };
    expect(restore(serializeProject(before, true)).view.subBands).toEqual(two);
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
    expect(s.pendingFiles.map((p) => p.path)).toEqual(['p.MSI']);
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
    expect(st().pendingFiles.map((p) => p.path)).toEqual(['site/b.MSI']);

    const layout = JSON.parse(serializeProject(st(), false));
    const fp = fingerprint(msi(1800));
    expect(layout.files).toEqual([{ path: 'site/a.MSI', fp }, { path: 'site/b.MSI' }]);
    const withFiles = JSON.parse(serializeProject(st(), true));
    expect(withFiles.files).toEqual([{ path: 'site/a.MSI', text: msi(1800), fp }, { path: 'site/b.MSI' }]);

    const a = restore(serializeProject(st(), true));
    expect(a.pendingFiles.map((p) => p.path)).toEqual(['site/b.MSI']);
    expect(a.files.map((f) => f.id)).toEqual(['site/a.MSI']);
    const b = restore(serializeProject(st(), false));
    expect(b.pendingFiles.map((p) => p.path)).toEqual(['site/a.MSI', 'site/b.MSI']);
    for (const r of [a, b]) {
      expect(r.names).toEqual({ 'site/a.MSI': 'Ay' });
      expect(r.copies).toEqual({ 'site/a.MSI#copy-2': { sourceId: 'site/a.MSI' } });
    }
  });
});

describe('a failed file on a pending path', () => {
  it('does not make a save list the path twice: the pending entry and its fingerprint win', () => {
    const st = useStore.getState;
    const fp = fingerprint(msi(1800));
    st().loadProject({ format: PROJECT_FORMAT, version: 1, savedAt: '', files: [{ path: 'a.msi', fp }], state: {} });
    st().addFiles([input('a.msi', 'NAME X\nFREQUENCY 900\n')]);
    expect(st().files.map((f) => f.id)).toEqual(['a.msi']);
    expect(st().files[0].result.ok).toBe(false);
    expect(st().pendingFiles).toEqual([{ path: 'a.msi', fp }]);

    for (const includeFiles of [false, true]) {
      const saved = JSON.parse(serializeProject(st(), includeFiles));
      expect(saved.files).toEqual([{ path: 'a.msi', fp }]);
      const reopened = restore(serializeProject(st(), includeFiles));
      expect(reopened.files).toEqual([]);
      expect(reopened.pendingFiles).toEqual([{ path: 'a.msi', fp }]);
    }
  });

  it('is still saved when no pending entry waits for the path', () => {
    const st = useStore.getState;
    st().addFiles([input('a.msi', 'NAME X\nFREQUENCY 900\n')]);
    expect(JSON.parse(serializeProject(st(), false)).files.map((f: { path: string }) => f.path)).toEqual(['a.msi']);
  });
});

describe('pending files', () => {
  it('labels the pending list', () => {
    expect(pendingLabel([{ path: 's/a.MSI' }])).toBe('1 pattern file needed: a.MSI');
    expect(pendingLabel(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => ({ path: `s/${n}.MSI` })))).toBe(
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
    st().updateView({ theme: 'dark', collapsed: { simBar: true, markers: true } });
    open(json);
    expect(snapshot(st())).toEqual(before);
    expect(st().view.theme).toBe('dark');
    // The project's simulation is active, so the bar opens; the marker fold stays as it was.
    expect(st().view.collapsed).toEqual({ simBar: false, markers: true });
    expect(st().files.some((f) => f.id === 'other.MSI')).toBe(false);
  });

  it('unfolds the simulation bar for a project with an active simulation, and leaves the folds alone otherwise', () => {
    st().addFiles([input('site/a.MSI', msi(1800))]);
    const plain = serializeProject(st(), true);
    st().updateSimulation({ mechanicalDeg: 4 });
    const simulated = serializeProject(st(), true);
    st().clear();
    st().updateView({ collapsed: { simBar: true, markers: true } });
    open(plain);
    expect(st().view.collapsed).toEqual({ simBar: true, markers: true });
    open(simulated);
    expect(st().view.collapsed).toEqual({ simBar: false, markers: true });
    // A single file offset counts as an active simulation too.
    st().resetSimulation('all');
    st().setOffset('site/a.MSI', { electricalDeg: 1 });
    const offset = serializeProject(st(), true);
    st().updateView({ collapsed: { simBar: true, markers: false } });
    open(offset);
    expect(st().view.collapsed).toEqual({ simBar: false, markers: false });
  });

  it('attaches re-opened files of a layout-only project under their saved paths', () => {
    buildSession();
    const json = serializeProject(st(), false);
    const saved = { names: st().names, selected: st().selected, visible: st().visible };
    st().clear();
    open(json);
    expect(st().pendingFiles.map((p) => p.path)).toEqual(['site/a.MSI', 'site/b.MSI', 'site/bad.pln']);

    st().addFiles([input('downloads/a.MSI', msi(1800))]);
    expect(st().files.map((f) => f.id)).toEqual(['site/a.MSI']);
    expect(st().pendingFiles.map((p) => p.path)).toEqual(['site/b.MSI', 'site/bad.pln']);
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
    expect(st().pendingFiles.map((p) => p.path)).toEqual(['x/c.MSI', 'y/c.MSI']);
    expect(st().highlighted).toBe('z/c.MSI');
    st().dismissPending();
    expect(st().pendingFiles).toEqual([]);
  });
});

describe('layout-only projects with numbered same-name files (B1)', () => {
  const st = useStore.getState;
  const open = (json: string) => {
    const parsed = parseProject(json);
    if (!parsed.ok) throw new Error(parsed.error);
    st().loadProject(parsed.project);
  };
  const second = 'a (2).msi';
  const build = () => {
    st().addFiles([input('a.msi', msi(1800)), input('a.msi', msi(1850))]);
    expect(st().files.map((f) => f.id)).toEqual(['a.msi', second]);
    st().rename(second, 'Second');
    const copy = st().duplicate(second)!;
    const g = st().createGroup('G');
    st().setMembership(second, g);
    st().setOffset(second, { azimuthDeg: 20 });
    st().setTags(second, { tiltDeg: 4 });
    const json = serializeProject(st(), false);
    st().clear();
    return { json, copy, g };
  };
  const expectAttached = (copy: string, g: string) => {
    const s = st();
    expect(s.pendingFiles).toEqual([]);
    expect(s.files).toHaveLength(2);
    const freq = Object.fromEntries(s.files.map((f) => [f.id, f.result.ok && f.result.pattern.frequencyMHz]));
    expect(freq).toEqual({ 'a.msi': 1800, [second]: 1850 });
    // Nothing orphaned: every name, copy, membership, offset and tag override belongs to a file that is there.
    const ids = selectInstances(s.files, s.tagOverrides, s.copies, s.names, s.membership);
    expect(ids.map((i) => i.pattern.id).sort()).toEqual(['a.msi', second, copy].sort());
    expect(s.names[second]).toBe('Second');
    expect(s.copies[copy]).toEqual({ sourceId: second });
    expect(s.membership[second]).toBe(g);
    expect(s.view.simulation.offsets[second]).toMatchObject({ azimuthDeg: 20 });
    expect(s.tagOverrides[second]).toEqual({ tiltDeg: 4 });
    expect(ids.find((i) => i.pattern.id === copy)!.pattern.frequencyMHz).toBe(1850);
  };

  it.each([
    ['in the saved order', [1800, 1850]],
    ['in the other order', [1850, 1800]],
  ])('re-attaches two files both named a.msi picked %s', (_label, order) => {
    const { json, copy, g } = build();
    expect(JSON.parse(json).files.every((f: { fp?: string; text?: string }) => typeof f.fp === 'string' && f.text === undefined)).toBe(true);
    open(json);
    expect(st().pendingFiles.map((p) => p.path)).toEqual(['a.msi', second]);
    st().addFiles(order.map((f) => input('a.msi', msi(f))));
    expectAttached(copy, g);
  });

  it('re-attaches them one selection at a time, from another folder, numbered one first', () => {
    const { json, copy, g } = build();
    open(json);
    st().addFiles([input('downloads/a.msi', msi(1850))]);
    expect(st().files.map((f) => f.id)).toEqual([second]);
    st().addFiles([input('downloads/a.msi', msi(1800))]);
    expectAttached(copy, g);
  });

  it('does not let an edited file take the place of one that is in the same selection', () => {
    const { json } = build();
    open(json);
    st().addFiles([input('a.msi', msi(1700)), input('a.msi', msi(1800))]);
    const freq = Object.fromEntries(st().files.map((f) => [f.id, f.result.ok && f.result.pattern.frequencyMHz]));
    expect(freq).toEqual({ 'a.msi': 1800, [second]: 1700 });
  });

  it('still matches a legacy project without fingerprints by path, then by unique name', () => {
    const { json, copy, g } = build();
    const raw = JSON.parse(json);
    raw.files = raw.files.map((f: { path: string }) => ({ path: f.path }));
    open(JSON.stringify(raw));
    expect(st().pendingFiles).toEqual([{ path: 'a.msi' }, { path: second }]);
    // Exact path; then the numbered pending path is satisfied by its un-numbered base name.
    st().addFiles([input('a.msi', msi(1800)), input('elsewhere/a.msi', msi(1850))]);
    expectAttached(copy, g);
  });

  it('ignores a damaged fingerprint', () => {
    const { json } = build();
    const raw = JSON.parse(json);
    raw.files[0].fp = { evil: true };
    raw.files[1].fp = 'x'.repeat(5000);
    const parsed = parseProject(JSON.stringify(raw));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(() => st().loadProject(parsed.project)).not.toThrow();
    expect(st().pendingFiles).toEqual([{ path: 'a.msi' }, { path: second }]);
    const direct = projectToState(
      { format: PROJECT_FORMAT, version: 1, savedAt: '', files: [{ path: 'q.msi', fp: 7 as never }], state: {} },
      initialState(),
      { theme: 'light', collapsed: initialState().view.collapsed, freqMetric: 'hHpbw', tableTickedOnly: false },
      loadText,
    );
    expect(direct.pendingFiles).toEqual([{ path: 'q.msi' }]);
  });
});

describe('group names on load', () => {
  it('gives a later group of the same name a suffix', () => {
    const state = {
      customGroups: [
        { id: 'g1', name: 'North' },
        { id: 'g2', name: 'north' },
        { id: 'g3', name: 'North' },
      ],
    };
    const out = projectToState(
      { format: PROJECT_FORMAT, version: 1, savedAt: '', files: [], state },
      initialState(),
      { theme: 'light', collapsed: initialState().view.collapsed, freqMetric: 'hHpbw', tableTickedOnly: false },
      loadText,
    );
    expect(out.customGroups!.map((g) => g.name)).toEqual(['North', 'north (2)', 'North (3)']);
    expect(out.customGroups!.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
  });
});
