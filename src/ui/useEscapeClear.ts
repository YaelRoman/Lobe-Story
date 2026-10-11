import { useEffect } from 'react';
import { useStore } from '../state/store';
import { isTextEntry } from './undoKeys';

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

/** Esc anywhere on the page (outside editors, menus and dialogs) clears the highlighted file or group. */
export function useEscapeClear(): void {
  useEffect(() => {
    // Capture phase: runs before the menus' own Esc handlers close the menu and make it look "not open".
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const clear = escapeClearsHighlight({
        key: e.key,
        defaultPrevented: e.defaultPrevented,
        inOwnWidget: isTextEntry(target) || !!target?.closest?.(OWN_WIDGET),
        overlayOpen: useStore.getState().dialog !== null || !!document.querySelector('dialog[open], [role="dialog"], details.menu[open]'),
      });
      if (clear) useStore.getState().clearHighlight();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
}
