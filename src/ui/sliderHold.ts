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
const gripStore = createStore<{ pointer: number | null; key: boolean; kind: PassKind }>(() => ({ pointer: null, key: false, kind: 'tilt' }));

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

function setGrip(next: Partial<{ pointer: number | null; key: boolean; kind: PassKind }>): void {
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
 * A pointer went down on a slider of `kind`: its primary button grips it (the first finger, the left mouse button; any other
 * button moves no slider, and the release after a context menu is not reported).
 */
export function gripByPointer(press: PressLike, kind: PassKind = 'tilt'): void {
  if (press.button !== 0 || !press.isPrimary) return;
  setGrip({ pointer: press.pointerId, kind });
}

/** A key that moves a slider of `kind` went down on it (see `gripKey`); held down it repeats, as a drag does, and tapped it is pressed again. */
export function gripByKey(kind: PassKind = 'tilt'): void {
  setGrip({ key: true, kind });
}

/**
 * The kind of the slider in the hand, or of the one that was last (a tilt slider before any was): whether a drag is
 * followed goes by the passes of that kind. Known from the press on, before the first step.
 */
export const sliderKindInHand = (): PassKind => gripStore.getState().kind;

/** `sliderKindInHand`, for a component. */
export function useSliderKind(): PassKind {
  return useSyncExternalStore(gripStore.subscribe, sliderKindInHand);
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
 * The first guess, while too few passes were timed on this machine: a step estimated to cost more than this is not
 * followed while the slider is dragged. The built-in example, all ticked and with the angular regions, stays under it.
 */
export const LIVE_DRAG_BUDGET_MS = 250;

/**
 * What a slider step makes the page do. A tilt (electrical or mechanical) works every file out again; an azimuth
 * turns the drawing only, and with many files is several times cheaper. What one kind of pass took says nothing
 * about the other.
 */
export type PassKind = 'tilt' | 'azimuth';

/** The kind of the slider that changes simulation value `key` (a file's or a group's offset is of the kind of its slider). */
export const sliderKind = (key: 'electricalDeg' | 'mechanicalDeg' | 'azimuthDeg'): PassKind => (key === 'azimuthDeg' ? 'azimuth' : 'tilt');

/** The parts of the simulation state a pass is told by. */
interface SlidersLike {
  electricalDeg: number;
  mechanicalDeg: number;
  azimuthDeg: number;
}

/**
 * The kind of the pass that leads from one simulation state to the next: one of the global sliders alone. Anything
 * else (an offset of one file, the cut, Show original, a tilt and an azimuth at once as after Reset) is not a pass of
 * a kind (null): what it took says nothing about a slider step.
 */
export function passKind(from: unknown, to: unknown): PassKind | null {
  if (typeof from !== 'object' || from === null || typeof to !== 'object' || to === null) return null;
  const [a, b] = [from as Record<string, unknown>, to as Record<string, unknown>];
  const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !Object.is(a[k], b[k]));
  const sliders: (keyof SlidersLike)[] = ['electricalDeg', 'mechanicalDeg', 'azimuthDeg'];
  if (changed.length === 0 || changed.some((k) => !(sliders as string[]).includes(k))) return null;
  const kinds = new Set(changed.map((k) => sliderKind(k as keyof SlidersLike)));
  return kinds.size === 1 ? [...kinds][0] : null;
}

/**
 * Once passes have been timed: a drag is waited for when a step is expected to block the page for longer than
 * `HOLD_ABOVE_MS` at a stretch, and followed again when for less than `LIVE_BELOW_MS`. Between the two what was
 * decided before stands: a load at the limit does not go from one to the other with every pass.
 */
export const HOLD_ABOVE_MS = 140;
export const LIVE_BELOW_MS = 100;

/** How many timed passes of a kind decide, and are kept: the last two. They have to agree, so one pass that was slow or quick for another reason changes nothing. */
export const PASSES_KEPT = 2;

/**
 * A load estimated at no more than this is always followed (one ticked file of the built-in example is 26): there is
 * too little in it to wait for, whatever a pass took.
 */
export const ALWAYS_LIVE_UNITS = 30;

/**
 * The part of a pass that does not grow with the load (the page around the plots, the charts' own set-up), in the
 * units of the estimate: a pass of a load of `u` units costs as `FIXED_UNITS + u`. Fitted to the built-in example:
 * a step blocks for about as long with two ticked files as with one, and for some two and a half times that with 24.
 */
export const FIXED_UNITS = 75;

/**
 * A timed pass says something about a load of up to this many times its own, and down to that part of it. Further
 * away the estimate is too rough a scale (a file that is loaded but not ticked, or the 96th ticked one, does not cost
 * what it says), and the first guess stands in.
 */
export const SCALED_UP_TO = 2;

/** A timed pass (see `createPassMeter`): for how long at a stretch it blocked the page, and the estimate of the load it worked on. */
export interface PassCost {
  ms: number;
  units: number;
}

/** For how long a step of a load estimated at `units` is expected to block the page on this machine, going by the `timed` pass. */
export function expectedPassMs(units: number, timed: PassCost): number {
  return (timed.ms * (FIXED_UNITS + units)) / (FIXED_UNITS + timed.units);
}

/**
 * Whether the plots and the table follow a simulation slider while it is dragged. Where a step blocks the page for
 * longer than the hand takes to the next one, the thumb stops following the pointer: the page then follows at release
 * (see `useHeldWhile`).
 *
 * `timed` are the last passes of the slider's kind timed on this machine, oldest first, each scaled to the load by
 * the estimate. The last two decide, and only together: both over `HOLD_ABOVE_MS`, the drag is waited for; both under
 * `LIVE_BELOW_MS`, it is followed; else what was decided `before` stands. While there are not two of them, or one was
 * timed on a load too far from this one (see `SCALED_UP_TO`), the estimate alone decides, as it did before any pass
 * was timed (the first guess). Either way the page ends as after a typed value.
 */
export function followsDrag(load: StepLoad, timed: readonly PassCost[] = [], before?: boolean): boolean {
  const units = estimatedUnits(load);
  if (units <= ALWAYS_LIVE_UNITS) return true;
  const firstGuess = units <= LIVE_DRAG_BUDGET_MS;
  const last = timed.slice(-PASSES_KEPT);
  const near = (pass: PassCost): boolean => units <= pass.units * SCALED_UP_TO && pass.units <= units * SCALED_UP_TO;
  if (last.length < PASSES_KEPT || !last.every(near)) return firstGuess;
  const expected = last.map((pass) => expectedPassMs(units, pass));
  if (Math.min(...expected) > HOLD_ABOVE_MS) return false;
  if (Math.max(...expected) < LIVE_BELOW_MS) return true;
  return before ?? firstGuess;
}
