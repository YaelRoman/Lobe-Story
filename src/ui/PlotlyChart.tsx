import { useEffect, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import type { Data as PlotlyNativeData, Layout as PlotlyNativeLayout } from 'plotly.js-dist-min';
import type { Figure } from './figureTheme';

type RelayoutHandler = (el: HTMLElement, update: Record<string, unknown>) => void;

type PlotlyElement = HTMLDivElement & {
  on?: (event: string, cb: (update: Record<string, unknown>) => void) => void;
  removeAllListeners?: (event: string) => void;
};

interface Props {
  figure: Figure;
  className?: string;
  testId?: string;
  onRelayout?: RelayoutHandler;
}

export function PlotlyChart({ figure, className, testId, onRelayout }: Props) {
  const ref = useRef<PlotlyElement>(null);
  const handler = useRef(onRelayout);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    handler.current = onRelayout;
  }, [onRelayout]);

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
        toImageButtonOptions: { format: 'png', scale: 2, filename: 'antenna-pattern' },
      },
    )
      .then(() => {
        el.removeAllListeners?.('plotly_relayout');
        el.on?.('plotly_relayout', (update) => handler.current?.(el, update));
      })
      .catch(() => {
        setError('This plot could not be drawn (WebGL unavailable?)');
      });
  }, [figure]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) Plotly.purge(el);
    };
  }, []);

  return (
    <div className={className} data-testid={testId} style={{ position: 'relative' }}>
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
      {error && (
        <p className="plot-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
