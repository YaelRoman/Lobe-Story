import { useEffect, useRef } from 'react';
import { sessionSwapCount, useStore } from '../state/store';

/**
 * Calls `onSwap` when a whole session was put on screen: a project opened, an undo applied, the session cleared.
 * Display-only state of a list (a filter text, folded groups) belongs to the old session and is reset there.
 */
export function useSessionSwap(onSwap: () => void): void {
  const latest = useRef(onSwap);
  useEffect(() => {
    latest.current = onSwap;
  });
  useEffect(() => {
    let seen = sessionSwapCount();
    return useStore.subscribe(() => {
      if (sessionSwapCount() === seen) return;
      seen = sessionSwapCount();
      latest.current();
    });
  }, []);
}
