import type { Layout } from 'plotly.js';

/**
 * A cut plot with many files draws the highlighted file's part (its markers, the title, in the rectangular plot the
 * marker shapes) in a second chart laid over the first, the marker layer. The charting library redraws every trace of
 * a chart when any trace's data changes, and has no call that redraws some of them: with the markers among the file
 * traces, a highlight cost a redraw of all of them in both cut plots (about 300 ms with 192 files). Over a layer, a
 * highlight restyles the file traces, moves the highlighted one on top, and redraws the layer, which holds a handful of
 * traces.
 *
 * The two charts make one picture, drawn in the order of a single chart: under the layer the background, the grid and
 * the file traces; in the layer the marker traces, then the axis lines, tick labels and axis titles (the library draws
 * those over the traces), the marker shapes and the title. Both lay the plot out alike: the same layout, so the same
 * margins (the tick labels the lower chart does not show are laid out all the same, in a clear colour), ranges and
 * angles, and the layer follows every change of view of the lower chart (see `withView`).
 *
 * The layer takes no pointer: the chart under it is the one that is zoomed, turned and hovered. Where that chart has
 * no trace to name under the pointer, the layer is asked for its hover instead (a polar plot names its markers).
 *
 * With fewer files a highlight's redraw is short, and the markers stay among the traces as before.
 */

/** From this many file traces on, a cut plot draws the highlighted file's part in a layer of its own. */
export const MARKER_LAYER_FROM = 25;

export const usesMarkerLayer = (fileTraces: number): boolean => fileTraces >= MARKER_LAYER_FROM;

/** A colour that draws nothing. */
export const CLEAR = 'rgba(0,0,0,0)';

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : {});

/**
 * An axis laid out as it is but not drawn: tick labels and title in a clear colour, and the line and the tick marks
 * where it has them (the grid stays). A polar axis has both by default; a colour given to the line or the ticks of an
 * x or y axis would switch them on (and move the plot area), so there only those it has are cleared.
 */
function hiddenAxis(axis: unknown, polar: boolean): Obj {
  const a = obj(axis);
  const title = a.title === undefined ? {} : { title: { ...obj(a.title), font: { ...obj(obj(a.title).font), color: CLEAR } } };
  const line = polar || a.showline === true || a.linecolor !== undefined ? { linecolor: CLEAR } : {};
  const ticks = polar || (typeof a.ticks === 'string' && a.ticks !== '') || a.tickcolor !== undefined ? { tickcolor: CLEAR } : {};
  return { ...a, ...line, ...ticks, tickfont: { ...obj(a.tickfont), color: CLEAR }, ...title };
}

/** An axis drawn without its grid (the chart under the layer draws that). */
const gridless = (axis: unknown, cartesian: boolean): Obj => ({ ...obj(axis), showgrid: false, ...(cartesian ? { zeroline: false } : {}) });

const cartesianAxes = (layout: Obj): string[] => Object.keys(layout).filter((key) => /^[xy]axis\d*$/.test(key));

/** The layout of the chart under the layer: the figure's, without the axes' lines and labels and without a title. */
export function underLayerLayout(layout: Partial<Layout>): Partial<Layout> {
  const l = layout as Obj;
  const out: Obj = { ...l };
  delete out.title;
  if (l.polar !== undefined) {
    const polar = obj(l.polar);
    out.polar = { ...polar, angularaxis: hiddenAxis(polar.angularaxis, true), radialaxis: hiddenAxis(polar.radialaxis, true) };
  }
  for (const axis of cartesianAxes(l)) out[axis] = hiddenAxis(l[axis], false);
  return out as Partial<Layout>;
}

/**
 * The layout of the marker layer: the figure's with the highlighted file's part (`overlay`), on a clear background,
 * without grid, legend or annotations (the chart under it draws those), in the `view` that chart shows now.
 */
export function markerLayerLayout(layout: Partial<Layout>, overlay: Partial<Layout>, view: Record<string, unknown> | null): Partial<Layout> {
  const l = { ...(layout as Obj), ...(overlay as Obj) };
  const out: Obj = { ...l, paper_bgcolor: CLEAR, plot_bgcolor: CLEAR, showlegend: false, annotations: [], dragmode: false };
  if (l.polar !== undefined) {
    const polar = obj(l.polar);
    out.polar = { ...polar, bgcolor: CLEAR, angularaxis: gridless(polar.angularaxis, false), radialaxis: gridless(polar.radialaxis, false) };
  }
  for (const axis of cartesianAxes(l)) out[axis] = gridless(l[axis], true);
  return withView(out as Partial<Layout>, view);
}

/**
 * The traces of the marker layer: the overlay's, after an empty one of the figure's kind, so that the layer lays out
 * and draws its axes like the chart under it also when the highlighted file has no marker (the library makes a
 * polar plot only for a polar trace).
 */
export function markerLayerData<T>(overlay: readonly T[], layout: Partial<Layout>): (T | Obj)[] {
  const polar = (layout as Obj).polar !== undefined;
  const empty = polar ? { type: 'scatterpolar', mode: 'lines', r: [], theta: [] } : { type: 'scatter', mode: 'lines', x: [], y: [] };
  return [{ ...empty, hoverinfo: 'skip', showlegend: false }, ...overlay];
}

/**
 * `layout` with a relayout of dotted keys (`'polar.radialaxis.range'`, `'xaxis.autorange'`, as `viewReset` gives
 * them) written into a copy; keys without a value are left out. An axis set to autorange loses its range.
 */
export function withView<T extends object>(layout: T, view: Record<string, unknown> | null): T {
  if (!view) return layout;
  const out = { ...(layout as Obj) };
  for (const [key, value] of Object.entries(view)) {
    if (value === undefined) continue;
    const path = key.split('.');
    let at = out;
    for (const part of path.slice(0, -1)) {
      at[part] = { ...obj(at[part]) };
      at = at[part] as Obj;
    }
    const last = path[path.length - 1];
    at[last] = Array.isArray(value) ? [...(value as unknown[])] : value;
    if (last === 'autorange' && value === true) delete at.range;
  }
  return out as T;
}

/**
 * The view a chart shows while it is dragged: its laid-out `view` with what the drag (`update`, a `plotly_relayouting`)
 * has already drawn. A polar chart turns, and moves its level axis or that axis' end, as the pointer moves, but notes
 * the new values only when the drag ends; its zoom (a whole new level range) is a box until then, and is left out. An x
 * or y chart notes a pan as it goes and draws its zoom box only, so its view says it all.
 */
export function dragView(view: Record<string, unknown> | null, update: Record<string, unknown>): Record<string, unknown> | null {
  if (view === null || !('polar.radialaxis.range' in view)) return view;
  const out = { ...view };
  for (const [key, value] of Object.entries(update)) {
    if (key === 'polar.angularaxis.rotation' || key === 'polar.radialaxis.angle') out[key] = value;
    const end = /^polar\.radialaxis\.range\[([01])\]$/.exec(key);
    if (end && Array.isArray(out['polar.radialaxis.range'])) {
      const range = [...(out['polar.radialaxis.range'] as unknown[])];
      range[Number(end[1])] = value;
      out['polar.radialaxis.range'] = range;
    }
  }
  return out;
}

/**
 * The moves that put the drawn traces (`current`, by id, in drawing order) in the `desired` order: each takes trace
 * `id` out and puts it back before trace `before` (null: last). Ids drawn but not desired keep their places among
 * the others; ids desired but not drawn are skipped. Moving the highlight from one trace to another takes two moves.
 */
export function reorderMoves(current: readonly string[], desired: readonly string[]): { id: string; before: string | null }[] {
  const drawn = new Set(current);
  const want = desired.filter((id) => drawn.has(id));
  const wanted = new Set(want);
  const order = [...current];
  const moves: { id: string; before: string | null }[] = [];
  for (let k = want.length - 1; k >= 0; k--) {
    const id = want[k];
    const before = k + 1 < want.length ? want[k + 1] : null;
    const at = order.indexOf(id);
    const next = order.slice(at + 1).find((other) => wanted.has(other)) ?? null;
    if (next === before) continue;
    order.splice(at, 1);
    order.splice(before === null ? order.length : order.indexOf(before), 0, id);
    moves.push({ id, before });
  }
  return moves;
}
