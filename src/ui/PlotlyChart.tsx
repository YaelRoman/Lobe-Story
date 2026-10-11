import { useEffect, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Data as PlotlyNativeData, Layout as PlotlyNativeLayout } from 'plotly.js-dist-min';
import type { Figure } from './figureTheme';
import { exportFigure, type ExportCaption } from './exportFigure';
import { PlotBoundary } from './ErrorBoundary';
import { appliedAfterRedraw, createRedrawGate, hoverStore, ownTraces, previewRestyle, restyleDiff, type PreviewRestyle } from './hoverPreview';

const IMAGE_OPTIONS = { format: 'png', scale: 2, filename: 'antenna-pattern' } as const;

type RelayoutHandler = (el: HTMLElement, update: Record<string, unknown>) => void;

type PlotlyElement = HTMLDivElement & {
  on?: (event: string, cb: (update: Record<string, unknown>) => void) => void;
  removeAllListeners?: (event: string) => void;
};

interface Props {
  figure: Figure;
  className?: string;
  testId?: string;
  /** The plot's accessible name (a group, not an image: Plotly's modebar buttons inside must stay reachable). */
  ariaLabel?: string;
  onRelayout?: RelayoutHandler;
  /** Replaces the modebar's image download by one of a labelled version of the figure (legend on, highlighted file's values). */
  labelledExport?: { caption?: ExportCaption; /** Name of the saved file, without extension. */ filename?: string };
  /**
   * Makes the plot preview the file hovered or focused in the panel or the table (thick line, others dimmed) with
   * `Plotly.restyle`, no rebuild. The value is the file the figure itself emphasises (the highlighted one), which
   * returns when the preview ends. Leave undefined for plots that are not per-file.
   */
  previewBase?: string | null;
}

/**
 * A chart, inside its own error boundary: an error thrown by the charting library while it draws (or clears) this
 * chart shows "This plot could not be drawn" in the chart's place and leaves the rest of the page alone.
 */
export function PlotlyChart(props: Props) {
  return (
    <PlotBoundary className={props.className}>
      <Chart {...props} />
    </PlotBoundary>
  );
}

function Chart({ figure, className, testId, ariaLabel, onRelayout, labelledExport, previewBase }: Props) {
  const ref = useRef<PlotlyElement>(null);
  const handler = useRef(onRelayout);
  const [error, setError] = useState<string | null>(null);

  const labelled = labelledExport !== undefined;
  const exporting = useRef({ figure, labelledExport });
  const previewing = previewBase !== undefined;
  const preview = useRef({ figure, base: previewBase ?? null });
  // What the drawn traces show now (null: unknown). Only the traces that differ from it are restyled.
  const applied = useRef<PreviewRestyle | null>(null);
  // A redraw (Plotly.react) is pending; a restyle sent meanwhile lands on the new traces, so the redraw's own look is no longer what is shown.
  const redrawing = useRef(false);
  const restyledDuringRedraw = useRef(false);
  // Only the latest redraw's completion clears the two flags above (an older one resolving late must not).
  const redrawGate = useRef(createRedrawGate());

  useEffect(() => {
    handler.current = onRelayout;
    exporting.current = { figure, labelledExport };
    preview.current = { figure, base: previewBase ?? null };
  }, [onRelayout, figure, labelledExport, previewBase]);

  /** Brings the drawn traces to the current preview, restyling only those whose look changes. */
  const restylePreview = (el: HTMLElement) => {
    const { figure: fig, base } = preview.current;
    const next = previewRestyle(fig.data as unknown as { uid?: unknown }[], hoverStore.getState().id, base);
    const diff = restyleDiff(applied.current, next);
    applied.current = next;
    if (redrawing.current && diff) restyledDuringRedraw.current = true;
    return diff ? Plotly.restyle(el, diff.update as unknown as Record<string, unknown>, diff.indices) : undefined;
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
    setError(null);
    const generation = redrawGate.current.start();
    redrawing.current = true;
    restyledDuringRedraw.current = false;
    void Plotly.react(
      el,
      ownTraces(figure.data) as unknown as PlotlyNativeData[],
      { ...figure.layout, autosize: true } as Partial<PlotlyNativeLayout>,
      {
        responsive: true,
        displaylogo: false,
        toImageButtonOptions: IMAGE_OPTIONS,
        ...(labelled
          ? {
              modeBarButtonsToRemove: ['toImage' as const],
              modeBarButtonsToAdd: [
                {
                  name: 'toImageLabelled',
                  title: 'Download plot as a png (with legend and values)',
                  icon: Plotly.Icons.camera,
                  click: () => {
                    const cur = exporting.current;
                    const out = exportFigure(cur.figure, cur.labelledExport?.caption);
                    void Plotly.downloadImage(
                      { data: out.data as unknown as PlotlyNativeData[], layout: out.layout as unknown as Partial<PlotlyNativeLayout> },
                      { ...IMAGE_OPTIONS, filename: cur.labelledExport?.filename ?? IMAGE_OPTIONS.filename, width: out.layout.width ?? null, height: out.layout.height ?? null },
                    );
                  },
                },
              ],
            }
          : {}),
      },
    )
      .then(() => {
        if (!redrawGate.current.isLatest(generation)) return;
        // A redraw starts from the figure's own look (the highlight's emphasis); show a preview that is active again.
        // If the preview changed while the redraw was pending, what is drawn is unknown: the next restyle sends everything,
        // even when the preview has ended since (otherwise the old target would stay drawn thick).
        const own = previewing ? previewRestyle(preview.current.figure.data as unknown as { uid?: unknown }[], null, preview.current.base) : null;
        applied.current = appliedAfterRedraw(own, restyledDuringRedraw.current);
        const stale = restyledDuringRedraw.current;
        redrawing.current = false;
        restyledDuringRedraw.current = false;
        if (previewing && (stale || hoverStore.getState().id !== null)) void restylePreview(el);
        el.removeAllListeners?.('plotly_relayout');
        el.on?.('plotly_relayout', (update) => handler.current?.(el, update));
      })
      .catch(() => {
        if (!redrawGate.current.isLatest(generation)) return;
        redrawing.current = false;
        restyledDuringRedraw.current = false;
        setError('This plot could not be drawn (WebGL unavailable?)');
      });
  }, [figure, labelled, previewing]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (!el) return;
      try {
        Plotly.purge(el);
      } catch {
        // A plot that failed to draw can fail to clear as well; the element is leaving the page anyway.
      }
    };
  }, []);

  return (
    <div className={className} data-testid={testId} role={ariaLabel ? 'group' : undefined} aria-label={ariaLabel} style={{ position: 'relative' }}>
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
      {error && (
        <p className="plot-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
