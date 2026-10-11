import { createStore } from 'zustand/vanilla';
import { traceStyle } from './cutFigure';

/**
 * The file under the pointer or the keyboard focus in the panel or the table (null: none). A tiny store of its
 * own: the app's store is not written, so nothing re-renders; only the cut plots listen (see PlotlyChart).
 */
export const hoverStore = createStore<{ id: string | null }>(() => ({ id: null }));

/** Previews file `id` (null: stops previewing). Stable function: safe in memoised rows. */
export const setHoverId = (id: string | null): void => {
  if (hoverStore.getState().id !== id) hoverStore.setState({ id });
};

export interface PreviewRestyle {
  /** Plotly.restyle update: one value per entry of `indices`. `null` opacity resets to the default (opaque). */
  update: { 'line.width': number[]; opacity: (number | null)[] };
  indices: number[];
}

/**
 * The restyle that previews `hovered` on a drawn figure: its traces thick and the other files dimmed. File traces
 * are the ones with a string `uid` (the series id). A hovered file that is not drawn, or none, leaves the figure's
 * own emphasis (`base`, the highlighted file) in place, so leaving a row restores the highlight exactly.
 */
export function previewRestyle(data: readonly { uid?: unknown }[], hovered: string | null, base: string | null): PreviewRestyle | null {
  const ids = data.map((t) => (typeof t.uid === 'string' ? t.uid : null));
  const drawn = (id: string | null) => id !== null && ids.some((u) => u === id);
  const target = drawn(hovered) ? hovered : drawn(base) ? base : null;
  const indices: number[] = [];
  const widths: number[] = [];
  const opacities: (number | null)[] = [];
  ids.forEach((uid, i) => {
    if (uid === null) return;
    const style = traceStyle(uid, target);
    indices.push(i);
    widths.push(style.width);
    opacities.push(style.opacity);
  });
  return indices.length === 0 ? null : { update: { 'line.width': widths, opacity: opacities }, indices };
}
