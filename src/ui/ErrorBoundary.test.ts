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

    describe('focus and logging', () => {
      beforeEach(() => document.body.appendChild(host));
      afterEach(() => host.remove());
      const heading = () => host.querySelector<HTMLElement>('[role="alert"] [tabindex="-1"]');

      it('takes the focus to its heading when the failed plot leaves the focus nowhere', () => {
        function Focused() {
          if (failure !== null) throw new Error(failure);
          return createElement('button', { 'data-testid': 'inside' }, 'inside the plot');
        }
        render(createElement(PlotBoundary, null, createElement(Focused)));
        host.querySelector<HTMLElement>('[data-testid="inside"]')!.focus();
        expect(document.activeElement?.textContent).toBe('inside the plot');
        failure = 'gone';
        render(createElement(PlotBoundary, null, createElement(Focused)));
        expect(heading()!.textContent).toBe('This plot could not be drawn');
        expect(document.activeElement).toBe(heading());
      });

      it('takes the focus when the plot fails as the page is first drawn (nothing has the focus)', () => {
        failure = 'at once';
        render(page());
        expect(document.activeElement).toBe(heading());
      });

      it('leaves the focus on the control the user is on (the message is announced as an alert)', () => {
        const tree = () => createElement('div', null, createElement('input', { 'data-testid': 'tilt' }), createElement(PlotBoundary, null, createElement(Plot)));
        render(tree());
        const input = host.querySelector<HTMLElement>('[data-testid="tilt"]')!;
        input.focus();
        failure = 'while typing';
        render(tree());
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        expect(document.activeElement).toBe(input);
      });

      it('of two plots failing together the first takes the focus', () => {
        failure = 'both';
        render(createElement('div', null, createElement(PlotBoundary, null, createElement(Plot)), createElement(PlotBoundary, null, createElement(Plot))));
        const headings = host.querySelectorAll<HTMLElement>('[role="alert"] [tabindex="-1"]');
        expect(headings).toHaveLength(2);
        expect(document.activeElement).toBe(headings[0]);
      });

      it('logs the error it caught', () => {
        failure = 'log me';
        render(page());
        const logged = vi.mocked(console.error).mock.calls.find((call) => call[0] === 'A plot could not be drawn');
        expect(logged).toBeDefined();
        expect((logged![1] as Error).message).toBe('log me');
        expect(typeof logged![2]).toBe('string');
      });
    });

    describe('reset keys (what the plot is made from)', () => {
      let renders = 0;
      function Counted() {
        renders++;
        return createElement(Plot);
      }
      const keyed = (...resetKeys: unknown[]) => createElement(PlotBoundary, { resetKeys }, createElement(Counted));
      beforeEach(() => {
        renders = 0;
      });

      it('clears the message by itself when a key changes, and draws the plot', () => {
        const figure = { data: [] };
        failure = 'bad figure';
        render(keyed(figure, 'polar'));
        expect(host.querySelector('[role="alert"]')!.textContent).toContain('bad figure');
        // The same inputs again (the page re-renders for another reason): the message stays, the plot is not tried again.
        failure = null;
        const tried = renders;
        render(keyed(figure, 'polar'));
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        expect(renders).toBe(tried);
        // Another plot type: the plot is drawn without "Try again".
        render(keyed(figure, 'rect'));
        expect(host.querySelector('[role="alert"]')).toBeNull();
        expect(host.querySelector('[data-testid="drawn"]')).not.toBeNull();
      });

      it('shows the new error when the changed inputs fail as well, without trying over and over', () => {
        failure = 'first';
        render(keyed(1));
        failure = 'second';
        const tried = renders;
        render(keyed(2));
        expect(host.querySelector('[role="alert"]')!.textContent).toContain('second');
        // One attempt for the new inputs (React itself renders a failing component twice before giving up).
        expect(renders - tried).toBeLessThanOrEqual(2);
        const settled = renders;
        render(keyed(2));
        expect(renders).toBe(settled);
      });

      it('a different number of keys counts as a change; without keys only "Try again" clears it', () => {
        failure = 'x';
        render(keyed(1));
        failure = null;
        render(keyed(1, 2));
        expect(host.querySelector('[role="alert"]')).toBeNull();
        failure = 'y';
        render(page());
        failure = null;
        render(page());
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
      });

      it('tells its owner that the plot failed', () => {
        const onError = vi.fn();
        failure = 'x';
        render(createElement(PlotBoundary, { onError }, createElement(Plot)));
        expect(onError).toHaveBeenCalledTimes(1);
      });
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

    it('takes the focus to its heading and logs the error', () => {
      document.body.appendChild(host);
      try {
        render(createElement(AppBoundary, { reload }, createElement('div', null, createElement('input', { 'data-testid': 'box' }), createElement(Plot))));
        host.querySelector<HTMLElement>('[data-testid="box"]')!.focus();
        failure = 'render exploded';
        render(createElement(AppBoundary, { reload }, createElement('div', null, createElement('input', { 'data-testid': 'box' }), createElement(Plot))));
        const h1 = host.querySelector('h1')!;
        expect(h1.getAttribute('tabindex')).toBe('-1');
        expect(document.activeElement).toBe(h1);
        const logged = vi.mocked(console.error).mock.calls.find((call) => call[0] === 'The app stopped on an error');
        expect(logged).toBeDefined();
        expect((logged![1] as Error).message).toBe('render exploded');
      } finally {
        host.remove();
      }
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
