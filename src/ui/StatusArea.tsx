import { useEffect } from 'react';
import { useStore } from '../state/store';
import { pendingLabel } from '../state/project';
import { UndoToast } from './UndoToast';
import { undoShortcut } from './undoKeys';
import { useAnnouncement } from './announce';

/** How long the line of a load where every file simply loaded stays. */
export const CLEAN_LOAD_MS = 6_000;

/** Scrolls the panel's Errors section into view and moves focus to it. */
function showErrors() {
  const section = document.querySelector<HTMLElement>('[data-testid="panel-errors"]');
  section?.scrollIntoView?.({ block: 'start' });
  section?.focus();
}

/**
 * The bars under the toolbar (the load status line and the files a project still needs) and the undo
 * offer, which floats at the foot of the screen: it comes and goes with a click or a slider step, and
 * a bar in the flow would move the page under the pointer that made it. Screen readers hear about all
 * three through ONE status region that is always in the page and starts empty — a region that is
 * inserted together with its text is often not announced.
 */
export function StatusArea({ hasErrors, beforeShowErrors }: { hasErrors: boolean; beforeShowErrors?: () => void }) {
  const loadMessage = useStore((s) => s.loadMessage);
  const loadTone = useStore((s) => s.loadTone);
  const loadFailed = useStore((s) => s.loadFailed);
  const loadSeq = useStore((s) => s.loadSeq);
  const copyNote = useStore((s) => s.copyNote);
  const copySeq = useStore((s) => s.copySeq);
  const setLoadMessage = useStore((s) => s.setLoadMessage);
  const setCopyNote = useStore((s) => s.setCopyNote);
  const undoId = useStore((s) => s.undo?.id);
  const undoLabel = useStore((s) => (s.undo?.shown ? s.undo.label : undefined));
  const pendingFiles = useStore((s) => s.pendingFiles);
  const dismissPending = useStore((s) => s.dismissPending);
  const pending = pendingFiles.length > 0 ? pendingLabel(pendingFiles) : null;
  // A line that is only read out (see `announce`): the change it reports is already visible where it was made.
  const spoken = useAnnouncement();

  // "Loaded 12 files" needs no action: it goes away by itself. Anything that failed, was skipped or renamed stays.
  // The line is in the flow, so the page moves up when it goes: not while a pointer is down (a slider dragged in the
  // first seconds after a load would jump from under the pointer). It then goes at the release, after the click that ends.
  useEffect(() => {
    if (!loadMessage || loadTone !== 'info') return;
    let down = false;
    let due = false;
    let afterRelease = 0;
    const remove = () => setLoadMessage(null);
    const onDown = () => {
      down = true;
    };
    const onUp = () => {
      down = false;
      if (due) afterRelease = window.setTimeout(remove, 0);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    const timer = window.setTimeout(() => {
      due = true;
      if (!down) remove();
    }, CLEAN_LOAD_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(afterRelease);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [loadMessage, loadTone, loadSeq, setLoadMessage]);

  // A copy note is for the moment of the copy: the next status line or undo offer replaces it (it never stacks above them).
  useEffect(() => {
    if (loadMessage) setCopyNote(null);
  }, [loadSeq, loadMessage, setCopyNote]);
  useEffect(() => {
    if (undoId !== undefined) setCopyNote(null);
  }, [undoId, setCopyNote]);

  return (
    <div className="status-area">
      {loadMessage && (
        <div className={loadTone === 'info' ? 'load-message info' : 'load-message'} data-testid="load-status">
          <span>{loadMessage}</span>
          {loadFailed > 0 && hasErrors && (
            <button
              onClick={() => {
                beforeShowErrors?.();
                // On a phone the panel is a closed drawer until beforeShowErrors has opened it: wait for it to be shown.
                requestAnimationFrame(showErrors);
              }}
            >
              Show errors
            </button>
          )}
          <button aria-label="Dismiss message" onClick={() => setLoadMessage(null)}>
            ✕
          </button>
        </div>
      )}
      {copyNote && (
        <div className="copy-toast" data-testid="copy-note">
          {copyNote}
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
        {/* Keyed by the message count: an identical message is a new node and is read again. */}
        {loadMessage && <span key={loadSeq}>{loadMessage} </span>}
        {copyNote && <span key={`copy-${copySeq}`}>{copyNote} </span>}
        {spoken && <span key={`say-${spoken.seq}`}>{spoken.text} </span>}
        {undoLabel && (
          <span>
            {undoLabel}. Undo: {undoShortcut()}.{' '}
          </span>
        )}
        {pending && <span>{pending}</span>}
      </div>
    </div>
  );
}
