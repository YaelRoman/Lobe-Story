import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/analysis/metrics';
import { applyPrefs, PREFS_KEY, PREFS_VERSION, prefsOf, resetPrefs, serializePrefs, startPrefs, writePrefs, type StorageLike } from './prefs';
import { initialState, useStore } from './store';
import { isDirty } from './undo';
import { planetText } from '../test/planetText';

class FakeStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const throwing = (): StorageLike => ({
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('denied');
  },
});

const defaults = () => initialState();

beforeEach(() => {
  useStore.setState(initialState());
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const changed = () => {
  const d = defaults();
  return {
    settings: { ...DEFAULT_SETTINGS, levelDb: 6, siteSectors: 4 },
    view: {
      ...d.view,
      theme: (d.view.theme === 'dark' ? 'light' : 'dark') as 'light' | 'dark',
      gainUnit: 'dBi' as const,
      mode: 'rect' as const,
      cut: 'H' as const,
      floorDb: 55,
      markers: { ...d.view.markers, usls: true, hpbw: false },
      tableGroups: { ...d.view.tableGroups, declared: true },
      method3d: 'weighted' as const,
      layout3d: 'overlay' as const,
      compare3d: true,
      freqMetric: 'fb180' as const,
      tableTickedOnly: true,
    },
  };
};

describe('applyPrefs', () => {
  it('round-trips the preferences', () => {
    const c = changed();
    const out = applyPrefs(serializePrefs(c), defaults())!;
    expect(out.settings).toEqual(c.settings);
    expect(out.view).toMatchObject({
      theme: c.view.theme, gainUnit: 'dBi', mode: 'rect', cut: 'H', floorDb: 55, freqMetric: 'fb180', tableTickedOnly: true, method3d: 'weighted', layout3d: 'overlay', compare3d: true,
      markers: c.view.markers, tableGroups: c.view.tableGroups,
    });
  });

  it('never carries session data: only the preference fields are serialised', () => {
    const s = {
      ...defaults(),
      files: [{ id: 'secret.msi', path: 'secret.msi', text: 'DATA', result: { ok: false as const, error: 'x' } }],
      names: { 'secret.msi': 'Secret' },
    };
    s.view = { ...s.view, simulation: { ...s.view.simulation, offsets: { 'secret.msi': { electricalDeg: 3, mechanicalDeg: 0, azimuthDeg: 0 } } } };
    const text = serializePrefs(s);
    // Precisely: no session values, no session keys (the `collapsed` flag mentions no "simulation").
    expect(text).not.toMatch(/secret|DATA|Secret|"offsets"|"groupOffsets"|"names"|"files"|"membership"|"customGroups"|"tagOverrides"|"dimension"|electricalDeg|mechanicalDeg|azimuthDeg/);
    expect(JSON.parse(text).view).not.toHaveProperty('simulation');
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['settings', 'version', 'view']);
    expect(Object.keys(prefsOf(s).view).sort()).toEqual(
      ['back3d', 'collapsed', 'compare3d', 'cut', 'floorDb', 'freqMetric', 'gainUnit', 'layout3d', 'markers', 'method3d', 'mode', 'tableGroups', 'tableTickedOnly', 'theme'],
    );
  });

  it.each([
    ['nothing stored', null],
    ['invalid JSON', '{"version":1,'],
    ['not an object', '[1,2]'],
    ['an unknown version', JSON.stringify({ ...JSON.parse(serializePrefs(changed())), version: PREFS_VERSION + 1 })],
    ['no version', JSON.stringify({ view: { theme: 'dark' } })],
    ['null', 'null'],
  ])('gives nothing to apply for %s', (_name, text) => {
    expect(applyPrefs(text, defaults())).toBeNull();
  });

  it('falls back to the defaults field by field for wrong types and out-of-range values', () => {
    const d = defaults();
    const out = applyPrefs(
      JSON.stringify({
        version: PREFS_VERSION,
        settings: { levelDb: 'ten', fbWindowDeg: 9999, uslsRangeDeg: 30, siteSectors: 2.5, lobeLimitFactor: null },
        view: {
          theme: 'purple', gainUnit: 7, mode: 'rect', cut: 'X', floorDb: 1e9, markers: { hpbw: 'yes', fb: true }, tableGroups: 5,
          method3d: 'magic', layout3d: 'overlay', compare3d: 'yes', subBands: 'nope', freqMetric: 'nonsense', tableTickedOnly: 'yes',
        },
      }),
      d,
    )!;
    expect(out.settings).toEqual({ ...DEFAULT_SETTINGS, uslsRangeDeg: 30 });
    expect(out.view.theme).toBe(d.view.theme);
    expect(out.view.gainUnit).toBe(d.view.gainUnit);
    expect(out.view.mode).toBe('rect');
    expect(out.view.cut).toBe(d.view.cut);
    expect(out.view.floorDb).toBe(d.view.floorDb);
    expect(out.view.markers).toEqual({ ...d.view.markers, fb: true });
    expect(out.view.tableGroups).toEqual(d.view.tableGroups);
    expect(out.view.method3d).toBe(d.view.method3d);
    expect(out.view.layout3d).toBe('overlay');
    expect(out.view.compare3d).toBe(false);
    expect(out.view.subBands).toEqual([]);
    expect(out.view.freqMetric).toBe('hHpbw');
    expect(out.view.tableTickedOnly).toBe(false);
  });

  it('restores the folded controls field by field', () => {
    const d = defaults();
    const out = applyPrefs(JSON.stringify({ version: PREFS_VERSION, view: { collapsed: { simBar: true, markers: 'yes', bogus: 1 } } }), d)!;
    expect(out.view.collapsed).toEqual({ simBar: true, markers: d.view.collapsed.markers });
  });

  it('copes with missing parts and does not touch the dimension or the simulation', () => {
    const d = defaults();
    const out = applyPrefs(JSON.stringify({ version: PREFS_VERSION }), d)!;
    expect(out.settings).toEqual(DEFAULT_SETTINGS);
    expect(out.view).toEqual(d.view);
  });

  it('keeps the plot floor above the beamwidth level', () => {
    const out = applyPrefs(JSON.stringify({ version: PREFS_VERSION, settings: { levelDb: 20 }, view: { floorDb: 10 } }), defaults())!;
    expect(out.view.floorDb).toBe(21); // raised to level + 1, as the settings panel does
  });
});

describe('sub-bands are not a preference (they belong to the session and its project file)', () => {
  const mine = [{ name: 'Mid', minMHz: 1700, maxMHz: 2000 }];
  const oldStored = () => {
    const stored = JSON.parse(serializePrefs(changed()));
    stored.view.subBands = [{ name: '1710–1750 MHz', minMHz: 1710, maxMHz: 1750 }];
    return JSON.stringify(stored);
  };

  it('are never serialised', () => {
    const s = defaults();
    s.view = { ...s.view, subBands: mine };
    expect(serializePrefs(s)).not.toMatch(/subBands|Mid/);
  });

  it('are not remembered in the browser, nor is a comparison of two antennas', () => {
    const s = defaults();
    s.view = { ...s.view, bandCompare: { a: 'x', b: 'y' } };
    expect(serializePrefs(s)).not.toMatch(/bandCompare/);
  });

  it('stored by an earlier version are ignored: the session keeps its own', () => {
    expect(applyPrefs(oldStored(), defaults())!.view.subBands).toEqual([]);
    const base = defaults();
    base.view = { ...base.view, subBands: mine };
    expect(applyPrefs(oldStored(), base)!.view.subBands).toBe(mine);
  });

  it('stored by an earlier version are dropped from the storage at start, the other preferences stay', () => {
    const storage = new FakeStorage();
    storage.setItem(PREFS_KEY, oldStored());
    const stop = startPrefs({ storage });
    expect(useStore.getState().view.subBands).toEqual([]);
    expect(useStore.getState().view.gainUnit).toBe('dBi');
    expect(storage.getItem(PREFS_KEY)).not.toMatch(/subBands/);
    expect(JSON.parse(storage.getItem(PREFS_KEY)!)).toEqual(JSON.parse(serializePrefs(changed())));
    stop();
  });

  it('stored alone by an earlier version leave nothing behind', () => {
    const storage = new FakeStorage();
    storage.setItem(PREFS_KEY, JSON.stringify({ version: PREFS_VERSION, view: { subBands: mine } }));
    const stop = startPrefs({ storage });
    expect(useStore.getState().view.subBands).toEqual([]);
    expect(storage.getItem(PREFS_KEY)).toBeNull();
    stop();
  });

  it('edited by the user are not written', () => {
    const storage = new FakeStorage();
    const stop = startPrefs({ storage, delayMs: 10 });
    useStore.getState().updateView({ subBands: mine });
    vi.advanceTimersByTime(1000);
    expect(storage.getItem(PREFS_KEY)).toBeNull();
    useStore.getState().updateView({ gainUnit: 'dBi' });
    vi.advanceTimersByTime(1000);
    expect(storage.getItem(PREFS_KEY)).not.toMatch(/subBands|Mid/);
    stop();
  });
});

describe('writePrefs', () => {
  it('writes the one key, and removes it when everything is at the defaults', () => {
    const storage = new FakeStorage();
    writePrefs(storage, changed(), defaults());
    expect([...storage.data.keys()]).toEqual([PREFS_KEY]);
    writePrefs(storage, defaults(), defaults());
    expect(storage.data.size).toBe(0);
  });

  it('swallows storage errors and a missing storage', () => {
    expect(() => writePrefs(throwing(), changed(), defaults())).not.toThrow();
    expect(() => writePrefs(null, changed(), defaults())).not.toThrow();
  });
});

describe('startPrefs', () => {
  it('restores stored preferences into the store before anything else', () => {
    const storage = new FakeStorage();
    storage.setItem(PREFS_KEY, serializePrefs(changed()));
    const stop = startPrefs({ storage });
    const s = useStore.getState();
    expect(s.view.gainUnit).toBe('dBi');
    expect(s.view.markers.usls).toBe(true);
    expect(s.settings.levelDb).toBe(6);
    expect(s.files).toEqual([]);
    stop();
  });

  it('writes changes after a quiet period, once, and not for session data', () => {
    const storage = new FakeStorage();
    const set = vi.spyOn(storage, 'setItem');
    const stop = startPrefs({ storage, delayMs: 300 });
    useStore.getState().updateView({ gainUnit: 'dBi' });
    useStore.getState().updateView({ mode: 'rect' });
    expect(set).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(set).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(storage.getItem(PREFS_KEY)!);
    expect(stored.view).toMatchObject({ gainUnit: 'dBi', mode: 'rect' });

    // Loading a pattern and moving a simulation slider change nothing that is remembered.
    useStore.getState().addFiles([{ path: 'a.msi', bytes: new TextEncoder().encode(planetText()).buffer as ArrayBuffer }]);
    useStore.getState().updateSimulation({ electricalDeg: 3 });
    vi.advanceTimersByTime(1000);
    expect(set).toHaveBeenCalledTimes(1);
    expect([...storage.data.keys()]).toEqual([PREFS_KEY]);
    expect(storage.getItem(PREFS_KEY)).not.toMatch(/a\.msi/);
    stop();
  });

  it('does not let an opened project or an undo overwrite the stored preferences', () => {
    const storage = new FakeStorage();
    const stop = startPrefs({ storage, delayMs: 10 });
    useStore.getState().updateView({ mode: 'rect' });
    vi.advanceTimersByTime(10);
    const mine = storage.getItem(PREFS_KEY);
    expect(JSON.parse(mine!).view.mode).toBe('rect');

    useStore.getState().addFiles([{ path: 'a.msi', bytes: new TextEncoder().encode(planetText()).buffer as ArrayBuffer }]);
    useStore.getState().loadProject({
      format: 'lobe-story-project', version: 1, savedAt: '', files: [], state: { view: { gainUnit: 'dBi', mode: 'polar' } as never },
    });
    vi.advanceTimersByTime(1000);
    // The project is on screen, the stored preferences are still the user's own.
    expect(useStore.getState().view.gainUnit).toBe('dBi');
    expect(storage.getItem(PREFS_KEY)).toBe(mine);

    // Undoing back to the earlier session does not write either.
    useStore.getState().undoLast();
    vi.advanceTimersByTime(1000);
    expect(storage.getItem(PREFS_KEY)).toBe(mine);

    // A change the user makes themselves is stored on top of their own preferences, not the project's.
    useStore.getState().updateView({ cut: 'V' });
    vi.advanceTimersByTime(10);
    const stored = JSON.parse(storage.getItem(PREFS_KEY)!).view;
    expect(stored).toMatchObject({ cut: 'V', mode: 'rect' });
    expect(stored.gainUnit).toBe(defaults().view.gainUnit);
    stop();
  });

  it('a reset from the line under the toolbar that is undone leaves the stored preference as it was before the reset', () => {
    const storage = new FakeStorage();
    const stop = startPrefs({ storage, delayMs: 10 });
    useStore.getState().addFiles([{ path: 'a.msi', bytes: new TextEncoder().encode(planetText()).buffer as ArrayBuffer }]);
    // The user's own level and method, remembered.
    useStore.getState().updateSettings({ levelDb: 6 });
    useStore.getState().updateView({ method3d: 'weighted' });
    vi.advanceTimersByTime(10);
    const mine = storage.getItem(PREFS_KEY);
    expect(JSON.parse(mine!).settings.levelDb).toBe(6);

    // Reset: remembered as the user's choice.
    useStore.getState().resetToDefault('setting:levelDb');
    vi.advanceTimersByTime(10);
    expect(JSON.parse(storage.getItem(PREFS_KEY)!).settings.levelDb).toBe(DEFAULT_SETTINGS.levelDb);
    // Undone: the level the user had is remembered again.
    useStore.getState().undoLast();
    vi.advanceTimersByTime(10);
    expect(useStore.getState().settings.levelDb).toBe(6);
    expect(storage.getItem(PREFS_KEY)).toBe(mine);

    // Undone inside the quiet time, before the reset was written: the same.
    useStore.getState().resetToDefault('method3d');
    useStore.getState().undoLast();
    vi.advanceTimersByTime(10);
    expect(storage.getItem(PREFS_KEY)).toBe(mine);
    stop();
  });

  it('a setting a project brought that is reset and the reset undone is shown again but not remembered', () => {
    const storage = new FakeStorage();
    const stop = startPrefs({ storage, delayMs: 10 });
    useStore.getState().updateView({ mode: 'rect' });
    vi.advanceTimersByTime(10);
    const mine = storage.getItem(PREFS_KEY);
    useStore.getState().loadProject({
      format: 'lobe-story-project', version: 1, savedAt: '', files: [{ path: 'a.msi', text: planetText() }], state: { settings: { ...DEFAULT_SETTINGS, sectorEdgeDeg: 45 }, view: { method3d: 'weighted' } as never },
    });
    useStore.getState().resetToDefault('setting:sectorEdgeDeg');
    vi.advanceTimersByTime(10);
    useStore.getState().undoLast();
    vi.advanceTimersByTime(10);
    expect(useStore.getState().settings.sectorEdgeDeg).toBe(45);
    expect(storage.getItem(PREFS_KEY)).toBe(mine);
    // A reset that is not undone is the user's choice: remembered.
    useStore.getState().resetToDefault('method3d');
    vi.advanceTimersByTime(10);
    expect(JSON.parse(storage.getItem(PREFS_KEY)!).view.method3d).toBe('summation');
    // An undo withdrawn by a later edit puts nothing back.
    useStore.getState().updateView({ method3d: 'weighted' });
    useStore.getState().resetToDefault('method3d');
    useStore.getState().updateView({ cut: 'H' });
    expect(useStore.getState().undo).toBeNull();
    useStore.getState().undoLast();
    vi.advanceTimersByTime(10);
    expect(JSON.parse(storage.getItem(PREFS_KEY)!).view).toMatchObject({ method3d: 'summation', cut: 'H' });
    stop();
  });

  it('only an undo of a reset from the line puts stored preferences back: the undo of any other action writes nothing', () => {
    const storage = new FakeStorage();
    const stop = startPrefs({ storage, delayMs: 10 });
    const add = (path: string) => useStore.getState().addFiles([{ path, bytes: new TextEncoder().encode(planetText()).buffer as ArrayBuffer }]);
    useStore.getState().updateView({ mode: 'rect' });
    useStore.getState().updateSettings({ levelDb: 6 });
    vi.advanceTimersByTime(10);
    const mine = storage.getItem(PREFS_KEY);
    const set = vi.spyOn(storage, 'setItem');
    const remove = vi.spyOn(storage, 'removeItem');
    add('a.msi');
    add('b.msi');
    const project = { format: 'lobe-story-project' as const, version: 1, savedAt: '', files: [{ path: 'p.msi', text: planetText() }], state: { settings: { ...DEFAULT_SETTINGS, levelDb: 9 }, view: { mode: 'polar', method3d: 'weighted' } as never } };
    const actions: [string, () => void][] = [
      ['remove a file', () => useStore.getState().removeFile('b.msi')],
      ['show only', () => useStore.getState().setVisibleOnly([], 'Showed no file')],
      ['reset the simulation', () => (useStore.getState().updateSimulation({ mechanicalDeg: 3 }), useStore.getState().resetSimulation())],
      ['drop sub-bands', () => (useStore.getState().updateView({ subBands: [{ name: 'A', minMHz: 1, maxMHz: 2 }] }), useStore.getState().dropSubBands())],
      ['open a project over the session', () => useStore.getState().loadProject(project)],
      ['clear', () => useStore.getState().clear()],
    ];
    for (const [what, act] of actions) {
      act();
      expect(useStore.getState().undo, what).not.toBeNull();
      useStore.getState().undoLast();
      vi.advanceTimersByTime(50);
      expect(storage.getItem(PREFS_KEY), what).toBe(mine);
    }
    // The sub-bands and the simulation typed before their undoable resets are session work, never preferences.
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    stop();
  });

  it('a change still waiting to be written is written with the value the user set, even if a project is opened meanwhile', () => {
    const storage = new FakeStorage();
    const stop = startPrefs({ storage, delayMs: 300 });
    useStore.getState().updateView({ gainUnit: 'dBi' });
    useStore.getState().updateSettings({ levelDb: 6 });
    vi.advanceTimersByTime(100);
    // Inside the quiet time a project that has other values for the same keys is opened.
    useStore.getState().loadProject({
      format: 'lobe-story-project', version: 1, savedAt: '', files: [], state: { view: { gainUnit: 'dBd' } as never, settings: { levelDb: 12 } as never },
    });
    expect(useStore.getState().view.gainUnit).toBe('dBd');
    vi.advanceTimersByTime(300);
    const stored = JSON.parse(storage.getItem(PREFS_KEY)!);
    expect(stored.view.gainUnit).toBe('dBi');
    expect(stored.settings.levelDb).toBe(6);
    stop();
  });

  it('a stored unfolded simulation bar wins over the folded default; with nothing stored the bar starts folded', () => {
    const none = new FakeStorage();
    const stop0 = startPrefs({ storage: none, delayMs: 10 });
    expect(useStore.getState().view.collapsed.simBar).toBe(true);
    stop0();
    useStore.setState(initialState());
    const stored = new FakeStorage();
    stored.setItem(PREFS_KEY, JSON.stringify({ version: PREFS_VERSION, view: { collapsed: { simBar: false } } }));
    const stop = startPrefs({ storage: stored, delayMs: 10 });
    expect(useStore.getState().view.collapsed.simBar).toBe(false);
    stop();
  });

  it('stores only the keys of markers, table columns and folded controls that the user changed', () => {
    const storage = new FakeStorage();
    const stop = startPrefs({ storage, delayMs: 10 });
    const d = defaults().view;
    // A project that shows other markers, columns and folds is opened, then the user changes one key of each.
    useStore.getState().loadProject({
      format: 'lobe-story-project', version: 1, savedAt: '', files: [],
      state: { view: { markers: { ...d.markers, usls: true, null: true }, tableGroups: { ...d.tableGroups, declared: true }, collapsed: { simBar: !d.collapsed.simBar, markers: !d.collapsed.markers } } as never },
    });
    const v = useStore.getState().view;
    expect(v.markers.usls).toBe(true);
    useStore.getState().updateView({ markers: { ...v.markers, fb: true } });
    useStore.getState().updateView({ tableGroups: { ...v.tableGroups, sector: false } });
    useStore.getState().updateView({ collapsed: { ...v.collapsed, simBar: !v.collapsed.simBar } });
    vi.advanceTimersByTime(10);
    const stored = JSON.parse(storage.getItem(PREFS_KEY)!).view;
    expect(stored.markers).toEqual({ ...d.markers, fb: true });
    expect(stored.tableGroups).toEqual({ ...d.tableGroups, sector: false });
    expect(stored.collapsed).toEqual({ ...d.collapsed, simBar: !v.collapsed.simBar });
    stop();
  });

  it('a project opened first does not leak into an empty store of preferences', () => {
    const storage = new FakeStorage();
    const stop = startPrefs({ storage, delayMs: 10 });
    useStore.getState().loadProject({
      format: 'lobe-story-project', version: 1, savedAt: '', files: [], state: { view: { gainUnit: 'dBi' } as never },
    });
    vi.advanceTimersByTime(100);
    expect(storage.getItem(PREFS_KEY)).toBeNull();
    stop();
  });

  it('survives damaged storage and storage that throws', () => {
    const damaged = new FakeStorage();
    damaged.setItem(PREFS_KEY, '{{{');
    expect(() => startPrefs({ storage: damaged })()).not.toThrow();
    expect(useStore.getState().view).toEqual(defaults().view);

    const stop = startPrefs({ storage: throwing(), delayMs: 1 });
    expect(() => {
      useStore.getState().updateView({ cut: 'V' });
      vi.advanceTimersByTime(5);
    }).not.toThrow();
    stop();
    expect(() => startPrefs({ storage: null })()).not.toThrow();
  });

  it('stops writing once stopped', () => {
    const storage = new FakeStorage();
    startPrefs({ storage, delayMs: 1 })();
    useStore.getState().updateView({ cut: 'V' });
    vi.advanceTimersByTime(10);
    expect(storage.data.size).toBe(0);
  });
});

describe('resetPrefs', () => {
  it('restores the defaults, clears the key and keeps the session', () => {
    const storage = new FakeStorage();
    const stop = startPrefs({ storage, delayMs: 1 });
    useStore.getState().addFiles([{ path: 'a.msi', bytes: new TextEncoder().encode(planetText()).buffer as ArrayBuffer }]);
    useStore.getState().updateView({ gainUnit: 'dBi', markers: { ...useStore.getState().view.markers, usls: true } });
    useStore.getState().updateSettings({ levelDb: 6 });
    vi.advanceTimersByTime(5);
    expect(storage.getItem(PREFS_KEY)).not.toBeNull();

    resetPrefs(storage);
    vi.advanceTimersByTime(5);
    const d = defaults();
    expect(useStore.getState().view.gainUnit).toBe(d.view.gainUnit);
    expect(useStore.getState().view.markers).toEqual(d.view.markers);
    expect(useStore.getState().settings).toEqual(DEFAULT_SETTINGS);
    expect(storage.getItem(PREFS_KEY)).toBeNull();
    expect(useStore.getState().files).toHaveLength(1);
    stop();
  });

  it('leaves user sub-bands (part of the session) alone', () => {
    const storage = new FakeStorage();
    const sb = [{ name: 'Mine', fromMHz: 1700, toMHz: 1800 }];
    useStore.getState().updateView({ subBands: sb as never, gainUnit: 'dBi' });
    resetPrefs(storage);
    expect(useStore.getState().view.subBands).toBe(sb);
    expect(useStore.getState().view.gainUnit).toBe(defaults().view.gainUnit);
  });

  it('does not make a loaded session unsaved or drop undo when it already had the defaults', () => {
    const st = useStore.getState();
    st.addFiles([{ path: 'a.msi', bytes: new TextEncoder().encode(planetText()).buffer as ArrayBuffer }]);
    useStore.getState().markSaved();
    useStore.getState().removeFile(useStore.getState().files[0].id);
    useStore.getState().undoLast();
    useStore.getState().markSaved();
    expect(isDirty(useStore.getState())).toBe(false);
    const undo = useStore.getState().undo;
    const view = useStore.getState().view;
    resetPrefs(new FakeStorage());
    expect(isDirty(useStore.getState())).toBe(false);
    expect(useStore.getState().view).toBe(view);
    expect(useStore.getState().undo).toBe(undo);
  });

  it('does not throw when storage does', () => {
    expect(() => resetPrefs(throwing())).not.toThrow();
  });
});
