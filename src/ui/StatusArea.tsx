import { useEffect } from 'react';
import { useStore } from '../state/store';
import { pendingLabel } from '../state/project';
import { UndoToast } from './UndoToast';
import { undoShortcut } from './undoKeys';

/** How long the line of a load where every file simply loaded stays. */
export const CLEAN_LOAD_MS = 6_000;

/** Scrolls the panel's Errors section into view and moves focus to it. */
function showErrors() {
  // On a phone the panel is a closed drawer until the caller has opened it: wait for it to be shown.
  const section = document.querySelector<HTMLElement>('[data-testid="panel-errors"]');
  section?.scrollIntoView?.({ block: 'start' });
  section?.focus();
}

/**
 * The bars under the toolbar: the load status line, the undo offer and the files a project still
 * needs. Screen readers hear about all three through ONE status region that is always in the
 * page and starts empty — a region that is inserted together with its text is often not announced.
 */
export function StatusArea({ hasErrors, beforeShowErrors }: { hasErrors: boolean; beforeShowErrors?: () => void }) {
  const loadMessage = useStore((s) => s.loadMessage);
  const loadTone = useStore((s) => s.loadTone);
  const loadFailed = useStore((s) => s.loadFailed);
  const setLoadMessage = useStore((s) => s.setLoadMessage);
  const undoLabel = useStore((s) => s.undo?.label);
  const pendingFiles = useStore((s) => s.pendingFiles);
  const dismissPending = useStore((s) => s.dismissPending);
  const pending = pendingFiles.length > 0 ? pendingLabel(pendingFiles) : null;

  // "Loaded 12 files" needs no action: it goes away by itself. Anything that failed, was skipped or renamed stays.
  useEffect(() => {
    if (!loadMessage || loadTone !== 'info') return;
    const timer = window.setTimeout(() => setLoadMessage(null), CLEAN_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, [loadMessage, loadTone, setLoadMessage]);

  return (
    <>
      {loadMessage && (
        <div className={loadTone === 'info' ? 'load-message info' : 'load-message'} data-testid="load-status">
          <span>{loadMessage}</span>
          {loadFailed > 0 && hasErrors && <button
              onClick={() => {
                beforeShowErrors?.();
                requestAnimationFrame(showErrors);
              }}
            >Show errors</button>}
          <button aria-label="Dismiss message" onClick={() => setLoadMessage(null)}>
            ✕
          </button>
        </div>
      )}
      <UndoToast />
      {pending && (
        <div className="load-message" data-testid="pending-files">
          <span>{pending}</span>
          <button onClick={dismissPending}>Dismiss</button>
        </div>
      )}
      <div className="visually-hidden" role="status" aria-atomic="false" data-testid="announcer">
        {loadMessage && <span>{loadMessage} </span>}
        {undoLabel && (
          <span>
            {undoLabel}. Undo: {undoShortcut()}.{' '}
          </span>
        )}
        {pending && <span>{pending}</span>}
      </div>
    </>
  );
}
