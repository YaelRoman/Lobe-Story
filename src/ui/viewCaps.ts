import type { ExportCaption } from './exportFigure';
import type { Layout3d } from '../state/store';

export { MAX_3D, MAX_3D_OVERLAY, maxSurfaces } from './surfaceFigure';

export interface Capped<T> {
  shown: T[];
  total: number;
}

/**
 * At most `cap` of `items` (the ticked files in panel order), the highlighted file first when it is among them so a
 * cap never hides the file the user is looking at. Within the cap nothing is reordered or dropped.
 */
export function capItems<T extends { pattern: { id: string } }>(items: T[], cap: number, highlightedId: string | null): Capped<T> {
  if (items.length <= cap) return { shown: items, total: items.length };
  const at = highlightedId === null ? -1 : items.findIndex((i) => i.pattern.id === highlightedId);
  const ordered = at <= 0 ? items : [items[at], ...items.slice(0, at), ...items.slice(at + 1)];
  return { shown: ordered.slice(0, cap), total: items.length };
}

/** The note shown when a cap hides ticked files (`what` is the subject and verb, e.g. "The 3D overlay draws"): what is drawn, the cap, and how to choose which files are drawn. */
export function capNotice(what: string, shown: number, total: number, cap: number): string | null {
  if (total <= shown) return null;
  return `${what} at most ${cap} files: showing ${shown} of the ${total} ticked (the highlighted file first, then the others in panel order). To choose which, untick files or use "Only matches" in the file panel. The table and the beamwidth chart still list all ${total}.`;
}

/**
 * The caption of a 3D view's exported image: its title; when a cap left files out, how many of the ticked files it
 * shows; what the page says above the view (the method, and that the shape is an estimate); and what the radius means.
 * Side by side each surface is coloured by its level; in the overlay each file has one colour.
 */
export function surfaceExportCaption(layout: Layout3d, shown: number, total: number, method: 'summation' | 'weighted', floorDb: number): ExportCaption {
  const scale = `level relative to the peak, 0 dB outermost, the floor of −${floorDb} dB at the centre`;
  return {
    title: `3D radiation pattern, ${layout === 'grid' ? 'side by side' : 'overlay'}`,
    file: total > shown ? `Showing ${shown} of ${total} ticked files` : undefined,
    items: [
      `Reconstructed from the H and V cuts (${method} method): an estimate from two cuts, not measured data`,
      layout === 'grid' ? `Radius and colour: ${scale}` : `Radius: ${scale}; one colour per file`,
    ],
  };
}
