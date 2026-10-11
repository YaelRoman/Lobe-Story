import type { Data, Layout } from 'plotly.js';
import type { Figure } from './figureTheme';

export const EXPORT_WIDTH = 1200;
const EXPORT_MIN_HEIGHT = 700;
const LEGEND_ROW_PX = 18;
const LINE_MAX_CHARS = 110;

/** The highlighted file and its marker values, printed under the title of the exported image. */
export interface ExportCaption {
  file: string;
  items: string[];
}

/** Caption as text lines: the file name, then the values wrapped at about 110 characters. */
export function exportCaptionLines(caption: ExportCaption): string[] {
  const lines = [caption.file];
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
 * `meta` (the full label); marker traces never enter the legend. The input is not modified.
 */
export function exportFigure(figure: Figure, caption?: ExportCaption): Figure {
  // File traces: legend entry on and no dimming (faint legend swatches are unreadable); the highlighted one keeps its thicker line.
  const data = (figure.data as unknown as Record<string, unknown>[]).map((t): Record<string, unknown> => {
    if (typeof t.meta !== 'string') return t;
    const rest: Record<string, unknown> = { ...t, showlegend: true };
    delete rest.opacity;
    return rest;
  });
  const files = data.filter((t) => typeof t.meta === 'string').length;
  const lines = caption ? exportCaptionLines(caption) : [];
  const titleText = (figure.layout.title as { text?: string } | undefined)?.text ?? '';
  const margin = figure.layout.margin ?? {};
  const topExtra = lines.length > 0 ? 20 * lines.length + 20 : 0;
  const title = {
    ...(figure.layout.title as object | undefined),
    text: lines.length > 0 ? `${titleText}<br><sup>${lines.join('<br>')}</sup>` : titleText,
  };
  const layout: Partial<Layout> = {
    ...figure.layout,
    title: title as Layout['title'],
    showlegend: true,
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
    margin: { ...margin, r: 280, t: (margin.t ?? 50) + topExtra },
  };
  return { data: data as unknown as Data[], layout };
}
