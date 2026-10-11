import { DEFAULT_SETTINGS, type AnalysisSettings } from '../core/analysis/metrics';
import { clampFloor } from '../core/analysis/settingLimits';
import { oneOf, sanitizeDisplayView, sanitizeSettings } from './project';
import { initialState, useStore, type StoreData, type ViewState } from './store';

/**
 * Display preferences remembered per browser. They are what the user last had on screen, so a project
 * that is opened (it brings its own settings and view) becomes the remembered state too. Nothing of a
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

/**
 * Restores the stored preferences into the store, then keeps them up to date: every change of the
 * settings or view is written after `delayMs` of quiet, and at once when the page is hidden or closed.
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
  let last = serializePrefs(useStore.getState());
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const s = useStore.getState();
    const now = serializePrefs(s);
    if (now === last) return;
    last = now;
    writePrefs(storage, s, defaults);
  };
  const unsubscribe = useStore.subscribe((s, prev) => {
    if (s.settings === prev.settings && s.view === prev.view) return;
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

/** Puts every remembered preference back to its default and forgets the stored ones. */
export function resetPrefs(storage: StorageLike | null = browserStorage()): void {
  const d = initialState();
  const { updateSettings, updateView } = useStore.getState();
  updateSettings({ ...DEFAULT_SETTINGS });
  updateView(prefsOf(d).view);
  try {
    storage?.removeItem(PREFS_KEY);
  } catch {
    // ignore
  }
}
