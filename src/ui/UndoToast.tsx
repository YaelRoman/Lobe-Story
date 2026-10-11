import { useEffect } from 'react';
import { useStore } from '../state/store';

/** How long a destructive action stays undoable. */
export const UNDO_MS = 10_000;

const isTextField = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
};

/** The "Undo" bar for the last Remove / Delete group / Clear / project replace, and Ctrl/Cmd+Z. */
export function UndoToast() {
  const undo = useStore((s) => s.undo);
  const undoLast = useStore((s) => s.undoLast);
  const dismissUndo = useStore((s) => s.dismissUndo);
  const id = undo?.id;

  useEffect(() => {
    if (id === undefined) return;
    const timer = window.setTimeout(dismissUndo, UNDO_MS);
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
      if (isTextField(e.target) || useStore.getState().dialog) return;
      e.preventDefault();
      undoLast();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
    };
  }, [id, undoLast, dismissUndo]);

  if (!undo) return null;
  return (
    <div className="load-message undo-toast" role="status" data-testid="undo-toast">
      <span>{undo.label}.</span>
      <button onClick={undoLast}>Undo</button>
      <button aria-label="Dismiss undo" onClick={dismissUndo}>
        ✕
      </button>
    </div>
  );
}
