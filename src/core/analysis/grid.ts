import type { Cut } from '../types';

/** 360 values, index = angle in degrees, attenuation normalised to a minimum of 0. */
export type Grid = number[];

export const mod360 = (a: number): number => ((a % 360) + 360) % 360;

export const signed = (a: number): number => {
  const m = mod360(a);
  return m > 180 ? m - 360 : m;
};

/** The cut resampled onto the 1° grid (index = angle), values as in the file (not normalised). */
export function rawGrid(cut: Cut): number[] {
  const byAngle = new Map<number, number>();
  cut.angles.forEach((a, k) => byAngle.set(mod360(a), cut.atten[k]));
  const xs = [...byAngle.keys()].sort((a, b) => a - b);
  const ys = xs.map((x) => byAngle.get(x)!);
  if (xs.length === 360 && xs.every((x, i) => x === i)) return ys;
  const out = new Array<number>(360);
  for (let d = 0; d < 360; d++) {
    let j = -1;
    for (let t = 0; t < xs.length && xs[t] <= d; t++) j = t;
    if (j === -1) j = xs.length - 1;
    const jn = (j + 1) % xs.length;
    const x0 = xs[j];
    let x1 = xs[jn];
    let dd = d;
    if (x1 <= x0) x1 += 360;
    if (dd < x0) dd += 360;
    out[d] = x1 === x0 ? ys[j] : ys[j] + ((ys[jn] - ys[j]) * (dd - x0)) / (x1 - x0);
  }
  return out;
}

export function toGrid(cut: Cut): Grid {
  const raw = rawGrid(cut);
  const min = Math.min(...raw);
  return raw.map((v) => v - min);
}

export const at = (g: Grid, angle: number): number => g[mod360(Math.round(angle))];

/** Attenuation at a fractional angle, linearly interpolated between the neighbouring integer degrees. */
export function attAt(g: Grid, angle: number): number {
  const a = mod360(angle);
  const i = Math.floor(a);
  const f = a - i;
  return f === 0 ? g[i % 360] : g[i % 360] * (1 - f) + g[(i + 1) % 360] * f;
}

export function peakIndex(g: Grid): number {
  let p = 0;
  for (let i = 1; i < 360; i++) if (g[i] < g[p]) p = i;
  return p;
}

export function refinedPeak(g: Grid): number {
  const p = peakIndex(g);
  const yl = at(g, p - 1);
  const y0 = g[p];
  const yr = at(g, p + 1);
  const denom = yl - 2 * y0 + yr;
  const delta = denom > 0 ? (0.5 * (yl - yr)) / denom : 0;
  return signed(p + delta);
}

/** Direction of the beam peak: the centre of a flat 0 dB top (two or more equal samples), else `refinedPeak`. */
export function peakCentre(g: Grid): number {
  const p = peakIndex(g);
  const tol = 1e-9;
  let up = 0;
  let down = 0;
  while (up < 359 && at(g, p + up + 1) <= g[p] + tol) up++;
  while (up + down < 359 && at(g, p - down - 1) <= g[p] + tol) down++;
  return up + down === 0 ? refinedPeak(g) : signed(p + (up - down) / 2);
}
