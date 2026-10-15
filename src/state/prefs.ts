import { DEFAULT_SETTINGS, type AnalysisSettings } from '../core/analysis/metrics';
import { clampFloor } from '../core/analysis/settingLimits';
import { oneOf, sanitizeDisplayView, sanitizeMetric, sanitizeSettings } from './project';
import { initialState, sessionSwapCount, useStore, type StoreData, type ViewState } from './store';

/**
 * Display preferences remembered per browser. They change only when the user changes them: a project
 * that is opened (it brings its own settings and view) is shown but not remembered. Nothing of a
 * session is stored: no pattern data, file names, groups, offsets, tags, selections or sub-bands (those are
 * saved in the project file).
 */
export const PREFS_KEY = 'lobe-story:prefs:v1';
export const PREFS_VERSION = 1;

/** The view fields that are preferences (not the dimension, which starts as 2D, nor the simulation). */
const VIEW_KEYS = ['theme', 'gainUnit', 'cut', 'mode', 'floorDb', 'markers', 'tableGroups', 'method3d', 'layout3d', 'compare3d', 'collapsed', 'freqMetric', 'tableTickedOnly'] as const;
type PrefViewKey = (typeof VIEW_KEYS)[number];

export interface Prefs {
  version: typeof PREFS_VERSION;
  settings: AnalysisSettings;
  view: Pick<ViewState, PrefViewKey>;
}

/** The part of `Storage` used here, so tests can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `localStorage`, or null when the browser has none or refuses access (private mode, blocked site data). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The preferences held by `s`. */
export function prefsOf(s: Pick<StoreData, 'settings' | 'view'>): Prefs {
  const view = {} as Record<string, unknown>;
  for (const k of VIEW_KEYS) view[k] = s.view[k];
  return { version: PREFS_VERSION, settings: s.settings, view: view as Prefs['view'] };
}

export const serializePrefs = (s: Pick<StoreData, 'settings' | 'view'>): string => JSON.stringify(prefsOf(s));

/**
 * The state patch for stored text on top of `base` (the defaults): each value goes through the same
 * sanitisers a project file does, so damaged, hand-edited or outdated values fall back to `base`'s.
 * Sub-bands an earlier version stored are not read: they stay `base`'s.
 * Missing, unparseable or newer-version text gives null (nothing to apply). Never throws.
 */
export function applyPrefs(text: string | null, base: Pick<StoreData, 'settings' | 'view'>): Pick<StoreData, 'settings' | 'view'> | null {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== PREFS_VERSION) return null;
  const rawView = typeof obj.view === 'object' && obj.view !== null && !Array.isArray(obj.view) ? (obj.view as Record<string, unknown>) : {};
  const settings = sanitizeSettings(obj.settings);
  const display = sanitizeDisplayView(rawView, base.view as ViewState);
  return {
    settings,
    view: {
      ...base.view,
      cut: display.cut,
      mode: display.mode,
      gainUnit: display.gainUnit,
      // The plot floor must stay above the beamwidth level, as in the settings panel.
      floorDb: clampFloor(display.floorDb, settings.levelDb) ?? base.view.floorDb,
      markers: display.markers,
      tableGroups: display.tableGroups,
      method3d: display.method3d,
      layout3d: display.layout3d,
      compare3d: display.compare3d,
      collapsed: display.collapsed,
      theme: oneOf(rawView.theme, ['light', 'dark'] as const, base.view.theme),
      freqMetric: sanitizeMetric(rawView.freqMetric, base.view.freqMetric),
      tableTickedOnly: typeof rawView.tableTickedOnly === 'boolean' ? rawView.tableTickedOnly : base.view.tableTickedOnly,
    },
  };
}

/** Writes the preferences of `s`, or removes the key when they are the defaults (nothing to remember). Errors are swallowed. */
export function writePrefs(storage: StorageLike | null, s: Pick<StoreData, 'settings' | 'view'>, defaults: Pick<StoreData, 'settings' | 'view'>): void {
  if (!storage) return;
  try {
    const text = serializePrefs(s);
    if (text === serializePrefs(defaults)) storage.removeItem(PREFS_KEY);
    else storage.setItem(PREFS_KEY, text);
  } catch {
    // Storage full, blocked or gone: preferences are a convenience, never an error.
  }
}

/** Whether stored text still holds sub-bands (written by a version that remembered them as a preference). */
function hasStoredSubBands(text: string | null): boolean {
  try {
    const view = (JSON.parse(text ?? 'null') as { view?: unknown } | null)?.view;
    return typeof view === 'object' && view !== null && 'subBands' in view;
  } catch {
    return false;
  }
}

export interface PrefsOptions {
  storage?: StorageLike | null;
  /** Quiet time after the last change before the preferences are written. */
  delayMs?: number;
}

/** The object-valued view preferences: each of their keys is remembered on its own. */
const OBJECT_KEYS: readonly PrefViewKey[] = ['markers', 'tableGroups', 'collapsed'];

/**
 * The preference values of `s` by name ("settings.levelDb", "view.mode", "view.markers.fb", ...), each as
 * its value and as comparable text. Object-valued preferences are listed key by key.
 */
function prefEntries(s: Pick<StoreData, 'settings' | 'view'>): Map<string, { value: unknown; text: string }> {
  const out = new Map<string, { value: unknown; text: string }>();
  const add = (name: string, value: unknown) => out.set(name, { value, text: JSON.stringify(value) });
  for (const [k, v] of Object.entries(s.settings)) add(`settings.${k}`, v);
  for (const k of VIEW_KEYS) {
    const value = s.view[k];
    if (OBJECT_KEYS.includes(k)) for (const [sub, v] of Object.entries(value as Record<string, unknown>)) add(`view.${k}.${sub}`, v);
    else add(`view.${k}`, value);
  }
  return out;
}

/** The stored preferences (on top of the defaults) with the changed values (name → value, as of the change) put in. */
function mergeChanged(storage: StorageLike, defaults: Pick<StoreData, 'settings' | 'view'>, changed: Map<string, unknown>): Pick<StoreData, 'settings' | 'view'> {
  let text: string | null = null;
  try {
    text = storage.getItem(PREFS_KEY);
  } catch {
    text = null;
  }
  const base = applyPrefs(text, defaults) ?? defaults;
  const settings: Record<string, unknown> = { ...base.settings };
  const view: Record<string, unknown> = { ...base.view };
  for (const [name, value] of changed) {
    const [group, key, sub] = name.split('.');
    if (group === 'settings') settings[key] = value;
    else if (sub !== undefined) view[key] = { ...(view[key] as Record<string, unknown>), [sub]: value };
    else view[key] = value;
  }
  return { settings: settings as unknown as AnalysisSettings, view: view as unknown as ViewState };
}

/**
 * Restores the stored preferences into the store, then keeps them up to date: a preference the user
 * changes is written after `delayMs` of quiet (with the value it had when it was changed), and at once when the page is hidden or closed. What a
 * project that is opened (or an undo) puts on screen is not the user's choice and is never stored;
 * only the keys the user changes are written (for markers, table columns and folded controls each key on
 * its own), on top of what was stored before.
 * Returns a function that stops it.
 */
export function startPrefs({ storage = browserStorage(), delayMs = 300 }: PrefsOptions = {}): () => void {
  const defaults = initialState();
  if (storage) {
    let text: string | null = null;
    try {
      text = storage.getItem(PREFS_KEY);
    } catch {
      text = null;
    }
    const restored = applyPrefs(text, useStore.getState());
    if (restored) useStore.setState(restored);
    // An earlier version kept the user's sub-bands here, and so carried them into every later session: forget them.
    if (restored && hasStoredSubBands(text)) writePrefs(storage, applyPrefs(text, defaults) ?? defaults, defaults);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  // What the user changed and has not been written yet: name → the value they set. The value is taken when
  // the change happens, so a project opened (or an undo applied) during the quiet time cannot replace it.
  const pending = new Map<string, unknown>();
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (pending.size === 0) return;
    const changed = new Map(pending);
    pending.clear();
    if (!storage) return;
    try {
      writePrefs(storage, mergeChanged(storage, defaults, changed), defaults);
    } catch {
      // Storage gone: preferences are a convenience, never an error.
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  };
  // What the stored preferences hold for `names` now: a change not written yet, else the stored value, else the default.
  const storedValues = (names: string[]): Map<string, unknown> => {
    let text: string | null = null;
    try {
      text = storage?.getItem(PREFS_KEY) ?? null;
    } catch {
      text = null;
    }
    const stored = prefEntries(applyPrefs(text, defaults) ?? defaults);
    return new Map(names.map((name) => [name, pending.has(name) ? pending.get(name) : stored.get(name)?.value]));
  };
  // A change that offers an undo and changes preferences (a reset from the line under the toolbar): what the browser
  // held for them before it, put back if that undo is taken. An undo restores the session without being remembered (the
  // values it brings back may be a project's), so without this the reset would stay remembered behind the undone screen.
  let beforeUndoable: { id: number; values: Map<string, unknown> } | null = null;
  let swaps = sessionSwapCount();
  const unsubscribe = useStore.subscribe((s, prev) => {
    const swapped = sessionSwapCount() !== swaps;
    swaps = sessionSwapCount();
    const kept = beforeUndoable;
    if (kept && s.undo?.id !== kept.id) beforeUndoable = null;
    if (swapped) {
      if (kept && prev.undo?.id === kept.id && s.undo === null) {
        for (const [name, value] of kept.values) pending.set(name, value);
        schedule();
      }
      return;
    }
    if (s.settings === prev.settings && s.view === prev.view) return;
    const before = prefEntries(prev);
    const changed = [...prefEntries(s)].filter(([name, now]) => before.get(name)?.text !== now.text);
    if (changed.length === 0) return;
    if (s.undo && s.undo.id !== prev.undo?.id) beforeUndoable = { id: s.undo.id, values: storedValues(changed.map(([name]) => name)) };
    for (const [name, now] of changed) pending.set(name, now.value);
    schedule();
  });
  const onHide = () => flush();
  const hasWindow = typeof window !== 'undefined';
  if (hasWindow) window.addEventListener('pagehide', onHide);
  return () => {
    unsubscribe();
    clearTimeout(timer);
    if (hasWindow) window.removeEventListener('pagehide', onHide);
  };
}

/**
 * Puts the remembered display preferences back to their defaults and forgets the stored ones. Session
 * content (the user's sub-bands included) is not touched, and a value that already is the default is not set again (no new object, so
 * a loaded session does not become unsaved and an offered undo stays).
 */
export function resetPrefs(storage: StorageLike | null = browserStorage()): void {
  const d = initialState();
  const { updateSettings, updateView } = useStore.getState();
  const cur = useStore.getState();
  const settings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (JSON.stringify((cur.settings as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v)) settings[k] = v;
  }
  if (Object.keys(settings).length > 0) updateSettings(settings as Partial<AnalysisSettings>);
  const view: Record<string, unknown> = {};
  for (const k of VIEW_KEYS) {
    if (JSON.stringify(cur.view[k]) !== JSON.stringify(d.view[k])) view[k] = d.view[k];
  }
  if (Object.keys(view).length > 0) updateView(view as Partial<ViewState>);
  try {
    storage?.removeItem(PREFS_KEY);
  } catch {
    // ignore
  }
}
