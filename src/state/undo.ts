import type { StoreData } from './store';
import { sessionFiles, sessionState } from './project';

/** The parts of the store a destructive action can change; an undo puts exactly these back. */
const SNAPSHOT_KEYS = [
  'files',
  'tagOverrides',
  'visible',
  'highlighted',
  'settings',
  'view',
  'copies',
  'names',
  'customGroups',
  'membership',
  'selected',
  'pendingFiles',
  'saved',
] as const;

export type Snapshot = Pick<StoreData, (typeof SNAPSHOT_KEYS)[number]>;

/** One level of undo: what the last destructive action replaced. */
export interface UndoEntry {
  id: number;
  label: string;
  snapshot: Snapshot;
}

/**
 * Shallow snapshot: the parsed patterns, texts and record objects are shared by reference, never
 * copied. This is safe because store updates are immutable (they replace objects, never mutate).
 */
export function takeSnapshot(s: StoreData): Snapshot {
  const out: Record<string, unknown> = {};
  for (const k of SNAPSHOT_KEYS) out[k] = s[k];
  return out as unknown as Snapshot;
}

/**
 * What an offered undo protects: every part of the session a later action could change and the
 * undo would then silently throw away. The highlight, the selection and the theme are not work.
 */
const SESSION_KEYS = [
  'files',
  'pendingFiles',
  'tagOverrides',
  'visible',
  'settings',
  'copies',
  'names',
  'customGroups',
  'membership',
] as const;

/**
 * Whether applying `patch` to `prev` changes session data or the view (other than the theme).
 * The store runs every update through this, so an offered undo is withdrawn by any such change
 * without each action having to remember it.
 */
export function changesSession(prev: StoreData, patch: Partial<StoreData>): boolean {
  for (const k of SESSION_KEYS) if (k in patch && patch[k] !== prev[k]) return true;
  const view = patch.view;
  if (view === undefined || view === prev.view) return false;
  const keys = new Set([...Object.keys(view), ...Object.keys(prev.view)]) as Set<keyof StoreData['view']>;
  keys.delete('theme');
  return [...keys].some((k) => !Object.is(view[k], prev.view[k]));
}

/** JSON with object keys in sorted order, so equal content gives equal text whatever the insertion order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v ?? null)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** The saveable state as of the last Save project / Open project, by value. */
export interface SavedMark {
  /** Path → content fingerprint of every listed file; null when the project did not record one. */
  files: Record<string, string | null>;
  /** Everything else a project stores (see project.ts `sessionState`), as canonical JSON. */
  state: string;
}

type Saveable = Parameters<typeof sessionState>[0];

export function markOf(s: Saveable): SavedMark {
  const files = Object.fromEntries(sessionFiles(s).map((f) => [f.path, f.fp ?? null]));
  const state = sessionState(s);
  // A hidden file and a file with no visibility entry are the same thing.
  const visible = Object.keys(state.visible).filter((id) => state.visible[id]);
  return { files, state: stableStringify({ ...state, visible: visible.sort() }) };
}

/**
 * Unsaved work: at least one pattern is loaded and what Save project would write (the theme, the
 * highlight and the selection aside) differs from the last saved or opened project — or there is
 * no such project yet. Compared by value, so a change that was put back is not unsaved work.
 * Attaching the files a layout-only project asked for is not a change: the file list is the same.
 */
export function isDirty(s: StoreData): boolean {
  if (!s.files.some((f) => f.result.ok)) return false;
  if (!s.saved) return true;
  const now = markOf(s);
  if (now.state !== s.saved.state) return true;
  const was = s.saved.files;
  const paths = Object.keys(now.files);
  if (paths.length !== Object.keys(was).length) return true;
  const has = (p: string) => Object.prototype.hasOwnProperty.call(was, p);
  return paths.some((p) => !has(p) || (was[p] !== null && was[p] !== now.files[p]));
}

/** Clear asks first when it would throw away more than a single plain file. */
export function clearNeedsConfirm(s: StoreData): boolean {
  const sim = s.view.simulation;
  return (
    s.files.length > 1 ||
    s.customGroups.length > 0 ||
    Object.keys(s.copies).length > 0 ||
    Object.keys(s.names).length > 0 ||
    Object.keys(s.tagOverrides).length > 0 ||
    Object.keys(sim.offsets).length > 0 ||
    Object.keys(sim.groupOffsets).length > 0
  );
}
