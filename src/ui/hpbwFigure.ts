import type { Data, PlotData } from 'plotly.js';
import type { Figure, FigureTheme } from './figureTheme';

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

export function buildHpbwFigure(series: HpbwSeries[], theme: FigureTheme): Figure {
  const data: Partial<PlotData>[] = [];
  for (const s of series) {
    const x = s.points.map((p) => p.freq);
    if (s.ghost) {
      const name = `${s.label} (original)`;
      data.push({ type: 'scatter', mode: 'lines', name, showlegend: false, opacity: 0.35, x, y: s.points.map((p) => p.h), yaxis: 'y', line: { color: s.color } });
      data.push({ type: 'scatter', mode: 'lines', name, showlegend: false, opacity: 0.35, x, y: s.points.map((p) => p.v), yaxis: 'y2', line: { color: s.color, dash: 'dash' } });
      continue;
    }
    data.push({ type: 'scatter', mode: 'lines+markers', name: s.label, legendgroup: s.label, x, y: s.points.map((p) => p.h), yaxis: 'y', line: { color: s.color } });
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
      legend: { orientation: 'h', y: -0.2 },
      xaxis: { title: { text: 'Frequency (MHz)' }, gridcolor: theme.grid, anchor: 'y2' },
      yaxis: { title: { text: 'H-HPBW (°)' }, domain: [0.55, 1], gridcolor: theme.grid },
      yaxis2: { title: { text: 'V-HPBW (°)' }, domain: [0, 0.45], gridcolor: theme.grid },
    },
  };
}
