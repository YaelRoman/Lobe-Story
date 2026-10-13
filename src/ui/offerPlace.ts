/** A box on the screen, as `getBoundingClientRect` gives it. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The area two boxes share, in px²; 0 when they only touch. */
export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** How much of `controls` the box lies on, in px². */
export const covered = (box: Box, controls: readonly Box[]): number => controls.reduce((sum, c) => sum + overlapArea(box, c), 0);

/**
 * Where the undo offer goes in a short window, where it cannot be clear of the page: at the foot of the window as
 * everywhere, unless it lies on a slider or a number box there and would lie on less of them under the status line.
 * `atTop` is asked only when the foot is taken (it means laying the offer out again).
 */
export function offerPlace(atFoot: number, atTop: () => number): 'foot' | 'top' {
  if (atFoot <= 0) return 'foot';
  return atTop() < atFoot ? 'top' : 'foot';
}
