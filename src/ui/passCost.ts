import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createStore } from 'zustand/vanilla';
import { followsDrag, passKind, PASSES_KEPT, type PassCost, type PassKind, type StepLoad } from './sliderHold';

/** A pass that has not drawn after this long is given up (something kept the cut plots from drawing it): nothing is noted of it. */
export const PASS_GIVEN_UP_MS = 20_000;

/**
 * Times the passes of the simulation: for how long at a stretch the page was blocked between the moment it is first
 * made from a new state of the sliders and the moment the cut plots have drawn it (the simulation of every file, the
 * table, the charts and the redraw of every trace lie in between). Not how long the pass took from end to end: the
 * page renders it a moment late and the charts draw in several turns, and between those the thumb follows the hand.
 * What stops it is the longest piece of work in one go.
 *
 * `clock` gives the time in milliseconds; it is handed in so that a test moves it by hand. `free` is to be called
 * whenever the page gets a turn of its own while a pass runs (a timer does it): the stretch since the turn before
 * was one the page was blocked for. `kindOf` says what kind of pass leads from one state to the next (null: none
 * that is timed).
 *
 * Only a pass of the simulation alone says what a slider step costs: one that comes with other files, ticks,
 * settings or another view (`workload` lists them: one of its entries is then another than in the render before), or
 * during which they change, is not noted; nor is one that began or ended while the page was hidden, or was hidden in
 * between (it draws late or not at all, and its timers are slowed). `hidden` is also to be said of a page whose cut
 * plots are not on it (the 3D view): nothing will draw the pass.
 */
export function createPassMeter<K extends string>(clock: () => number, kindOf: (from: unknown, to: unknown) => K | null) {
  type Workload = readonly unknown[];
  const same = (a: Workload, b: Workload): boolean => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  let run: { key: unknown; workload: Workload; kind: K | null; startedAt: number; freeAt: number; blockedMs: number; clean: boolean; done: boolean } | null = null;
  const blockedUntil = (now: number, r: NonNullable<typeof run>): number => Math.max(r.blockedMs, now - r.freeAt);
  return {
    /** The page renders from the simulation state `key`, on `workload`. Called in every render; a state seen before changes nothing. */
    seen(key: unknown, workload: Workload, hidden: boolean): void {
      const now = clock();
      if (run === null) {
        // What the page starts with is not a pass.
        run = { key, workload, kind: null, startedAt: now, freeAt: now, blockedMs: 0, clean: false, done: true };
      } else if (run.key !== key) {
        const kind = kindOf(run.key, key);
        run = { key, workload, kind, startedAt: now, freeAt: now, blockedMs: 0, clean: kind !== null && same(workload, run.workload) && !hidden, done: false };
      } else if (!same(run.workload, workload)) {
        run.workload = workload;
        run.clean = false;
      }
    },
    /** Whether a pass that will be noted runs. */
    runs(): boolean {
      return run !== null && !run.done && run.clean;
    },
    /** The page has a turn of its own. Says whether a pass that will be noted still runs (whether to come back). */
    free(hidden: boolean): boolean {
      if (run === null || run.done || !run.clean) return false;
      const now = clock();
      if (hidden || now - run.startedAt > PASS_GIVEN_UP_MS) {
        run.clean = false;
        return false;
      }
      run.blockedMs = blockedUntil(now, run);
      run.freeAt = now;
      return true;
    },
    /** The cut plots have drawn the page's state `key`, a load estimated at `units`: the cost of that pass, or null when there is none to note. */
    drawn(key: unknown, units: number, hidden: boolean): (PassCost & { kind: K }) | null {
      if (run === null || run.key !== key || run.done) return null;
      run.done = true;
      return run.clean && run.kind !== null && !hidden ? { kind: run.kind, ms: blockedUntil(clock(), run), units } : null;
    },
  };
}

/** The last passes of each kind timed on this machine, oldest first (none yet: empty). */
export type TimedPasses = Record<PassKind, readonly PassCost[]>;

/** `timed` with one more pass of `kind`: the last few of each kind are kept. */
export function withPass(timed: TimedPasses, kind: PassKind, cost: PassCost): TimedPasses {
  return { ...timed, [kind]: [...timed[kind], cost].slice(-PASSES_KEPT) };
}

/** A store of its own: nothing of it is saved or undone. */
const passStore = createStore<TimedPasses>(() => ({ tilt: [], azimuth: [] }));
const meter = createPassMeter<PassKind>(() => performance.now(), passKind);
const pageHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState !== 'visible';
/** What the page is made from now: the state the plots will have drawn, and the estimate of its load. */
let current: { key: unknown; units: number } | null = null;

/** Between two of the page's own turns while a pass runs: as short as a timer that sets itself again gets. */
const TURN_MS = 4;
let turn: ReturnType<typeof setTimeout> | null = null;
function takeTurns(): void {
  turn = meter.free(pageHidden()) ? setTimeout(takeTurns, TURN_MS) : null;
}

/**
 * Whether the page follows a drag of each kind of slider, for this load: by what the passes of that kind took on this
 * machine (see `followsDrag`). What was decided before for this same load stands while the passes do not clearly say
 * otherwise; what was decided for another load says nothing about this one.
 */
export function useFollowsDrag(load: StepLoad): Record<PassKind, boolean> {
  const timed = useSyncExternalStore(passStore.subscribe, passStore.getState);
  const decided = useRef<{ load: StepLoad; follows: Record<PassKind, boolean> } | null>(null);
  const { files, drawn, angularRegions } = load;
  const follows = useMemo(() => {
    const was = decided.current;
    const before = was && was.load.files === files && was.load.drawn === drawn && was.load.angularRegions === angularRegions ? was.follows : null;
    const now = { files, drawn, angularRegions };
    return { tilt: followsDrag(now, timed.tilt, before?.tilt), azimuth: followsDrag(now, timed.azimuth, before?.azimuth) };
  }, [files, drawn, angularRegions, timed]);
  useEffect(() => {
    decided.current = { load: { files, drawn, angularRegions }, follows };
  }, [files, drawn, angularRegions, follows]);
  return follows;
}

/**
 * Tells the meter what the page is rendered from: the simulation state `key`, the `workload` it is made on (the files,
 * the ticks, the settings, the view: whatever else a redraw depends on) and the estimate of its load. Called by the
 * page before it works the simulation out, so that the pass is timed from there. `cutPlots` says whether the cut plots
 * are on the page: where they are not (the 3D view) no pass will be drawn, so none is timed and no timer is set.
 */
export function usePassStart(key: unknown, workload: readonly unknown[], units: number, cutPlots = true): void {
  // In the render itself, not in an effect: the simulation is worked out in this render, after this line. Seeing the
  // same state again (a second render of it) changes nothing.
  meter.seen(key, [...workload, cutPlots], pageHidden() || !cutPlots);
  if (turn === null) takeTurns();
  useEffect(() => {
    current = { key, units };
    return () => {
      current = null;
    };
  }, [key, units]);
}

/** The cut plots have finished drawing the simulation the page is made from: the pass, if one ran, is noted. */
export function noteSimulationDrawn(): void {
  if (current === null) return;
  const cost = meter.drawn(current.key, current.units, pageHidden());
  // The pass is over: so are its turns, now and not at the next one (unless a newer pass is already under way).
  if (turn !== null && !meter.runs()) {
    clearTimeout(turn);
    turn = null;
  }
  if (cost) noteTimedPass(cost.kind, { ms: cost.ms, units: cost.units });
}

/** A pass of `kind` was timed: the next drag of a slider of that kind goes by it too. */
export function noteTimedPass(kind: PassKind, cost: PassCost): void {
  passStore.setState(withPass(passStore.getState(), kind, cost), true);
}
