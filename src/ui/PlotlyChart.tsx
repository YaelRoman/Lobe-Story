import { useEffect, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Data as PlotlyNativeData, Layout as PlotlyNativeLayout } from 'plotly.js-dist-min';
import type { Figure } from './figureTheme';
import { exportFigure, type ExportCaption } from './exportFigure';
import { hoverStore, previewRestyle } from './hoverPreview';

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

export function PlotlyChart({ figure, className, testId, ariaLabel, onRelayout, labelledExport, previewBase }: Props) {
  const ref = useRef<PlotlyElement>(null);
  const handler = useRef(onRelayout);
  const [error, setError] = useState<string | null>(null);

  const labelled = labelledExport !== undefined;
  const exporting = useRef({ figure, labelledExport });
  const previewing = previewBase !== undefined;
  const preview = useRef({ figure, base: previewBase ?? null });

  useEffect(() => {
    handler.current = onRelayout;
    exporting.current = { figure, labelledExport };
    preview.current = { figure, base: previewBase ?? null };
  }, [onRelayout, figure, labelledExport, previewBase]);

  // Hover/focus preview: restyle the drawn traces in place. Changes within one frame (leave one row, enter the
  // next) are merged into one restyle.
  useEffect(() => {
    const el = ref.current;
    if (!el || !previewing) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const { figure: fig, base } = preview.current;
      const r = previewRestyle(fig.data as unknown as { uid?: unknown }[], hoverStore.getState().id, base);
      if (r) void Plotly.restyle(el, r.update as unknown as Record<string, unknown>, r.indices);
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
    void Plotly.react(
      el,
      figure.data as unknown as PlotlyNativeData[],
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
        // A redraw while a row is hovered starts from the figure's own look: show the preview again.
        const hovered = hoverStore.getState().id;
        if (previewing && hovered !== null) {
          const r = previewRestyle(preview.current.figure.data as unknown as { uid?: unknown }[], hovered, preview.current.base);
          if (r) void Plotly.restyle(el, r.update as unknown as Record<string, unknown>, r.indices);
        }
        el.removeAllListeners?.('plotly_relayout');
        el.on?.('plotly_relayout', (update) => handler.current?.(el, update));
      })
      .catch(() => {
        setError('This plot could not be drawn (WebGL unavailable?)');
      });
  }, [figure, labelled, previewing]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) Plotly.purge(el);
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
