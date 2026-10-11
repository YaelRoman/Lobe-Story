// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hoverStore, setHoverId } from './hoverPreview';
import { useTablePreview } from './useTablePreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let preview: (id: string | null) => void = () => {};
function Probe({ ids }: { ids: string[] }) {
  preview = useTablePreview(ids);
  return null;
}

describe('useTablePreview', () => {
  let root: Root;
  const render = (ids: string[]) => act(() => root.render(createElement(Probe, { ids })));
  beforeEach(() => {
    setHoverId(null);
    root = createRoot(document.createElement('div'));
  });
  afterEach(() => act(() => root.unmount()));

  it('ends the preview of a row that leaves the table while it is previewed (removed, then undone)', () => {
    render(['a', 'b']);
    act(() => preview('b'));
    expect(hoverStore.getState().id).toBe('b');
    render(['a']);
    expect(hoverStore.getState().id).toBeNull();
    render(['a', 'b']);
    expect(hoverStore.getState().id).toBeNull();
  });

  it('keeps the preview while the row stays, and one that the panel started', () => {
    render(['a', 'b']);
    act(() => preview('a'));
    render(['a', 'b', 'c']);
    expect(hoverStore.getState().id).toBe('a');
    act(() => preview(null));
    setHoverId('z');
    render(['a']);
    expect(hoverStore.getState().id).toBe('z');
  });

  it('ends its preview when the table goes away', () => {
    render(['a']);
    act(() => preview('a'));
    act(() => root.unmount());
    expect(hoverStore.getState().id).toBeNull();
    root = createRoot(document.createElement('div'));
  });
});
