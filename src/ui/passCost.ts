import { useEffect, useSyncExternalStore } from 'react';
import { createStore } from 'zustand/vanilla';
import type { PassCost } from './sliderHold';

/**
 * Times the passes of the simulation: from the moment the page is first made from a new state of the sliders to the
 * moment the cut plots have drawn it (the simulation of every file, the table, the charts and the redraw of every
 * trace lie in between). `clock` gives the time in milliseconds; it is handed in so that a test moves it by hand.
 *
 * Only a pass of the simulation alone says what a slider step costs: one that comes with other files, ticks,
 * settings or another view (`workload` lists them: one of its entries is then another than in the render before), or
 * during which they change, is not noted; nor is one that began or ended while the page was hidden (it draws late or
 * not at all).
 */
export function createPassMeter(clock: () => number) {
  type Workload = readonly unknown[];
  const same = (a: Workload, b: Workload): boolean => a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  let run: { key: unknown; workload: Workload; startedAt: number; clean: boolean; done: boolean } | null = null;
  return {
    /** The page renders from the simulation state `key`, on `workload`. Called in every render; a state seen before changes nothing. */
    seen(key: unknown, workload: Workload, hidden: boolean): void {
      if (run === null) {
        // What the page starts with is not a pass.
        run = { key, workload, startedAt: clock(), clean: false, done: true };
      } else if (run.key !== key) {
        run = { key, workload, startedAt: clock(), clean: same(workload, run.workload) && !hidden, done: false };
      } else if (!same(run.workload, workload)) {
        run.workload = workload;
        run.clean = false;
      }
    },
    /** The cut plots have drawn the page's state `key`, a load estimated at `units`: the cost of that pass, or null when there is none to note. */
    drawn(key: unknown, units: number, hidden: boolean): PassCost | null {
      if (run === null || run.key !== key || run.done) return null;
      run.done = true;
      return run.clean && !hidden ? { ms: clock() - run.startedAt, units } : null;
    },
  };
}

/** The last pass timed on this machine (null: none yet). A store of its own: nothing of it is saved or undone. */
const passStore = createStore<{ last: PassCost | null }>(() => ({ last: null }));
const meter = createPassMeter(() => performance.now());
const pageHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState !== 'visible';
/** What the page is made from now: the state the plots will have drawn, and the estimate of its load. */
let current: { key: unknown; units: number } | null = null;

/** The last pass timed on this machine, for `followsDrag` (null until one was). */
export function useTimedPass(): PassCost | null {
  return useSyncExternalStore(passStore.subscribe, () => passStore.getState().last);
}

/**
 * Tells the meter what the page is rendered from: the simulation state `key`, the `workload` it is made on (the files,
 * the ticks, the settings, the view: whatever else a redraw depends on) and the estimate of its load. Called by the
 * page before it works the simulation out, so that the pass is timed from there.
 */
export function usePassStart(key: unknown, workload: readonly unknown[], units: number): void {
  // In the render itself, not in an effect: the simulation is worked out in this render, after this line. Seeing the
  // same state again (a second render of it) changes nothing.
  meter.seen(key, workload, pageHidden());
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
  if (cost) passStore.setState({ last: cost });
}
