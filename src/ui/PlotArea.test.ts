// @vitest-environment jsdom
import { act, createElement, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, useStore } from '../state/store';
import { buildPanelGroups, selectInstances } from '../state/selectors';
import { analyzeAll } from '../core/analysis/metrics';
import { styleMapByGroup } from './colors';
import { useSimulation } from './useSimulation';
import { planetText } from '../test/planetText';
import { PlotArea } from './PlotArea';

// The charting library needs a real browser: the charts are stand-ins here, the figure builders are the real ones.
vi.mock('./PlotlyChart', () => ({ PlotlyChart: ({ testId }: { testId?: string }) => createElement('div', { 'data-testid': testId }) }));
vi.mock('./Pattern3D', () => ({ Pattern3D: () => createElement('div', { 'data-testid': 'plot-3d' }) }));
const builder = vi.hoisted(() => ({ failure: null as string | null }));
vi.mock('./cutFigure', async (original) => {
  const real = await original<typeof import('./cutFigure')>();
  return {
    ...real,
    buildCutBase: (...args: Parameters<typeof real.buildCutBase>) => {
      if (builder.failure !== null) throw new Error(builder.failure);
      return real.buildCutBase(...args);
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NO_HELP = () => {};

/** The plot area fed as the app feeds it. */
function Harness() {
  const s = useStore();
  const tagged = useMemo(() => selectInstances(s.files, s.tagOverrides, s.copies, s.names, s.membership), [s.files, s.tagOverrides, s.copies, s.names, s.membership]);
  const groups = useMemo(() => buildPanelGroups(tagged, s.customGroups), [tagged, s.customGroups]);
  const metrics = useMemo(() => analyzeAll(tagged, s.settings), [tagged, s.settings]);
  const sim = useSimulation(tagged, metrics, s.settings);
  const styles = useMemo(() => styleMapByGroup(groups.map((g) => ({ ids: g.items.map((i) => i.pattern.id) })), s.visible), [groups, s.visible]);
  const colors = useMemo(() => new Map([...styles].map(([id, st]) => [id, st.color])), [styles]);
  return createElement(PlotArea, { groups, metrics, colors, styles, sim, simLag: 'none', simStale: false, onHelp: NO_HELP });
}

describe('PlotArea: a figure that cannot be built', () => {
  let host: HTMLDivElement;
  let root: Root;
  const alert = () => host.querySelector('[role="alert"]');
  const pressed = (name: string) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === name)?.getAttribute('aria-pressed');

  beforeEach(() => {
    builder.failure = null;
    useStore.setState(initialState());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => useStore.getState().addFiles([{ path: 'a.msi', bytes: new TextEncoder().encode(planetText()).buffer as ArrayBuffer }]));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('draws both cuts when the figures build', async () => {
    await act(async () => root.render(createElement(Harness)));
    expect(host.querySelector('[data-testid="plot-h"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="plot-v"]')).not.toBeNull();
    expect(alert()).toBeNull();
  });

  it('shows the error in the place of the plots, keeps the plot controls, and clears itself when the plot type changes', async () => {
    builder.failure = 'cannot build this figure';
    await act(async () => root.render(createElement(Harness)));
    expect(alert()!.textContent).toContain('This plot could not be drawn');
    expect(alert()!.textContent).toContain('cannot build this figure');
    expect(host.querySelector('[data-testid="plot-h"]')).toBeNull();
    // Dimension, cut, plot type and the markers are still there to change what is drawn.
    expect(pressed('2D')).toBe('true');
    expect(pressed('Both')).toBe('true');
    expect(pressed('Polar')).toBe('true');
    expect(Array.from(host.querySelectorAll('button')).some((b) => b.textContent?.includes('Markers'))).toBe(true);
    expect(host.querySelector('.sim-bar')).not.toBeNull();

    // Still failing with other inputs: the new attempt shows its own error.
    builder.failure = 'still cannot';
    await act(async () => useStore.getState().updateView({ floorDb: 30 }));
    expect(alert()!.textContent).toContain('still cannot');

    // The cause is gone and the plot type changes: no "Try again" needed.
    builder.failure = null;
    await act(async () => useStore.getState().updateView({ mode: 'rect' }));
    expect(alert()).toBeNull();
    expect(pressed('Rectangular')).toBe('true');
    expect(host.querySelector('[data-testid="plot-h"]')).not.toBeNull();
  });
});
