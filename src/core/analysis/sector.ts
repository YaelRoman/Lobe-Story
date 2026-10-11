import type { MetricResult } from '../types';
import { attAt, mod360, type Grid } from './grid';

export const DU_LEVELS = [
  { key: 'qam16', label: '16QAM', db: 15 },
  { key: 'qam64', label: '64QAM', db: 20 },
  { key: 'qam256', label: '256QAM', db: 25 },
] as const;

const power = (att: number): number => 10 ** (-att / 10);

/** Sector power ratio (percent) and azimuth interference ratio (dB) for a sector of ±edgeDeg. */
export function sectorPower(h: Grid, edgeDeg = 60): { spr: MetricResult; air: MetricResult } {
  const total = h.reduce((sum, v) => sum + power(v), 0);
  let pd = 0;
  const limit = Math.floor(edgeDeg);
  for (let d = -limit; d <= limit; d++) {
    // Edge samples are half-weighted (trapezoid) only when edgeDeg is an integer; for a fractional
    // edge the last sample lies strictly inside the sector and keeps full weight.
    const w = d === -edgeDeg || d === edgeDeg ? 0.5 : 1;
    pd += w * power(attAt(h, d));
  }
  const pu = total - pd;
  if (pu <= 1e-12 * total) return { spr: { value: 0 }, air: { value: null, reason: 'No power outside the sector' } };
  return { spr: { value: (100 * pu) / pd }, air: { value: 10 * Math.log10(pd / pu) } };
}

/** Level below the peak at the two sector edges: [at −edgeDeg, at +edgeDeg]. */
export function rollOffEdges(h: Grid, edgeDeg = 60): [number, number] {
  return [attAt(h, -edgeDeg), attAt(h, edgeDeg)];
}

/** Level below the peak at the sector edges (the worse of the two); `angle` is the signed edge. */
export function rollOff(h: Grid, edgeDeg = 60): MetricResult {
  const [minus, plus] = rollOffEdges(h, edgeDeg);
  return minus > plus ? { value: minus, angle: -edgeDeg } : { value: plus, angle: edgeDeg };
}

/** D/U (dB) per degree: this pattern minus the strongest neighbouring-sector copy of itself. */
export function duCurve(h: Grid, sectors = 3): number[] {
  if (sectors < 2) return new Array<number>(360).fill(Infinity);
  const out = new Array<number>(360);
  for (let p = 0; p < 360; p++) {
    let m = Infinity;
    for (let k = 1; k < sectors; k++) m = Math.min(m, attAt(h, p - (k * 360) / sectors) - h[p]);
    out[p] = m;
  }
  return out;
}

/**
 * Width of the contiguous region around 0 degrees where D/U is at least `thresholdDb`.
 * `edges` are the signed aperture limits (edges[1] - edges[0] = value). For a region that wraps
 * past +/-180 degrees the lo side is left unwrapped, so edges[0] may be below -180; the sector
 * marker relies on this to draw one continuous arc.
 */
export function duAperture(
  h: Grid,
  thresholdDb: number,
  sectors = 3,
): MetricResult & { edges?: [number, number] } {
  const du = duCurve(h, sectors);
  if (!(du[0] >= thresholdDb)) return { value: null, reason: `D/U at boresight is below ${thresholdDb} dB` };
  const crossing = (dir: 1 | -1): number | null => {
    for (let i = 1; i < 360; i++) {
      const cur = du[mod360(dir * i)];
      if (cur < thresholdDb) {
        const prev = du[mod360(dir * (i - 1))];
        return i - 1 + (prev - thresholdDb) / (prev - cur);
      }
    }
    return null;
  };
  const hi = crossing(1);
  const lo = crossing(-1);
  if (hi === null || lo === null) return { value: 360, edges: [-180, 180], angle: 0 };
  return { value: hi + lo, edges: [-lo, hi], angle: (hi - lo) / 2 };
}
