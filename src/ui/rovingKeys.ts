import type { KeyboardEvent } from 'react';

/**
 * Where an arrow-key press moves the focus in a list of `count` items that is one tab stop:
 * Up/Down by one (stopping at the ends), Home/End to the ends. Null for any other key, or an empty list.
 */
export function rovingTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const from = current < 0 ? 0 : current;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : Math.min(from + 1, last);
    case 'ArrowUp':
      return Math.max(from - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

/** The key of the list item that holds the tab stop: `active` while it is still listed, else the first. */
export function tabStopKey(keys: string[], active: string | null): string | null {
  return active !== null && keys.includes(active) ? active : (keys[0] ?? null);
}

/** Whether a key press is the Space key (`key` is " " in browsers; some report "Spacebar"). */
export const isSpace = (key: string): boolean => key === ' ' || key === 'Spacebar';

/**
 * Key handlers that run `action` on Space and keep the button from also "clicking" itself
 * (a button clicks on Space's key-up), so Space can mean something other than "activate".
 */
export function onSpace(action: () => void): {
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
} {
  return {
    onKeyDown: (e) => {
      if (!isSpace(e.key) || e.repeat) return;
      e.preventDefault();
      action();
    },
    onKeyUp: (e) => {
      if (isSpace(e.key)) e.preventDefault();
    },
  };
}

/** Moves the focus among `items` for an arrow-key press on `from`; returns whether the key was used. */
export function moveFocus(e: KeyboardEvent, items: HTMLElement[], from: HTMLElement | null): boolean {
  const to = rovingTarget(e.key, from ? items.indexOf(from) : -1, items.length);
  if (to === null) return false;
  e.preventDefault();
  items[to].focus();
  items[to].scrollIntoView?.({ block: 'nearest' });
  return true;
}
