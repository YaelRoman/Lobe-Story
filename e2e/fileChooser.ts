import type { FileChooser, Page } from '@playwright/test';

/**
 * Collects the page's file choosers from now on; call it BEFORE `page.goto`. The returned function resolves with the
 * next chooser that was opened and not yet taken.
 *
 * Why not `page.waitForEvent('filechooser')` right before the key press: Chromium only reports a chooser to a listener
 * that was there since the page loaded. A listener added later (even 300 ms earlier) is ignored now and then when the
 * chooser is opened by the keyboard; the click still happens in the page (the app is fine), the native chooser is
 * dropped by headless Chromium and no event ever arrives. About one run in five failed that way, more under load.
 * Pointer clicks do not show it. A listener registered before the navigation never missed one in 40 runs.
 */
export function collectFileChoosers(page: Page): () => Promise<FileChooser> {
  const opened: FileChooser[] = [];
  let wake: (() => void) | undefined;
  page.on('filechooser', (chooser) => {
    opened.push(chooser);
    wake?.();
  });
  return async () => {
    while (opened.length === 0) await new Promise<void>((resolve) => (wake = resolve));
    return opened.shift()!;
  };
}
