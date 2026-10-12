import { useSyncExternalStore } from 'react';
import { createStore } from 'zustand/vanilla';

/**
 * Whether a simulation slider is gripped: a pointer or a key that moves it is down on it. A tiny store of its own
 * (as the hover preview's): nothing of it is saved or undone. `pointer` is the id of the pointer that pressed it.
 */
const gripStore = createStore<{ pointer: number | null; key: boolean }>(() => ({ pointer: null, key: false }));

const gripped = (): boolean => gripStore.getState().pointer !== null || gripStore.getState().key;

/** What can end a grip; listened for on the window (the pointer may leave the slider while it drags) while one is on. */
const WATCHED = ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerdown', 'pointermove', 'contextmenu', 'keyup', 'blur', 'visibilitychange'] as const;
let watching = false;

function watch(on: boolean): void {
  if (on === watching) return;
  watching = on;
  for (const type of WATCHED) {
    if (on) window.addEventListener(type, onWatched, true);
    else window.removeEventListener(type, onWatched, true);
  }
}

function setGrip(next: Partial<{ pointer: number | null; key: boolean }>): void {
  gripStore.setState(next);
  watch(gripped());
}

/**
 * A grip never outlives what holds it. The pointer's: its up or cancel, its capture lost, and the signs that an up
 * was missed (a context menu swallows it; so does a release outside the window, after which the pointer comes back
 * moving with no button down, or is pressed again). The key's: its key up.
 * Both: the window losing the focus, the page being hidden.
 */
function onWatched(event: Event): void {
  const { pointer } = gripStore.getState();
  const own = pointer !== null && (event as PointerEvent).pointerId === pointer;
  switch (event.type) {
    case 'pointerup':
    case 'pointercancel':
    case 'lostpointercapture':
    case 'pointerdown':
      if (own) setGrip({ pointer: null });
      break;
    case 'pointermove':
      if (own && (event as PointerEvent).buttons === 0) setGrip({ pointer: null });
      break;
    case 'contextmenu':
      setGrip({ pointer: null });
      break;
    case 'keyup':
      setGrip({ key: false });
      break;
    case 'blur':
      // The window's own blur only: an element's (the press on a slider takes the focus from another field) passes here too.
      if (event.target instanceof Node) break;
      setGrip({ pointer: null, key: false });
      break;
    case 'visibilitychange':
      setGrip({ pointer: null, key: false });
      break;
  }
}

/** The parts of a pointer event a grip goes by. */
export interface PressLike {
  pointerId: number;
  button: number;
  isPrimary: boolean;
}

/**
 * A pointer went down on a slider: its primary button grips it (the first finger, the left mouse button; any other
 * button moves no slider, and the release after a context menu is not reported).
 */
export function gripByPointer(press: PressLike): void {
  if (press.button !== 0 || !press.isPrimary) return;
  setGrip({ pointer: press.pointerId });
}

/** A key that moves a slider went down on it (see `gripKey`); held down it repeats, as a drag does. */
export function gripByKey(): void {
  setGrip({ key: true });
}

export const sliderGripped = gripped;

const GRIP_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** Whether a key moves a slider (held down it repeats, as a drag does). */
export const gripKey = (key: string): boolean => GRIP_KEYS.has(key);

/** Whether a slider is gripped while `counts` is set; never re-renders the caller while it is not. */
export function useSliderGripped(counts: boolean): boolean {
  return useSyncExternalStore(gripStore.subscribe, () => counts && gripped());
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
