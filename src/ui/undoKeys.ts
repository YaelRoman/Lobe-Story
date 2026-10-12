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

/** What the page says about undoing. */
export interface UndoWording {
  /** The offer's button. */
  button: string;
  /** Tooltip of the cross that hides the offer. */
  hideTitle: string;
  /** The note shown and read out when the offer is hidden by its cross. */
  hidden: string;
  /** Read out after what was done (it starts with a space, or is empty). */
  spoken: string;
  /** The last sentence of the question before a Clear. */
  beforeClear: string;
}

/**
 * The words about undoing for a page laid out for a phone or not. A phone has no Ctrl+Z: no key is named there, and
 * nothing is promised for after the offer has gone (the offer's button is then the only way to undo).
 */
export function undoWording(phone: boolean, platform: string = typeof navigator === 'undefined' ? '' : navigator.platform): UndoWording {
  if (phone) return { button: 'Undo', hideTitle: 'Hide', hidden: 'Undo offer hidden.', spoken: '', beforeClear: 'You can undo this right afterwards.' };
  const key = undoShortcutLabel(platform);
  return {
    button: `Undo · ${key}`,
    hideTitle: 'Hide (Ctrl/Cmd+Z still undoes)',
    hidden: `Undo offer hidden. ${key} still undoes.`,
    spoken: ` Undo: ${key}.`,
    beforeClear: 'You can undo this with Ctrl/Cmd+Z until your next change.',
  };
}

/**
 * Where focus goes when the item `current` of `keys` (in display order) is removed: the items after
 * it, nearest first, then the ones before it, nearest first. The caller takes the first that is still there.
 */
export function neighbourOrder(keys: string[], current: string): string[] {
  const at = keys.indexOf(current);
  if (at < 0) return [];
  return [...keys.slice(at + 1), ...keys.slice(0, at).reverse()];
}
