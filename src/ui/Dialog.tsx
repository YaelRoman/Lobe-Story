import { useEffect, useState } from 'react';
import { useStore, type DialogState } from '../state/store';
import { cancelDialog, settleDialog, validateDialogInput } from './dialogs';
import { trapTab } from './trapTab';

function DialogBody({ dialog }: { dialog: NonNullable<DialogState> }) {
  const [text, setText] = useState(dialog.kind === 'prompt' ? dialog.initial : '');
  const [includeFiles, setIncludeFiles] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelDialog();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const error = dialog.kind === 'prompt' ? validateDialogInput(text) : null;
  const title = dialog.kind === 'save-project' ? 'Save project' : dialog.message;
  const confirmLabel = dialog.kind === 'save-project' ? 'Save' : dialog.kind === 'choice' ? '' : dialog.confirmLabel;

  const confirm = () => {
    if (dialog.kind === 'choice') return;
    if (dialog.kind === 'confirm') settleDialog(true);
    else if (dialog.kind === 'save-project') settleDialog({ includeFiles });
    else if (error === null) settleDialog(text);
  };

  return (
    <div className="dialog-backdrop" onClick={cancelDialog}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
      >
        <p>{title}</p>
        {dialog.kind === 'prompt' && dialog.hint && (
          <p className="count" id="dialog-hint">
            {dialog.hint}
          </p>
        )}
        {dialog.kind === 'prompt' && (
          <>
            <input
              type="text"
              autoFocus
              aria-label={dialog.message}
              aria-describedby={dialog.hint ? 'dialog-hint' : undefined}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {error && (
              <p className="reason" role="alert">
                {error}
              </p>
            )}
          </>
        )}
        {dialog.kind === 'save-project' && (
          <label>
            <input type="checkbox" checked={includeFiles} onChange={(e) => setIncludeFiles(e.target.checked)} />
            Include pattern files
          </label>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={cancelDialog}>
            Cancel
          </button>
          {dialog.kind === 'choice' ? (
            dialog.choices.map((c, i) => (
              <button key={c.value} type="button" autoFocus={i === 0} onClick={() => settleDialog(c.value)}>
                {c.label}
              </button>
            ))
          ) : (
            <button type="submit" autoFocus={dialog.kind !== 'prompt'} disabled={error !== null}>
              {confirmLabel}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** Renders the open in-page dialog, if any. */
export function Dialog() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  return <DialogBody key={JSON.stringify(dialog)} dialog={dialog} />;
}
