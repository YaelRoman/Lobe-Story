import { DEFAULT_SETTINGS, type AnalysisSettings } from '../core/analysis/metrics';
import { clampFloor } from '../core/analysis/settingLimits';
import { oneOf, sanitizeDisplayView, sanitizeSettings } from './project';
import { initialState, sessionSwapCount, useStore, type StoreData, type ViewState } from './store';

/**
 * Display preferences remembered per browser. They change only when the user changes them: a project
 * that is opened (it brings its own settings and view) is shown but not remembered. Nothing of a
 * session is stored: no pattern data, file names, groups, offsets, tags or selections.
 */
export const PREFS_KEY = 'lobe-story:prefs:v1';
export const PREFS_VERSION = 1;

/** The view fields that are preferences (not the dimension, which starts as 2D, nor the simulation). */
const VIEW_KEYS = ['theme', 'gainUnit', 'cut', 'mode', 'floorDb', 'markers', 'tableGroups', 'subBands', 'method3d', 'layout3d', 'collapsed'] as const;
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
      subBands: display.subBands,
      method3d: display.method3d,
      layout3d: display.layout3d,
      collapsed: display.collapsed,
      theme: oneOf(rawView.theme, ['light', 'dark'] as const, base.view.theme),
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

export interface PrefsOptions {
  storage?: StorageLike | null;
  /** Quiet time after the last change before the preferences are written. */
  delayMs?: number;
}

/** The preference values of `s` by name ("settings.levelDb", "view.mode", ...), as comparable text. */
function prefEntries(s: Pick<StoreData, 'settings' | 'view'>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(s.settings)) out.set(`settings.${k}`, JSON.stringify(v));
  for (const k of VIEW_KEYS) out.set(`view.${k}`, JSON.stringify(s.view[k]));
  return out;
}

/** The stored preferences (on top of the defaults) with the values of `changed` put in. */
function mergeChanged(storage: StorageLike, s: Pick<StoreData, 'settings' | 'view'>, defaults: Pick<StoreData, 'settings' | 'view'>, changed: Set<string>): Pick<StoreData, 'settings' | 'view'> {
  let text: string | null = null;
  try {
    text = storage.getItem(PREFS_KEY);
  } catch {
    text = null;
  }
  const base = applyPrefs(text, defaults) ?? defaults;
  const settings: Record<string, unknown> = { ...base.settings };
  const view: Record<string, unknown> = { ...base.view };
  for (const name of changed) {
    const [group, key] = name.split('.');
    if (group === 'settings') settings[key] = (s.settings as unknown as Record<string, unknown>)[key];
    else view[key] = (s.view as unknown as Record<string, unknown>)[key];
  }
  return { settings: settings as unknown as AnalysisSettings, view: view as unknown as ViewState };
}

/**
 * Restores the stored preferences into the store, then keeps them up to date: a preference the user
 * changes is written after `delayMs` of quiet, and at once when the page is hidden or closed. What a
 * project that is opened (or an undo) puts on screen is not the user's choice and is never stored;
 * only the keys the user changes are written, on top of what was stored before.
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
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<string>();
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (pending.size === 0) return;
    const changed = new Set(pending);
    pending.clear();
    if (!storage) return;
    try {
      writePrefs(storage, mergeChanged(storage, useStore.getState(), defaults, changed), defaults);
    } catch {
      // Storage gone: preferences are a convenience, never an error.
    }
  };
  let swaps = sessionSwapCount();
  const unsubscribe = useStore.subscribe((s, prev) => {
    const swapped = sessionSwapCount() !== swaps;
    swaps = sessionSwapCount();
    if (swapped || (s.settings === prev.settings && s.view === prev.view)) return;
    const before = prefEntries(prev);
    for (const [name, text] of prefEntries(s)) if (before.get(name) !== text) pending.add(name);
    clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
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

/** The view preferences a reset restores: user sub-bands are part of the session (saved in project files), so they stay. */
const RESET_VIEW_KEYS = VIEW_KEYS.filter((k) => k !== 'subBands');

/**
 * Puts the remembered display preferences back to their defaults and forgets the stored ones. Session
 * content is not touched, and a value that already is the default is not set again (no new object, so
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
  for (const k of RESET_VIEW_KEYS) {
    if (JSON.stringify(cur.view[k]) !== JSON.stringify(d.view[k])) view[k] = d.view[k];
  }
  if (Object.keys(view).length > 0) updateView(view as Partial<ViewState>);
  try {
    storage?.removeItem(PREFS_KEY);
  } catch {
    // ignore
  }
}
