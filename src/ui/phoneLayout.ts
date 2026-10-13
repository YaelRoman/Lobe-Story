import { useSyncExternalStore } from 'react';

/** The width up to which the stylesheet lays the page out for a phone (one column of plots, the copy pill, short wording; see theme.css). */
export const PHONE_QUERY = '(max-width: 760px)';

/**
 * The width up to which the file panel is a drawer above the page instead of a column beside it: a phone, a tablet
 * upright, a narrow window. The stylesheet's business; the code asks only whether the panel is shown.
 */
export const DRAWER_QUERY = '(max-width: 900px)';

/**
 * A short window with the file panel as a drawer: a phone or a tablet on its side, or a laptop window at 200 % zoom. The page scrolls
 * as a whole there (the toolbar and the Files bar go with it, the status line stays), see theme.css.
 */
export const SHORT_QUERY = '(max-height: 600px) and (max-width: 900px)';

/**
 * A device used by touch alone: its primary pointer is coarse and cannot hover. No keyboard is likely there, whatever
 * the width (a tablet, a phone on its side), and a narrow window on a desktop is not one. What the page says about
 * keys goes by this; how it is laid out goes by `PHONE_QUERY`.
 */
export const TOUCH_ONLY_QUERY = '(hover: none) and (pointer: coarse)';

/**
 * The primary pointer is a finger. The plots give up their drag there, so that a swipe starting on one scrolls the page
 * (see `touchLayout`), and the stylesheet makes the targets larger, whatever the width.
 */
export const COARSE_QUERY = '(pointer: coarse)';

/** A media query asked now, and as a hook that re-renders when its answer changes. Where the browser cannot say, the answer is no. */
function media(text: string): { is: () => boolean; use: () => boolean } {
  const query = (): MediaQueryList | null => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(text) : null);
  const is = (): boolean => query()?.matches ?? false;
  const subscribe = (onChange: () => void): (() => void) => {
    const list = query();
    list?.addEventListener('change', onChange);
    return () => list?.removeEventListener('change', onChange);
  };
  return { is, use: () => useSyncExternalStore(subscribe, is, () => false) };
}

const phone = media(PHONE_QUERY);
const touchOnly = media(TOUCH_ONLY_QUERY);
const coarse = media(COARSE_QUERY);
const short = media(SHORT_QUERY);

/** Whether the page is laid out for a phone right now. */
export const isPhoneLayout = phone.is;

/** Whether the page is laid out for a phone; re-renders when the window crosses that width. */
export const usePhoneLayout = phone.use;

/** Whether the device is used by touch alone right now (see `TOUCH_ONLY_QUERY`). */
export const isTouchOnly = touchOnly.is;

/** Whether the device is used by touch alone; re-renders when that changes (a mouse or a keyboard is attached). */
export const useTouchOnly = touchOnly.use;

/** Whether the primary pointer is a finger (see `COARSE_QUERY`); re-renders when that changes. */
export const useCoarsePointer = coarse.use;

/** Whether the page scrolls as a whole right now (see `SHORT_QUERY`). */
export const isShortWindow = short.is;
