// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COARSE_QUERY, PHONE_QUERY, SHORT_QUERY, TOUCH_ONLY_QUERY, isPhoneLayout, isShortWindow, isTouchOnly, useCoarsePointer, usePhoneLayout, useTouchOnly } from './phoneLayout';

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

describe('a device with touch only (no keyboard is likely): asked of the input, not of the width', () => {
  /** A `matchMedia` that answers each query by itself. */
  const stubQueries = (answers: Record<string, boolean>) => vi.stubGlobal('matchMedia', (query: string) => ({ matches: answers[query] ?? false, addEventListener: () => {}, removeEventListener: () => {} }));

  it('is a primary pointer that is coarse and cannot hover', () => {
    expect(TOUCH_ONLY_QUERY).toBe('(hover: none) and (pointer: coarse)');
  });

  it('a wide touch screen is touch only and not laid out for a phone', () => {
    stubQueries({ [TOUCH_ONLY_QUERY]: true, [PHONE_QUERY]: false });
    expect(isTouchOnly()).toBe(true);
    expect(isPhoneLayout()).toBe(false);
  });

  it('a narrow window on a desktop is laid out for a phone and not touch only', () => {
    stubQueries({ [TOUCH_ONLY_QUERY]: false, [PHONE_QUERY]: true });
    expect(isTouchOnly()).toBe(false);
    expect(isPhoneLayout()).toBe(true);
  });

  it('is not assumed where the browser cannot say', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(isTouchOnly()).toBe(false);
  });

  it('the hook follows a change (a keyboard or a mouse attached), and stops listening when unmounted', () => {
    const media = stubMatchMedia(true);
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useTouchOnly());
      return null;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(Probe)));
    expect(seen[seen.length - 1]).toBe(true);
    expect(media.matchMedia).toHaveBeenCalledWith(TOUCH_ONLY_QUERY);
    act(() => media.set(false));
    expect(seen[seen.length - 1]).toBe(false);
    act(() => root.unmount());
    expect(media.listeners.size).toBe(0);
  });
});

describe('a coarse pointer (a finger): asked of the input, whatever the width and whether a mouse is there too', () => {
  it('is the primary pointer being coarse', () => {
    expect(COARSE_QUERY).toBe('(pointer: coarse)');
  });

  it('the hook follows a change, and is false where the browser cannot say', () => {
    const media = stubMatchMedia(true);
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useCoarsePointer());
      return null;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(createElement(Probe)));
    expect(seen[seen.length - 1]).toBe(true);
    expect(media.matchMedia).toHaveBeenCalledWith(COARSE_QUERY);
    act(() => media.set(false));
    expect(seen[seen.length - 1]).toBe(false);
    act(() => root.unmount());
    expect(media.listeners.size).toBe(0);
  });
});

describe('a short window: asked of the height and of the drawer layout together', () => {
  it('is one media query', () => {
    stubMatchMedia(true);
    expect(isShortWindow()).toBe(true);
    expect(SHORT_QUERY).toBe('(max-height: 600px) and (max-width: 760px)');
  });
});
