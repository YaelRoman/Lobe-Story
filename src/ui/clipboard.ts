/** The text copied with a hidden textarea and `document.execCommand('copy')`: for pages without the async Clipboard API (not a secure context, older browsers). */
function copyWithTextarea(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.tabIndex = -1;
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    active?.focus({ preventScroll: true });
  }
}

/** Puts `text` on the clipboard: the async Clipboard API when there is one, else the textarea fallback. Resolves to whether it worked; never rejects. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or no focus: try the fallback.
  }
  return typeof document !== 'undefined' && copyWithTextarea(text);
}

/** "Copied 65.0": says which value, so a second copy of another value reads differently. */
export const copiedValue = (text: string): string => `Copied ${text}`;

/** "Copied row a.msi". */
export const copiedRow = (name: string): string => `Copied row ${name}`;

/** "Copied 24 rows" / "Copied 1 row". */
export const copiedRows = (n: number): string => `Copied ${n} row${n === 1 ? '' : 's'}`;

/** Copies `text` and says so (or that it failed) in the status line. */
export async function copyAndAnnounce(
  text: string,
  success: string,
  announce: (message: string) => void,
): Promise<void> {
  const ok = await copyText(text);
  announce(ok ? success : 'Could not copy to the clipboard');
}
