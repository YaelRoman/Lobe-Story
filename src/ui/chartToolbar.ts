/**
 * Which buttons a chart's toolbar (the charting library's modebar) shows. The list is explicit: the library's own
 * default set changes between versions and includes a cloud upload button, which this app must never offer (files
 * are read in the browser and never uploaded), and select tools that do nothing here.
 */

/**
 * The kind of chart: a polar cut (download only), a rectangular cut (drag-zoom is always on, so only its reset),
 * an x/y chart (frequency chart, histogram) or the 3D view.
 */
export type ChartToolbar = 'polar' | 'rect' | 'xy' | '3d';

type ButtonName = 'zoom2d' | 'resetScale2d' | 'tableRotation' | 'zoom3d' | 'resetCameraDefault3d' | 'toImage';

const TOOLS: Record<ChartToolbar, ButtonName[]> = {
  polar: [],
  rect: ['resetScale2d'],
  xy: ['zoom2d', 'resetScale2d'],
  '3d': ['tableRotation', 'zoom3d', 'resetCameraDefault3d'],
};

/** The button groups of a chart of this kind; `download` replaces the library's own image download button. */
export function toolbarButtons<T = never>(kind: ChartToolbar, download?: T): (ButtonName | T)[][] {
  const tools: (ButtonName | T)[] = TOOLS[kind];
  const last: (ButtonName | T)[] = [download ?? 'toImage'];
  return tools.length > 0 ? [tools, last] : [last];
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
