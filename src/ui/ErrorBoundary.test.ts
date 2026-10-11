// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppBoundary, PlotBoundary } from './ErrorBoundary';
import { downloadText } from './download';
import { initialState, useStore } from '../state/store';
import { parseProject } from '../state/project';
import { planetText } from '../test/planetText';

vi.mock('./download', () => ({ downloadText: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What the component under test does next: throw this message, or render. */
let failure: string | null = null;
function Plot() {
  if (failure !== null) throw new Error(failure);
  return createElement('div', { 'data-testid': 'drawn' }, 'drawn');
}

describe('error boundaries', () => {
  let host: HTMLDivElement;
  let root: Root;
  const render = (node: ReactNode) => act(() => root.render(node));
  const button = (name: string) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === name);
  const click = (name: string) => act(() => button(name)!.click());

  beforeEach(() => {
    failure = null;
    vi.mocked(downloadText).mockReset();
    useStore.setState(initialState());
    // React reports every caught render error on the console; that is expected here.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    host = document.createElement('div');
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
  });

  describe('PlotBoundary', () => {
    const page = () =>
      createElement(
        'div',
        null,
        createElement('header', { 'data-testid': 'toolbar' }, 'toolbar'),
        createElement(PlotBoundary, { className: 'plot' }, createElement(Plot)),
        createElement('table', { 'data-testid': 'table' }),
      );

    it('shows its children while they render', () => {
      render(page());
      expect(host.querySelector('[data-testid="drawn"]')).not.toBeNull();
      expect(host.querySelector('[role="alert"]')).toBeNull();
    });

    it('replaces a plot that throws by a message with the error, and leaves the rest of the page alone', () => {
      failure = `'.cba (2).msi' is not a valid selector`;
      render(page());
      const alert = host.querySelector('[role="alert"]')!;
      expect(alert.textContent).toContain('This plot could not be drawn');
      expect(alert.textContent).toContain(`'.cba (2).msi' is not a valid selector`);
      expect(alert.className).toContain('plot');
      expect(host.querySelector('[data-testid="toolbar"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="table"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="drawn"]')).toBeNull();
    });

    it('"Try again" draws the plot again, and shows the message again when it still fails', () => {
      failure = 'first';
      render(page());
      failure = 'second';
      click('Try again');
      expect(host.querySelector('[role="alert"]')!.textContent).toContain('second');
      failure = null;
      click('Try again');
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(host.querySelector('[data-testid="drawn"]')).not.toBeNull();
    });

    it('catches what a plot throws from an effect and from its clean-up', async () => {
      const { useEffect } = await import('react');
      let throwOnCleanup = false;
      function Effectful() {
        useEffect(() => {
          if (failure !== null) throw new Error(failure);
          return () => {
            if (throwOnCleanup) throw new Error('clean-up failed');
          };
        });
        return createElement('div', { 'data-testid': 'drawn' });
      }
      const tree = (key: number) => createElement(PlotBoundary, null, createElement(Effectful, { key }));
      failure = 'draw failed';
      render(tree(1));
      expect(host.querySelector('[role="alert"]')!.textContent).toContain('draw failed');
      failure = null;
      click('Try again');
      expect(host.querySelector('[role="alert"]')).toBeNull();
      throwOnCleanup = true;
      render(tree(2));
      expect(host.querySelector('[role="alert"]')!.textContent).toContain('clean-up failed');
    });
  });

  describe('AppBoundary', () => {
    const reload = vi.fn();
    const app = () => createElement(AppBoundary, { reload }, createElement(Plot));
    beforeEach(() => reload.mockReset());

    it('shows the app while it renders', () => {
      render(app());
      expect(host.querySelector('[data-testid="drawn"]')).not.toBeNull();
    });

    it('keeps a minimal screen with the error, "Save project" and "Reload" when the app throws', () => {
      failure = 'render exploded';
      render(app());
      const screen = host.querySelector('[role="alert"]')!;
      expect(screen.textContent).toContain('render exploded');
      expect(button('Save project')).toBeDefined();
      click('Reload');
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('"Save project" saves the current session, files included, as a project that opens again', () => {
      act(() => useStore.getState().addFiles([{ path: 'a (2).msi', bytes: new TextEncoder().encode(planetText()).buffer as ArrayBuffer }]));
      expect(useStore.getState().files).toHaveLength(1);
      failure = 'render exploded';
      render(app());
      click('Save project');
      expect(downloadText).toHaveBeenCalledTimes(1);
      const [name, text, mime] = vi.mocked(downloadText).mock.calls[0];
      expect(name).toMatch(/^lobe-story-\d{4}-\d{2}-\d{2}\.lobestory\.json$/);
      expect(mime).toBe('application/json');
      const parsed = parseProject(text);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.project.files.map((f) => [f.path, f.text])).toEqual([['a (2).msi', planetText()]]);
      expect(host.textContent).toContain('Project saved');
    });

    it('says so when the project cannot be saved', () => {
      vi.mocked(downloadText).mockImplementation(() => {
        throw new Error('no disk');
      });
      failure = 'render exploded';
      render(app());
      click('Save project');
      expect(host.textContent).toContain('Could not save the project');
    });
  });
});
