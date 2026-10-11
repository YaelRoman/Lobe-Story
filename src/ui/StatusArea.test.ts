// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialState, useStore } from '../state/store';
import { StatusArea } from './StatusArea';
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
