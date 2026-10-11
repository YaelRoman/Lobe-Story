import type { Data, Layout, Legend } from 'plotly.js';

export interface Figure {
  data: Data[];
  layout: Partial<Layout>;
}

export interface FigureTheme {
  fg: string;
  grid: string;
  accent: string;
  bg: string;
}

export const FIGURE_THEMES: Record<'light' | 'dark', FigureTheme> = {
  light: { fg: '#1f2328', grid: '#d0d7de', accent: '#cf222e', bg: '#ffffff' },
  dark: { fg: '#e6edf3', grid: '#30363d', accent: '#ff7b72', bg: '#0d1117' },
};

/**
 * Legend shared by the 2D charts. It is anchored to the bottom of the card (not to the plot area),
 * so Plotly reserves its band below the axis title instead of drawing over it. `maxheight` is a
 * fraction of the card: longer legends scroll instead of squeezing the plot.
 */
export const LEGEND_MAX_HEIGHT = 0.2;
// Plotly 4 supports `legend.maxheight`; @types/plotly.js does not declare it yet.
export const LEGEND: Partial<Legend> & { maxheight: number } = {
  orientation: 'h',
  yref: 'container',
  y: 0,
  yanchor: 'bottom',
  x: 0,
  xanchor: 'left',
  font: { size: 11 },
  tracegroupgap: 0,
  maxheight: LEGEND_MAX_HEIGHT,
};
