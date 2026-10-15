import { useCallback, useDeferredValue, useMemo, useRef, useSyncExternalStore } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Layout } from 'plotly.js-dist-min';
import { useStore } from '../state/store';
import type { TaggedPattern } from '../core/analysis/metrics';
import type { Pattern } from '../core/types';
import { nameOf } from '../core/names';
import { allScenesCamera, BUILT_CAMERA, buildSurfaceFigure, cameraKey, cameraOf, cameraSceneOf, gridHeightPx, isCameraReset, linkedCameraUpdate, maxSurfaces, viewportClass, withCamera, type SurfaceSeries } from './surfaceFigure';
import { capItems, capNotice, surfaceExportCaption } from './viewCaps';
import { FIGURE_THEMES } from './figureTheme';
import { PlotlyChart } from './PlotlyChart';
import type { SimulationResult } from './useSimulation';
import { withSimulated } from './exportFigure';
import { pictureName, simulatedCaption } from './simSummary';
import { WAITING_NOTE_3D } from './updateHint';
import { surfaceFor } from './surfaceCache';
import { buildMethodCompareFigure, compareAriaLabel, compareExportCaption, compareHeightPx, differenceText, methodDifference, METHOD_TITLE, stacksMethods } from './methodCompare';

const subscribeResize = (cb: () => void) => {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
};
/** The window's width class (see `viewportClass`): changes only when a phone layout starts or ends or the window crosses a 100 px step. */
const useWidthClass = (): number | undefined => useSyncExternalStore(subscribeResize, () => viewportClass(window.innerWidth), () => undefined);

const fileLabel = (pattern: Pattern): string => `${pattern.frequencyMHz} MHz · ${nameOf(pattern)}`;

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
  // Both methods for one file (see `methodCompare`): the numbers keep `method`.
  const compareAsked = useStore((s) => s.view.compare3d);
  const floorDb = useStore((s) => s.view.floorDb);
  const theme = useStore((s) => s.view.theme);
  const { effective } = sim;
  const viewportWidth = useWidthClass();

  // At most `cap` surfaces are ever built or drawn (the highlighted file first, then ticked files in panel order).
  // Comparing the methods draws one file: the highlighted one, else the first ticked.
  const highlighted = useStore((s) => s.highlighted);
  const cap = compareAsked ? 1 : maxSurfaces(layout);
  const capped = useMemo(() => capItems(items, cap, highlighted), [items, cap, highlighted]);
  // The surfaces follow the ticks a moment later, so a click on a checkbox is answered before the 3D redraw starts.
  // The comparison is switched with them: one redraw, never one file laid out side by side on the way.
  const asked = useMemo(() => ({ compare: compareAsked, shown: capped.shown, total: capped.total }), [compareAsked, capped.shown, capped.total]);
  const shown = useDeferredValue(asked);
  const { compare, shown: drawn } = shown;
  const updating = shown !== asked;

  // Each file's surface per method is computed once per change of its tilt (see `surfaceFor`), here or for the comparison.
  const series = useMemo<SurfaceSeries[]>(
    () =>
      compare
        ? []
        : drawn.map(({ pattern }) => ({
            id: pattern.id,
            label: fileLabel(pattern),
            color: colors.get(pattern.id) ?? '#888888',
            surface: surfaceFor(pattern, effective(pattern.id), method),
          })),
    [compare, drawn, colors, method, effective],
  );
  // The compared file's two surfaces do not depend on the method chosen: choosing another one only moves the label.
  const comparedPattern = compare ? drawn[0]?.pattern : undefined;
  const compared = useMemo(() => {
    if (!comparedPattern) return null;
    const e = effective(comparedPattern.id);
    return { label: fileLabel(comparedPattern), surfaces: { summation: surfaceFor(comparedPattern, e, 'summation'), weighted: surfaceFor(comparedPattern, e, 'weighted') } };
  }, [comparedPattern, effective]);
  const difference = useMemo(() => (compared ? methodDifference(compared.surfaces.summation, compared.surfaces.weighted, floorDb) : null), [compared, floorDb]);

  // The view the user last turned to (see `withCamera`): a figure built anew starts from it. Kept out of the figure's
  // inputs, so a turn never rebuilds the surfaces.
  const camera = useRef<unknown>(null);
  const figure = useMemo(
    () =>
      withCamera(
        compared
          ? buildMethodCompareFigure({ surfaces: compared.surfaces, selected: method, floorDb, theme: FIGURE_THEMES[theme], viewportWidth })
          : buildSurfaceFigure({ series, layout, floorDb, theme: FIGURE_THEMES[theme], viewportWidth }),
        camera.current,
      ),
    [compared, method, series, layout, floorDb, theme, viewportWidth],
  );

  const notice = compare ? null : capNotice(layout === 'grid' ? 'The side-by-side 3D view draws' : 'The 3D overlay draws', capped.shown.length, capped.total, cap);
  // Only the surfaces drawn count: an offset on a file that is not drawn does not make the picture simulated.
  // The 3D view does not depend on the horizontal cut shown.
  const simulated = sim.simulatedAmong(drawn.map((i) => i.pattern.id), false);
  const exportCaption = useMemo(
    () => (compared && difference ? compareExportCaption(compared.label, method, floorDb, difference) : surfaceExportCaption(layout, drawn.length, capped.total, method, floorDb)),
    [compared, difference, layout, drawn.length, capped.total, method, floorDb],
  );
  // The image of the comparison is always side by side, whatever the window: it is as wide as any other image.
  const exportCompared = useMemo(
    () => (compared ? () => withCamera(buildMethodCompareFigure({ surfaces: compared.surfaces, selected: method, floorDb, theme: FIGURE_THEMES[theme] }), camera.current) : undefined),
    [compared, method, floorDb, theme],
  );
  const sceneCount = compared ? 2 : layout === 'grid' ? series.length : 1;
  // Our own relayout fires plotly_relayout again; skipping a camera we just applied prevents a loop.
  const lastCamera = useRef('');
  const onRelayout = useCallback(
    (el: HTMLElement, update: Record<string, unknown>) => {
      const id = cameraSceneOf(update);
      if (id === null) return;
      const apply = (next: Record<string, unknown>) => {
        const key = cameraKey(Object.values(next)[0]);
        if (key === lastCamera.current) return;
        lastCamera.current = key;
        void Plotly.relayout(el, next as Partial<Layout>);
      };
      // "Reset camera to default" returns every scene to the view it is built with (the library's own default
      // differs, and a scene made after a turn would take that turn for its default).
      if (isCameraReset(update)) {
        camera.current = null;
        // Always applied: a second reset in a row must not be skipped as a camera we just applied.
        lastCamera.current = '';
        apply(allScenesCamera(sceneCount, BUILT_CAMERA));
        return;
      }
      // The view the scene shows now, as the library holds it: the payload may name only part of it.
      const live = (el as { _fullLayout?: Record<string, { _scene?: { getCamera?: () => unknown } } | undefined> })._fullLayout?.[id]?._scene?.getCamera?.();
      const shown = live ?? cameraOf(update);
      if (shown === undefined) return;
      camera.current = shown;
      const next = linkedCameraUpdate({ [`${id}.camera`]: shown }, sceneCount, true);
      if (next) apply(next);
    },
    [sceneCount],
  );

  const state = waiting ? ` ${WAITING_NOTE_3D}` : updating ? ' Updating the 3D view…' : '';
  const ids = drawn.map((i) => i.pattern.id);
  const stacked = stacksMethods(viewportWidth);
  return (
    <>
      {compare ? (
        <>
          <p className="count" data-testid="compare-intro">
            Both 3D methods for {compared?.label ?? 'the highlighted file'}, reconstructed from the H and V cuts; estimates, not measured data.
            {shown.total > 1 ? ' One file is compared: the highlighted one, else the first ticked. Highlight another to compare it.' : ''}
            {state}
          </p>
          <p className="count" data-testid="compare-numbers-method">
            Numbers use: <strong>{METHOD_TITLE[method]}</strong> (the 3D method of the Simulation bar; comparing does not change it).
          </p>
        </>
      ) : (
        <p className="count">
          3D shape reconstructed from the H and V cuts ({method === 'summation' ? 'summation' : 'weighted, Gil et al.'}
          ); an estimate, not measured data.
          {state}
        </p>
      )}
      {notice && (
        <p className="count cap-notice" data-testid="cap-notice-3d">
          {notice}
        </p>
      )}
      <PlotlyChart
        // Drawn anew when the phone layout starts or ends: updated in place, the scenes kept the size of the old layout.
        key={stacked ? 'phone' : 'wide'}
        className="plot plot3d"
        height={compared ? compareHeightPx(viewportWidth) : layout === 'grid' ? gridHeightPx(series.length, viewportWidth) : undefined}
        figure={figure}
        onRelayout={onRelayout}
        testId="plot-3d"
        toolbar="3d"
        ariaLabel={compared ? compareAriaLabel(method, stacked) : '3D radiation pattern'}
        labelledExport={{
          caption: withSimulated(exportCaption, simulated ? simulatedCaption({ ...sim, hCut: undefined }, method, sim.offsetsAmong(ids)) : undefined),
          filename: pictureName(compared ? 'antenna-pattern-3d-methods' : 'antenna-pattern-3d', simulated, sim.simulatedAmong(ids, false, false)),
          figure: exportCompared,
        }}
      />
      {compared && difference && (
        <p className="count" data-testid="compare-difference">
          {differenceText(difference, floorDb)}
        </p>
      )}
    </>
  );
}
