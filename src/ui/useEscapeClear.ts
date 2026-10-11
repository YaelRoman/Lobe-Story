import { useEffect } from 'react';
import { useStore } from '../state/store';
import { isTextEntry } from './undoKeys';
import { setHoverId } from './hoverPreview';

/** What `escapeClearsHighlight` needs to know about a key press (so it can be tested without a DOM). */
export interface EscapeContext {
  key: string;
  defaultPrevented: boolean;
  /** The press is in a text field, or inside a form, menu or dialog that closes itself on Esc. */
  inOwnWidget: boolean;
  /** A dialog, the settings panel or a menu is open: Esc belongs to it. */
  overlayOpen: boolean;
}

/** Esc clears the highlight only when nothing else is going to use that key press. */
export function escapeClearsHighlight(c: EscapeContext): boolean {
  return c.key === 'Escape' && !c.defaultPrevented && !c.inOwnWidget && !c.overlayOpen;
}

const OWN_WIDGET = 'form, dialog, [role="dialog"], [role="menu"], details[open]';

/**
 * Esc clears the highlight and ends a hover or focus preview (it starts again at the next focus move). It listens
 * in the capture phase: it runs before the menus' own Esc handlers close the menu and make it look "not open".
 */
export function onEscapeKey(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null;
  const clear = escapeClearsHighlight({
    key: e.key,
    defaultPrevented: e.defaultPrevented,
    inOwnWidget: isTextEntry(target) || !!target?.closest?.(OWN_WIDGET),
    overlayOpen: useStore.getState().dialog !== null || !!document.querySelector('dialog[open], [role="dialog"], details.menu[open]'),
  });
  if (!clear) return;
  useStore.getState().clearHighlight();
  setHoverId(null);
}

/** Esc anywhere on the page (outside editors, menus and dialogs) clears the highlighted file or group and the preview. */
export function useEscapeClear(): void {
  useEffect(() => {
    document.addEventListener('keydown', onEscapeKey, true);
    return () => document.removeEventListener('keydown', onEscapeKey, true);
  }, []);
}
