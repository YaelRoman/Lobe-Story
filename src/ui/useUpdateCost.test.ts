// @vitest-environment jsdom
import { act, createElement, createRef, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateCost, type UpdateCost } from './updateHint';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let now = 0;
let visibility: DocumentVisibilityState = 'visible';
const cost: RefObject<UpdateCost | null> = createRef<UpdateCost | null>() as RefObject<UpdateCost | null>;

function Probe({ updating, traces }: { updating: boolean; traces: number }) {
  useUpdateCost(cost, updating, traces);
  return null;
}
const render = (updating: boolean, traces = 100) => act(() => root.render(createElement(Probe, { updating, traces })));
const hide = () => {
  visibility = 'hidden';
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

beforeEach(() => {
  now = 1000;
  visibility = 'visible';
  (cost as { current: UpdateCost | null }).current = null;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

describe('useUpdateCost', () => {
  it('notes how long a redraw took and how many traces it drew, when it ends', () => {
    render(false);
    render(true, 120);
    expect(cost.current).toBeNull();
    now = 1450;
    render(false, 120);
    expect(cost.current).toEqual({ ms: 450, traces: 120 });
  });

  it('skips a redraw that ran while the page was hidden (at the start, during, or at the end)', () => {
    // Hidden when it starts.
    visibility = 'hidden';
    render(true);
    now = 9000;
    visibility = 'visible';
    render(false);
    expect(cost.current).toBeNull();

    // Hidden at some moment during it, visible again at the end.
    now = 10_000;
    render(true);
    hide();
    now = 20_000;
    visibility = 'visible';
    render(false);
    expect(cost.current).toBeNull();

    // Hidden when it ends.
    now = 30_000;
    render(true);
    now = 40_000;
    visibility = 'hidden';
    render(false);
    expect(cost.current).toBeNull();

    // A later redraw on a visible page is timed again.
    visibility = 'visible';
    now = 50_000;
    render(true, 80);
    now = 50_200;
    render(false, 80);
    expect(cost.current).toEqual({ ms: 200, traces: 80 });
  });
});
