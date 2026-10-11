import type { Annotations, Data, PlotData, Shape } from 'plotly.js';
import type { BandStat } from '../core/analysis/bandStats';
import { PALETTE } from './colors';
import type { ExportCaption } from './exportFigure';
import type { Figure, FigureTheme } from './figureTheme';

/** The histogram trace. `@types/plotly.js` has no `nbinsx` on its trace type, though Plotly takes it: the one place that says so. */
function histogramTrace(values: number[]): Data {
  const trace: Partial<PlotData> & { nbinsx: number } = {
    type: 'histogram',
    x: values,
    nbinsx: histBins(values.length),
    marker: { color: PALETTE[0] },
    hovertemplate: '%{x}: %{y}<extra></extra>',
  };
  return trace;
}

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

const fmt = (v: number): string => String(Number(v.toFixed(2)));

/** The statistic as text: "mean 65.13 °, P6.7 61.36 °, P93.3 69.4 °" (the lines drawn in the histogram). */
export function statText(stat: BandStat | null, unit: string): string {
  const lines = marks(stat);
  if (lines.length === 0) return 'none';
  return lines.map((m) => `${m.text} ${fmt(m.x)}${unit ? ` ${unit}` : ''}`).join(', ');
}

export interface BandHistCaptionInput {
  antenna: string;
  subBand: { name: string; minMHz: number; maxMHz: number };
  parameter: string;
  stat: BandStat | null;
  unit: string;
  n: number;
  /** The samples are of the tilted (simulated) patterns. */
  tilted?: boolean;
}

/** What the exported histogram says about itself: antenna, sub-band, parameter and statistic (the figure has no legend). */
export function bandHistCaption(c: BandHistCaptionInput): ExportCaption {
  const range = `${fmt(c.subBand.minMHz)}–${fmt(c.subBand.maxMHz)} MHz`;
  return {
    title: `${c.parameter} — histogram of the band samples`,
    file: `Antenna: ${c.antenna} · Sub-band: ${c.subBand.name}${range.includes(c.subBand.name) || c.subBand.name.includes(range) ? '' : ` (${range})`}`,
    items: [`Parameter: ${c.parameter}`, `Statistic: ${statText(c.stat, c.unit)}`, `N = ${c.n}${c.tilted ? ' (tilted)' : ''}`],
  };
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
    data: [histogramTrace(values)],
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
