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

/** The tab stop after the group `groupKey` is folded: its header when the stop was on one of its rows (they are gone), else unchanged. */
export function tabStopAfterFold(active: string | null, groupKey: string, groupFileKeys: string[]): string | null {
  return active !== null && groupFileKeys.includes(active) ? `group:${groupKey}` : active;
}

/**
 * Where Home/End move the focus among the data cells of a table: without Ctrl/Cmd to the first/last cell of the
 * row, with it to the same column of the first/last row. `row` and `col` are indexes; null for any other key.
 */
export function cellEndTarget(key: string, ctrl: boolean, at: { row: number; col: number }, size: { rows: number; cols: number }): { row: number; col: number } | null {
  if ((key !== 'Home' && key !== 'End') || size.rows <= 0 || size.cols <= 0) return null;
  const end = key === 'End';
  return ctrl ? { row: end ? size.rows - 1 : 0, col: Math.min(at.col, size.cols - 1) } : { row: at.row, col: end ? size.cols - 1 : 0 };
}

/**
 * Where Left/Right, Home and End move the focus in a row of `count` controls that is one tab stop (the header row of
 * a table): by one, stopping at the ends, or to them. Null for any other key, or an empty row.
 */
export function rowTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  switch (key) {
    case 'ArrowRight':
      return current < 0 ? 0 : Math.min(current + 1, last);
    case 'ArrowLeft':
      return Math.max(current - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

/**
 * Where a key moves the focus in a table of controls that is one tab stop: the arrows by one cell, stopping at the
 * edges; Home/End as `cellEndTarget`. Null for any other key, or an empty table.
 */
export function gridTarget(key: string, ctrl: boolean, at: { row: number; col: number }, size: { rows: number; cols: number }): { row: number; col: number } | null {
  if (size.rows <= 0 || size.cols <= 0) return null;
  const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max - 1);
  switch (key) {
    case 'ArrowRight':
      return { row: at.row, col: clamp(at.col + 1, size.cols) };
    case 'ArrowLeft':
      return { row: at.row, col: clamp(at.col - 1, size.cols) };
    case 'ArrowDown':
      return { row: clamp(at.row + 1, size.rows), col: at.col };
    case 'ArrowUp':
      return { row: clamp(at.row - 1, size.rows), col: at.col };
    default:
      return cellEndTarget(key, ctrl, at, size);
  }
}
