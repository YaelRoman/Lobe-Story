// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHONE_QUERY, isPhoneLayout, usePhoneLayout } from './phoneLayout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A `matchMedia` whose answer the test sets, and that tells its listeners. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const list = { matches, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) };
  const matchMedia = vi.fn(() => list);
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    matchMedia,
    listeners,
    set(next: boolean) {
      list.matches = next;
      for (const fn of [...listeners]) fn();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('the phone layout (the width at which the stylesheet switches to one column)', () => {
  it('is asked of the same media query as the stylesheet uses', () => {
    const media = stubMatchMedia(true);
    expect(isPhoneLayout()).toBe(true);
    expect(media.matchMedia).toHaveBeenCalledWith(PHONE_QUERY);
    expect(PHONE_QUERY).toBe('(max-width: 760px)');
  });

  it('is not assumed where the browser cannot say (no matchMedia)', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(isPhoneLayout()).toBe(false);
  });

  it('the hook follows the window across the width, and stops listening when unmounted', () => {
    const media = stubMatchMedia(false);
    const seen: boolean[] = [];
    function Probe() {
      seen.push(usePhoneLayout());
      return null;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(Probe)));
    expect(seen[seen.length - 1]).toBe(false);
    act(() => media.set(true));
    expect(seen[seen.length - 1]).toBe(true);
    act(() => root.unmount());
    expect(media.listeners.size).toBe(0);
  });
});
