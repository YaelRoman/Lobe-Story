/**
 * Which buttons a chart's toolbar (the charting library's modebar) shows. The list is explicit: the library's own
 * default set changes between versions and includes a cloud upload button, which this app must never offer (files
 * are read in the browser and never uploaded), and select tools that do nothing here.
 */

/**
 * The kind of chart: a polar cut (a drag zooms or turns it), a rectangular cut (drag-zoom is always on, so only a
 * reset), an x/y chart (frequency chart, histogram) or the 3D view.
 */
export type ChartToolbar = 'polar' | 'rect' | 'xy' | '3d';

type ButtonName = 'zoom2d' | 'zoomIn2d' | 'zoomOut2d' | 'resetScale2d' | 'tableRotation' | 'zoom3d' | 'resetCameraDefault3d' | 'toImage';

/** `reset`: the place of the reset to the view the figure was built with (see `viewReset`). */
const TOOLS: Record<ChartToolbar, (ButtonName | 'reset')[]> = {
  polar: ['reset'],
  rect: ['reset'],
  xy: ['zoom2d', 'reset'],
  '3d': ['tableRotation', 'zoom3d', 'resetCameraDefault3d'],
};

/**
 * On a touch screen the plots with axes zoom by two buttons: a finger's drag is not theirs there (see `touchScrolls`), so the
 * drag-zoom tool goes as well. The polar cut and the 3D view keep their buttons.
 */
const TOUCH_TOOLS: Partial<Record<ChartToolbar, (ButtonName | 'reset')[]>> = {
  rect: ['zoomIn2d', 'zoomOut2d', 'reset'],
  xy: ['zoomIn2d', 'zoomOut2d', 'reset'],
};

/**
 * Whether a touch that starts on a chart of this kind is left to the browser (`coarse`: the primary pointer is a
 * finger), so that one finger moved up or down scrolls the page. The library takes every touch on a plot for a zoom or
 * a turn, and the page cannot be scrolled from a plot at all. A tap still reads a point, and a mouse on the same device
 * drags as before. The 3D view is turned with a finger and keeps its touches. Never for a mouse alone.
 */
export function touchScrolls(kind: ChartToolbar, coarse: boolean): boolean {
  return coarse && kind !== '3d';
}

/** How long after a finger is lifted the mouse events the browser makes of the tap can still arrive. */
const TAP_MOUSE_MS = 700;

/**
 * Keeps touches that start inside `el` from the charting library (see `touchScrolls`); returns how to undo it. The
 * listeners run before the library's own, which are on elements inside, and the one for the touch is passive: it
 * cannot stop the scroll. A tap then reaches the library as the mouse events the browser makes of it (move, press,
 * release): the point under the finger is read out and clicked. The library ends that press by taking a cover off
 * the page, which makes the pointer "leave" the plot and would clear the reading at once (a real mouse moves on and
 * gets it back): that one event is kept from it too.
 */
export function leaveTouchesToThePage(el: HTMLElement): () => void {
  let lifted = -Infinity;
  const keep = (event: Event) => event.stopPropagation();
  const lift = (event: Event) => {
    lifted = event.timeStamp;
  };
  const stay = (event: Event) => {
    if (event.timeStamp - lifted < TAP_MOUSE_MS) event.stopPropagation();
  };
  el.addEventListener('touchstart', keep, { capture: true, passive: true });
  el.addEventListener('touchend', lift, { capture: true, passive: true });
  el.addEventListener('mouseout', stay, { capture: true });
  return () => {
    el.removeEventListener('touchstart', keep, { capture: true });
    el.removeEventListener('touchend', lift, { capture: true });
    el.removeEventListener('mouseout', stay, { capture: true });
  };
}

/**
 * The button groups of a chart of this kind; `download` replaces the library's own image download button. `resetView`
 * is the chart's own reset ("Reset view" on a polar cut, "Reset axes" on the others): the library's reset returns to
 * the view of the first figure the chart ever drew, which is another one once a chart is updated in place, and a polar
 * plot has none. Without one, the x/y kinds fall back to the library's. The 3D view keeps the library's camera reset.
 * `touch`: the buttons for a touch screen (see `TOUCH_TOOLS`).
 */
export function toolbarButtons<T = never, R = never>(kind: ChartToolbar, download?: T, resetView?: R, touch = false): (ButtonName | T | R)[][] {
  const tools = ((touch ? TOUCH_TOOLS[kind] : undefined) ?? TOOLS[kind]).flatMap((name): (ButtonName | T | R)[] => {
    if (name !== 'reset') return [name];
    if (resetView !== undefined) return [resetView];
    return kind === 'polar' ? [] : ['resetScale2d'];
  });
  const last: (ButtonName | T | R)[] = [download ?? 'toImage'];
  return tools.length > 0 ? [tools, last] : [last];
}

interface PolarLayout {
  polar?: { radialaxis?: { range?: unknown; angle?: number }; angularaxis?: { rotation?: number } };
}

/**
 * The relayout that puts a polar figure's view back to the one it was built with, or null for a figure that is not
 * polar: a drag in the plot changes the level range, a drag on the level axis its angle, a drag on the rim the rotation.
 */
export function polarViewReset(layout: PolarLayout): Record<string, unknown> | null {
  const polar = layout.polar;
  if (!polar) return null;
  const range = polar.radialaxis?.range;
  return {
    'polar.radialaxis.range': Array.isArray(range) ? [...(range as unknown[])] : range,
    'polar.radialaxis.angle': polar.radialaxis?.angle,
    'polar.angularaxis.rotation': polar.angularaxis?.rotation,
  };
}

type AxisLayout = { range?: unknown } | undefined;

/**
 * The relayout that puts the axes of an x/y figure back to the view it was built with: the range the figure gives an
 * axis, or the automatic one for an axis it gives none. Every x and y axis of the layout, and always the first two
 * (a figure need not mention them).
 */
export function axesViewReset(layout: object): Record<string, unknown> {
  const axes = new Set(['xaxis', 'yaxis', ...Object.keys(layout).filter((key) => /^[xy]axis\d*$/.test(key))]);
  const update: Record<string, unknown> = {};
  for (const axis of axes) {
    const range = ((layout as Record<string, AxisLayout>)[axis])?.range;
    if (Array.isArray(range)) update[`${axis}.range`] = [...(range as unknown[])];
    else update[`${axis}.autorange`] = true;
  }
  return update;
}

/**
 * The relayout that returns a chart of this kind to the view its figure was built with, for the toolbar's reset and
 * a double click alike; null for the 3D view, whose camera is the library's business.
 */
export function viewReset(kind: ChartToolbar, layout: object): Record<string, unknown> | null {
  if (kind === '3d') return null;
  return kind === 'polar' ? polarViewReset(layout as PolarLayout) : axesViewReset(layout);
}

/**
 * Runs a relayout that puts a chart back to its built view. The library can fail two ways: it throws at once, or its
 * promise rejects. A throw is given to `onThrow` (the plot shows its error box); a rejection to `onReject` (the console).
 */
export function guardedReset(run: () => Promise<unknown>, onThrow: (error: unknown) => void, onReject: (error: unknown) => void): void {
  try {
    run().catch(onReject);
  } catch (error) {
    onThrow(error);
  }
}

/**
 * Chart config that keeps every chart offline: no cloud upload button (the library turns it on by default), no
 * destination for one even if a button came back, and no logo link to the library's site.
 */
export const CHART_PRIVACY = {
  showSendToCloud: false,
  plotlyServerURL: '',
  displaylogo: false,
} as const;
