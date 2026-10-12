import { useSyncExternalStore } from 'react';
import { createStore } from 'zustand/vanilla';

/**
 * Whether a simulation slider is gripped: a pointer or a key that moves it is down on it. A tiny store of its own
 * (as the hover preview's): nothing of it is saved or undone.
 */
const gripStore = createStore<{ gripped: boolean }>(() => ({ gripped: false }));

const ENDS = ['pointerup', 'pointercancel', 'keyup', 'blur'] as const;

function letGo(event: Event): void {
  // The window's own blur only: an element's (the press on a slider takes the focus from another field) passes here too.
  if (event.type === 'blur' && event.target instanceof Node) return;
  for (const end of ENDS) window.removeEventListener(end, letGo, true);
  gripStore.setState({ gripped: false });
}

/**
 * A pointer or a key went down on a slider: it is gripped until the next pointer or key up anywhere (the pointer may
 * leave the slider while it drags), a cancelled pointer, or the window losing the focus (the up then never comes).
 */
export function gripSlider(): void {
  if (gripStore.getState().gripped) return;
  for (const end of ENDS) window.addEventListener(end, letGo, true);
  gripStore.setState({ gripped: true });
}

export const sliderGripped = (): boolean => gripStore.getState().gripped;

const GRIP_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** Whether a key moves a slider (held down it repeats, as a drag does). */
export const gripKey = (key: string): boolean => GRIP_KEYS.has(key);

/** Whether a slider is gripped while `counts` is set; never re-renders the caller while it is not. */
export function useSliderGripped(counts: boolean): boolean {
  return useSyncExternalStore(gripStore.subscribe, () => counts && gripStore.getState().gripped);
}

/**
 * What one step of a tilt slider costs, in milliseconds on the machine it was profiled on (192 synthetic files): the
 * tilt and the metrics of every loaded file, the angular-region estimate of every loaded file while its columns are
 * shown (an integral over the rotated sphere), and the redraw of both cut plots, which is most of it, per ticked file.
 */
const STEP_MS = { perFile: 0.8, perFileAngularRegions: 2, perDrawnFile: 7 };

/** A step expected to cost more than this is not followed while the slider is dragged. The built-in example, all ticked and with the angular regions, stays under it. */
export const LIVE_DRAG_BUDGET_MS = 250;

/**
 * Whether the plots and the table follow a simulation slider while it is dragged. With many files a step blocks the
 * page for longer than the hand takes to the next one, and the thumb stops following the pointer: the page then
 * follows at release (see `useHeldWhile`). `files` are the loaded ones, `drawn` the ticked ones.
 */
export function followsDrag({ files, drawn, angularRegions }: { files: number; drawn: number; angularRegions: boolean }): boolean {
  const cost = files * (STEP_MS.perFile + (angularRegions ? STEP_MS.perFileAngularRegions : 0)) + drawn * STEP_MS.perDrawnFile;
  return cost <= LIVE_DRAG_BUDGET_MS;
}
