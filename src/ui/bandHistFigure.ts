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

/** Bin count from the sample count: about sqrt(N) + 2, between 5 and 20. */
export const histBins = (n: number): number => Math.min(20, Math.max(5, Math.round(Math.sqrt(n)) + 2));

const LABEL_GAP = 0.03;
const LABEL_STEP_PX = 14;

/** Vertical label offsets (px): a label within 3 % of the axis range of the previous one (or at the same x) goes a step higher. */
export function labelLevels(xs: readonly number[], lo: number, hi: number): number[] {
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const levels: number[] = xs.map(() => 0);
  const span = hi - lo;
  let prev = -1;
  for (const i of order) {
    levels[i] = prev >= 0 && xs[i] - xs[prev] <= Math.max(LABEL_GAP * span, 1e-9) ? (levels[prev] + 1) % 3 : 0;
    prev = i;
  }
  return levels;
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
  const all = [...values, ...lines.map((m) => m.x)];
  const levels = labelLevels(lines.map((m) => m.x), Math.min(...all), Math.max(...all));
  const annotations: Partial<Annotations>[] = lines.map((m, i) => ({
    x: m.x,
    xref: 'x',
    y: 1,
    yref: 'paper',
    yanchor: 'bottom',
    yshift: levels[i] * LABEL_STEP_PX,
    showarrow: false,
    text: m.text,
  }));
  return {
    data: [
      { type: 'histogram', x: values, nbinsx: histBins(values.length), marker: { color: PALETTE[0] }, hovertemplate: '%{x}: %{y}<extra></extra>' },
    ] as unknown as Data[],
    layout: {
      paper_bgcolor: theme.bg,
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: theme.fg },
      margin: { l: 60, r: 20, t: 30 + LABEL_STEP_PX * Math.max(0, ...levels), b: 50 },
      showlegend: false,
      bargap: 0.05,
      xaxis: { title: { text: `${label} (${unit})` }, gridcolor: theme.grid },
      yaxis: { title: { text: 'Samples' }, gridcolor: theme.grid },
      shapes,
      annotations,
    },
  };
}
