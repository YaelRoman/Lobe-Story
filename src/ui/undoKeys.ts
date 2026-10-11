/** Input types the user types text into, where Ctrl/Cmd+Z belongs to the field's own undo. */
const TEXT_INPUT_TYPES = new Set(['text', 'number', 'search', 'email', 'url', 'password', 'tel']);

/** The parts of an element `isTextEntry` looks at (so it can be tested without a DOM). */
export interface FieldLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

/** Whether the element is one the user types text into. Checkboxes, sliders, selects and buttons are not. */
export function isTextEntry(el: FieldLike | null | undefined): boolean {
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  return tag === 'INPUT' && TEXT_INPUT_TYPES.has((el.type || 'text').toLowerCase());
}

export interface KeyLike {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  key?: string;
  code?: string;
}

/** Ctrl+Z or Cmd+Z, by the character or by the physical key (the character differs on some layouts). */
export function isUndoShortcut(e: KeyLike): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return false;
  return e.code === 'KeyZ' || (typeof e.key === 'string' && e.key.toLowerCase() === 'z');
}

/** How the undo shortcut is written on this platform. */
export function undoShortcutLabel(platform: string): string {
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘Z' : 'Ctrl+Z';
}

/** The undo shortcut as written on the platform the page runs on. */
export const undoShortcut = (): string => undoShortcutLabel(typeof navigator === 'undefined' ? '' : navigator.platform);

/**
 * Where focus goes when the item `current` of `keys` (in display order) is removed: the items after
 * it, nearest first, then the ones before it, nearest first. The caller takes the first that is still there.
 */
export function neighbourOrder(keys: string[], current: string): string[] {
  const at = keys.indexOf(current);
  if (at < 0) return [];
  return [...keys.slice(at + 1), ...keys.slice(0, at).reverse()];
}
