import type { Data, PlotData } from 'plotly.js';
import { bwName } from './bwLabel';
import type { ExportCaption } from './exportFigure';
import { LEGEND_NAME_MAX, middleEllipsis } from './legend';
import { LEGEND, type Figure, type FigureTheme } from './figureTheme';

export interface HpbwPoint {
  freq: number;
  h: number | null;
  v: number | null;
  declH?: number;
  declV?: number;
  /** The file's id: a click on the point names it (see `pickedFileId`). */
  id?: string;
}

export interface HpbwSeries {
  label: string;
  color: string;
  points: HpbwPoint[];
  ghost?: boolean;
  /** Marker of the group's lines (default circle): tells groups that share a hue apart. */
  symbol?: string;
}

/** What the exported chart says about itself: its title, which line is which, and what the other marks mean (the legend lists the groups). */
export function hpbwCaption(levelDb: number, simulated: boolean, reference = false): ExportCaption {
  const name = bwName(levelDb);
  return {
    title: `H-${name} and V-${name} against frequency, one line per group`,
    file: `Solid lines: horizontal (H-${name}) · dashed lines: vertical (V-${name}) · hollow markers: values declared in the file`,
    items: [...(simulated ? ['Faint lines: original patterns before the simulated tilt'] : []), ...(reference ? ['Diamond: the reference file'] : [])],
  };
}

/** The narrowest beamwidth axis shown (degrees): a single frequency would otherwise auto-scale to a few hundredths of a degree. */
export const MIN_SPAN_DEG = 5;

/** An axis range of at least `minSpan` centred on `values`, or undefined when the data already spans that much (or is empty). */
export function minSpanRange(values: (number | null | undefined)[], minSpan = MIN_SPAN_DEG): [number, number] | undefined {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (v.length === 0) return undefined;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  if (hi - lo >= minSpan) return undefined;
  const mid = (lo + hi) / 2;
  return [mid - minSpan / 2, mid + minSpan / 2];
}

/** The pinned reference file's point: drawn as a large diamond in the text colour on each panel. */
export interface HpbwReference {
  label: string;
  point: HpbwPoint;
}

export function buildHpbwFigure(series: HpbwSeries[], theme: FigureTheme, levelDb = 3, reference?: HpbwReference): Figure {
  // Plotly has `meta` (the export reads it as the full legend name); @types/plotly.js does not declare it.
  const data: (Partial<PlotData> & { meta?: string })[] = [];
  for (const s of series) {
    const x = s.points.map((p) => p.freq);
    if (s.ghost) {
      const name = `${s.label} (original)`;
      data.push({ type: 'scatter', mode: 'lines', name, showlegend: false, opacity: 0.35, x, y: s.points.map((p) => p.h), yaxis: 'y', line: { color: s.color } });
      data.push({ type: 'scatter', mode: 'lines', name, showlegend: false, opacity: 0.35, x, y: s.points.map((p) => p.v), yaxis: 'y2', line: { color: s.color, dash: 'dash' } });
      continue;
    }
    const ids = s.points.map((p) => p.id ?? null);
    data.push({ type: 'scatter', mode: 'lines+markers', name: middleEllipsis(s.label, LEGEND_NAME_MAX), legendgroup: s.label, meta: s.label, x, customdata: ids, y: s.points.map((p) => p.h), yaxis: 'y', line: { color: s.color }, marker: { symbol: s.symbol ?? 'circle' } as Partial<PlotData['marker']> });
    data.push({ type: 'scatter', mode: 'lines+markers', name: s.label, legendgroup: s.label, showlegend: false, x, customdata: ids, y: s.points.map((p) => p.v), yaxis: 'y2', line: { color: s.color, dash: 'dash' }, marker: { symbol: s.symbol ?? 'circle' } as Partial<PlotData['marker']> });
    const declared = s.points.filter((p) => p.declH !== undefined || p.declV !== undefined);
    if (declared.length) {
      const marker = { color: s.color, symbol: 'circle-open' as const, size: 9 };
      const declaredIds = declared.map((p) => p.id ?? null);
      data.push({ type: 'scatter', mode: 'markers', name: `${s.label} declared`, legendgroup: s.label, showlegend: false, x: declared.map((p) => p.freq), customdata: declaredIds, y: declared.map((p) => p.declH ?? null), yaxis: 'y', marker });
      data.push({ type: 'scatter', mode: 'markers', name: `${s.label} declared`, legendgroup: s.label, showlegend: false, x: declared.map((p) => p.freq), customdata: declaredIds, y: declared.map((p) => p.declV ?? null), yaxis: 'y2', marker });
    }
  }
  if (reference) {
    const marker = { color: theme.fg, symbol: 'diamond' as const, size: 13, line: { color: theme.bg, width: 1.5 } };
    const name = `${reference.label} (reference)`;
    const x = [reference.point.freq];
    data.push({ type: 'scatter', mode: 'markers', name: middleEllipsis(name, LEGEND_NAME_MAX), meta: name, x, customdata: [reference.point.id ?? null], y: [reference.point.h], yaxis: 'y', marker: marker as Partial<PlotData['marker']> });
    data.push({ type: 'scatter', mode: 'markers', name, showlegend: false, x, customdata: [reference.point.id ?? null], y: [reference.point.v], yaxis: 'y2', marker: marker as Partial<PlotData['marker']> });
  }
  const values = (axis: 'h' | 'v') => [...series.flatMap((s) => s.points.flatMap((p) => [p[axis], axis === 'h' ? p.declH : p.declV])), ...(reference ? [reference.point[axis]] : [])];
  const hRange = minSpanRange(values('h'));
  const vRange = minSpanRange(values('v'));
  return {
    data: data as Data[],
    layout: {
      paper_bgcolor: theme.bg,
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: theme.fg },
      margin: { l: 60, r: 20, t: 20, b: 50 },
      legend: LEGEND,
      xaxis: { automargin: true, title: { text: 'Frequency (MHz)', standoff: 8 }, gridcolor: theme.grid, anchor: 'y2' },
      yaxis: { title: { text: `H-${bwName(levelDb)} (°)` }, domain: [0.55, 1], gridcolor: theme.grid, ...(hRange ? { range: hRange } : {}) },
      yaxis2: { title: { text: `V-${bwName(levelDb)} (°)` }, domain: [0, 0.45], gridcolor: theme.grid, ...(vRange ? { range: vRange } : {}) },
    },
  };
}
