import { useEffect, useRef } from 'react';
import { GLOSSARY, METRICS_DOC_URL, PANEL_HELP, README_URL } from './glossary';

/** What a Help button hands over when clicked: its click event (the dialog gives the focus back to `currentTarget`). */
export type OpenHelp = (event: { currentTarget: EventTarget | null }) => void;

/**
 * Help and glossary as a native modal dialog: Esc closes it, Tab stays inside, and the focus goes
 * back to the control that opened it (restored here too, in case the browser does not).
 */
export function HelpDialog({ onClose, opener }: { onClose: () => void; opener: HTMLElement | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Listen for the user closing it (Esc); closing it from the cleanup (also run by React's development
    // double-mount) must not report back.
    const onNativeClose = () => {
      // A "close" event queued by an earlier programmatic close arrives late, when the dialog is already open again.
      if (!dialog.open) onCloseRef.current();
    };
    dialog.addEventListener('close', onNativeClose);
    if (!dialog.open) dialog.showModal();
    // The dialog itself, so it opens at its top (the title is read first) and Tab then reaches the links.
    dialog.focus({ preventScroll: true });
    dialog.scrollTop = 0;
    return () => {
      dialog.removeEventListener('close', onNativeClose);
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);

  return (
    <dialog
      ref={ref}
      className="help"
      tabIndex={-1}
      aria-labelledby="help-title"
      onClick={(e) => {
        // Only a click outside the dialog's box is a backdrop click: one in its padding, or the end of a text selection, is not.
        const r = e.currentTarget.getBoundingClientRect();
        const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        if (e.target === e.currentTarget && outside) onClose();
      }}
    >
      <h2 id="help-title">Help and glossary</h2>
      <p>
        Lobe-Story shows antenna radiation patterns (Planet files) and works out the usual beam, front/back, sidelobe and
        sector figures. These are the main terms in one line each.
      </p>
      <dl className="glossary">
        {GLOSSARY.map((g) => (
          <div key={g.term}>
            <dt>{g.term}</dt>
            <dd>{g.text}</dd>
          </div>
        ))}
      </dl>
      <p>{PANEL_HELP}</p>
      <p>
        Exact definitions of every column:{' '}
        <a href={METRICS_DOC_URL} target="_blank" rel="noopener noreferrer">
          metric definitions
        </a>
        . More about the tool:{' '}
        <a href={README_URL} target="_blank" rel="noopener noreferrer">
          README
        </a>
        .
      </p>
      <div className="dialog-actions">
        <button onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}

/** A small button that opens the Help dialog from a table or section; the dialog gives the focus back to it. */
export function DefinitionsButton({ onHelp }: { onHelp: OpenHelp }) {
  return (
    <button type="button" aria-haspopup="dialog" title="What the terms and columns mean" onClick={onHelp}>
      Definitions
    </button>
  );
}
