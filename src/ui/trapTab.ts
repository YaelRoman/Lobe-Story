import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [href], select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab and Shift+Tab inside the element whose `onKeyDown` this is: from the last control the focus wraps to the
 * first and back, never resting on the page body or on what lies behind the dialog.
 */
export function trapTab(e: ReactKeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Tab') return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const at = document.activeElement;
  // The container itself (focused by a click on its text) is not one of the items: it wraps too.
  const outside = at === e.currentTarget || !e.currentTarget.contains(at);
  if (e.shiftKey && (at === first || outside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (at === last || outside)) {
    e.preventDefault();
    first.focus();
  }
}
