import { expect, type Page } from '@playwright/test';
import { planetText, points } from '../src/test/planetText';
import { dismissLoadLine } from './loadLine';
import { openSimulation } from './simulationBar';

export const WAITING = 'The plots and the table follow when the slider stops.';
export const MECHANICAL = 'Mechanical tilt (°)';

/** `count` synthetic files, each its own beam: more ticked files than the page follows a slider drag with. */
export const manyFiles = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    name: `syn_${1700 + 10 * i}.msi`,
    mimeType: 'text/plain',
    buffer: Buffer.from(
      planetText({
        headers: ['NAME SYN', `FREQUENCY ${1700 + 10 * i}`, 'GAIN 15 dBi', 'TILT ELECTRICAL'],
        h: points((a) => Math.min(40, 3 * (a / (28 + 0.2 * i)) ** 2)),
        v: points((a) => Math.min(40, 3 * ((a - 2 - (i % 5)) / (3.5 + 0.02 * i)) ** 2)),
      }),
    ),
  }));

/**
 * Loads `count` synthetic files, ticks them all and opens the Simulation bar. The load line is taken away: it goes by
 * itself after a while, and the page would move under a slider that is being measured or dragged.
 */
export async function loadMany(page: Page, count: number, viewport = { width: 1440, height: 900 }) {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(manyFiles(count));
  await expect(page.locator('.panel li')).toHaveCount(count);
  // On a phone the panel is a drawer: opened for the button, and closed again.
  const drawer = page.locator('.files-toggle');
  const phone = await drawer.isVisible();
  if (phone) await drawer.click();
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  if (phone) await drawer.click();
  await openSimulation(page);
  await settled(page);
  await dismissLoadLine(page);
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

/**
 * The page has caught up with the sliders: the table's line names their values (it is made in the same render as the
 * plots' figures; none while both tilts are zero), and no hint is left, also a frame later.
 */
export async function settled(page: Page) {
  await expect(async () => {
    const [electrical, mechanical] = await Promise.all(['Electrical tilt Δ (°)', MECHANICAL].map(async (name) => Number(await page.getByRole('slider', { name, exact: true }).inputValue())));
    const line = page.locator('p.count', { hasText: 'Simulated:' });
    if (electrical === 0 && mechanical === 0) await expect(line).toHaveCount(0, { timeout: 100 });
    else await expect(line).toContainText(`Simulated: Δe ${signed(electrical)}°, mech ${signed(mechanical)}°`, { timeout: 100 });
  }).toPass();
  await expect(page.getByTestId('updating-2d')).toHaveCount(0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByTestId('updating-2d')).toHaveCount(0);
}

interface Hand {
  timer: number;
  set: (value: number) => void;
}
type WithHand = { lobeHand?: Hand };

/**
 * The hand keeps moving on a gripped slider: the slider is stepped to and fro by a timer of the page itself. A slider
 * that stands still for half a second is followed, and under load one call from a test can take longer than that; a
 * timer in the page is due before the page's own pause, so the slider stays waited for however slow the machine is.
 */
export const keepMoving = (page: Page, name: string) =>
  page.evaluate((label) => {
    const slider = document.querySelector<HTMLInputElement>(`input[type="range"][aria-label="${label}"]`)!;
    const set = (value: number) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, String(value));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const from = Number(slider.value);
    const step = Number(slider.step) || 1;
    let turn = 0;
    (window as WithHand).lobeHand = { set, timer: window.setInterval(() => set(from - (turn++ % 2) * step), 100) };
  }, name);

/** The hand stops on `value`; the slider is still gripped. */
export const stopOn = (page: Page, value: number) =>
  page.evaluate((v) => {
    const hand = (window as WithHand).lobeHand!;
    window.clearInterval(hand.timer);
    hand.set(v);
  }, value);

/**
 * The hand stops on `value` and, in the same task (the page cannot have followed in between), the button is clicked:
 * the one with this text, or a chart's toolbar button whose title starts with it, inside `within`.
 */
export const stopAndClick = (page: Page, value: number, within: string, button: string) =>
  page.evaluate(
    ([v, selector, text]) => {
      const hand = (window as WithHand).lobeHand!;
      window.clearInterval(hand.timer);
      hand.set(v as number);
      const all = Array.from(document.querySelector(selector as string)!.querySelectorAll<HTMLElement>('button, .modebar-btn'));
      all.find((b) => b.textContent?.trim() === text || b.getAttribute('data-title')?.startsWith(text as string))!.click();
    },
    [value, within, button] as const,
  );

/**
 * Presses a slider with the mouse and drags it a little to the right; the button stays down and the hand keeps moving
 * (see `keepMoving`) until `stopOn` or `stopAndClick`. `page.mouse.up()` lets go.
 */
export async function holdSlider(page: Page, name = MECHANICAL) {
  const slider = page.getByRole('slider', { name, exact: true });
  const box = (await slider.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, y, { steps: 3 });
  await keepMoving(page, name);
  return slider;
}
