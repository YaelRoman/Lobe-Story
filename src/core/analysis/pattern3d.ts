import { at, type Grid } from './grid';

export type Method3d = 'summation' | 'weighted';

export const STEP_3D = 3;

/** atten[elIndex][azIndex] in dB below peak. az −180…180, el −90…90 (positive = below horizon). */
export interface Surface3d {
  az: number[];
  el: number[];
  atten: number[][];
}

function axis(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let a = from; a <= to; a += step) out.push(a);
  return out;
}

/**
 * Combine H and V attenuation (dB, ≥ 0) into one direction's attenuation.
 * Weighted = cross-weighted interpolation (Gil et al.).
 */
export function combine(aH: number, aV: number, method: Method3d): number {
  if (method === 'summation') return aH + aV;
  return combineWeighted(aH, aV, 10 ** (-aH / 10), 10 ** (-aV / 10));
}

/** The weighted combination, for a caller that already has the linear powers `h`, `v` of the two attenuations. */
export function combineWeighted(aH: number, aV: number, h: number, v: number): number {
  const w1 = v * (1 - h);
  const w2 = h * (1 - v);
  const sum = w1 + w2;
  if (sum < 1e-12) return aH + aV;
  return (aH * w1 + aV * w2) / sum;
}

/** Reconstruct a 3D pattern from normalised H and V grids (see toGrid). */
export function reconstruct3d(h: Grid, v: Grid, method: Method3d, step = STEP_3D): Surface3d {
  const az = axis(-180, 180, step);
  const el = axis(-90, 90, step);
  const atten = el.map((e) => {
    const aV = at(v, e);
    return az.map((a) => combine(at(h, a), aV, method));
  });
  return { az, el, atten };
}
