import type { Page } from '@playwright/test';

/**
 * Whether a user sees where the focus is: the focused element is one the browser shows the focus on, its box lies on the
 * screen with a real size (not a 1 px visually hidden element), and its ring is drawn: the pixels around it differ with
 * and without the focus. The focus is put back as it was.
 */
export async function focusSeen(page: Page): Promise<boolean> {
  const box = await page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body || !el.matches(':focus-visible')) return null;
    const r = el.getBoundingClientRect();
    const onScreen = r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight;
    return onScreen && r.width >= 8 && r.height >= 8 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
  });
  if (box === null) return false;
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const x = Math.max(0, Math.floor(box.x) - 4);
  const y = Math.max(0, Math.floor(box.y) - 4);
  const clip = { x, y, width: Math.min(viewport.width, Math.ceil(box.x + box.width) + 4) - x, height: Math.min(viewport.height, Math.ceil(box.y + box.height) + 4) - y };
  const focused = await page.screenshot({ clip, animations: 'disabled' });
  await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    (window as unknown as { __focusSeen: HTMLElement }).__focusSeen = el;
    el.blur();
  });
  const blurred = await page.screenshot({ clip, animations: 'disabled' });
  await page.evaluate(() => (window as unknown as { __focusSeen: HTMLElement }).__focusSeen.focus({ focusVisible: true } as FocusOptions));
  return !focused.equals(blurred);
}
