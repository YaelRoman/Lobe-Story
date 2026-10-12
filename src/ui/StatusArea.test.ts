// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useStore } from '../state/store';
import { CLEAN_LOAD_MS, StatusArea } from './StatusArea';
import { planetText } from '../test/planetText';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const enc = new TextEncoder();
const file = (path: string, freq: number) => ({ path, bytes: enc.encode(planetText({ headers: ['NAME X', `FREQUENCY ${freq}`, 'GAIN 15 dBd', 'TILT ELECTRICAL'] })).buffer as ArrayBuffer });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  useStore.setState(initialState());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(createElement(StatusArea, { hasErrors: false })));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const note = () => host.querySelector('[data-testid="copy-note"]');

describe('the copy note', () => {
  it('floats as a toast instead of a stacked status bar', () => {
    act(() => useStore.getState().setCopyNote('Copied 24 rows'));
    expect(note()?.className).toBe('copy-toast');
    expect(note()?.textContent).toBe('Copied 24 rows');
    expect(host.querySelector('.load-message')).toBeNull();
  });

  it('goes when the next status line appears, and when an undo is offered', () => {
    act(() => useStore.getState().setCopyNote('Copied 1 row'));
    act(() => useStore.getState().addFiles([file('a.MSI', 1800), file('b.MSI', 1900)]));
    expect(note()).toBeNull();
    act(() => useStore.getState().setCopyNote('Copied 1 row'));
    expect(note()).not.toBeNull();
    act(() => useStore.getState().removeFile('a.MSI'));
    expect(note()).toBeNull();
    expect(host.querySelector('[data-testid="undo-toast"]')).not.toBeNull();
  });

  it('survives the fade of an older status line', () => {
    act(() => useStore.getState().setLoadMessage('Loaded 2 files', 'info'));
    act(() => useStore.getState().setCopyNote('Copied 1 row'));
    act(() => useStore.getState().setLoadMessage(null));
    expect(note()?.textContent).toBe('Copied 1 row');
  });
});

describe('one status bar, and an undo offer that takes no room', () => {
  const bars = () => Array.from(host.querySelectorAll('.load-message'));
  const status = () => host.querySelector('[data-testid="load-status"]');
  const offer = () => host.querySelector('[data-testid="undo-toast"]');
  const said = () => host.querySelector('[data-testid="announcer"]')?.textContent ?? '';

  it('an undo offer is not a bar in the flow: it neither stacks under a calm load line nor removes it', () => {
    act(() => useStore.getState().addFiles([file('a.MSI', 1800), file('b.MSI', 1900)]));
    act(() => useStore.getState().setLoadMessage('Loaded 2 files', 'info'));
    expect(status()).not.toBeNull();
    expect(bars()).toHaveLength(1);
    // "Show all" keeps the load line in the store: the two bars used to stack.
    act(() => useStore.getState().setVisibleOnly(['a.MSI', 'b.MSI'], 'Showed all files'));
    expect(offer()).not.toBeNull();
    expect(offer()?.classList.contains('load-message')).toBe(false);
    // The line stays where it is (taking it away would move the page under the pointer that made the offer).
    expect(status()?.textContent).toContain('Loaded 2 files');
    expect(bars()).toHaveLength(1);
    // Both are still read out.
    expect(said()).toContain('Loaded 2 files');
    expect(said()).toContain('Showed all files');
    // The offer hidden: the line is as it was, neither removed nor brought back.
    act(() => useStore.getState().fadeUndo());
    expect(offer()).toBeNull();
    expect(status()?.textContent).toContain('Loaded 2 files');
    expect(bars()).toHaveLength(1);
  });

  it('hiding an offer does not bring back a load line that has run out', () => {
    act(() => useStore.getState().addFiles([file('a.MSI', 1800), file('b.MSI', 1900)]));
    act(() => useStore.getState().setLoadMessage('Loaded 2 files', 'info'));
    act(() => useStore.getState().setVisibleOnly(['a.MSI', 'b.MSI'], 'Showed all files'));
    act(() => useStore.getState().setLoadMessage(null));
    expect(status()).toBeNull();
    act(() => useStore.getState().fadeUndo());
    expect(status()).toBeNull();
    expect(bars()).toHaveLength(0);
  });

  it('a warning stays: it needs to be read and may carry Show errors', () => {
    act(() => useStore.getState().addFiles([file('a.MSI', 1800), file('b.MSI', 1900)]));
    act(() => useStore.getState().setLoadMessage('1 file failed', 'warn'));
    act(() => useStore.getState().setVisibleOnly(['a.MSI', 'b.MSI'], 'Showed all files'));
    expect(status()?.textContent).toContain('1 file failed');
    expect(offer()).not.toBeNull();
    expect(bars()).toHaveLength(1);
  });
});

describe('the calm load line goes by itself, but not from under a held pointer', () => {
  const status = () => host.querySelector('[data-testid="load-status"]');
  const pointer = (type: string) => act(() => void document.body.dispatchEvent(new Event(type, { bubbles: true })));
  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  beforeEach(() => {
    vi.useFakeTimers();
    act(() => useStore.getState().setLoadMessage('Loaded 2 files', 'info'));
  });
  afterEach(() => vi.useRealTimers());

  it('goes after its time when no pointer is down', () => {
    wait(CLEAN_LOAD_MS - 1);
    expect(status()).not.toBeNull();
    wait(1);
    expect(status()).toBeNull();
  });

  it('stays while a pointer is down (a slider is being dragged: the page must not move under it) and goes at pointer up', () => {
    wait(CLEAN_LOAD_MS - 1000);
    pointer('pointerdown');
    wait(5000);
    expect(status()).not.toBeNull();
    pointer('pointerup');
    // After the click that the release may end (a line removed before it would move the page under that click).
    wait(0);
    expect(status()).toBeNull();
  });

  it('a cancelled pointer lets it go as well', () => {
    pointer('pointerdown');
    wait(CLEAN_LOAD_MS + 1);
    expect(status()).not.toBeNull();
    pointer('pointercancel');
    wait(0);
    expect(status()).toBeNull();
  });

  it('a press and release before its time changes nothing', () => {
    pointer('pointerdown');
    pointer('pointerup');
    wait(CLEAN_LOAD_MS - 1);
    expect(status()).not.toBeNull();
    wait(1);
    expect(status()).toBeNull();
  });

  it('a line that came after the release of the held pointer is not taken with the old one', () => {
    pointer('pointerdown');
    wait(CLEAN_LOAD_MS + 1);
    act(() => useStore.getState().setLoadMessage('Loaded 3 files', 'info'));
    pointer('pointerup');
    wait(0);
    expect(status()?.textContent).toContain('Loaded 3 files');
    wait(CLEAN_LOAD_MS);
    expect(status()).toBeNull();
  });
});
