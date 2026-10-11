import { useEffect, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Data as PlotlyNativeData, Layout as PlotlyNativeLayout } from 'plotly.js-dist-min';
import type { Figure } from './figureTheme';
import { exportFigure, type ExportCaption } from './exportFigure';

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
  /** The plot's accessible name (the plot itself is a picture for assistive technology). */
  ariaLabel?: string;
  onRelayout?: RelayoutHandler;
  /** Replaces the modebar's image download by one of a labelled version of the figure (legend on, highlighted file's values). */
  labelledExport?: { caption?: ExportCaption };
}

export function PlotlyChart({ figure, className, testId, ariaLabel, onRelayout, labelledExport }: Props) {
  const ref = useRef<PlotlyElement>(null);
  const handler = useRef(onRelayout);
  const [error, setError] = useState<string | null>(null);

  const labelled = labelledExport !== undefined;
  const exporting = useRef({ figure, labelledExport });

  useEffect(() => {
    handler.current = onRelayout;
    exporting.current = { figure, labelledExport };
  }, [onRelayout, figure, labelledExport]);

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
                      { ...IMAGE_OPTIONS, width: out.layout.width ?? null, height: out.layout.height ?? null },
                    );
                  },
                },
              ],
            }
          : {}),
      },
    )
      .then(() => {
        el.removeAllListeners?.('plotly_relayout');
        el.on?.('plotly_relayout', (update) => handler.current?.(el, update));
      })
      .catch(() => {
        setError('This plot could not be drawn (WebGL unavailable?)');
      });
  }, [figure, labelled]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) Plotly.purge(el);
    };
  }, []);

  return (
    <div className={className} data-testid={testId} role={ariaLabel ? 'img' : undefined} aria-label={ariaLabel} style={{ position: 'relative' }}>
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
      {error && (
        <p className="plot-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
