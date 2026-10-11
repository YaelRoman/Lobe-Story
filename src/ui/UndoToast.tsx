import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { isTextEntry, isUndoShortcut, undoShortcut } from './undoKeys';

/** How long a destructive action stays undoable. */
export const UNDO_MS = 10_000;
/** The least time the offer stays after the pointer or the focus leaves it. */
const RESUME_MIN_MS = 3_000;

/** One offer; mounted anew for each (keyed by its id), so the timer and the pause state start fresh. */
function Offer({ label }: { label: string }) {
  const undoLast = useStore((s) => s.undoLast);
  const dismissUndo = useStore((s) => s.dismissUndo);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(UNDO_MS);
  const paused = hovered || focused;

  // The countdown stops while the pointer or the keyboard focus is on the bar.
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(dismissUndo, remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(RESUME_MIN_MS, remaining.current - (Date.now() - started));
    };
  }, [paused, dismissUndo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isUndoShortcut(e)) return;
      if (isTextEntry(e.target as HTMLElement | null) || useStore.getState().dialog) return;
      e.preventDefault();
      undoLast();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [undoLast]);

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
      <button aria-label="Dismiss undo" onClick={dismissUndo}>
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
  if (!undo) return null;
  return <Offer key={undo.id} label={undo.label} />;
}
