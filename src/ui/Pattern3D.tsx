import { useCallback, useMemo, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Layout } from 'plotly.js-dist-min';
import { useStore } from '../state/store';
import { gridsFor, type TaggedPattern } from '../core/analysis/metrics';
import { reconstructTilted3d } from '../core/analysis/tilt';
import { nameOf } from '../core/names';
import { buildSurfaceFigure, linkedCameraUpdate, MAX_3D, type SurfaceSeries } from './surfaceFigure';
import { FIGURE_THEMES } from './figureTheme';
import { PlotlyChart } from './PlotlyChart';
import type { SimulationResult } from './useSimulation';

export function Pattern3D({
  items,
  colors,
  sim,
}: {
  items: TaggedPattern[];
  colors: Map<string, string>;
  sim: SimulationResult;
}) {
  const method = useStore((s) => s.view.method3d);
  const layout = useStore((s) => s.view.layout3d);
  const floorDb = useStore((s) => s.view.floorDb);
  const theme = useStore((s) => s.view.theme);
  const { effective } = sim;

  // MAX_3D only caps the side-by-side grid (one scene per file); Overlay draws every visible
  // file in its single shared scene.
  const series = useMemo<SurfaceSeries[]>(
    () =>
      (layout === 'grid' ? items.slice(0, MAX_3D) : items).map(({ pattern }) => {
        const g = gridsFor(pattern);
        const e = effective(pattern.id);
        return {
          id: pattern.id,
          label: `${pattern.frequencyMHz} MHz · ${nameOf(pattern)}`,
          color: colors.get(pattern.id) ?? '#888888',
          surface: reconstructTilted3d(g.h, g.v, e, e.azimuthDeg, method),
        };
      }),
    [items, colors, method, effective, layout],
  );

  const figure = useMemo(
    () => buildSurfaceFigure({ series, layout, floorDb, theme: FIGURE_THEMES[theme] }),
    [series, layout, floorDb, theme],
  );

  const sceneCount = layout === 'grid' ? series.length : 1;
  // Our own relayout fires plotly_relayout again; skipping a camera we just applied prevents a loop.
  const lastCamera = useRef('');
  const onRelayout = useCallback(
    (el: HTMLElement, update: Record<string, unknown>) => {
      const next = linkedCameraUpdate(update, sceneCount);
      if (!next) return;
      const camera = JSON.stringify(Object.values(next)[0]);
      if (camera === lastCamera.current) return;
      lastCamera.current = camera;
      void Plotly.relayout(el, next as Partial<Layout>);
    },
    [sceneCount],
  );

  return (
    <>
      <p className="count">
        3D shape reconstructed from the H and V cuts ({method === 'summation' ? 'summation' : 'weighted, Gil et al.'}
        ); an estimate, not measured data.
        {layout === 'grid' && items.length > MAX_3D ? ` Showing the first ${MAX_3D} of ${items.length}.` : ''}
      </p>
      <PlotlyChart className="plot plot3d" figure={figure} onRelayout={onRelayout} testId="plot-3d" ariaLabel="3D radiation pattern" />
    </>
  );
}
