import { useEffect, useState } from 'react';

/** A redraw of the cut plots expected to take longer than this shows "Updating the plots…" while it runs. */
export const HINT_AFTER_MS = 300;

/** Cost of a redraw per drawn trace, assumed until one has been timed on this machine. */
export const ASSUMED_MS_PER_TRACE = 3;

/** A redraw has a fixed part, so one of fewer traces than this says little about the cost per trace: it is counted as this many. */
export const FEWEST_TIMED_TRACES = 50;

/** A timed redraw of the cut plots: how long it took, from the change to the last plot drawn, and how many traces it drew. */
export interface UpdateCost {
  ms: number;
  traces: number;
}

/**
 * How long a redraw of `traces` traces is expected to take: as long per trace as the `last` timed one (null: none
 * yet). The time of a redraw grows with the number of traces, whatever caused it (a tick, the plot type, a tilt).
 */
export function expectedUpdateMs(last: UpdateCost | null, traces: number): number {
  const perTrace = last !== null && last.traces > 0 ? last.ms / Math.max(last.traces, FEWEST_TIMED_TRACES) : ASSUMED_MS_PER_TRACE;
  return perTrace * traces;
}

/**
 * Whether a redraw of `traces` traces gets the hint. The work blocks the page while it runs, so the hint cannot be
 * added once 300 ms have passed: it has to be on screen before the work starts, and so goes by the expected time.
 * Quick redraws get none (no flashing line above the plots).
 */
export const showsUpdateHint = (last: UpdateCost | null, traces: number): boolean => expectedUpdateMs(last, traces) > HINT_AFTER_MS;

/**
 * `value`, or while `hold` is set the previous one until the browser has painted once more: what is rendered with the
 * new value (the hint) is then on screen before the work that follows the returned value starts.
 */
export function usePaintFirst<T>(value: T, hold: boolean): T {
  const [released, setReleased] = useState(value);
  useEffect(() => {
    if (released === value) return;
    if (!hold) {
      setReleased(value);
      return;
    }
    let timer = 0;
    // A frame callback runs before the paint, a timer set in it after.
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => setReleased(value), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [value, hold, released]);
  return hold ? released : value;
}
