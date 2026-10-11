import type { Data, Layout } from 'plotly.js';
import type { Surface3d } from '../core/analysis/pattern3d';
import type { Layout3d } from '../state/store';
import type { Figure, FigureTheme } from './figureTheme';

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

export const sceneId = (k: number): string => (k === 0 ? 'scene' : `scene${k + 1}`);

function sceneLayout(floorDb: number, theme: FigureTheme, domain?: { x: number[]; y: number[] }) {
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
    camera: { eye: { x: 1.5, y: -1.5, z: 0.9 } },
  };
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
    const cols = gridColumns(series.length);
    const rows = Math.max(1, Math.ceil(series.length / cols));
    const annotations: Record<string, unknown>[] = [];
    series.forEach((s, k) => {
      const c = k % cols;
      const r = Math.floor(k / cols);
      const x0 = c / cols;
      const x1 = (c + 1) / cols;
      const y0 = 1 - (r + 1) / rows;
      const y1 = 1 - r / rows;
      data.push({
        ...surfaceTrace(s),
        scene: sceneId(k),
        colorscale: 'Viridis',
        showscale: k === 0,
        colorbar: { title: { text: 'dB' }, len: 0.5 },
      });
      layout[sceneId(k)] = sceneLayout(o.floorDb, o.theme, { x: [x0, x1], y: [y0, y1 - 0.06 / rows] });
      annotations.push({
        text: s.label,
        x: (x0 + x1) / 2,
        y: y1,
        xref: 'paper',
        yref: 'paper',
        xanchor: 'center',
        yanchor: 'top',
        showarrow: false,
        font: { size: 12 },
      });
    });
    layout.annotations = annotations;
  }

  return { data: data as Data[], layout: layout as Partial<Layout> };
}

/** Given a plotly_relayout payload, the update that gives every other scene the same camera. */
export function linkedCameraUpdate(
  update: Record<string, unknown>,
  sceneCount: number,
): Record<string, unknown> | null {
  for (const [key, camera] of Object.entries(update)) {
    const m = /^(scene\d*)\.camera$/.exec(key);
    if (!m) continue;
    const out: Record<string, unknown> = {};
    for (let k = 0; k < sceneCount; k++) {
      const id = sceneId(k);
      if (id !== m[1]) out[`${id}.camera`] = camera;
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}
