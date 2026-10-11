// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileSetSwapCount, initialState, useStore } from '../state/store';
import { parseProject, serializeProject } from '../state/project';
import { useSessionSwap } from './useSessionSwap';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useSessionSwap', () => {
  let root: Root;
  let calls = 0;
  const Probe = () => {
    useSessionSwap(() => calls++);
    return null;
  };
  beforeEach(() => {
    useStore.setState(initialState());
    calls = 0;
    root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe)));
  });
  afterEach(() => act(() => root.unmount()));

  it('fires for Clear, an undo and a project opened, and not for an ordinary change', () => {
    act(() => useStore.getState().toggleVisible('x'));
    act(() => useStore.getState().updateView({ cut: 'H' }));
    expect(calls).toBe(0);
    const before = fileSetSwapCount();
    act(() => useStore.getState().clear());
    expect(calls).toBe(1);
    expect(fileSetSwapCount()).toBe(before + 1);
    const parsed = parseProject(serializeProject(initialState() as never, false));
    if (!parsed.ok) throw new Error(parsed.error);
    act(() => useStore.getState().loadProject(parsed.project));
    expect(calls).toBe(2);
    // An undo that only restores per-file state (names, here) keeps the list's filter and folds.
    useStore.setState({ undo: { label: 'x', snapshot: { ...initialState(), names: { a: 'A' } } } as never });
    act(() => useStore.getState().undoLast());
    expect(calls).toBe(2);
    // One that brings other files back resets them.
    const file = { id: 'f', path: 'f.msi', result: { ok: false } };
    useStore.setState({ undo: { label: 'x', snapshot: { ...initialState(), files: [file] } } as never });
    act(() => useStore.getState().undoLast());
    expect(calls).toBe(3);
  });
});
