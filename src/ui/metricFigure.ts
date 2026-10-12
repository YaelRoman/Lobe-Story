import type { Data, PlotData } from 'plotly.js';
import type { ExportCaption } from './exportFigure';
import { LEGEND_NAME_MAX, middleEllipsis } from './legend';
import { LEGEND, type Figure, type FigureTheme } from './figureTheme';
import { minSpanRange } from './hpbwFigure';

/** One file's value of the plotted metric at its frequency; `null` leaves a gap in the line. */
export interface MetricPoint {
  freq: number;
  value: number | null;
  /** The value the file's header declares for this metric, drawn as a hollow marker. */
  declared?: number;
  /** The file's id: a click on the point names it (see `pickedFileId`). */
  id?: string;
}

export interface MetricSeries {
  label: string;
  color: string;
  points: MetricPoint[];
  /** The original (untilted) line under a tilt simulation: faint, no legend entry. */
  ghost?: boolean;
  symbol?: string;
}

/** The narrowest y range shown per unit, so a single frequency does not auto-scale to a few hundredths. */
const MIN_SPAN_BY_UNIT: Record<string, number> = { '°': 5, dB: 3, '%': 5 };
const DEFAULT_MIN_SPAN = 1;

export const minSpanForUnit = (unit: string): number => MIN_SPAN_BY_UNIT[unit] ?? DEFAULT_MIN_SPAN;

/** "F/B 180° (dB)": the y-axis title for a metric. */
export const metricAxisTitle = (label: string, unit: string): string => `${label} (${unit})`;

/** What the exported chart says about itself. */
/** `declared`: the metric has values declared in the file (hollow markers); only then does the caption explain them. */
export function metricCaption(label: string, unit: string, simulated: boolean, reference = false, declared = false): ExportCaption {
  return {
    title: `${metricAxisTitle(label, unit)} against frequency, one line per group`,
    file: `${label} in ${unit}: one line per group${declared ? ' · hollow markers: values declared in the file' : ''}`,
    items: [...(simulated ? ['Faint lines: original patterns before the simulated tilt'] : []), ...(reference ? ['Diamond: the reference file'] : [])],
  };
}

/** The pinned reference file's point: a large diamond in the text colour, named in the legend. */
export interface MetricReference {
  label: string;
  point: MetricPoint;
}

/** True when nothing would be drawn at a number: no point, declared value or reference point has one. */
export function noValues(series: MetricSeries[], reference?: MetricReference): boolean {
  const some = (v: number | null | undefined) => typeof v === 'number' && Number.isFinite(v);
  return !series.some((s) => s.points.some((p) => some(p.value) || some(p.declared))) && !(reference && some(reference.point.value));
}

/** What the frequency chart says in place of an empty chart: the metric, and the reasons the table's tooltips give (each once). */
export function noValueNote(label: string, reasons: (string | undefined)[]): string {
  const why = [...new Set(reasons.filter((r): r is string => Boolean(r)))];
  return `No file has a value for ${label}${why.length ? `: ${why.join('; ')}` : ''}.`;
}

/** One drawn line reduced to what makes it look the same as another: its label and its points as text. */
export interface LineSignature {
  label: string;
  points: { freq: number; value: number | null }[];
}

const signatureText = (l: LineSignature): string => l.points.map((p) => `${p.freq}:${p.value === null ? '-' : p.value.toFixed(6)}`).join('|');

/**
 * "2 lines coincide: A = B": lines whose points are exactly the same are drawn on top of each other, so the legend
 * lists more lines than the chart shows. Null when no two lines coincide (a line without any number never does).
 */
export function coincidingNote(lines: LineSignature[], maxSets = 3): string | null {
  const bySignature = new Map<string, string[]>();
  for (const l of lines) {
    if (!l.points.some((p) => p.value !== null)) continue;
    const key = signatureText(l);
    bySignature.set(key, [...(bySignature.get(key) ?? []), l.label]);
  }
  const sets = [...bySignature.values()].filter((labels) => labels.length > 1);
  if (!sets.length) return null;
  const text = sets.slice(0, maxSets).map((labels) => `${labels.length} lines coincide: ${labels.join(' = ')}`);
  if (sets.length > maxSets) text.push(`${sets.length - maxSets} more ${sets.length - maxSets === 1 ? 'set' : 'sets'}`);
  return `${text.join('; ')}.`;
}

/** One y axis: `label (unit)` against frequency, a line per group, gaps where a file has no value. */
export function buildMetricFigure(series: MetricSeries[], theme: FigureTheme, label: string, unit: string, reference?: MetricReference): Figure {
  // Plotly has `meta` (the export reads it as the full legend name); @types/plotly.js does not declare it.
  const data: (Partial<PlotData> & { meta?: string })[] = [];
  for (const s of series) {
    const x = s.points.map((p) => p.freq);
    const y = s.points.map((p) => p.value);
    if (s.ghost) {
      data.push({ type: 'scatter', mode: 'lines', name: `${s.label} (original)`, showlegend: false, opacity: 0.35, x, y, line: { color: s.color } });
      continue;
    }
    data.push({
      type: 'scatter', mode: 'lines+markers', name: middleEllipsis(s.label, LEGEND_NAME_MAX), legendgroup: s.label, meta: s.label,
      x, y, customdata: s.points.map((p) => p.id ?? null), line: { color: s.color }, marker: { symbol: s.symbol ?? 'circle' } as Partial<PlotData['marker']>,
    });
    const declared = s.points.filter((p) => p.declared !== undefined);
    if (declared.length) {
      data.push({
        type: 'scatter', mode: 'markers', name: `${s.label} declared`, legendgroup: s.label, showlegend: false,
        x: declared.map((p) => p.freq), y: declared.map((p) => p.declared as number), customdata: declared.map((p) => p.id ?? null),
        marker: { color: s.color, symbol: 'circle-open' as const, size: 9 },
      });
    }
  }
  if (reference) {
    const name = `${reference.label} (reference)`;
    data.push({
      type: 'scatter', mode: 'markers', name: middleEllipsis(name, LEGEND_NAME_MAX), meta: name,
      x: [reference.point.freq], y: [reference.point.value], customdata: [reference.point.id ?? null],
      marker: { color: theme.fg, symbol: 'diamond' as const, size: 13, line: { color: theme.bg, width: 1.5 } } as Partial<PlotData['marker']>,
    });
  }
  const range = minSpanRange([...series.flatMap((s) => s.points.flatMap((p) => [p.value, p.declared])), ...(reference ? [reference.point.value] : [])], minSpanForUnit(unit));
  return {
    data: data as Data[],
    layout: {
      paper_bgcolor: theme.bg,
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: theme.fg },
      margin: { l: 60, r: 20, t: 20, b: 50 },
      legend: LEGEND,
      xaxis: { automargin: true, title: { text: 'Frequency (MHz)', standoff: 8 }, gridcolor: theme.grid },
      yaxis: { title: { text: metricAxisTitle(label, unit) }, gridcolor: theme.grid, ...(range ? { range } : {}) },
    },
  };
}
