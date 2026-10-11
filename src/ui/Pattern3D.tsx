import { useCallback, useDeferredValue, useMemo, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Layout } from 'plotly.js-dist-min';
import { useStore } from '../state/store';
import { gridsFor, type TaggedPattern } from '../core/analysis/metrics';
import { reconstructTilted3d } from '../core/analysis/tilt';
import { nameOf } from '../core/names';
import { buildSurfaceFigure, linkedCameraUpdate, maxSurfaces, type SurfaceSeries } from './surfaceFigure';
import { capItems, capNotice } from './viewCaps';
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

  // At most `cap` surfaces are ever built or drawn (the highlighted file first, then ticked files in panel order).
  const highlighted = useStore((s) => s.highlighted);
  const cap = maxSurfaces(layout);
  const capped = useMemo(() => capItems(items, cap, highlighted), [items, cap, highlighted]);
  // The surfaces follow the ticks a moment later, so a click on a checkbox is answered before the 3D redraw starts.
  const drawn = useDeferredValue(capped.shown);
  const updating = drawn !== capped.shown;

  const series = useMemo<SurfaceSeries[]>(
    () =>
      drawn.map(({ pattern }) => {
        const g = gridsFor(pattern);
        const e = effective(pattern.id);
        return {
          id: pattern.id,
          label: `${pattern.frequencyMHz} MHz · ${nameOf(pattern)}`,
          color: colors.get(pattern.id) ?? '#888888',
          surface: reconstructTilted3d(g.h, g.v, e, e.azimuthDeg, method),
        };
      }),
    [drawn, colors, method, effective],
  );

  const figure = useMemo(
    () => buildSurfaceFigure({ series, layout, floorDb, theme: FIGURE_THEMES[theme] }),
    [series, layout, floorDb, theme],
  );

  const notice = capNotice(layout === 'grid' ? 'The side-by-side 3D view draws' : 'The 3D overlay draws', capped.shown.length, capped.total, cap);
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
        {updating ? ' Updating the 3D view…' : ''}
      </p>
      {notice && (
        <p className="count cap-notice" data-testid="cap-notice-3d">
          {notice}
        </p>
      )}
      <PlotlyChart className="plot plot3d" figure={figure} onRelayout={onRelayout} testId="plot-3d" ariaLabel="3D radiation pattern" />
    </>
  );
}
