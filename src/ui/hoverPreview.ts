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

/**
 * Only a real mouse previews on hover: a touch tap fires pointerenter too, but nothing ever fires a leave until the
 * next tap, so the preview would stick and contradict the highlight.
 */
export const hoverPreviews = (e: { pointerType: string }): boolean => e.pointerType === 'mouse';

/** Only keyboard focus previews (what the browser draws a focus ring for): a tap or click focuses without leaving. */
export function focusPreviews(target: Element): boolean {
  try {
    return target.matches(':focus-visible');
  } catch {
    return true; // a browser without :focus-visible: keep the preview
  }
}

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

/**
 * What must still be sent to turn a figure that shows `prev` (what was last applied; null: unknown) into `next`:
 * only the traces whose width or opacity differ. Moving from one row to the next changes two traces, not all of
 * them. Null when nothing differs. Without a comparable `prev` (none, or other traces) it is all of `next`.
 */
export function restyleDiff(prev: PreviewRestyle | null, next: PreviewRestyle | null): PreviewRestyle | null {
  if (next === null) return null;
  const comparable = prev !== null && prev.indices.length === next.indices.length && prev.indices.every((v, i) => v === next.indices[i]);
  if (!comparable) return next;
  const keep = next.indices.map((_, i) => i).filter((i) => prev.update['line.width'][i] !== next.update['line.width'][i] || prev.update.opacity[i] !== next.update.opacity[i]);
  if (keep.length === 0) return null;
  return {
    indices: keep.map((i) => next.indices[i]),
    update: { 'line.width': keep.map((i) => next.update['line.width'][i]), opacity: keep.map((i) => next.update.opacity[i]) },
  };
}

/**
 * The traces as they are handed to Plotly. Plotly keeps the objects it is given and `Plotly.restyle` changes their
 * `line.width` and `opacity` in place, so the figure builder's own traces must not be the ones drawn: the export
 * is built from them and must never carry a hover or focus preview. A copy of each trace and of its `line` is enough.
 */
export function ownTraces<T extends object>(data: readonly T[]): T[] {
  return data.map((t) => {
    const line = (t as { line?: object }).line;
    return line ? { ...t, line: { ...line } } : { ...t };
  });
}
