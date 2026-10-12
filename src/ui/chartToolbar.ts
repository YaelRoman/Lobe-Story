/**
 * Which buttons a chart's toolbar (the charting library's modebar) shows. The list is explicit: the library's own
 * default set changes between versions and includes a cloud upload button, which this app must never offer (files
 * are read in the browser and never uploaded), and select tools that do nothing here.
 */

/**
 * The kind of chart: a polar cut (a drag zooms or turns it, so a reset of our own: the library has none for polar
 * plots), a rectangular cut (drag-zoom is always on, so only its reset), an x/y chart (frequency chart, histogram)
 * or the 3D view.
 */
export type ChartToolbar = 'polar' | 'rect' | 'xy' | '3d';

type ButtonName = 'zoom2d' | 'resetScale2d' | 'tableRotation' | 'zoom3d' | 'resetCameraDefault3d' | 'toImage';

const TOOLS: Record<ChartToolbar, ButtonName[]> = {
  polar: [],
  rect: ['resetScale2d'],
  xy: ['zoom2d', 'resetScale2d'],
  '3d': ['tableRotation', 'zoom3d', 'resetCameraDefault3d'],
};

/**
 * The button groups of a chart of this kind; `download` replaces the library's own image download button, and
 * `resetView` is the polar chart's "Reset view" (the other kinds have a reset of the library's).
 */
export function toolbarButtons<T = never, R = never>(kind: ChartToolbar, download?: T, resetView?: R): (ButtonName | T | R)[][] {
  const tools: (ButtonName | T | R)[] = kind === 'polar' && resetView !== undefined ? [resetView] : TOOLS[kind];
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

/**
 * Chart config that keeps every chart offline: no cloud upload button (the library turns it on by default), no
 * destination for one even if a button came back, and no logo link to the library's site.
 */
export const CHART_PRIVACY = {
  showSendToCloud: false,
  plotlyServerURL: '',
  displaylogo: false,
} as const;
