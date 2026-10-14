import { expect, type Page } from '@playwright/test';

/*
 * The line of a load where every file simply loaded goes by itself after six seconds (`CLEAN_LOAD_MS`), and the page
 * under it moves up by its height. A test that measures where something is, or aims the mouse at it, must not have that
 * happen between two of its steps: on a busy machine six seconds pass at any step.
 */

/**
 * Takes the calm load line away before anything is measured, whether it is still there or has gone by itself. Its cross
 * is clicked in the page in one step: a click from the test could wait for a button that goes in the meantime.
 */
export async function dismissLoadLine(page: Page) {
  await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="load-status"] button[aria-label="Dismiss message"]')?.click());
  await expect(page.getByTestId('load-status')).toHaveCount(0);
}

/**
 * Keeps the calm load line for a test that measures with it on the screen: a finger resting on the screen holds it, as
 * the page holds it for a pointer that is down (the line then goes when the last one is lifted). Call it at once after
 * the load; the line must still be there.
 */
export async function keepLoadLine(page: Page) {
  await expect(page.getByTestId('load-status')).toBeVisible();
  await page.evaluate(() => void window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99, pointerType: 'touch', buttons: 1 })));
}
