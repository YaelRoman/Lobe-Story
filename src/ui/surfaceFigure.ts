import type { Data, Layout } from 'plotly.js';
import type { Surface3d } from '../core/analysis/pattern3d';
import type { Layout3d } from '../state/store';
import type { Figure, FigureTheme } from './figureTheme';
import { middleEllipsis } from './legend';

/** Most files the side-by-side layout draws (one WebGL scene per file). */
export const MAX_3D = 6;
/** Most surfaces the 3D Overlay draws at once (software-GL measurements: about 0.1 s per surface, a freeze that grows with the count). */
export const MAX_3D_OVERLAY = 12;
/** Most surfaces the 3D view draws in `layout`. */
export const maxSurfaces = (layout: Layout3d): number => (layout === 'grid' ? MAX_3D : MAX_3D_OVERLAY);

export interface SurfaceSeries {
  id: string;
  label: string;
  color: string;
  surface: Surface3d;
}

export interface SurfaceFigureOptions {
  series: SurfaceSeries[];
  layout: Layout3d;
  floorDb: number;
  theme: FigureTheme;
  /** The window width class in px (see `viewportClass`), so a phone gets fewer, larger scenes and a narrow desktop shorter titles (see `gridPlan`); undefined: assume a wide desktop. */
  viewportWidth?: number;
}

const RAD = Math.PI / 180;

/** Radius = level above the floor. Boresight = +x, +azimuth (clockwise from above) = −y, downtilt = −z. */
export function toCartesian(s: Surface3d, floorDb: number) {
  const x: number[][] = [];
  const y: number[][] = [];
  const z: number[][] = [];
  const level: number[][] = [];
  const text: string[][] = [];
  s.el.forEach((e, i) => {
    const rx: number[] = [];
    const ry: number[] = [];
    const rz: number[] = [];
    const rl: number[] = [];
    const rt: string[] = [];
    s.az.forEach((a, j) => {
      const A = s.atten[i][j];
      const r = Math.max(0, floorDb - A);
      rx.push(r * Math.cos(e * RAD) * Math.cos(a * RAD));
      ry.push(-r * Math.cos(e * RAD) * Math.sin(a * RAD));
      rz.push(-r * Math.sin(e * RAD));
      rl.push(Math.max(-A, -floorDb));
      rt.push(`az ${a}°, el ${e}°`);
    });
    x.push(rx);
    y.push(ry);
    z.push(rz);
    level.push(rl);
    text.push(rt);
  });
  return { x, y, z, level, text };
}

export const gridColumns = (n: number): number => (n <= 1 ? 1 : n <= 4 ? 2 : 3);

/** Widest window (px) laid out as a phone. */
export const PHONE_MAX_WIDTH = 760;
const NARROW_PHONE_WIDTH = 420;
/** Height of one row of scenes on a phone, in px. */
export const PHONE_ROW_PX = 300;
/** Average width of a character of a scene title (12 px text), in px. */
const TITLE_CHAR_PX = 6.8;
/** Width of the file panel next to the plot on a desktop, in px. */
const FILE_PANEL_WIDTH_PX = 348;
/** What the scenes lose to the plot's margins and the colour bar, in px. */
const SCENE_MARGIN_PX = 80;

/** About how wide the scenes of the 3D plot are together, in px: the window less the side margins (phone) or less the file panel and the colour bar (desktop); undefined window: a wide desktop. */
export function scenesWidthPx(viewportWidth?: number): number {
  if (viewportWidth === undefined) return 1100 - SCENE_MARGIN_PX;
  return viewportWidth <= PHONE_MAX_WIDTH ? viewportWidth - 24 : viewportWidth - FILE_PANEL_WIDTH_PX - SCENE_MARGIN_PX;
}

/**
 * Columns of the side-by-side layout and the longest scene title (in characters) that fits a scene. A phone (760 px or
 * narrower) gets 2 columns, 1 below 420 px: three scenes of 110 px cannot carry a title. A desktop keeps `gridColumns`; its title length follows the plot width (the window less the file panel).
 */
export function gridPlan(n: number, viewportWidth?: number): { columns: number; titleMax: number; phone: boolean } {
  const phone = viewportWidth !== undefined && viewportWidth <= PHONE_MAX_WIDTH;
  const columns = phone ? Math.min(gridColumns(n), viewportWidth < NARROW_PHONE_WIDTH ? 1 : 2) : gridColumns(n);
  // The plot is about the window less the side margins (phone) or less the file panel (desktop).
  const plotWidth = scenesWidthPx(viewportWidth);
  return { columns, titleMax: Math.max(12, Math.floor(plotWidth / columns / TITLE_CHAR_PX) - 2), phone };
}

/** The side-by-side plot's height in px on a phone (a row of scenes needs about 300 px); undefined: the style sheet's. */
export function gridHeightPx(n: number, viewportWidth?: number): number | undefined {
  if (viewportWidth === undefined || viewportWidth > PHONE_MAX_WIDTH) return undefined;
  return Math.max(480, Math.ceil(n / gridPlan(n, viewportWidth).columns) * PHONE_ROW_PX);
}

/** The colour bar on a phone: under the scenes, its title above the bar (beside it, "dB" ran into the first tick label). */
export const PHONE_COLORBAR = { title: { text: 'dB', side: 'top' }, orientation: 'h', thickness: 12, lenmode: 'pixels', len: 200, x: 0.5, xanchor: 'center', y: 0, yanchor: 'top' };

export const sceneId = (k: number): string => (k === 0 ? 'scene' : `scene${k + 1}`);

/** A 3D scene's axes and camera: every scene of the 3D view starts with the same ones. */
export function sceneLayout(floorDb: number, theme: FigureTheme, domain?: { x: number[]; y: number[] }) {
  const axis = {
    range: [-floorDb, floorDb],
    showticklabels: false,
    showbackground: false,
    gridcolor: theme.grid,
    zerolinecolor: theme.grid,
    title: { text: '' },
  };
  return {
    ...(domain ? { domain } : {}),
    aspectmode: 'cube',
    xaxis: { ...axis, title: { text: 'Boresight' } },
    yaxis: axis,
    zaxis: { ...axis, title: { text: 'Up' } },
    camera: { eye: { ...BUILT_CAMERA.eye } },
  };
}

/**
 * Scene `k` of a grid of `cols` columns and `rows` rows (filled row by row): its domain, and where its title hangs
 * from (the title's top edge, centred over the scene). Per row of height 1/rows there is room above the title (so it
 * does not read as the caption of the scene above) and a title band over its own scene.
 */
export function gridCell(k: number, cols: number, rows: number): { domain: { x: number[]; y: number[] }; titleX: number; titleY: number } {
  const c = k % cols;
  const r = Math.floor(k / cols);
  const x0 = c / cols;
  const x1 = (c + 1) / cols;
  const y0 = 1 - (r + 1) / rows;
  const y1 = 1 - r / rows;
  const gap = 0.14 / rows;
  const band = 0.07 / rows;
  return { domain: { x: [x0, x1], y: [y0 + gap, y1 - band] }, titleX: (x0 + x1) / 2, titleY: y1 };
}

export function buildSurfaceFigure(o: SurfaceFigureOptions): Figure {
  // Both layouts are capped (the caller says which files to keep, see viewCaps `capItems`): an unbounded
  // number of surfaces can freeze the tab.
  const series = o.series.slice(0, maxSurfaces(o.layout));
  const data: Record<string, unknown>[] = [];
  const layout: Record<string, unknown> = {
    paper_bgcolor: o.theme.bg,
    font: { color: o.theme.fg },
    margin: { l: 0, r: 0, t: 30, b: 0 },
    uirevision: 'keep',
    showlegend: o.layout === 'overlay',
    legend: { orientation: 'h', y: 0 },
  };

  const surfaceTrace = (s: SurfaceSeries) => {
    const c = toCartesian(s.surface, o.floorDb);
    return {
      type: 'surface',
      name: s.label,
      // The full file label: the labelled export turns it into the legend entry.
      meta: s.label,
      x: c.x,
      y: c.y,
      z: c.z,
      surfacecolor: c.level,
      text: c.text,
      cmin: -o.floorDb,
      cmax: 0,
      hovertemplate: `%{text}<br>%{surfacecolor:.1f} dB<extra>${s.label}</extra>`,
    };
  };

  if (o.layout === 'overlay') {
    for (const s of series) {
      data.push({
        ...surfaceTrace(s),
        scene: 'scene',
        colorscale: [
          [0, s.color],
          [1, s.color],
        ],
        showscale: false,
        opacity: 0.5,
        showlegend: true,
      });
    }
    layout.scene = sceneLayout(o.floorDb, o.theme);
  } else {
    const { columns: cols, titleMax, phone } = gridPlan(series.length, o.viewportWidth);
    const rows = Math.max(1, Math.ceil(series.length / cols));
    const annotations: Record<string, unknown>[] = [];
    series.forEach((s, k) => {
      const cell = gridCell(k, cols, rows);
      data.push({
        ...surfaceTrace(s),
        scene: sceneId(k),
        colorscale: 'Viridis',
        showscale: k === 0,
        // A phone has no room beside the scenes: the bar lies under them.
        colorbar: phone
          ? PHONE_COLORBAR
          : { title: { text: 'dB' }, len: 0.5 },
      });
      layout[sceneId(k)] = sceneLayout(o.floorDb, o.theme, cell.domain);
      annotations.push({
        text: middleEllipsis(s.label, titleMax),
        x: cell.titleX,
        y: cell.titleY,
        xref: 'paper',
        yref: 'paper',
        xanchor: 'center',
        yanchor: 'top',
        showarrow: false,
        font: { size: 12 },
      });
    });
    layout.annotations = annotations;
    if (phone) layout.margin = { l: 0, r: 0, t: 30, b: 56 };
  }

  return { data: data as Data[], layout: layout as Partial<Layout> };
}

/**
 * Given a plotly_relayout payload, the update that gives every other scene the same camera (null: no other scene).
 * `withSource`: the turned scene's own camera too. The library writes a turned scene's camera into the layout object
 * the scene was first drawn with; after a redraw has handed the chart another one, that write is lost, and the
 * relayout that turns the other scenes puts the turned one back where it was. Written again with them, it stays.
 */
export function linkedCameraUpdate(
  update: Record<string, unknown>,
  sceneCount: number,
  withSource = false,
): Record<string, unknown> | null {
  for (const [key, camera] of Object.entries(update)) {
    const m = /^(scene\d*)\.camera$/.exec(key);
    if (!m) continue;
    const out: Record<string, unknown> = {};
    for (let k = 0; k < sceneCount; k++) {
      const id = sceneId(k);
      if (id !== m[1]) out[`${id}.camera`] = camera;
    }
    if (Object.keys(out).length === 0) return null;
    return withSource ? { [key]: camera, ...out } : out;
  }
  return null;
}

/** The view every scene is built with (see `sceneLayout`), in full: where "Reset camera to default" returns to. */
export const BUILT_CAMERA = { up: { x: 0, y: 0, z: 1 }, center: { x: 0, y: 0, z: 0 }, eye: { x: 1.5, y: -1.5, z: 0.9 } };

const CAMERA_KEY = /^(scene\d*)\.camera(\.(eye|up|center|projection)(\.[xyz]|\.type)?)?$/;

/** The scene whose camera a plotly_relayout payload changed (the first one named, also for a part of a camera); null: none. */
export function cameraSceneOf(update: Record<string, unknown>): string | null {
  for (const key of Object.keys(update)) {
    const m = CAMERA_KEY.exec(key);
    if (m) return m[1];
  }
  return null;
}

/** Whether a plotly_relayout payload is the toolbar's "Reset camera to default": it sets the parts of the cameras to null (the library's defaults). */
export const isCameraReset = (update: Record<string, unknown>): boolean => Object.entries(update).some(([key, value]) => value === null && CAMERA_KEY.test(key));

/** The update that gives each of `sceneCount` scenes `camera`. */
export function allScenesCamera(sceneCount: number, camera: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let k = 0; k < sceneCount; k++) out[`${sceneId(k)}.camera`] = structuredClone(camera);
  return out;
}

/** A camera as text, its numbers to 4 decimals: the same view read back from the library (with rounding noise) gives the same text. */
export const cameraKey = (camera: unknown): string => JSON.stringify(camera, (_, v: unknown) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v));

/** The camera of a plotly_relayout payload that turned or zoomed a scene (the first one named); undefined: none. */
export const cameraOf = (update: Record<string, unknown>): unknown => Object.entries(update).find(([key]) => /^scene\d*\.camera$/.test(key))?.[1];

/**
 * `figure` with every scene seen from `camera` (null: as built). A figure built anew starts from the view the user
 * turned to: the library keeps a turned view across a redraw only for the scene turned last by hand, and would put a
 * scene that was turned by the link (see `linkedCameraUpdate`) back to the built view.
 */
export function withCamera(figure: Figure, camera: unknown): Figure {
  if (camera === null || camera === undefined) return figure;
  const layout: Record<string, unknown> = { ...figure.layout };
  for (const key of Object.keys(layout)) {
    if (/^scene\d*$/.test(key)) layout[key] = { ...(layout[key] as object), camera: structuredClone(camera) };
  }
  return { data: figure.data, layout: layout as Partial<Layout> };
}

/**
 * The window width reduced to what the side-by-side layout tells apart: 390 (below 420 px), 600 (a phone or small
 * tablet, up to 760 px), or undefined (a desktop). Coarse on purpose: a figure is rebuilt only when it changes.
 */
export const widthClass = (innerWidth: number): number | undefined => (innerWidth <= PHONE_MAX_WIDTH ? (innerWidth < NARROW_PHONE_WIDTH ? 390 : 600) : undefined);

/**
 * What `buildSurfaceFigure` is given as `viewportWidth`: the phone classes of `widthClass`, and on a desktop the window
 * width rounded down to 100 px (800 to 1400), so the titles follow the real plot width. Rounding down errs towards
 * shorter titles; the figure is rebuilt only when a 100 px step is crossed.
 */
export const viewportClass = (innerWidth: number): number =>
  widthClass(innerWidth) ?? Math.min(1400, Math.max(PHONE_MAX_WIDTH + 40, Math.floor(innerWidth / 100) * 100));
