import { useLayoutEffect, useRef, type RefObject } from 'react';
import { SKIP_TARGETS } from './SkipLinks';

/**
 * Where the focus goes when it was lost with the empty page: the first file row, or where the file list is not shown
 * (the closed drawer of a phone) the heading of the plots. Null when the focus is somewhere (it is left there).
 */
export function placeAfterFirstFiles(doc: Document = document): HTMLElement | null {
  const active = doc.activeElement;
  if (active !== null && active !== doc.body) return null;
  const row = doc.querySelector<HTMLElement>('.panel li [data-nav]');
  return row !== null && row.getClientRects().length > 0 ? row : doc.getElementById(SKIP_TARGETS.plots);
}

/**
 * Whether the browser shows the focus on `el`: it does for a control reached by the keyboard, and not for a button
 * that was clicked or tapped. A browser that does not know the selector counts as not showing it.
 */
export function showsFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/** The focus was on a control of the empty page, and shown there, when that page went away. */
let lostWithEmptyPage = false;

/**
 * For the empty page (`ref` is its box): notes, as it goes away, whether the focus is on one of its controls and is
 * shown there. A button pressed by the mouse or a finger has the focus too, but with no ring: its user is not
 * following the focus, and would not see where it was put (the next Space would untick a file out of nothing).
 */
export function useEmptyPageFocus(ref: RefObject<HTMLElement | null>): void {
  // A layout effect: its cleanup runs before the page's elements are taken out, while the focus is still on one of them.
  useLayoutEffect(
    () => () => {
      const active = document.activeElement;
      lostWithEmptyPage = active !== null && (ref.current?.contains(active) ?? false) && showsFocus(active);
    },
    [ref],
  );
}

/**
 * The first files arrive (`shown` goes from none to some). If they were asked for by the keyboard on the empty page
 * ("Load example", its "Open files"), that button is gone with the page and the focus with it, to the document's
 * body: the next Tab would start somewhere in the middle of the page. The focus is put on the first file row instead,
 * and shown there. Files that came another way (a click or a tap on those buttons, the toolbar, a drop) leave the
 * focus where it is.
 */
export function useFirstFilesFocus(shown: number): void {
  const before = useRef(shown);
  // A layout effect: after the page was changed and before it is painted, so no Tab can fall in between.
  useLayoutEffect(() => {
    const had = before.current;
    before.current = shown;
    const lost = lostWithEmptyPage;
    lostWithEmptyPage = false;
    // `focusVisible` asks for the ring where the browser would not draw one by itself (it is not in the DOM types yet).
    if (had === 0 && shown > 0 && lost) placeAfterFirstFiles()?.focus({ focusVisible: true } as FocusOptions);
  }, [shown]);
}
