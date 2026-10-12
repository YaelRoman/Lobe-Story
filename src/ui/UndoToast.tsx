import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { isTextEntry, isUndoShortcut, undoShortcut } from './undoKeys';

/** How long the toast offering an undo stays; the undo itself stays available to Ctrl/Cmd+Z until a later edit withdraws it. */
export const UNDO_MS = 10_000;
/** The least time the offer stays after the pointer or the focus leaves it. */
const RESUME_MIN_MS = 3_000;

/** One offer; mounted anew for each (keyed by its id), so the timer and the pause state start fresh. */
function Offer({ label }: { label: string }) {
  const undoLast = useStore((s) => s.undoLast);
  const fadeUndo = useStore((s) => s.fadeUndo);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(UNDO_MS);
  const paused = hovered || focused;

  // The countdown stops while the pointer or the keyboard focus is on the bar.
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(fadeUndo, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(RESUME_MIN_MS, remaining.current - (Date.now() - started));
    };
  }, [paused, fadeUndo]);

  return (
    <div
      className="load-message undo-toast"
      data-testid="undo-toast"
      data-paused={paused || undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <span>{label}.</span>
      <button onClick={undoLast}>Undo · {undoShortcut()}</button>
      <button aria-label="Hide undo offer" title="Hide (Ctrl/Cmd+Z still undoes)" onClick={fadeUndo}>
        ✕
      </button>
    </div>
  );
}

/**
 * The "Undo" bar for the last Remove / Delete group / Clear / project replace, and Ctrl/Cmd+Z.
 * It is announced through the status region in StatusArea, not by itself.
 */
export function UndoToast() {
  const undo = useStore((s) => s.undo);
  useUndoShortcut();
  if (!undo?.shown) return null;
  return <Offer key={undo.id} label={undo.label} />;
}

/** What Ctrl/Cmd+Z announces when there is nothing to take back. */
export const NOTHING_TO_UNDO = 'Nothing to undo';

/**
 * Ctrl/Cmd+Z outside a text field and a dialog (the store's, the Help dialog, the Settings panel) takes back the last destructive action while its snapshot is kept
 * (also after the toast has faded), or says there is nothing to undo.
 */
function useUndoShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isUndoShortcut(e)) return;
      const state = useStore.getState();
      const target = e.target as HTMLElement | null;
      if (isTextEntry(target) || state.dialog || target?.closest?.('dialog[open], [role="dialog"]')) return;
      e.preventDefault();
      if (state.undo) state.undoLast();
      else state.setCopyNote(NOTHING_TO_UNDO);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
