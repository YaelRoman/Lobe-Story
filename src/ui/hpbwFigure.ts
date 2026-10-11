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
}

export interface HpbwSeries {
  label: string;
  color: string;
  points: HpbwPoint[];
  ghost?: boolean;
}

/** What the exported chart says about itself: its title, which line is which, and what the other marks mean (the legend lists the groups). */
export function hpbwCaption(levelDb: number, simulated: boolean): ExportCaption {
  const name = bwName(levelDb);
  return {
    title: `H-${name} and V-${name} against frequency, one line per group`,
    file: `Solid lines: horizontal (H-${name}) · dashed lines: vertical (V-${name}) · hollow markers: values declared in the file`,
    items: simulated ? ['Faint lines: original patterns before the simulated tilt'] : [],
  };
}

export function buildHpbwFigure(series: HpbwSeries[], theme: FigureTheme, levelDb = 3): Figure {
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
    data.push({ type: 'scatter', mode: 'lines+markers', name: middleEllipsis(s.label, LEGEND_NAME_MAX), legendgroup: s.label, meta: s.label, x, y: s.points.map((p) => p.h), yaxis: 'y', line: { color: s.color } });
    data.push({ type: 'scatter', mode: 'lines+markers', name: s.label, legendgroup: s.label, showlegend: false, x, y: s.points.map((p) => p.v), yaxis: 'y2', line: { color: s.color, dash: 'dash' } });
    const declared = s.points.filter((p) => p.declH !== undefined || p.declV !== undefined);
    if (declared.length) {
      const marker = { color: s.color, symbol: 'circle-open' as const, size: 9 };
      data.push({ type: 'scatter', mode: 'markers', name: `${s.label} declared`, legendgroup: s.label, showlegend: false, x: declared.map((p) => p.freq), y: declared.map((p) => p.declH ?? null), yaxis: 'y', marker });
      data.push({ type: 'scatter', mode: 'markers', name: `${s.label} declared`, legendgroup: s.label, showlegend: false, x: declared.map((p) => p.freq), y: declared.map((p) => p.declV ?? null), yaxis: 'y2', marker });
    }
  }
  return {
    data: data as Data[],
    layout: {
      paper_bgcolor: theme.bg,
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: theme.fg },
      margin: { l: 60, r: 20, t: 20, b: 50 },
      legend: LEGEND,
      xaxis: { automargin: true, title: { text: 'Frequency (MHz)', standoff: 8 }, gridcolor: theme.grid, anchor: 'y2' },
      yaxis: { title: { text: `H-${bwName(levelDb)} (°)` }, domain: [0.55, 1], gridcolor: theme.grid },
      yaxis2: { title: { text: `V-${bwName(levelDb)} (°)` }, domain: [0, 0.45], gridcolor: theme.grid },
    },
  };
}
