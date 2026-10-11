import { useEffect, useRef } from 'react';
import { fileSetSwapCount, useStore } from '../state/store';

/**
 * Calls `onSwap` when the set of loaded files was replaced: a project opened, the session cleared, an undo that brings other files back
 * (not one that only restores names, tags or visibility).
 * Display-only state of a list (a filter text, folded groups) belongs to the old session and is reset there.
 */
export function useSessionSwap(onSwap: () => void): void {
  const latest = useRef(onSwap);
  useEffect(() => {
    latest.current = onSwap;
  });
  useEffect(() => {
    let seen = fileSetSwapCount();
    return useStore.subscribe(() => {
      if (fileSetSwapCount() === seen) return;
      seen = fileSetSwapCount();
      latest.current();
    });
  }, []);
}
