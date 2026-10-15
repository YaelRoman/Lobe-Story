import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import Plotly from 'plotly.js-dist-min';
import type { Config as PlotlyConfig, Data as PlotlyNativeData, Layout as PlotlyNativeLayout } from 'plotly.js-dist-min';
import type { Figure } from './figureTheme';
import { exportFigure, type ExportCaption } from './exportFigure';
import { exportFootLine } from './exportFoot';
import { imageExportHeld, imageExported } from './simCurrent';
import { PlotBoundary } from './ErrorBoundary';
import { CHART_PRIVACY, guardedReset, leaveTouchesToThePage, toolbarButtons, touchScrolls, viewReset, type ChartToolbar } from './chartToolbar';
import { dragView, markerLayerData, markerLayerLayout, reorderMoves, underLayerLayout, withView } from './markerLayer';
import { useCoarsePointer } from './phoneLayout';
import { canvasesOf, releaseGlContexts } from './glContexts';
import { pickedFileId } from './pointPick';
import { appliedAfterRedraw, applyLook, createRedrawGate, drawingOrder, hoverStore, ownTraces, positionsIn, previewRestyle, restyleAt, restyleDiff, type PreviewRestyle } from './hoverPreview';

const IMAGE_OPTIONS = { format: 'png', scale: 2, filename: 'antenna-pattern' } as const;

type RelayoutHandler = (el: HTMLElement, update: Record<string, unknown>) => void;

type PlotlyElement = HTMLDivElement & {
  on?: (event: string, cb: (update: Record<string, unknown>) => void) => void;
  removeListener?: (event: string, cb: (update: Record<string, unknown>) => void) => void;
  removeAllListeners?: (event: string) => void;
  /** The layout as the library completed it, with the view a drag is showing now. */
  _fullLayout?: object;
};

/** The marker layer has no toolbar and takes no pointer: the chart under it hands it the hover it has none for. */
const LAYER_CONFIG: Partial<PlotlyConfig> = { displayModeBar: false, responsive: true, doubleClick: false, scrollZoom: false, showTips: false };

/** The library's hover calls, which its types leave out (without them the layer names nothing on hover). */
const Fx = (Plotly as unknown as { Fx?: { hover?: (gd: HTMLElement, evt: MouseEvent, subplot?: string) => void; unhover?: (gd: HTMLElement) => void } }).Fx;
const hoverAt = (gd: HTMLElement, pointer: MouseEvent) => Fx?.hover?.(gd, pointer, 'polar');
const unhover = (gd: HTMLElement) => Fx?.unhover?.(gd);

/** What a hover of the marker layer names: a marker's point (a ring, a ray, a cross), or only a filled area (a wedge). */
type LayerHover = 'none' | 'point' | 'fill';
const layerHoverKind = (event: { points?: { data?: { fill?: string } }[] }): LayerHover =>
  (event.points ?? []).some((p) => p.data?.fill !== 'toself') ? 'point' : (event.points ?? []).length > 0 ? 'fill' : 'none';

/** The uid of the file trace a drawn trace group (`g.trace`) is: the library names it `trace<uid>`. */
const drawnUid = (node: Element): string | null => {
  for (const name of Array.from(node.classList)) if (name.startsWith('trace') && name !== 'trace') return name.slice('trace'.length);
  return null;
};

/**
 * Puts the drawn file traces of the chart in `el` in the order of `uids` (the last one on top) by moving their
 * groups in the page, which the library does not redraw for: see `reorderMoves`. Its next redraw draws them in the
 * order of its data again.
 */
function reorderDrawnTraces(el: HTMLElement, uids: readonly string[]): void {
  for (const layer of Array.from(el.querySelectorAll('g.scatterlayer'))) {
    const nodes = new Map<string, Element>();
    for (const child of Array.from(layer.children)) {
      const uid = drawnUid(child);
      if (uid !== null) nodes.set(uid, child);
    }
    for (const { id, before } of reorderMoves([...nodes.keys()], uids)) layer.insertBefore(nodes.get(id)!, before === null ? null : nodes.get(before)!);
  }
}

interface Props {
  figure: Figure;
  className?: string;
  /** Height in px when the style sheet's is not right for this figure (the side-by-side 3D view on a phone). */
  height?: number;
  testId?: string;
  /** The plot's accessible name (a group, not an image: Plotly's modebar buttons inside must stay reachable). */
  ariaLabel?: string;
  onRelayout?: RelayoutHandler;
  /** Called with the file id of a clicked point (the figure's `customdata`, see `pickedFileId`). */
  onPointClick?: (id: string) => void;
  /** Which toolbar (modebar) buttons the chart gets: see `ChartToolbar`. */
  toolbar: ChartToolbar;
  /**
   * Replaces the modebar's image download by one of a labelled version of the figure (legend on, highlighted file's
   * values). `figure` builds the figure to export when it is not the drawn one (the cut plots: the complete figure,
   * with the highlighted file on top).
   */
  labelledExport?: {
    caption?: ExportCaption;
    /** Name of the saved file, without extension. */
    filename?: string;
    figure?: () => Figure;
    /** The picture is still being drawn from the sliders' values: an export now would be of the older one, and is held back (see `imageExportHeld`). */
    behind?: boolean;
  };
  /**
   * Traces drawn after the figure's own and layout keys laid over its layout (the highlighted file's markers and
   * title in a cut plot). A new overlay alone is drawn without new traces for the figure: the ones already drawn are
   * handed to the library again, a moment later so that a restyle sent with it is on screen first.
   */
  overlay?: FigureOverlay;
  /**
   * Makes the plot emphasise a file (thick line, others dimmed) with `Plotly.restyle`, no rebuild: the file hovered
   * or focused in the panel or the table, otherwise this one (the highlighted file; null: none), which returns
   * when the preview ends. Leave undefined for plots that are not per-file.
   */
  previewBase?: string | null;
  /**
   * Draws `overlay` in a chart of its own laid over this one (see `markerLayer`): another overlay then redraws that
   * layer only, and the highlighted file is moved on top in the page instead of by a redraw. For a cut plot with many files.
   */
  overlayLayer?: boolean;
  /** Called when the library has finished drawing `figure` with `overlay` (also when it failed to); not for a restyle. */
  onDrawn?: (figure: Figure, overlay: FigureOverlay | undefined) => void;
}

export interface FigureOverlay {
  data: Figure['data'];
  layout: Figure['layout'];
}

const builtViews = new WeakMap<Figure, Record<string, unknown> | null>();

/**
 * The view a figure was built with (see `viewReset`), as it was when the figure was first seen: a drag writes the
 * new view into the layout object the library was given, which is the figure's own, so it cannot be read from the
 * figure later.
 */
function builtViewOf(figure: Figure, toolbar: ChartToolbar): Record<string, unknown> | null {
  if (!builtViews.has(figure)) builtViews.set(figure, viewReset(toolbar, figure.layout));
  return builtViews.get(figure) ?? null;
}

/**
 * Puts the chart back to the `view` its figure was built with. The library's own resets (its "Reset axes", a double
 * click) return to the view of the first figure a chart drew, and a chart that is updated in place has drawn others
 * since: another floor, another metric.
 */
function resetView(gd: HTMLElement, view: Record<string, unknown> | null, onThrow: (error: unknown) => void): void {
  // A copy: the library keeps the arrays it is given, and a later drag would change the noted view.
  if (view) {
    guardedReset(() => Plotly.relayout(gd, structuredClone(view) as Partial<PlotlyNativeLayout>), onThrow, (error) => console.error('The view could not be reset', error));
  }
}

/**
 * A chart, inside its own error boundary: an error thrown by the charting library while it draws (or clears) this
 * chart shows "This plot could not be drawn" in the chart's place and leaves the rest of the page alone.
 */
export function PlotlyChart(props: Props) {
  return (
    <PlotBoundary className={props.className} resetKeys={[props.figure, props.overlay, props.toolbar]} onError={() => props.onDrawn?.(props.figure, props.overlay)}>
      <Chart {...props} />
    </PlotBoundary>
  );
}

function Chart({ figure, className, height, testId, ariaLabel, toolbar, onRelayout, onPointClick, labelledExport, overlay, previewBase, overlayLayer, onDrawn }: Props) {
  const ref = useRef<PlotlyElement>(null);
  const handler = useRef(onRelayout);
  const clickHandler = useRef(onPointClick);
  clickHandler.current = onPointClick;
  const [error, setError] = useState<string | null>(null);
  // An error of a draw that React did not start (the one that waits for a paint runs from a timer) is thrown again
  // while rendering, so that the plot's boundary shows it: thrown in a timer it would only reach the console.
  const [, rethrow] = useState(null);
  const fail = (error: unknown) =>
    rethrow(() => {
      throw error;
    });

  // The toolbar's handlers outlive a render: they reach the latest `fail` through this.
  const failure = useRef(fail);
  failure.current = fail;

  const labelled = labelledExport !== undefined;
  // A finger that starts on a plot scrolls the page: the touch is kept from the library there (see `touchScrolls`).
  const coarse = useCoarsePointer();
  const exporting = useRef({ figure, labelledExport });
  const previewing = previewBase !== undefined;
  const preview = useRef({ figure, base: previewBase ?? null });
  const drawnHandler = useRef(onDrawn);
  // Noted now, before the figure is drawn (see `builtViewOf`); the toolbar's handler reads it from the ref.
  const builtView = useRef(builtViewOf(figure, toolbar));
  // The traces the library holds for the figure (in the figure's order), the order they were handed to it in (see
  // `drawingOrder`: the highlighted file on top) with the place of each, and what the last draw was of.
  const owned = useRef<{ figure: Figure; traces: object[]; order: number[]; positions: number[] } | null>(null);
  const lastDraw = useRef<{ figure: Figure; config: object } | null>(null);
  // What the drawn traces show now (null: unknown). Only the traces that differ from it are restyled.
  const applied = useRef<PreviewRestyle | null>(null);
  // A redraw (Plotly.react) is pending; a restyle sent meanwhile may land on either side of it, so what is shown is not known for sure.
  const redrawing = useRef(false);
  const restyledDuringRedraw = useRef(false);
  // Only the latest redraw's completion clears the two flags above (an older one resolving late must not).
  const redrawGate = useRef(createRedrawGate());
  // The marker layer (see `overlayLayer`): its element while it is on the page, what it was last given, the view it
  // was last given (the chart's, as JSON), and what the handlers that keep it in step read.
  // A layer the library failed to draw is given up for this chart: the markers are drawn among its traces again.
  const [layerBroken, setLayerBroken] = useState(false);
  const layered = overlay !== undefined && overlayLayer === true && !layerBroken;
  const layerFailed = (error: unknown) => {
    console.error('The markers could not be drawn over the plot; they are drawn in it from now on', error);
    setLayerBroken(true);
  };
  const layerEl = useRef<PlotlyElement | null>(null);
  const layerDrawn = useRef<{ figure: Figure; overlay: FigureOverlay } | null>(null);
  const layerView = useRef<string | null>(null);
  const layerState = useRef({ layered, figure, overlay, toolbar });
  layerState.current = { layered, figure, overlay, toolbar };
  // The layer is cleared when it leaves the page (fewer files, or the chart goes).
  const layerRef = useCallback((node: HTMLDivElement | null) => {
    layerEl.current = node;
    if (!node) return;
    return () => {
      layerEl.current = null;
      layerDrawn.current = null;
      layerView.current = null;
      try {
        Plotly.purge(node);
      } catch {
        // As for the chart itself (see below).
      }
    };
  }, []);

  useEffect(() => {
    handler.current = onRelayout;
    exporting.current = { figure, labelledExport };
    preview.current = { figure, base: previewBase ?? null };
    drawnHandler.current = onDrawn;
    builtView.current = builtViewOf(figure, toolbar);
  }, [onRelayout, figure, toolbar, labelledExport, previewBase, onDrawn]);

  // The same config object for every redraw of this chart. `Plotly.react` compares the config it is given with the
  // one it has, functions by identity: a download handler made anew for each redraw counts as a changed config, and
  // the library then purges the chart and plots it from nothing instead of updating it. The handler reads the latest
  // figure and caption from a ref, so it never needs to change.
  const config = useMemo<Partial<PlotlyConfig>>(() => {
    const labelledDownload = {
      name: 'toImageLabelled',
      title: 'Download plot as a png (with legend and values)',
      icon: Plotly.Icons.camera,
      click: (gd: PlotlyElement) => {
        const cur = exporting.current;
        // A picture of an older simulation than the sliders show is not saved without a word: the reason is said instead.
        if (imageExportHeld(cur.labelledExport?.behind)) return;
        imageExported();
        // Always light colours on white, whatever the screen theme: the image is rebuilt from a copy, the drawn figure is not touched.
        const { view, settings } = useStore.getState();
        const built = cur.labelledExport?.figure?.() ?? cur.figure;
        // A chart under a marker layer was given a copy of the figure's layout: the view a drag gave it (a zoom, a
        // turn) is in the chart only, and is taken from there.
        const shown = layerState.current.layered ? { ...built, layout: withView(built.layout, viewReset(toolbar, gd._fullLayout ?? built.layout)) } : built;
        const out = exportFigure(shown, cur.labelledExport?.caption, view.theme, exportFootLine(settings, view, new Date()));
        Plotly.downloadImage(
          { data: out.data as unknown as PlotlyNativeData[], layout: out.layout as unknown as Partial<PlotlyNativeLayout> },
          { ...IMAGE_OPTIONS, filename: cur.labelledExport?.filename ?? IMAGE_OPTIONS.filename, width: out.layout.width ?? null, height: out.layout.height ?? null },
        ).catch((error: unknown) => console.error('The plot image could not be saved', error));
      },
    };
    // Back to the view of the figure that is drawn now (a drag zooms the plot, or turns a polar one).
    const reset = {
      name: 'resetViewBuilt',
      title: toolbar === 'polar' ? 'Reset view' : 'Reset axes',
      icon: Plotly.Icons.home,
      click: (gd: HTMLElement) => resetView(gd, builtView.current, (error) => failure.current(error)),
    };
    return {
      responsive: true,
      ...CHART_PRIVACY,
      // The library's double click goes back to the first figure's axes: ours takes its place (see the draw below).
      ...(toolbar === 'rect' || toolbar === 'xy' ? { doubleClick: false as const } : {}),
      toImageButtonOptions: IMAGE_OPTIONS,
      // An explicit list: the library's default set has the charting library's cloud upload button and select tools in it.
      modeBarButtons: toolbarButtons(toolbar, labelled ? labelledDownload : undefined, toolbar === '3d' ? undefined : reset, coarse) as unknown as PlotlyConfig['modeBarButtons'],
    };
  }, [toolbar, labelled, coarse]);

  /**
   * Draws the current overlay in the marker layer, in the view the chart shows now (the figure's own until the chart
   * has drawn). Null when there is no layer to draw in.
   */
  const drawLayer = (el: PlotlyElement): Promise<unknown> | null => {
    const node = layerEl.current;
    const { layered: on, figure: fig, overlay: ov, toolbar: kind } = layerState.current;
    if (!node || !on || !ov) return null;
    const view = viewReset(kind, el._fullLayout ?? fig.layout);
    layerView.current = JSON.stringify(view);
    layerDrawn.current = { figure: fig, overlay: ov };
    try {
      const drawn = Plotly.react(node, markerLayerData(ov.data, fig.layout) as unknown as PlotlyNativeData[], { ...markerLayerLayout(fig.layout, ov.layout, view), autosize: true } as Partial<PlotlyNativeLayout>, LAYER_CONFIG);
      const layer = node as PlotlyElement;
      layer.removeListener?.('plotly_hover', onLayerHover.current);
      layer.on?.('plotly_hover', onLayerHover.current);
      layer.removeListener?.('plotly_unhover', onLayerUnhover.current);
      layer.on?.('plotly_unhover', onLayerUnhover.current);
      return drawn;
    } catch (error) {
      // A throw as a failed draw: either way the layer is given up (see `layerFailed`).
      return Promise.reject(error);
    }
  };

  /** The highlighted file's traces on top of the others in the page (see `drawingOrder`), with the chart drawn as it is. */
  const reorderDrawn = (el: HTMLElement) => {
    const data = preview.current.figure.data as unknown as { uid?: unknown }[];
    const uids = drawingOrder(data, preview.current.base).map((index) => data[index].uid);
    reorderDrawnTraces(
      el,
      uids.filter((uid): uid is string => typeof uid === 'string'),
    );
  };

  /**
   * Keeps the marker layer in step with the chart under it after the chart was drawn or its view changed (a drag, a
   * reset, a new size): the layer takes the chart's view, and the highlighted file's traces stay on top (a redraw of the
   * chart puts its traces back in the order of its data). `dragging`: what a drag in progress has drawn so far.
   */
  const followChart = (el: PlotlyElement, dragging?: Record<string, unknown>) => {
    const node = layerEl.current;
    if (!node || !layerState.current.layered || !layerDrawn.current || redrawing.current || layerDrawn.current.figure !== preview.current.figure) return;
    reorderDrawn(el);
    const laidOut = viewReset(layerState.current.toolbar, el._fullLayout ?? {});
    const view = dragging ? dragView(laidOut, dragging) : laidOut;
    const key = JSON.stringify(view);
    if (view === null || key === layerView.current) return;
    layerView.current = key;
    Plotly.relayout(node, view as Partial<PlotlyNativeLayout>).catch((error: unknown) => console.error('The markers could not follow the plot', error));
  };
  // What the chart's events call: the same function for every draw, so that it can be taken off again.
  const following = useRef(followChart);
  following.current = followChart;
  const follow = useRef(() => {
    if (ref.current) following.current(ref.current);
  });
  const followDrag = useRef((update: Record<string, unknown>) => {
    if (ref.current) following.current(ref.current, update);
  });
  /*
   * Hover over a polar chart under a marker layer, as in one chart: both are asked at every move of the pointer. A
   * marker's point within reach (a −3 dB point, the squint, a sidelobe cross: most lie on the highlighted trace) is
   * named rather than the trace; a filled area (the beamwidth wedge) only where the chart names no trace.
   */
  const chartHovers = useRef(false);
  const layerHovers = useRef<LayerHover>('none');
  // The chart's label was taken off for a marker's: it is asked again when the marker is no longer under the pointer.
  const chartSilenced = useRef(false);
  const lastPointer = useRef<MouseEvent | null>(null);
  const settleHover = useRef(() => {
    const el = ref.current;
    const node = layerEl.current;
    if (!el || !node) return;
    // (What is taken off is noted here: the library does not always say so with an unhover event.)
    if (layerHovers.current === 'point' && chartHovers.current) {
      chartSilenced.current = true;
      chartHovers.current = false;
      unhover(el);
    } else if (layerHovers.current === 'fill' && chartHovers.current) {
      layerHovers.current = 'none';
      unhover(node);
    } else if (layerHovers.current !== 'point' && chartSilenced.current) {
      chartSilenced.current = false;
      if (lastPointer.current) hoverAt(el, lastPointer.current);
    }
  });
  const onChartHover = useRef(() => {
    chartHovers.current = true;
    settleHover.current();
  });
  const onChartUnhover = useRef(() => {
    chartHovers.current = false;
    settleHover.current();
  });
  const onLayerHover = useRef((event: Record<string, unknown>) => {
    layerHovers.current = layerHoverKind(event as Parameters<typeof layerHoverKind>[0]);
    settleHover.current();
  });
  const onLayerUnhover = useRef(() => {
    layerHovers.current = 'none';
    settleHover.current();
  });
  /** Asks the layer for its hover at the pointer (none: the pointer left the plot area). */
  const layerHover = useRef(() => {
    const node = layerEl.current;
    const pointer = lastPointer.current;
    if (!node || !layerDrawn.current) return;
    if (pointer) hoverAt(node, pointer);
    else {
      unhover(node);
      chartSilenced.current = false;
    }
  });

  /** Brings the drawn traces to the current preview, restyling only those whose look changes. */
  const restylePreview = (el: HTMLElement) => {
    const { figure: fig, base } = preview.current;
    const next = previewRestyle(fig.data as unknown as { uid?: unknown }[], hoverStore.getState().id, base);
    const diff = restyleDiff(applied.current, next);
    applied.current = next;
    if (redrawing.current && diff) restyledDuringRedraw.current = true;
    if (!diff) return undefined;
    // The looks go by the figure's traces, the library by the places they are drawn at.
    const sent = restyleAt(diff, owned.current?.figure === fig ? owned.current.positions : null);
    return Plotly.restyle(el, sent.update as unknown as Record<string, unknown>, sent.indices);
  };

  // Hover/focus preview: restyle the drawn traces in place. Changes within one frame (leave one row, enter the
  // next) are merged into one restyle.
  useEffect(() => {
    const el = ref.current;
    if (!el || !previewing) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      void restylePreview(el);
    };
    const unsubscribe = hoverStore.subscribe(() => {
      if (frame === 0) frame = requestAnimationFrame(apply);
    });
    return () => {
      unsubscribe();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [previewing]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const draw = (deferred = false) => {
      setError(null);
      const generation = redrawGate.current.start();
      redrawing.current = true;
      restyledDuringRedraw.current = false;
      const marked = figure.data as unknown as { uid?: unknown }[];
      // The highlighted file is drawn on top. Every redraw hands all the traces to the library anyway, so the one a
      // highlight already costs (its markers and title) carries the new order: no redraw of its own.
      const order = drawingOrder(marked, previewing ? preview.current.base : null);
      const moved = owned.current?.figure === figure && order.some((index, k) => index !== owned.current?.order[k]);
      if (owned.current?.figure !== figure || moved) {
        // The traces start in the look that is due now (the highlighted file's emphasis, or a preview): no second
        // pass for new ones, and for moved ones what they show is known again from here, whatever was sent before.
        const look = previewing ? previewRestyle(marked, hoverStore.getState().id, preview.current.base) : null;
        if (moved && owned.current) applyLook(owned.current.traces, look);
        owned.current = { figure, traces: moved && owned.current ? owned.current.traces : ownTraces(figure.data, look), order, positions: positionsIn(order) };
        applied.current = look;
      }
      const { traces } = owned.current;
      // The same figure drawn again (another toolbar): the chart under a layer keeps its view in its own copy of the layout.
      const keptView = layered && lastDraw.current?.figure === figure ? viewReset(layerState.current.toolbar, el._fullLayout ?? figure.layout) : null;
      lastDraw.current = { figure, config };
      // The 3D scenes this redraw drops (another 3D layout, fewer files) leave their WebGL contexts behind: release them.
      const scenes = canvasesOf(el);
      // Over a marker layer the chart draws the figure without the overlay, and without what the layer draws over its
      // traces (see `markerLayer`).
      void Plotly.react(
        el,
        [...order.map((index) => traces[index]), ...(layered ? [] : (overlay?.data ?? []))] as unknown as PlotlyNativeData[],
        { ...(layered ? withView(underLayerLayout(figure.layout), keptView) : { ...figure.layout, ...overlay?.layout }), autosize: true } as Partial<PlotlyNativeLayout>,
        config,
      )
        // The layer after the chart, in its view (a failed layer leaves the chart as it is: its own message is logged).
        .then(() => (layered && redrawGate.current.isLatest(generation) ? drawLayer(el)?.catch(layerFailed) : undefined))
        .then(() => {
          releaseGlContexts(scenes);
          if (!redrawGate.current.isLatest(generation)) return;
          // The drawn traces show what was last applied to them, unless a restyle was sent while the redraw was
          // pending: then what is drawn is unknown, and the next restyle sends everything (otherwise an old target
          // could stay drawn thick).
          applied.current = appliedAfterRedraw(applied.current, restyledDuringRedraw.current);
          redrawing.current = false;
          restyledDuringRedraw.current = false;
          if (previewing) void restylePreview(el);
          el.removeAllListeners?.('plotly_relayout');
          el.on?.('plotly_relayout', (update) => {
            handler.current?.(el, update);
            follow.current();
          });
          // A drag shows its view while it lasts, and any redraw of the chart (a new size, a view) puts its traces
          // back in the order of its data: the marker layer follows both.
          el.removeListener?.('plotly_afterplot', follow.current);
          el.on?.('plotly_afterplot', follow.current);
          el.removeListener?.('plotly_relayouting', followDrag.current);
          el.on?.('plotly_relayouting', followDrag.current);
          el.removeListener?.('plotly_hover', onChartHover.current);
          el.on?.('plotly_hover', onChartHover.current);
          el.removeListener?.('plotly_unhover', onChartUnhover.current);
          el.on?.('plotly_unhover', onChartUnhover.current);
          el.removeAllListeners?.('plotly_click');
          el.on?.('plotly_click', (event) => {
            const id = pickedFileId(event as Parameters<typeof pickedFileId>[0]);
            if (id !== null) clickHandler.current?.(id);
          });
          // A double click resets as the toolbar's button does. A polar plot cannot be told not to reset by itself,
          // and does so right after this event, to the first figure's view: ours follows it within the same task.
          el.removeAllListeners?.('plotly_doubleclick');
          el.on?.('plotly_doubleclick', () => queueMicrotask(() => resetView(el, builtView.current, fail)));
          // The overlay drawn is the one of now in the layer (an overlay that came while the chart was drawn waited for it).
          drawnHandler.current?.(figure, layered ? layerState.current.overlay : overlay);
        })
        .catch((error: unknown) => {
          // React cannot catch this one (it is not thrown while rendering): say why in the console, WebGL or not.
          console.error('A chart could not be drawn', error);
          releaseGlContexts(scenes);
          if (!redrawGate.current.isLatest(generation)) return;
          redrawing.current = false;
          restyledDuringRedraw.current = false;
          if (deferred) {
            // As a throw of the deferred draw (below): the boundary shows it and reports the plot as done.
            fail(error);
            return;
          }
          setError('This plot could not be drawn (WebGL unavailable?)');
          // Over a layer, an overlay that came while the chart was drawn waited for it: that one is the latest.
          drawnHandler.current?.(figure, layered ? layerState.current.overlay : overlay);
        });
    };
    if (lastDraw.current?.figure !== figure || lastDraw.current.config !== config) {
      draw();
      return;
    }
    if (layered) {
      // Only the overlay is new: the layer is redrawn, and the chart's traces are restyled and moved (below). A redraw
      // of the chart that is still pending draws the layer when it is done, with this overlay.
      if (redrawing.current) return;
      void (drawLayer(el) ?? Promise.resolve())
        .catch(layerFailed)
        .then(() => drawnHandler.current?.(figure, overlay));
      return;
    }
    // Only the overlay is new (another highlighted file's markers and title). The library still redraws the whole
    // chart for it, so it waits until the emphasis restyle sent with the highlight is painted; a newer overlay
    // replaces one that is still waiting.
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        // The library throws while it draws (an effect's throw is caught by React, a timer's is not).
        try {
          draw(true);
        } catch (error) {
          redrawing.current = false;
          restyledDuringRedraw.current = false;
          fail(error);
        }
      }, 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [figure, overlay, config, previewing, layered]);

  // The emphasised file changed (a highlight): restyle the drawn traces, as the hover preview does. After the draw
  // effect, which has already put a new figure's traces in this look.
  // Over a marker layer the highlighted file's traces are also moved on top here: no redraw of the chart brings them.
  useEffect(() => {
    const el = ref.current;
    if (el && previewing) void restylePreview(el);
    const now = layerState.current;
    if (el && now.layered && !redrawing.current && lastDraw.current?.figure === now.figure) reorderDrawn(el);
  }, [previewBase, previewing]);

  useEffect(() => {
    const el = ref.current;
    if (el && touchScrolls(toolbar, coarse)) return leaveTouchesToThePage(el);
  }, [toolbar, coarse]);

  // The pointer over a polar chart under a marker layer: the layer is asked for its markers' hover (see `settleHover`).
  useEffect(() => {
    const el = ref.current;
    if (!el || !layered || toolbar !== 'polar') return;
    const move = (event: MouseEvent) => {
      // Only over the plot area (the element the chart hovers from): its box is the one the hover is measured in.
      const over = event.target instanceof Element && event.target.classList.contains('maindrag');
      lastPointer.current = over && event.buttons === 0 ? event : null;
      layerHover.current();
    };
    const leave = () => {
      lastPointer.current = null;
      layerHover.current();
    };
    el.addEventListener('mousemove', move);
    el.addEventListener('mousedown', leave);
    el.addEventListener('mouseleave', leave);
    return () => {
      el.removeEventListener('mousemove', move);
      el.removeEventListener('mousedown', leave);
      el.removeEventListener('mouseleave', leave);
      leave();
    };
  }, [layered, toolbar]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (!el) return;
      const scenes = canvasesOf(el);
      try {
        Plotly.purge(el);
      } catch {
        // A plot that failed to draw can fail to clear as well; the element is leaving the page anyway.
      }
      // After the library has let go of its scenes: their contexts are not left to the garbage collector.
      releaseGlContexts(scenes, 'all');
    };
  }, []);

  return (
    <div className={className} data-testid={testId} role={ariaLabel ? 'group' : undefined} aria-label={ariaLabel} style={{ position: 'relative', ...(height !== undefined ? { height } : {}) }}>
      <div ref={ref} className={layered ? 'chart-under-layer' : undefined} style={{ width: '100%', height: '100%' }} />
      {layered && <div ref={layerRef} className="marker-layer" aria-hidden="true" data-testid={testId ? `${testId}-layer` : undefined} />}
      {error && (
        <p className="plot-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
