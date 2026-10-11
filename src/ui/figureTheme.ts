import type { Data, Layout } from 'plotly.js';

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
