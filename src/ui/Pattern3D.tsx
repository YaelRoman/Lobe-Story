import { useCallback, useDeferredValue, useMemo, useRef, useSyncExternalStore } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Layout } from 'plotly.js-dist-min';
import { useStore } from '../state/store';
import { gridsFor, type TaggedPattern } from '../core/analysis/metrics';
import { reconstructTilted3d } from '../core/analysis/tilt';
import { nameOf } from '../core/names';
import { buildSurfaceFigure, gridHeightPx, linkedCameraUpdate, maxSurfaces, viewportClass, type SurfaceSeries } from './surfaceFigure';
import { capItems, capNotice, surfaceExportCaption } from './viewCaps';
import { FIGURE_THEMES } from './figureTheme';
import { PlotlyChart } from './PlotlyChart';
import type { SimulationResult } from './useSimulation';
import { withSimulated } from './exportFigure';
import { pictureName, simulatedCaption } from './simSummary';
import { WAITING_NOTE_3D } from './updateHint';

const subscribeResize = (cb: () => void) => {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
};
/** The window's width class (see `viewportClass`): changes only when a phone layout starts or ends or the window crosses a 100 px step. */
const useWidthClass = (): number | undefined => useSyncExternalStore(subscribeResize, () => viewportClass(window.innerWidth), () => undefined);

export function Pattern3D({
  items,
  colors,
  sim,
  waiting,
}: {
  items: TaggedPattern[];
  colors: Map<string, string>;
  sim: SimulationResult;
  /** The simulation waits for a dragged slider to stop (see `SimLag`). */
  waiting: boolean;
}) {
  const method = useStore((s) => s.view.method3d);
  const layout = useStore((s) => s.view.layout3d);
  const floorDb = useStore((s) => s.view.floorDb);
  const theme = useStore((s) => s.view.theme);
  const { effective } = sim;
  const viewportWidth = useWidthClass();

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
    () => buildSurfaceFigure({ series, layout, floorDb, theme: FIGURE_THEMES[theme], viewportWidth }),
    [series, layout, floorDb, theme, viewportWidth],
  );

  const notice = capNotice(layout === 'grid' ? 'The side-by-side 3D view draws' : 'The 3D overlay draws', capped.shown.length, capped.total, cap);
  // Only the surfaces drawn count: an offset on a file that is not drawn does not make the picture simulated.
  // The 3D view does not depend on the horizontal cut shown.
  const simulated = sim.simulatedAmong(drawn.map((i) => i.pattern.id), false);
  const exportCaption = useMemo(() => surfaceExportCaption(layout, drawn.length, capped.total), [layout, drawn.length, capped.total]);
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
        {waiting ? ` ${WAITING_NOTE_3D}` : updating ? ' Updating the 3D view…' : ''}
      </p>
      {notice && (
        <p className="count cap-notice" data-testid="cap-notice-3d">
          {notice}
        </p>
      )}
      <PlotlyChart className="plot plot3d" height={layout === 'grid' ? gridHeightPx(series.length, viewportWidth) : undefined} figure={figure} onRelayout={onRelayout} testId="plot-3d" toolbar="3d" ariaLabel="3D radiation pattern" labelledExport={{ caption: withSimulated(exportCaption, simulated ? simulatedCaption({ ...sim, hCut: undefined }, method, sim.offsetsAmong(drawn.map((i) => i.pattern.id))) : undefined), filename: pictureName('antenna-pattern-3d', simulated, sim.simulatedAmong(drawn.map((i) => i.pattern.id), false, false)) }} />
    </>
  );
}
