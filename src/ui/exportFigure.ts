import type { Data, Layout } from 'plotly.js';
import { FIGURE_THEMES, type Figure } from './figureTheme';

export const EXPORT_WIDTH = 1200;
const EXPORT_MIN_HEIGHT = 700;
/** Height of one legend entry at the export's 11 px font (the library draws 19 px rows). */
export const LEGEND_ROW_PX = 20;
/** The tallest image written: at the export's scale of 2 a browser canvas ends a little above this. */
export const EXPORT_MAX_HEIGHT = 8000;
/** Room the legend needs besides its rows. */
const LEGEND_PAD_PX = 20;
/** The bottom margin the library uses when the figure sets none. */
const DEFAULT_MARGIN_B = 80;
const LINE_MAX_CHARS = 110;
/** The library's size of a title that sets none. */
const DEFAULT_TITLE_PX = 17;
/** The library's line spacing of a title of several lines, in ems of the title's font size. */
export const CAPTION_LINE_EM = 1.3;
/**
 * How far above its anchor the library draws the first line of a title of several lines, in ems: a one-line title
 * hangs from its anchor by this much, a title with line breaks does not (seen in the browser).
 */
export const TITLE_FIRST_LINE_EM = 0.7;
/** From the image's top edge to the title. */
const TITLE_PAD_PX = 10;
/** Between the last caption line and what the figure draws above its plot area. */
const CAPTION_GAP_PX = 8;

/** The room the foot line takes under what the figure draws below its plot area. */
export const FOOT_ROOM_PX = 18;
/** From the image's lower edge up to the foot line. */
const FOOT_PAD_PX = 4;
/** What an x axis that makes its own room (`automargin`) takes for its tick labels and its title. */
const AXIS_ROOM_PX = 60;
/** The foot line's colour: the page's muted text in the light theme. */
const FOOT_COLOR = '#57606a';

/** What is printed under the title of the exported image. */
export interface ExportCaption {
  /** First line: the highlighted file's name (cut plots) or a one-line subtitle (other charts). */
  file?: string;
  /** Marker values or other facts, wrapped at about 110 characters. */
  items: string[];
  /** Title for a figure that has none on screen (its heading is page text). */
  title?: string;
  /** Which lines are drawn on top of each other (a frequency chart), a wrapped line of its own after the values, as under the chart on screen. */
  coincide?: string;
  /** What the analysis markers that are on mean (cut plots), one wrapped line of its own after the values. */
  markers?: string;
  /** The last line while a simulation is active: the tilt and azimuth values and the method. */
  simulated?: string;
  /** A caveat about the simulated picture, on its own wrapped line after the simulation line. */
  note?: string;
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
  for (const extra of [caption.coincide, caption.markers, caption.simulated, caption.note]) if (extra) lines.push(...wrapText(extra));
  return lines;
}

/** The caption with the simulation line added (a caption of its own when there was none); unchanged without a simulation. */
export function withSimulated(caption: ExportCaption | undefined, simulated: string | undefined, note?: string): ExportCaption | undefined {
  if (simulated === undefined) return caption;
  return { items: [], ...caption, simulated, ...(note ? { note } : {}) };
}

/** The caption with the note about lines that coincide (see `coincidingNote`); unchanged without one. */
export function withCoinciding(caption: ExportCaption | undefined, coincide: string | null | undefined): ExportCaption | undefined {
  return caption && coincide ? { ...caption, coincide } : caption;
}

/** A long sentence broken at spaces into lines of about 110 characters. */
function wrapText(text: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    if (current && current.length + 1 + word.length > LINE_MAX_CHARS) {
      out.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) out.push(current);
  return out;
}

/**
 * The figure with every colour of the `from` theme replaced by the light theme's (text, grid lines, marker colour and
 * background): an exported image is for a page or a report, so it is white whatever the screen theme. Trace colours of
 * the files are the same in both themes. The input is not modified.
 */
export function inLightTheme(figure: Figure, from: 'light' | 'dark'): Figure {
  if (from === 'light') return figure;
  const map = new Map<string, string>();
  for (const key of ['fg', 'grid', 'accent', 'bg'] as const) map.set(FIGURE_THEMES[from][key].toLowerCase(), FIGURE_THEMES.light[key]);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return map.get(v.toLowerCase()) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(figure) as Figure;
}

/**
 * The figure as saved by "download image": the on-screen figure with its legend forced on (all file
 * traces, compact entries, to the right with a height that grows with the entries), and the
 * highlighted file's name and marker values under the title. File traces are the ones carrying
 * `meta` (the full label, which also replaces the compact legend name); marker traces never enter the
 * legend. A figure without file traces (a histogram) gets no legend. It is drawn with the light theme's colours on white
 * whatever `screenTheme` the screen has. `foot` is one small line at the foot of the image (see `exportFootLine`). The
 * input is not modified.
 */
export function exportFigure(figure: Figure, caption?: ExportCaption, screenTheme: 'light' | 'dark' = 'light', foot?: string): Figure {
  figure = inLightTheme(figure, screenTheme);
  // File traces: legend entry on and no dimming (faint legend swatches are unreadable); the highlighted one keeps its thicker line.
  let data = (figure.data as unknown as Record<string, unknown>[]).map((t): Record<string, unknown> => {
    if (typeof t.meta !== 'string') return t;
    const rest: Record<string, unknown> = { ...t, showlegend: true, name: t.meta };
    delete rest.opacity;
    return rest;
  });
  const traces = data.filter((t) => typeof t.meta === 'string').length;
  const lines = caption ? exportCaptionLines(caption) : [];
  const margin = figure.layout.margin ?? {};
  const screenTitle = figure.layout.title as { text?: string; font?: { size?: number } } | undefined;
  const titleText = screenTitle?.text || caption?.title || '';
  const titlePx = screenTitle?.font?.size ?? DEFAULT_TITLE_PX;
  const lineHeight = CAPTION_LINE_EM * titlePx;
  /**
   * The top margin under a caption of so many lines. The title hangs from the top edge and its lines run down from
   * there, so the margin is what they take and no more. A figure with a title on screen already has room for one line
   * in its margin; one without (its heading is page text) keeps its whole margin for what it draws above the plot area
   * (the histogram's line names).
   */
  const topFor = (captionLines: number) => {
    const own = margin.t ?? 50;
    if (!titleText && captionLines === 0) return own;
    const textEnd = TITLE_PAD_PX + titlePx + lineHeight * captionLines;
    return Math.ceil(screenTitle?.text ? Math.max(own + lineHeight * captionLines, textEnd + CAPTION_GAP_PX) : textEnd + CAPTION_GAP_PX + own);
  };
  // The legend hangs from the top of the plot area: the image is made as high as its rows need. Only beyond the
  // tallest image that can be written are entries left out, and then a caption line says how many.
  // The foot line hangs under the plot area by the whole bottom margin, so that margin has to be known: an axis that
  // would widen it for its labels and title gets that room up front, and the line its own below it.
  const ownAxisRoom = Object.entries(figure.layout).some(([key, axis]) => key.startsWith('xaxis') && (axis as { automargin?: boolean } | undefined)?.automargin === true);
  const bottom = foot ? Math.max(margin.b ?? DEFAULT_MARGIN_B, ownAxisRoom ? AXIS_ROOM_PX : 0) + FOOT_ROOM_PX : (margin.b ?? DEFAULT_MARGIN_B);
  const heightFor = (rows: number, captionLines: number) => topFor(captionLines) + bottom + rows * LEGEND_ROW_PX + LEGEND_PAD_PX;
  let files = traces;
  if (heightFor(traces, lines.length) > EXPORT_MAX_HEIGHT) {
    files = Math.max(0, Math.floor((EXPORT_MAX_HEIGHT - heightFor(0, lines.length + 1)) / LEGEND_ROW_PX));
    lines.push(`Legend: the first ${files} of ${traces} traces, +${traces - files} more are drawn but not listed`);
    let seen = 0;
    data = data.map((t) => (typeof t.meta === 'string' && ++seen > files ? { ...t, showlegend: false } : t));
  }
  const title = {
    ...(figure.layout.title as object | undefined),
    text: lines.length > 0 ? `${titleText}<br><sup>${lines.join('<br>')}</sup>` : titleText,
    // From the top edge down: placed by the library's default (the middle of the margin) a long caption leaves an empty band above the title and ends on the plot area.
    ...(titleText || lines.length > 0 ? { yref: 'container', y: 1, yanchor: 'top', pad: { t: TITLE_PAD_PX + (lines.length > 0 ? TITLE_FIRST_LINE_EM * titlePx : 0) } } : {}),
  };
  // Room for the longest legend entry (about 6 px a character at 11 px), at least the usual 280 px.
  const longest = Math.max(0, ...data.filter((t) => typeof t.meta === 'string').map((t) => (t.meta as string).length));
  const legendWidth = Math.min(520, Math.max(280, 50 + longest * 6));
  const layout: Partial<Layout> = {
    ...figure.layout,
    paper_bgcolor: FIGURE_THEMES.light.bg,
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
    height: Math.max(EXPORT_MIN_HEIGHT, heightFor(files, lines.length)),
    margin: { ...margin, ...(files > 0 ? { r: legendWidth } : {}), t: topFor(lines.length), ...(foot ? { b: bottom } : {}) },
    ...(foot
      ? {
          annotations: [
            ...(figure.layout.annotations ?? []),
            { text: foot, xref: 'paper', yref: 'paper', x: 0, y: 0, xanchor: 'left', yanchor: 'bottom', yshift: FOOT_PAD_PX - bottom, showarrow: false, font: { size: 10, color: FOOT_COLOR } },
          ],
        }
      : {}),
  };
  return { data: data as unknown as Data[], layout };
}
