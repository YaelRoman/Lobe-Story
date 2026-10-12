import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useStore } from '../state/store';
import { SKIP_TARGETS } from './SkipLinks';
import { isTextEntry, isUndoShortcut, undoWording } from './undoKeys';
import { MidName } from './MidName';
import { usePhoneLayout, useTouchOnly } from './phoneLayout';

/** How long the toast offering an undo stays; the undo itself stays available to Ctrl/Cmd+Z until a later edit withdraws it. */
export const UNDO_MS = 10_000;
/** The least time the offer stays after the pointer or the focus leaves it. */
const RESUME_MIN_MS = 3_000;

/**
 * What the offer is about. A file or group name in it stays on one line with the words before it and is cut in the
 * middle when the offer is narrow (its end, which tells files apart, stays whole; see `.undo-label`); words after
 * the name go to a second line when there is no room. The full text stays in the page.
 */
function OfferLabel({ label, name }: { label: string; name?: string }) {
  const at = name ? label.indexOf(name) : -1;
  if (!name || at < 0) return <span className="undo-label">{label}.</span>;
  const after = label.slice(at + name.length);
  return (
    <span className="undo-label named">
      <span className="undo-name">
        <span>{label.slice(0, at)}</span>
        <MidName text={name} />
        {after === '' && <span>.</span>}
      </span>
      {after !== '' && <span>{after}.</span>}
    </span>
  );
}

/** One offer; mounted anew for each (keyed by its id), so the timer and the pause state start fresh. */
function Offer({ label, name }: { label: string; name?: string }) {
  // A touch device has no Ctrl+Z: no button, note or tooltip names the key there. In a narrow layout the button is short (the room goes to the name).
  const words = undoWording({ keys: !useTouchOnly(), narrow: usePhoneLayout() });
  const undoLast = useStore((s) => s.undoLast);
  const fadeUndo = useStore((s) => s.fadeUndo);
  const setCopyNote = useStore((s) => s.setCopyNote);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(UNDO_MS);
  // Where the keyboard focus was before it entered the offer, to give it back when the offer is hidden by its cross.
  const cameFrom = useRef<HTMLElement | null>(null);
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

  // Both buttons remove the offer, and with it the button that has the focus: the focus goes back where it was before
  // it entered the offer (else to the plots' heading or the panel), not to the page, where the next Tab would start
  // from the top.
  const placeBefore = () => (cameFrom.current?.isConnected ? cameFrom.current : (document.getElementById(SKIP_TARGETS.plots) ?? document.querySelector<HTMLElement>('.panel')));
  // The cross says once, in the note that is both shown and announced, that the keyboard shortcut still undoes (where there is a keyboard).
  const hide = () => {
    const back = placeBefore();
    fadeUndo();
    back?.focus();
    setCopyNote(words.hidden);
  };
  // What is undone is back in the page before the place is looked for: the plots' heading is not there while no file
  // is loaded (an undone Clear brings it back).
  const undo = () => {
    flushSync(undoLast);
    placeBefore()?.focus();
  };

  return (
    <div
      className="undo-toast"
      data-testid="undo-toast"
      data-paused={paused || undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(e) => {
        const from = e.relatedTarget as HTMLElement | null;
        if (from && !e.currentTarget.contains(from)) cameFrom.current = from;
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
    >
      <OfferLabel label={label} name={name} />
      <button onClick={undo}>{words.button}</button>
      <button aria-label="Hide undo offer" title={words.hideTitle} onClick={hide}>
        ✕
      </button>
    </div>
  );
}

/**
 * The "Undo" offer for the last Remove / Delete group / Clear / Reset / project replace, and Ctrl/Cmd+Z.
 * It floats at the foot of the screen (see theme.css) and takes no room: nothing on the page moves when it comes or goes.
 * It is announced through the status region in StatusArea, not by itself.
 */
export function UndoToast() {
  const undo = useStore((s) => s.undo);
  useUndoShortcut();
  if (!undo?.shown) return null;
  return <Offer key={undo.id} label={undo.label} name={undo.name} />;
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
