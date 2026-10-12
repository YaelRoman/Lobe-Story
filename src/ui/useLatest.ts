import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * The value of the latest render that was committed, for a handler that first makes the page render again (see
 * `catchUpSimulation`) and then needs what that render made, not what its own closure holds.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
