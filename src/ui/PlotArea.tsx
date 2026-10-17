import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { methodNameOf } from '../core/analysis/backHalf3d';
import { useShallow } from 'zustand/react/shallow';
import { useStore, type CutView, type Dimension, type Layout3d, type MarkerKey, type PlotMode } from '../state/store';
import type { GroupView } from '../state/selectors';
import type { PatternMetrics } from '../core/analysis/metrics';
import { buildCutBase, buildCutFigure, buildCutOverlay, markerCaption, markerReadout, regionCaptionOf } from './cutFigure';
import { REGION_STYLE, regionCaptionText, type RegionCaption } from './regionShading';
import { exportName, pictureName, simulatedCaption, weightedHorizonNote } from './simSummary';
import { withSimulated } from './exportFigure';
import { bwMarkerLabel } from './bwLabel';
import { buildCutSeries, farBelowPeakNote, withReference } from './cutSeries';
import { FIGURE_THEMES, type Figure } from './figureTheme';
import { showFileLegend, traceNote } from './legend';
import { usesMarkerLayer } from './markerLayer';
import { PlotlyChart, type FigureOverlay } from './PlotlyChart';
import { PlotBoundary } from './ErrorBoundary';
import { expectedTraceCount, lagNote, showsUpdateHint, usePaintFirst, useUpdateCost, WAITING_NOTE, type SimLag, type UpdateCost } from './updateHint';
import { Pattern3D } from './Pattern3D';
import { SimulationBar } from './SimulationBar';
import { SKIP_TARGETS } from './SkipLinks';
import { Seg } from './Seg';
import { PER_FILE_COLOURS, type FileStyle } from './colors';
import type { SimulationResult } from './useSimulation';
import { noteSimulationDrawn } from './passCost';
import type { OpenHelp } from './HelpDialog';
import { MetricInspector } from './MetricInspector';
import { useMetricInspectorStore } from './metricInspectorState';

interface Props {
  groups: GroupView[];
  metrics: Map<string, PatternMetrics>;
  colors: Map<string, string>;
  /** Colour and line pattern of each shown file. */
  styles: Map<string, FileStyle>;
  sim: SimulationResult;
  /** How far `sim` is behind the sliders (see `SimLag`). */
  simLag: SimLag;
  /** The lag is one to tell the user about: the page does not follow a drag (see `followsDrag`), so it lasts. */
  simStale: boolean;
  onHelp: OpenHelp;
  onEncyclopedia?: (index?: number) => void;
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
  /** Dashed originals of tilted files are among the traces. */
  originals: boolean;
  /** The dashed lines are file cuts under horizon cuts, with no tilt on any file (they are not "originals" of a tilt). */
  fileCut: boolean;
  /** The file the figure emphasises (see `PlotlyChart` `previewBase`). */
  emphasised: string | null;
  /** More than ten files are shown: colours go by group, a shade per file. */
  byGroup: boolean;
  /** Label of the pinned reference file when it is drawn (it has no legend entry without a legend). */
  referenceLabel: string | null;
  mode: PlotMode;
  /** What the markers that are on mean, for the exported image's caption. */
  markerLine: string | undefined;
  /** What the shaded angular regions are (while their columns are shown and a file's markers are drawn). */
  regionCaption: RegionCaption | undefined;
  /** The simulation line of the exported image's caption (undefined without a simulation). */
  simulatedLine: string | undefined;
  /** A caveat about the simulated picture, the caption's last line (see `weightedHorizonNote`). */
  exportNote?: string;
  /** Name of the exported image, without extension. */
  exportBase: string;
  /** The plot is not yet drawn from the simulation the page has: its image is not exported meanwhile. */
  exportBehind: boolean;
  /** Under a polar plot with a horizon cut too small to read: which cuts that is (see `farBelowPeakNote`), with the offer of the rectangular view. */
  farBelowNote?: string;
  onShowRectangular?: () => void;
}

/** What a cut plot has drawn. */
interface Drawn {
  figure: Figure;
  overlay: FigureOverlay | undefined;
}

/** One cut plot with the read-out of the highlighted file's marker values underneath. */
function CutPlot({ id, figure, overlay, exportFigure, onDrawn, readout, target, traces, originals, fileCut, emphasised, byGroup, referenceLabel, mode, markerLine, regionCaption, simulatedLine, exportNote, exportBase, exportBehind, farBelowNote, onShowRectangular }: CutPlotProps) {
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
          caption: withSimulated(target ? { file: target, items: readout, ...(markerLine ? { markers: markerLine } : {}), ...(regionCaption ? { regions: regionCaptionText(regionCaption) } : {}) } : undefined, simulatedLine, exportNote),
          filename: exportBase,
          figure: exportFigure,
          behind: exportBehind,
        }}
        previewBase={emphasised}
        overlayLayer={usesMarkerLayer(traces)}
      />
      <div className="readout" data-testid={`readout-${id}`}>
        {readout.length > 0 && (
          <p>
            <strong>{target}:</strong> {readout.join(' · ')}
          </p>
        )}
        {regionCaption && <RegionLine id={id} caption={regionCaption} />}
        {farBelowNote && (
          <p className="count" data-testid="far-below-note">
            {farBelowNote}{' '}
            <button type="button" onClick={onShowRectangular}>
              Show rectangular
            </button>
          </p>
        )}
        {noLegend && (
          <p className="count">
            {traceNote({ traces, byGroup, originals, referenceLabel, fileCut })}
          </p>
        )}
      </div>
    </div>
  );
}

/** The text alternative of the region shading, with a swatch of each region's colour (the words name the colour too). */
function RegionLine({ id, caption }: { id: 'h' | 'v'; caption: RegionCaption }) {
  return (
    <p className="count region-line" data-testid={`regions-${id}`}>
      {caption.lead}
      {caption.items.length > 0 && ': '}
      {caption.items.map((item, k) => (
        <span key={item.region}>
          {k > 0 && '; '}
          <span className="region-swatch" aria-hidden="true" style={{ background: REGION_STYLE[item.region].colour }} />
          {item.text}
        </span>
      ))}
      .{caption.note && ` ${caption.note}`}
    </p>
  );
}

interface CutPlotsProps {
  /** The ticked files and the reference: what the cuts draw (never empty). */
  drawnItems: GroupView['items'];
  metrics: Map<string, PatternMetrics>;
  colors: Map<string, string>;
  styles: Map<string, FileStyle>;
  sim: SimulationResult;
  simLag: SimLag;
  reference: string | null;
  /** The file whose markers are drawn (the highlighted one, or the only one), if any. */
  markerTarget: string | null;
  /** A file is highlighted (it may be unticked, and then is not the marker target). */
  highlighted: boolean;
  /** The marker target is the highlighted file (and not just the only ticked one). */
  targetHighlighted: boolean;
  onEncyclopedia?: (index?: number) => void;
}

/**
 * The two cut plots. The figures are built here, inside the plot area's error boundary, so a figure that cannot be
 * built leaves the controls above it in place.
 */
function CutPlots({ drawnItems, metrics, colors, styles, sim, simLag, reference, markerTarget, highlighted, targetHighlighted, onEncyclopedia }: CutPlotsProps) {
  const view = useStore(useShallow((s) => ({ cut: s.view.cut, mode: s.view.mode, floorDb: s.view.floorDb, markers: s.view.markers, theme: s.view.theme })));
  const settings = useStore((s) => s.settings);
  const focusedMetric = useMetricInspectorStore((s) => s.focusedMetric);
  const hoveredMetric = useMetricInspectorStore((s) => s.hoveredMetric);
  const inspectorMode = useMetricInspectorStore((s) => s.mode);
  const activeMetrics = useMetricInspectorStore((s) => s.activeMetrics);
  const activeFocus = hoveredMetric || (inspectorMode === 'solo' ? focusedMetric : null);

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
  const expectedTraces = expectedTraceCount(view.cut, drawnItems.map((i) => i.pattern.id), sim.showOriginal, sim.showsSimulatedH, sim.isTiltedId);
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
  // The 3D method as the numbers are named with it (with the back of the vertical cut when that is used).
  const method3d = useStore((s) => methodNameOf(s.view.method3d, s.view.back3d));
  // The angular regions of the marker target are shaded while their columns are shown (see `regionShading`).
  const regions = useStore((s) => s.view.tableGroups.are);
  // Only a simulation of what is drawn counts: an offset on an unticked file changes neither picture.
  const drawnIds = drawnItems.map((i) => i.pattern.id);
  const simulatedH = sim.simulatedAmong(drawnIds);
  const simulatedLineH = simulatedH ? simulatedCaption(sim, method3d, sim.offsetsAmong(drawnIds)) : undefined;
  // The vertical cut does not depend on the horizontal cut chosen: it neither counts as simulated for it nor names it.
  // Nor is it turned by an azimuth.
  const simulatedV = sim.simulatedAmong(drawnIds, false, false);
  const simulatedLineV = simulatedV ? simulatedCaption({ ...sim, hCut: undefined }, method3d, sim.offsetsAmong(drawnIds)) : undefined;

  // The files' traces: built when the drawn files, their colours or the axes change, never for a highlight or a marker.
  const bases = useMemo(() => {
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
      const options = {
        ...common,
        cut,
        series: buildCutSeries(drawn.items, drawn.sim, drawn.metrics, drawn.colors, cut, drawn.styles, drawn.reference),
        // While the horizontal cut shown is the one at the horizon, the vertical plot marks where that is.
        ...(cut === 'V' && drawn.sim.hCut === 'horizon' ? { horizonMark: true } : {}),
      };
      return { options, figure: buildCutBase(options) };
    };
    return { h: make('H'), v: make('V') };
  }, [drawn]);

  // The highlighted file's part: its markers, the title, the read-out. The traces themselves are restyled (`emphasised`).
  const figures = useMemo(() => {
    const make = ({ options: base, figure }: (typeof bases)['h']) => {
      const options = {
        ...base,
        markers: view.markers,
        markerTarget: target,
        regions,
        focusedMetric: activeFocus,
        activeMetrics: inspectorMode === 'multi' ? activeMetrics : undefined,
      };
      const shown = options.series.find((x) => x.id === target);
      const overlay = buildCutOverlay(options);
      return {
        figure,
        overlay,
        // The layout is the drawn one: it carries the view the user has zoomed to, as the image always did.
        exportFigure: () => ({ data: buildCutFigure(options).data, layout: { ...figure.layout, ...overlay.layout } }),
        referenceLabel: options.series.find((x) => x.reference)?.label ?? null,
        markerLine: markerCaption(options.cut, view.markers, { ...options, highlighted: targetHighlighted }),
        regionCaption: regionCaptionOf(options),
        mode: options.mode,
        readout: markerReadout(options),
        target: shown?.label ?? '',
        traces: options.series.length,
        originals: options.series.some((x) => x.dash),
        fileCut: !drawn.sim.tiltActive,
        emphasised: shown ? target : null,
      };
    };
    return { h: make(bases.h), v: make(bases.v) };
  }, [bases, target, targetHighlighted, view.markers, regions, drawn.sim.tiltActive, activeFocus, inspectorMode, activeMetrics]);

  // What each cut plot has finished drawing: until the shown ones have caught up (new traces, or another highlighted
  // file's markers, which the charting library also redraws the whole plot for), the redraw is still running.
  const [finished, setFinished] = useState<{ h: Drawn | null; v: Drawn | null }>({ h: null, v: null });
  const onDrawnH = useCallback<CutPlotProps['onDrawn']>((figure, overlay) => setFinished((f) => ({ ...f, h: { figure, overlay } })), []);
  const onDrawnV = useCallback<CutPlotProps['onDrawn']>((figure, overlay) => setFinished((f) => ({ ...f, v: { figure, overlay } })), []);
  const behind = (done: Drawn | null, now: Drawn) => done?.figure !== now.figure || done.overlay !== now.overlay;
  const drawing = (view.cut !== 'V' && behind(finished.h, figures.h)) || (view.cut !== 'H' && behind(finished.v, figures.v));
  const updating = pending || drawing;
  const drawnTraces = (view.cut !== 'V' ? figures.h.traces : 0) + (view.cut !== 'H' ? figures.v.traces : 0);
  // A highlight over the marker layers redraws no trace and takes a few milliseconds: it neither shows the hint nor is
  // timed for it (see `markerLayer`).
  const figureBehind = (view.cut !== 'V' && finished.h?.figure !== figures.h.figure) || (view.cut !== 'H' && finished.v?.figure !== figures.v.figure);
  const layersOnly = (view.cut === 'V' || usesMarkerLayer(figures.h.traces)) && (view.cut === 'H' || usesMarkerLayer(figures.v.traces));
  const redrawsTraces = pending || figureBehind || !layersOnly;
  useUpdateCost(cost, updating, drawnTraces, redrawsTraces);
  // The simulation the plots have finished drawing: until it is the page's, an image of them would be of the older one.
  const [simDrawn, setSimDrawn] = useState(sim);
  useEffect(() => {
    if (updating) return;
    setSimDrawn(sim);
    // The pass that made this simulation is over: how long it took says whether the next drag is followed (see `followsDrag`).
    noteSimulationDrawn();
  }, [updating, sim]);
  const exportBehind = simDrawn !== sim;

  const byGroup = styles.size > PER_FILE_COLOURS;
  // A horizon cut tens of dB down is a dot at the centre of a polar plot: offer the view that shows it (the drawing is not changed).
  // The line stands under the read-out of the marker target: it says whether it is about that file or about how many others.
  const farBelow = useMemo(
    () => (drawn.mode === 'polar' && drawn.sim.hCut === 'horizon' ? farBelowPeakNote(drawn.items.map((i) => i.pattern.id), drawn.sim.metrics, target) : undefined),
    [drawn, target],
  );
  const updateView = useStore((s) => s.updateView);
  const showRectangular = useCallback(() => {
    updateView({ mode: 'rect' });
    // The button that was pressed goes with the note: the focus moves to the switch it pressed for the user (else it
    // falls to the page, and the next Tab starts from the top).
    document.querySelector<HTMLElement>('[role="group"][aria-label="Plot type"] [data-value="rect"]')?.focus();
  }, [updateView]);

  return (
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
        {/* While a dragged slider is waited for, the line says so whatever the redraw will cost. After that it is the
            hint, from the moment the sliders are ahead of the plots (the simulation is worked out before the redraw). */}
        {(simLag === 'waiting' || (((updating && redrawsTraces) || simLag === 'behind') && hint)) && (
          <p className="count updating" data-testid="updating-2d">
            {simLag === 'waiting' ? WAITING_NOTE : 'Updating the plots…'}
          </p>
        )}
        <div className="plots">
          {view.cut !== 'V' && <CutPlot id="h" {...figures.h} onDrawn={onDrawnH} byGroup={byGroup} exportBehind={exportBehind} simulatedLine={simulatedLineH} exportNote={weightedHorizonNote(sim.hCut, method3d)} exportBase={pictureName('horizontal-cut', simulatedH, sim.simulatedAmong(drawnIds, true, false))} farBelowNote={farBelow} onShowRectangular={showRectangular} />}
          {view.cut !== 'H' && <CutPlot id="v" {...figures.v} onDrawn={onDrawnV} byGroup={byGroup} exportBehind={exportBehind} simulatedLine={simulatedLineV} exportBase={exportName('vertical-cut', simulatedV)} />}
        </div>
        <MetricInspector onOpenEncyclopedia={onEncyclopedia} />
      </div>
    </>
  );
}

export const PlotArea = memo(function PlotArea({ groups, metrics, colors, styles, sim, simLag, simStale, onHelp, onEncyclopedia }: Props) {
  // Only the fields used here: subscribing to the whole view would re-render on every slider tick.
  const view = useStore(
    useShallow((s) => ({
      dimension: s.view.dimension,
      layout3d: s.view.layout3d,
      compare3d: s.view.compare3d,
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

  const focusedMetric = useMetricInspectorStore((s) => s.focusedMetric);
  const hoveredMetric = useMetricInspectorStore((s) => s.hoveredMetric);
  const inspectorMode = useMetricInspectorStore((s) => s.mode);
  const activeMetrics = useMetricInspectorStore((s) => s.activeMetrics);
  const activeFocus = hoveredMetric || (inspectorMode === 'solo' ? focusedMetric : null);

  const items = useMemo(() => groups.flatMap((g) => g.items).filter((i) => visible[i.pattern.id]), [groups, visible]);
  // The reference file is drawn whenever one is pinned, ticked or not, also when nothing else is ticked.
  const drawnItems = useMemo(() => withReference(items, groups.flatMap((g) => g.items), reference), [items, groups, reference]);
  const markerTarget =
    highlighted && visible[highlighted] ? highlighted : items.length === 1 ? items[0].pattern.id : null;
  const is3d = view.dimension === '3d';
  const labels = markerLabels(settings.levelDb);
  return (
    <section className="cut-plots" aria-labelledby={SKIP_TARGETS.plots}>
      <h2 id={SKIP_TARGETS.plots} className="visually-hidden" tabIndex={-1}>
        {is3d ? '3D pattern' : 'Cut plots'}
      </h2>
      <SimulationBar is3d={is3d} lagNote={simStale ? lagNote(simLag, is3d) : null} onHelp={onHelp} />
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
          <>
            {/* Comparing the methods shows one file in its own two panels: the layout of several files has nothing to lay out then. */}
            <Seg<Layout3d>
              label="3D layout"
              value={view.layout3d}
              options={[
                ['grid', 'Side by side'],
                ['overlay', 'Overlay'],
              ]}
              disabled={view.compare3d}
              onChange={(layout3d) => updateView({ layout3d })}
            />
            <label title="Show the highlighted file reconstructed with both 3D methods, next to each other. The numbers keep the method of the Simulation bar.">
              <input type="checkbox" checked={view.compare3d} onChange={(e) => updateView({ compare3d: e.target.checked })} />
              Compare methods
            </label>
          </>
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
      ) : (
        // A figure that cannot be built or drawn fails inside this box: the controls above stay, and it clears itself
        // when anything the figure is made from changes.
        <PlotBoundary
          className="plot"
          resetKeys={[is3d, items, drawnItems, metrics, colors, styles, sim, reference, markerTarget, settings, view.layout3d, view.compare3d, view.cut, view.mode, view.floorDb, view.markers, view.theme, activeFocus, inspectorMode, activeMetrics]}
        >
          {is3d ? (
            <Pattern3D items={items} colors={colors} sim={sim} waiting={simLag === 'waiting'} />
          ) : (
            <CutPlots drawnItems={drawnItems} metrics={metrics} colors={colors} styles={styles} sim={sim} simLag={simLag} reference={reference} markerTarget={markerTarget} highlighted={highlighted !== null} targetHighlighted={markerTarget !== null && markerTarget === highlighted} onEncyclopedia={onEncyclopedia} />
          )}
        </PlotBoundary>
      )}
    </section>
  );
});
