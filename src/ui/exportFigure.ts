import type { Data, Layout } from 'plotly.js';
import type { Figure } from './figureTheme';

export const EXPORT_WIDTH = 1200;
const EXPORT_MIN_HEIGHT = 700;
const LEGEND_ROW_PX = 18;
const LINE_MAX_CHARS = 110;

/** What is printed under the title of the exported image. */
export interface ExportCaption {
  /** First line: the highlighted file's name (cut plots) or a one-line subtitle (other charts). */
  file?: string;
  /** Marker values or other facts, wrapped at about 110 characters. */
  items: string[];
  /** Title for a figure that has none on screen (its heading is page text). */
  title?: string;
}

/** Caption as text lines: the file name, then the values wrapped at about 110 characters. */
export function exportCaptionLines(caption: ExportCaption): string[] {
  const lines = caption.file ? [caption.file] : [];
  let current = '';
  for (const item of caption.items) {
    if (current && current.length + 3 + item.length > LINE_MAX_CHARS) {
      lines.push(current);
      current = item;
    } else current = current ? `${current} · ${item}` : item;
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * The figure as saved by "download image": the on-screen figure with its legend forced on (all file
 * traces, compact entries, to the right with a height that grows with the entries), and the
 * highlighted file's name and marker values under the title. File traces are the ones carrying
 * `meta` (the full label, which also replaces the compact legend name); marker traces never enter the
 * legend. A figure without file traces (a histogram) gets no legend. The input is not modified.
 */
export function exportFigure(figure: Figure, caption?: ExportCaption): Figure {
  // File traces: legend entry on and no dimming (faint legend swatches are unreadable); the highlighted one keeps its thicker line.
  const data = (figure.data as unknown as Record<string, unknown>[]).map((t): Record<string, unknown> => {
    if (typeof t.meta !== 'string') return t;
    const rest: Record<string, unknown> = { ...t, showlegend: true, name: t.meta };
    delete rest.opacity;
    return rest;
  });
  const files = data.filter((t) => typeof t.meta === 'string').length;
  const lines = caption ? exportCaptionLines(caption) : [];
  const titleText = (figure.layout.title as { text?: string } | undefined)?.text ?? caption?.title ?? '';
  const margin = figure.layout.margin ?? {};
  // Labels drawn above the plot area (the histogram's line names) need their own room under the caption.
  const labelRoom = (figure.layout.annotations?.length ?? 0) > 0 ? 40 : 0;
  const topExtra = lines.length > 0 ? 20 * lines.length + 20 + labelRoom : 0;
  const title = {
    ...(figure.layout.title as object | undefined),
    text: lines.length > 0 ? `${titleText}<br><sup>${lines.join('<br>')}</sup>` : titleText,
  };
  // Room for the longest legend entry (about 6 px a character at 11 px), at least the usual 280 px.
  const longest = Math.max(0, ...data.filter((t) => typeof t.meta === 'string').map((t) => (t.meta as string).length));
  const legendWidth = Math.min(520, Math.max(280, 50 + longest * 6));
  const layout: Partial<Layout> = {
    ...figure.layout,
    title: title as Layout['title'],
    showlegend: files > 0,
    legend: {
      orientation: 'v',
      xref: 'paper',
      x: 1.01,
      xanchor: 'left',
      yref: 'paper',
      y: 1,
      yanchor: 'top',
      font: { size: 11 },
      tracegroupgap: 0,
    },
    autosize: false,
    width: EXPORT_WIDTH,
    height: Math.max(EXPORT_MIN_HEIGHT, 160 + topExtra + files * LEGEND_ROW_PX),
    margin: { ...margin, ...(files > 0 ? { r: legendWidth } : {}), t: (margin.t ?? 50) + topExtra },
  };
  return { data: data as unknown as Data[], layout };
}
