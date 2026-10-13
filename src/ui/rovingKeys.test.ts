import { describe, expect, it, vi } from 'vitest';
import type { KeyboardEvent } from 'react';
import { cellEndTarget, isSpace, onSpace, rovingTarget, tabStopAfterFold, tabStopKey, gridTarget, rowTarget } from './rovingKeys';

describe('rovingTarget', () => {
  it('moves one step and stops at the ends', () => {
    expect(rovingTarget('ArrowDown', 0, 3)).toBe(1);
    expect(rovingTarget('ArrowDown', 2, 3)).toBe(2);
    expect(rovingTarget('ArrowUp', 2, 3)).toBe(1);
    expect(rovingTarget('ArrowUp', 0, 3)).toBe(0);
  });
  it('jumps with Home and End', () => {
    expect(rovingTarget('Home', 2, 5)).toBe(0);
    expect(rovingTarget('End', 0, 5)).toBe(4);
  });
  it('ignores other keys and empty lists, and starts at the first item from outside', () => {
    expect(rovingTarget('a', 1, 3)).toBeNull();
    expect(rovingTarget('ArrowDown', 0, 0)).toBeNull();
    expect(rovingTarget('ArrowDown', -1, 3)).toBe(0);
    expect(rovingTarget('ArrowUp', -1, 3)).toBe(0);
  });
});

describe('tabStopKey', () => {
  it('keeps the active key while it is listed, else the first', () => {
    expect(tabStopKey(['a', 'b'], 'b')).toBe('b');
    expect(tabStopKey(['a', 'b'], 'gone')).toBe('a');
    expect(tabStopKey(['a', 'b'], null)).toBe('a');
    expect(tabStopKey([], 'a')).toBeNull();
  });
});

describe('onSpace', () => {
  const event = (key: string, repeat = false) => ({ key, repeat, preventDefault: vi.fn() }) as unknown as KeyboardEvent;
  it('runs the action once on Space and swallows the key-up click', () => {
    const action = vi.fn();
    const h = onSpace(action);
    const down = event(' ');
    h.onKeyDown(down);
    expect(action).toHaveBeenCalledTimes(1);
    expect(down.preventDefault).toHaveBeenCalled();
    h.onKeyDown(event(' ', true));
    expect(action).toHaveBeenCalledTimes(1);
    const up = event(' ');
    h.onKeyUp(up);
    expect(up.preventDefault).toHaveBeenCalled();
  });
  it('leaves other keys alone', () => {
    const action = vi.fn();
    const e = event('Enter');
    onSpace(action).onKeyDown(e);
    expect(action).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(isSpace('Enter')).toBe(false);
  });
});

describe('tabStopAfterFold', () => {
  const files = ['file:a', 'file:b'];
  it('moves the tab stop from a row of the folded group to the group header', () => {
    expect(tabStopAfterFold('file:b', 'g', files)).toBe('group:g');
  });
  it('leaves any other tab stop where it is', () => {
    expect(tabStopAfterFold('file:z', 'g', files)).toBe('file:z');
    expect(tabStopAfterFold('group:g', 'g', files)).toBe('group:g');
    expect(tabStopAfterFold(null, 'g', files)).toBeNull();
  });
});

describe('cellEndTarget', () => {
  const size = { rows: 24, cols: 12 };
  it('Home and End go to the first and last cell of the row', () => {
    expect(cellEndTarget('Home', false, { row: 5, col: 7 }, size)).toEqual({ row: 5, col: 0 });
    expect(cellEndTarget('End', false, { row: 5, col: 3 }, size)).toEqual({ row: 5, col: 11 });
  });
  it('Ctrl/Cmd+Home and End go to the first and last row, in the same column', () => {
    expect(cellEndTarget('Home', true, { row: 5, col: 7 }, size)).toEqual({ row: 0, col: 7 });
    expect(cellEndTarget('End', true, { row: 5, col: 7 }, size)).toEqual({ row: 23, col: 7 });
  });
  it('is null for other keys and for an empty table', () => {
    expect(cellEndTarget('ArrowRight', false, { row: 0, col: 0 }, size)).toBeNull();
    expect(cellEndTarget('Home', false, { row: 0, col: 0 }, { rows: 0, cols: 0 })).toBeNull();
  });
});

describe('rowTarget: Left/Right along a row of controls that is one tab stop', () => {
  it('moves by one and stops at the ends; Home and End go to them', () => {
    expect(rowTarget('ArrowRight', 0, 29)).toBe(1);
    expect(rowTarget('ArrowRight', 28, 29)).toBe(28);
    expect(rowTarget('ArrowLeft', 5, 29)).toBe(4);
    expect(rowTarget('ArrowLeft', 0, 29)).toBe(0);
    expect(rowTarget('Home', 12, 29)).toBe(0);
    expect(rowTarget('End', 12, 29)).toBe(28);
  });

  it('leaves every other key alone, and an empty row', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Tab', 'Enter', ' ', 'a']) expect(rowTarget(key, 3, 29), key).toBeNull();
    expect(rowTarget('ArrowRight', 0, 0)).toBeNull();
    // From outside the row (nothing of it focused): its first control.
    expect(rowTarget('ArrowRight', -1, 4)).toBe(0);
  });
});

describe('gridTarget: the arrow keys in a table of controls that is one tab stop', () => {
  const size = { rows: 18, cols: 2 };
  it('moves by one cell and stops at the edges', () => {
    expect(gridTarget('ArrowRight', false, { row: 3, col: 0 }, size)).toEqual({ row: 3, col: 1 });
    expect(gridTarget('ArrowRight', false, { row: 3, col: 1 }, size)).toEqual({ row: 3, col: 1 });
    expect(gridTarget('ArrowLeft', false, { row: 3, col: 0 }, size)).toEqual({ row: 3, col: 0 });
    expect(gridTarget('ArrowDown', false, { row: 17, col: 1 }, size)).toEqual({ row: 17, col: 1 });
    expect(gridTarget('ArrowDown', false, { row: 3, col: 1 }, size)).toEqual({ row: 4, col: 1 });
    expect(gridTarget('ArrowUp', false, { row: 0, col: 1 }, size)).toEqual({ row: 0, col: 1 });
    expect(gridTarget('ArrowUp', false, { row: 3, col: 1 }, size)).toEqual({ row: 2, col: 1 });
  });

  it('Home and End: the ends of the row, with Ctrl/Cmd the first and last row of the column (as in the metrics table)', () => {
    expect(gridTarget('Home', false, { row: 3, col: 1 }, size)).toEqual({ row: 3, col: 0 });
    expect(gridTarget('End', false, { row: 3, col: 0 }, size)).toEqual({ row: 3, col: 1 });
    expect(gridTarget('Home', true, { row: 3, col: 1 }, size)).toEqual({ row: 0, col: 1 });
    expect(gridTarget('End', true, { row: 3, col: 1 }, size)).toEqual({ row: 17, col: 1 });
  });

  it('leaves every other key alone, and an empty table', () => {
    for (const key of ['Tab', 'Enter', ' ', 'PageDown']) expect(gridTarget(key, false, { row: 0, col: 0 }, size), key).toBeNull();
    expect(gridTarget('ArrowDown', false, { row: 0, col: 0 }, { rows: 0, cols: 0 })).toBeNull();
  });
});
