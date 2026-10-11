import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, type CutView, type Dimension, type Layout3d, type MarkerKey, type PlotMode } from '../state/store';
import type { GroupView } from '../state/selectors';
import type { PatternMetrics } from '../core/analysis/metrics';
import { buildCutBase, buildCutFigure, buildCutOverlay, markerCaption, markerReadout } from './cutFigure';
import { exportName, simulatedCaption, simulationActive } from './simSummary';
import { withSimulated } from './exportFigure';
import { bwMarkerLabel } from './bwLabel';
import { buildCutSeries, withReference } from './cutSeries';
import { FIGURE_THEMES, type Figure } from './figureTheme';
import { showFileLegend } from './legend';
import { PlotlyChart, type FigureOverlay } from './PlotlyChart';
import { showsUpdateHint, usePaintFirst, type UpdateCost } from './updateHint';
import { Pattern3D } from './Pattern3D';
import { SimulationBar } from './SimulationBar';
import { Seg } from './Seg';
import { PER_FILE_COLOURS, type FileStyle } from './colors';
import type { SimulationResult } from './useSimulation';

interface Props {
  groups: GroupView[];
  metrics: Map<string, PatternMetrics>;
  colors: Map<string, string>;
  /** Colour and line pattern of each shown file. */
  styles: Map<string, FileStyle>;
  sim: SimulationResult;
}

/** The marker names in display order; the first follows the beamwidth level of the settings. */
const markerLabels = (levelDb: number): Record<MarkerKey, string> => ({
  hpbw: bwMarkerLabel(levelDb),
  fb: 'F/B window',
  usls: 'Sidelobes',
  null: 'Null fill',
  peak: 'Beam direction',
  sector: 'Sector',
});

/** The names of the markers that are on, for the folded "Markers" control. */
const shownMarkers = (markers: Record<MarkerKey, boolean>, labels: Record<MarkerKey, string>): string => {
  const on = (Object.keys(labels) as MarkerKey[]).filter((k) => markers[k]).map((k) => labels[k]);
  return on.length > 0 ? on.join(' · ') : 'none';
};

interface CutPlotProps {
  id: 'h' | 'v';
  /** The files' traces and the axes: the same object whichever file is highlighted. */
  figure: Figure;
  /** The highlighted file's markers and title. */
  overlay: FigureOverlay;
  /** The complete figure, as exported: the highlighted file emphasised and on top. */
  exportFigure: () => Figure;
  onDrawn: (figure: Figure, overlay: FigureOverlay | undefined) => void;
  readout: string[];
  target: string;
  traces: number;
  /** The file the figure emphasises (see `PlotlyChart` `previewBase`). */
  emphasised: string | null;
  /** More than ten files are shown: colours go by group, a shade per file. */
  byGroup: boolean;
  /** Label of the pinned reference file when it is drawn (it has no legend entry without a legend). */
  referenceLabel: string | null;
  mode: PlotMode;
  /** What the markers that are on mean, for the exported image's caption. */
  markerLine: string | undefined;
  /** The simulation line of the exported image's caption (undefined without a simulation). */
  simulatedLine: string | undefined;
  /** Name of the exported image, without extension. */
  exportBase: string;
}

/** What a cut plot has drawn. */
interface Drawn {
  figure: Figure;
  overlay: FigureOverlay | undefined;
}

/** One cut plot with the read-out of the highlighted file's marker values underneath. */
function CutPlot({ id, figure, overlay, exportFigure, onDrawn, readout, target, traces, emphasised, byGroup, referenceLabel, mode, markerLine, simulatedLine, exportBase }: CutPlotProps) {
  const noLegend = traces > 0 && !showFileLegend(traces);
  return (
    <div className="plot-col">
      <PlotlyChart
        className="plot"
        figure={figure}
        overlay={overlay}
        onDrawn={onDrawn}
        testId={`plot-${id}`}
        toolbar={mode === 'polar' ? 'polar' : 'rect'}
        ariaLabel={`${id === 'h' ? 'Horizontal' : 'Vertical'} cut of the highlighted and visible patterns`}
        labelledExport={{
          caption: withSimulated(target ? { file: target, items: readout, ...(markerLine ? { markers: markerLine } : {}) } : undefined, simulatedLine),
          filename: exportBase,
          figure: exportFigure,
        }}
        previewBase={emphasised}
      />
      <div className="readout" data-testid={`readout-${id}`}>
        {readout.length > 0 && (
          <p>
            <strong>{target}:</strong> {readout.join(' · ')}
          </p>
        )}
        {noLegend && (
          <p className="count">
            {traces} traces: colours as in the file panel (dashed = original){byGroup ? '; more than 10 files: one colour per group, a shade per file' : ''}; hover a trace for its name.
            {referenceLabel !== null && ` The thick dashed line in the text colour is the reference: ${referenceLabel}.`}
          </p>
        )}
      </div>
    </div>
  );
}

export const PlotArea = memo(function PlotArea({ groups, metrics, colors, styles, sim }: Props) {
  // Only the fields used here: subscribing to the whole view would re-render on every slider tick.
  const view = useStore(
    useShallow((s) => ({
      dimension: s.view.dimension,
      layout3d: s.view.layout3d,
      cut: s.view.cut,
      mode: s.view.mode,
      floorDb: s.view.floorDb,
      markers: s.view.markers,
      theme: s.view.theme,
      markersFolded: s.view.collapsed.markers,
    })),
  );
  const updateView = useStore((s) => s.updateView);
  const visible = useStore((s) => s.visible);
  const highlighted = useStore((s) => s.highlighted);
  const reference = useStore((s) => s.reference);
  const settings = useStore((s) => s.settings);

  const items = useMemo(() => groups.flatMap((g) => g.items).filter((i) => visible[i.pattern.id]), [groups, visible]);
  // The reference file is drawn whenever one is pinned, ticked or not, also when nothing else is ticked.
  const drawnItems = useMemo(() => withReference(items, groups.flatMap((g) => g.items), reference), [items, groups, reference]);
  const markerTarget =
    highlighted && visible[highlighted] ? highlighted : items.length === 1 ? items[0].pattern.id : null;
  const is3d = view.dimension === '3d';
  // Everything that decides which traces are drawn and how the figure looks (colours, plot type, floor, theme,
  // analysis settings) moves to the figure together, a moment after a click: a checkbox or a button is answered
  // first, and the plots never show old traces with new colours. The highlighted file and the markers are not among
  // it: a highlight builds no trace (see `buildCutBase`).
  const inputs = useMemo(
    () => ({ items: drawnItems, colors, styles, metrics, sim, reference, mode: view.mode, floorDb: view.floorDb, theme: view.theme, settings }),
    [drawnItems, colors, styles, metrics, sim, reference, view.mode, view.floorDb, view.theme, settings],
  );
  // How long the last redraw took: one expected to take over 300 ms shows the hint, and is held back until the hint is painted.
  const cost = useRef<UpdateCost | null>(null);
  const expectedTraces = is3d ? 0 : (view.cut === 'both' ? 2 : 1) * drawnItems.length * (sim.showOriginal && simulationActive(sim) ? 2 : 1);
  const hint = showsUpdateHint(cost.current, expectedTraces);
  const drawn = useDeferredValue(usePaintFirst(inputs, hint));
  const pending = drawn !== inputs;
  // While the drawn files are behind (a tick is still being drawn), the plots keep the file they emphasised: a click
  // that ticks and highlights a file must not first take the emphasis and the markers off the old one.
  const settledTarget = useRef(markerTarget);
  useEffect(() => {
    if (!pending) settledTarget.current = markerTarget;
  });
  const target = pending ? settledTarget.current : markerTarget;
  const labels = markerLabels(settings.levelDb);
  const method3d = useStore((s) => s.view.method3d);
  const simulatedLine = simulatedCaption(sim, method3d);
  const simulated = simulationActive(sim);

  // The files' traces: built when the drawn files, their colours or the axes change, never for a highlight or a marker.
  const bases = useMemo(() => {
    if (is3d) return null;
    const common = {
      mode: drawn.mode,
      floorDb: drawn.floorDb,
      theme: FIGURE_THEMES[drawn.theme],
      levelDb: drawn.settings.levelDb,
      fbWindowDeg: drawn.settings.fbWindowDeg,
      sectorEdgeDeg: drawn.settings.sectorEdgeDeg,
      uslsRangeDeg: drawn.settings.uslsRangeDeg,
    };
    const make = (cut: 'H' | 'V') => {
      const options = { ...common, cut, series: buildCutSeries(drawn.items, drawn.sim, drawn.metrics, drawn.colors, cut, drawn.styles, drawn.reference) };
      return { options, figure: buildCutBase(options) };
    };
    return { h: make('H'), v: make('V') };
  }, [is3d, drawn]);

  // The highlighted file's part: its markers, the title, the read-out. The traces themselves are restyled (`emphasised`).
  const figures = useMemo(() => {
    if (!bases) return null;
    const make = ({ options: base, figure }: (typeof bases)['h']) => {
      const options = { ...base, markers: view.markers, markerTarget: target };
      const shown = options.series.find((x) => x.id === target);
      return {
        figure,
        overlay: buildCutOverlay(options),
        exportFigure: () => buildCutFigure(options),
        referenceLabel: options.series.find((x) => x.reference)?.label ?? null,
        markerLine: markerCaption(options.cut, view.markers, options),
        mode: options.mode,
        readout: markerReadout(options),
        target: shown?.label ?? '',
        traces: options.series.length,
        emphasised: shown ? target : null,
      };
    };
    return { h: make(bases.h), v: make(bases.v) };
  }, [bases, target, view.markers]);

  // What each cut plot has finished drawing: until the shown ones have caught up (new traces, or another highlighted
  // file's markers, which the charting library also redraws the whole plot for), the redraw is still running.
  const [finished, setFinished] = useState<{ h: Drawn | null; v: Drawn | null }>({ h: null, v: null });
  const onDrawnH = useCallback<CutPlotProps['onDrawn']>((figure, overlay) => setFinished((f) => ({ ...f, h: { figure, overlay } })), []);
  const onDrawnV = useCallback<CutPlotProps['onDrawn']>((figure, overlay) => setFinished((f) => ({ ...f, v: { figure, overlay } })), []);
  const behind = (done: Drawn | null, now: Drawn) => done?.figure !== now.figure || done.overlay !== now.overlay;
  const drawing = figures !== null && ((view.cut !== 'V' && behind(finished.h, figures.h)) || (view.cut !== 'H' && behind(finished.v, figures.v)));
  const updating = !is3d && drawnItems.length > 0 && (pending || drawing);
  const drawnTraces = figures ? (view.cut !== 'V' ? figures.h.traces : 0) + (view.cut !== 'H' ? figures.v.traces : 0) : 0;
  const started = useRef<number | null>(null);
  useEffect(() => {
    if (updating) started.current ??= performance.now();
    else if (started.current !== null) {
      // A hidden page draws late or not at all: that says nothing about the machine.
      if (document.visibilityState === 'visible') cost.current = { ms: performance.now() - started.current, traces: drawnTraces };
      started.current = null;
    }
  }, [updating, drawnTraces]);

  const byGroup = styles.size > PER_FILE_COLOURS;

  return (
    <section>
      <SimulationBar is3d={is3d} />
      <div className="controls">
        <Seg<Dimension>
          label="Dimension"
          value={view.dimension}
          options={[
            ['2d', '2D'],
            ['3d', '3D'],
          ]}
          onChange={(dimension) => updateView({ dimension })}
        />
        {is3d ? (
          <Seg<Layout3d>
            label="3D layout"
            value={view.layout3d}
            options={[
              ['grid', 'Side by side'],
              ['overlay', 'Overlay'],
            ]}
            onChange={(layout3d) => updateView({ layout3d })}
          />
        ) : (
          <>
            <Seg<CutView>
              label="Cut"
              value={view.cut}
              options={[
                ['H', 'Horizontal'],
                ['V', 'Vertical'],
                ['both', 'Both'],
              ]}
              onChange={(cut) => updateView({ cut })}
            />
            <Seg<PlotMode>
              label="Plot type"
              value={view.mode}
              options={[
                ['polar', 'Polar'],
                ['rect', 'Rectangular'],
              ]}
              onChange={(mode) => updateView({ mode })}
            />
            <button
              className="fold"
              aria-expanded={!view.markersFolded}
              aria-controls="marker-options"
              onClick={() => updateView({ collapsed: { ...useStore.getState().view.collapsed, markers: !view.markersFolded } })}
            >
              <span aria-hidden="true">{view.markersFolded ? '▸' : '▾'}</span> Markers
            </button>
            {view.markersFolded && <span className="count">{shownMarkers(view.markers, labels)}</span>}
            <div id="marker-options" className="marker-options" hidden={view.markersFolded}>
              {(Object.keys(labels) as MarkerKey[]).map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={view.markers[key]}
                    onChange={(e) => updateView({ markers: { ...view.markers, [key]: e.target.checked } })}
                  />
                  {labels[key]}
                </label>
              ))}
            </div>
          </>
        )}
      </div>
      {(is3d ? items.length === 0 : drawnItems.length === 0) ? (
        <p className="empty">Tick files in the left panel to plot them.</p>
      ) : is3d ? (
        <Pattern3D items={items} colors={colors} sim={sim} />
      ) : (
        <>
          {!markerTarget && (
            <p className="count">
              {highlighted
                ? 'The highlighted file is not ticked: tick it to see its analysis markers.'
                : 'Click a file in the panel or the table to show its analysis markers (Esc clears the highlight).'}
            </p>
          )}
          {/* The hint sits on the top edge of the first plot: a line of its own would move both plots down and up again, two more repaints of every trace. */}
          <div className="plots-area">
            {updating && hint && (
              <p className="count updating" data-testid="updating-2d">
                Updating the plots…
              </p>
            )}
            <div className="plots">
              {view.cut !== 'V' && figures && <CutPlot id="h" {...figures.h} onDrawn={onDrawnH} byGroup={byGroup} simulatedLine={simulatedLine} exportBase={exportName('horizontal-cut', simulated)} />}
              {view.cut !== 'H' && figures && <CutPlot id="v" {...figures.v} onDrawn={onDrawnV} byGroup={byGroup} simulatedLine={simulatedLine} exportBase={exportName('vertical-cut', simulated)} />}
            </div>
          </div>
        </>
      )}
    </section>
  );
});
