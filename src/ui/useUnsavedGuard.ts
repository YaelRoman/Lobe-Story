import { useEffect } from 'react';
import { useStore } from '../state/store';
import { isDirty } from '../state/undo';

/** Asks the browser to confirm closing or reloading the tab while there is unsaved work. */
export function useUnsavedGuard(): void {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty(useStore.getState())) return;
      e.preventDefault();
      e.returnValue = ''; // legacy browsers need a value to show the prompt
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}
