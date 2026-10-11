import { beforeEach, describe, expect, it } from 'vitest';
import { decodeText } from './decode';
import { isPatternFile, type FileInput } from './files';
import { initialState, useStore, clampSim } from './store';
import { groupPatterns, selectErrors, selectTagged, selectWarnings, selectInstances, buildPanelGroups, instanceIds, instanceName, warningsFor } from './selectors';
import { DEFAULT_HEADERS, planetText, points } from '../test/planetText';

const enc = new TextEncoder();
const input = (path: string, text: string): FileInput => ({ path, bytes: enc.encode(text).buffer as ArrayBuffer });
const msi = (freq: number) =>
  planetText({ headers: ['NAME X', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] });

beforeEach(() => useStore.setState(initialState()));

describe('decodeText', () => {
  it('decodes UTF-8 and falls back to windows-1252', () => {
    expect(decodeText(enc.encode('8 °').buffer as ArrayBuffer)).toBe('8 °');
    expect(decodeText(new Uint8Array([0x38, 0x20, 0xb0]).buffer)).toBe('8 °');
  });
});

describe('isPatternFile', () => {
  it('accepts pattern extensions only', () => {
    expect(isPatternFile('a/b/_1710_X_CO_M45_08T_Y2.MSI')).toBe(true);
    expect(isPatternFile('x.pln')).toBe(true);
    expect(isPatternFile('Port 5 +45_12DT_1910.txt')).toBe(true);
    expect(isPatternFile('x.MSI:Zone.Identifier')).toBe(false);
    expect(isPatternFile('notes.docx')).toBe(false);
  });
});

describe('store', () => {
  it('parses added files, keyed by path, and shows the first one', () => {
    useStore.getState().addFiles([
      input('f/_1800_X_CO_P45_08T_Y2.MSI', msi(1800)),
      input('f/_1900_X_CO_P45_08T_Y2.MSI', msi(1900)),
    ]);
    const s = useStore.getState();
    expect(s.files.map((f) => f.id)).toEqual(['f/_1800_X_CO_P45_08T_Y2.MSI', 'f/_1900_X_CO_P45_08T_Y2.MSI']);
    const first = s.files[0].result;
    expect(first.ok && first.pattern.id).toBe('f/_1800_X_CO_P45_08T_Y2.MSI');
    expect(first.ok && first.pattern.fileName).toBe('_1800_X_CO_P45_08T_Y2.MSI');
    expect(s.visible).toEqual({ 'f/_1800_X_CO_P45_08T_Y2.MSI': true });
    expect(s.highlighted).toBe('f/_1800_X_CO_P45_08T_Y2.MSI');
  });

  it('skips Zone.Identifier and non-pattern files, and reports the load boundary message', () => {
    useStore.getState().addFiles([input('a.MSI:Zone.Identifier', '[ZoneTransfer]'), input('readme.docx', 'x')]);
    expect(useStore.getState().files).toEqual([]);
    expect(useStore.getState().loadMessage).toBe('No .msi/.pln/.txt files found in the selection');
  });

  it('clears the load message once files load successfully; setLoadMessage sets and dismisses it', () => {
    const st = useStore.getState;
    st().addFiles([input('readme.docx', 'x')]);
    expect(st().loadMessage).toBe('No .msi/.pln/.txt files found in the selection');
    st().addFiles([input('a.MSI', msi(1800))]);
    expect(st().loadMessage).toBeNull();
    st().setLoadMessage('Could not read 2 file(s)');
    expect(st().loadMessage).toBe('Could not read 2 file(s)');
    st().setLoadMessage(null);
    expect(st().loadMessage).toBeNull();
  });

  it('replaces a file loaded again from the same path', () => {
    useStore.getState().addFiles([input('a.MSI', msi(1800))]);
    useStore.getState().addFiles([input('a.MSI', msi(1850))]);
    const files = useStore.getState().files;
    expect(files).toHaveLength(1);
    expect(files[0].result.ok && files[0].result.pattern.frequencyMHz).toBe(1850);
  });

  it('keeps failed files as errors', () => {
    useStore.getState().addFiles([input('bad.pln', 'NAME X\nFREQUENCY 900\n')]);
    const s = useStore.getState();
    expect(selectErrors(s.files)).toEqual([{ id: 'bad.pln', path: 'bad.pln', error: 'Missing HORIZONTAL block' }]);
    expect(s.highlighted).toBeNull();
  });

  it('merges tag overrides, toggles visibility and removes files', () => {
    const st = useStore.getState;
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    st().setTags('a.MSI', { polarization: '+45', tiltDeg: 8 });
    st().setTags('a.MSI', { tiltDeg: 6 });
    expect(st().tagOverrides['a.MSI']).toEqual({ polarization: '+45', tiltDeg: 6 });
    st().toggleVisible('b.MSI');
    expect(st().visible).toEqual({ 'a.MSI': true, 'b.MSI': true });
    st().setVisible(['a.MSI', 'b.MSI'], false);
    expect(st().visible).toEqual({ 'a.MSI': false, 'b.MSI': false });
    st().removeFile('a.MSI');
    expect(st().files.map((f) => f.id)).toEqual(['b.MSI']);
    expect(st().tagOverrides).toEqual({});
    expect(st().highlighted).toBeNull();
    st().clear();
    expect(st().files).toEqual([]);
  });

  it('updates settings and view', () => {
    useStore.getState().updateSettings({ fbWindowDeg: 20 });
    useStore.getState().updateView({ mode: 'rect' });
    expect(useStore.getState().settings.fbWindowDeg).toBe(20);
    expect(useStore.getState().settings.levelDb).toBe(3);
    expect(useStore.getState().view.mode).toBe('rect');
  });

  it('stores sub-bands in the view and keeps them on clear', () => {
    expect(useStore.getState().view.subBands).toEqual([]);
    const subBands = [{ name: 'A', minMHz: 1, maxMHz: 2 }];
    useStore.getState().updateView({ subBands });
    expect(useStore.getState().view.subBands).toEqual(subBands);
    useStore.getState().clear();
    expect(useStore.getState().view.subBands).toEqual(subBands);
  });

  it('starts in 2D with summation and side-by-side 3D defaults', () => {
    expect(useStore.getState().view).toMatchObject({ dimension: '2d', method3d: 'summation', layout3d: 'grid' });
  });

  it('starts with no simulation', () => {
    expect(useStore.getState().view.simulation).toEqual({
      electricalDeg: 0,
      mechanicalDeg: 0,
      azimuthDeg: 0,
      showOriginal: true,
      offsets: {},
      groupOffsets: {},
    });
  });

  it('clamps and rounds simulation values', () => {
    expect(clampSim('electricalDeg', 3.3)).toBe(3.5);
    expect(clampSim('electricalDeg', 99)).toBe(15);
    expect(clampSim('mechanicalDeg', -42)).toBe(-10);
    expect(clampSim('azimuthDeg', 200)).toBe(180);
    expect(clampSim('azimuthDeg', 12.4)).toBe(12);
    expect(clampSim('electricalDeg', NaN)).toBe(0);
    expect(clampSim('azimuthDeg', NaN)).toBe(0);
    useStore.getState().updateSimulation({ mechanicalDeg: 20, showOriginal: false });
    expect(useStore.getState().view.simulation).toMatchObject({ mechanicalDeg: 15, showOriginal: false });
  });

  it('resets globals and all offsets but keeps "show original"', () => {
    const st = useStore.getState;
    st().updateSimulation({ electricalDeg: 2, mechanicalDeg: 3, azimuthDeg: 40, showOriginal: false });
    st().setOffset('a.MSI', { mechanicalDeg: 2 });
    st().resetSimulation();
    expect(st().view.simulation).toEqual({
      electricalDeg: 0,
      mechanicalDeg: 0,
      azimuthDeg: 0,
      showOriginal: false,
      offsets: {},
      groupOffsets: {},
    });
  });

  it('sets, clamps and deletes per-file offsets', () => {
    const st = useStore.getState;
    st().setOffset('a.MSI', { mechanicalDeg: 2.3 });
    st().setOffset('a.MSI', { azimuthDeg: 500 });
    expect(st().view.simulation.offsets['a.MSI']).toEqual({ electricalDeg: 0, mechanicalDeg: 2.5, azimuthDeg: 180 });
    st().setOffset('a.MSI', { mechanicalDeg: 0, azimuthDeg: 0 });
    expect(st().view.simulation.offsets).toEqual({});
    st().setOffset('a.MSI', { electricalDeg: 1 });
    st().clearOffsets('a.MSI');
    expect(st().view.simulation.offsets).toEqual({});
  });

  it('keeps offsets on reload and drops them on remove and clear', () => {
    const st = useStore.getState;
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    st().setOffset('a.MSI', { mechanicalDeg: 2 });
    st().setOffset('b.MSI', { azimuthDeg: 30 });
    st().addFiles([input('a.MSI', msi(1850))]);
    expect(Object.keys(st().view.simulation.offsets)).toEqual(['a.MSI', 'b.MSI']);
    st().removeFile('a.MSI');
    expect(Object.keys(st().view.simulation.offsets)).toEqual(['b.MSI']);
    st().clear();
    expect(st().view.simulation.offsets).toEqual({});
  });
});

describe('selectors', () => {
  it('groups tagged patterns, sorts by frequency and puts Ungrouped last', () => {
    useStore.getState().addFiles([
      input('_1900_X_CO_P45_08T_Y2.MSI', msi(1900)),
      input('plain.msi', msi(700)),
      input('_1800_X_CO_P45_08T_Y2.MSI', msi(1800)),
      input('_1800_X_CO_M45_08T_Y2.MSI', msi(1800)),
    ]);
    const s = useStore.getState();
    const groups = groupPatterns(selectTagged(s.files, s.tagOverrides));
    expect(groups.map((g) => g.label)).toEqual(['+45 · 8°T · Y2', '-45 · 8°T · Y2', 'Ungrouped']);
    expect(groups[0].items.map((i) => i.pattern.frequencyMHz)).toEqual([1800, 1900]);
    expect(groups[0].tags).toEqual({ polarization: '+45', tiltDeg: 8, port: undefined, array: 'Y2' });
  });

  it('applies overrides on top of inferred tags', () => {
    useStore.getState().addFiles([input('plain.msi', msi(700))]);
    useStore.getState().setTags('plain.msi', { polarization: '-45', tiltDeg: 2 });
    const s = useStore.getState();
    expect(groupPatterns(selectTagged(s.files, s.tagOverrides))[0].label).toBe('-45 · 2°T');
  });

  it('lists warnings per file', () => {
    useStore.getState().addFiles([input('w.msi', planetText({ headers: [...DEFAULT_HEADERS, 'FOO 1'], h: points(() => 1) }))]);
    expect(selectWarnings(useStore.getState().files).get('w.msi')).toEqual([
      'Unknown header "FOO"',
      'HORIZONTAL cut minimum is 1 dB, not 0; analysis normalises it',
    ]);
  });

  it('resolves a copy id to its source path\'s warnings', () => {
    const warnings = new Map([['w.msi', ['Unknown header "FOO"']]]);
    const copies = { 'w.msi#copy-2': { sourceId: 'w.msi' } };
    expect(warningsFor('w.msi', warnings, copies)).toEqual(['Unknown header "FOO"']);
    expect(warningsFor('w.msi#copy-2', warnings, copies)).toEqual(['Unknown header "FOO"']);
    expect(warningsFor('other.msi', warnings, copies)).toBeUndefined();
  });
});

describe('pattern management', () => {
  const st = useStore.getState;
  const load2 = () => st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);

  it('duplicates with the smallest free copy number and copies the source state', () => {
    load2();
    st().setTags('a.MSI', { tiltDeg: 3 });
    st().setOffset('a.MSI', { mechanicalDeg: 2 });
    const g = st().createGroup('Site X');
    st().setMembership('a.MSI', g);
    expect(st().duplicate('a.MSI')).toBe('a.MSI#copy-2');
    expect(st().duplicate('a.MSI')).toBe('a.MSI#copy-3');
    st().removeFile('a.MSI#copy-2');
    expect(st().duplicate('a.MSI#copy-3')).toBe('a.MSI#copy-2');
    const s = st();
    expect(s.copies['a.MSI#copy-3']).toEqual({ sourceId: 'a.MSI' });
    expect(s.tagOverrides['a.MSI#copy-3']).toEqual({ tiltDeg: 3 });
    expect(s.view.simulation.offsets['a.MSI#copy-3']).toEqual({ electricalDeg: 0, mechanicalDeg: 2, azimuthDeg: 0 });
    expect(s.membership['a.MSI#copy-3']).toBe(g);
    expect(s.visible['a.MSI#copy-3']).toBe(true);
    expect(st().duplicate('missing')).toBeNull();
  });

  it('renames and clears names', () => {
    load2();
    st().rename('a.MSI', '  North ');
    expect(st().names['a.MSI']).toBe('North');
    const c = st().duplicate('a.MSI')!;
    expect(st().names[c]).toBe('North (copy)');
    st().rename('a.MSI', '   ');
    expect(st().names['a.MSI']).toBeUndefined();
  });

  it('removes an original with its copies, and a copy alone', () => {
    load2();
    const c2 = st().duplicate('a.MSI')!;
    const c3 = st().duplicate('a.MSI')!;
    st().removeFile(c3);
    expect(Object.keys(st().copies)).toEqual([c2]);
    st().setOffset(c2, { azimuthDeg: 10 });
    st().removeFile('a.MSI');
    expect(st().copies).toEqual({});
    expect(st().view.simulation.offsets).toEqual({});
    expect(st().files.map((f) => f.id)).toEqual(['b.MSI']);
  });

  it('creates, renames, duplicates and deletes custom groups', () => {
    load2();
    const g = st().createGroup();
    expect(st().customGroups).toEqual([{ id: g, name: 'Group 1' }]);
    st().renameGroup(g, '  ');
    expect(st().customGroups[0].name).toBe('Group 1');
    st().renameGroup(g, 'North site');
    st().setMembership('a.MSI', g);
    st().setGroupOffset(g, { azimuthDeg: 30 });
    const g2 = st().duplicateGroup(g)!;
    expect(st().customGroups.map((x) => x.name)).toEqual(['North site', 'North site (copy)']);
    expect(Object.entries(st().membership).filter(([, v]) => v === g2).map(([k]) => k)).toEqual(['a.MSI#copy-2']);
    expect(st().view.simulation.groupOffsets[g2]).toEqual({ electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 30 });
    st().select({ kind: 'group', id: g });
    st().deleteGroup(g);
    expect(st().membership['a.MSI']).toBeUndefined();
    expect(st().view.simulation.groupOffsets[g]).toBeUndefined();
    expect(st().selected).toBeNull();
  });

  it('ignores rename, setMembership, setGroupOffset and renameGroup on ids/groups that do not exist', () => {
    load2();
    const g = st().createGroup('North');

    st().rename('missing', 'X');
    expect(st().names['missing']).toBeUndefined();

    // setMembership ignores an unknown group id (documented deviation: it does not check the
    // instance id — see the comment on its store implementation).
    st().setMembership('a.MSI', 'no-such-group');
    expect(st().membership['a.MSI']).toBeUndefined();

    st().setGroupOffset('no-such-group', { azimuthDeg: 10 });
    expect(st().view.simulation.groupOffsets['no-such-group']).toBeUndefined();

    st().renameGroup('no-such-group', 'Y');
    expect(st().customGroups).toEqual([{ id: g, name: 'North' }]);

    // the same ids/groups still work once they're real
    st().setMembership('a.MSI', g);
    expect(st().membership['a.MSI']).toBe(g);
    st().setGroupOffset(g, { azimuthDeg: 10 });
    expect(st().view.simulation.groupOffsets[g]).toEqual({ electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 10 });
    st().renameGroup(g, 'South');
    expect(st().customGroups).toEqual([{ id: g, name: 'South' }]);
  });

  it('selects files and groups', () => {
    load2();
    expect(st().selected).toEqual({ kind: 'file', id: 'a.MSI' });
    st().select({ kind: 'file', id: 'b.MSI' });
    expect(st().highlighted).toBe('b.MSI');
    st().setHighlighted('a.MSI');
    expect(st().selected).toEqual({ kind: 'file', id: 'a.MSI' });
  });

  it('creates a site of N sectors', () => {
    load2();
    const g = st().createSite('a.MSI', 3)!;
    const s = st();
    expect(s.customGroups.find((x) => x.id === g)!.name).toBe('Site 1');
    const ids = ['a.MSI#copy-2', 'a.MSI#copy-3', 'a.MSI#copy-4'];
    expect(ids.map((id) => s.names[id])).toEqual(['Sector A', 'Sector B', 'Sector C']);
    expect(ids.map((id) => s.view.simulation.offsets[id]?.azimuthDeg ?? 0)).toEqual([0, 120, -120]);
    expect(ids.every((id) => s.membership[id] === g)).toBe(true);
    expect(Object.entries(s.visible).filter(([, v]) => v).map(([k]) => k)).toEqual(ids);
    expect(s.selected).toEqual({ kind: 'group', id: g });
    expect(s.view.dimension).toBe('3d');
    expect(s.view.layout3d).toBe('overlay');
    expect(st().createSite('a.MSI', 99)).not.toBeNull();
    expect(Object.keys(st().copies)).toHaveLength(3 + 12);
    expect(st().customGroups.map((x) => x.name)).toEqual(['Site 1', 'Site 2']);
    expect(st().createSite('missing', 3)).toBeNull();
  });

  it('clears everything on clear and resets group offsets on reset', () => {
    load2();
    const g = st().createSite('a.MSI', 2)!;
    st().setGroupOffset(g, { mechanicalDeg: 2 });
    st().rename('b.MSI', 'B');
    st().resetSimulation();
    expect(st().view.simulation.groupOffsets).toEqual({});
    st().clear();
    const s = st();
    expect([s.copies, s.names, s.membership, s.customGroups, s.selected]).toEqual([{}, {}, {}, [], null]);
  });
});

describe('instances and panel groups', () => {
  const st = useStore.getState;

  it('lists copies right after their source and reuses instance pattern objects', () => {
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    const c = st().duplicate('a.MSI')!;
    st().rename('b.MSI', 'Bee');
    const s = st();
    const t = selectInstances(s.files, s.tagOverrides, s.copies, s.names, s.membership);
    expect(t.map((i) => i.pattern.id)).toEqual(['a.MSI', c, 'b.MSI']);
    expect(t[1].pattern.horizontal).toBe(t[0].pattern.horizontal);
    expect(t[1].pattern.displayName).toBe('a.MSI (copy 2)');
    expect(t[2].pattern.displayName).toBe('Bee');
    const again = selectInstances(s.files, s.tagOverrides, s.copies, s.names, s.membership);
    expect(again[1].pattern).toBe(t[1].pattern);
    expect(again[2].pattern).toBe(t[2].pattern);
  });

  it('returns the parsed pattern itself for an unrenamed original', () => {
    st().addFiles([input('a.MSI', msi(1800))]);
    const s = st();
    const f0 = s.files[0].result;
    if (!f0.ok) throw new Error('parse failed');
    expect(selectInstances(s.files, s.tagOverrides, s.copies, s.names, s.membership)[0].pattern).toBe(f0.pattern);
  });

  it('updates copies when the source is reloaded and scopes custom-group members', () => {
    st().addFiles([input('a.MSI', msi(1800))]);
    const c = st().duplicate('a.MSI')!;
    const g = st().createGroup('S');
    st().setMembership(c, g);
    st().addFiles([input('a.MSI', msi(1850))]);
    const s = st();
    const t = selectInstances(s.files, s.tagOverrides, s.copies, s.names, s.membership);
    expect(t.map((i) => i.pattern.frequencyMHz)).toEqual([1850, 1850]);
    expect(t[1].scope).toBe(g);
    expect(t[0].scope).toBeUndefined();
    const groups = buildPanelGroups(t, s.customGroups);
    expect(groups[0]).toMatchObject({ key: `custom:${g}`, label: 'S', customId: g });
    expect(groups[0].items.map((i) => i.pattern.id)).toEqual([c]);
    expect(groups.slice(1).flatMap((x) => x.items.map((i) => i.pattern.id))).toEqual(['a.MSI']);
    expect(instanceIds(s.files, s.copies)).toEqual(['a.MSI', c]);
  });

  it('tags a copy with copyOf (the source path), and leaves originals untagged', () => {
    st().addFiles([input('a.MSI', msi(1800))]);
    const c = st().duplicate('a.MSI')!;
    const s = st();
    const t = selectInstances(s.files, s.tagOverrides, s.copies, s.names, s.membership);
    expect(t.find((i) => i.pattern.id === 'a.MSI')!.copyOf).toBeUndefined();
    expect(t.find((i) => i.pattern.id === c)!.copyOf).toBe('a.MSI');
  });

  it('names copies', () => {
    expect(instanceName('p#copy-3', 'p.MSI', {})).toBe('p.MSI (copy 3)');
    expect(instanceName('p', 'p.MSI', {})).toBeUndefined();
    expect(instanceName('p#copy-3', 'p.MSI', { 'p#copy-3': 'X' })).toBe('X');
  });
});
