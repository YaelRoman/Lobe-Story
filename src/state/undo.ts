import type { StoreData } from './store';

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

/** The user's edits, by reference: if none of these changed since a save, there is no unsaved work. */
export interface SavedMark {
  tagOverrides: StoreData['tagOverrides'];
  copies: StoreData['copies'];
  names: StoreData['names'];
  customGroups: StoreData['customGroups'];
  membership: StoreData['membership'];
  offsets: StoreData['view']['simulation']['offsets'];
  groupOffsets: StoreData['view']['simulation']['groupOffsets'];
}

export function markOf(s: Pick<StoreData, 'tagOverrides' | 'copies' | 'names' | 'customGroups' | 'membership' | 'view'>): SavedMark {
  return {
    tagOverrides: s.tagOverrides,
    copies: s.copies,
    names: s.names,
    customGroups: s.customGroups,
    membership: s.membership,
    offsets: s.view.simulation.offsets,
    groupOffsets: s.view.simulation.groupOffsets,
  };
}

/**
 * Unsaved work: files are loaded and the session was never saved or opened from a project, or its
 * edits (tags, copies, names, groups, offsets) changed since. Loading more pattern files after a
 * save is not "work": the files are still on disk.
 */
export function isDirty(s: StoreData): boolean {
  if (s.files.length === 0) return false;
  if (!s.saved) return true;
  const now = markOf(s);
  return (Object.keys(now) as (keyof SavedMark)[]).some((k) => now[k] !== s.saved![k]);
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
