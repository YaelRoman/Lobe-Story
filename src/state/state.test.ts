import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeText } from './decode';
import { isPatternFile, type FileInput } from './files';
import { COPY_NOTE_MS, initialState, useStore, clampSim } from './store';
import { groupPatterns, selectErrors, selectTagged, selectWarnings, selectInstances, buildPanelGroups, instanceIds, instanceName, warningsFor } from './selectors';
import { changesSession, clearNeedsConfirm, clearQuestion, isDirty, markOf, stableStringify, takeSnapshot } from './undo';
import { openedMessage, parseProject, savedCounts, savedMessage, serializeProject } from './project';
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
    expect(st().loadMessage).toBe('Loaded 1 file');
    st().setLoadMessage('Could not read 2 file(s)');
    expect(st().loadMessage).toBe('Could not read 2 file(s)');
    st().setLoadMessage(null);
    expect(st().loadMessage).toBeNull();
  });

  it('skips a file loaded again with identical content and says so', () => {
    useStore.getState().addFiles([input('a.MSI', msi(1800))]);
    const before = useStore.getState().files;
    useStore.getState().addFiles([input('a.MSI', msi(1800))]);
    expect(useStore.getState().files).toBe(before);
    expect(useStore.getState().loadMessage).toBe('No new files loaded: 1 already loaded (skipped)');
  });

  it('keeps both when the same name arrives with different content', () => {
    useStore.getState().addFiles([input('a.MSI', msi(1800))]);
    useStore.getState().addFiles([input('a.MSI', msi(1850))]);
    const s = useStore.getState();
    expect(s.files.map((f) => f.id)).toEqual(['a.MSI', 'a (2).MSI']);
    expect(s.files.map((f) => f.result.ok && f.result.pattern.frequencyMHz)).toEqual([1800, 1850]);
    expect(s.files[1].result.ok && s.files[1].result.pattern.id).toBe('a (2).MSI');
    expect(s.loadMessage).toContain('Loaded 1 file');
    expect(s.loadMessage).toContain('1 same-name file with different content added as a numbered copy');
    useStore.getState().addFiles([input('a.MSI', msi(1900))]);
    expect(useStore.getState().files.map((f) => f.id)).toEqual(['a.MSI', 'a (2).MSI', 'a (3).MSI']);
  });

  it('still reads the tags from a numbered file name', () => {
    const name = '_1800_X_CO_P45_08T_Y2.MSI';
    useStore.getState().addFiles([input(name, msi(1800)), input(name, msi(1850))]);
    const s = useStore.getState();
    const t = selectInstances(s.files, s.tagOverrides, s.copies, s.names, s.membership);
    expect(t[0].tags.tiltDeg).toBeDefined();
    expect(t[1].tags).toEqual(t[0].tags);
  });

  it('handles same-name files inside one selection, including a repeat of identical content', () => {
    useStore.getState().addFiles([
      input('a.MSI', msi(1800)),
      input('a.MSI', msi(1850)),
      input('a.MSI', msi(1800)),
      input('b/a.MSI', msi(1800)),
    ]);
    const s = useStore.getState();
    // The same content under the same name is one file, whatever folder it came from.
    expect(s.files.map((f) => f.id)).toEqual(['a.MSI', 'a (2).MSI']);
    expect(s.loadMessage).toContain('2 already loaded (skipped)');
  });

  it('numbers a duplicate before the extension and keeps copies of the original attached to it', () => {
    useStore.getState().addFiles([input('dir/p.msi', msi(1800))]);
    const c = useStore.getState().duplicate('dir/p.msi')!;
    useStore.getState().addFiles([input('dir/p.msi', msi(1850))]);
    const s = useStore.getState();
    expect(s.files.map((f) => f.id)).toEqual(['dir/p.msi', 'dir/p (2).msi']);
    expect(instanceIds(s.files, s.copies)).toEqual(['dir/p.msi', c, 'dir/p (2).msi']);
    const t = selectInstances(s.files, s.tagOverrides, s.copies, s.names, s.membership);
    expect(t.find((i) => i.pattern.id === c)!.pattern.frequencyMHz).toBe(1800);
  });

  it('recognises identical content among a name and its numbered entries', () => {
    useStore.getState().addFiles([input('a.MSI', msi(1800)), input('a.MSI', msi(1850))]);
    useStore.getState().addFiles([input('a.MSI', msi(1850)), input('a.MSI', msi(1800))]);
    expect(useStore.getState().files.map((f) => f.id)).toEqual(['a.MSI', 'a (2).MSI']);
    expect(useStore.getState().loadMessage).toBe('No new files loaded: 2 already loaded (skipped)');
  });

  it('replaces an earlier file of the same name that failed to parse', () => {
    useStore.getState().addFiles([input('a.MSI', 'NAME X\nFREQUENCY 900\n')]);
    useStore.getState().addFiles([input('a.MSI', msi(1800))]);
    const s = useStore.getState();
    expect(s.files.map((f) => f.id)).toEqual(['a.MSI']);
    expect(s.files[0].result.ok).toBe(true);
  });

  it('keeps the pending-file match by path or unique name working next to duplicate handling', () => {
    useStore.setState({ pendingFiles: [{ path: 'site/_1800_X.msi' }, { path: 'site/other.msi' }] });
    useStore.getState().addFiles([input('_1800_X.msi', msi(1800))]);
    let s = useStore.getState();
    expect(s.files.map((f) => f.id)).toEqual(['site/_1800_X.msi']);
    expect(s.pendingFiles.map((p) => p.path)).toEqual(['site/other.msi']);
    useStore.getState().addFiles([input('site/_1800_X.msi', msi(1800))]);
    expect(useStore.getState().loadMessage).toBe('No new files loaded: 1 already loaded (skipped)');
    useStore.getState().addFiles([input('other.msi', msi(1900))]);
    s = useStore.getState();
    expect(s.pendingFiles).toEqual([]);
    expect(s.files.map((f) => f.id)).toEqual(['site/_1800_X.msi', 'site/other.msi']);
  });

  it('reports loaded, unparsable and unreadable counts after a load', () => {
    const bad = (n: string) => input(n, 'just some notes\n');
    useStore.getState().addFiles([input('a.MSI', msi(1800)), bad('n1.txt'), bad('n2.txt')], { unreadable: 1 });
    const s = useStore.getState();
    expect(s.loadMessage).toBe('Loaded 1 file · 2 could not be loaded · 1 could not be read');
    expect(s.loadFailed).toBe(2);
    expect(selectErrors(s.files).map((e) => e.error)).toEqual(['Not a Planet pattern file', 'Not a Planet pattern file']);
    useStore.getState().addFiles([], { unreadable: 3 });
    expect(useStore.getState().loadMessage).toBe('Could not read 3 file(s)');
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

  it('stores sub-bands in the view; Clear returns to automatic ones and its undo brings them back', () => {
    expect(useStore.getState().view.subBands).toEqual([]);
    useStore.getState().addFiles([input('a.msi', planetText())]);
    const subBands = [{ name: 'A', minMHz: 1, maxMHz: 2 }];
    useStore.getState().updateView({ subBands });
    expect(useStore.getState().view.subBands).toEqual(subBands);
    useStore.getState().clear();
    expect(useStore.getState().view.subBands).toEqual([]);
    useStore.getState().undoLast();
    expect(useStore.getState().view.subBands).toEqual(subBands);
  });

  it('going back to automatic sub-bands drops the user\'s, and can be undone', () => {
    useStore.getState().addFiles([input('a.msi', planetText())]);
    const subBands = [
      { name: 'A', minMHz: 1, maxMHz: 2 },
      { name: 'B', minMHz: 3, maxMHz: 4 },
    ];
    useStore.getState().updateView({ subBands, mode: 'rect' });
    expect(useStore.getState().undo).toBeNull();
    useStore.getState().dropSubBands();
    expect(useStore.getState().view.subBands).toEqual([]);
    expect(useStore.getState().undo).toMatchObject({ label: 'Dropped your 2 sub-bands', shown: true });
    useStore.getState().undoLast();
    expect(useStore.getState().view.subBands).toEqual(subBands);
    expect(useStore.getState().view.mode).toBe('rect');
    expect(useStore.getState().undo).toBeNull();
    // One sub-band is said in the singular.
    useStore.getState().updateView({ subBands: subBands.slice(0, 1) });
    useStore.getState().dropSubBands();
    expect(useStore.getState().undo?.label).toBe('Dropped your sub-band');
  });

  it('with automatic sub-bands already there is nothing to drop: no undo is offered, and one on offer stays', () => {
    useStore.getState().addFiles([input('a.msi', planetText())]);
    useStore.getState().dropSubBands();
    expect(useStore.getState().undo).toBeNull();
    useStore.getState().resetSimulation();
    useStore.getState().updateSimulation({ mechanicalDeg: 2 });
    useStore.getState().resetSimulation();
    const offered = useStore.getState().undo;
    expect(offered).not.toBeNull();
    useStore.getState().dropSubBands();
    expect(useStore.getState().undo).toBe(offered);
  });

  it('a later change of the sub-bands withdraws the undo of dropping them', () => {
    useStore.getState().addFiles([input('a.msi', planetText())]);
    useStore.getState().updateView({ subBands: [{ name: 'A', minMHz: 1, maxMHz: 2 }] });
    useStore.getState().dropSubBands();
    useStore.getState().updateView({ subBands: [{ name: 'C', minMHz: 5, maxMHz: 6 }] });
    expect(useStore.getState().undo).toBeNull();
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
      hCut: 'beam',
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
      hCut: 'beam',
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

  it('keeps copies on their source when a changed file of the same name is opened, and scopes custom-group members', () => {
    st().addFiles([input('a.MSI', msi(1800))]);
    const c = st().duplicate('a.MSI')!;
    const g = st().createGroup('S');
    st().setMembership(c, g);
    st().addFiles([input('a.MSI', msi(1850))]); // a second, numbered entry: the first and its copy are untouched
    st().removeFile('a (2).MSI');
    const s = st();
    const t = selectInstances(s.files, s.tagOverrides, s.copies, s.names, s.membership);
    expect(t.map((i) => i.pattern.frequencyMHz)).toEqual([1800, 1800]);
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

describe('setVisibleOnly (Show all / none / only matches)', () => {
  const st = useStore.getState;
  beforeEach(() => useStore.setState(initialState()));
  const load = () => st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900)), input('c.MSI', msi(2100))]);

  it('ticks exactly the given files, offers an undo and is undone in one step', () => {
    load();
    st().setVisible(['b.MSI'], true);
    st().setVisibleOnly(['a.MSI', 'c.MSI'], 'Showed only the 2 matching files');
    expect(st().visible).toEqual({ 'a.MSI': true, 'b.MSI': false, 'c.MSI': true });
    expect(st().undo?.label).toBe('Showed only the 2 matching files');
    st().undoLast();
    expect(st().visible['a.MSI']).toBe(true);
    expect(st().visible['b.MSI']).toBe(true);
    expect(st().visible['c.MSI']).toBeFalsy();
  });

  it('does nothing, and offers no undo, when the ticks already are exactly these', () => {
    load();
    const ticked = Object.keys(st().visible).filter((k) => st().visible[k]);
    st().setVisibleOnly(ticked, 'x');
    expect(st().undo).toBeNull();
    st().setVisibleOnly([], 'Hid all files');
    expect(st().undo?.label).toBe('Hid all files');
  });

  it('counts as a change of the project (visibility is saved) and is not unsaved once put back', () => {
    load();
    st().markSaved();
    expect(isDirty(st())).toBe(false);
    st().setVisibleOnly([], 'Hid all files');
    expect(isDirty(st())).toBe(true);
    st().undoLast();
    expect(isDirty(st())).toBe(false);
  });
});

describe('undo of destructive actions', () => {
  const st = useStore.getState;
  const data = () => {
    const { files, tagOverrides, visible, highlighted, settings, view, copies, names, customGroups, membership, selected, pendingFiles } = st();
    return { files, tagOverrides, visible, highlighted, settings, view, copies, names, customGroups, membership, selected, pendingFiles };
  };
  const session = () => {
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    const c = st().duplicate('a.MSI')!;
    const g = st().createGroup('Mine');
    st().setMembership(c, g);
    st().rename('b.MSI', 'Beta');
    st().setOffset('a.MSI', { electricalDeg: 2 });
    st().setGroupOffset(g, { azimuthDeg: 10 });
    st().setTags('b.MSI', { band: '1900' } as never);
    st().toggleVisible('b.MSI');
    st().select({ kind: 'group', id: g });
    return { c, g };
  };

  it('restores everything exactly after Clear, sharing the parsed objects (no deep copy)', () => {
    session();
    const before = data();
    const parsed = st().files[0].result;
    st().clear();
    expect(st().files).toEqual([]);
    expect(st().undo?.label).toBe('Cleared 2 files');
    st().undoLast();
    expect(data()).toEqual(before);
    expect(st().files[0].result).toBe(parsed);
    expect(st().undo).toBeNull();
  });

  it('restores a removed file with its copies, names, groups, offsets and visibility', () => {
    session();
    const before = data();
    st().removeFile('a.MSI');
    expect(st().files.map((f) => f.id)).toEqual(['b.MSI']);
    expect(st().undo?.label).toBe('Removed a.MSI and its copies');
    st().undoLast();
    expect(data()).toEqual(before);
  });

  it('restores a deleted group and its offsets and members', () => {
    const { g } = session();
    const before = data();
    st().deleteGroup(g);
    expect(st().customGroups).toEqual([]);
    expect(st().undo?.label).toBe('Deleted group Mine');
    st().undoLast();
    expect(data()).toEqual(before);
  });

  it('restores the previous session after a project replaced it', () => {
    session();
    const before = data();
    st().loadProject({
      format: 'lobe-story-project',
      version: 1,
      savedAt: '2026-01-01T00:00:00Z',
      files: [{ path: 'p.MSI', text: msi(2100) }],
      state: {},
    } as never);
    expect(st().files.map((f) => f.id)).toEqual(['p.MSI']);
    expect(st().undo?.label).toBe('Replaced the session with the project');
    st().undoLast();
    expect(data()).toEqual(before);
  });

  it('offers no undo when nothing was loaded, or when the action changed nothing', () => {
    st().clear();
    expect(st().undo).toBeNull();
    st().removeFile('nope');
    st().deleteGroup('nope');
    expect(st().undo).toBeNull();
    st().undoLast();
    expect(st().files).toEqual([]);
  });

  it('is a single level: a second destructive action replaces the first, and loading files drops it', () => {
    session();
    st().removeFile('b.MSI');
    st().clear();
    expect(st().undo?.label).toBe('Cleared 1 file');
    st().undoLast();
    expect(st().files.map((f) => f.id)).toEqual(['a.MSI']);
    st().removeFile('a.MSI');
    st().addFiles([input('z.MSI', msi(1700))]);
    expect(st().undo).toBeNull();
  });

  it('keeps the current theme and dismisses on demand', () => {
    session();
    st().clear();
    st().updateView({ theme: st().view.theme === 'dark' ? 'light' : 'dark' });
    const theme = st().view.theme;
    st().undoLast();
    expect(st().view.theme).toBe(theme);
    st().clear();
    st().updateView({ collapsed: { simBar: !st().view.collapsed.simBar, markers: st().view.collapsed.markers } });
    const folds = st().view.collapsed;
    st().undoLast();
    expect(st().files.length).toBeGreaterThan(0);
    expect(st().view.collapsed).toEqual(folds);
    st().clear();
    st().dismissUndo();
    expect(st().undo).toBeNull();
  });
});

describe('the undo outlives its toast (R2-U3)', () => {
  const st = useStore.getState;

  it('fadeUndo hides the offer but keeps the snapshot for undoLast; dismissUndo drops it', () => {
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    st().removeFile('a.MSI');
    expect(st().undo?.shown).toBe(true);
    st().fadeUndo();
    expect(st().undo?.shown).toBe(false);
    expect(st().undo?.label).toBe('Removed a.MSI');
    st().undoLast();
    expect(st().files.map((f) => f.id).sort()).toEqual(['a.MSI', 'b.MSI']);
    expect(st().undo).toBeNull();
    st().removeFile('a.MSI');
    st().dismissUndo();
    expect(st().undo).toBeNull();
  });

  it('a faded undo is still withdrawn by a later edit, and survives a highlight or a theme change', () => {
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    st().removeFile('a.MSI');
    st().fadeUndo();
    st().setHighlighted('b.MSI');
    st().updateView({ theme: st().view.theme === 'dark' ? 'light' : 'dark' });
    expect(st().undo).not.toBeNull();
    st().rename('b.MSI', 'Beta');
    expect(st().undo).toBeNull();
    const files = st().files;
    st().undoLast();
    expect(st().files).toBe(files);
  });

  it('applying a faded undo counts as a session swap and a file-set swap like any other', async () => {
    const { sessionSwapCount, fileSetSwapCount } = await import('./store');
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    st().removeFile('a.MSI');
    st().fadeUndo();
    const [swaps, sets] = [sessionSwapCount(), fileSetSwapCount()];
    st().undoLast();
    expect(sessionSwapCount()).toBe(swaps + 1);
    expect(fileSetSwapCount()).toBe(sets + 1);
  });

  it('a faded undo does not make the session count as saved or unsaved by itself', () => {
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    st().markSaved();
    st().removeFile('a.MSI');
    expect(isDirty(st())).toBe(true);
    st().fadeUndo();
    expect(isDirty(st())).toBe(true);
    st().undoLast();
    expect(isDirty(st())).toBe(false);
  });
});

describe('unsaved work', () => {
  const st = useStore.getState;

  it('is unsaved while files are loaded and nothing was saved, and never when empty', () => {
    expect(isDirty(st())).toBe(false);
    st().addFiles([input('a.MSI', msi(1800))]);
    expect(isDirty(st())).toBe(true);
  });

  it('is clean after a save, dirty again after an edit, clean again after undoing back to the saved state', () => {
    st().addFiles([input('a.MSI', msi(1800))]);
    st().markSaved();
    expect(isDirty(st())).toBe(false);
    st().rename('a.MSI', 'Alpha');
    expect(isDirty(st())).toBe(true);
    st().markSaved();
    expect(isDirty(st())).toBe(false);
    st().clear();
    expect(isDirty(st())).toBe(false);
    st().undoLast();
    expect(isDirty(st())).toBe(false);
  });

  it('treats an opened project as saved', () => {
    st().loadProject({
      format: 'lobe-story-project',
      version: 1,
      savedAt: '2026-01-01T00:00:00Z',
      files: [{ path: 'p.MSI', text: msi(2100) }],
      state: { names: { 'p.MSI': 'P' } },
    } as never);
    expect(st().files).toHaveLength(1);
    expect(isDirty(st())).toBe(false);
    st().setOffset('p.MSI', { azimuthDeg: 5 });
    expect(isDirty(st())).toBe(true);
  });

  it('asks before Clear only when there is more than one plain file or any edit', () => {
    st().addFiles([input('a.MSI', msi(1800))]);
    expect(clearNeedsConfirm(st())).toBe(false);
    st().rename('a.MSI', 'A');
    expect(clearNeedsConfirm(st())).toBe(true);
    st().clear();
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    expect(clearNeedsConfirm(st())).toBe(true);
  });
});

describe('Clear ends the session: the simulation and the cut choice go with the files', () => {
  const st = useStore.getState;
  const UNDO = 'You can undo this.';

  it('resets the global sliders and the horizontal cut, keeps the 3D method, and its undo brings all of it back', () => {
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    st().updateView({ method3d: 'weighted' });
    st().updateSimulation({ electricalDeg: 2, mechanicalDeg: 5, azimuthDeg: 20, hCut: 'horizon', showOriginal: false });
    st().setOffset('a.MSI', { mechanicalDeg: 1 });
    const before = st().view.simulation;
    st().clear();
    expect(st().view.simulation).toEqual({ electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0, hCut: 'beam', showOriginal: false, offsets: {}, groupOffsets: {} });
    // The 3D method is a browser preference: it is not part of what a Clear resets.
    expect(st().view.method3d).toBe('weighted');
    st().undoLast();
    expect(st().view.simulation).toEqual(before);
    // Cleared again, the next files start unsimulated.
    st().clear();
    st().addFiles([input('c.MSI', msi(2100))]);
    expect(st().view.simulation).toMatchObject({ electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 0, hCut: 'beam', offsets: {} });
  });

  it('the question names what goes besides the files, and only what is set', () => {
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    expect(clearQuestion(st(), UNDO)).toBe('Clear 2 files and all groups, names and offsets? You can undo this.');
    st().updateSimulation({ mechanicalDeg: 5 });
    expect(clearQuestion(st(), UNDO)).toBe('Clear 2 files and all groups, names and offsets? The simulation sliders are reset too. You can undo this.');
    st().updateSimulation({ hCut: 'horizon' });
    expect(clearQuestion(st(), UNDO)).toBe(
      'Clear 2 files and all groups, names and offsets? The simulation sliders and the horizontal cut (back to the one through the beam peak) are reset too. You can undo this.',
    );
    st().updateSimulation({ mechanicalDeg: 0 });
    st().updateView({ subBands: [{ name: 'A', minMHz: 1, maxMHz: 2 }] });
    expect(clearQuestion(st(), UNDO)).toBe(
      'Clear 2 files and all groups, names and offsets? The horizontal cut (back to the one through the beam peak) and your sub-bands (back to automatic) are reset too. You can undo this.',
    );
    st().updateView({ subBands: [] });
    expect(clearQuestion(st(), UNDO)).toContain('The horizontal cut (back to the one through the beam peak) is reset too.');
    st().updateSimulation({ azimuthDeg: 20, hCut: 'beam' });
    st().updateView({ subBands: [] });
    expect(clearQuestion(st(), UNDO)).toContain('The simulation sliders are reset too.');
  });

  it('the question for a session with no loaded file, and for one file', () => {
    st().addFiles([input('a.MSI', msi(1800))]);
    expect(clearQuestion(st(), UNDO)).toBe('Clear 1 file and all groups, names and offsets? You can undo this.');
    useStore.setState({ files: [] });
    expect(clearQuestion(st(), UNDO)).toBe('Clear the session with all its groups, names and offsets? You can undo this.');
  });

  it('asks before clearing a single file that has user sub-bands (typed work, like a name)', () => {
    st().addFiles([input('a.MSI', msi(1800))]);
    expect(clearNeedsConfirm(st())).toBe(false);
    st().updateView({ subBands: [{ name: 'A', minMHz: 1, maxMHz: 2 }] });
    expect(clearNeedsConfirm(st())).toBe(true);
  });
});

describe('simulation reset scope', () => {
  it('"sliders" keeps per-file offsets, "all" clears them', () => {
    const st = useStore.getState;
    st().addFiles([input('a.MSI', msi(1800))]);
    st().updateSimulation({ electricalDeg: 3 });
    st().setOffset('a.MSI', { azimuthDeg: 20 });
    st().resetSimulation('sliders');
    expect(st().view.simulation.electricalDeg).toBe(0);
    expect(st().view.simulation.offsets).toEqual({ 'a.MSI': { electricalDeg: 0, mechanicalDeg: 0, azimuthDeg: 20 } });
    st().resetSimulation('all');
    expect(st().view.simulation.offsets).toEqual({});
  });
});

describe('identical content is recognised by base name, whatever the numbering or folder (B5)', () => {
  const st = useStore.getState;
  const ids = () => st().files.map((f) => f.id);

  it('sees the content behind a gap in the numbering', () => {
    st().addFiles([input('a.msi', msi(1800)), input('a.msi', msi(1850)), input('a.msi', msi(1900))]);
    st().removeFile('a (2).msi');
    expect(ids()).toEqual(['a.msi', 'a (3).msi']);
    st().addFiles([input('a.msi', msi(1900))]);
    expect(ids()).toEqual(['a.msi', 'a (3).msi']);
    expect(st().loadMessage).toBe('No new files loaded: 1 already loaded (skipped)');
    // A genuinely different file takes the smallest free number.
    st().addFiles([input('a.msi', msi(1950))]);
    expect(ids()).toEqual(['a.msi', 'a (3).msi', 'a (2).msi']);
  });

  it('sees the content of a numbered entry whose un-numbered sibling was removed', () => {
    st().addFiles([input('a.msi', msi(1800)), input('a.msi', msi(1850))]);
    st().removeFile('a.msi');
    expect(ids()).toEqual(['a (2).msi']);
    st().addFiles([input('a.msi', msi(1850))]);
    expect(ids()).toEqual(['a (2).msi']);
    expect(st().loadMessage).toBe('No new files loaded: 1 already loaded (skipped)');
  });

  it('sees a file loaded under a folder path when it is picked again by its bare name', () => {
    st().addFiles([input('site/x.msi', msi(1800))]);
    st().addFiles([input('x.msi', msi(1800))]);
    expect(ids()).toEqual(['site/x.msi']);
    // ... also when a pending match put it under the folder path.
    useStore.setState({ ...initialState(), pendingFiles: [{ path: 'site/y.msi' }] });
    st().addFiles([input('y.msi', msi(1900))]);
    st().addFiles([input('y.msi', msi(1900))]);
    expect(ids()).toEqual(['site/y.msi']);
    expect(st().loadMessage).toBe('No new files loaded: 1 already loaded (skipped)');
  });

  it('treats line endings as the same content', () => {
    st().addFiles([input('a.msi', msi(1800))]);
    const unix = msi(1800).replace(/\r\n/g, '\n');
    expect(unix).not.toBe(msi(1800));
    st().addFiles([input('a.msi', unix)]);
    expect(ids()).toEqual(['a.msi']);
  });
});

describe('a same-name file that fails to parse (B6)', () => {
  const st = useStore.getState;
  const bad = 'NAME X\nFREQUENCY 900\n';

  it('is listed once under Errors, not numbered and not counted as renamed', () => {
    st().addFiles([input('a.msi', msi(1800))]);
    st().addFiles([input('a.msi', bad)]);
    expect(st().files.map((f) => f.path)).toEqual(['a.msi', 'a.msi']);
    expect(st().files[0].result.ok).toBe(true);
    expect(selectErrors(st().files).map((e) => e.path)).toEqual(['a.msi']);
    expect(st().loadMessage).toBe('No new files loaded: 1 could not be loaded');
    expect(st().loadFailed).toBe(1);
    // Again: it replaces the earlier failed entry instead of piling up.
    st().addFiles([input('a.msi', bad + 'GAIN 1\n')]);
    expect(selectErrors(st().files)).toHaveLength(1);
    expect(st().files).toHaveLength(2);
    expect(st().files[1].text).toBe(bad + 'GAIN 1\n');
    // The Errors entry can be removed on its own.
    st().removeFile(selectErrors(st().files)[0].id);
    expect(st().files.map((f) => f.id)).toEqual(['a.msi']);
  });

  it('replaces an earlier failed entry of the same name', () => {
    st().addFiles([input('a.msi', bad)]);
    st().addFiles([input('a.msi', bad + 'GAIN 1\n')]);
    expect(st().files).toHaveLength(1);
    expect(st().files[0].text).toBe(bad + 'GAIN 1\n');
    expect(st().loadMessage).toBe('No new files loaded: 1 could not be loaded');
  });
});

describe('an offered undo is withdrawn by any later change to the session (B2)', () => {
  const st = useStore.getState;
  const load3 = () => st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900)), input('c.MSI', msi(2000))]);

  it('Remove, then rename another file: the undo is gone and undoLast does nothing', () => {
    load3();
    st().removeFile('a.MSI');
    expect(st().undo).not.toBeNull();
    st().rename('b.MSI', 'Beta');
    expect(st().undo).toBeNull();
    st().undoLast();
    expect(st().files.map((f) => f.id)).toEqual(['b.MSI', 'c.MSI']);
    expect(st().names).toEqual({ 'b.MSI': 'Beta' });
  });

  it('Remove, then only highlight or select another file: the undo still restores', () => {
    load3();
    st().removeFile('a.MSI');
    st().setHighlighted('c.MSI');
    st().select({ kind: 'file', id: 'b.MSI' });
    st().updateView({ theme: st().view.theme === 'dark' ? 'light' : 'dark' });
    st().updateView({ collapsed: { simBar: !st().view.collapsed.simBar, markers: st().view.collapsed.markers } });
    st().setLoadMessage('x');
    expect(st().undo).not.toBeNull();
    st().undoLast();
    expect(st().files.map((f) => f.id)).toEqual(['a.MSI', 'b.MSI', 'c.MSI']);
  });

  it.each<[string, () => void]>([
    ['duplicate', () => void st().duplicate('b.MSI')],
    ['tag edit', () => st().setTags('b.MSI', { tiltDeg: 2 })],
    ['create group', () => void st().createGroup('G')],
    ['create site', () => void st().createSite('b.MSI', 3)],
    ['offset', () => st().setOffset('b.MSI', { azimuthDeg: 10 })],
    ['settings', () => st().updateSettings({ fbWindowDeg: 25 })],
    ['view', () => st().updateView({ mode: 'rect' })],
    ['simulation', () => st().updateSimulation({ electricalDeg: 2 })],
    ['visibility', () => st().toggleVisible('b.MSI')],
    ['group visibility', () => st().setVisible(['b.MSI', 'c.MSI'], true)],
    ['adding files', () => st().addFiles([input('z.MSI', msi(1700))])],
  ])('%s withdraws it', (_name, act) => {
    load3();
    st().updateSimulation({ azimuthDeg: 30 }); // something for Reset to reset
    st().removeFile('a.MSI');
    act();
    expect(st().undo).toBeNull();
  });

  it('reset simulation withdraws it: the offer is now the reset\'s own, and undoing brings back the sliders, not the removed file', () => {
    load3();
    st().updateSimulation({ azimuthDeg: 30 }); // something for Reset to reset
    st().removeFile('a.MSI');
    st().resetSimulation();
    expect(st().undo?.label).toBe('Reset the simulation');
    st().undoLast();
    expect(st().view.simulation.azimuthDeg).toBe(30);
    expect(st().files.map((f) => f.id)).toEqual(['b.MSI', 'c.MSI']);
    expect(st().undo).toBeNull();
  });

  it('group actions, membership and dismissing the pending banner withdraw it', () => {
    load3();
    const g = st().createGroup('G');
    const h = st().createGroup('H');
    st().deleteGroup(h);
    expect(st().undo).not.toBeNull();
    st().setMembership('b.MSI', g);
    expect(st().undo).toBeNull();
    st().deleteGroup(g);
    st().renameGroup(st().createGroup('I'), 'J');
    expect(st().undo).toBeNull();
    useStore.setState({ pendingFiles: [{ path: 'p.msi' }] });
    st().removeFile('a.MSI');
    st().dismissPending();
    expect(st().undo).toBeNull();
  });

  it('a no-op action leaves it in place', () => {
    load3();
    st().rename('b.MSI', 'Beta');
    st().removeFile('a.MSI');
    st().rename('b.MSI', 'Beta');
    st().updateView({ mode: st().view.mode });
    st().updateSettings({ fbWindowDeg: st().settings.fbWindowDeg });
    st().rename('missing', 'X');
    expect(st().undo).not.toBeNull();
  });
});

describe('unsaved work covers everything a project file stores (B4)', () => {
  const st = useStore.getState;
  const saved = () => {
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    st().markSaved();
    expect(isDirty(st())).toBe(false);
  };

  it('a freshly loaded session is unsaved; a session of only unparsable files is not', () => {
    st().addFiles([input('bad.pln', 'NAME X\nFREQUENCY 900\n')]);
    expect(isDirty(st())).toBe(false);
    st().addFiles([input('a.MSI', msi(1800))]);
    expect(isDirty(st())).toBe(true);
  });

  it.each<[string, () => void]>([
    ['a tag override', () => st().setTags('a.MSI', { tiltDeg: 2 })],
    ['visibility', () => st().toggleVisible('b.MSI')],
    ['a copy', () => void st().duplicate('a.MSI')],
    ['a name', () => st().rename('a.MSI', 'Alpha')],
    ['a custom group', () => void st().createGroup('G')],
    ['a setting', () => st().updateSettings({ fbWindowDeg: 25 })],
    ['the plot mode', () => st().updateView({ mode: 'rect' })],
    ['the gain unit', () => st().updateView({ gainUnit: 'dBi' })],
    ['sub-bands', () => st().updateView({ subBands: [{ name: 'A', minMHz: 1, maxMHz: 2 }] })],
    ['table column groups', () => st().updateView({ tableGroups: { ...st().view.tableGroups, declared: true } })],
    ['markers', () => st().updateView({ markers: { ...st().view.markers, fb: true } })],
    ['a simulation slider', () => st().updateSimulation({ electricalDeg: 2 })],
    ['"show original"', () => st().updateSimulation({ showOriginal: false })],
    ['the horizontal cut of the simulation', () => st().updateSimulation({ hCut: 'horizon' })],
    ['a file offset', () => st().setOffset('a.MSI', { azimuthDeg: 10 })],
    ['another file', () => st().addFiles([input('c.MSI', msi(2000))])],
    ['a removed file', () => st().removeFile('b.MSI')],
  ])('%s makes a saved session unsaved', (_name, act) => {
    saved();
    act();
    expect(isDirty(st())).toBe(true);
    st().markSaved();
    expect(isDirty(st())).toBe(false);
  });

  it('membership and group offsets count too', () => {
    saved();
    const g = st().createGroup('G');
    st().markSaved();
    st().setMembership('a.MSI', g);
    expect(isDirty(st())).toBe(true);
    st().markSaved();
    st().setGroupOffset(g, { azimuthDeg: 5 });
    expect(isDirty(st())).toBe(true);
  });

  it('the theme, the highlight and the selection do not count', () => {
    saved();
    st().updateView({ theme: st().view.theme === 'dark' ? 'light' : 'dark' });
    st().setHighlighted('b.MSI');
    st().select({ kind: 'file', id: 'a.MSI' });
    st().select(null);
    expect(isDirty(st())).toBe(false);
  });

  it('folding or unfolding the bars does not count', () => {
    saved();
    const c = st().view.collapsed;
    st().updateView({ collapsed: { simBar: !c.simBar, markers: !c.markers } });
    expect(isDirty(st())).toBe(false);
  });

  it('a change that is put back is not unsaved work', () => {
    saved();
    st().toggleVisible('b.MSI');
    st().toggleVisible('b.MSI');
    st().rename('a.MSI', 'Alpha');
    st().rename('a.MSI', '');
    st().updateView({ mode: 'rect' });
    st().updateView({ mode: 'polar' });
    expect(isDirty(st())).toBe(false);
  });

  it('no-op actions return the same state', () => {
    saved();
    const g = st().createGroup('G');
    st().setMembership('a.MSI', g);
    st().rename('a.MSI', 'Alpha');
    const before = st();
    st().rename('a.MSI', ' Alpha ');
    st().rename('b.MSI', '  ');
    st().setMembership('a.MSI', g);
    st().setMembership('b.MSI', null);
    st().updateView({ mode: before.view.mode, floorDb: before.view.floorDb });
    st().updateView({});
    st().updateSettings({ fbWindowDeg: before.settings.fbWindowDeg });
    expect(st()).toBe(before);
  });

  it('a field that commits its unchanged value is a no-op too', () => {
    saved();
    const g = st().createGroup('G');
    st().setTags('a.MSI', { tiltDeg: 2 });
    st().setOffset('a.MSI', { azimuthDeg: 10 });
    st().setGroupOffset(g, { azimuthDeg: 5 });
    st().updateSimulation({ mechanicalDeg: 2 });
    st().setVisible(['a.MSI', 'b.MSI'], true);
    const before = st();
    st().setTags('a.MSI', { tiltDeg: 2 });
    st().setOffset('a.MSI', { azimuthDeg: 10 });
    st().setOffset('b.MSI', { azimuthDeg: 0 });
    st().clearOffsets('b.MSI');
    st().setGroupOffset(g, { azimuthDeg: 5 });
    st().updateSimulation({ mechanicalDeg: 2, showOriginal: before.view.simulation.showOriginal });
    st().updateSimulation({ mechanicalDeg: 2.1 }); // rounds to the value it has
    st().setVisible(['a.MSI', 'b.MSI'], true);
    st().dismissPending();
    expect(st()).toBe(before);
    st().resetSimulation('sliders');
    const reset = st();
    expect(reset).not.toBe(before);
    st().resetSimulation('sliders');
    expect(st()).toBe(reset);
    st().resetSimulation('all');
    st().clearGroupOffsets(g);
    const cleared = st();
    st().resetSimulation('all');
    expect(st()).toBe(cleared);
  });

  it('attaching the files a layout-only project asked for leaves it saved', () => {
    saved();
    st().rename('a.MSI', 'Alpha');
    const parsed = parseProject(serializeProject(st(), false));
    if (!parsed.ok) throw new Error(parsed.error);
    st().clear();
    st().loadProject(parsed.project);
    expect(isDirty(st())).toBe(false);
    st().addFiles([input('a.MSI', msi(1800))]);
    expect(st().pendingFiles.map((p) => p.path)).toEqual(['b.MSI']);
    expect(isDirty(st())).toBe(false);
    st().addFiles([input('b.MSI', msi(1900))]);
    expect(isDirty(st())).toBe(false);
    st().addFiles([input('extra.MSI', msi(2000))]);
    expect(isDirty(st())).toBe(true);
  });
});

describe('changesSession', () => {
  const base = () => useStore.getState();

  it('sees a replaced session slice, and a view change other than the theme', () => {
    const s = base();
    expect(changesSession(s, {})).toBe(false);
    expect(changesSession(s, { names: s.names, view: s.view })).toBe(false);
    expect(changesSession(s, { highlighted: 'x', selected: null, loadMessage: 'm', dialog: null, saved: null })).toBe(false);
    expect(changesSession(s, { view: { ...s.view, theme: s.view.theme === 'dark' ? 'light' : 'dark' } })).toBe(false);
    expect(changesSession(s, { view: { ...s.view, collapsed: { simBar: !s.view.collapsed.simBar, markers: s.view.collapsed.markers } } })).toBe(false);
    expect(changesSession(s, { view: { ...s.view, freqMetric: 'fb180' } })).toBe(false);
    expect(changesSession(s, { view: { ...s.view, tableTickedOnly: true } })).toBe(false);
    for (const k of ['files', 'pendingFiles', 'customGroups'] as const) expect(changesSession(s, { [k]: [] })).toBe(true);
    for (const k of ['tagOverrides', 'visible', 'copies', 'names', 'membership'] as const) expect(changesSession(s, { [k]: {} })).toBe(true);
    expect(changesSession(s, { settings: { ...s.settings } })).toBe(true);
    expect(changesSession(s, { view: { ...s.view, mode: 'rect' } })).toBe(true);
    expect(changesSession(s, { view: { ...s.view, simulation: { ...s.view.simulation } } })).toBe(true);
  });
});

describe('the frequency-chart metric', () => {
  it('is a display preference: not saved in a project, not unsaved work, kept across undo', () => {
    useStore.getState().addFiles([input('a.MSI', msi(1800))]);
    useStore.getState().markSaved();
    useStore.getState().updateView({ freqMetric: 'fb180' });
    expect(isDirty(useStore.getState())).toBe(false);
    expect(JSON.parse(serializeProject(useStore.getState(), false)).state.view).not.toHaveProperty('freqMetric');
    useStore.getState().removeFile('a.MSI');
    expect(useStore.getState().undo).not.toBeNull();
    useStore.getState().updateView({ freqMetric: 'spr' });
    // Changing the preference does not withdraw the offer; undo restores the files and leaves the choice alone.
    expect(useStore.getState().undo).not.toBeNull();
    useStore.getState().undoLast();
    expect(useStore.getState().files).toHaveLength(1);
    expect(useStore.getState().view.freqMetric).toBe('spr');
  });

  it('is kept when a project is opened, and a metric inside a project file is ignored', () => {
    useStore.getState().addFiles([input('a.MSI', msi(1800))]);
    const written = JSON.parse(serializeProject(useStore.getState(), false));
    written.state.view.freqMetric = 'air';
    const parsed = parseProject(JSON.stringify(written));
    if (!parsed.ok) throw new Error(parsed.error);
    useStore.getState().updateView({ freqMetric: 'fb180' });
    useStore.getState().loadProject(parsed.project);
    expect(useStore.getState().view.freqMetric).toBe('fb180');
  });
});

describe('the ticked-files-only table', () => {
  it('is a display preference: not saved in a project, not unsaved work, kept across undo and across opening a project', () => {
    useStore.getState().addFiles([input('a.MSI', msi(1800))]);
    useStore.getState().markSaved();
    useStore.getState().updateView({ tableTickedOnly: true });
    expect(isDirty(useStore.getState())).toBe(false);
    expect(JSON.parse(serializeProject(useStore.getState(), false)).state.view).not.toHaveProperty('tableTickedOnly');
    useStore.getState().removeFile('a.MSI');
    useStore.getState().updateView({ tableTickedOnly: false });
    expect(useStore.getState().undo).not.toBeNull();
    useStore.getState().undoLast();
    expect(useStore.getState().files).toHaveLength(1);
    expect(useStore.getState().view.tableTickedOnly).toBe(false);

    const written = JSON.parse(serializeProject(useStore.getState(), false));
    written.state.view.tableTickedOnly = true;
    const parsed = parseProject(JSON.stringify(written));
    if (!parsed.ok) throw new Error(parsed.error);
    useStore.getState().loadProject(parsed.project);
    expect(useStore.getState().view.tableTickedOnly).toBe(false);
  });
});

describe('the saved mark', () => {
  it('writes keys in sorted order and drops undefined', () => {
    expect(stableStringify({ b: 1, a: [{ d: null, c: 'x' }], z: undefined })).toBe('{"a":[{"c":"x","d":null}],"b":1}');
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify([undefined, 1])).toBe('[null,1]');
  });

  it('covers exactly the state parts a project file stores, without highlight, selection and theme', () => {
    useStore.getState().addFiles([input('a.MSI', msi(1800))]);
    const s = useStore.getState();
    const written = JSON.parse(serializeProject(s, false));
    const marked = JSON.parse(markOf(s).state);
    expect(Object.keys(marked).sort()).toEqual(Object.keys(written.state).filter((k) => k !== 'highlighted' && k !== 'selected').sort());
    expect(Object.keys(marked.view).sort()).toEqual(Object.keys(written.state.view).sort());
    expect(marked.view.theme).toBeUndefined();
    expect(marked.view.collapsed).toBeUndefined();
    expect(Object.keys(markOf(s).files)).toEqual(written.files.map((f: { path: string }) => f.path));
  });

  it('does not save a failed file that shares its path with a loaded one', () => {
    const st = useStore.getState;
    st().addFiles([input('a.MSI', msi(1800))]);
    st().addFiles([input('a.MSI', 'NAME X\nFREQUENCY 900\n')]);
    expect(st().files).toHaveLength(2);
    const written = JSON.parse(serializeProject(st(), true));
    expect(written.files.map((f: { path: string }) => f.path)).toEqual(['a.MSI']);
    expect(written.files[0].text).toBe(msi(1800));
  });
});

describe('status line', () => {
  const st = useStore.getState;

  it('is neutral for a clean load and a warning otherwise', () => {
    st().addFiles([input('a.MSI', msi(1800))]);
    expect([st().loadMessage, st().loadTone]).toEqual(['Loaded 1 file', 'info']);
    st().addFiles([input('a.MSI', msi(1800))]);
    expect(st().loadTone).toBe('warn');
    st().addFiles([input('b.MSI', msi(1900))]);
    expect(st().loadTone).toBe('info');
    st().addFiles([input('c.MSI', msi(2000))], { unreadable: 1 });
    expect(st().loadTone).toBe('warn');
    st().addFiles([input('d.MSI', msi(2100))]);
    st().setLoadMessage('Could not read the selected files');
    expect(st().loadTone).toBe('warn');
  });

  it('appends a note about the selection, also when no pattern file came with it', () => {
    const note = '2 project files found — open one with Open project';
    st().addFiles([input('a.MSI', msi(1800))], { note });
    expect([st().loadMessage, st().loadTone]).toEqual([`Loaded 1 file · ${note}`, 'warn']);
    st().addFiles([], { note });
    expect(st().loadMessage).toBe(note);
    st().addFiles([], { note, unreadable: 1 });
    expect(st().loadMessage).toBe(`Could not read 1 file(s) · ${note}`);
  });

  it('is cleared when a file it may be about is removed, but not for a copy', () => {
    st().addFiles([input('a.MSI', msi(1800)), input('bad.pln', 'NAME X\n')]);
    expect(st().loadFailed).toBe(1);
    const c = st().duplicate('a.MSI')!;
    st().removeFile(c);
    expect(st().loadMessage).toBe('Loaded 1 file · 1 could not be loaded');
    st().removeFile('bad.pln');
    expect([st().loadMessage, st().loadFailed]).toEqual([null, 0]);
  });

  it('never says "Cleared 0 files"', () => {
    useStore.setState({ pendingFiles: [{ path: 'p.msi' }] });
    st().clear();
    expect(st().undo?.label).toBe('Cleared the session');
  });
});

describe('actions that change nothing', () => {
  const st = useStore.getState;
  const loadTwo = () => {
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    st().removeFile('b.MSI'); // leaves an undo on offer
    expect(st().undo).not.toBeNull();
  };

  it('renaming a group to the name it has returns the same state and keeps the undo', () => {
    const g = st().createGroup('North');
    loadTwo();
    const before = st();
    st().renameGroup(g, 'North');
    st().renameGroup(g, '  North  ');
    expect(st()).toBe(before);
    expect(st().undo).not.toBeNull();
    st().renameGroup(g, 'South');
    expect(st().customGroups[0].name).toBe('South');
    expect(st().undo).toBeNull();
  });

  it('setTags with tags the override already has, or {} without an override, is a no-op', () => {
    st().addFiles([input('a.MSI', msi(1800))]);
    st().markSaved();
    const clean = st();
    st().setTags('a.MSI', {});
    expect(st()).toBe(clean);
    expect(st().tagOverrides).toEqual({});
    expect(isDirty(st())).toBe(false);

    st().setTags('a.MSI', { tiltDeg: 4 });
    expect(st().tagOverrides['a.MSI']).toEqual({ tiltDeg: 4 });
    st().markSaved();
    st().addFiles([input('b.MSI', msi(1900))]);
    st().removeFile('b.MSI');
    const before = st();
    st().setTags('a.MSI', { tiltDeg: 4 });
    st().setTags('a.MSI', {});
    expect(st()).toBe(before);
    expect(st().undo).not.toBeNull();
  });

  it('setTags with an explicit undefined still overrides (clears) an inferred tag', () => {
    loadTwo();
    st().setTags('a.MSI', { polarization: undefined });
    expect('polarization' in st().tagOverrides['a.MSI']).toBe(true);
    expect(st().undo).toBeNull();
  });
});

describe('file selection from the panel and the table', () => {
  const st = useStore.getState;
  const load = () => st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);

  it('ticks an unticked file and highlights it', () => {
    load();
    expect(st().visible['b.MSI']).toBeFalsy();
    st().pickFile('b.MSI');
    expect(st().visible['b.MSI']).toBe(true);
    expect(st().highlighted).toBe('b.MSI');
    expect(st().selected).toEqual({ kind: 'file', id: 'b.MSI' });
  });

  it('clears the highlight on a second click, keeping the file ticked', () => {
    load();
    st().pickFile('b.MSI');
    st().pickFile('b.MSI');
    expect(st().highlighted).toBeNull();
    expect(st().selected).toBeNull();
    expect(st().visible['b.MSI']).toBe(true);
  });

  it('ticks a highlighted file that was unticked instead of clearing it', () => {
    load();
    st().pickFile('b.MSI');
    st().toggleVisible('b.MSI');
    st().pickFile('b.MSI');
    expect(st().highlighted).toBe('b.MSI');
    expect(st().visible['b.MSI']).toBe(true);
  });

  it('clearHighlight drops the highlight and the selection, and is a no-op without them', () => {
    load();
    st().select({ kind: 'group', id: 'g1' });
    st().clearHighlight();
    expect(st().selected).toBeNull();
    expect(st().highlighted).toBeNull();
    const before = st();
    st().clearHighlight();
    expect(st()).toBe(before);
  });
});

describe('group names stay unique', () => {
  const st = useStore.getState;
  const names = () => st().customGroups.map((g) => g.name);

  it('suffixes a created group that repeats a name', () => {
    st().createGroup('North');
    st().createGroup('North');
    st().createGroup(' north ');
    expect(names()).toEqual(['North', 'North (2)', 'north (3)']);
  });

  it('suffixes a rename onto an existing name but accepts keeping its own', () => {
    const a = st().createGroup('A');
    const b = st().createGroup('B');
    st().renameGroup(b, 'A');
    expect(names()).toEqual(['A', 'A (2)']);
    st().renameGroup(a, 'A');
    expect(names()).toEqual(['A', 'A (2)']);
  });

  it('suffixes a second copy of a group', () => {
    const a = st().createGroup('A');
    st().duplicateGroup(a);
    st().duplicateGroup(a);
    expect(names()).toEqual(['A', 'A (copy)', 'A (copy) (2)']);
  });
});

describe('opening a project together with its pattern files', () => {
  const st = useStore.getState;

  const embedded = () => {
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    const parsed = parseProject(serializeProject(st(), true));
    if (!parsed.ok) throw new Error(parsed.error);
    st().clear();
    return parsed.project;
  };

  it('says the project was opened, calmly, when the files it holds are skipped', () => {
    const project = embedded();
    st().loadProject(project);
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))], { keepUndo: true, openedProject: 'site.lobestory.json' });
    expect(st().loadMessage).toBe('Opened project site.lobestory.json: 2 files');
    expect(st().loadTone).toBe('info');
    expect(st().files).toHaveLength(2);
  });

  it('still reports files that really are new, or that failed', () => {
    const project = embedded();
    st().loadProject(project);
    st().addFiles([input('a.MSI', msi(1800)), input('c.MSI', msi(2100))], { openedProject: 'p.json' });
    expect(st().loadMessage).toBe('Opened project p.json: 3 files · Loaded 1 file · 1 already loaded (skipped)');
    expect(st().loadTone).toBe('warn');
    st().addFiles([input('bad.pln', 'NAME X\n')], { openedProject: 'p.json' });
    expect(st().loadMessage).toContain('could not be loaded');
    expect(st().loadTone).toBe('warn');
  });

  it('leaves the usual message alone when no project was opened', () => {
    st().addFiles([input('a.MSI', msi(1800))]);
    st().addFiles([input('a.MSI', msi(1800))]);
    expect(st().loadMessage).toBe('No new files loaded: 1 already loaded (skipped)');
    expect(st().loadTone).toBe('warn');
  });
});

describe('the status line after a copy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState(initialState());
  });
  afterEach(() => vi.useRealTimers());

  it('counts every copy note, so an identical one is a change the status region sees and the fade restarts', () => {
    const a = useStore.getState().copySeq;
    useStore.getState().setCopyNote('Copied 65.0');
    const b = useStore.getState().copySeq;
    vi.advanceTimersByTime(COPY_NOTE_MS - 1000);
    useStore.getState().setCopyNote('Copied 65.0');
    expect(b).toBeGreaterThan(a);
    expect(useStore.getState().copySeq).toBeGreaterThan(b);
    vi.advanceTimersByTime(COPY_NOTE_MS - 1000);
    expect(useStore.getState().copyNote).toBe('Copied 65.0'); // the first timer did not clear the second note
    vi.advanceTimersByTime(1000);
    expect(useStore.getState().copyNote).toBeNull();
  });

  it('keeps a failed load warning, its tone and its "Show errors" count through a copy and its fade', () => {
    useStore.setState({ loadFailed: 2, loadMessage: '2 files could not be read', loadTone: 'warn' });
    useStore.getState().setCopyNote('Copied 65.0');
    expect(useStore.getState().copyNote).toBe('Copied 65.0');
    vi.advanceTimersByTime(COPY_NOTE_MS + 1);
    expect(useStore.getState().copyNote).toBeNull();
    expect(useStore.getState().loadMessage).toBe('2 files could not be read');
    expect(useStore.getState().loadTone).toBe('warn');
    expect(useStore.getState().loadFailed).toBe(2);
  });

  it('is not part of the undo snapshot or the unsaved-work comparison', () => {
    useStore.getState().addFiles([input('a.MSI', msi(1800))]);
    useStore.getState().markSaved();
    useStore.getState().setCopyNote('Copied 65.0');
    expect(isDirty(useStore.getState())).toBe(false);
    expect(Object.keys(takeSnapshot(useStore.getState()))).not.toContain('copyNote');
  });
});

describe('status lines after Open project (R2-U11)', () => {
  const st = useStore.getState;
  it('says how many files a project opened with, and how many are still missing', () => {
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    const full = parseProject(serializeProject(st(), true));
    const layout = parseProject(serializeProject(st(), false));
    if (!full.ok || !layout.ok) throw new Error('bad project');
    st().clear();
    st().loadProject(full.project, 's.lobestory.json');
    expect(st().loadMessage).toBe('Opened project s.lobestory.json: 2 files');
    expect(st().loadTone).toBe('info');
    st().clear();
    st().loadProject(layout.project, 's.lobestory.json');
    expect(st().loadMessage).toBe('Opened project s.lobestory.json: 0 files, 2 still missing');
    st().loadProject(layout.project);
    expect(st().loadMessage).toBeNull();
  });
});

describe('the Save project status line', () => {
  it('names the file, the count and whether the pattern data is in it', () => {
    expect(savedMessage('lobe-story-2026-01-01.lobestory.json', 24, true)).toBe('Saved lobe-story-2026-01-01.lobestory.json (24 files, with pattern data)');
    expect(savedMessage('x.lobestory.json', 1, false)).toBe('Saved x.lobestory.json (1 file, layout only)');
    expect(savedMessage('x.lobestory.json', 3, true, 2)).toBe('Saved x.lobestory.json (3 files, with pattern data, 2 still missing)');
    expect(openedMessage('x.json', 1, 0)).toBe('Opened project x.json: 1 file');
  });

  it('counts the files it writes apart from the ones still missing', () => {
    const st = useStore.getState;
    st().clear();
    st().addFiles([input('a.MSI', msi(1800)), input('b.MSI', msi(1900))]);
    const layout = parseProject(serializeProject(st(), false));
    if (!layout.ok) throw new Error('bad project');
    st().clear();
    st().loadProject(layout.project);
    expect(savedCounts(st())).toEqual({ written: 0, missing: 2 });
    st().addFiles([input('c.MSI', msi(2100))]);
    expect(savedCounts(st())).toEqual({ written: 1, missing: 2 });
  });
});
