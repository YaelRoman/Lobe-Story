import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import Plotly from 'plotly.js-dist-min';
import type { Config as PlotlyConfig, Data as PlotlyNativeData, Layout as PlotlyNativeLayout } from 'plotly.js-dist-min';
import type { Figure } from './figureTheme';
import { exportFigure, type ExportCaption } from './exportFigure';
import { PlotBoundary } from './ErrorBoundary';
import { CHART_PRIVACY, guardedReset, toolbarButtons, viewReset, type ChartToolbar } from './chartToolbar';
import { canvasesOf, releaseGlContexts } from './glContexts';
import { appliedAfterRedraw, applyLook, createRedrawGate, drawingOrder, hoverStore, ownTraces, positionsIn, previewRestyle, restyleAt, restyleDiff, type PreviewRestyle } from './hoverPreview';

const IMAGE_OPTIONS = { format: 'png', scale: 2, filename: 'antenna-pattern' } as const;

type RelayoutHandler = (el: HTMLElement, update: Record<string, unknown>) => void;

type PlotlyElement = HTMLDivElement & {
  on?: (event: string, cb: (update: Record<string, unknown>) => void) => void;
  removeAllListeners?: (event: string) => void;
};

interface Props {
  figure: Figure;
  className?: string;
  /** Height in px when the style sheet's is not right for this figure (the side-by-side 3D view on a phone). */
  height?: number;
  testId?: string;
  /** The plot's accessible name (a group, not an image: Plotly's modebar buttons inside must stay reachable). */
  ariaLabel?: string;
  onRelayout?: RelayoutHandler;
  /** Which toolbar (modebar) buttons the chart gets: see `ChartToolbar`. */
  toolbar: ChartToolbar;
  /**
   * Replaces the modebar's image download by one of a labelled version of the figure (legend on, highlighted file's
   * values). `figure` builds the figure to export when it is not the drawn one (the cut plots: the complete figure,
   * with the highlighted file on top).
   */
  labelledExport?: { caption?: ExportCaption; /** Name of the saved file, without extension. */ filename?: string; figure?: () => Figure };
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

function Chart({ figure, className, height, testId, ariaLabel, toolbar, onRelayout, labelledExport, overlay, previewBase, onDrawn }: Props) {
  const ref = useRef<PlotlyElement>(null);
  const handler = useRef(onRelayout);
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
      click: () => {
        const cur = exporting.current;
        // Always light colours on white, whatever the screen theme: the image is rebuilt from a copy, the drawn figure is not touched.
        const out = exportFigure(cur.labelledExport?.figure?.() ?? cur.figure, cur.labelledExport?.caption, useStore.getState().view.theme);
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
      modeBarButtons: toolbarButtons(toolbar, labelled ? labelledDownload : undefined, toolbar === '3d' ? undefined : reset) as unknown as PlotlyConfig['modeBarButtons'],
    };
  }, [toolbar, labelled]);

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
      lastDraw.current = { figure, config };
      // The 3D scenes this redraw drops (another 3D layout, fewer files) leave their WebGL contexts behind: release them.
      const scenes = canvasesOf(el);
      void Plotly.react(
        el,
        [...order.map((index) => traces[index]), ...(overlay?.data ?? [])] as unknown as PlotlyNativeData[],
        { ...figure.layout, ...overlay?.layout, autosize: true } as Partial<PlotlyNativeLayout>,
        config,
      )
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
          el.on?.('plotly_relayout', (update) => handler.current?.(el, update));
          // A double click resets as the toolbar's button does. A polar plot cannot be told not to reset by itself,
          // and does so right after this event, to the first figure's view: ours follows it within the same task.
          el.removeAllListeners?.('plotly_doubleclick');
          el.on?.('plotly_doubleclick', () => queueMicrotask(() => resetView(el, builtView.current, fail)));
          drawnHandler.current?.(figure, overlay);
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
          drawnHandler.current?.(figure, overlay);
        });
    };
    if (lastDraw.current?.figure !== figure || lastDraw.current.config !== config) {
      draw();
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
  }, [figure, overlay, config, previewing]);

  // The emphasised file changed (a highlight): restyle the drawn traces, as the hover preview does. After the draw
  // effect, which has already put a new figure's traces in this look.
  useEffect(() => {
    const el = ref.current;
    if (el && previewing) void restylePreview(el);
  }, [previewBase, previewing]);

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
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
      {error && (
        <p className="plot-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
