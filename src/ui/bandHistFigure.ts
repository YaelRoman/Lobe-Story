import type { Annotations, Data, Shape } from 'plotly.js';
import type { BandStat } from '../core/analysis/bandStats';
import { PALETTE } from './colors';
import type { Figure, FigureTheme } from './figureTheme';

export interface BandHistInput {
  values: number[];
  stat: BandStat | null;
  label: string;
  unit: string;
}

interface Mark {
  x: number;
  text: string;
  dash: 'solid' | 'dash' | 'dot';
}

function marks(stat: BandStat | null): Mark[] {
  if (!stat) return [];
  switch (stat.kind) {
    case 'double':
      return [
        { x: stat.mean, text: 'mean', dash: 'solid' },
        { x: stat.lower, text: 'P6.7', dash: 'dash' },
        { x: stat.upper, text: 'P93.3', dash: 'dash' },
      ];
    case 'mean':
      return [{ x: stat.mean, text: 'mean', dash: 'solid' }];
    default: {
      const name = stat.kind === 'max' ? 'P84' : 'P16';
      if (!stat.adjusted) return [{ x: stat.value, text: name, dash: 'solid' }];
      return [
        { x: stat.value, text: 'spec', dash: 'solid' },
        { x: stat.percentile, text: name, dash: 'dot' },
      ];
    }
  }
}

/** Histogram of the samples behind one band-statistics cell, with the statistic drawn as vertical lines. */
export function buildBandHistFigure({ values, stat, label, unit }: BandHistInput, theme: FigureTheme): Figure {
  const lines = marks(stat);
  const shapes: Partial<Shape>[] = lines.map((m) => ({
    type: 'line',
    xref: 'x',
    yref: 'paper',
    x0: m.x,
    x1: m.x,
    y0: 0,
    y1: 1,
    line: { color: theme.accent, width: 2, dash: m.dash },
  }));
  const annotations: Partial<Annotations>[] = lines.map((m) => ({
    x: m.x,
    xref: 'x',
    y: 1,
    yref: 'paper',
    yanchor: 'bottom',
    showarrow: false,
    text: m.text,
  }));
  return {
    data: [
      { type: 'histogram', x: values, marker: { color: PALETTE[0] }, hovertemplate: '%{x}: %{y}<extra></extra>' },
    ] as Data[],
    layout: {
      paper_bgcolor: theme.bg,
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: theme.fg },
      margin: { l: 60, r: 20, t: 30, b: 50 },
      showlegend: false,
      bargap: 0.05,
      xaxis: { title: { text: `${label} (${unit})` }, gridcolor: theme.grid },
      yaxis: { title: { text: 'Samples' }, gridcolor: theme.grid },
      shapes,
      annotations,
    },
  };
}
