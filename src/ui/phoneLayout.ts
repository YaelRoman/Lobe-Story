import { useSyncExternalStore } from 'react';

/** The width up to which the stylesheet lays the page out for a phone (one column, touch-sized targets; see theme.css). */
export const PHONE_QUERY = '(max-width: 760px)';

const query = (): MediaQueryList | null => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null);

/** Whether the page is laid out for a phone right now. */
export const isPhoneLayout = (): boolean => query()?.matches ?? false;

function subscribe(onChange: () => void): () => void {
  const list = query();
  list?.addEventListener('change', onChange);
  return () => list?.removeEventListener('change', onChange);
}

/** Whether the page is laid out for a phone; re-renders when the window crosses that width. */
export const usePhoneLayout = (): boolean => useSyncExternalStore(subscribe, isPhoneLayout, () => false);
