import { describe, expect, it, vi } from 'vitest';
import type { KeyboardEvent } from 'react';
import { isSpace, onSpace, rovingTarget, tabStopAfterFold, tabStopKey } from './rovingKeys';

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
