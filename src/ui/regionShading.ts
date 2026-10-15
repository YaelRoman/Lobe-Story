import type { PlotData, Shape } from 'plotly.js';
import { clampedRegions as bounds, type AngularRegions } from '../core/analysis/are';
import { settingText } from './bwLabel';

/**
 * The Type A angular regions (see `are.ts`, docs/metrics.md "Angular regions (est.)") shaded on the cut plots, for the
 * file whose markers are drawn: where each region meets the plane of the cut. The regions are bands of elevation (all
 * azimuths) and, for the service region, an azimuth sector ±S around boresight.
 *
 * Vertical cut (the plane through boresight, angle 0° = horizon in front, + below, 180° = horizon behind): in front
 * the four bands; behind the antenna (azimuth 180°, outside a sector narrower than the whole circle) the same
 * elevations are upper, interference and lower. Horizontal cut: the plotted cut lies at one elevation (the beam
 * peak, or the horizon): where that elevation is inside the service band, azimuths within ±S are service and the rest
 * interference; otherwise the whole cut is interference.
 */

export type RegionName = 'upper' | 'service' | 'interference' | 'lower';

/** A stretch of a cut in plot angles (degrees, `from` < `to`, not wrapped: a span may run past 180° or 360°). */
export interface RegionSpan {
  region: RegionName;
  from: number;
  to: number;
}

/**
 * Colours of the regions, the same in both screen themes and in the exported image: mid tones that tint a white and a
 * dark plot alike at the low opacity they are drawn with. Their names go into the caption, so the colour is never
 * the only way to tell them apart.
 */
export const REGION_STYLE: Record<RegionName, { colour: string; name: string }> = {
  upper: { colour: '#218bff', name: 'blue' },
  interference: { colour: '#e16f24', name: 'orange' },
  service: { colour: '#2da44e', name: 'green' },
  lower: { colour: '#a475f9', name: 'purple' },
};

/** Opacity of the shading: a tint that leaves every trace readable over it. */
export const REGION_OPACITY = 0.12;

const EMPTY = 1e-9;

const nonEmpty = (spans: RegionSpan[]) => spans.filter((s) => s.to - s.from > EMPTY);

/** The regions along the vertical cut, covering its circle once (see the file comment). */
export function verticalCutSpans(r: AngularRegions): RegionSpan[] {
  const { end, upperEnd: u, serviceStart: s, sector } = bounds(r);
  // Behind the antenna an elevation e is drawn at 180° − e.
  const front: RegionSpan[] =
    sector > 0
      ? [
          { region: 'interference', from: u, to: s },
          { region: 'service', from: s, to: end },
        ]
      : [{ region: 'interference', from: u, to: end }];
  const back: RegionSpan[] =
    sector >= 180
      ? [
          { region: 'service', from: 180 - end, to: 180 - s },
          { region: 'interference', from: 180 - s, to: 180 - u },
        ]
      : [{ region: 'interference', from: 180 - end, to: 180 - u }];
  return nonEmpty([
    // From the upper end behind the antenna over the zenith to the upper end in front, and over the nadir below.
    { region: 'upper', from: 180 - u, to: 360 + u },
    ...front,
    { region: 'lower', from: end, to: 180 - end },
    ...back,
  ]);
}

/** Whether a horizontal cut at the horizon (elevation 0°) lies in the service elevations; a cut through the beam peak always does. */
const horizonInService = (r: AngularRegions) => {
  const { end, serviceStart } = bounds(r);
  return serviceStart <= 0 && end >= 0;
};

/**
 * The regions along the horizontal cut (`atHorizon`: the cut at the horizon, else the one through the beam peak),
 * turned by the plot's azimuth `rotationDeg`, covering its circle once.
 */
export function horizontalCutSpans(r: AngularRegions, atHorizon: boolean, rotationDeg: number): RegionSpan[] {
  const { sector } = bounds(r);
  if (atHorizon && !horizonInService(r)) return [{ region: 'interference', from: rotationDeg - 180, to: rotationDeg + 180 }];
  if (sector >= 180) return [{ region: 'service', from: rotationDeg - 180, to: rotationDeg + 180 }];
  return nonEmpty([
    { region: 'service', from: rotationDeg - sector, to: rotationDeg + sector },
    { region: 'interference', from: rotationDeg + sector, to: rotationDeg + 360 - sector },
  ]);
}

/** A span as one or two stretches of the rectangular axis −180…180°. */
export function rectPieces(from: number, to: number): [number, number][] {
  if (to - from >= 360 - EMPTY) return [[-180, 180]];
  let f = from;
  while (f > 180) f -= 360;
  while (f <= -180) f += 360;
  const t = f + (to - from);
  const pieces: [number, number][] = t > 180 ? [[f, 180], [-180, t - 360]] : [[f, t]];
  return pieces.filter(([a, b]) => b - a > EMPTY);
}

/** Integer steps between two angles, both ends included (as the markers' wedges). */
function arc(from: number, to: number): number[] {
  const out: number[] = [from];
  for (let a = Math.floor(from) + 1; a < to; a++) out.push(a);
  out.push(to);
  return out;
}

/**
 * The shading on a polar plot: a filled wedge per span from the centre (the plot floor) to 0 dB. It is left out of the
 * hover and the clicks (`hoverinfo: 'skip'`) and of the legend.
 */
export function polarRegionTraces(spans: RegionSpan[], floorDb: number): Partial<PlotData>[] {
  return spans.map((s) => {
    const theta = arc(s.from, s.to);
    return {
      type: 'scatterpolar',
      mode: 'lines',
      name: `${s.region} region`,
      theta: [s.from, ...theta, s.to],
      r: [-floorDb, ...theta.map(() => 0), -floorDb],
      fill: 'toself',
      fillcolor: REGION_STYLE[s.region].colour,
      opacity: REGION_OPACITY,
      line: { width: 0 },
      hoverinfo: 'skip',
      showlegend: false,
    };
  });
}

/** The shading on a rectangular plot: full-height bands between the grid and the traces. */
export function rectRegionShapes(spans: RegionSpan[]): Partial<Shape>[] {
  return spans.flatMap((s) =>
    rectPieces(s.from, s.to).map(
      ([x0, x1]): Partial<Shape> => ({
        type: 'rect',
        xref: 'x',
        yref: 'paper',
        x0,
        x1,
        y0: 0,
        y1: 1,
        fillcolor: REGION_STYLE[s.region].colour,
        opacity: REGION_OPACITY,
        line: { width: 0 },
        // Between the grid lines and the traces (the library has this layer; its types do not list it).
        layer: 'between' as Shape['layer'],
        name: `${s.region} region`,
      }),
    ),
  );
}

/** An elevation in the tool's convention, signed (+ below the horizon), one decimal unless whole. */
function elevation(deg: number): string {
  const text = Number.isInteger(deg) ? String(Math.abs(deg)) : Math.abs(deg).toFixed(1);
  return `${deg > 0 ? '+' : deg < 0 ? '−' : ''}${text}°`;
}

/** One region in the caption: its colour (for the swatch) and its words. */
export interface RegionCaptionItem {
  region: RegionName;
  text: string;
}

/** The text alternative of the shading: a lead naming the file, an item per region shown, a closing remark. */
export interface RegionCaption {
  lead: string;
  items: RegionCaptionItem[];
  note?: string;
}

const named = (region: RegionName) => `${region} (${REGION_STYLE[region].name})`;

/** A plot azimuth, −180…180 (as the axis labels it), with a typographic minus. */
const azimuth = (deg: number): string => {
  const a = ((((deg + 180) % 360) + 360) % 360) - 180;
  const text = Number.isInteger(a) ? String(Math.abs(a)) : Math.abs(a).toFixed(1);
  return `${a < 0 ? '−' : ''}${text}°`;
};

/**
 * What the tint of `cut` shows for the regions `r` of the file `file`, in degrees (see `verticalCutSpans`,
 * `horizontalCutSpans`). `rotationDeg`: the azimuth the horizontal plot is turned by; the sector then is named against
 * the pointing direction, with the plot angles it is drawn over.
 */
export function regionCaption(cut: 'H' | 'V', r: AngularRegions, atHorizon: boolean, file: string, rotationDeg = 0): RegionCaption {
  const { end, upperEnd: u, serviceStart: s, sector } = bounds(r);
  const edge = `±${settingText(sector)}°`;
  // "Tinted": the markers' caption already calls the beamwidth wedge "shaded".
  const lead = `Tinted: angular regions (est.) of ${file}`;
  if (cut === 'V') {
    const items: RegionCaptionItem[] = [];
    const band = (region: RegionName, from: number, to: number, extra = '') => {
      if (to - from > EMPTY) items.push({ region, text: `${named(region)} ${elevation(from)} to ${elevation(to)}${extra}` });
    };
    band('upper', -90, u);
    if (sector > 0) {
      band('interference', u, s);
      band('service', s, end, sector >= 180 ? ' at every azimuth' : ` within ${edge} of boresight`);
    } else band('interference', u, end);
    band('lower', end, 90);
    const note = sector >= 180 ? 'Behind the antenna: the same bands.' : 'Behind the antenna: the same bands, interference in place of service.';
    return { lead: `${lead}, by elevation (+ below the horizon)`, items, note };
  }
  const where = `${lead} on this cut ${atHorizon ? 'at the horizon' : 'through the beam peak'}`;
  if (atHorizon && !horizonInService(r)) {
    return { lead: `${where} (above the service region, which starts at ${elevation(s)})`, items: [{ region: 'interference', text: `all ${named('interference')}` }] };
  }
  const inside = `${where} (inside the service elevations ${elevation(s)} to ${elevation(end)})`;
  if (sector >= 180) return { lead: inside, items: [{ region: 'service', text: `all ${named('service')}` }] };
  return {
    lead: inside,
    items: [
      {
        region: 'service',
        text:
          rotationDeg === 0
            ? `${named('service')} within ${edge}`
            : `${named('service')} within ${edge} of the pointing direction (${azimuth(rotationDeg)}), drawn ${azimuth(rotationDeg - sector)} to ${azimuth(rotationDeg + sector)}`,
      },
      { region: 'interference', text: `${named('interference')} outside` },
    ],
  };
}

/** The caption as one line of text (the exported image's caption). */
export function regionCaptionText(c: RegionCaption): string {
  const items = c.items.length > 0 ? `: ${c.items.map((i) => i.text).join('; ')}` : '';
  return `${c.lead}${items}.${c.note ? ` ${c.note}` : ''}`;
}
