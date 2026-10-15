import type { Data, Layout } from 'plotly.js';
import type { Method3d, Surface3d } from '../core/analysis/pattern3d';
import { methodFull, methodNameOf } from '../core/analysis/backHalf3d';
import type { ExportCaption } from './exportFigure';
import type { Figure, FigureTheme } from './figureTheme';
import { settingText } from './bwLabel';
import { gridCell, PHONE_COLORBAR, PHONE_MAX_WIDTH, PHONE_ROW_PX, scenesWidthPx, sceneId, sceneLayout, toCartesian } from './surfaceFigure';

/**
 * "Compare methods" in the 3D view: one file reconstructed with both 3D methods, in two scenes of one chart that share
 * the colour scale and the camera (a turn of one is given to the other, see `linkedCameraUpdate`). The method chosen
 * in the Simulation bar still gives every number; the panels only show what the choice changes.
 */

/** The methods in the order they are drawn: left (top on a phone), then right (below). */
export const COMPARED_METHODS: readonly Method3d[] = ['summation', 'weighted'];
export const METHOD_TITLE: Record<Method3d, string> = { summation: 'Summation', weighted: 'Weighted' };
/** A panel's title: the method, and the reconstruction when it reads the back of the vertical cut. */
const panelTitle = (m: Method3d, backHalf: boolean): string => methodFull(methodNameOf(m, backHalf));
const USED = 'used for the numbers';

/** The panels are stacked on a phone (the width class of `viewportClass`), side by side elsewhere. */
export const stacksMethods = (viewportWidth?: number): boolean => viewportWidth !== undefined && viewportWidth <= PHONE_MAX_WIDTH;

/** The plot's height in px when the panels are stacked (two rows of a phone's 3D scene, and the colour bar under them); undefined: the style sheet's. */
export const compareHeightPx = (viewportWidth?: number): number | undefined => (stacksMethods(viewportWidth) ? 2 * PHONE_ROW_PX + 56 : undefined);

/** The style sheet's height of the 3D plot on a desktop, in px (theme.css `.plot3d`), less its top margin. */
const DESKTOP_PLOT_PX = 640 - 30;

/**
 * The height share of a side-by-side panel: the scene's box is scaled to the panel's height, so a panel narrower than
 * it is tall (a window of about 1024 px) is made as tall as it is wide, and the box stays inside it.
 */
export const sideBySideHeight = (viewportWidth?: number): number => Math.min(1, scenesWidthPx(viewportWidth) / 2 / DESKTOP_PLOT_PX);

export interface MethodCompareOptions {
  surfaces: Record<Method3d, Surface3d>;
  /** The method of the Simulation bar: the one the numbers use. */
  selected: Method3d;
  /** Both surfaces read the back of the vertical cut (the Simulation bar's choice): the panel titles say so. */
  backHalf?: boolean;
  floorDb: number;
  theme: FigureTheme;
  /** The window width class in px (see `viewportClass`); undefined: a wide desktop. */
  viewportWidth?: number;
}

export function buildMethodCompareFigure(o: MethodCompareOptions): Figure {
  const stacked = stacksMethods(o.viewportWidth);
  const data: Record<string, unknown>[] = [];
  const annotations: Record<string, unknown>[] = [];
  const layout: Record<string, unknown> = {
    paper_bgcolor: o.theme.bg,
    font: { color: o.theme.fg },
    margin: stacked ? { l: 0, r: 0, t: 30, b: 56 } : { l: 0, r: 0, t: 30, b: 0 },
    uirevision: 'keep',
    showlegend: false,
  };
  COMPARED_METHODS.forEach((method, k) => {
    const c = toCartesian(o.surfaces[method], o.floorDb);
    const name = panelTitle(method, o.backHalf ?? false);
    // The side-by-side 3D view's cells for two files (two columns, or one column of two rows when stacked): the
    // same room for the scene, its axis titles and its title.
    const cell = stacked ? gridCell(k, 1, 2) : gridCell(k, 2, 1);
    const domain = stacked ? cell.domain : { x: cell.domain.x, y: [Math.max(cell.domain.y[0], cell.domain.y[1] - sideBySideHeight(o.viewportWidth)), cell.domain.y[1]] };
    // No `meta`: the image's legend lists files, and both surfaces are of one file (the caption names it).
    data.push({
      type: 'surface',
      name,
      scene: sceneId(k),
      x: c.x,
      y: c.y,
      z: c.z,
      surfacecolor: c.level,
      text: c.text,
      // One colour scale for both: the same range and colours, one bar.
      cmin: -o.floorDb,
      cmax: 0,
      colorscale: 'Viridis',
      showscale: k === 0,
      colorbar: stacked
        ? PHONE_COLORBAR
        : { title: { text: 'dB' }, len: 0.5 },
      hovertemplate: `%{text}<br>%{surfacecolor:.1f} dB<extra>${name}</extra>`,
    });
    layout[sceneId(k)] = sceneLayout(o.floorDb, o.theme, domain);
    annotations.push({
      text: `<b>${name}</b>${method === o.selected ? ` · ${USED}` : ''}`,
      x: cell.titleX,
      y: cell.titleY,
      xref: 'paper',
      yref: 'paper',
      xanchor: 'center',
      yanchor: 'top',
      showarrow: false,
      font: { size: 13 },
    });
  });
  layout.annotations = annotations;
  return { data: data as Data[], layout: layout as Partial<Layout> };
}

export interface MethodDifference {
  /** Largest difference of level between the two surfaces, in dB. */
  maxDb: number;
  /** Mean difference over the sphere (each direction weighted by the solid angle it stands for), in dB. */
  meanDb: number;
}

/**
 * How far apart two reconstructions of one file are: the level of each direction (dB relative to the peak, below the
 * plot floor taken as the floor, as drawn) compared. Both must be on the same grid.
 */
export function methodDifference(a: Surface3d, b: Surface3d, floorDb: number): MethodDifference {
  if (a.el.length !== b.el.length || a.az.length !== b.az.length) throw new Error('The two surfaces are not on the same grid');
  let maxDb = 0;
  let sum = 0;
  let weights = 0;
  // A grid that runs from −180° to 180° has the same meridian at both ends: it is counted once.
  const columns = a.az.length > 1 && a.az[a.az.length - 1] - a.az[0] === 360 ? a.az.length - 1 : a.az.length;
  a.el.forEach((e, i) => {
    const w = Math.max(0, Math.cos((e * Math.PI) / 180));
    a.az.slice(0, columns).forEach((_, j) => {
      const d = Math.abs(Math.max(-a.atten[i][j], -floorDb) - Math.max(-b.atten[i][j], -floorDb));
      if (d > maxDb) maxDb = d;
      sum += w * d;
      weights += w;
    });
  });
  return { maxDb, meanDb: weights > 0 ? sum / weights : 0 };
}

const dB = (x: number) => `${x.toFixed(1)} dB`;

/** The sentence under the panels that says how far apart the two methods are. */
export const differenceText = (d: MethodDifference, floorDb: number): string =>
  `The methods differ by up to ${dB(d.maxDb)}, ${dB(d.meanDb)} on average over the sphere (levels below the −${settingText(floorDb)} dB floor count as the floor).`;

/** The chart's accessible name: what the two panels are, where each is, and which one the numbers use. */
export function compareAriaLabel(selected: Method3d, stacked: boolean, backHalf = false): string {
  const [first, second] = COMPARED_METHODS;
  const place = stacked ? ['on top', 'below'] : ['on the left', 'on the right'];
  const part = (m: Method3d, where: string) => `${panelTitle(m, backHalf)} ${where}${m === selected ? ` (${USED})` : ''}`;
  return `3D radiation pattern, the two methods compared: ${part(first, place[0])}, ${part(second, place[1])}`;
}

/** The caption of the exported image (always drawn side by side): the file, both methods, which one the numbers use and how far apart they are. */
export function compareExportCaption(fileLabel: string, selected: Method3d, floorDb: number, d: MethodDifference, backHalf = false): ExportCaption {
  return {
    title: '3D radiation pattern, the two methods compared',
    file: fileLabel,
    items: [
      `Left: ${panelTitle('summation', backHalf)}; right: ${panelTitle('weighted', backHalf)}. The numbers use ${panelTitle(selected, backHalf)}`,
      'Reconstructed from the H and V cuts: an estimate from two cuts, not measured data',
      `Radius and colour: level relative to the peak, one scale for both (0 dB outermost, −${settingText(floorDb)} dB at the centre)`,
    ],
    note: differenceText(d, floorDb),
  };
}
