import { createStore } from 'zustand/vanilla';
import { traceStyle } from './cutFigure';
import { isReferenceUid, seriesIdOf } from './traceUid';

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
 * A mouse or a hovering pen previews on hover (a pen fires pointerleave when it leaves the screen's range). Touch does
 * not: a tap fires pointerenter too, but nothing fires a leave until the next tap, so the preview would stick and
 * contradict the highlight.
 */
export const hoverPreviews = (e: { pointerType: string }): boolean => e.pointerType === 'mouse' || e.pointerType === 'pen';

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
 * are the ones whose `uid` is a file trace's (see `traceUid`). A hovered file that is not drawn, or none, leaves the figure's
 * own emphasis (`base`, the highlighted file) in place, so leaving a row restores the highlight exactly.
 */
export function previewRestyle(data: readonly { uid?: unknown }[], hovered: string | null, base: string | null): PreviewRestyle | null {
  // The reference file's trace belongs to its file as any other: hovering its row previews it, and it is never dimmed.
  const ids = data.map((t) => seriesIdOf(t.uid));
  const drawn = (id: string | null) => id !== null && ids.some((u) => u === id);
  const target = drawn(hovered) ? hovered : drawn(base) ? base : null;
  const indices: number[] = [];
  const widths: number[] = [];
  const opacities: (number | null)[] = [];
  ids.forEach((id, i) => {
    if (id === null) return;
    const style = traceStyle(id, target, isReferenceUid(data[i].uid));
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
 * What a redrawn figure shows once `Plotly.react` has resolved: its own look (`own`), unless a restyle was sent while the
 * redraw was pending (`restyledMeanwhile`): that one landed on the new traces, so what is shown is unknown (null).
 */
export function appliedAfterRedraw(own: PreviewRestyle | null, restyledMeanwhile: boolean): PreviewRestyle | null {
  return restyledMeanwhile ? null : own;
}

/**
 * Numbers the redraws (`Plotly.react` calls) of one plot so that only the latest one's completion counts: when a second
 * redraw starts before the first resolves, the first one's settle must not clear the second's pending flags.
 */
export function createRedrawGate() {
  let latest = 0;
  return {
    /** A redraw starts; returns its number. */
    start: (): number => ++latest,
    /** Whether the redraw with this number is still the latest one. */
    isLatest: (n: number): boolean => n === latest,
  };
}

/**
 * The traces as they are handed to Plotly. Plotly keeps the objects it is given and `Plotly.restyle` changes their
 * `line.width` and `opacity` in place, so the figure builder's own traces must not be the ones drawn: the export
 * is built from them and must never carry a hover or focus preview. A copy of each trace and of its `line` is enough.
 * With a `look` (see `previewRestyle`) the copies are handed over already in it: a figure drawn while a file is
 * highlighted starts with that file emphasised, as if the restyle had been sent.
 */
export function ownTraces<T extends object>(data: readonly T[], look: PreviewRestyle | null = null): T[] {
  const out = data.map((t) => {
    const line = (t as { line?: object }).line;
    return line ? { ...t, line: { ...line } } : { ...t };
  });
  applyLook(out, look);
  return out;
}

/**
 * Puts `traces` (the copies `ownTraces` made, in the figure's order) in a `look`, in place, as `Plotly.restyle` would
 * but without a call to the library: for traces that are about to be handed to it again anyway.
 */
export function applyLook(traces: readonly object[], look: PreviewRestyle | null): void {
  look?.indices.forEach((index, k) => {
    const t = traces[index] as { line?: { width?: number }; opacity?: number };
    if (t.line) t.line.width = look.update['line.width'][k];
    else t.line = { width: look.update['line.width'][k] };
    const opacity = look.update.opacity[k];
    if (opacity === null) delete t.opacity;
    else t.opacity = opacity;
  });
}

/**
 * The order in which a figure's traces are handed to the charting library, which draws them in that order, the last
 * one on top: `order[k]` is the index in `data` of the trace drawn k-th. It is the figure's own order, but for the
 * `emphasised` file (the highlighted one): its trace goes just under the reference file's, or last when there is no
 * reference, with its dashed original right under it. Among dozens of dimmed traces a line 1 px wider is otherwise
 * covered where they overlap. The reference stays on top, and an emphasised reference moves nothing. The legend
 * keeps the files' order (the traces carry a `legendrank`).
 */
export function drawingOrder(data: readonly { uid?: unknown }[], emphasised: string | null): number[] {
  const all = data.map((_, i) => i);
  if (emphasised === null) return all;
  const is = (i: number, id: string) => !isReferenceUid(data[i].uid) && seriesIdOf(data[i].uid) === id;
  const file = all.filter((i) => is(i, emphasised));
  if (file.length === 0) return all;
  const moved = [...all.filter((i) => is(i, `${emphasised}#original`)), ...file];
  const rest = all.filter((i) => !moved.includes(i));
  const reference = rest.findIndex((i) => isReferenceUid(data[i].uid));
  const at = reference === -1 ? rest.length : reference;
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}

/** Where each trace of the figure is drawn: `positions[i]` is the place in `order` (see `drawingOrder`) of trace `i`. */
export function positionsIn(order: readonly number[]): number[] {
  const positions = new Array<number>(order.length);
  order.forEach((index, k) => {
    positions[index] = k;
  });
  return positions;
}

/**
 * `restyle`, whose indices are the figure's, addressed to the places the traces are drawn at (`positions`, see
 * `positionsIn`; null: they are drawn in the figure's order). `Plotly.restyle` goes by the drawn order.
 */
export function restyleAt(restyle: PreviewRestyle, positions: readonly number[] | null): PreviewRestyle {
  return positions === null ? restyle : { update: restyle.update, indices: restyle.indices.map((i) => positions[i]) };
}
