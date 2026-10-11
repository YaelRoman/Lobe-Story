import { useStore, type DialogState } from '../state/store';

// The open dialog's promise resolver lives here (not in the store: functions are not state).
let pending: { resolve: (value: unknown) => void; cancelValue: unknown } | null = null;
let currentValidate: ((text: string) => string | null) | undefined;
// The element that had the focus when the dialog opened: it gets the focus back when the dialog closes.
let opener: HTMLElement | null = null;

const focusedElement = (): HTMLElement | null =>
  typeof document !== 'undefined' && document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement
    : null;

function open<T>(dialog: NonNullable<DialogState>, cancelValue: T, validate?: (text: string) => string | null): Promise<T> {
  // Only one dialog at a time: a new one cancels the previous.
  if (pending) pending.resolve(pending.cancelValue);
  else opener = focusedElement();
  currentValidate = validate;
  return new Promise<T>((resolve) => {
    pending = { resolve: resolve as (value: unknown) => void, cancelValue };
    useStore.getState().openDialog(dialog);
  });
}

export function confirmDialog(message: string, confirmLabel = 'OK'): Promise<boolean> {
  return open({ kind: 'confirm', message, confirmLabel }, false);
}

/** Several named outcomes plus Cancel: resolves with the chosen value, or null when cancelled. */
export function choiceDialog(message: string, choices: { value: string; label: string }[]): Promise<string | null> {
  return open<string | null>({ kind: 'choice', message, choices }, null);
}

export function promptDialog(
  message: string,
  initial = '',
  validate?: (text: string) => string | null,
): Promise<string | null> {
  return open<string | null>({ kind: 'prompt', message, initial, confirmLabel: 'OK' }, null, validate);
}

export function saveProjectDialog(): Promise<{ includeFiles: boolean } | null> {
  return open<{ includeFiles: boolean } | null>({ kind: 'save-project' }, null);
}

/** Closes the dialog and resolves its promise with `value`. */
export function settleDialog(value: unknown): void {
  const p = pending;
  pending = null;
  currentValidate = undefined;
  useStore.getState().closeDialog();
  // Focus goes back before the answer is acted on, so an action that moves the focus itself still wins.
  const back = opener;
  opener = null;
  if (back?.isConnected) back.focus();
  p?.resolve(value);
}

/** Closes the dialog as cancelled (false for confirms, null for prompts and save). */
export function cancelDialog(): void {
  settleDialog(pending ? pending.cancelValue : null);
}

/** The error for the open prompt's current text, or null when it is acceptable. */
export function validateDialogInput(text: string): string | null {
  return currentValidate ? currentValidate(text) : null;
}
