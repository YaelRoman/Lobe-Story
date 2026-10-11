import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/analysis/metrics';
import { applyPrefs, PREFS_KEY, PREFS_VERSION, prefsOf, resetPrefs, serializePrefs, startPrefs, writePrefs, type StorageLike } from './prefs';
import { initialState, useStore } from './store';
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
      subBands: [{ name: 'Mid', minMHz: 1700, maxMHz: 2000 }],
    },
  };
};

describe('applyPrefs', () => {
  it('round-trips the preferences', () => {
    const c = changed();
    const out = applyPrefs(serializePrefs(c), defaults())!;
    expect(out.settings).toEqual(c.settings);
    expect(out.view).toMatchObject({
      theme: c.view.theme, gainUnit: 'dBi', mode: 'rect', cut: 'H', floorDb: 55, method3d: 'weighted', layout3d: 'overlay',
      markers: c.view.markers, tableGroups: c.view.tableGroups, subBands: c.view.subBands,
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
    expect(text).not.toMatch(/secret|DATA|offsets|simulation|dimension/i);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['settings', 'version', 'view']);
    expect(Object.keys(prefsOf(s).view).sort()).toEqual(
      ['cut', 'floorDb', 'gainUnit', 'layout3d', 'markers', 'method3d', 'mode', 'subBands', 'tableGroups', 'theme'],
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
          method3d: 'magic', layout3d: 'overlay', subBands: 'nope',
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
    expect(out.view.subBands).toEqual([]);
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

  it('remembers what a project that is opened brings (the preferences follow the screen)', () => {
    const storage = new FakeStorage();
    const stop = startPrefs({ storage, delayMs: 10 });
    useStore.getState().loadProject({
      format: 'lobe-story-project', version: 1, savedAt: '', files: [], state: { view: { gainUnit: 'dBi' } as never },
    });
    vi.advanceTimersByTime(10);
    expect(JSON.parse(storage.getItem(PREFS_KEY)!).view.gainUnit).toBe('dBi');
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

  it('does not throw when storage does', () => {
    expect(() => resetPrefs(throwing())).not.toThrow();
  });
});
