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

/** The focus was on a control of the empty page when that page went away. */
let lostWithEmptyPage = false;

/** For the empty page (`ref` is its box): notes, as it goes away, whether the focus is on one of its controls. */
export function useEmptyPageFocus(ref: RefObject<HTMLElement | null>): void {
  // A layout effect: its cleanup runs before the page's elements are taken out, while the focus is still on one of them.
  useLayoutEffect(
    () => () => {
      lostWithEmptyPage = ref.current?.contains(document.activeElement) ?? false;
    },
    [ref],
  );
}

/**
 * The first files arrive (`shown` goes from none to some). If they were asked for on the empty page ("Load example",
 * its "Open files"), that button is gone with the page and the focus with it, to the document's body: the next Tab
 * would start somewhere in the middle of the page. The focus is put on the first file row instead. Files that came
 * another way (the toolbar, a drop) leave the focus where it is.
 */
export function useFirstFilesFocus(shown: number): void {
  const before = useRef(shown);
  // A layout effect: after the page was changed and before it is painted, so no Tab can fall in between.
  useLayoutEffect(() => {
    const had = before.current;
    before.current = shown;
    const lost = lostWithEmptyPage;
    lostWithEmptyPage = false;
    if (had === 0 && shown > 0 && lost) placeAfterFirstFiles()?.focus();
  }, [shown]);
}
