import type { Data, Layout } from 'plotly.js';
import type { Method3d, Surface3d } from '../core/analysis/pattern3d';
import type { ExportCaption } from './exportFigure';
import type { Figure, FigureTheme } from './figureTheme';
import { settingText } from './bwLabel';
import { PHONE_MAX_WIDTH, PHONE_ROW_PX, sceneId, sceneLayout, toCartesian } from './surfaceFigure';

/**
 * "Compare methods" in the 3D view: one file reconstructed with both 3D methods, in two scenes of one chart that share
 * the colour scale and the camera (a turn of one is given to the other, see `linkedCameraUpdate`). The method chosen
 * in the Simulation bar still gives every number; the panels only show what the choice changes.
 */

/** The methods in the order they are drawn: left (top on a phone), then right (below). */
export const COMPARED_METHODS: readonly Method3d[] = ['summation', 'weighted'];
export const METHOD_TITLE: Record<Method3d, string> = { summation: 'Summation', weighted: 'Weighted' };
const USED = 'used for the numbers';

/** The panels are stacked on a phone (the width class of `viewportClass`), side by side elsewhere. */
export const stacksMethods = (viewportWidth?: number): boolean => viewportWidth !== undefined && viewportWidth <= PHONE_MAX_WIDTH;

/** The plot's height in px when the panels are stacked (two rows of a phone's 3D scene, and the colour bar under them); undefined: the style sheet's. */
export const compareHeightPx = (viewportWidth?: number): number | undefined => (stacksMethods(viewportWidth) ? 2 * PHONE_ROW_PX + 56 : undefined);

export interface MethodCompareOptions {
  surfaces: Record<Method3d, Surface3d>;
  /** The method of the Simulation bar: the one the numbers use. */
  selected: Method3d;
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
    const name = METHOD_TITLE[method];
    // Side by side: halves of the width; stacked: halves of the height with room for the lower panel's title.
    const domain = stacked ? { x: [0, 1], y: k === 0 ? [0.55, 0.96] : [0, 0.45] } : { x: k === 0 ? [0.03, 0.49] : [0.53, 0.99], y: [0, 0.94] };
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
        ? { title: { text: 'dB', side: 'right' }, orientation: 'h', thickness: 12, lenmode: 'pixels', len: 200, x: 0.5, xanchor: 'center', y: 0, yanchor: 'top' }
        : { title: { text: 'dB' }, len: 0.5 },
      hovertemplate: `%{text}<br>%{surfacecolor:.1f} dB<extra>${name}</extra>`,
    });
    layout[sceneId(k)] = sceneLayout(o.floorDb, o.theme, domain);
    annotations.push({
      text: `<b>${name}</b>${method === o.selected ? ` · ${USED}` : ''}`,
      x: (domain.x[0] + domain.x[1]) / 2,
      y: stacked && k === 1 ? 0.5 : 1,
      xref: 'paper',
      yref: 'paper',
      xanchor: 'center',
      yanchor: stacked && k === 1 ? 'middle' : 'bottom',
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
  a.el.forEach((e, i) => {
    const w = Math.max(0, Math.cos((e * Math.PI) / 180));
    a.az.forEach((_, j) => {
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
export function compareAriaLabel(selected: Method3d, stacked: boolean): string {
  const [first, second] = COMPARED_METHODS;
  const place = stacked ? ['on top', 'below'] : ['on the left', 'on the right'];
  const part = (m: Method3d, where: string) => `${METHOD_TITLE[m]} ${where}${m === selected ? ` (${USED})` : ''}`;
  return `3D radiation pattern, the two methods compared: ${part(first, place[0])}, ${part(second, place[1])}`;
}

/** The caption of the exported image (always drawn side by side): the file, both methods, which one the numbers use and how far apart they are. */
export function compareExportCaption(fileLabel: string, selected: Method3d, floorDb: number, d: MethodDifference): ExportCaption {
  return {
    title: '3D radiation pattern, the two methods compared',
    file: fileLabel,
    items: [
      `Left: ${METHOD_TITLE.summation}; right: ${METHOD_TITLE.weighted}. The numbers use ${METHOD_TITLE[selected]}`,
      'Reconstructed from the H and V cuts: an estimate from two cuts, not measured data',
      `Radius and colour: level relative to the peak, one scale for both (0 dB outermost, −${settingText(floorDb)} dB at the centre)`,
    ],
    note: differenceText(d, floorDb),
  };
}
