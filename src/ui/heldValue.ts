import { useCallback, useEffect, useState } from 'react';

/**
 * A held value that has not changed for this long is handed on although the hold goes on: the user has stopped to
 * look. Long enough that a hand slowing down in a drag, or a page that stalls for a moment, is not taken for a pause
 * (the pass that follows cannot be interrupted, and the thumb stands still under a hand that moves on).
 */
export const PAUSE_MS = 475;

/**
 * The last part of the pause is a timer of its own. A timer that comes due while the page is busy fires as soon as
 * it is free again, at the same moment as the slider steps that waited behind the work: they are handled before a
 * second timer set then, and the pause is seen for what it was (else every pass that blocks the page would look
 * like a pause and start the next one).
 */
const CONFIRM_MS = 50;

export interface Held<T> {
  /** The value to work with: `value` itself, or while it is held the one from before. */
  value: T;
  /** A newer value is being held back: what is made from `value` is behind. */
  waiting: boolean;
  /** Hands `value` on now, although the hold goes on (it is the one a later hold starts from). */
  handOn: (value: T) => void;
}

/**
 * `value`, held back while `hold` is set (a slider is being dragged and following it would block the page): the
 * values in between are dropped, and the last one is handed on once, when the hold ends or when no new value has
 * come for `pauseMs`. Without a hold every value is handed on at once.
 */
export function useHeldWhile<T>(value: T, hold: boolean, pauseMs = PAUSE_MS): Held<T> {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (shown === value) return;
    if (!hold) {
      // Kept up to date, so that the next hold starts from the value last handed on.
      setShown(value);
      return;
    }
    let timer = window.setTimeout(() => {
      timer = window.setTimeout(() => setShown(value), Math.min(CONFIRM_MS, pauseMs));
    }, Math.max(0, pauseMs - CONFIRM_MS));
    return () => window.clearTimeout(timer);
  }, [value, hold, pauseMs, shown]);
  const handOn = useCallback((now: T) => setShown(now), []);
  const out = hold ? shown : value;
  return { value: out, waiting: out !== value, handOn };
}
