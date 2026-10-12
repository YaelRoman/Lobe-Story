import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useStore } from '../state/store';
import { SKIP_TARGETS } from './SkipLinks';
import { isTextEntry, isUndoShortcut, undoWording } from './undoKeys';
import { splitTail } from './legend';
import { fittingHead } from './midFit';
import { usePhoneLayout, useTouchOnly } from './phoneLayout';

/** How long the toast offering an undo stays; the undo itself stays available to Ctrl/Cmd+Z until a later edit withdraws it. */
export const UNDO_MS = 10_000;
/** The least time the offer stays after the pointer or the focus leaves it. */
const RESUME_MIN_MS = 3_000;

/**
 * A file or group name with the words before it, on one line, cut in the middle when the offer is narrow: its end,
 * which tells files apart, stays whole and its start gives way. The cut is measured, not left to the stylesheet's
 * ellipsis (that leaves a gap of up to a character before the end of the name, which reads as a space in it), and
 * it is drawn, not written: the part that is cut stays in the page without a size and the ellipsis is the
 * stylesheet's (see `.undo-name`), so the text of the offer is the whole name, in one piece, for a copy and for a
 * screen reader.
 */
function FittedName({ before, name, end }: { before: string; name: string; end: string }) {
  const { head, tail } = splitTail(name, 11);
  const box = useRef<HTMLSpanElement>(null);
  const start = useRef<HTMLSpanElement>(null);
  // How many characters of the head are shown; null: all of them, and whether they fit is measured next (a new
  // object each time it is asked for, so that it is measured again also when the answer was "all" before).
  const [fit, setFit] = useState<{ kept: number | null }>({ kept: null });
  const { kept } = fit;

  useLayoutEffect(() => {
    const line = box.current;
    const shown = start.current;
    if (!line || !shown || fit.kept !== null) return;
    // Whole pixels, the content's rounded: a pixel is taken off the room below for it.
    const over = line.scrollWidth - line.clientWidth;
    if (over <= 0) return;
    // Measured in the line itself (its font), out of the flow and not shown.
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    line.appendChild(probe);
    const widthOf = (text: string) => {
      probe.textContent = text;
      return probe.getBoundingClientRect().width;
    };
    const room = shown.getBoundingClientRect().width - over - 1;
    setFit({ kept: fittingHead(head, room, widthOf) });
    probe.remove();
  }, [fit, head]);

  // The room changes with the window: measured again from the whole name.
  useEffect(() => {
    const again = () => setFit({ kept: null });
    window.addEventListener('resize', again);
    return () => window.removeEventListener('resize', again);
  }, []);

  const cut = kept !== null && kept < head.length;
  return (
    <span className="undo-name" ref={box}>
      {before}
      <span className={cut ? 'mid-head cut' : 'mid-head'} ref={start}>
        {cut ? (
          <>
            <span>{head.slice(0, kept)}</span>
            <span className="mid-rest">{head.slice(kept)}</span>
          </>
        ) : (
          head
        )}
      </span>
      {tail && <span className="mid-tail">{tail}</span>}
      {end}
    </span>
  );
}

/**
 * What the offer is about. A file or group name in it stays on one line with the words before it and is cut in the
 * middle when the offer is narrow (see `FittedName`); words after the name go to a second line, as a whole, when
 * there is no room. The full text stays in the page.
 */
function OfferLabel({ label, name }: { label: string; name?: string }) {
  const at = name ? label.indexOf(name) : -1;
  if (!name || at < 0) return <span className="undo-label">{label}.</span>;
  const after = label.slice(at + name.length);
  const words = after.trimStart();
  return (
    <span className="undo-label named">
      <FittedName before={label.slice(0, at)} name={name} end={after === '' ? '.' : ''} />
      {after !== '' && (
        <>
          {after.slice(0, after.length - words.length)}
          <span className="undo-after">{words}.</span>
        </>
      )}
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
