import { useSyncExternalStore } from 'react';

/** The width up to which the stylesheet lays the page out for a phone (one column, touch-sized targets; see theme.css). */
export const PHONE_QUERY = '(max-width: 760px)';

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
