// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAUSE_MS, useHeldWhile } from './heldValue';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
/** Every value the hook handed out, in order, without repeats: each new one stands for one pass of the heavy work. */
let passes: number[];
let waiting: boolean;

function Probe({ value, hold }: { value: number; hold: boolean }) {
  const held = useHeldWhile(value, hold);
  if (passes[passes.length - 1] !== held.value) passes.push(held.value);
  waiting = held.waiting;
  return null;
}
const render = (value: number, hold: boolean) => act(() => root.render(createElement(Probe, { value, hold })));
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  passes = [];
  waiting = false;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('useHeldWhile', () => {
  it('hands every value on at once while nothing holds it', () => {
    render(0, false);
    render(1, false);
    render(2, false);
    expect(passes).toEqual([0, 1, 2]);
    expect(waiting).toBe(false);
  });

  it('keeps the value from before the hold while values keep coming, and says that it is waiting', () => {
    render(0, false);
    render(0, true);
    expect(waiting).toBe(false);
    for (const v of [1, 2, 3, 4]) {
      render(v, true);
      wait(PAUSE_MS - 1);
      expect(waiting).toBe(true);
    }
    expect(passes).toEqual([0]);
  });

  it('hands on the last value at release: one pass, none for the values in between', () => {
    render(0, true);
    for (const v of [1, 2, 3]) {
      render(v, true);
      wait(60);
    }
    render(3, false);
    expect(passes).toEqual([0, 3]);
    expect(waiting).toBe(false);
    // Nothing is left pending: no second pass later.
    wait(10 * PAUSE_MS);
    expect(passes).toEqual([0, 3]);
  });

  it('hands on the value after a pause without a new one, while still held', () => {
    render(0, true);
    render(1, true);
    wait(60);
    render(2, true);
    wait(PAUSE_MS - 1);
    expect(passes).toEqual([0]);
    wait(1);
    expect(passes).toEqual([0, 2]);
    expect(waiting).toBe(false);
  });

  it('a pause is confirmed by a second timer: after a blocked page the waiting slider steps are handled first', () => {
    render(0, true);
    render(1, true);
    // The first timer comes due (late, when the page was busy): nothing is handed on by it alone.
    act(() => void vi.advanceTimersToNextTimer());
    expect(passes).toEqual([0]);
    // A step that was waiting behind the busy page arrives before the second one: the hold goes on.
    render(2, true);
    wait(PAUSE_MS - 1);
    expect(passes).toEqual([0]);
    wait(1);
    expect(passes).toEqual([0, 2]);
  });

  it('after a pause the release of the same value starts no second pass', () => {
    render(0, true);
    render(5, true);
    wait(PAUSE_MS);
    render(5, false);
    wait(10 * PAUSE_MS);
    expect(passes).toEqual([0, 5]);
  });

  it('a value that comes after a pause is held again, from the value shown at the pause', () => {
    render(0, true);
    render(1, true);
    wait(PAUSE_MS);
    render(2, true);
    expect(passes).toEqual([0, 1]);
    expect(waiting).toBe(true);
    render(2, false);
    expect(passes).toEqual([0, 1, 2]);
  });

  it('a second hold starts from the value the first one ended with, not from an older one', () => {
    render(0, true);
    render(1, true);
    render(1, false);
    render(1, true);
    expect(passes).toEqual([0, 1]);
    expect(waiting).toBe(false);
    render(2, true);
    expect(passes).toEqual([0, 1]);
    render(2, false);
    expect(passes).toEqual([0, 1, 2]);
  });

  it('a value changed without a hold between two holds is shown at once and kept at the next hold', () => {
    render(0, true);
    render(1, true);
    render(1, false);
    render(7, false);
    render(7, true);
    render(8, true);
    expect(passes).toEqual([0, 1, 7]);
  });

  it('coming back to the shown value while held ends the wait without a pass', () => {
    render(0, true);
    render(1, true);
    expect(waiting).toBe(true);
    render(0, true);
    expect(waiting).toBe(false);
    wait(10 * PAUSE_MS);
    expect(passes).toEqual([0]);
  });
});
