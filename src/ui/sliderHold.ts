import { useSyncExternalStore } from 'react';
import { createStore } from 'zustand/vanilla';
import { PAUSE_MS } from './heldValue';

/** What grips a slider. */
export type Grip = 'pointer' | 'key';

/**
 * A key's grip ends this long after its last key up, not at the key up: a run of arrow-key taps is then one grip,
 * followed once when it is over (each tap a release would be each tap a pass, with the hint flipping between its two
 * sentences). The next key down on a slider keeps the grip.
 */
export const KEY_RELEASE_MS = PAUSE_MS;

/**
 * How long a gripped slider may stand still before the page follows although the grip goes on (see `useHeldWhile`).
 * A key that is held down starts to repeat only after the system's delay, half a second and more: that wait is not
 * a pause, so a key gets longer. It still bounds a key up that never comes.
 */
export const GRIP_PAUSE_MS: Record<Grip, number> = { pointer: PAUSE_MS, key: 800 };

/**
 * Whether a simulation slider is gripped: a pointer or a key that moves it is down on it. A tiny store of its own
 * (as the hover preview's): nothing of it is saved or undone. `pointer` is the id of the pointer that pressed it.
 */
const gripStore = createStore<{ pointer: number | null; key: boolean }>(() => ({ pointer: null, key: false }));

/** What grips a slider now: the pointer before the key (its pause is the shorter). */
export function sliderGrip(): Grip | null {
  const { pointer, key } = gripStore.getState();
  return pointer !== null ? 'pointer' : key ? 'key' : null;
}

const gripped = (): boolean => sliderGrip() !== null;

/** Ends the key's grip, set at its key up. */
let keyRelease = 0;

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
  // Any change of the key's grip (down again, or ended) takes the release that a key up had set.
  if (next.key !== undefined) window.clearTimeout(keyRelease);
  gripStore.setState(next);
  watch(gripped());
}

/**
 * A grip never outlives what holds it. The pointer's: its up or cancel, its capture lost, and the signs that an up
 * was missed (a context menu swallows it; so does a release outside the window, after which the pointer comes back
 * moving with no button down, or is pressed again). The key's: a moment after its key up (see `KEY_RELEASE_MS`).
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
      if (!gripStore.getState().key) break;
      window.clearTimeout(keyRelease);
      keyRelease = window.setTimeout(() => setGrip({ key: false }), KEY_RELEASE_MS);
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

/** A key that moves a slider went down on it (see `gripKey`); held down it repeats, as a drag does, and tapped it is pressed again. */
export function gripByKey(): void {
  setGrip({ key: true });
}

export const sliderGripped = gripped;

const GRIP_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/** Whether a key moves a slider (held down it repeats, as a drag does). */
export const gripKey = (key: string): boolean => GRIP_KEYS.has(key);

/** What grips a slider while `counts` is set (else null); never re-renders the caller while it is not. */
export function useSliderGrip(counts: boolean): Grip | null {
  return useSyncExternalStore(gripStore.subscribe, () => (counts ? sliderGrip() : null));
}

/**
 * What one step of a tilt slider costs, in milliseconds on the machine it was profiled on (192 synthetic files): the
 * tilt and the metrics of every loaded file, the angular-region estimate of every loaded file while its columns are
 * shown (an integral over the rotated sphere), and the redraw of both cut plots, which is most of it, per ticked file.
 */
const STEP_MS = { perFile: 0.8, perFileAngularRegions: 2, perDrawnFile: 7 };

/** The load a slider step works on: `files` are the loaded ones, `drawn` the ticked ones. */
export interface StepLoad {
  files: number;
  drawn: number;
  angularRegions: boolean;
}

/** The estimated cost of a step for a load, in the milliseconds of the machine it was profiled on: the shape of the cost, whatever the machine. */
export function estimatedUnits({ files, drawn, angularRegions }: StepLoad): number {
  return files * (STEP_MS.perFile + (angularRegions ? STEP_MS.perFileAngularRegions : 0)) + drawn * STEP_MS.perDrawnFile;
}

/**
 * The first guess, before a pass was timed on this machine: a step estimated to cost more than this is not followed
 * while the slider is dragged. The built-in example, all ticked and with the angular regions, stays under it.
 */
export const LIVE_DRAG_BUDGET_MS = 250;

/** Once a pass has been timed: a step expected to take longer than this on this machine is not followed while the slider is dragged. */
export const HOLD_ABOVE_MS = 80;

/**
 * A load estimated at no more than this is always followed (one ticked file of the built-in example is 26): there is
 * too little in it to wait for, whatever a pass took. A timed pass of a smaller load counts as one of this size: a pass
 * has a fixed part, so a very small one says little about the cost per file.
 */
export const ALWAYS_LIVE_UNITS = 30;

/** A timed pass (see `createPassMeter`): how long it took, and the estimate of the load it worked on. */
export interface PassCost {
  ms: number;
  units: number;
}

/** How long a step of a load estimated at `units` is expected to take on this machine, going by the `timed` pass. */
export function expectedPassMs(units: number, timed: PassCost): number {
  return (timed.ms / Math.max(timed.units, ALWAYS_LIVE_UNITS)) * units;
}

/**
 * Whether the plots and the table follow a simulation slider while it is dragged. Where a step blocks the page for
 * longer than the hand takes to the next one, the thumb stops following the pointer: the page then follows at release
 * (see `useHeldWhile`). It goes by the last pass timed on this machine (`timed`), scaled to the load by the estimate;
 * before any pass was timed (null), by the estimate alone. Either way the page ends as after a typed value.
 */
export function followsDrag(load: StepLoad, timed: PassCost | null = null): boolean {
  const units = estimatedUnits(load);
  if (timed === null) return units <= LIVE_DRAG_BUDGET_MS;
  return units <= ALWAYS_LIVE_UNITS || expectedPassMs(units, timed) <= HOLD_ABOVE_MS;
}
